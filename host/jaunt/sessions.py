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

from .crypto import b64, token

Send = Callable[[str, dict], Awaitable[None]]
MAX_REPLAY = 2 * 1024 * 1024


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
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    queue: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(128))
    reading: bool = False
    pump: asyncio.Task | None = None
    reaper: asyncio.Task | None = None

    def info(self) -> dict:
        return {"id": self.id, "name": self.name, "cwd": self.cwd, "pid": self.pid,
                "cols": self.cols, "rows": self.rows, "alive": self.alive,
                "exitCode": self.exit_code, "created": self.created, "tmux": self.tmux}


class Sessions:
    def __init__(self, send: Send, changed: Callable[[], Awaitable[None]], root: Path):
        self.send, self.changed, self.root = send, changed, root
        self.items: dict[str, Session] = {}
        self.accepting = True
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
            # An existing tmux is never killed by closing its Jaunt view.
            if data.get("tmuxCreate"):
                if not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", tmux):
                    raise ValueError("New tmux names must contain letters, digits, underscores or hyphens")
                command = ["tmux", "new-session", "-A", "-s", tmux]
            else:
                command = ["tmux", "attach-session", "-t", "=" + tmux]
        fd, slave = pty.openpty()
        env = {**os.environ, "TERM": "xterm-256color", "COLORTERM": "truecolor",
               "JAUNT_SESSION_ID": sid, "JAUNT_STATE": str(self.root)}
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
        if s.fd >= 0 and not s.reading:
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
            if s.alive:
                self._resume_reader(s)
            async with s.lock:
                start = s.offset
                s.offset += len(chunk)
                s.ring.append((start, chunk))
                s.ring_bytes += len(chunk)
                while s.ring_bytes > MAX_REPLAY and len(s.ring) > 1:
                    _, old = s.ring.popleft()
                    s.ring_bytes -= len(old)
                event = {"type": "terminal.output", "id": s.id, "offset": start, "data": b64(chunk)}
                for peer in tuple(s.subscribers):
                    await self._safe_send(peer, event)
            s.queue.task_done()

    async def _reap(self, s: Session) -> None:
        while s.alive:
            code = s.process.poll() if s.process else None
            if code is not None:
                s.exit_code = code
                break
            await asyncio.sleep(0.1)
        s.alive = False
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
                                            "cols": s.cols, "rows": s.rows})
            for offset, chunk in s.ring:
                end = offset + len(chunk)
                if end > after:
                    begin = max(after, offset)
                    await self._safe_send(peer, {"type": "terminal.output", "id": s.id,
                                                "offset": begin, "data": b64(chunk[begin - offset:])})
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

    async def close(self, sid: str) -> None:
        s = self.get(sid)
        if s.alive:
            if not s.tmux:
                try:
                    foreground = os.tcgetpgrp(s.fd)
                    if foreground > 0 and foreground != s.pid:
                        os.killpg(foreground, signal.SIGHUP)
                except (ProcessLookupError, OSError):
                    pass
            try:
                os.killpg(s.pid, signal.SIGHUP)
            except ProcessLookupError:
                pass
            await asyncio.sleep(0.15)
            if s.alive:
                try:
                    os.killpg(s.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                await asyncio.sleep(0.25)
            if s.alive:
                try:
                    os.killpg(s.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
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
        self.items.pop(sid, None)
        await self.changed()

    async def shutdown(self) -> None:
        for sid in tuple(self.items):
            await self.close(sid)


def dimensions(data: dict) -> tuple[int, int]:
    return max(10, min(500, int(data.get("cols", 100)))), max(3, min(200, int(data.get("rows", 30))))
