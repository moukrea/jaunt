"""Claude Code ↔ Codex bridge: cross-runtime awareness and messaging for jaunt shells.

The host is the only authority. Real interactive sessions register themselves
through jaunt-installed hooks that run inside jaunt-owned PTYs; the host verifies
each claim against the PTY it owns before listing a participant. Awareness is
pushed into the models through hook context, messages are delivered into the
actual open conversations through each runtime's own inbox mechanism, and the
whole thing is one per-host switch. Nothing here reads conversations.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import re
import shutil
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path

from .crypto import token

log = logging.getLogger("jaunt")

RUNTIMES = ("claude", "codex")
# Verified on Claude Code 2.1.272 (session registry + peer inbox) and Codex CLI
# 0.154.0 (hooks + queued session messages). Older releases are treated as
# incompatible rather than guessed at.
MINIMUM = {"claude": (2, 1, 230), "codex": (0, 150, 0)}
STALE_AFTER = 6 * 3600
MESSAGE_LIMIT = 12_000
PAIR_RATE = (8, 60)  # at most 8 messages per minute between two participants
MAX_HOPS = 6


def parse_version(text: str) -> tuple | None:
    match = re.search(r"(\d+)\.(\d+)\.(\d+)", text or "")
    return tuple(int(x) for x in match.groups()) if match else None


def probe_in_terminal() -> dict[str, str]:
    """Ask a login + interactive shell on a pseudo-terminal where the runtimes live."""
    import pty, select, termios, tty
    shell = os.environ.get("SHELL") or shutil.which("bash") or "/bin/sh"
    if Path(shell).name == "bash":
        argv = [shell, "-l", "-c", 'exec "$0" -i', shell]
    else:
        argv = [shell, "-i", "-l"]
    sentinel = "__jaunt_probe_" + token(6) + "__"
    command = f" printf '{sentinel}\\n'; for p in claude codex; do printf '%s\\t%s\\n' \"$p\" \"$(command -v \"$p\" 2>/dev/null)\"; done; printf '{sentinel}\\n'; exit\n"
    pid, fd = pty.fork()
    if pid == 0:  # child
        os.environ["TERM"] = "dumb"
        os.execvp(argv[0], argv)
    try:
        with contextlib.suppress(termios.error):
            tty.setraw(fd)  # no echo games: the shell still prints our lines as output
        os.write(fd, command.encode())
        out = b""
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            ready, _, _ = select.select([fd], [], [], 0.5)
            if ready:
                try:
                    chunk = os.read(fd, 65536)
                except OSError:
                    break
                if not chunk:
                    break
                out += chunk
                if out.count(sentinel.encode()) >= 3:  # echo + two markers
                    break
    finally:
        with contextlib.suppress(OSError):
            os.close(fd)
        with contextlib.suppress(OSError, ChildProcessError):
            os.kill(pid, 9)
            os.waitpid(pid, 0)
    text = out.decode(errors="replace")
    parts = text.split(sentinel)
    found: dict[str, str] = {}
    if len(parts) >= 3:
        for line in parts[-2].splitlines():
            name, _, path = line.strip().partition("\t")
            if name in RUNTIMES and path.strip() and os.access(path.strip(), os.X_OK):
                found[name] = path.strip()
    return found


def runtime_name(runtime: str) -> str:
    return {"claude": "Claude Code", "codex": "Codex"}.get(runtime, runtime)


@dataclass
class Participant:
    id: str
    session: str          # jaunt session id (the terminal)
    runtime: str
    conversation: str     # runtime conversation/thread id
    pid: int
    cwd: str
    project: dict         # {"root": ..., "common": ..., "kind": ...}
    name: str = ""        # jaunt terminal name at registration
    state: str = "idle"   # idle | busy | ended
    inbox: dict = field(default_factory=dict)   # runtime delivery details (socket path, key file)
    since: float = field(default_factory=time.time)
    last_seen: float = field(default_factory=time.time)
    roster_seen: int = -1
    bridged: bool = True

    def public(self, terminal_name: str = "") -> dict:
        return {"id": self.id, "session": self.session, "runtime": self.runtime, "conversation": self.conversation[:12],
                "cwd": self.cwd, "project": self.project.get("root", ""), "kind": self.project.get("kind", "dir"),
                "terminal": terminal_name or self.name, "state": self.state, "since": self.since, "lastSeen": self.last_seen}


class Bridge:
    def __init__(self, host):
        self.host = host
        self.participants: dict[str, Participant] = {}
        self.messages: dict[str, dict] = {}
        self.waiters: dict[str, asyncio.Future] = {}
        self.version = 0
        self.detected: dict | None = None
        self.detected_at = -float("inf")
        self.integrations: dict = dict(self.host.state.data.get("bridge", {}).get("integrations", {}))
        self.rates: dict[tuple, list] = {}

    # ---- settings -------------------------------------------------------
    @property
    def enabled(self) -> bool:
        return bool(self.host.state.data.get("bridge", {}).get("enabled"))

    def _store(self, **changes) -> None:
        current = dict(self.host.state.data.get("bridge", {}))
        current.update(changes)
        self.host.state.data["bridge"] = current
        self.host.state.save()

    # ---- runtime detection ------------------------------------------------
    async def refresh_integrations(self) -> None:
        """Detect the runtimes at start and, when the bridge is on, re-apply the integrations
        so hook/MCP commands stay current after a host update."""
        detected = await self.detect(force=True)
        if not self.enabled or not detected.get("available"):
            return
        from . import bridge_setup
        with contextlib.suppress(Exception):
            results = await asyncio.to_thread(bridge_setup.install, detected["runtimes"])
            self.integrations = results
            self._store(integrations=results)

    async def detect(self, force: bool = False) -> dict:
        """Resolve both runtimes in the user's login shell, not the service's minimal PATH."""
        if self.detected is not None and not force and time.monotonic() - self.detected_at < 30:
            return self.detected
        # jaunt shells are login + interactive shells on a real terminal; resolve the
        # runtimes exactly the same way (a user service's PATH is not the user's, and
        # many .bashrc files only set PATH when attached to a terminal), then look in
        # well-known per-user install locations.
        found: dict[str, str] = {}
        try:
            # A separate single-threaded interpreter owns the pseudo-terminal: forking
            # a pty from the multi-threaded daemon itself is not safe.
            import sys
            proc = await asyncio.create_subprocess_exec(sys.executable, "-m", "jaunt.bridge", "--probe",
                                                        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
                                                        stdin=asyncio.subprocess.DEVNULL, start_new_session=True)
            out, _ = await asyncio.wait_for(proc.communicate(), 30)
            data = json.loads(out or b"{}")
            found.update({k: v for k, v in data.items() if k in RUNTIMES and isinstance(v, str)})
        except (OSError, ValueError, asyncio.TimeoutError):
            pass
        home = Path.home()
        fallback = [home / ".local/bin", home / ".npm-global/bin", home / ".bun/bin", home / ".codex/bin", home / ".claude/local",
                    Path("/usr/local/bin"), Path("/opt/homebrew/bin"), Path("/usr/bin")]
        for name in RUNTIMES:
            if name in found:
                continue
            if shutil.which(name):
                found[name] = shutil.which(name)
                continue
            for directory in fallback:
                candidate = directory / name
                if candidate.is_file() and os.access(candidate, os.X_OK):
                    found[name] = str(candidate)
                    break
        runtimes: dict[str, dict] = {}
        for name in RUNTIMES:
            path = found.get(name)
            entry = {"installed": bool(path), "path": path or "", "version": "", "compatible": False}
            if path:
                try:
                    proc = await asyncio.create_subprocess_exec(path, "--version", stdout=asyncio.subprocess.PIPE,
                                                                stderr=asyncio.subprocess.STDOUT, stdin=asyncio.subprocess.DEVNULL)
                    out, _ = await asyncio.wait_for(proc.communicate(), 20)
                    version = parse_version(out.decode(errors="replace"))
                    entry["version"] = ".".join(map(str, version)) if version else ""
                    entry["compatible"] = bool(version and version >= MINIMUM[name])
                except (OSError, asyncio.TimeoutError):
                    pass
            runtimes[name] = entry
        both = all(runtimes[n]["installed"] for n in RUNTIMES)
        compatible = both and all(runtimes[n]["compatible"] for n in RUNTIMES)
        reason = ""
        if both and not compatible:
            bad = [f"{runtime_name(n)} {runtimes[n]['version'] or '?'} (needs {'.'.join(map(str, MINIMUM[n]))} or newer)"
                   for n in RUNTIMES if not runtimes[n]["compatible"]]
            reason = "Incompatible runtime: " + ", ".join(bad)
        self.detected = {"runtimes": runtimes, "visible": both, "available": compatible, "reason": reason, "checkedAt": time.time()}
        self.detected_at = time.monotonic()
        return self.detected

    def status(self) -> dict:
        detected = self.detected or {"runtimes": {}, "visible": False, "available": False, "reason": "", "checkedAt": 0}
        return {"enabled": self.enabled, **detected, "integrations": self.integrations,
                "participants": [self.public(p) for p in self.participants.values() if p.state != "ended"],
                "unbridged": self.unbridged(), "version": self.version}

    def public(self, p: Participant) -> dict:
        session = self.host.sessions.items.get(p.session)
        return p.public(session.name if session else p.name)

    def unbridged(self) -> list[dict]:
        """Claude/Codex programs running in jaunt shells that have not registered.

        Typically sessions opened before the bridge was turned on: they only load
        the integration on their next start. The UI says so instead of pretending.
        """
        registered = {p.session for p in self.participants.values() if p.state != "ended"}
        rows = []
        for s in self.host.sessions.items.values():
            if s.alive and s.program in RUNTIMES and s.id not in registered:
                rows.append({"session": s.id, "terminal": s.name, "runtime": s.program})
        return rows

    # ---- configure --------------------------------------------------------
    async def configure(self, enabled: bool) -> dict:
        if type(enabled) is not bool:
            raise ValueError("Bridge preference must be true or false")
        detected = await self.detect(force=True)
        if enabled and not detected["available"]:
            raise ValueError(detected["reason"] or "Both Claude Code and Codex must be installed on this host")
        from . import bridge_setup
        if enabled:
            results = await asyncio.to_thread(bridge_setup.install, detected["runtimes"])
            self.integrations = results
            complete = all(r.get("ok") for r in results.values())
            self._store(enabled=complete, integrations=results)
            if not complete:
                # Never leave a half-installed integration behind a green switch.
                await asyncio.to_thread(bridge_setup.uninstall, detected["runtimes"])
                self.integrations = {}
                self._store(enabled=False, integrations={})
                failed = "; ".join(f"{runtime_name(n)}: {r.get('error', 'failed')}" for n, r in results.items() if not r.get("ok"))
                raise ValueError(f"Could not prepare the bridge ({failed}). Nothing was left enabled.")
        else:
            results = await asyncio.to_thread(bridge_setup.uninstall, detected["runtimes"])
            self.integrations = {}
            self._store(enabled=False, integrations={})
            self.disable_now()
        await self.changed()
        return self.status()

    def disable_now(self) -> None:
        """Immediate effect of OFF: no more roster, no deliveries, waiting calls unblocked."""
        for message in self.messages.values():
            if message["state"] in ("accepted", "delivering"):
                message["state"] = "cancelled"
                message["detail"] = "bridge disabled"
        for future in self.waiters.values():
            if not future.done():
                future.set_result({"state": "cancelled", "detail": "bridge disabled"})
        self.participants.clear()
        self.version += 1

    async def changed(self) -> None:
        await self.host.broadcast({"type": "bridge.changed", **self.status()})

    # ---- registration (from hooks inside jaunt PTYs) ---------------------------
    def verify_session(self, session_id: str, runtime: str, pid: int, hook_pid: int = 0) -> "Session":
        if not session_id:
            # Environment stripped by the runtime: recognise the hook by where it runs.
            session_id = self.session_for_pid(hook_pid) or self.session_for_pid(pid)
        session = self.host.sessions.items.get(session_id)
        if session is None or not session.alive:
            raise ValueError("This terminal is not a running jaunt shell")
        # The claim must come from inside this PTY: the runtime process or the hook
        # itself descends from the shell, or sits on the terminal the host owns.
        candidates = [x for x in (pid, hook_pid) if x]
        if candidates and not any(self.session_for_pid(x) == session.id for x in candidates):
            raise ValueError("Runtime process does not belong to this jaunt shell")
        return session

    @staticmethod
    def _parent(pid: int) -> int:
        try:
            with open(f"/proc/{pid}/stat") as stream:
                return int(stream.read().rsplit(")", 1)[1].split()[1])
        except (OSError, IndexError, ValueError):
            pass
        try:  # macOS and other hosts without /proc
            out = subprocess.run(["ps", "-o", "ppid=", "-p", str(pid)], capture_output=True, text=True, timeout=5)
            return int(out.stdout.strip() or 0)
        except (OSError, ValueError, subprocess.SubprocessError):
            return 0

    @classmethod
    def _ancestors(cls, pid: int) -> list[int]:
        chain = []
        while pid > 1 and len(chain) < 64:
            chain.append(pid)
            pid = cls._parent(pid)
        return chain

    @classmethod
    def _descends(cls, pid: int, ancestor: int) -> bool:
        return ancestor in cls._ancestors(pid)

    @staticmethod
    def pts_path(fd: int) -> str:
        """Slave path of a PTY master owned by the host."""
        try:
            return os.ptsname(fd)  # Python 3.13+
        except (AttributeError, OSError):
            pass
        try:
            import fcntl, struct
            number = struct.unpack("I", fcntl.ioctl(fd, 0x80045430, b"\0" * 4))[0]  # TIOCGPTN (Linux)
            return f"/dev/pts/{number}"
        except (OSError, ImportError, struct.error):
            return ""

    @staticmethod
    def tty_of_pid(pid: int) -> str:
        """Controlling terminal of a process, as a device number string or a name."""
        try:
            with open(f"/proc/{pid}/stat") as stream:
                tty_nr = int(stream.read().rsplit(")", 1)[1].split()[4])
            return f"dev:{tty_nr}" if tty_nr else ""
        except (OSError, IndexError, ValueError):
            pass
        try:
            out = subprocess.run(["ps", "-o", "tty=", "-p", str(pid)], capture_output=True, text=True, timeout=5)
            name = out.stdout.strip()
            return "" if name in ("", "?", "??") else name
        except (OSError, subprocess.SubprocessError):
            return ""

    def session_tty(self, s) -> str:
        path = self.pts_path(s.fd) if s.fd >= 0 else ""
        if not path:
            return ""
        try:
            return f"dev:{os.stat(path).st_rdev}"
        except OSError:
            return ""

    def session_for_pid(self, pid: int) -> str:
        """The jaunt terminal this process belongs to, or ''.

        First by process ancestry (the shell is an ancestor), then by controlling
        terminal (the process still sits on the PTY the host owns even when it was
        reparented). Neither depends on environment variables surviving.
        """
        if not pid:
            return ""
        chain = set(self._ancestors(pid))
        live = [s for s in self.host.sessions.items.values() if s.alive]
        for s in live:
            if s.pid in chain:
                return s.id
        tty = self.tty_of_pid(pid)
        if tty:
            for s in live:
                mine = self.session_tty(s)
                if mine and (mine == tty or (not tty.startswith("dev:") and self.pts_path(s.fd).endswith(tty.lstrip("/")))):
                    return s.id
        return ""

    async def register(self, p: dict) -> dict:
        """A hook event from a real session. Returns the context to inject, if any."""
        if not self.enabled:
            return {"enabled": False, "context": ""}
        runtime = p.get("runtime")
        if runtime not in RUNTIMES:
            raise ValueError("Unknown runtime")
        session_id = str(p.get("session", ""))
        conversation = str(p.get("conversation", ""))[:128]
        if not re.fullmatch(r"[A-Za-z0-9_.:-]{6,128}", conversation):
            raise ValueError("Invalid conversation identifier")
        pid = int(p.get("pid") or 0)
        hook_pid = int(p.get("hookPid") or 0)
        try:
            session = self.verify_session(session_id, runtime, pid, hook_pid)
        except ValueError as exc:
            log.info("bridge: %s registration refused (%s) session=%r pid=%s hookPid=%s", runtime, exc, session_id, pid, hook_pid)
            raise
        session_id = session.id
        event = str(p.get("event", ""))
        cwd = str(p.get("cwd") or session.cwd)
        project = p.get("project") if isinstance(p.get("project"), dict) else {}
        project = {"root": str(project.get("root") or cwd), "common": str(project.get("common") or ""),
                   "kind": str(project.get("kind") or "dir")}
        now = time.time()
        existing = self.participants.get(f"{runtime}:{conversation}")
        replaced = [q for q in self.participants.values() if q.session == session_id and q.conversation != conversation and q.state != "ended"]
        for old in replaced:
            # A new conversation in the same terminal supersedes the previous one:
            # messages addressed to the old id must never land in the new one.
            self.end_participant(old, "replaced")
        if event == "end":
            if existing:
                self.end_participant(existing, "ended")
            await self.changed()
            return {"enabled": True, "context": ""}
        if existing is None:
            existing = Participant(id=f"{runtime}:{conversation[:8]}", session=session_id, runtime=runtime, conversation=conversation,
                                   pid=pid, cwd=cwd, project=project, name=session.name)
            self.participants[f"{runtime}:{conversation}"] = existing
            self.version += 1
        else:
            changed = (existing.cwd, existing.project, existing.state) != (cwd, project, "idle" if event in ("stop", "start") else existing.state)
            existing.cwd, existing.project, existing.pid = cwd, project, pid or existing.pid
            if existing.state == "ended":
                existing.state = "idle"; changed = True
            if changed:
                self.version += 1
        existing.inbox = {k: str(v) for k, v in (p.get("inbox") or {}).items() if k in ("socket", "key", "sessionPid")}
        existing.last_seen = now
        existing.state = {"prompt": "busy", "tool": "busy", "stop": "idle", "start": "idle", "compact": "busy"}.get(event, existing.state)
        context = self.context_for(existing, event, str(p.get("source", "")))
        if replaced or existing.roster_seen < 0:
            await self.changed()
        return {"enabled": True, "id": existing.id, "context": context, "peers": [self.public(q) for q in self.relevant(existing)]}

    def end_participant(self, p: Participant, reason: str) -> None:
        p.state = "ended"
        self.version += 1
        for message in self.messages.values():
            if message["to"] == p.id and message["state"] in ("accepted", "delivering"):
                message["state"] = "failed"
                message["detail"] = f"recipient {reason}"
        for message_id, future in list(self.waiters.items()):
            m = self.messages.get(message_id)
            if m and m["to"] == p.id and not future.done():
                future.set_result({"state": "failed", "detail": f"recipient {reason}"})

    def sweep(self) -> bool:
        """Drop participants whose terminal or runtime process is gone; notice runtimes appearing in shells."""
        changed = False
        signature = self.presence_signature()
        if signature != getattr(self, "_presence", None):
            self._presence = signature
            self.version += 1
            changed = True
        for key, p in list(self.participants.items()):
            session = self.host.sessions.items.get(p.session)
            gone = session is None or not session.alive or (p.pid and not self._alive(p.pid))
            if p.state != "ended" and gone:
                self.end_participant(p, "terminated"); changed = True
            if p.state == "ended" and time.time() - p.last_seen > 600:
                del self.participants[key]
        return changed

    @staticmethod
    def _alive(pid: int) -> bool:
        try:
            os.kill(pid, 0)
            return True
        except ProcessLookupError:
            return False
        except PermissionError:
            return True

    # ---- relevance --------------------------------------------------------------
    @staticmethod
    def same_project(a: dict, b: dict) -> str:
        """'' when unrelated, otherwise how the two workspaces relate."""
        ra, rb = a.get("root", ""), b.get("root", "")
        if not ra or not rb:
            return ""
        if ra == rb:
            return "same"
        if a.get("common") and a.get("common") == b.get("common"):
            return "worktree"
        if ra.startswith(rb.rstrip("/") + "/") or rb.startswith(ra.rstrip("/") + "/"):
            return "nested"
        return ""

    def present(self, me: Participant) -> list[dict]:
        """Sessions of the other runtime open in jaunt shells on this project that have
        not registered yet (no prompt so far, hooks not trusted, or still loading)."""
        registered = {q.session for q in self.participants.values() if q.state != "ended"}
        rows = []
        for s in self.host.sessions.items.values():
            if not s.alive or s.program not in RUNTIMES or s.program == me.runtime or s.id in registered or s.id == me.session:
                continue
            here = {"root": os.path.realpath(s.cwd), "common": "", "kind": "dir"}
            if self.same_project(me.project, here):
                rows.append({"session": s.id, "terminal": s.name, "runtime": s.program, "cwd": s.cwd})
        return rows

    def presence_signature(self) -> tuple:
        return tuple(sorted((s.id, s.program) for s in self.host.sessions.items.values() if s.alive and s.program in RUNTIMES))

    def relevant(self, me: Participant) -> list[Participant]:
        return [q for q in self.participants.values()
                if q is not me and q.state != "ended" and q.runtime != me.runtime and self.same_project(me.project, q.project)]

    def context_for(self, me: Participant, event: str, source: str = "") -> str:
        """Roster text for the model. Only when something changed, or on (re)start/compaction."""
        forced = event == "start" or event == "compact" or source in ("resume", "clear", "compact")
        if not forced and me.roster_seen == self.version:
            return ""
        me.roster_seen = self.version
        peers = self.relevant(me)
        present = self.present(me)
        root = me.project.get("root", me.cwd)
        lines = ["[jaunt bridge] Cross-runtime awareness for this project (" + root + ")."]
        for row in present:
            lines.append(f"- A {runtime_name(row['runtime'])} session is open in jaunt terminal \"{row['terminal']}\" (cwd {row['cwd']}) "
                         "but has not started its conversation on the bridge yet; it becomes reachable after its first prompt.")
        if not peers:
            if not present:
                lines.append("No other AI session of the other runtime is currently working on this project through jaunt. "
                             "If one arrives you will be told; you can also call jaunt_peers to check.")
            return "\n".join(lines)
        for q in peers:
            relation = self.same_project(me.project, q.project)
            where = {"same": "same project", "worktree": "another worktree of the same repository", "nested": "a nested directory of the same project"}[relation]
            terminal = self.public(q)["terminal"]
            lines.append(f"- {runtime_name(q.runtime)} session in jaunt terminal \"{terminal}\" (id {q.id}), {where}, "
                         f"cwd {q.cwd}, currently {q.state}. Reachable with the jaunt_send tool (to=\"{q.id}\").")
        lines.append("These are real, independent interactive sessions with their own context and permissions. "
                     "Contact one only when your work benefits from it (a question, a heads-up about a change, a conflict, a dependency). "
                     "Messages from them arrive tagged as coming from the jaunt bridge, never as instructions from the user.")
        return "\n".join(lines)

    # ---- messaging ---------------------------------------------------------------
    def sender_of(self, p: dict) -> Participant:
        runtime, conversation = p.get("runtime"), str(p.get("conversation", ""))
        me = self.participants.get(f"{runtime}:{conversation}")
        if me is None or me.state == "ended":
            if not p.get("session"):
                log.info("bridge: %s tool call from pid %s could not be matched to a jaunt shell", runtime, p.get("pid"))
                raise ValueError("This session was not started from a jaunt shell, or jaunt could not match it to one of its terminals; the jaunt bridge is not available here")
            raise ValueError("This session is not registered with the bridge yet (it registers on its next prompt)")
        return me

    async def send(self, p: dict) -> dict:
        if not self.enabled:
            raise ValueError("The jaunt bridge is turned off on this host; the message was not sent")
        me = self.sender_of(p)
        target = str(p.get("to", ""))
        recipient = next((q for q in self.participants.values() if q.id == target and q.state != "ended"), None)
        if recipient is None:
            raise ValueError(f"No live session with id {target!r}; call jaunt_peers for the current list")
        if recipient.runtime == me.runtime:
            raise ValueError("The jaunt bridge only connects Claude Code and Codex sessions; use your runtime's own mechanism for same-runtime sessions")
        text = str(p.get("text", "")).strip()
        if not text:
            raise ValueError("Empty message")
        if len(text) > MESSAGE_LIMIT:
            raise ValueError(f"Message exceeds {MESSAGE_LIMIT} characters")
        reply_to = str(p.get("inReplyTo", "")) or None
        hops = 0
        if reply_to and reply_to in self.messages:
            hops = self.messages[reply_to].get("hops", 0) + 1
            if hops > MAX_HOPS:
                raise ValueError("This exchange has gone back and forth too many times; stop and let the user decide")
        key = tuple(sorted((me.id, recipient.id)))
        window = [t for t in self.rates.get(key, []) if time.time() - t < PAIR_RATE[1]]
        if len(window) >= PAIR_RATE[0]:
            raise ValueError("Too many messages between these two sessions in the last minute; wait before sending more")
        window.append(time.time()); self.rates[key] = window
        message = {"id": "m-" + token(6), "from": me.id, "to": recipient.id, "text": text, "inReplyTo": reply_to,
                   "hops": hops, "state": "accepted", "detail": "", "at": time.time()}
        self.messages[message["id"]] = message
        if len(self.messages) > 500:
            for old in sorted(self.messages.values(), key=lambda m: m["at"])[:100]:
                self.messages.pop(old["id"], None)
        await self.host.broadcast({"type": "bridge.message", **self.message_public(message)})
        message["state"] = "delivering"
        try:
            from . import bridge_deliver
            await bridge_deliver.deliver(self, me, recipient, message)
            message["state"] = "delivered"
        except Exception as exc:
            message["state"] = "failed"
            message["detail"] = str(exc)[:200]
            await self.host.broadcast({"type": "bridge.message", **self.message_public(message)})
            raise ValueError(f"Could not deliver to {recipient.id}: {message['detail']}") from None
        await self.host.broadcast({"type": "bridge.message", **self.message_public(message)})
        if reply_to and reply_to in self.waiters and not self.waiters[reply_to].done():
            self.waiters[reply_to].set_result({"state": "replied", "reply": self.message_public(message)})
        return self.message_public(message)

    def message_public(self, m: dict) -> dict:
        return {"id": m["id"], "from": m["from"], "to": m["to"], "state": m["state"], "detail": m["detail"],
                "inReplyTo": m["inReplyTo"], "at": m["at"], "preview": m["text"][:140], "text": m["text"]}

    async def wait_reply(self, p: dict) -> dict:
        """Block (bounded) until a message replying to `id` arrives, the recipient ends, or the bridge is turned off."""
        me = self.sender_of(p)
        message_id = str(p.get("id", ""))
        message = self.messages.get(message_id)
        if message is None or message["from"] != me.id:
            raise ValueError("Unknown message")
        already = next((m for m in self.messages.values() if m["inReplyTo"] == message_id), None)
        if already:
            return {"state": "replied", "reply": self.message_public(already)}
        if message["state"] in ("failed", "cancelled"):
            return {"state": message["state"], "detail": message["detail"]}
        seconds = min(max(int(p.get("seconds") or 60), 1), 600)
        future = self.waiters.get(message_id)
        if future is None or future.done():
            future = asyncio.get_running_loop().create_future()
            self.waiters[message_id] = future
        try:
            return await asyncio.wait_for(asyncio.shield(future), seconds)
        except asyncio.TimeoutError:
            return {"state": "pending", "detail": f"no reply within {seconds}s; it will arrive as a bridge message when the other session answers"}
        finally:
            if future.done():
                self.waiters.pop(message_id, None)

    def resolve(self, p: dict) -> dict:
        """MCP tool calls identify their terminal by env or by process ancestry; map it to the live conversation registered by hooks."""
        if not p.get("session"):
            found = self.session_for_pid(int(p.get("pid") or 0))
            if found:
                p = {**p, "session": found}
        if p.get("conversation") in ("", "current", None):
            session_id = str(p.get("session", ""))
            live = [q for q in self.participants.values() if q.session == session_id and q.runtime == p.get("runtime") and q.state != "ended"]
            if live:
                p = {**p, "conversation": max(live, key=lambda q: q.last_seen).conversation}
        return p

    def peers_for(self, p: dict) -> dict:
        if not self.enabled:
            return {"enabled": False, "peers": [], "note": "The jaunt bridge is turned off on this host"}
        me = self.sender_of(p)
        return {"enabled": True, "me": self.public(me), "peers": [self.public(q) for q in self.relevant(me)], "present": self.present(me)}


if __name__ == "__main__":
    import sys
    if sys.argv[1:] == ["--probe"]:
        print(json.dumps(probe_in_terminal()))
