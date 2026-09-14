"""Explicit desktop clipboard access, with a headless path fallback in the UI.

A PTY is a byte stream, not the operating system's image clipboard. We do not
pretend a file path is a native Claude/Codex image attachment.
"""
from __future__ import annotations

import asyncio
import os
import shutil
import sys
from pathlib import Path


class Clipboard:
    def __init__(self):
        self.text = ""

    def capabilities(self) -> dict:
        if sys.platform == "darwin" and shutil.which("osascript"):
            return {"text": True, "image": True, "backend": "macOS"}
        if os.environ.get("WAYLAND_DISPLAY") and shutil.which("wl-copy") and shutil.which("wl-paste"):
            return {"text": True, "image": True, "backend": "Wayland"}
        if os.environ.get("DISPLAY") and shutil.which("xclip"):
            return {"text": True, "image": True, "backend": "X11"}
        return {"text": False, "image": False, "backend": "Jaunt buffer (headless)"}

    async def run(self, args: list[str], data: bytes | None = None) -> bytes:
        proc = await asyncio.create_subprocess_exec(*args, stdin=asyncio.subprocess.PIPE,
                                                    stdout=asyncio.subprocess.PIPE,
                                                    stderr=asyncio.subprocess.DEVNULL)
        try:
            output, _ = await asyncio.wait_for(proc.communicate(data), 5)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            raise ValueError("The system clipboard did not respond") from None
        if proc.returncode:
            raise ValueError("The desktop clipboard is unavailable in this host session")
        return output

    async def get_text(self) -> dict:
        backend = self.capabilities()["backend"]
        if backend == "macOS":
            text = await self.run(["pbpaste"])
        elif backend == "Wayland":
            text = await self.run(["wl-paste", "--no-newline", "--type", "text"])
        elif backend == "X11":
            text = await self.run(["xclip", "-selection", "clipboard", "-o"])
        else:
            return {"text": self.text, "source": "Jaunt buffer"}
        if len(text) > 1024 * 1024:
            raise ValueError("The desktop clipboard exceeds 1 MiB; export it to a file instead.")
        return {"text": text.decode("utf-8", errors="replace"), "source": backend}

    async def set_text(self, value: str) -> dict:
        if not isinstance(value, str):
            raise ValueError("Clipboard text must be a string")
        if len(value.encode()) > 1024 * 1024:
            raise ValueError("Clipboard is limited to 1 MiB")
        self.text = value
        backend = self.capabilities()["backend"]
        if backend == "macOS":
            await self.run(["pbcopy"], value.encode())
        elif backend == "Wayland":
            await self._own(["wl-copy", "--type", "text/plain;charset=utf-8"], value.encode())
        elif backend == "X11":
            await self._own(["xclip", "-selection", "clipboard", "-i"], value.encode())
        return {"saved": True, "source": backend}

    async def image(self, source: Path) -> dict:
        if source.stat().st_size > 32 * 1024 * 1024:
            raise ValueError("Native image paste is limited to 32 MiB")
        image = source.read_bytes()
        if not image.startswith(b"\x89PNG\r\n\x1a\n"):
            raise ValueError("Native image paste expects a PNG")
        backend = self.capabilities()["backend"]
        if backend == "macOS":
            await self.run(["osascript", "-e", 'on run argv\nset the clipboard to (read POSIX file (item 1 of argv) as «class PNGf»)\nend run', str(source)])
        elif backend == "Wayland":
            await self._own(["wl-copy", "--type", "image/png"], image)
        elif backend == "X11":
            await self._own(["xclip", "-selection", "clipboard", "-t", "image/png", "-i"], image)
        else:
            raise ValueError("No desktop image clipboard. Use Upload & insert path instead.")
        return {"copied": True, "backend": backend}

    async def _own(self, args: list[str], data: bytes) -> None:
        # Clipboard tools may keep a child alive to own the selection. Do not
        # capture inherited stdout pipes, which would make communicate hang.
        proc = await asyncio.create_subprocess_exec(*args, stdin=asyncio.subprocess.PIPE,
                                                    stdout=asyncio.subprocess.DEVNULL,
                                                    stderr=asyncio.subprocess.DEVNULL)
        assert proc.stdin
        proc.stdin.write(data)
        await proc.stdin.drain()
        proc.stdin.close()
        try:
            await asyncio.wait_for(proc.wait(), 5)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            raise ValueError("Clipboard command timed out") from None
        if proc.returncode:
            raise ValueError("Could not set the image clipboard")
