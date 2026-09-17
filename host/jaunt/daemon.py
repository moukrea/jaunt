from __future__ import annotations

import asyncio
import contextlib
import fcntl
import getpass
import json
import logging
import os
import platform
import re
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric import ec

from . import __version__
from .clipboard import Clipboard
from .crypto import Channel, b64, compact, proof, public_key, token, transcript, unb64, verify
from .files import Files
from .notifications import deliver, validate_subscription
from .sessions import Sessions
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
                del pairs[hello["pair"]]
                self.host.state.save()
            if self.device_id not in devices:
                raise ValueError("Device was revoked")
            devices[self.device_id]["lastSeen"] = time.time()
            self.host.state.save()
            self.ready = True
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
                "updates": update_status(self.state.root), "bridge": self.bridge.status(), "workspace": self.workspace(), "scrollback": self.scrollback(),
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
                result = self.bridge.peers_for(self.bridge.resolve(p))
            elif method == "bridge.send":
                result = await self.bridge.send(self.bridge.resolve(p))
            elif method == "bridge.wait":
                result = await self.bridge.wait_reply(self.bridge.resolve(p))
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
        args = [sys.executable, "-m", "jaunt.updates"]
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
            await self.sessions.shutdown()
            self.files.cleanup(all_files=True)
            server.close()
            await server.wait_closed()
            control_path.unlink(missing_ok=True)
            self.lockfile.close()
