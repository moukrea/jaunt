from __future__ import annotations

import asyncio
import contextlib
import fcntl
import getpass
import json
import logging
import os
import platform
import base64
import glob
import re
import shlex
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric import ec

from . import __version__
from .agents import AgentShells, Approvals, Executor, Policy, requester_key, DURATIONS, FEATURES, RULE_CHARS

ANSI = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
from .clipboard import Clipboard
from .hostlink import Links
from .crypto import Channel, b64, compact, proof, public_key, token, transcript, unb64, verify
from .files import Files
from .notifications import deliver, validate_subscription
from .sessions import Session, Sessions
from .state import State
from .transport import Transport, relay_url

log = logging.getLogger("jaunt")


class Peer:
    def __init__(self, host: "Host", routing_id: str):
        self.host, self.routing_id = host, routing_id
        self.queue: asyncio.Queue = asyncio.Queue(64)
        self.channel: Channel | None = None
        self.device_id = ""
        self.ready = False
        self.clipboard_read = b""
        self.clipboard_write = bytearray()
        self.lock = asyncio.Lock()
        self.task = asyncio.create_task(self.serve())

    async def plain(self, data: dict) -> None:
        await self.host.transport.route(self.routing_id, data)

    async def send(self, data: dict) -> None:
        async with self.lock:
            if not self.channel:
                raise ConnectionError("No encrypted channel")
            # Never burn a channel counter on a frame the relay would refuse: a sealed frame that is
            # dropped after sealing leaves the client with an unexplainable gap ("out-of-order frame").
            if len(compact(data)) > 92_000:
                raise ValueError("Application frame is too large for the relay")
            await self.plain(self.channel.seal(data))

    async def frame(self, timeout: int = 20) -> dict:
        value = await asyncio.wait_for(self.queue.get(), timeout)
        if not isinstance(value, dict):
            raise ValueError("Invalid message")
        return value

    async def serve(self) -> None:
        try:
            hello = await self.frame()
            if hello.get("type") != "hello" or hello.get("v") != 1:
                raise ValueError("Protocol version mismatch")
            self.device_id = hello.get("id", "")
            if not re.fullmatch(r"[A-Za-z0-9_-]{8,80}", self.device_id):
                raise ValueError("Invalid device identity")
            if len(unb64(hello.get("nonce", ""))) != 32 or len(unb64(hello.get("pub", ""))) != 65:
                raise ValueError("Invalid handshake")
            pairs, devices = self.host.state.data["pairs"], self.host.state.data["devices"]
            if hello.get("auth") == "pair":
                pairing = pairs.get(hello.get("pair"))
                if not pairing or pairing["expires"] < time.time():
                    await self.plain({"type": "error", "code": "pair-expired", "message": "Pairing code expired; run jaunt pair"})
                    return
                secret = unb64(pairing["secret"])
            elif hello.get("auth") == "device":
                device = devices.get(self.device_id)
                if not device:
                    await self.plain({"type": "error", "code": "unknown-device", "message": "Device is not authorized"})
                    return
                secret = unb64(device["secret"])
            else:
                raise ValueError("Invalid authentication mode")
            private = ec.generate_private_key(ec.SECP256R1())
            nonce, public = token(), public_key(private)
            text = transcript(self.host.state.data["room"], hello, nonce, public)
            await self.plain({"type": "challenge", "nonce": nonce, "pub": public,
                              "mac": proof(secret, "server", text)})
            answer = await self.frame()
            if answer.get("type") != "proof" or not verify(secret, "client", text, answer.get("mac", "")):
                raise ValueError("Authentication failed")
            self.channel = Channel(private, hello["pub"], secret, text, server=True)
            del private, secret
            if hello["auth"] == "pair":
                await self.send({"type": "pair.ready"})
                enrolled = self.channel.open(await self.frame())
                if enrolled.get("type") != "enroll" or len(unb64(enrolled.get("secret", ""))) != 32:
                    raise ValueError("Invalid enrollment")
                # Recheck after awaits: a QR is single-use even if two clients raced.
                if hello.get("pair") not in pairs or pairing["expires"] < time.time():
                    raise ValueError("Pairing code already used or expired")
                if len(devices) >= 32 and self.device_id not in devices:
                    raise ValueError("32 devices are already authorized; revoke one first")
                if self.device_id in devices:
                    raise ValueError("Device identity already exists")
                devices[self.device_id] = {"name": str(enrolled.get("name", "Browser"))[:80],
                                           "secret": enrolled["secret"], "created": time.time(),
                                           "lastSeen": time.time()}
                if enrolled.get("kind") == "host" and re.fullmatch(r"[A-Za-z0-9_-]{8,80}", str(enrolled.get("room", ""))):
                    # Another jaunt host enrolling as a device: it may later ask to run agent commands here.
                    devices[self.device_id].update(kind="host", room=str(enrolled["room"]))
                del pairs[hello["pair"]]
                self.host.state.save()
            if self.device_id not in devices:
                raise ValueError("Device was revoked")
            devices[self.device_id]["lastSeen"] = time.time()
            self.host.state.save()
            self.ready = True
            if self.is_host:
                self.host.agent_shells.mark_orphans(self.device_id, False)
            await self.send({"type": "welcome", "machine": self.host.info(),
                             "sessions": self.host.sessions.list(), "device": self.device_id, "peer": self.routing_id})
            while True:
                raw = await self.queue.get()
                if self.device_id not in self.host.state.data["devices"]:
                    raise ValueError("Device was revoked")
                message = self.channel.open(raw)
                if not isinstance(message, dict):
                    raise ValueError("Invalid application message")
                await self.dispatch(message)
        except asyncio.CancelledError:
            pass
        except (ConnectionError, asyncio.TimeoutError):
            pass
        except Exception as exc:
            log.info("Client closed (%s)", type(exc).__name__)
            with contextlib.suppress(Exception):
                if self.channel:
                    await self.send({"type": "error", "message": str(exc)[:180]})
                else:
                    await self.plain({"type": "error", "code": "handshake", "message": "Secure handshake failed"})
        finally:
            self.ready = False
            self.host.sessions.detach(self.routing_id)
            if self.device_id and self.is_host and not any(p is not self and getattr(p, "device_id", "") == self.device_id and p.ready for p in self.host.peers.values()):
                self.host.agent_shells.mark_orphans(self.device_id, True)  # killed after the grace period unless it comes back
            if self.host.peers.get(self.routing_id) is self:
                self.host.peers.pop(self.routing_id, None)
            await self.host.sessions_changed()
            # Ask the relay to close this client. It cannot receive terminal data after this.
            with contextlib.suppress(Exception):
                await self.host.transport.send({"type": "disconnect", "to": self.routing_id})

    async def dispatch(self, message: dict) -> None:
        terminal = message.get('type') in ('terminal.input','terminal.resize')
        if terminal and self.host.reexec:
            return
        tracked = message.get('type') != 'ping' and message.get('method') != 'updates.status'
        if tracked:self.host.active_actions += 1
        try:
            await self._dispatch(message)
        finally:
            if tracked:self.host.active_actions -= 1

    async def _dispatch(self, message: dict) -> None:
        kind = message.get("type")
        if kind == "rpc":
            rid = message.get("id")
            if not isinstance(rid, str) or len(rid) > 100:
                raise ValueError("Invalid request identifier")
            try:
                result = await self.host.rpc(self, message.get("method", ""), message.get("params", {}))
                await self.send({"type": "reply", "id": rid, "ok": True, "result": result})
            except (ValueError, OSError, KeyError, TypeError, asyncio.TimeoutError) as exc:
                await self.send({"type": "reply", "id": rid, "ok": False, "error": str(exc)[:240]})
        elif kind == "terminal.input":
            data = unb64(message["data"], 65536)
            session = self.host.sessions.items.get(message["id"])
            # Input/geometry already in flight may outlive an explicit terminate.
            # Discard it; never disconnect other shells or replay it later.
            if session is None or not session.alive:
                return
            if message.get("active"):
                await self.host.sessions.activity(self.routing_id, message["id"], message, self.display_name)
            session = self.host.sessions.items.get(message["id"])
            if session is not None and session.alive:
                await self.host.sessions.write(message["id"], data)
        elif kind == "terminal.resize":
            session = self.host.sessions.items.get(message["id"])
            if session is None or not session.alive:
                return
            await self.host.sessions.activity(self.routing_id, message["id"], message, self.display_name)
        elif kind == "terminal.ack":
            await self.host.sessions.ack(self.routing_id, str(message.get("id", "")), message.get("offset"))
        elif kind == "ping":
            await self.send({"type": "pong", "at": message.get("at")})
        else:
            raise ValueError("Unknown application message")

    @property
    def display_name(self):
        return self.host.state.data['devices'].get(self.device_id, {}).get('name', 'Remote device')

    @property
    def is_host(self) -> bool:
        return self.host.state.data['devices'].get(self.device_id, {}).get('kind') == 'host'


class LocalPeer:
    """Same-account UI connection over the private 0600 Unix socket.

    It never crosses the network and does not create a reusable pairing secret.
    Remote peers still require the existing authenticated encrypted handshake.
    """
    dispatch = Peer.dispatch
    _dispatch = Peer._dispatch
    local = True
    ready = True
    display_name = 'Host desktop'

    def __init__(self, host, writer):
        self.host, self.writer = host, writer
        self.routing_id = 'local-' + token(12)
        self.device_id = "local-desktop"
        self.clipboard_read = b''
        self.clipboard_write = bytearray()
        self.task = asyncio.current_task()
        self.lock = asyncio.Lock()

    async def send(self, data):
        async with self.lock:
            self.writer.write((compact(data) + '\n').encode())
            try:
                await asyncio.wait_for(self.writer.drain(), 10)
            except asyncio.TimeoutError as exc:
                raise ConnectionError('Local UI stopped reading') from exc


class Host:
    def __init__(self, state: State):
        self.state = state
        self.peers: dict[str, Peer] = {}
        self.stopping = asyncio.Event()
        self.reexec = None
        self.active_actions = 0
        self.runtime_id = token(12)
        self.transport = Transport(state.data, self.receive, self.disconnected)
        self.sessions = Sessions(self.send, self.sessions_changed, state.root, self.attention)
        self.sessions.disk_history = bool(state.data.get("scrollback", {}).get("disk", True))
        # Agents and machines: trust policy, approvals and executor (target side), links (requester side).
        self.policy = Policy(state)
        self.approvals = Approvals(self)
        self.executor = Executor(state.root, self.policy)
        self.agent_shells = AgentShells(state.root, self.policy.journal)
        self.agent_handles: dict[str, list] = {}  # local session id -> [(room, shell id, runtime)] opened on linked hosts
        self.run_owners: dict[str, str] = {}  # run id -> requester, for the service identities that may only read their own runs
        self.known_sessions: set[str] = set()
        self.links = Links(state, {"room": state.data["room"], "name": "host: " + state.data["name"]}, self.link_message)
        self.files = Files(state.root, state.data.get("maxFileBytes", 512 * 1024 * 1024))
        self.clipboard = Clipboard()
        self.last_notification = 0.0
        self.lockfile = None
        self.update_process = None
        self.last_update_check = -float("inf")
        self.update_status_stamp = None
        self.update_watch_until = -float("inf")
        from .bridge import Bridge
        self.bridge = Bridge(self)

    def info(self) -> dict:
        from .updates import status as update_status
        return {"name": self.state.data["name"], "room": self.state.data["room"],
                "version": __version__, "platform": platform.system(), "user": getpass.getuser(),
                "home": str(Path.home()), "tmux": bool(shutil.which("tmux")),
                "clipboard": self.clipboard.capabilities(), "maxFileBytes": self.files.max_bytes,
                "replayBytes": 2 * 1024 * 1024, "flowControl": True, "sharedViews": True, "sessionDirectory": True, "seamlessUpdates": True,
                "updates": update_status(self.state.root), "bridge": self.bridge.status(), "workspace": self.workspace(), "scrollback": self.scrollback(), "agents": {"enabled": self.policy.enabled, "features": self.policy.features(), "links": list(self.links.records)},
                "notifications": self.state.data.get('attention', {'bell': True, 'program': True, 'exit': True})}

    def attention(self, session, event, title="", body=""):
        if not self.state.data.get('attention', {}).get(event, True):
            return
        title = title or (f'{session.name} finished' if event == 'exit' else session.name)
        task = asyncio.create_task(self.notify(title, body, session.id))
        task.add_done_callback(lambda future: future.exception() if not future.cancelled() else None)

    async def send(self, peer: str, data: dict) -> None:
        item = self.peers.get(peer)
        if not item or not item.ready:
            raise ConnectionError("Client is disconnected")
        await item.send(data)

    async def broadcast(self, value: dict) -> None:
        for peer in tuple(self.peers.values()):
            if peer.ready:
                with contextlib.suppress(ConnectionError, RuntimeError):
                    await peer.send(value)

    async def sessions_changed(self) -> None:
        current = set(self.sessions.items)
        for gone in self.known_sessions - current:
            self.policy.forget_session(gone)
            if gone in self.agent_handles:
                asyncio.create_task(self.release_agent_shells(gone))
        self.known_sessions = current
        await self.broadcast({"type": "sessions", "sessions": self.sessions.list()})
        with contextlib.suppress(Exception):
            await self.workspace_prune()

    async def receive(self, message: dict) -> None:
        kind = message.get("type")
        if kind == "peer.joined":
            routing_id = message["peer"]
            if routing_id not in self.peers:
                self.peers[routing_id] = Peer(self, routing_id)
        elif kind == "peer.left":
            await self.drop(message["peer"])
        elif kind == "route":
            routing_id = message.get("from")
            item = self.peers.get(routing_id)
            if item and not item.task.done():
                try:
                    item.queue.put_nowait(message["data"])
                except asyncio.QueueFull:
                    await self.drop(routing_id)

    async def drop(self, routing_id: str) -> None:
        peer = self.peers.pop(routing_id, None)
        if peer:
            peer.ready = False
            peer.task.cancel()
            self.sessions.detach(routing_id)
            await self.sessions_changed()

    async def disconnected(self) -> None:
        for routing_id, peer in tuple(self.peers.items()):
            if not getattr(peer, 'local', False):
                await self.drop(routing_id)

    async def rpc(self, peer: Peer, method: str, p: dict):
        if method == "updates.status":
            from .updates import status
            return status(self.state.root)
        if self.stopping.is_set() or self.reexec:
            raise ValueError("Host is restarting; reconnect before starting another operation")
        if not isinstance(p, dict):
            raise ValueError("Invalid request parameters")
        if getattr(peer, "is_host", False) and method not in ("agent.rights", "agent.run", "agent.read", "agent.shell", "agent.sessions", "agent.type", "agent.output", "agent.peers", "agent.message", "ping"):
            # A linked host is a requester, never a user of this machine: it gets the agent RPCs only.
            raise ValueError("Linked hosts may only use the agent methods")
        if getattr(peer, "is_host", False) and p.get("runtime") == "resetdeck" and method not in self.SERVICE_PEER_METHODS:
            # Enforced here whatever the requester's trust: a service identity never gets shells, typing or messages.
            raise ValueError("ResetDeck can only exchange collector data")
        if method == "session.list":
            return self.sessions.list()
        if method == "session.directory":
            return {"path": await self.sessions.directory(p["id"])}
        if method == "session.create":
            return await self.sessions.create(p)
        if method == "session.attach":
            result = await self.sessions.attach(peer.routing_id, p)
            await self.sessions.add_view(peer.routing_id, p['id'], peer.display_name)
            return result
        if method == "session.history":
            return await self.sessions.history(p["id"], p.get("before"), p.get("limit", 48 * 1024))
        if method == "scrollback.configure":
            if not isinstance(p.get("disk"), bool):
                raise ValueError("disk must be a boolean")
            self.state.data["scrollback"] = {"disk": p["disk"]}
            self.state.save()
            self.sessions.configure_history(p["disk"])
            return self.scrollback()
        if method == "session.detach":
            session = self.sessions.get(p["id"])
            session.subscribers.pop(peer.routing_id, None)
            session.viewers.pop(peer.routing_id, None)
            if session.active_view == peer.routing_id:
                session.active_view = ""
            await self.sessions_changed()
            return {}
        if method == "session.terminate":
            await self.sessions.terminate(p["id"])
            return {}
        if method == "session.close":
            # Legacy clients use close for plain-shell termination and tmux detach.
            if self.sessions.get(p["id"]).tmux:
                await self.sessions.close(p["id"])
            else:
                await self.sessions.terminate(p["id"])
            return {}
        if method == "session.rename":
            return await self.sessions.rename(p["id"], p["name"])
        if method == "tmux.list":
            return await self.sessions.tmux_list()
        filesystem = {"files.list": self.files.listing, "files.mkdir": self.files.mkdir,
                      "files.rename": self.files.rename, "files.remove": self.files.remove}
        if method in filesystem:
            return filesystem[method](p)
        transfers = {"upload.begin": self.files.begin_upload, "upload.chunk": self.files.upload_chunk,
                     "upload.finish": self.files.finish_upload, "upload.cancel": self.files.cancel_upload,
                     "download.begin": self.files.begin_download, "download.chunk": self.files.download_chunk,
                     "download.close": self.files.close_download}
        if method in transfers:
            return transfers[method](peer.device_id, p)
        if method == "clipboard.get":
            offset = int(p.get("offset", 0))
            if offset == 0:
                value = await self.clipboard.get_text()
                peer.clipboard_read = value["text"].encode()
            if not 0 <= offset <= len(peer.clipboard_read):
                raise ValueError("Invalid clipboard offset")
            return {"data": b64(peer.clipboard_read[offset:offset + 32768]),
                    "offset": offset, "size": len(peer.clipboard_read)}
        if method == "clipboard.set":
            if "text" in p:
                return await self.clipboard.set_text(p["text"])
            offset = int(p.get("offset", 0))
            if offset == 0:
                peer.clipboard_write = bytearray()
            if offset != len(peer.clipboard_write):
                raise ValueError("Clipboard transfer was interrupted; start again")
            raw = unb64(p["data"], 32768)
            if len(raw) > 32768 or len(peer.clipboard_write) + len(raw) > 1024 * 1024:
                raise ValueError("Clipboard exceeds 1 MiB")
            peer.clipboard_write.extend(raw)
            if p.get("done"):
                text = peer.clipboard_write.decode("utf-8")
                peer.clipboard_write.clear()
                return await self.clipboard.set_text(text)
            return {"offset": len(peer.clipboard_write)}
        if method == "clipboard.image":
            source = Path(p["path"]).resolve(strict=True)
            if not source.is_relative_to((self.state.root / "attachments").resolve()):
                raise ValueError("Image clipboard only accepts a jaunt attachment")
            result = await self.clipboard.image(source)
            if p.get("paste"):
                await self.sessions.write(p["session"], b"\x16")  # Ctrl+V, never Enter.
            return result
        if method == "devices.list":
            return self.devices()
        if method == "devices.revoke":
            if p["id"] == peer.device_id:
                async def revoke_after_reply():
                    await asyncio.sleep(0.2)
                    await self.revoke(p["id"])
                asyncio.create_task(revoke_after_reply())
            else:
                await self.revoke(p["id"])
            return {"revoked": True}
        if method == "updates.status":
            from .updates import status
            return status(self.state.root)
        if method == "updates.configure":
            from .updates import configure
            return configure(p.get("automatic"))
        if method == "updates.install":
            return self.launch_update(allow_restart=p.get("allowRestart") is True)
        if method == "agent.rights":
            return self.agent_rights(peer, p)
        if method == "agent.sessions":
            key, name = self._requester_of(peer, p, "typeRemote")
            return self.agent_sessions(key)
        if method == "agent.type":
            key, name = self._requester_of(peer, p, "typeRemote")
            return await self.agent_type(key, name, p)
        if method == "agent.output":
            key, name = self._requester_of(peer, p, "typeRemote")
            return await self.agent_output(key, name, p)
        if method == "agent.peers":
            self._requester_of(peer, p, "messages")
            # Registered sessions, and the runtimes visibly open in jaunt shells that have not registered
            # (no prompt yet, hooks not trusted, started before the switch): both, so absence is never mistaken for "none".
            return {"sessions": [self.bridge.public(q) for q in self.bridge.participants.values() if q.state != "ended"],
                    "present": self.bridge.unbridged()}
        if method == "agent.message":
            return await self.agent_message(peer, p)
        if method == "agents.cut":
            sid = str(p.get("session", ""))
            s = self.sessions.get(sid)
            cut = self.policy.cut(sid)
            s.agents.clear()
            self.policy.journal(kind="cut", session=sid, sessionName=s.name, requesters=cut, by=peer.display_name)
            await self.sessions_changed()
            return self.agents_status()
        if method == "agent.run":
            return await self.agent_run(peer, p)
        if method == "agent.read":
            return self.agent_read(peer, p)
        if method == "agent.shell":
            return await self.agent_shell(peer, p)
        if method == "agents.kill":
            await self.agent_shells.kill(str(p.get("shell", "")), "killed by " + peer.display_name)
            return self.agents_status()
        if method == "agents.status":
            return self.agents_status()
        if method == "agents.configure":
            return await self.agents_configure(p)
        if method == "agents.trust":
            self.policy.set_level(str(p.get("requester", "")), str(p.get("right", "")), str(p.get("level", "")), p.get("duration"))
            self.policy.journal(kind="trust", requester=p.get("requester"), right=p.get("right"), level=p.get("level"), duration=p.get("duration"), by=peer.display_name)
            if p.get("level") == "block":
                await self.agent_shells.kill_for(str(p.get("requester", "")), "requester blocked")
            await self._marks_changed()
            return self.agents_status()
        if method == "agents.rule":
            key, pattern = str(p.get("requester", "")), str(p.get("pattern", ""))
            if p.get("remove") is True:
                self.policy.remove_rule(key, pattern)
                self.policy.journal(kind="rule", requester=key, removed=self.policy.normalize(pattern), by=peer.display_name)
            else:
                self.policy.add_rule(key, pattern)
                self.policy.journal(kind="rule", requester=key, added=self.policy.normalize(pattern), by=peer.display_name)
            return self.agents_status()
        if method == "agents.revoke":
            keys = list(self.policy.data["requesters"]) if p.get("all") is True else [str(k) for k in p.get("requesters", [])]
            self.policy.revoke(keys)
            for key in keys:
                await self.agent_shells.kill_for(key, "requester revoked")
            self.policy.journal(kind="revoke", requesters=keys, by=peer.display_name)
            await self._marks_changed()
            return self.agents_status()
        if method == "agents.decide":
            return self.approvals.decide(str(p.get("id", "")), str(p.get("decision", "")), by=peer.display_name)
        if method == "pair.issue":
            # An authenticated device already holds the account's rights: it may mint a one-use pairing code
            # for another host to enroll here, so linking needs no manual copy of codes.
            return self.pair()
        if method == "links.add":
            if not self.policy.enabled:
                raise ValueError("Turn on Agents and machines on this host first")
            result = await self.links.add(str(p.get("code", "")), str(p.get("name", "") or ""), p.get("icon") if isinstance(p.get("icon"), dict) else None, str(p.get("selfName", "") or ""))
            self.policy.journal(kind="link", host=result.get("label") or result.get("name"), by=peer.display_name)
            return self.agents_status()
        if method == "links.update":
            await self.links.update(str(p.get("room", "")), str(p.get("name", "") or ""), p.get("icon") if isinstance(p.get("icon"), dict) else None)
            return self.agents_status()
        if method == "links.remove":
            await self.links.remove(str(p.get("room", "")))
            return self.agents_status()
        if method == "links.list":
            return self.links.list()
        if method == "workspace.configure":
            return await self.workspace_configure(peer, p)
        if method == "workspace.update":
            return await self.workspace_update(peer, p)
        if method == "bridge.status":
            await self.bridge.detect(force=p.get("refresh") is True)
            return self.bridge.status()
        if method == "bridge.configure":
            return await self.bridge.configure(p.get("enabled"))
        if method == "notifications.subscribe":
            validate_subscription(p)
            self.state.data["push"][peer.device_id] = p
            self.state.save()
            return {"registered": True}
        if method == 'notifications.configure':
            settings = {key: p.get(key, True) is True for key in ('bell', 'program', 'exit')}
            self.state.data['attention'] = settings
            self.state.save()
            return settings
        if method == "notifications.unsubscribe":
            self.state.data["push"].pop(peer.device_id, None)
            self.state.save()
            return {"removed": True}
        if method == "notifications.test":
            return await self.notify("Connected to jaunt", "This machine can reach your phone.", "", only=peer.device_id)
        if method == "machine.info":
            return self.info()
        raise ValueError("Unknown method")

    def devices(self) -> list[dict]:
        return [{"id": key, **{k: v for k, v in value.items() if k != "secret"}}
                for key, value in self.state.data["devices"].items()]

    async def revoke(self, device_id: str) -> None:
        self.state.data["devices"].pop(device_id, None)
        self.state.data["push"].pop(device_id, None)
        self.state.save()
        for peer in tuple(self.peers.values()):
            if peer.device_id == device_id:
                with contextlib.suppress(Exception):
                    await peer.send({"type": "revoked"})
                await self.drop(peer.routing_id)

    def pair(self) -> dict:
        now = time.time()
        pairs = self.state.data["pairs"]
        for key, value in tuple(pairs.items()):
            if value["expires"] < now:
                del pairs[key]
        if len(pairs) >= 5:
            pairs.pop(next(iter(pairs)))
        pid, secret = token(12), token()
        pairs[pid] = {"secret": secret, "expires": now + 600}
        self.state.save()
        data = {"v": 1, "r": self.state.data["relay"], "h": self.state.data["room"],
                "t": self.state.data["clientToken"], "p": pid, "s": secret,
                "n": self.state.data["name"]}
        encoded = b64(compact(data).encode())
        return {"code": "jaunt1." + encoded,
                "url": self.state.data["page"].rstrip("/") + "/#pair=" + encoded,
                "expires": now + 600}

    async def notify(self, title: str, body: str, session: str, only: str = "") -> dict:
        # Bound background send volume without preventing terminal interaction.
        if time.time() - self.last_notification < 1:
            return {"delivered": 0, "reason": "Notifications are limited to one per second"}
        self.last_notification = time.time()
        event = {"type": "notification", "title": str(title)[:100], "body": str(body)[:400],
                 "session": session, "host": self.state.data["room"], "at": time.time()}
        await self.broadcast(event)
        results = []
        for device_id, subscription in tuple(self.state.data["push"].items()):
            if only and only != device_id:
                continue
            private = not subscription.get("showDetails", False)
            payload = {"title": "jaunt" if private else event["title"],
                       "body": f'{self.state.data["name"]} needs your attention.' if private else event["body"],
                       "host": event["host"], "session": session,
                       "tag": "jaunt-" + (session or "host")}
            result = await deliver(subscription, payload)
            results.append(result)
            if result == "expired":
                self.state.data["push"].pop(device_id, None)
                self.state.save()
        return {"delivered": results.count("sent"), "results": results,
                "liveClients": sum(p.ready for p in self.peers.values())}

    # ---- shared workspace (open sessions, layouts) -------------------------------
    # ---- agents and machines ---------------------------------------------------------
    RUNTIME_NAMES = {"claude": "Claude Code", "codex": "Codex", "resetdeck": "ResetDeck"}
    # Service identities (not AI sessions) and the only methods they may call, locally and on a linked host.
    SERVICES = ("resetdeck",)
    SERVICE_METHODS = ("agents.hosts", "agents.run", "agents.read")
    SERVICE_PEER_METHODS = ("agent.rights", "agent.run", "agent.read")
    COLLECTOR_PAYLOAD = 200_000

    def agents_status(self) -> dict:
        return {"enabled": self.policy.enabled, "features": self.policy.features(), "services": list(self.SERVICES),
                "requesters": self.policy.table(), "links": self.links.list(),
                "pending": self.approvals.list(), "log": self.policy.data["log"][-50:], "agentShells": self.agent_shells.list()}

    async def agents_configure(self, p: dict) -> dict:
        """One capability at a time (`feature` + `enabled`); `enabled` alone drives the three shell
        capabilities together, as the single switch of earlier versions did."""
        enabled = p.get("enabled")
        if type(enabled) is not bool:
            raise ValueError("enabled must be true or false")
        names = [str(p["feature"])] if p.get("feature") else ["exec", "typeLocal", "typeRemote"]
        for name in names:
            self.policy.set_feature(name, enabled)
            self.policy.journal(kind="switch", feature=name, enabled=enabled)
        detected = await self.bridge.detect(force=True)
        await self.apply_agent_integrations(detected)
        if self.policy.feature("exec") or self.policy.feature("typeRemote") or self.policy.feature("messages"):
            self.links.start_all()
        else:
            await self.links.stop_all()
        if not self.policy.feature("messages"):
            self.bridge.forget_remote()
            if not self.bridge.registering:
                self.bridge.disable_now()
        return self.agents_status()

    async def apply_agent_integrations(self, detected: dict) -> None:
        """What the runtimes need for the capabilities that are on: hooks (sessions register) for
        cross-host messages, the MCP server alone for the rest, nothing when everything is off.
        The local bridge, when on, already installs both and is left alone."""
        from . import bridge_setup
        runtimes = detected.get("runtimes") or {}
        if self.bridge.enabled or not runtimes:
            return
        if self.policy.feature("messages"):
            await asyncio.to_thread(bridge_setup.install, runtimes, False)
        elif self.policy.enabled:
            await asyncio.to_thread(bridge_setup.uninstall, runtimes)
            await asyncio.to_thread(bridge_setup.install, runtimes, True)
        else:
            await asyncio.to_thread(bridge_setup.uninstall, runtimes)

    REFUSAL = {"deny": "Refused: the owner of {host} denied this request",
               "expired": "Not allowed: nobody answered the request on {host} within 2 minutes, so it was not run. "
                          "This is an expiry, not a refusal: ask again when someone is at the keyboard, or have the owner trust this session."}
    FEATURE_NAMES = {"exec": "Commands and background shells on linked machines", "typeLocal": "Typing into shells of this host",
                     "typeRemote": "Typing into shells across machines", "messages": "Messages between sessions across machines"}

    def _require(self, feature: str) -> None:
        if not self.policy.feature(feature):
            raise ValueError(f"{self.FEATURE_NAMES[feature]} is off on {self.state.data['name']} (Settings → Agents and machines)")

    def _requester_of(self, peer, p: dict, feature: str = "exec") -> tuple[str, str]:
        """(key, display name) of a linked host's session asking for something here."""
        self._require(feature)
        device = self.state.data["devices"].get(peer.device_id, {})
        if device.get("kind") != "host":
            raise ValueError("Only linked jaunt hosts may run agent commands here")
        runtime = str(p.get("runtime", ""))
        if runtime not in self.RUNTIME_NAMES:
            raise ValueError("Unknown runtime")
        name = f"{device.get('name', 'host')} · {self.RUNTIME_NAMES[runtime]}"
        key = requester_key(peer.device_id, runtime)
        self.policy.requester(key, name=name, runtime=runtime, host=peer.device_id)
        return key, name

    def agent_rights(self, peer, p: dict) -> dict:
        key, name = self._requester_of(peer, p)
        return {"requester": name, "exec": self.policy.level(key, "exec"), "type": self.policy.level(key, "type"), "rules": self.policy.rules(key)}

    async def _authorize(self, key: str, name: str, right: str, kind: str, detail: dict) -> None:
        level = self.policy.level(key, right)
        if level == "block":
            self.policy.journal(kind=kind, requester=key, decision="blocked", **detail)
            raise ValueError(f"Refused: {name} is blocked on {self.state.data['name']}")
        if level == "ask" and kind == "run":
            rule = self.policy.matches(key, detail.get("command", ""))
            if rule is not None:
                detail["decision"], detail["rule"] = "rule", rule
                return
        if level == "ask":
            decision = await self.approvals.ask({"id": key, "name": name}, right, kind, detail)
            if decision == "rule" and kind == "run":
                # "Always allow this command": the exact command becomes a rule for this requester,
                # or the pattern the command's validation computed (a collector exchange, whatever its payload).
                rule = detail.get("rulePattern") or detail.get("command", "")
                if "rulePattern" in detail and len(self.policy.normalize(rule)) > RULE_CHARS:
                    # Still the approved run, once: never a lost approval, never a silently wider rule.
                    self.policy.journal(kind="rule", requester=key, skipped=self.policy.normalize(rule)[:200], reason="longer than 200 characters")
                else:
                    self.policy.add_rule(key, rule)
                    self.policy.journal(kind="rule", requester=key, added=self.policy.normalize(rule))
            if decision in ("deny", "expired"):
                self.policy.journal(kind=kind, requester=key, decision="denied" if decision == "deny" else "expired", **detail)
                raise ValueError(self.REFUSAL[decision].format(host=self.state.data["name"]))
            if decision in DURATIONS:
                self.policy.set_level(key, right, "trust", decision)
            detail["decision"] = decision
        else:
            detail["decision"] = "trusted"

    # Right `type`: write into and read one of the owner's existing jaunt shells (remote or local requester).
    def native_agents(self) -> dict:
        """Which AI session runs in which jaunt shell, under the identity its own runtime uses.

        Claude Code publishes `~/.claude/sessions/<pid>.json` with the very name its own
        cross-session tools address (ListAgents / SendMessage); Codex sessions registered
        with the bridge carry their thread. Without this, a caller told to "use your runtime's
        own tools" has no way to know which of its peers is the shell it is looking at.
        """
        found: dict[str, dict] = {}
        with contextlib.suppress(Exception):
            from .bridge_deliver import claude_sessions_dir
            for path in claude_sessions_dir().glob("*.json"):
                try:
                    record = json.loads(path.read_text())
                except (OSError, ValueError):
                    continue
                pid = int(record.get("pid") or 0)
                sid = self.bridge.session_for_pid(pid) if pid else ""
                if sid and record.get("name"):
                    found[sid] = {"runtime": "claude", "name": str(record["name"])[:80],
                                  "conversation": str(record.get("sessionId", ""))[:64], "status": str(record.get("status", ""))[:16]}
        for p in self.bridge.participants.values():
            if p.state != "ended" and p.session and p.session not in found:
                found[p.session] = {"runtime": p.runtime, "name": "", "conversation": p.conversation[:64], "bridgeId": p.id}
        return found

    AGENT_NOTE = ("this shell runs a {runtime} session: typing here drives its terminal, it is NOT how you talk to it. "
                  "To send it a message use your own runtime's tools when it runs the same runtime as you on this machine "
                  "({native}), or jaunt_send for a session on another machine. Keep jaunt_type for what a keyboard is for: "
                  "answering a prompt, interrupting, a short command.")

    def agent_sessions(self, key: str) -> dict:
        natives = self.native_agents()
        out = []
        for s in self.sessions.items.values():
            row = {"id": s.id, "name": s.name, "cwd": self.bridge.live_cwd(s), "startedIn": s.cwd, "program": s.program,
                   "alive": s.alive, "access": self.policy.allowed_shell(key, s.id), "viewers": len(s.viewers)}
            native = natives.get(s.id)
            if native or s.program in ("claude", "codex"):
                native = native or {"runtime": s.program, "name": "", "conversation": ""}
                row["agent"] = native
                named = f"it is known there as {native['name']!r}" if native.get("name") else "it has not published an addressable name yet"
                row["note"] = self.AGENT_NOTE.format(runtime="Claude Code" if native["runtime"] == "claude" else "Codex", native=named)
            out.append(row)
        return {"sessions": out}

    async def _shell_access(self, key: str, name: str, sid: str, detail: dict) -> Session:
        s = self.sessions.get(sid)
        access = self.policy.allowed_shell(key, sid)
        detail = {**detail, "session": sid, "sessionName": s.name, "cwd": s.cwd}
        if access == "block":
            self.policy.journal(kind="type", requester=key, decision="blocked", **detail)
            raise ValueError(f"Refused: {name} is blocked on {self.state.data['name']}")
        if access == "ask":
            decision = await self.approvals.ask({"id": key, "name": name}, "type", "type", detail)
            if decision in ("deny", "expired"):
                self.policy.journal(kind="type", requester=key, decision="denied" if decision == "deny" else "expired", **detail)
                raise ValueError(self.REFUSAL[decision].format(host=self.state.data["name"]))
            if decision in DURATIONS:
                self.policy.set_level(key, "type", "trust", decision)
            self.policy.grant(key, sid)
            self.policy.journal(kind="type", requester=key, decision=decision, granted=True, **detail)
        if key not in s.agents:
            s.agents[key] = {"id": key, "name": name, "since": time.time()}
            await self.sessions_changed()
        return s

    async def agent_type(self, key: str, name: str, p: dict) -> dict:
        sid, text = str(p.get("session", "")), str(p.get("input", ""))
        if len(text) > 16 * 1024:
            raise ValueError("Input over 16 KiB; send it in parts")
        if p.get("origin") and p.get("origin") == sid:
            raise ValueError("A session cannot type into its own shell")
        s = await self._shell_access(key, name, sid, {"summary": text[:120], "input": text[:2000]})
        enter = p.get("enter", True) is not False
        await self.sessions.write(sid, text.encode() + (b"\r" if enter else b""))
        self.policy.journal(kind="typed", requester=key, session=sid, sessionName=s.name, input=text[:200], enter=enter)
        result = {"session": sid, "name": s.name, "bytes": len(text), "offset": s.offset, "typed": True, "submitted": None}
        if s.program in ("claude", "codex"):
            runtime = "Claude Code" if s.program == "claude" else "Codex"
            result["agent"] = self.native_agents().get(sid) or {"runtime": s.program}
            result["warning"] = (f"The keystrokes reached the terminal, nothing more: it runs a {runtime} session, whose interface decides "
                                 "what to do with them. A long or multi-line text lands there as a pasted block that Enter does NOT submit, "
                                 "so this is not a way to send a message. Read jaunt_output to see what actually happened, and use your "
                                 "runtime's own messaging (same runtime, this machine) or jaunt_send (another machine) to talk to it.")
        return result

    async def agent_output(self, key: str, name: str, p: dict) -> dict:
        sid = str(p.get("session", ""))
        s = await self._shell_access(key, name, sid, {"summary": "read the output", "read": True})
        limit = max(1, min(int(p.get("limit") or 16384), 65536))
        history = await self.sessions.history(sid, s.offset, limit)
        raw = base64.urlsafe_b64decode(history["data"] + "=" * (-len(history["data"]) % 4)) if history.get("data") else b""
        text = ANSI.sub("", raw.decode("utf-8", "replace")).replace("\r\n", "\n").replace("\r", "\n")
        return {"session": sid, "name": s.name, "offset": s.offset, "text": text, "alive": s.alive, "cwd": s.cwd, "program": s.program}

    async def _marks_changed(self) -> None:
        """Drop the agent marks of sessions whose requester may no longer type there, and tell the clients."""
        changed = False
        for s in self.sessions.items.values():
            for key in [k for k in s.agents if self.policy.allowed_shell(k, s.id) != "trust"]:
                s.agents.pop(key, None)
                changed = True
        if changed:
            await self.sessions_changed()

    def _local_requester(self, runtime: str) -> tuple[str, str]:
        name = f"{self.RUNTIME_NAMES[runtime]} on this machine"
        key = requester_key("local", runtime)
        self.policy.requester(key, name=name, runtime=runtime, host="local", local=True)
        return key, name

    async def agent_run(self, peer, p: dict) -> dict:
        key, name = self._requester_of(peer, p)
        command, cwd = str(p.get("command", "")), p.get("cwd")
        timeout = p.get("timeoutSec")
        detail = {"summary": command[:120], "command": command[:2000], "cwd": cwd or "", "timeout": timeout or 60}
        service = p.get("runtime") in self.SERVICES
        if service:
            detail["rulePattern"] = self.collector_rule(command)
            detail["summary"] = "ResetDeck collector exchange · " + shlex.split(command)[1][:80]
        await self._authorize(key, name, "exec", "run", detail)
        result = await self.executor.run(key, command, cwd if isinstance(cwd, str) and cwd else None, timeout)
        if service:
            self.run_owners[result["run"]] = key
            for old in list(self.run_owners)[:-1000]:
                del self.run_owners[old]
        self.policy.journal(kind="run", requester=key, command=command[:200], cwd=cwd or "", status=result["status"],
                            exitCode=result["exitCode"], bytes=result["bytes"], run=result["run"], decision=detail.get("decision"), rule=detail.get("rule"))
        return result

    async def agent_shell(self, peer, p: dict) -> dict:
        key, name = self._requester_of(peer, p)
        action = str(p.get("action", ""))
        if action == "open":
            cwd = p.get("cwd")
            detail = {"summary": "background shell" + (f" in {cwd}" if cwd else ""), "command": "", "cwd": cwd or "", "shell": True}
            await self._authorize(key, name, "exec", "shell", detail)
            self.executor._rate(key)
            self.executor.active.discard(key)
            s = await self.agent_shells.open(key, name, str(p.get("origin", "")), cwd if isinstance(cwd, str) and cwd else None)
            return s.info()
        if action == "list":
            return {"shells": [s.info() for s in self.agent_shells.items.values() if s.requester == key]}
        s = self.agent_shells.get(str(p.get("shell", "")), key)
        if action == "send":
            return self.agent_shells.send(s, str(p.get("input", "")), p.get("enter", True) is not False)
        if action == "read":
            return self.agent_shells.read(s, int(p.get("offset") or 0), int(p.get("limit") or 65536))
        if action == "close":
            await self.agent_shells.kill(s.id, "closed by the agent")
            return {"shell": s.id, "closed": True}
        raise ValueError("Unknown shell action")

    @classmethod
    def collector_rule(cls, command: str) -> str:
        """The rule covering future exchanges with this interpreter and agent, once `command` is proven to be
        exactly `shlex.join([absolute interpreter, absolute agent, "exchange", base64])`; anything else is refused."""
        try:
            args = shlex.split(command)
        except ValueError:
            args = []
        if (len(args) != 4 or not Path(args[0]).is_absolute() or not Path(args[1]).is_absolute()
                or args[2] != "exchange" or not re.fullmatch(r"[A-Za-z0-9+/=]+", args[3])
                or len(args[3]) > cls.COLLECTOR_PAYLOAD or shlex.join(args) != command):
            raise ValueError("ResetDeck only accepts an encoded collector exchange")
        # Glob-escaped so `*`, `?` and `[` in the paths stay literal: only the payload is a wildcard.
        return glob.escape(shlex.join(args[:3])) + " *"

    def agent_read(self, peer, p: dict) -> dict:
        key, name = self._requester_of(peer, p)
        if self.policy.level(key, "exec") == "block":
            raise ValueError(f"Refused: {name} is blocked on {self.state.data['name']}")
        if p.get("runtime") in self.SERVICES and self.run_owners.get(str(p.get("run", ""))) != key:
            raise ValueError("Unknown run, or its output expired")
        return self.executor.read(str(p.get("run", "")), int(p.get("offset") or 0), int(p.get("limit") or 65536))

    async def link_message(self, link, value: dict) -> None:
        pass  # a linked host only answers our requests; its broadcasts are not ours to act on

    def _caller(self, p: dict) -> tuple[str, str]:
        """Which local jaunt shell and runtime an MCP tool call comes from."""
        if not self.policy.enabled:
            raise ValueError("Agents and machines is off on this host (Settings → Agents and machines)")
        runtime = str(p.get("runtime", ""))
        if runtime not in self.RUNTIME_NAMES:
            raise ValueError("Unknown runtime")
        if runtime in self.SERVICES:
            if p.get("service") != runtime:
                raise ValueError("ResetDeck service identity required")
            return f"service:{runtime}", runtime
        sid = self.bridge.session_for_pid(int(p.get("pid") or 0))
        if not sid and p.get("session") in self.sessions.items:
            sid = str(p["session"])
        if not sid:
            raise ValueError("This tool works from a session started in a jaunt shell")
        return sid, runtime

    async def agents_gateway(self, method: str, p: dict) -> dict:
        if method == "agents.status":
            return self.agents_status()
        sid, runtime = self._caller(p)
        if runtime in self.SERVICES and method not in self.SERVICE_METHODS:
            raise ValueError("ResetDeck can only exchange collector data")
        if method in ("agents.hosts", "agents.run", "agents.read", "agents.shell"):
            self._require("exec")
        if method == "agents.hosts":
            async def describe(link):
                status = link.status()
                if status["state"] == "online":
                    try:
                        status["rights"] = await link.request("agent.rights", {"runtime": runtime}, timeout=8)
                    except (ValueError, ConnectionError) as exc:
                        status["rights"] = {"error": str(exc)[:120]}
                return status
            return {"hosts": await asyncio.gather(*(describe(l) for l in self.links.links.values()))}
        host = str(p.get("host", "") or "")
        if method in ("agents.sessions", "agents.type", "agents.output"):
            local = host.lower() in ("", "local", "this", "here", self.state.data["name"].lower())
            self._require("typeLocal" if local else "typeRemote")
        if method in ("agents.sessions", "agents.type", "agents.output") and host.lower() in ("", "local", "this", "here", self.state.data["name"].lower()):
            key, name = self._local_requester(runtime)
            if method == "agents.sessions":
                result = self.agent_sessions(key)
                result["sessions"] = [s for s in result["sessions"] if s["id"] != sid]
                return {"host": self.state.data["name"], "local": True, **result}
            # `session` in `p` is the caller's own shell; the shell to type into is `target`.
            if method == "agents.type":
                return {"host": self.state.data["name"], **await self.agent_type(key, name, {**p, "session": p.get("target"), "origin": sid})}
            return {"host": self.state.data["name"], **await self.agent_output(key, name, {**p, "session": p.get("target")})}
        link = self.links.get(host)
        if link is None:
            raise ValueError("Unknown machine; jaunt_hosts lists the linked ones (omit host for this machine)")
        shown = link.record.get("label") or link.record.get("name")
        if method == "agents.sessions":
            return {"host": shown, **await link.request("agent.sessions", {"runtime": runtime}, timeout=20)}
        if method == "agents.type":
            return {"host": shown, **await link.request("agent.type", {"runtime": runtime, "session": p.get("target"), "input": p.get("input", ""), "enter": p.get("enter", True)}, timeout=170)}
        if method == "agents.output":
            return {"host": shown, **await link.request("agent.output", {"runtime": runtime, "session": p.get("target"), "limit": p.get("limit", 16384)}, timeout=170)}
        if method == "agents.run":
            timeout = p.get("timeoutSec")
            params = {"runtime": runtime, "command": p.get("command", ""), "cwd": p.get("cwd"), "timeoutSec": timeout}
            budget = (int(timeout) if isinstance(timeout, int) else 60) + 150  # execution + possible approval wait
            return {"host": link.record.get("label") or link.record.get("name"), **await link.request("agent.run", params, timeout=budget)}
        if method == "agents.read":
            return {"host": link.record.get("name"), **await link.request("agent.read", {"runtime": runtime, "run": p.get("run"), "offset": p.get("offset", 0), "limit": p.get("limit", 65536)})}
        if method == "agents.shell":
            action = str(p.get("action", ""))
            params = {"runtime": runtime, "action": action, "shell": p.get("shell"), "input": p.get("input"), "enter": p.get("enter", True),
                      "cwd": p.get("cwd"), "offset": p.get("offset", 0), "limit": p.get("limit", 65536), "origin": sid}
            result = await link.request("agent.shell", params, timeout=170 if action == "open" else 45)
            handles = self.agent_handles.setdefault(sid, [])
            if action == "open":
                handles.append((link.record["room"], result["id"], runtime))
            elif action == "close":
                self.agent_handles[sid] = [h for h in handles if h[1] != p.get("shell")]
            return {"host": link.record.get("name"), **result}
        raise ValueError("Unknown agents method")

    # ---- messages between sessions across machines -------------------------------------
    def _caller_enabled(self, p: dict) -> bool:
        try:
            self._caller(p)
            return True
        except ValueError:
            return False

    async def bridge_peers(self, p: dict) -> dict:
        """The local bridge's peers, plus the sessions of linked machines when messages are on."""
        p = self.bridge.resolve(p)
        result = self.bridge.peers_for(p) if self.bridge.enabled else {"enabled": False, "peers": [], "present": [], "note": "The jaunt bridge is turned off on this host"}
        result["messages"] = self.policy.feature("messages")
        if not result["messages"]:
            return result
        runtime = str(p.get("runtime", ""))
        async def ask(link):
            shown = link.record.get("label") or link.record.get("name")
            try:
                reply = await link.request("agent.peers", {"runtime": runtime}, timeout=10)
                return {"host": shown, "sessions": reply.get("sessions", []), "present": reply.get("present", [])}
            except (ValueError, ConnectionError) as exc:
                return {"host": shown, "sessions": [], "error": str(exc)[:120]}
        result["remote"] = await asyncio.gather(*(ask(l) for l in self.links.links.values() if l.state == "online"))
        return result

    def _link_for_machine(self, label: str):
        link = self.links.get(label)
        if link is None:
            raise ValueError(f"Unknown machine {label!r}; jaunt_peers lists the reachable ones")
        return link

    async def bridge_send(self, p: dict) -> dict:
        """`to` = "<machine>/<id>" goes to a session on a linked machine; anything else is the local bridge."""
        p = self.bridge.resolve(p)
        to = str(p.get("to", ""))
        if "/" not in to:
            return await self.bridge.send(p)
        self._require("messages")
        me = self.bridge.sender_of(p)
        label, target = to.split("/", 1)
        link = self._link_for_machine(label)
        text = str(p.get("text", "")).strip()
        if not text:
            raise ValueError("Empty message")
        from .bridge import MESSAGE_LIMIT, MAX_HOPS
        if len(text) > MESSAGE_LIMIT:
            raise ValueError(f"Message exceeds {MESSAGE_LIMIT} characters")
        reply_to = str(p.get("inReplyTo", "")) or None
        hops = 0
        if reply_to and reply_to in self.bridge.messages:
            hops = self.bridge.messages[reply_to].get("hops", 0) + 1
            if hops > MAX_HOPS:
                raise ValueError("This exchange has gone back and forth too many times; stop and let the user decide")
        message = {"id": "m-" + token(6), "from": me.id, "to": to, "text": text, "inReplyTo": reply_to, "hops": hops,
                   "state": "delivering", "detail": "", "at": time.time()}
        self.bridge.messages[message["id"]] = message
        await self.broadcast({"type": "bridge.message", **self.bridge.message_public(message)})
        sender = self.bridge.public(me)
        params = {"runtime": me.runtime, "id": message["id"], "to": target, "text": text, "inReplyTo": reply_to, "hops": hops,
                  "from": {"id": me.id, "runtime": me.runtime, "terminal": sender["terminal"], "cwd": me.cwd,
                           "project": me.project.get("root", me.cwd), "modeClass": me.mode_class}}
        try:
            reply = await link.request("agent.message", params, timeout=90)
            message["state"], message["detail"] = reply.get("state", "delivered"), reply.get("detail", "")
        except (ValueError, ConnectionError) as exc:
            message["state"], message["detail"] = "failed", str(exc)[:200]
            await self.broadcast({"type": "bridge.message", **self.bridge.message_public(message)})
            self.policy.journal(kind="message", to=to, sender=me.id, status="failed", detail=message["detail"])
            raise ValueError(f"Could not deliver to {to}: {message['detail']}") from None
        await self.broadcast({"type": "bridge.message", **self.bridge.message_public(message)})
        self.policy.journal(kind="message", to=to, sender=me.id, status=message["state"], id=message["id"])
        return self.bridge.message_public(message)

    async def agent_message(self, peer, p: dict) -> dict:
        """A session on a linked machine writes to one of the sessions registered here."""
        key, name = self._requester_of(peer, p, "messages")
        device = self.state.data["devices"].get(peer.device_id, {})
        label = str(device.get("name", "host"))
        label = label[6:] if label.startswith("host: ") else label
        origin = p.get("from") if isinstance(p.get("from"), dict) else {}
        from .bridge import Participant, RUNTIMES, MESSAGE_LIMIT
        if origin.get("runtime") not in RUNTIMES:
            raise ValueError("Unknown runtime")
        sender = Participant(id=f"{label}/{str(origin.get('id', ''))[:40]}", session="", runtime=origin["runtime"], conversation="remote", pid=0,
                             cwd=str(origin.get("cwd", ""))[:300], project={"root": str(origin.get("project", ""))[:300], "common": "", "kind": "dir"},
                             name=str(origin.get("terminal", ""))[:80], mode_class=origin.get("modeClass") if origin.get("modeClass") in ("bypass", "prompting") else "",
                             machine=label)
        target = str(p.get("to", ""))
        recipient = next((q for q in self.bridge.participants.values() if q.id == target and q.state != "ended"), None)
        if recipient is None:
            raise ValueError(f"No live session with id {target!r} on {self.state.data['name']}; call jaunt_peers for the current list")
        text = str(p.get("text", "")).strip()
        if not text or len(text) > MESSAGE_LIMIT:
            raise ValueError("Empty message or over the size limit")
        message_id = str(p.get("id", "")) or "m-" + token(6)
        if not re.fullmatch(r"m-[A-Za-z0-9_-]{4,16}", message_id):
            raise ValueError("Invalid message id")
        reply_to = str(p.get("inReplyTo", "")) or None
        pair = tuple(sorted((sender.id, recipient.id)))
        from .bridge import PAIR_RATE
        window = [t for t in self.bridge.rates.get(pair, []) if time.time() - t < PAIR_RATE[1]]
        if len(window) >= PAIR_RATE[0]:
            raise ValueError("Too many messages between these two sessions in the last minute; wait before sending more")
        window.append(time.time()); self.bridge.rates[pair] = window
        message = {"id": message_id, "from": sender.id, "to": recipient.id, "text": text, "inReplyTo": reply_to,
                   "hops": int(p.get("hops") or 0), "state": "accepted", "detail": "", "at": time.time(), "machine": label}
        self.bridge.messages[message_id] = message
        waiter = self.bridge.waiters.get(reply_to) if reply_to else None
        if waiter is not None and not waiter.done():
            message["state"], message["detail"] = "delivered", "handed to the waiting call"
            waiter.set_result({"state": "replied", "reply": self.bridge.message_public(message)})
            await self.broadcast({"type": "bridge.message", **self.bridge.message_public(message)})
            self.policy.journal(kind="message", requester=key, sender=sender.id, to=recipient.id, status="delivered", id=message_id)
            return {"state": "delivered", "detail": message["detail"]}
        message["state"] = "delivering"
        try:
            from . import bridge_deliver
            await bridge_deliver.deliver(self.bridge, sender, recipient, message)
            message["state"] = "delivered"
        except Exception as exc:
            message["state"], message["detail"] = "failed", str(exc)[:200]
            await self.broadcast({"type": "bridge.message", **self.bridge.message_public(message)})
            self.policy.journal(kind="message", requester=key, sender=sender.id, to=recipient.id, status="failed", detail=message["detail"])
            raise ValueError(f"Could not deliver to {recipient.id}: {message['detail']}") from None
        await self.broadcast({"type": "bridge.message", **self.bridge.message_public(message)})
        self.policy.journal(kind="message", requester=key, sender=sender.id, to=recipient.id, status="delivered", id=message_id)
        return {"state": "delivered", "detail": ""}

    async def release_agent_shells(self, sid: str) -> None:
        """The local session that opened background shells elsewhere is gone: close them."""
        for room, shell_id, runtime in self.agent_handles.pop(sid, []):
            link = self.links.links.get(room)
            if link and link.state == "online":
                with contextlib.suppress(Exception):
                    await link.request("agent.shell", {"runtime": runtime, "action": "close", "shell": shell_id}, timeout=15)

    def scrollback(self) -> dict:
        from .scrollback import MAX_BYTES
        return {"disk": self.sessions.disk_history, "maxBytes": MAX_BYTES}

    def workspace(self) -> dict:
        data = self.state.data.get("workspace") or {}
        return {"sync": bool(data.get("sync")), "displayedOnly": bool(data.get("displayedOnly")),
                "openSessions": list(data.get("openSessions") or []), "layouts": list(data.get("layouts") or []),
                "tabOrder": list(data.get("tabOrder") or []), "active": str(data.get("active") or ""),
                "revision": int(data.get("revision") or 0)}

    def _workspace_state(self, p: dict, base: dict) -> dict:
        ids = {s.id for s in self.sessions.items.values()}
        def clean_ids(values):
            return [v for v in values if isinstance(v, str) and v in ids][:64] if isinstance(values, list) else []
        def clean_tree(tree, depth=0):
            # Same shape as web/js/workspace.mjs: a leaf {id} or a split {axis, ratio, first, second}.
            if not isinstance(tree, dict) or depth > 16:
                return None
            if "id" in tree:
                return {"id": tree["id"]} if tree["id"] in ids else None
            first, second = clean_tree(tree.get("first"), depth + 1), clean_tree(tree.get("second"), depth + 1)
            if first and second:
                ratio = tree.get("ratio")
                ratio = float(ratio) if isinstance(ratio, (int, float)) else 0.5
                return {"axis": "y" if tree.get("axis") == "y" else "x", "ratio": max(0.15, min(0.85, ratio)), "first": first, "second": second}
            return first or second
        layouts = [t for t in (clean_tree(t) for t in (p.get("layouts") if isinstance(p.get("layouts"), list) else [])) if t][:64]
        active = p.get("active") if isinstance(p.get("active"), str) and p.get("active") in ids else ""
        return {**base, "openSessions": clean_ids(p.get("openSessions")), "layouts": layouts,
                "tabOrder": clean_ids(p.get("tabOrder")), "active": active}

    async def workspace_configure(self, peer, p: dict) -> dict:
        current = self.workspace()
        sync = p.get("sync") if isinstance(p.get("sync"), bool) else current["sync"]
        displayed_only = p.get("displayedOnly") if isinstance(p.get("displayedOnly"), bool) else current["displayedOnly"]
        data = {**current, "sync": sync, "displayedOnly": displayed_only and sync}
        if sync and not current["sync"]:
            # The client turning it on seeds the shared workspace with what it shows now.
            data = self._workspace_state(p, data)
        data["revision"] = current["revision"] + 1
        self.state.data["workspace"] = data
        self.state.save()
        await self.broadcast({"type": "workspace.changed", "workspace": self.workspace(), "from": peer.routing_id})
        return self.workspace()

    async def workspace_update(self, peer, p: dict) -> dict:
        current = self.workspace()
        if not current["sync"]:
            raise ValueError("Workspace synchronization is off on this host")
        # Optimistic concurrency: a client that did not see the latest revision is
        # handed the current state instead of overwriting newer changes with stale ones.
        if isinstance(p.get("revision"), int) and p["revision"] != current["revision"]:
            return {**current, "stale": True}
        data = self._workspace_state(p, current)
        if all(data[k] == current[k] for k in ("openSessions", "layouts", "tabOrder", "active")):
            return current
        data["revision"] = current["revision"] + 1
        self.state.data["workspace"] = data
        self.state.save()
        await self.broadcast({"type": "workspace.changed", "workspace": self.workspace(), "from": peer.routing_id})
        return self.workspace()

    async def workspace_prune(self) -> None:
        """Sessions that no longer exist leave the shared workspace."""
        current = self.workspace()
        if not current["sync"]:
            return
        data = self._workspace_state(current, current)
        if any(data[k] != current[k] for k in ("openSessions", "layouts", "tabOrder", "active")):
            data["revision"] = current["revision"] + 1
            self.state.data["workspace"] = data
            self.state.save()
            await self.broadcast({"type": "workspace.changed", "workspace": self.workspace(), "from": ""})

    async def exec_for_upgrade(self, target: Path) -> dict:
        """Replace the runtime in place once in-flight client actions have drained.

        The installer used to give up after a few seconds when a client action was
        still running; the daemon now owns that wait, refuses new shells meanwhile
        and tells every client that the coming disconnection is an expected update.
        """
        if not target.is_file() or not os.access(target, os.X_OK):
            raise ValueError("New host runtime is not executable")
        if self.reexec or self.stopping.is_set():
            raise ValueError("Host is already restarting")
        if self.files.uploads or self.files.downloads:
            raise ValueError("File transfers are active; the update will wait until they finish")
        self.sessions.accepting = False
        try:
            deadline = time.monotonic() + 20
            while self.active_actions and time.monotonic() < deadline:
                await asyncio.sleep(0.05)
            if self.active_actions:
                raise ValueError("Host actions are still finishing; retry the update shortly")
            if self.files.uploads or self.files.downloads:
                raise ValueError("File transfers are active; the update will wait until they finish")
        except BaseException:
            self.sessions.accepting = True
            raise
        self.reexec = str(target)
        await self.broadcast({"type": "host.restarting", "reason": "update", "preservesShells": True,
                              "runtimeId": self.runtime_id})
        # Give the notice a moment to leave the relay before the socket closes.
        asyncio.get_running_loop().call_later(.25, self.stopping.set)
        return {"replacing": True, "preservesShells": True}

    def stop_for_upgrade(self, allow_restart: bool = False) -> dict:
        # Check and close admission in one event-loop turn: no new PTY can appear
        # between the installer's status check and the actual shutdown.
        active = sum(not s.tmux and self.sessions.has_jobs(s) for s in self.sessions.items.values())
        if active and allow_restart is not True:
            raise ValueError(f"{active} plain shells are running. jaunt_ALLOW_RESTART=1 explicitly authorizes terminating them.")
        if (self.files.uploads or self.files.downloads) and allow_restart is not True:
            raise ValueError("File transfers are active; the update will wait until they finish")
        self.sessions.accepting = False
        self.stopping.set()
        return {"stopping": True}

    async def control(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            raw = await asyncio.wait_for(reader.readline(), 5)
            if len(raw) > 7_000_000:
                raise ValueError("Command too large")
            command = json.loads(raw)
            method, p = command.get("method"), command.get("params", {})
            if method == 'ui.connect':
                peer = LocalPeer(self, writer)
                self.peers[peer.routing_id] = peer
                try:
                    await peer.send({'type': 'welcome', 'peer': peer.routing_id,
                                     'machine': self.info(), 'sessions': self.sessions.list()})
                    while raw := await reader.readline():
                        if len(raw) > 200_000:
                            raise ValueError('Local UI frame too large')
                        await peer.dispatch(json.loads(raw))
                finally:
                    self.peers.pop(peer.routing_id, None)
                    self.sessions.detach(peer.routing_id)
                    peer.ready = False
                    await self.sessions_changed()
                    writer.close()
                return
            if method == "status":
                result = {"running": True, "connected": self.transport.ready.is_set(),
                          "pid": os.getpid(), "runtime": sys.executable, "runtimeId": self.runtime_id, "machine": self.info(), "sessions": self.sessions.list(),
                          "activeTransfers": len(self.files.uploads) + len(self.files.downloads)}
            elif method == "pair":
                result = self.pair()
            elif method == "devices":
                result = self.devices()
            elif method == "revoke":
                await self.revoke(p["id"])
                result = {"revoked": True}
            elif method == "notify":
                result = await self.notify(p.get("title", "jaunt"), p.get("body", ""), p.get("session", ""))
            elif method == "clipboard":
                if "text" in p:
                    result = await self.clipboard.set_text(p["text"])
                    await self.broadcast({"type": "clipboard.available"})
                else:
                    result = await self.clipboard.get_text()
            elif method == "updates.install":
                result = self.launch_update(allow_restart=p.get("allowRestart") is True)
            elif method == "upgrade.exec":
                result = await self.exec_for_upgrade(Path(p["python"]).absolute())
            elif method == "upgrade.stop":
                result = self.stop_for_upgrade(p.get("allowRestart", False))
            elif method == "bridge.register":
                result = await self.bridge.register(p)
            elif method == "bridge.peers":
                result = await self.bridge_peers(p)
            elif method == "bridge.send":
                result = await self.bridge_send(p)
            elif method == "bridge.wait":
                result = await self.bridge.wait_reply(self.bridge.resolve(p))
            elif method in ("agents.hosts", "agents.run", "agents.read", "agents.shell", "agents.sessions", "agents.type", "agents.output", "agents.status"):
                result = await self.agents_gateway(method, p)
            elif method in ("agents.configure", "agents.trust", "agents.revoke", "agents.decide", "agents.kill", "agents.cut", "agents.rule", "links.add", "links.update", "links.remove", "links.list"):
                # The CLI acts as the owner at the keyboard; the same handlers serve the UI clients.
                result = await self.rpc(type("CLI", (), {"display_name": "CLI", "device_id": "local-cli"})(), method, p)
            elif method == "stop":
                result = {"stopping": True}
                asyncio.get_running_loop().call_later(0.1, self.stopping.set)
            else:
                raise ValueError("Unknown local command")
            response = {"ok": True, "result": result}
        except Exception as exc:
            response = {"ok": False, "error": str(exc)}
        writer.write((compact(response) + "\n").encode())
        with contextlib.suppress(Exception):
            await writer.drain()
        writer.close()
        with contextlib.suppress(Exception):
            await writer.wait_closed()

    async def watch_programs(self) -> None:
        while True:
            if not self.reexec:
                await self.sessions.refresh_programs()
            await asyncio.sleep(1)

    async def maintenance(self) -> None:
        tick = 0
        while True:
            await asyncio.sleep(5)
            tick += 5
            if tick % 60 == 0:
                self.files.cleanup()
            if self.bridge.enabled and self.bridge.sweep():
                await self.bridge.changed()
            if tick % 300 == 0 and self.peers:
                with contextlib.suppress(Exception):
                    await self.bridge.detect(force=True)
            if self.update_process is not None:
                self.update_process.poll()
            from .updates import installation, status
            config = installation(self.state.root)
            if not config:
                continue
            await self.push_update_status()
            current = status(self.state.root)
            running = self.update_process is not None and self.update_process.poll() is None
            if current.get("state") == "deferred" and not running and not self.reexec and not self.stopping.is_set():
                # A deferred update resumes by itself once the reason has gone away,
                # instead of waiting for the next quarter-hour or for a person.
                transfers = len(self.files.uploads) + len(self.files.downloads)
                shells = sum(bool(s.alive and not s.tmux) for s in self.sessions.items.values())
                blocked = transfers or (shells and current.get("reason") == "shells")
                if not blocked and time.time() - current.get("checkedAt", 0) >= 5:
                    manual = current.get("manual", False)
                    if manual or config.get("automatic", False):
                        with contextlib.suppress(ValueError):
                            self.launch_update(automatic=not manual)
                        continue
            if config.get("automatic", False) and time.monotonic() - self.last_update_check >= 900:
                with contextlib.suppress(ValueError):
                    self.launch_update(automatic=True)

    async def push_update_status(self) -> None:
        """Broadcast update-status.json whenever the detached updater changes it."""
        path = self.state.root / "update-status.json"
        try:
            stamp = path.stat().st_mtime_ns
        except OSError:
            return
        if stamp == self.update_status_stamp:
            return
        self.update_status_stamp = stamp
        from .updates import status
        if self.peers:
            await self.broadcast({"type": "update.progress", **status(self.state.root)})

    async def watch_update(self) -> None:
        """Follow an active update closely so clients see progress as it happens."""
        while True:
            await asyncio.sleep(0.5)
            active = self.update_process is not None and self.update_process.poll() is None
            if active or time.monotonic() - self.update_watch_until < 0:
                await self.push_update_status()

    def launch_update(self, *, automatic: bool = False, allow_restart: bool = False) -> dict:
        from .updates import installation
        if not installation(self.state.root):
            raise ValueError("Use the public installer once to enable automatic updates")
        if self.update_process is not None and self.update_process.poll() is None:
            from .updates import status
            return status(self.state.root)
        python = sys.executable
        if not os.path.exists(python):
            # This runtime's directory was removed (an older installer pruned it after a failed
            # handoff): the installed pointer is the only interpreter left to run the updater.
            from .updates import installation as install_record
            fallback = Path(install_record(self.state.root).get("prefix", "")) / "current/bin/python"
            if not fallback.is_file():
                raise ValueError("The running host's runtime directory was removed; restart the host service (systemctl --user restart jaunt) to load the installed version")
            python = str(fallback)
        args = [python, "-m", "jaunt.updates"]
        if automatic:
            args.append("--automatic")
        elif allow_restart is True:
            args.append("--allow-restart")
        env = os.environ.copy(); env["jaunt_STATE"] = str(self.state.root)
        from .state import atomic_json
        operation = token(12)
        env["jaunt_UPDATE_ID"] = operation
        atomic_json(self.state.root / "update-status.json", {"state": "checking", "checkedAt": time.time(), "operation": operation, "manual": not automatic})
        self.update_process = subprocess.Popen(args, env=env, stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        self.last_update_check = time.monotonic()
        # Keep watching a little after exit so the final state is pushed too.
        self.update_watch_until = time.monotonic() + 3600
        return {"state": "checking", "operation": operation, "manual": not automatic}

    async def run(self) -> None:
        relay_url(self.state.data["relay"], self.state.data["room"])
        handoff = os.environ.pop("jaunt_HANDOFF_FD", "")
        if not handoff:
            from .scrollback import purge as purge_scrollback
            purge_scrollback(self.state.root, set())  # a fresh start has no sessions: drop stale history
        if self.policy.enabled:
            self.links.start_all()
        if handoff:
            from .handoff import restore
            self.lockfile, inherited = restore(self.sessions,int(handoff))
            self.bridge.restore(inherited.get('bridge') or [])
            self.last_update_check = time.monotonic()
            updater=os.environ.pop('jaunt_HANDOFF_UPDATER','')
            if updater:
                from .handoff import InheritedChild
                self.update_process=InheritedChild(int(updater))
                self.update_watch_until = time.monotonic() + 3600
        else:
            self.lockfile = open(self.state.root / "daemon.lock", "a+")
        os.chmod(self.state.root / "daemon.lock", 0o600)
        try:
            fcntl.flock(self.lockfile, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("jaunt is already running") from None
        control_path = self.state.root / "control.sock"
        control_path.unlink(missing_ok=True)
        # Let the detached updater compare against the version really running,
        # not against whatever an interrupted installation last recorded.
        from .state import atomic_json
        atomic_json(self.state.root / "runtime.json", {"version": __version__, "pid": os.getpid(), "runtime": sys.executable})
        server = await asyncio.start_unix_server(self.control, path=control_path, limit=7_000_001)
        os.chmod(control_path, 0o600)
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.add_signal_handler(sig, self.stopping.set)
        transport_task = asyncio.create_task(self.transport.run())
        detection = asyncio.create_task(self.bridge.refresh_integrations())
        detection.add_done_callback(lambda f: f.exception() if not f.cancelled() else None)
        maintenance = asyncio.create_task(self.maintenance())
        update_watch = asyncio.create_task(self.watch_update())
        programs = asyncio.create_task(self.watch_programs())
        state = None
        try:
            while True:
                await self.stopping.wait()
                if self.reexec:
                    try:
                        from .handoff import snapshot
                        state = await snapshot(self.sessions,self.lockfile.fileno(),extra={'bridge':self.bridge.export()})
                    except Exception:
                        # A failed snapshot must leave the old host and PTYs usable.
                        from .state import atomic_json
                        atomic_json(self.state.root/'update-status.json',{'state':'error','message':'Could not prepare the update; existing shells are still running.'})
                        self.reexec=None;self.stopping.clear();self.sessions.accepting=True
                        for session in self.sessions.items.values():
                            session.resizing=False
                            if session.fd>=0:os.set_inheritable(session.fd,False)
                            if session.alive:
                                self.sessions._resume_reader(session)
                            if session.reaper is None or session.reaper.done():session.reaper=asyncio.create_task(self.sessions._reap(session,announce=session.alive))
                        continue
                break
        finally:
            programs.cancel()
            await asyncio.gather(programs, return_exceptions=True)
            maintenance.cancel()
            update_watch.cancel()
            await asyncio.gather(maintenance, update_watch, return_exceptions=True)
            server.close()
            # Local clients must observe EOF immediately, not an online socket
            # that only rejects requests while the old runtime is draining.
            for peer in tuple(self.peers.values()):
                if getattr(peer,'local',False):
                    peer.ready=False;peer.writer.close();peer.task.cancel()
            await self.transport.close()
            transport_task.cancel()
            await self.disconnected()
            if self.reexec:
                env={**os.environ,"jaunt_HANDOFF_FD":str(state.fileno()),"jaunt_STATE":str(self.state.root)}
                if self.update_process is not None and self.update_process.poll() is None:
                    env['jaunt_HANDOFF_UPDATER']=str(self.update_process.pid)
                try:
                    os.execve(self.reexec,[self.reexec,"-m","jaunt.cli","daemon"],env)
                except OSError:
                    # The old runtime is retained on disk. If exec itself fails,
                    # re-enter it with the same handoff instead of closing PTYs.
                    from .state import atomic_json
                    atomic_json(self.state.root/'update-status.json',{'state':'error','message':'Runtime replacement failed; existing shells were preserved.'})
                    os.execve(sys.executable,[sys.executable,"-m","jaunt.cli","daemon"],env)
            await self.agent_shells.shutdown()
            await self.sessions.shutdown()
            self.files.cleanup(all_files=True)
            server.close()
            await server.wait_closed()
            control_path.unlink(missing_ok=True)
            self.lockfile.close()
