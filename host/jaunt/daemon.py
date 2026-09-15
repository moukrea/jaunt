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
        self.transport = Transport(state.data, self.receive, self.disconnected)
        self.sessions = Sessions(self.send, self.sessions_changed, state.root, self.attention)
        self.files = Files(state.root, state.data.get("maxFileBytes", 512 * 1024 * 1024))
        self.clipboard = Clipboard()
        self.last_notification = 0.0
        self.lockfile = None
        self.update_process = None
        self.last_update_check = -float("inf")

    def info(self) -> dict:
        from .updates import status as update_status
        return {"name": self.state.data["name"], "room": self.state.data["room"],
                "version": __version__, "platform": platform.system(), "user": getpass.getuser(),
                "home": str(Path.home()), "tmux": bool(shutil.which("tmux")),
                "clipboard": self.clipboard.capabilities(), "maxFileBytes": self.files.max_bytes,
                "replayBytes": 2 * 1024 * 1024, "sharedViews": True, "sessionDirectory": True,
                "updates": update_status(self.state.root),
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
        if self.stopping.is_set():
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
        if method == "session.detach":
            session = self.sessions.get(p["id"])
            session.subscribers.discard(peer.routing_id)
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
                          "pid": os.getpid(), "machine": self.info(), "sessions": self.sessions.list(),
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
            elif method == "upgrade.stop":
                result = self.stop_for_upgrade(p.get("allowRestart", False))
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

    async def maintenance(self) -> None:
        while True:
            await asyncio.sleep(60)
            self.files.cleanup()
            if self.update_process is not None:
                self.update_process.poll()
            from .updates import installation
            config = installation(self.state.root)
            if config.get("automatic", False) and time.monotonic() - self.last_update_check >= 900:
                self.launch_update(automatic=True)

    def launch_update(self, *, automatic: bool = False, allow_restart: bool = False) -> dict:
        from .updates import installation
        if not installation(self.state.root):
            raise ValueError("Use the public installer once to enable automatic updates")
        if self.update_process is not None and self.update_process.poll() is None:
            return {"state": "checking"}
        args = [sys.executable, "-m", "jaunt.updates"]
        if automatic:
            args.append("--automatic")
        elif allow_restart is True:
            args.append("--allow-restart")
        env = os.environ.copy(); env["jaunt_STATE"] = str(self.state.root)
        self.update_process = subprocess.Popen(args, env=env, stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        self.last_update_check = time.monotonic()
        return {"state": "checking"}

    async def run(self) -> None:
        relay_url(self.state.data["relay"], self.state.data["room"])
        self.lockfile = open(self.state.root / "daemon.lock", "a+")
        os.chmod(self.state.root / "daemon.lock", 0o600)
        try:
            fcntl.flock(self.lockfile, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("jaunt is already running") from None
        control_path = self.state.root / "control.sock"
        control_path.unlink(missing_ok=True)
        server = await asyncio.start_unix_server(self.control, path=control_path, limit=7_000_001)
        os.chmod(control_path, 0o600)
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.add_signal_handler(sig, self.stopping.set)
        transport_task = asyncio.create_task(self.transport.run())
        maintenance = asyncio.create_task(self.maintenance())
        try:
            await self.stopping.wait()
        finally:
            maintenance.cancel()
            await self.transport.close()
            transport_task.cancel()
            await self.disconnected()
            await self.sessions.shutdown()
            self.files.cleanup(all_files=True)
            server.close()
            await server.wait_closed()
            control_path.unlink(missing_ok=True)
            self.lockfile.close()
