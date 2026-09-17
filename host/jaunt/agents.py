"""Agents and machines: what an AI session may do on a machine, decided by that machine.

Requester = a host × a runtime (Claude Code or Codex). Two independent rights:
  exec  — run a one-shot command or a background agent shell,
  type  — write into (and read) an existing jaunt shell.
Levels: ask (default for an unknown requester), trust (optionally until a time), block.
Every decision, run and refusal is journaled. The messaging bridge between sessions is not
involved: nothing here injects context or messages.
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import shutil
import time
from collections import deque
from pathlib import Path

from .crypto import b64, token

log = logging.getLogger("jaunt")

RIGHTS = ("exec", "type")
LEVELS = ("ask", "trust", "block")
DURATIONS = {"1h": 3600, "24h": 86400, "always": None}
APPROVAL_SECONDS = 120
INLINE_BYTES = 64 * 1024
MAX_TIMEOUT = 600
DEFAULT_TIMEOUT = 60
RUN_RETENTION = 24 * 3600
PER_MINUTE = 20
LOG_ROWS = 200


def requester_key(host: str, runtime: str) -> str:
    return f"{host}:{runtime}"


class Policy:
    """Per-requester rights, persisted in the host state under `agents`."""

    def __init__(self, state):
        self.state = state
        self.data = state.data.setdefault("agents", {"enabled": False, "requesters": {}, "log": []})
        self.data.setdefault("requesters", {})
        self.data.setdefault("log", [])
        self.grants: dict[tuple[str, str], float] = {}  # (requester, shell id) -> granted at (first-use for right `type`)
        self.cuts: dict[str, float] = {}  # shell id -> cut at: every requester, trusted or not, asks again for it

    @property
    def enabled(self) -> bool:
        return bool(self.data.get("enabled"))

    def save(self) -> None:
        self.state.save()

    def requester(self, key: str, name: str = "", runtime: str = "", host: str = "", local: bool = False) -> dict:
        row = self.data["requesters"].get(key)
        if row is None:
            row = {"name": name or key, "host": host, "runtime": runtime, "local": local, "since": time.time(),
                   "exec": {"level": "ask", "until": None}, "type": {"level": "ask", "until": None}}
            self.data["requesters"][key] = row
            self.save()
        return row

    def level(self, key: str, right: str) -> str:
        """Effective level now: an expired trust falls back to ask."""
        row = self.data["requesters"].get(key)
        if not row:
            return "ask"
        entry = row.get(right) or {}
        level, until = entry.get("level", "ask"), entry.get("until")
        if level == "trust" and until is not None and until < time.time():
            entry["level"], entry["until"] = "ask", None
            self.save()
            return "ask"
        return level if level in LEVELS else "ask"

    def set_level(self, key: str, right: str, level: str, duration: str | None = None) -> dict:
        if right not in RIGHTS or level not in LEVELS:
            raise ValueError("Unknown right or level")
        row = self.data["requesters"].get(key)
        if row is None:
            raise ValueError("Unknown requester")
        until = None
        if level == "trust":
            if duration not in DURATIONS:
                raise ValueError("Trust duration must be 1h, 24h or always")
            until = None if DURATIONS[duration] is None else time.time() + DURATIONS[duration]
        row[right] = {"level": level, "until": until}
        if level != "trust":
            for pair in [g for g in self.grants if g[0] == key]:
                self.grants.pop(pair, None)
        self.save()
        return self.public_row(key)

    # Right `type`: one grant per requester × shell, given at first use in ask mode, gone with the shell,
    # the requester's trust, or the owner's "cut" on that shell.
    def grant(self, key: str, sid: str) -> None:
        self.grants[(key, sid)] = time.time()
        self.cuts.pop(sid, None)

    def granted(self, key: str, sid: str) -> bool:
        return (key, sid) in self.grants

    def allowed_shell(self, key: str, sid: str) -> str:
        """`ask`, `trust` (no prompt) or `block` for this requester on this shell now."""
        level = self.level(key, "type")
        if level == "block":
            return "block"
        if self.granted(key, sid):
            return "trust"
        if level == "trust" and sid not in self.cuts:
            return "trust"
        return "ask"

    def cut(self, sid: str) -> list[str]:
        gone = [g for g in self.grants if g[1] == sid]
        for pair in gone:
            self.grants.pop(pair, None)
        self.cuts[sid] = time.time()
        return sorted({g[0] for g in gone})

    def forget_session(self, sid: str) -> None:
        for pair in [g for g in self.grants if g[1] == sid]:
            self.grants.pop(pair, None)
        self.cuts.pop(sid, None)

    def revoke(self, keys: list[str]) -> None:
        for key in keys:
            self.data["requesters"].pop(key, None)
            for pair in [g for g in self.grants if g[0] == key]:
                self.grants.pop(pair, None)
        self.save()

    def public_row(self, key: str) -> dict:
        row = self.data["requesters"][key]
        out = {"id": key, "name": row.get("name", key), "host": row.get("host", ""), "runtime": row.get("runtime", ""),
               "local": bool(row.get("local")), "since": row.get("since")}
        for right in RIGHTS:
            level = self.level(key, right)
            out[right] = {"level": level, "until": (row.get(right) or {}).get("until") if level == "trust" else None}
        return out

    def table(self) -> list[dict]:
        return [self.public_row(k) for k in list(self.data["requesters"])]

    def journal(self, **entry) -> dict:
        entry = {"at": time.time(), "id": token(6), **entry}
        rows = self.data["log"]
        rows.append(entry)
        del rows[:-LOG_ROWS]
        self.save()
        return entry


class Approvals:
    """Pending questions to the user, answered from any client or the CLI; first answer wins."""

    def __init__(self, host):
        self.host = host
        self.pending: dict[str, dict] = {}

    def public(self, item: dict) -> dict:
        return {k: v for k, v in item.items() if k != "future"}

    def list(self) -> list[dict]:
        now = time.time()
        return [self.public(i) for i in self.pending.values() if i["expires"] > now]

    async def ask(self, requester: dict, right: str, kind: str, detail: dict) -> str:
        """Returns the decision: once, 1h, 24h, always, deny (deny after the timeout)."""
        approval_id = token(9)
        future = asyncio.get_running_loop().create_future()
        item = {"id": approval_id, "requester": requester, "right": right, "kind": kind, "detail": detail,
                "created": time.time(), "expires": time.time() + APPROVAL_SECONDS, "future": future}
        self.pending[approval_id] = item
        try:
            await self.host.broadcast({"type": "agent.approval", **self.public(item)})
            with contextlib.suppress(Exception):
                await self.host.notify("Agent command on " + self.host.state.data["name"],
                                       f'{requester.get("name", "?")} asks: {detail.get("summary", kind)}', "")
            try:
                return await asyncio.wait_for(future, APPROVAL_SECONDS)
            except asyncio.TimeoutError:
                return "deny"
        finally:
            self.pending.pop(approval_id, None)
            with contextlib.suppress(Exception):
                await self.host.broadcast({"type": "agent.approval.closed", "id": approval_id})

    def decide(self, approval_id: str, decision: str, by: str = "") -> dict:
        item = self.pending.get(approval_id)
        if not item or item["future"].done():
            raise ValueError("This request was already answered or has expired")
        if decision not in ("once", "1h", "24h", "always", "deny"):
            raise ValueError("Unknown decision")
        item["by"] = by
        item["future"].set_result(decision)
        return {"id": approval_id, "decision": decision}


class Executor:
    """One-shot commands with bounds. Full output is kept on disk for bounded chunked reads."""

    def __init__(self, root: Path, policy: Policy):
        self.root = root
        self.policy = policy
        self.runs_dir = root / "agent-runs"
        self.runs_dir.mkdir(exist_ok=True, mode=0o700)
        self.active: set[str] = set()
        self.recent: dict[str, deque] = {}

    def _rate(self, requester: str) -> None:
        if requester in self.active:
            raise ValueError("One command at a time per requester; wait for the previous one")
        window = self.recent.setdefault(requester, deque())
        now = time.time()
        while window and window[0] < now - 60:
            window.popleft()
        if len(window) >= PER_MINUTE:
            raise ValueError(f"At most {PER_MINUTE} commands per minute per requester")
        window.append(now)

    def sweep(self) -> None:
        cutoff = time.time() - RUN_RETENTION
        for path in self.runs_dir.glob("*.log"):
            with contextlib.suppress(OSError):
                if path.stat().st_mtime < cutoff:
                    path.unlink()

    async def run(self, requester: str, command: str, cwd: str | None, timeout: int | None) -> dict:
        if not isinstance(command, str) or not command.strip() or len(command) > 32 * 1024:
            raise ValueError("Command must be a non-empty string under 32 KiB")
        timeout = DEFAULT_TIMEOUT if timeout is None else max(1, min(int(timeout), MAX_TIMEOUT))
        workdir = Path(cwd).expanduser() if cwd else Path.home()
        if not workdir.is_dir():
            raise ValueError(f"Working directory does not exist: {workdir}")
        self._rate(requester)
        self.active.add(requester)
        run_id = "r_" + token(6)
        log_path = self.runs_dir / f"{run_id}.log"
        # The owner's login shell when it is a shell that takes `-lc`; a custom SHELL wrapper
        # (or nothing usable) falls back to /bin/sh so the command still runs predictably.
        shell = os.environ.get("SHELL") or shutil.which("bash") or "/bin/sh"
        if Path(shell).name not in ("bash", "zsh", "sh", "dash", "ksh", "fish") or not os.access(shell, os.X_OK):
            shell = "/bin/sh"
        from .clipboard import Clipboard
        env = {**Clipboard.display_env(), **os.environ, "jaunt_AGENT_RUN": "1", "jaunt_AGENT_REQUESTER": requester, "TERM": "dumb"}
        started = time.monotonic()
        out, err, total = bytearray(), bytearray(), 0
        status, code = "ok", None
        try:
            with open(log_path, "wb") as sink:
                os.fchmod(sink.fileno(), 0o600)
                proc = await asyncio.create_subprocess_exec(shell, *(["-lc"] if shell != "/bin/sh" else ["-c"]), command, cwd=str(workdir), env=env,
                                                            stdin=asyncio.subprocess.DEVNULL,
                                                            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
                                                            start_new_session=True)

                async def pump(stream, buffer, label):
                    nonlocal total
                    while True:
                        chunk = await stream.read(65536)
                        if not chunk:
                            return
                        total += len(chunk)
                        sink.write(chunk)
                        if len(out) + len(err) < INLINE_BYTES:
                            buffer.extend(chunk[:INLINE_BYTES - len(out) - len(err)])

                pumps = asyncio.gather(pump(proc.stdout, out, "out"), pump(proc.stderr, err, "err"))
                try:
                    await asyncio.wait_for(pumps, timeout)
                    code = await proc.wait()
                except asyncio.TimeoutError:
                    status = "timeout"
                    with contextlib.suppress(ProcessLookupError):
                        os.killpg(proc.pid, 15)
                    try:
                        await asyncio.wait_for(proc.wait(), 5)
                    except asyncio.TimeoutError:
                        with contextlib.suppress(ProcessLookupError):
                            os.killpg(proc.pid, 9)
                        await proc.wait()
                    with contextlib.suppress(Exception, asyncio.CancelledError):
                        await pumps
        finally:
            self.active.discard(requester)
        self.sweep()
        return {"run": run_id, "status": status, "exitCode": code, "durationMs": int((time.monotonic() - started) * 1000),
                "stdout": out.decode("utf-8", "replace"), "stderr": err.decode("utf-8", "replace"),
                "truncated": total > len(out) + len(err), "bytes": total, "output": f"agent-runs/{run_id}.log"}

    def read(self, run_id: str, offset: int = 0, limit: int = INLINE_BYTES) -> dict:
        if not isinstance(run_id, str) or not run_id.startswith("r_") or "/" in run_id or ".." in run_id:
            raise ValueError("Unknown run")
        path = self.runs_dir / f"{run_id}.log"
        if not path.is_file():
            raise ValueError("Unknown run, or its output expired")
        offset = max(0, int(offset)); limit = max(1, min(int(limit), INLINE_BYTES))
        size = path.stat().st_size
        with open(path, "rb") as f:
            f.seek(offset)
            data = f.read(limit)
        return {"run": run_id, "offset": offset, "data": b64(data), "bytes": size, "eof": offset + len(data) >= size}


# ---- background agent shells (phase 2) --------------------------------------------------------
LEASE_SECONDS = int(os.environ.get("jaunt_AGENT_LEASE", "600"))
ORPHAN_GRACE = int(os.environ.get("jaunt_AGENT_ORPHAN_GRACE", "120"))
SHELLS_PER_REQUESTER = 2
SHELLS_PER_HOST = 8


class AgentShell:
    """A PTY that belongs to an agent: never a jaunt session, never visible in the interface,
    alive only while its lease is renewed by the agent that opened it."""

    def __init__(self, shell_id: str, requester: str, requester_name: str, origin: str, cwd: str, pid: int, fd: int, log_path: Path):
        self.id, self.requester, self.requester_name, self.origin = shell_id, requester, requester_name, origin
        self.cwd, self.pid, self.fd, self.log_path = cwd, pid, fd, log_path
        self.created = self.last_used = time.time()
        self.offset = 0
        self.alive = True
        self.orphaned_at: float | None = None

    def info(self) -> dict:
        return {"id": self.id, "requester": self.requester, "requesterName": self.requester_name, "origin": self.origin,
                "cwd": self.cwd, "created": self.created, "lastUsed": self.last_used, "bytes": self.offset,
                "leaseEndsAt": self.last_used + LEASE_SECONDS, "alive": self.alive, "log": f"agent-runs/{self.id}.log"}


class AgentShells:
    def __init__(self, root: Path, journal):
        self.root, self.journal = root, journal
        self.runs_dir = root / "agent-runs"
        self.runs_dir.mkdir(exist_ok=True, mode=0o700)
        self.items: dict[str, AgentShell] = {}
        self.loop = asyncio.get_event_loop()
        self.sweeper: asyncio.Task | None = None

    def start(self) -> None:
        if self.sweeper is None or self.sweeper.done():
            self.sweeper = asyncio.create_task(self._sweep_loop())

    async def _sweep_loop(self) -> None:
        while True:
            await asyncio.sleep(5)
            now = time.time()
            for s in list(self.items.values()):
                if not s.alive:
                    self._remove(s, "exited")
                elif now - s.last_used > LEASE_SECONDS:
                    await self.kill(s.id, "lease expired")
                elif s.orphaned_at is not None and now - s.orphaned_at > ORPHAN_GRACE:
                    await self.kill(s.id, "requesting host disconnected")

    def get(self, shell_id: str, requester: str) -> AgentShell:
        s = self.items.get(shell_id)
        if s is None or s.requester != requester:
            raise ValueError("Unknown agent shell (closed, expired or not yours)")
        return s

    async def open(self, requester: str, requester_name: str, origin: str, cwd: str | None) -> AgentShell:
        mine = [s for s in self.items.values() if s.requester == requester]
        if len(mine) >= SHELLS_PER_REQUESTER:
            raise ValueError(f"At most {SHELLS_PER_REQUESTER} background shells per requester; close one first")
        if len(self.items) >= SHELLS_PER_HOST:
            raise ValueError(f"At most {SHELLS_PER_HOST} agent shells on this host; try again later")
        workdir = Path(cwd).expanduser() if cwd else Path.home()
        if not workdir.is_dir():
            raise ValueError(f"Working directory does not exist: {workdir}")
        import fcntl, pty, struct, subprocess, sys, termios
        shell = os.environ.get("SHELL") or shutil.which("bash") or "/bin/sh"
        if Path(shell).name not in ("bash", "zsh", "sh", "dash", "ksh", "fish") or not os.access(shell, os.X_OK):
            shell = "/bin/sh"
        command = [shell, "-l", "-c", 'exec "$0" -i', shell] if Path(shell).name == "bash" else [shell, "-i", "-l"]
        shell_id = "s_" + token(6)
        fd, slave = pty.openpty()
        from .clipboard import Clipboard
        display = {k: v for k, v in Clipboard.display_env().items() if k in ("DISPLAY", "WAYLAND_DISPLAY", "XAUTHORITY")}
        env = {**display, **os.environ, "TERM": "dumb", "SHELL": shell, "jaunt_AGENT_SHELL": shell_id, "jaunt_AGENT_REQUESTER": requester, "jaunt_STATE": str(self.root)}
        try:
            fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 50, 200, 0, 0))
            process = subprocess.Popen([sys.executable, str(Path(__file__).with_name("pty_exec.py")), *command],
                                       stdin=slave, stdout=slave, stderr=slave, cwd=str(workdir), env=env,
                                       start_new_session=True, close_fds=True)
        except BaseException:
            os.close(fd); raise
        finally:
            os.close(slave)
        os.set_blocking(fd, False)
        s = AgentShell(shell_id, requester, requester_name, origin, str(workdir), process.pid, fd, self.runs_dir / f"{shell_id}.log")
        s.process = process
        s.sink = open(s.log_path, "ab")
        os.fchmod(s.sink.fileno(), 0o600)
        self.items[shell_id] = s
        self.loop.add_reader(fd, self._read, s)
        self.start()
        self.journal(kind="shell", action="open", requester=requester, shell=shell_id, cwd=str(workdir), origin=origin)
        return s

    def _read(self, s: AgentShell) -> None:
        try:
            data = os.read(s.fd, 65536)
        except BlockingIOError:
            return
        except OSError:
            data = b""
        if not data:
            self.loop.remove_reader(s.fd)
            s.alive = False
            return
        s.sink.write(data); s.sink.flush()
        s.offset += len(data)

    def send(self, s: AgentShell, text: str, enter: bool = True) -> dict:
        if not s.alive:
            raise ValueError("This agent shell has exited")
        if len(text) > 8192:
            raise ValueError("At most 8 KiB per send")
        s.last_used = time.time()
        payload = text.encode() + (b"\n" if enter else b"")
        os.write(s.fd, payload)
        return {"shell": s.id, "sent": len(payload), "offset": s.offset}

    def read(self, s: AgentShell, offset: int = 0, limit: int = INLINE_BYTES) -> dict:
        s.last_used = time.time()
        offset = max(0, int(offset)); limit = max(1, min(int(limit), INLINE_BYTES))
        with open(s.log_path, "rb") as f:
            f.seek(offset)
            data = f.read(limit)
        return {"shell": s.id, "offset": offset, "data": b64(data), "bytes": s.offset, "eof": offset + len(data) >= s.offset, "alive": s.alive}

    async def kill(self, shell_id: str, reason: str) -> None:
        s = self.items.get(shell_id)
        if s is None:
            return
        with contextlib.suppress(ProcessLookupError, PermissionError):
            os.killpg(s.pid, 1)  # SIGHUP: the shell and its jobs
        for _ in range(20):
            if s.process.poll() is not None:
                break
            await asyncio.sleep(0.1)
        else:
            with contextlib.suppress(ProcessLookupError, PermissionError):
                os.killpg(s.pid, 9)
        self._remove(s, reason)

    def _remove(self, s: AgentShell, reason: str) -> None:
        if self.items.pop(s.id, None) is None:
            return
        with contextlib.suppress(Exception):
            self.loop.remove_reader(s.fd)
        with contextlib.suppress(OSError):
            os.close(s.fd)
        with contextlib.suppress(Exception):
            s.sink.close()
        with contextlib.suppress(Exception):
            s.process.poll()
        s.alive = False
        self.journal(kind="shell", action="closed", requester=s.requester, shell=s.id, reason=reason)

    async def kill_for(self, requester: str, reason: str) -> None:
        for s in list(self.items.values()):
            if s.requester == requester:
                await self.kill(s.id, reason)

    async def kill_origin(self, host_device: str, origin: str, reason: str) -> None:
        for s in list(self.items.values()):
            if s.requester.startswith(host_device + ":") and s.origin == origin:
                await self.kill(s.id, reason)

    def mark_orphans(self, host_device: str, orphaned: bool) -> None:
        for s in self.items.values():
            if s.requester.startswith(host_device + ":"):
                s.orphaned_at = time.time() if orphaned else None

    async def shutdown(self) -> None:
        for s in list(self.items.values()):
            await self.kill(s.id, "host stopping")

    def list(self) -> list[dict]:
        return [s.info() for s in self.items.values()]
