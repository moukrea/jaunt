"""On-disk terminal history per session, so a client can scroll back further than the
in-memory replay ring, and load it lazily.

Layout: <state>/scrollback/<session id>/seg-<start offset>.bin — raw PTY bytes, one
segment per SEGMENT_BYTES, the newest appended to. Absolute stream offsets make every
segment self-describing: no index, no sidecar, and a session that survives an in-place
host update simply reopens its directory. Files are private (0600 in a 0700 directory)
like the rest of the state directory. The oldest segments are dropped beyond MAX_BYTES.
"""
from __future__ import annotations

import os
import shutil
from pathlib import Path

SEGMENT_BYTES = 8 * 1024 * 1024
MAX_BYTES = 32 * 1024 * 1024
MAX_READ = 512 * 1024


class Scrollback:
    def __init__(self, root: Path, sid: str, max_bytes: int = MAX_BYTES):
        self.dir = root / "scrollback" / sid
        self.max_bytes = max_bytes
        self.fd = -1
        self.segments: list[tuple[int, int, Path]] = []  # (start, size, path), oldest first
        self.dir.mkdir(parents=True, exist_ok=True)
        os.chmod(self.dir, 0o700)
        for path in sorted(self.dir.glob("seg-*.bin"), key=lambda p: int(p.stem[4:])):
            self.segments.append((int(path.stem[4:]), path.stat().st_size, path))

    @property
    def start(self) -> int | None:
        return self.segments[0][0] if self.segments else None

    @property
    def end(self) -> int | None:
        return self.segments[-1][0] + self.segments[-1][1] if self.segments else None

    def append(self, offset: int, data: bytes) -> None:
        if not data:
            return
        if self.segments and self.segments[-1][0] + self.segments[-1][1] != offset:
            # A hole (should not happen) or a fresh start: begin a new segment at this offset.
            self._close()
        if self.fd < 0 or self.segments[-1][1] >= SEGMENT_BYTES:
            self._close()
            path = self.dir / f"seg-{offset}.bin"
            self.fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
            self.segments.append((offset, 0, path))
        os.write(self.fd, data)
        start, size, path = self.segments[-1]
        self.segments[-1] = (start, size + len(data), path)
        while len(self.segments) > 1 and sum(s[1] for s in self.segments) > self.max_bytes:
            _, _, old = self.segments.pop(0)
            with __import__("contextlib").suppress(OSError):
                old.unlink()

    def read(self, before: int, limit: int) -> tuple[int, bytes]:
        """Bytes of the stream ending at `before`, at most `limit` (older bytes first)."""
        limit = max(0, min(limit, MAX_READ))
        if not self.segments:
            return before, b""
        begin = max(self.start, before - limit)
        out = bytearray()
        for start, size, path in self.segments:
            end = start + size
            lo, hi = max(begin, start), min(before, end)
            if lo < hi:
                with open(path, "rb") as f:
                    f.seek(lo - start)
                    out += f.read(hi - lo)
        return begin, bytes(out)

    def _close(self) -> None:
        if self.fd >= 0:
            os.close(self.fd)
            self.fd = -1

    def close(self) -> None:
        self._close()

    def delete(self) -> None:
        self._close()
        shutil.rmtree(self.dir, ignore_errors=True)
        self.segments = []


def purge(root: Path, keep: set[str]) -> None:
    """Remove history of sessions that no longer exist (after a restart that lost them)."""
    base = root / "scrollback"
    if not base.is_dir():
        return
    for child in base.iterdir():
        if child.name not in keep:
            shutil.rmtree(child, ignore_errors=True)
