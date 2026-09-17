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
