"""Real POSIX PTYs. Closing a network connection never closes a shell."""
from __future__ import annotations

import asyncio
import errno
import fcntl
import os
import pty
import re
import shutil
import signal
import struct
import subprocess
import sys
import termios
import time
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Awaitable

from .process_wait import exit_status
from .crypto import b64, token

Send = Callable[[str, dict], Awaitable[None]]
MAX_REPLAY = 2 * 1024 * 1024


class AttentionParser:
    """Recognize BEL and terminal notification OSCs across arbitrary read chunks.

    OSC title/clipboard payloads are never treated as notifications or exposed.
    """
    def __init__(self):
        self.state, self.payload = 'text', bytearray()

    def feed(self, data: bytes) -> set[str]:
        events = set()
        for byte in data:
            if self.state == 'text':
                if byte == 7:
                    events.add('bell')
                elif byte == 27:
                    self.state = 'escape'
            elif self.state == 'escape':
                self.state = 'osc' if byte == 93 else 'text'
                self.payload.clear()
            elif self.state in ('osc', 'osc-escape'):
                if byte == 7 or (self.state == 'osc-escape' and byte == 92):
                    if self.payload.startswith((b'9;', b'777;notify;')):
                        events.add('program')
                    self.state = 'text'
                    self.payload.clear()
                elif byte == 27:
                    self.state = 'osc-escape'
                else:
                    self.state = 'osc'
                    if len(self.payload) < 64:
                        self.payload.append(byte)
        return events


@dataclass
class Session:
    id: str
    name: str
    cwd: str
    pid: int
    fd: int
    cols: int
    rows: int
    tmux: str = ""
    process: subprocess.Popen | None = None
    created: float = field(default_factory=time.time)
    alive: bool = True
    exit_code: int | None = None
    offset: int = 0
    ring: deque = field(default_factory=deque)
    ring_bytes: int = 0
    subscribers: set = field(default_factory=set)
    viewers: dict = field(default_factory=dict)
    active_view: str = ""
    attention: AttentionParser = field(default_factory=AttentionParser)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    queue: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(128))
    reading: bool = False
    resizing: bool = False
    resize_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    pump: asyncio.Task | None = None
    reaper: asyncio.Task | None = None

    def info(self) -> dict:
        return {"id": self.id, "name": self.name, "cwd": self.cwd, "pid": self.pid,
                "cols": self.cols, "rows": self.rows, "alive": self.alive,
                "exitCode": self.exit_code, "created": self.created, "tmux": self.tmux,
                "viewers": list(self.viewers.values()), "activeView": self.active_view}


class Sessions:
    def __init__(self, send: Send, changed: Callable[[], Awaitable[None]], root: Path, attention=None):
        self.send, self.changed, self.root = send, changed, root
        self.items: dict[str, Session] = {}
        self.accepting = True
        self.attention = attention or (lambda *_: None)
        self.loop = asyncio.get_running_loop()

    def list(self) -> list[dict]:
        return [s.info() for s in self.items.values()]

    async def tmux_list(self) -> list[dict]:
        binary = shutil.which("tmux")
        if not binary:
            return []
        proc = await asyncio.create_subprocess_exec(binary, "list-sessions", "-F",
                                                   "#{session_name}\t#{session_windows}\t#{session_attached}",
                                                   stdout=asyncio.subprocess.PIPE,
                                                   stderr=asyncio.subprocess.DEVNULL)
        out, _ = await asyncio.wait_for(proc.communicate(), 5)
        return [{"name": p[0], "windows": p[1], "attached": p[2]}
                for row in out.decode(errors="replace").splitlines()
                if len(p := row.split("\t")) == 3]

    async def create(self, data: dict) -> dict:
        if not self.accepting:
            raise ValueError("Host is stopping for an upgrade; cannot create a shell")
        sid = data.get("id") or token(12)
        if not re.fullmatch(r"[A-Za-z0-9_-]{8,64}", sid):
            raise ValueError("Invalid session identifier")
        if sid in self.items:
            return self.items[sid].info()  # Idempotent create after a lost acknowledgement.
        if len(self.items) >= 32:
            raise ValueError("Close an old terminal first (32 retained sessions maximum)")
        if sum(s.alive for s in self.items.values()) >= 16:
            raise ValueError("The limit is 16 running shells per host")
        cwd = Path(data.get("cwd") or Path.home()).expanduser().resolve(strict=True)
        if not cwd.is_dir():
            raise ValueError("Working directory is not a directory")
        name = str(data.get("name") or f"Shell {len(self.items) + 1}")[:80]
        cols, rows = dimensions(data)
        tmux = str(data.get("tmux") or "")
        shell = os.environ.get("SHELL") or "/bin/bash"
        if not os.path.isfile(shell):
            shell = "/bin/sh"
        command = [shell, "-l"]
        if tmux:
            if len(tmux) > 100 or "\0" in tmux:
                raise ValueError("Invalid tmux session")
            if not shutil.which("tmux"):
                raise ValueError("tmux is not installed on this machine")
            # An existing tmux is never killed by closing its jaunt view.
            if data.get("tmuxCreate"):
                if not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", tmux):
                    raise ValueError("New tmux names must contain letters, digits, underscores or hyphens")
                command = ["tmux", "new-session", "-A", "-s", tmux]
            else:
                command = ["tmux", "attach-session", "-t", "=" + tmux]
        fd, slave = pty.openpty()
        env = {**os.environ, "TERM": "xterm-256color", "COLORTERM": "truecolor",
               "jaunt_SESSION_ID": sid, "jaunt_STATE": str(self.root)}
        # Old installed CLIs inside the shell keep working during a rolling upgrade.
        for key in ("jaunt_SESSION_ID", "jaunt_STATE"):
            env[key.upper()] = env[key]
        try:
            fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
            process = subprocess.Popen(
                [sys.executable, str(Path(__file__).with_name("pty_exec.py")), *command],
                stdin=slave, stdout=slave, stderr=slave, cwd=cwd, env=env,
                start_new_session=True, close_fds=True)
        except BaseException:
            os.close(fd)
            raise
        finally:
            os.close(slave)
        os.set_blocking(fd, False)
        s = Session(sid, name, str(cwd), process.pid, fd, cols, rows,
                    tmux=tmux, process=process)
        self.items[sid] = s
        self.resize(sid, {"cols": cols, "rows": rows})
        self._resume_reader(s)
        s.pump = asyncio.create_task(self._pump(s))
        s.reaper = asyncio.create_task(self._reap(s))
        await self.changed()
        return s.info()

    def _resume_reader(self, s: Session) -> None:
        if s.fd >= 0 and not s.reading and not s.resizing:
            self.loop.add_reader(s.fd, self._read, s)
            s.reading = True

    def _pause_reader(self, s: Session) -> None:
        if s.fd >= 0 and s.reading:
            self.loop.remove_reader(s.fd)
            s.reading = False

    def _read(self, s: Session) -> None:
        if s.queue.full():
            self._pause_reader(s)
            return
        try:
            data = os.read(s.fd, 32768)
            if data:
                s.queue.put_nowait(data)
            else:
                self._pause_reader(s)
        except BlockingIOError:
            pass
        except OSError as exc:
            if exc.errno in (errno.EIO, errno.EBADF):
                self._pause_reader(s)
            else:
                raise

    async def _safe_send(self, peer: str, value: dict) -> None:
        try:
            await self.send(peer, value)
        except (ConnectionError, RuntimeError):
            pass

    async def _pump(self, s: Session) -> None:
        while True:
            chunk = await s.queue.get()
            for event in s.attention.feed(chunk):
                self.attention(s, event)
            if s.alive:
                self._resume_reader(s)
            async with s.lock:
                start = s.offset
                s.offset += len(chunk)
                s.ring.append((start, chunk, s.cols, s.rows))
                s.ring_bytes += len(chunk)
                while s.ring_bytes > MAX_REPLAY and len(s.ring) > 1:
                    _, old, _, _ = s.ring.popleft()
                    s.ring_bytes -= len(old)
                event = {"type": "terminal.output", "id": s.id, "offset": start, "data": b64(chunk)}
                for peer in tuple(s.subscribers):
                    await self._safe_send(peer, event)
            s.queue.task_done()

    async def _reap(self, s: Session) -> None:
        while s.alive:
            # Keep the leader waitable until this retained session is removed.
            # Its reserved PID prevents reuse while we still own background jobs,
            # including jobs which outlive the interactive shell.
            result = exit_status(s.pid) if s.process else None
            if result is not None:
                s.exit_code = result
                break
            await asyncio.sleep(0.1)
        s.alive = False
        self.attention(s, 'exit')
        # Drain all buffered trailing bytes before reporting exit. Reader callbacks
        # may still have bytes queued while the shell has already exited.
        self._pause_reader(s)
        if s.fd >= 0:
            while True:
                try:
                    data = os.read(s.fd, 32768)
                    if not data:
                        break
                    await s.queue.put(data)
                except (BlockingIOError, OSError):
                    break
        await s.queue.join()
        self._pause_reader(s)
        for peer in tuple(s.subscribers):
            await self._safe_send(peer, {"type": "terminal.exit", "id": s.id, "code": s.exit_code})
        await self.changed()

    def get(self, sid: str) -> Session:
        if sid not in self.items:
            raise ValueError("This terminal no longer exists")
        return self.items[sid]

    async def attach(self, peer: str, data: dict) -> dict:
        s = self.get(data["id"])
        after = data.get("after")
        if after is not None and (type(after) is not int or after < 0):
            raise ValueError("Invalid replay offset")
        async with s.lock:
            start = s.ring[0][0] if s.ring else s.offset
            if after is None or after < start or after > s.offset:
                after = start
                await self._safe_send(peer, {"type": "terminal.reset", "id": s.id,
                                            "offset": start, "trimmed": start > 0,
                                            "cols": s.ring[0][2] if s.ring else s.cols, "rows": s.ring[0][3] if s.ring else s.rows})
            replay_size = None
            for offset, chunk, cols, rows in s.ring:
                end = offset + len(chunk)
                if end > after:
                    if replay_size != (cols, rows):
                        await self._safe_send(peer, {"type": "terminal.geometry", "id": s.id,
                                                    "cols": cols, "rows": rows, "activeView": s.active_view,
                                                    "viewers": list(s.viewers.values())})
                        replay_size = (cols, rows)
                    begin = max(after, offset)
                    await self._safe_send(peer, {"type": "terminal.output", "id": s.id,
                                                "offset": begin, "data": b64(chunk[begin - offset:])})
            await self._safe_send(peer, {"type": "terminal.geometry", "id": s.id,
                                        "cols": s.cols, "rows": s.rows, "activeView": s.active_view,
                                        "viewers": list(s.viewers.values())})
            s.subscribers.add(peer)
        return s.info()

    async def write(self, sid: str, data: bytes) -> None:
        if len(data) > 64 * 1024:
            raise ValueError("Input frame is too large")
        s = self.get(sid)
        if not s.alive:
            raise ValueError("This shell has exited")
        view = memoryview(data)
        deadline = self.loop.time() + 10
        while view:
            if not s.alive or self.loop.time() > deadline:
                raise ConnectionError("Shell is not accepting input; input was not replayed")
            try:
                n = os.write(s.fd, view)
                view = view[n:]
            except BlockingIOError:
                await asyncio.sleep(0.01)

    async def activity(self, peer: str, sid: str, data: dict, name: str = "Device") -> None:
        """Only an explicitly active view may change the shared PTY geometry."""
        s = self.get(sid)
        if peer not in s.subscribers:
            raise ValueError("Attach to this terminal before interacting with it")
        if s.active_view == peer and dimensions(data) == (s.cols, s.rows):
            return
        async with s.resize_lock:
            s.resizing = True
            self._pause_reader(s)
            try:
                # Drain bytes captured at the previous size before broadcasting a resize.
                # Pausing the reader prevents continuous output from starving this barrier.
                await asyncio.wait_for(s.queue.join(), 10)
                self.get(sid)
                async with s.lock:
                    s.viewers[peer] = {"id": peer, "name": name[:80], "active": True}
                    changed = s.active_view != peer
                    s.active_view = peer
                    for key, viewer in s.viewers.items():
                        viewer["active"] = key == peer
                    if "cols" in data and "rows" in data:
                        cols, rows = dimensions(data)
                        if (cols, rows) != (s.cols, s.rows):
                            self.resize(sid, data)
                            changed = True
                    if changed:
                        event = {"type": "terminal.geometry", "id": sid, "cols": s.cols,
                                 "rows": s.rows, "activeView": peer, "viewers": list(s.viewers.values())}
                        for recipient in tuple(s.subscribers):
                            await self._safe_send(recipient, event)
            finally:
                s.resizing = False
                if s.alive:
                    self._resume_reader(s)

    async def add_view(self, peer: str, sid: str, name: str) -> None:
        s = self.get(sid)
        s.viewers[peer] = {"id": peer, "name": name[:80], "active": s.active_view == peer}
        await self.changed()

    def resize(self, sid: str, data: dict) -> None:
        s = self.get(sid)
        cols, rows = dimensions(data)
        s.cols, s.rows = cols, rows
        if s.fd >= 0:
            fcntl.ioctl(s.fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))

    async def rename(self, sid: str, name: str) -> dict:
        s = self.get(sid)
        s.name = str(name).strip()[:80] or s.name
        await self.changed()
        return s.info()

    def detach(self, peer: str) -> None:
        for s in self.items.values():
            s.subscribers.discard(peer)
            s.viewers.pop(peer, None)
            if s.active_view == peer:
                s.active_view = ""

    def has_jobs(self, s: Session) -> bool:
        if s.alive:
            return True
        if s.process is None or s.process.returncode is not None:
            return False
        # The retained leader reserves this session ID. Ignore only exited jobs;
        # a background command must still block an unapproved daemon restart.
        raw = subprocess.check_output(['ps', '-e', '-o', 'pid=,stat='], timeout=5, text=True)
        for row in raw.splitlines():
            pid, state = row.split(None, 1)
            if state.startswith('Z'):
                continue
            try:
                if os.getsid(int(pid)) == s.pid:
                    return True
            except (ProcessLookupError, PermissionError):
                pass
        return False

    async def terminate(self, sid: str) -> None:
        s = self.get(sid)
        if s.tmux:
            proc = await asyncio.create_subprocess_exec("tmux", "kill-session", "-t", "=" + s.tmux,
                                                        stdout=asyncio.subprocess.DEVNULL,
                                                        stderr=asyncio.subprocess.PIPE)
            _, error = await proc.communicate()
            if proc.returncode and b"can't find" not in error and b"no server" not in error:
                raise ValueError("Could not terminate the tmux session")
        elif s.process is not None and s.process.returncode is None:
            # Job control creates several process groups inside this PTY's session.
            # Signal all of those jobs, not only the interactive shell's group.
            proc = await asyncio.create_subprocess_exec("ps", "-e", "-o", "pid=",
                                                        stdout=asyncio.subprocess.PIPE,
                                                        stderr=asyncio.subprocess.DEVNULL)
            raw, _ = await asyncio.wait_for(proc.communicate(), 5)
            if proc.returncode:
                raise ValueError("Could not enumerate this shell's jobs; session was not terminated")
            jobs = []
            try:
                for value in raw.split():
                    pid = int(value)
                    if pid == s.pid and exit_status(s.pid) is not None:
                        continue
                    try:
                        if os.getsid(pid) != s.pid:
                            continue
                    except (ProcessLookupError, PermissionError):
                        continue
                    try:
                        fd = os.pidfd_open(pid) if hasattr(os, "pidfd_open") else None
                        jobs.append((pid, fd))
                    except ProcessLookupError:
                        continue
                for sig, delay in ((signal.SIGHUP, .15), (signal.SIGTERM, .25), (signal.SIGKILL, 0)):
                    for pid, fd in jobs:
                        try:
                            if fd is not None:
                                signal.pidfd_send_signal(fd, sig)
                            elif os.getsid(pid) == s.pid:
                                os.kill(pid, sig)
                        except ProcessLookupError:
                            pass
                    if delay:
                        await asyncio.sleep(delay)
            finally:
                for _, fd in jobs:
                    if fd is not None:
                        os.close(fd)
        await self.close(sid)

    async def close(self, sid: str) -> None:
        s = self.get(sid)

        def running() -> bool:
            # The leader remains waitable, reserving its PID until final cleanup.
            return s.alive and (s.process is None or (s.process.returncode is None and exit_status(s.pid) is None))

        def signal_group(sig: int) -> None:
            if not running():
                return
            try:
                os.killpg(s.pid, sig)
            except ProcessLookupError:
                pass
            except PermissionError:
                # macOS may report EPERM when the child exits between poll and
                # killpg. An actual permission failure for a live child remains fatal.
                if running():
                    raise

        if running():
            if not s.tmux:
                try:
                    foreground = os.tcgetpgrp(s.fd)
                    if foreground > 0 and foreground != s.pid:
                        os.killpg(foreground, signal.SIGHUP)
                except (ProcessLookupError, OSError):
                    pass
            signal_group(signal.SIGHUP)
            await asyncio.sleep(0.15)
            if running():
                signal_group(signal.SIGTERM)
                await asyncio.sleep(0.25)
            signal_group(signal.SIGKILL)
        if s.reaper:
            try:
                await asyncio.wait_for(asyncio.shield(s.reaper), 3)
            except asyncio.TimeoutError:
                s.reaper.cancel()
        self._pause_reader(s)
        if s.fd >= 0:
            os.close(s.fd)
            s.fd = -1
        if s.pump:
            s.pump.cancel()
        if s.process is not None:
            await asyncio.to_thread(s.process.wait, timeout=3)
        self.items.pop(sid, None)
        await self.changed()

    async def shutdown(self) -> None:
        for sid in tuple(self.items):
            if self.items[sid].tmux:
                await self.close(sid)
            else:
                await self.terminate(sid)


def dimensions(data: dict) -> tuple[int, int]:
    return max(10, min(500, int(data.get("cols", 100)))), max(3, min(200, int(data.get("rows", 30))))
