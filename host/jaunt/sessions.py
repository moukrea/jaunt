"""Real POSIX PTYs. Closing a network connection never closes a shell."""
from __future__ import annotations

import pwd
import asyncio
import errno
import fcntl
import os
import pty
import re
import shutil
import shlex
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
from .scrollback import Scrollback, purge as purge_scrollback, MAX_BYTES as SCROLLBACK_BYTES
from .crypto import b64, token

Send = Callable[[str, dict], Awaitable[None]]
MAX_REPLAY = 2 * 1024 * 1024
# Flow control per viewer: at most WINDOW bytes of output in flight (sent but not acknowledged)
# per peer; a viewer that falls further behind stops receiving the live stream and catches up
# from its acknowledgement with at most CATCHUP bytes (older output is skipped after a reset:
# full-screen programs redraw, and a phone never needs megabytes of stale spinner frames).
WINDOW = 512 * 1024        # ceiling: ~300 ms of full-rate relay output, a WAN viewer keeps up
WINDOW_START = 128 * 1024  # a new viewer starts here and doubles while it keeps up (slow-start)
MIN_WINDOW = 32 * 1024     # a viewer that falls behind (slow link or slow parser) restarts from small, fresh slices
CATCHUP = 128 * 1024  # several full-screen redraws; a phone should not wait for more before it can act
# PTY reads are coalesced for up to COALESCE seconds (or 64 KiB) before becoming one relay
# frame per viewer: chatty TUIs write dozens of times per second and the relay caps frames.
COALESCE = 0.03
COALESCE_BYTES = 64 * 1024
# A relay frame carries at most 131000 bytes once the output is base64-encoded, wrapped in JSON,
# sealed and base64-encoded again: 48 KiB of raw output per frame keeps every frame well under it.
FRAME_BYTES = 48 * 1024


@dataclass
class Viewer:
    sent: int = 0      # stream offset up to which this peer has been sent output
    acked: int = 0     # stream offset the peer has confirmed it rendered
    behind: bool = False
    window: int = WINDOW_START  # bytes allowed in flight; collapses when the viewer falls behind, regrows while it keeps up
    streak: int = 0        # acknowledgements in a row without falling behind


class AttentionParser:
    """Recognize BEL and terminal notification OSCs across arbitrary read chunks.

    OSC title/clipboard payloads are never treated as notifications or exposed.
    """
    def __init__(self):
        self.state, self.payload = 'text', bytearray()
        self.messages = []
        self.overflow = False

    def feed(self, data: bytes) -> set[str]:
        events = set()
        self.messages = []
        for byte in data:
            if self.state == 'text':
                if byte == 7:
                    events.add('bell')
                elif byte == 27:
                    self.state = 'escape'
            elif self.state == 'escape':
                self.state = 'osc' if byte == 93 else 'text'
                self.payload.clear()
                self.overflow = False
            elif self.state in ('osc', 'osc-escape'):
                if byte == 7 or (self.state == 'osc-escape' and byte == 92):
                    if not self.overflow and self.payload.startswith((b'9;', b'777;notify;')):
                        text = self.payload.decode('utf-8', errors='replace')
                        if text.startswith('777;notify;'):
                            parts = text.split(';', 3)
                            title, body = parts[2], parts[3] if len(parts) > 3 else ''
                        else:
                            title, body = '', text[2:]
                        clean = lambda value: ''.join(c for c in value if c >= ' ' or c == '\n')
                        self.messages.append((clean(title)[:100], clean(body)[:400]))
                        events.add('program')
                    self.state = 'text'
                    self.payload.clear()
                elif byte == 27:
                    self.state = 'osc-escape'
                else:
                    self.state = 'osc'
                    if len(self.payload) < 4096:
                        self.payload.append(byte)
                    else:
                        self.overflow = True
        return events


def classify_program(command: str) -> str:
    """Recognize executable names and Node entry points, never arbitrary arguments."""
    try:
        args = shlex.split(command)
    except ValueError:
        return ""
    if not args:
        return ""
    executable = Path(args[0]).name
    if executable in {"claude", "codex"}:
        return executable
    if executable in {"node", "nodejs", "bun"}:
        entry = next((arg for arg in args[1:] if not arg.startswith("-")), "")
        name = Path(entry).name
        if name in {"claude", "claude.js", "codex", "codex.js"}:
            return name.removesuffix(".js")
        if name == "cli.js" and "@anthropic-ai/claude-code/" in entry:
            return "claude"
    return ""


@dataclass
class Session:
    id: str
    name: str
    cwd: str
    pid: int
    fd: int
    cols: int
    rows: int
    program: str = ""
    tmux: str = ""
    process: subprocess.Popen | None = None
    created: float = field(default_factory=time.time)
    alive: bool = True
    exit_code: int | None = None
    agents: dict = field(default_factory=dict)  # requester key -> {name, since}: AI sessions allowed to type here
    offset: int = 0
    ring: deque = field(default_factory=deque)
    ring_bytes: int = 0
    subscribers: dict = field(default_factory=dict)  # peer -> Viewer (flow control)
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
    history: Scrollback | None = None  # on-disk scrollback (None when disabled)

    def retained(self) -> int:
        """Earliest stream offset still available (on disk, else in the replay ring)."""
        ring_start = self.ring[0][0] if self.ring else self.offset
        if self.history is not None and self.history.start is not None:
            return min(self.history.start, ring_start)
        return ring_start

    def info(self) -> dict:
        return {"id": self.id, "name": self.name, "cwd": self.cwd, "pid": self.pid,
                "cols": self.cols, "rows": self.rows, "alive": self.alive,
                "exitCode": self.exit_code, "created": self.created, "tmux": self.tmux,
                "program": self.program, "viewers": list(self.viewers.values()), "activeView": self.active_view,
                "agents": list(self.agents.values()),
                "offset": self.offset, "retained": self.retained(),
                "flow": {peer: {"lag": self.offset - v.acked, "inflight": v.sent - v.acked, "window": v.window, "behind": v.behind}
                         for peer, v in self.subscribers.items()}}


class Sessions:
    def __init__(self, send: Send, changed: Callable[[], Awaitable[None]], root: Path, attention=None):
        self.send, self.changed, self.root = send, changed, root
        self.items: dict[str, Session] = {}
        self.accepting = True
        self.attention = attention or (lambda *_: None)
        self.peer_window: dict[str, int] = {}
        self.disk_history = True  # host setting: keep terminal history on disk (scrollback/)
        self.loop = asyncio.get_running_loop()

    def list(self) -> list[dict]:
        return [s.info() for s in self.items.values()]

    async def refresh_programs(self) -> None:
        """Read only owned PTY foreground leaders; never publish command arguments."""
        changed = False
        for session in tuple(self.items.values()):
            program = ""
            if session.alive and session.fd >= 0 and not session.tmux:
                try:
                    foreground = os.tcgetpgrp(session.fd)
                    if foreground > 0:
                        proc = await asyncio.create_subprocess_exec(
                            "ps", "-p", str(foreground), "-o", "args=",
                            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
                        try:
                            output, _ = await asyncio.wait_for(proc.communicate(), 1)
                        except (TimeoutError, asyncio.CancelledError):
                            if proc.returncode is None:
                                proc.kill()
                            await proc.wait()
                            raise
                        # Recheck ownership: the command may have exited during ps.
                        if os.tcgetpgrp(session.fd) == foreground:
                            program = classify_program(output.decode(errors="replace"))
                except (OSError, ValueError, TimeoutError):
                    pass
            if session.program != program:
                session.program = program
                changed = True
        if changed:
            await self.changed()

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

    async def directory(self, sid: str) -> str:
        session = self.get(sid)
        if session.alive:
            try:
                if sys.platform.startswith("linux"):
                    return str(Path(f"/proc/{session.pid}/cwd").resolve(strict=True))
                if sys.platform == "darwin":
                    proc = await asyncio.create_subprocess_exec(
                        "/usr/sbin/lsof", "-a", "-p", str(session.pid), "-d", "cwd", "-Fn",
                        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
                    try:
                        out, _ = await asyncio.wait_for(proc.communicate(), 2)
                    except asyncio.TimeoutError:
                        proc.kill()
                        await proc.communicate()
                        return session.cwd
                    for line in out.decode(errors="replace").splitlines():
                        if line.startswith("n/"):
                            return line[1:]
            except OSError:
                pass
        return session.cwd

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
        source = data.get("sourceSession")
        inherited = await self.directory(source) if source and not data.get("cwd") else None
        cwd = Path(data.get("cwd") or inherited or Path.home()).expanduser().resolve(strict=True)
        if not cwd.is_dir():
            raise ValueError("Working directory is not a directory")
        name = str(data.get("name") or "").strip()[:80]
        cols, rows = dimensions(data)
        tmux = str(data.get("tmux") or "")
        shell = os.environ.get("SHELL") or pwd.getpwuid(os.getuid()).pw_shell or "/bin/sh"
        if not os.path.isfile(shell):
            shell = "/bin/sh"
        if not name:
            stem = Path(shell).name
            number = 1
            used = {s.name for s in self.items.values()}
            while f"{stem} {number}" in used:
                number += 1
            name = f"{stem} {number}"
        # Bash login profiles may omit .bashrc entirely. Load the login environment,
        # then start the same interactive shell, just as a desktop terminal does.
        # Never source account startup files inside the daemon itself.
        command = ([shell, "-l", "-c", 'exec "$0" -i', shell]
                   if Path(shell).name == "bash" else [shell, "-i", "-l"])
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
        from .clipboard import Clipboard
        display = {k: v for k, v in Clipboard.display_env().items() if k in ("DISPLAY", "WAYLAND_DISPLAY", "XAUTHORITY")}
        # A host started by systemd has no display variables; programs in jaunt shells (Claude Code's
        # own clipboard read, GUI tools) need them just like in a desktop terminal.
        env = {**display, **os.environ, "TERM": "xterm-256color", "COLORTERM": "truecolor",
               "SHELL": shell, "jaunt_SESSION_ID": sid, "jaunt_STATE": str(self.root)}
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
        self.open_history(s)
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

    def _feed_attention(self, s: Session, chunk: bytes) -> None:
        # Notifications are detected on every byte the program writes, whether or not
        # any viewer currently receives the stream.
        for event in s.attention.feed(chunk):
            if event == 'program':
                for title, body in s.attention.messages:
                    self.attention(s, event, title, body)
            else:
                self.attention(s, event)

    async def _gather(self, s: Session) -> bytes:
        """One PTY read, plus whatever follows within COALESCE seconds when the program is
        redrawing (a lone keystroke echo is not delayed)."""
        chunk = await s.queue.get()
        s.queue.task_done()
        self._feed_attention(s, chunk)
        if s.alive:
            self._resume_reader(s)
        if len(chunk) < 512 and s.queue.empty():
            return chunk
        parts, total = [chunk], len(chunk)
        deadline = self.loop.time() + COALESCE
        while total < COALESCE_BYTES:
            remaining = deadline - self.loop.time()
            if remaining <= 0 and s.queue.empty():
                break
            try:
                more = await asyncio.wait_for(s.queue.get(), max(0.0, remaining))
            except asyncio.TimeoutError:
                break
            s.queue.task_done()
            self._feed_attention(s, more)
            if s.alive:
                self._resume_reader(s)
            parts.append(more)
            total += len(more)
        return b"".join(parts)

    def open_history(self, s: Session) -> None:
        if self.disk_history and s.history is None:
            try:
                s.history = Scrollback(self.root, s.id)
            except OSError:
                s.history = None

    def configure_history(self, disk: bool) -> None:
        """Turn on-disk history on or off for every session; off deletes what was written."""
        self.disk_history = bool(disk)
        for s in self.items.values():
            if self.disk_history:
                self.open_history(s)
            elif s.history is not None:
                s.history.delete(); s.history = None
        if not self.disk_history:
            purge_scrollback(self.root, set())

    async def history(self, sid: str, before, limit) -> dict:
        """Older output ending at `before`, for lazy scrollback: from disk when kept, else from the ring."""
        s = self.get(sid)
        if type(before) is not int or before < 0 or type(limit) is not int or limit <= 0:
            raise ValueError("Invalid history range")
        # One reply must fit a relay frame once base64-encoded, JSON-wrapped and sealed.
        limit = min(limit, 64 * 1024)
        before = min(before, s.offset)
        async with s.lock:
            if s.history is not None and s.history.start is not None and s.history.start <= max(s.retained(), before - limit):
                begin, data = await asyncio.to_thread(s.history.read, before, limit)
                if begin <= before - min(limit, before - s.history.start):
                    return {"offset": begin, "data": b64(data), "retained": s.retained()}
            start = s.ring[0][0] if s.ring else s.offset
            begin = max(start, before - limit)
            out = bytearray()
            for offset, chunk, _, _ in s.ring:
                end = offset + len(chunk)
                lo, hi = max(begin, offset), min(before, end)
                if lo < hi:
                    out += chunk[lo - offset:hi - offset]
            return {"offset": begin, "data": b64(bytes(out)), "retained": s.retained()}

    def _viewer(self, peer: str, offset: int) -> Viewer:
        # The link and device speed belong to the peer, not to one session: a viewer that had to be
        # slowed down on one tab starts every other tab with that same, proven window.
        return Viewer(sent=offset, acked=offset, window=self.peer_window.get(peer, WINDOW_START))

    async def _pump(self, s: Session) -> None:
        while True:
            chunk = await self._gather(s)
            async with s.lock:
                start = s.offset
                s.offset += len(chunk)
                s.ring.append((start, chunk, s.cols, s.rows))
                s.ring_bytes += len(chunk)
                if s.history is not None:
                    try:
                        s.history.append(start, chunk)
                    except OSError:
                        s.history.close(); s.history = None  # disk trouble never stalls the stream
                while s.ring_bytes > MAX_REPLAY and len(s.ring) > 1:
                    _, old, _, _ = s.ring.popleft()
                    s.ring_bytes -= len(old)
                frames = [(start + i, chunk[i:i + FRAME_BYTES]) for i in range(0, len(chunk), FRAME_BYTES)]
                for peer, viewer in tuple(s.subscribers.items()):
                    if viewer.behind or viewer.sent != start:
                        viewer.behind = True
                        continue
                    if s.offset - viewer.acked > viewer.window:
                        # Too much unconfirmed output for this peer: stop streaming to it and
                        # let its next acknowledgement drive a bounded catch-up, with a smaller window.
                        viewer.behind = True
                        viewer.window = MIN_WINDOW
                        self.peer_window[peer] = viewer.window
                        viewer.streak = 0
                        continue
                    viewer.sent = s.offset
                    for offset, part in frames:
                        await self._safe_send(peer, {"type": "terminal.output", "id": s.id, "offset": offset, "data": b64(part)})

    async def ack(self, peer: str, sid: str, offset: int) -> None:
        """A viewer confirmed it rendered the stream up to `offset`."""
        s = self.items.get(sid)
        if s is None or peer not in s.subscribers or type(offset) is not int:
            return
        viewer = s.subscribers[peer]
        viewer.acked = max(viewer.acked, min(offset, s.offset))
        if not viewer.behind:
            viewer.streak += 1
            if viewer.streak >= 8 and viewer.window < WINDOW:
                viewer.window = min(WINDOW, viewer.window * 2)
                self.peer_window[peer] = viewer.window
                viewer.streak = 0
            return
        async with s.lock:
            viewer = s.subscribers.get(peer)
            if viewer is None:
                return
            if viewer.sent - viewer.acked > viewer.window // 2:
                return  # still digesting what it was sent; wait for a later acknowledgement
            # Catch up with the freshest slice only: what this viewer can render before the next one.
            await self._send_from(peer, s, viewer.sent, limit=max(MIN_WINDOW // 2, viewer.window // 2))
            viewer.behind = False

    async def _send_from(self, peer: str, s: Session, after: int, limit: int = CATCHUP) -> None:
        """Send the stream from `after` to the head, at most `limit` bytes (older output is
        skipped after a reset). Caller holds s.lock. Marks the viewer as sent to the head."""
        start = s.ring[0][0] if s.ring else s.offset
        floor = max(start, s.offset - limit)
        if after < floor:
            after = floor
            await self._safe_send(peer, {"type": "terminal.reset", "id": s.id,
                                        "offset": after, "trimmed": True,
                                        "cols": s.cols, "rows": s.rows})
        viewer = s.subscribers.get(peer)
        if viewer is not None:
            # Skipped bytes were never sent: only what follows `after` counts as in flight.
            viewer.acked = max(viewer.acked, after)
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
                for at in range(begin, end, FRAME_BYTES):
                    await self._safe_send(peer, {"type": "terminal.output", "id": s.id,
                                                "offset": at, "data": b64(chunk[at - offset:min(end, at + FRAME_BYTES) - offset])})
        viewer = s.subscribers.get(peer)
        if viewer is not None:
            viewer.sent = s.offset

    async def _reap(self, s: Session, announce: bool = True) -> None:
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
        if announce:self.attention(s, 'exit')
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
            raise ValueError("No jaunt terminal with this id (it may have ended)")
        return self.items[sid]

    async def attach(self, peer: str, data: dict) -> dict:
        s = self.get(data["id"])
        after = data.get("after")
        if after is not None and (type(after) is not int or after < 0):
            raise ValueError("Invalid replay offset")
        async with s.lock:
            start = s.ring[0][0] if s.ring else s.offset
            if after is None or after > s.offset:
                after = start
            s.subscribers[peer] = self._viewer(peer, after)
            if after < start:
                # Older than the ring (or a fresh view): announce a reset at the point we replay from.
                after = start
                await self._safe_send(peer, {"type": "terminal.reset", "id": s.id,
                                            "offset": start, "trimmed": start > 0,
                                            "cols": s.ring[0][2] if s.ring else s.cols, "rows": s.ring[0][3] if s.ring else s.rows})
            await self._send_from(peer, s, after, limit=min(CATCHUP, s.subscribers[peer].window))
            await self._safe_send(peer, {"type": "terminal.geometry", "id": s.id,
                                        "cols": s.cols, "rows": s.rows, "activeView": s.active_view,
                                        "viewers": list(s.viewers.values())})
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
        self.peer_window.pop(peer, None)
        for s in self.items.values():
            s.subscribers.pop(peer, None)
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
        if s.history is not None:
            s.history.delete()
        else:
            purge_scrollback(self.root, set(self.items) - {sid})
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
