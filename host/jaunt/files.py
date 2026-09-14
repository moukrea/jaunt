"""Chunked transfers with ownership, offsets, SHA-256 and atomic finalization."""
from __future__ import annotations

import hashlib
import mimetypes
import os
import re
import shutil
import stat
import time
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO

from .crypto import b64, unb64, token

CHUNK = 48 * 1024


def path(value: str) -> Path:
    if not isinstance(value, str) or "\0" in value:
        raise ValueError("Invalid path")
    return Path(value or "~").expanduser().absolute()


def basename(value: str) -> str:
    if not isinstance(value, str) or not value or len(value.encode()) > 240:
        raise ValueError("Invalid filename")
    if value in (".", "..") or any(c in value for c in ("/", "\\", "\0")):
        raise ValueError("A filename cannot contain a path")
    return value


@dataclass
class Upload:
    id: str
    owner: str
    file: BinaryIO
    temp: Path
    destination: Path
    size: int
    overwrite: bool
    digest: object
    offset: int = 0
    touched: float = 0


@dataclass
class Download:
    owner: str
    file: BinaryIO
    size: int
    modified: int
    touched: float


class Files:
    def __init__(self, root: Path, max_bytes: int = 512 * 1024 * 1024):
        self.root, self.max_bytes = root, max_bytes
        self.uploads: dict[str, Upload] = {}
        self.downloads: dict[str, Download] = {}
        self.completed: dict[tuple[str, str], dict] = {}

    def listing(self, data: dict) -> dict:
        folder = path(data.get("path", "~")).resolve(strict=True)
        if not folder.is_dir():
            raise ValueError("Not a directory")
        entries = []
        with os.scandir(folder) as scan:
            for item in scan:
                if len(entries) >= 5000:
                    break
                if not data.get("hidden") and item.name.startswith("."):
                    continue
                try:
                    info = item.stat(follow_symlinks=True)
                    entries.append({"name": item.name, "directory": stat.S_ISDIR(info.st_mode),
                                    "link": item.is_symlink(), "size": info.st_size,
                                    "modified": info.st_mtime,
                                    "mode": stat.filemode(info.st_mode)})
                except OSError:
                    entries.append({"name": item.name, "directory": False, "unreadable": True,
                                    "size": 0, "modified": 0})
        entries.sort(key=lambda e: (not e["directory"], e["name"].casefold()))
        free = shutil.disk_usage(folder).free
        offset = max(0, int(data.get("offset", 0)))
        limit = max(1, min(100, int(data.get("limit", 100))))
        page = entries[offset:offset + limit]
        return {"path": str(folder), "parent": str(folder.parent), "entries": page,
                "total": len(entries), "next": offset + len(page) if offset + len(page) < len(entries) else None,
                "truncated": len(entries) == 5000, "free": free}

    def mkdir(self, data: dict) -> dict:
        folder = path(data["path"]) / basename(data["name"])
        folder.mkdir(mode=0o755)
        return {"path": str(folder)}

    def rename(self, data: dict) -> dict:
        source = path(data["path"])
        destination = source.parent / basename(data["name"])
        if destination.exists() or destination.is_symlink():
            raise ValueError("Destination already exists")
        source.rename(destination)
        return {"path": str(destination)}

    def remove(self, data: dict) -> dict:
        source = path(data["path"])
        if source.is_symlink() or source.is_file():
            source.unlink()
        else:
            source.rmdir()  # Deliberately never recursive.
        return {"removed": True}

    def begin_upload(self, owner: str, data: dict) -> dict:
        uid = data.get("id") or token(16)
        if not re.fullmatch(r"[A-Za-z0-9_-]{8,80}", uid):
            raise ValueError("Invalid transfer identifier")
        if (owner, uid) in self.completed:
            return {**self.completed[(owner, uid)], "complete": True}
        if uid in self.uploads:
            item = self._upload(owner, uid)
            if item.size != int(data["size"]):
                raise ValueError("Transfer size changed")
            return {"id": uid, "offset": item.offset, "size": item.size}
        size = int(data["size"])
        if size < 0 or size > self.max_bytes:
            raise ValueError(f"The upload limit is {self.max_bytes // 1048576} MiB per file")
        if len(self.uploads) >= 8 or sum(u.size for u in self.uploads.values()) + size > 1024**3:
            raise ValueError("Too many active transfers; finish or cancel one first")
        attachment = bool(data.get("attachment"))
        directory = self.root / "attachments" if attachment else path(data.get("path", "~"))
        directory = directory.resolve(strict=True)
        name = basename(data["name"])
        if attachment:
            name = uid[:12] + "-" + name
        destination = directory / name
        overwrite = bool(data.get("overwrite", False)) and not attachment
        if (destination.exists() or destination.is_symlink()) and not overwrite:
            raise ValueError("A file with this name already exists")
        if shutil.disk_usage(directory).free < size + 1024 * 1024:
            raise ValueError("Not enough free space")
        temporary = directory / (".jaunt-upload-" + uid)
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        stream = os.fdopen(fd, "wb", buffering=0)
        self.uploads[uid] = Upload(uid, owner, stream, temporary, destination, size,
                                   overwrite, hashlib.sha256(), touched=time.time())
        return {"id": uid, "offset": 0, "size": size}

    def _upload(self, owner: str, uid: str) -> Upload:
        item = self.uploads.get(uid)
        if not item or item.owner != owner:
            raise ValueError("Unknown transfer")
        item.touched = time.time()
        return item

    def upload_chunk(self, owner: str, data: dict) -> dict:
        item = self._upload(owner, data["id"])
        raw = unb64(data["data"], CHUNK)
        if len(raw) > CHUNK or not raw:
            raise ValueError("Invalid chunk size")
        if int(data["offset"]) != item.offset:
            return {"offset": item.offset, "retry": True}
        if item.offset + len(raw) > item.size:
            raise ValueError("Chunk exceeds the declared file size")
        written = item.file.write(raw)
        if written != len(raw):
            raise OSError("Short file write")
        item.digest.update(raw)
        item.offset += len(raw)
        return {"offset": item.offset}

    def finish_upload(self, owner: str, data: dict) -> dict:
        if (owner, data["id"]) in self.completed:
            return self.completed[(owner, data["id"])]
        item = self._upload(owner, data["id"])
        if item.offset != item.size:
            raise ValueError("Upload is incomplete")
        digest = item.digest.hexdigest()
        if data.get("sha256") and data["sha256"] != digest:
            raise ValueError("SHA-256 mismatch; the file was not committed")
        item.file.flush()
        os.fsync(item.file.fileno())
        item.file.close()
        try:
            if item.overwrite:
                os.replace(item.temp, item.destination)
            else:
                os.link(item.temp, item.destination)  # Atomic no-clobber, no TOCTOU overwrite.
                item.temp.unlink()
        except Exception:
            item.temp.unlink(missing_ok=True)
            del self.uploads[item.id]
            raise
        result = {"id": item.id, "path": str(item.destination), "size": item.size,
                  "offset": item.size, "sha256": digest}
        self.completed[(owner, item.id)] = result
        if len(self.completed) > 200:
            self.completed.pop(next(iter(self.completed)))
        del self.uploads[item.id]
        return result

    def cancel_upload(self, owner: str, data: dict) -> dict:
        item = self._upload(owner, data["id"])
        item.file.close()
        item.temp.unlink(missing_ok=True)
        del self.uploads[item.id]
        return {"cancelled": True}

    def begin_download(self, owner: str, data: dict) -> dict:
        if len(self.downloads) >= 16:
            raise ValueError("Too many open downloads")
        source = path(data["path"])
        # Opening a FIFO normally would block the entire host event loop.
        fd = os.open(source, os.O_RDONLY | os.O_NONBLOCK)
        stream = os.fdopen(fd, "rb")
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode):
            stream.close()
            raise ValueError("Only regular files can be downloaded")
        if info.st_size > self.max_bytes:
            stream.close()
            raise ValueError("File exceeds the host transfer limit")
        uid = token(16)
        self.downloads[uid] = Download(owner, stream, info.st_size, info.st_mtime_ns, time.time())
        return {"id": uid, "name": source.name, "size": info.st_size,
                "mime": mimetypes.guess_type(source.name)[0] or "application/octet-stream"}

    def download_chunk(self, owner: str, data: dict) -> dict:
        item = self.downloads.get(data["id"])
        if not item or item.owner != owner:
            raise ValueError("Unknown download")
        offset = int(data["offset"])
        if not 0 <= offset <= item.size:
            raise ValueError("Invalid offset")
        current = os.fstat(item.file.fileno())
        if current.st_size != item.size or current.st_mtime_ns != item.modified:
            raise ValueError("The file changed during download; start again")
        item.file.seek(offset)
        raw = item.file.read(CHUNK)
        item.touched = time.time()
        return {"offset": offset, "data": b64(raw), "done": offset + len(raw) == item.size}

    def close_download(self, owner: str, data: dict) -> dict:
        item = self.downloads.get(data["id"])
        if item and item.owner == owner:
            item.file.close()
            del self.downloads[data["id"]]
        return {"closed": True}

    def cleanup(self, *, all_files: bool = False) -> None:
        cutoff = time.time() - 3600
        for uid, item in tuple(self.uploads.items()):
            if all_files or item.touched < cutoff:
                self.cancel_upload(item.owner, {"id": uid})
        for uid, item in tuple(self.downloads.items()):
            if all_files or item.touched < cutoff:
                self.close_download(item.owner, {"id": uid})
