from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import random
from collections.abc import Awaitable, Callable
from urllib.parse import urlparse

from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed

log = logging.getLogger("jaunt")


def relay_url(base: str, room: str) -> str:
    parsed = urlparse(base)
    if parsed.scheme not in ("wss", "ws") or not parsed.hostname:
        raise ValueError("Relay must be a wss:// URL")
    if parsed.scheme == "ws" and parsed.hostname not in ("localhost", "127.0.0.1", "::1"):
        raise ValueError("Unencrypted relays are permitted only on loopback")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("Relay URL must not contain credentials, a query or a fragment")
    return base.rstrip("/") + "/v1/room/" + room


class Transport:
    def __init__(self, config: dict, receive: Callable[[dict], Awaitable[None]],
                 disconnected: Callable[[], Awaitable[None]]):
        self.config, self.receive, self.disconnected = config, receive, disconnected
        self.ws = None
        self.ready = asyncio.Event()
        self.lock = asyncio.Lock()
        self.stopping = False
        self.next_send = 0.0

    async def send(self, value: dict) -> None:
        async with self.lock:
            ws = self.ws
            if not ws or not self.ready.is_set():
                raise ConnectionError("Relay is disconnected")
            raw = json.dumps(value, separators=(",", ":"))
            if len(raw.encode()) > 131_000:
                raise ValueError("Application frame exceeds the relay limit")
            loop = asyncio.get_running_loop()
            await asyncio.sleep(max(0, self.next_send - loop.time()))
            self.next_send = loop.time() + max(0.008, len(raw) / (1.5 * 1024 * 1024))
            try:
                await asyncio.wait_for(ws.send(raw), 12)
            except (ConnectionClosed, OSError) as exc:
                # Keep callers such as the PTY output pump alive across an outage.
                # A failed encrypted send also invalidates this transport/channel.
                if self.ws is ws:
                    self.ready.clear()
                with contextlib.suppress(ConnectionClosed, OSError):
                    await ws.close()
                raise ConnectionError("Relay send interrupted") from exc

    async def route(self, peer: str, value: dict) -> None:
        await self.send({"type": "route", "to": peer, "data": value})

    async def run(self) -> None:
        delay = 0.5
        while not self.stopping:
            try:
                async with connect(relay_url(self.config["relay"], self.config["room"]),
                                   max_size=160_000, max_queue=32, open_timeout=20,
                                   ping_interval=25, ping_timeout=20, close_timeout=3,
                                   compression=None) as ws:
                    self.ws = ws
                    await ws.send(json.dumps({"type": "auth", "role": "host",
                                              "token": self.config["hostToken"],
                                              "clientToken": self.config["clientToken"]}))
                    response = json.loads(await asyncio.wait_for(ws.recv(), 20))
                    if response.get("type") != "ready":
                        raise ConnectionError("Relay refused authentication")
                    self.ready.set()
                    delay = 0.5
                    log.info("Relay connected")
                    async for raw in ws:
                        if raw == "pong":
                            continue
                        message = json.loads(raw)
                        await self.receive(message)
            except asyncio.CancelledError:
                break
            except ConnectionClosed as exc:
                # The close code tells a relay rate-limit ("Slow down") from a network drop.
                received = getattr(exc, "rcvd", None)
                code = getattr(received, "code", None); reason = (getattr(received, "reason", "") or "")[:60]
                log.warning("Relay disconnected (%s, code %s %s); reconnecting", type(exc).__name__, code, reason)
            except Exception as exc:
                # Do not log credentials or message bodies.
                log.warning("Relay disconnected (%s); reconnecting", type(exc).__name__)
            finally:
                self.ready.clear()
                self.ws = None
                await self.disconnected()
            if not self.stopping:
                await asyncio.sleep(delay * random.uniform(0.8, 1.2))
                delay = min(delay * 1.7, 30)

    async def close(self) -> None:
        self.stopping = True
        if self.ws:
            await self.ws.close()
