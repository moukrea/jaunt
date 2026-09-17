"""Outbound link from this host to another jaunt host, as one of its paired devices.

Host A enrolls on host B exactly like a phone would: a one-use pairing code from B, the
same hello/challenge/proof handshake, a device secret of its own, the same encrypted
channel and RPC framing. B can see it in its device list (kind "host") and revoke it.
Nothing new cryptographically; B's relay carries the frames.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import random
import time
from typing import Any

from cryptography.hazmat.primitives.asymmetric import ec
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed

from .crypto import Channel, b64, compact, proof, public_key, token, transcript, unb64, verify
from .transport import relay_url

log = logging.getLogger("jaunt")


def parse_pairing(value: str) -> dict:
    """The `jaunt1.…` string or the page URL with `#pair=`, as the web client reads it."""
    encoded = value.strip()
    if encoded.lower().startswith("jaunt1."):
        encoded = encoded[7:]
    elif "#pair=" in encoded:
        encoded = encoded.split("#pair=", 1)[1].split("&", 1)[0]
    try:
        data = json.loads(unb64(encoded, 6000))
    except Exception:
        raise ValueError("This is not a valid jaunt pairing code") from None
    if data.get("v") != 1 or len(unb64(data.get("t", ""))) != 32 or len(unb64(data.get("s", ""))) != 32:
        raise ValueError("Unsupported or incomplete pairing code")
    return {"room": data["h"], "relay": str(data["r"]).rstrip("/"), "relayToken": data["t"], "pairId": data["p"],
            "pairSecret": data["s"], "name": str(data.get("n") or "Remote machine")[:80]}


class HostLink:
    """One outbound connection to one remote host. `record` is persisted by the owner."""

    def __init__(self, record: dict, identity: dict, on_message, persist):
        self.record, self.identity, self.on_message, self.persist = record, identity, on_message, persist
        self.state = "offline"
        self.ws = None
        self.channel: Channel | None = None
        self.pending: dict[str, asyncio.Future] = {}
        self.task: asyncio.Task | None = None
        self.stopping = False
        self.lock = asyncio.Lock()
        self.online = asyncio.Event()
        self.last_error = ""
        self.machine: dict = {}

    def start(self) -> None:
        if self.task is None or self.task.done():
            self.stopping = False
            self.task = asyncio.create_task(self.run())

    async def stop(self) -> None:
        self.stopping = True
        if self.task:
            self.task.cancel()
            with contextlib.suppress(Exception):
                await self.task
        self._offline("stopped")

    def _offline(self, reason: str) -> None:
        self.state, self.channel, self.online = "offline", None, asyncio.Event()
        for future in self.pending.values():
            if not future.done():
                future.set_exception(ConnectionError("Link to the remote host was interrupted"))
        self.pending.clear()
        self.last_error = reason

    async def run(self) -> None:
        delay = 0.5
        while not self.stopping:
            try:
                async with connect(relay_url(self.record["relay"], self.record["room"]), max_size=160_000, max_queue=32,
                                   open_timeout=20, ping_interval=25, ping_timeout=20, close_timeout=3, compression=None) as ws:
                    self.ws = ws
                    await ws.send(json.dumps({"type": "auth", "role": "client", "token": self.record["relayToken"]}))
                    ready = json.loads(await asyncio.wait_for(ws.recv(), 20))
                    if ready.get("type") != "ready":
                        raise ConnectionError("Relay refused the link")
                    self.state = "waiting"
                    if ready.get("hostOnline"):
                        await self.handshake()
                    delay = 0.5
                    async for raw in ws:
                        if raw == "pong":
                            continue
                        message = json.loads(raw)
                        kind = message.get("type")
                        if kind == "host.online":
                            await self.handshake()
                        elif kind == "host.offline":
                            self._offline("remote host offline"); self.state = "waiting"
                        elif kind == "route":
                            await self.receive(message.get("data"))
            except asyncio.CancelledError:
                break
            except Exception as exc:
                self.last_error = str(exc)[:120] or type(exc).__name__
                log.info("Link to %s down (%s); retrying", self.record.get("name"), type(exc).__name__)
            finally:
                self.ws = None
                self._offline(self.last_error)
            if not self.stopping:
                await asyncio.sleep(delay * random.uniform(0.8, 1.2))
                delay = min(delay * 1.7, 30)

    async def plain(self, data: dict) -> None:
        if self.ws is None:
            raise ConnectionError("Link is offline")
        await self.ws.send(json.dumps({"type": "route", "data": data}))

    async def handshake(self) -> None:
        self.state = "authenticating"
        self.channel = None
        private = ec.generate_private_key(ec.SECP256R1())
        auth = "device" if self.record.get("secret") else "pair"
        hello = {"type": "hello", "v": 1, "auth": auth, "id": self.record["deviceId"], "nonce": token(), "pub": public_key(private)}
        if auth == "pair":
            hello["pair"] = self.record["pairId"]
        self.hello = hello
        self.private = private
        await self.plain(hello)

    async def receive(self, m: Any) -> None:
        if not isinstance(m, dict):
            return
        if m.get("type") == "error":
            self.last_error = str(m.get("message", ""))[:160]
            if m.get("code") in ("unknown-device", "pair-expired"):
                self.state = "refused"
            self._offline(self.last_error)
            return
        if m.get("type") == "challenge" and self.state == "authenticating":
            secret = unb64(self.record["pairSecret"] if self.hello["auth"] == "pair" else self.record["secret"])
            text = transcript(self.record["room"], self.hello, m["nonce"], m["pub"])
            if not verify(secret, "server", text, m.get("mac", "")):
                raise ConnectionError("Remote host identity verification failed")
            channel = Channel(self.private, m["pub"], secret, text, server=False)
            await self.plain({"type": "proof", "mac": proof(secret, "client", text)})
            self.channel = channel
            del self.private
            return
        if self.channel is None:
            return
        value = self.channel.open(m)
        kind = value.get("type")
        if kind == "pair.ready":
            fresh = token()
            await self.send({"type": "enroll", "secret": fresh, "name": self.identity["name"], "kind": "host", "room": self.identity["room"]})
            self.record["secret"] = fresh
            self.record.pop("pairSecret", None); self.record.pop("pairId", None)
            await self.persist()
        elif kind == "welcome":
            self.machine = value.get("machine") or {}
            self.record["name"] = self.machine.get("name", self.record.get("name", ""))
            self.state = "online"
            self.online.set()
            await self.persist()
        elif kind == "reply":
            future = self.pending.pop(value.get("id"), None)
            if future and not future.done():
                if value.get("ok"):
                    future.set_result(value.get("result"))
                else:
                    future.set_exception(ValueError(str(value.get("error", "Remote host refused"))[:240]))
        elif kind == "pong":
            pass
        else:
            with contextlib.suppress(Exception):
                await self.on_message(self, value)

    async def send(self, data: dict) -> None:
        async with self.lock:
            if self.channel is None:
                raise ConnectionError("Link is not authenticated")
            await self.plain(self.channel.seal(data))

    async def request(self, method: str, params: dict, timeout: float = 45) -> Any:
        if self.state != "online":
            raise ConnectionError(f"Link to {self.record.get('name') or 'the remote host'} is {self.state}")
        rid = token(9)
        future = asyncio.get_running_loop().create_future()
        self.pending[rid] = future
        try:
            await self.send({"type": "rpc", "id": rid, "method": method, "params": params})
            return await asyncio.wait_for(future, timeout)
        except asyncio.TimeoutError:
            raise ValueError("The remote host did not answer in time") from None
        finally:
            self.pending.pop(rid, None)

    def status(self) -> dict:
        return {"room": self.record["room"], "name": self.record.get("name", ""), "label": self.record.get("label") or self.record.get("name", ""),
                "icon": self.record.get("icon"), "state": self.state,
                "platform": self.machine.get("platform", ""), "user": self.machine.get("user", ""),
                "error": self.last_error if self.state != "online" else ""}


class Links:
    """All outbound links of this host, persisted under `links` in the state."""

    def __init__(self, state, identity: dict, on_message):
        self.state, self.identity, self.on_message = state, identity, on_message
        self.records: dict = state.data.setdefault("links", {})
        self.links: dict[str, HostLink] = {}

    async def persist(self) -> None:
        self.state.save()

    def start_all(self) -> None:
        for room, record in self.records.items():
            self._link(room, record).start()

    async def stop_all(self) -> None:
        for link in list(self.links.values()):
            await link.stop()
        self.links.clear()

    def _link(self, room: str, record: dict) -> HostLink:
        if room not in self.links:
            self.links[room] = HostLink(record, self.identity, self.on_message, self.persist)
        return self.links[room]

    async def add(self, code: str, label: str = "", icon: dict | None = None, self_name: str = "") -> dict:
        """Link from a pairing code. `label`/`icon` are the user's own name and icon for the other
        machine (as chosen in the client); `self_name` is how this host is named there."""
        parsed = parse_pairing(code)
        if parsed["room"] == self.identity["room"]:
            raise ValueError("A host cannot link to itself")
        record = self.records.get(parsed["room"])
        if record and record.get("secret"):
            raise ValueError("This machine is already linked")
        record = {**parsed, "deviceId": "host-" + token(12), "added": time.time()}
        self.decorate(record, label, icon)
        self.records[parsed["room"]] = record
        await self.persist()
        link = self._link(parsed["room"], record)
        if self_name:
            link.identity = {**self.identity, "name": "host: " + str(self_name)[:70]}
        link.start()
        try:
            await asyncio.wait_for(link.online.wait(), 30)
        except asyncio.TimeoutError:
            raise ValueError("The remote host did not complete the link in time: " + (link.last_error or "is it online?"))
        return link.status()

    @staticmethod
    def decorate(record: dict, label: str = "", icon: dict | None = None) -> None:
        """Store the user's own name and icon for the other machine (icon = client shape {name, nodes})."""
        if label:
            record["label"] = str(label)[:80]
        if isinstance(icon, dict) and isinstance(icon.get("nodes"), list) and len(compact(icon)) < 8000:
            record["icon"] = {"name": str(icon.get("name", ""))[:60], "nodes": icon["nodes"]}
        else:
            record.pop("icon", None)

    async def update(self, room: str, label: str = "", icon: dict | None = None) -> None:
        record = self.records.get(room)
        if record is None:
            raise ValueError("Unknown linked machine")
        self.decorate(record, label, icon)
        await self.persist()

    async def remove(self, room: str) -> None:
        link = self.links.pop(room, None)
        if link:
            await link.stop()
        self.records.pop(room, None)
        await self.persist()

    def get(self, room_or_name: str) -> HostLink | None:
        if room_or_name in self.records:
            return self._link(room_or_name, self.records[room_or_name])
        wanted = room_or_name.lower()
        for room, record in self.records.items():
            if record.get("label", "").lower() == wanted or record.get("name", "").lower() == wanted:
                return self._link(room, record)
        return None

    def list(self) -> list[dict]:
        return [self._link(room, record).status() for room, record in self.records.items()]
