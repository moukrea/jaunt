from __future__ import annotations

import json
import os
import socket
import tempfile
from pathlib import Path
from .crypto import token


def state_dir() -> Path:
    return Path(os.environ.get("jaunt_STATE", Path.home() / ".local/share/jaunt")).expanduser()


def atomic_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temp = tempfile.mkstemp(prefix=".state-", dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w") as stream:
            json.dump(value, stream, separators=(",", ":"))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


class State:
    def __init__(self, root: Path | None = None):
        self.root = (root or state_dir()).resolve()
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self.root, 0o700)
        self.path = self.root / "host.json"
        if self.path.exists():
            self.data = json.loads(self.path.read_text())
        else:
            self.data = {
                "version": 1, "name": socket.gethostname(), "room": token(18),
                "hostToken": token(), "clientToken": token(), "devices": {}, "pairs": {},
                "relay": "", "page": "https://moukrea.github.io/jaunt/", "push": {},
                "maxFileBytes": 512 * 1024 * 1024,
            }
            self.save()
        os.chmod(self.path, 0o600)
        (self.root / "attachments").mkdir(exist_ok=True, mode=0o700)

    def save(self) -> None:
        atomic_json(self.path, self.data)
