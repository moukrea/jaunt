"""Versioned PSK-authenticated ephemeral ECDH channel, using audited primitives.

The 256-bit pairing/device secret authenticates both ephemeral P-256 keys.
HKDF-SHA256 produces two independent AES-256-GCM keys. Strict per-direction
counters reject replay and reordering. Fresh ephemeral keys on every reconnect.
This protocol is documented in docs/PROTOCOL.md; it has not had an external audit.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
from typing import Any

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF


def b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def unb64(value: str, maximum: int = 2_000_000) -> bytes:
    if not isinstance(value, str) or len(value) > maximum * 2:
        raise ValueError("Invalid encoded data")
    return base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True)


def token(length: int = 32) -> str:
    return b64(secrets.token_bytes(length))


def compact(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=True)


def public_key(key: ec.EllipticCurvePrivateKey) -> str:
    return b64(key.public_key().public_bytes(serialization.Encoding.X962,
                                            serialization.PublicFormat.UncompressedPoint))


def transcript(room: str, hello: dict, nonce: str, public: str) -> bytes:
    return compact(["jaunt-v1", room, hello["auth"], hello["id"],
                    hello.get("pair", ""), hello["nonce"], hello["pub"], nonce, public]).encode()


def proof(secret: bytes, label: str, text: bytes) -> str:
    return b64(hmac.new(secret, label.encode() + b":" + text, hashlib.sha256).digest())


def verify(secret: bytes, label: str, text: bytes, signature: str) -> bool:
    try:
        return hmac.compare_digest(unb64(signature), unb64(proof(secret, label, text)))
    except (ValueError, TypeError):
        return False


class Channel:
    def __init__(self, private: ec.EllipticCurvePrivateKey, peer_public: str,
                 secret: bytes, text: bytes, *, server: bool):
        peer = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), unb64(peer_public, 65))
        shared = private.exchange(ec.ECDH(), peer)
        self.aad = hashlib.sha256(text).digest()
        def derive(direction: str) -> bytes:
            return HKDF(algorithm=hashes.SHA256(), length=32,
                        salt=hashlib.sha256(secret).digest(),
                        info=self.aad + direction.encode()).derive(shared)
        c2h, h2c = derive("jaunt-c2h"), derive("jaunt-h2c")
        self.send_key = AESGCM(h2c if server else c2h)
        self.recv_key = AESGCM(c2h if server else h2c)
        self.sent = 0
        self.received = 0

    def seal(self, value: Any) -> dict:
        self.sent += 1
        if self.sent >= 2**53:
            raise ValueError("Channel exhausted; reconnect")
        nonce = b"\0" * 4 + self.sent.to_bytes(8, "big")
        return {"type": "box", "n": self.sent,
                "ct": b64(self.send_key.encrypt(nonce, compact(value).encode(), self.aad))}

    def open(self, frame: dict) -> Any:
        n = frame.get("n")
        if type(n) is not int or n != self.received + 1:
            raise ValueError("Out-of-order or replayed frame")
        if frame.get("type") != "box":
            raise ValueError("Unencrypted application message")
        nonce = b"\0" * 4 + n.to_bytes(8, "big")
        data = self.recv_key.decrypt(nonce, unb64(frame["ct"]), self.aad)
        value = json.loads(data)
        self.received = n
        return value
