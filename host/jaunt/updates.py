"""Verified release updates. Automatic mode never authorizes closing plain shells."""
from __future__ import annotations
import argparse
import fcntl
import hashlib
import json
import os
import re
import subprocess
import tempfile
import time
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path
from .state import atomic_json, state_dir

TAG = re.compile(r"v(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)\.(\d+))?$")

def version(tag: str) -> tuple:
    match = TAG.fullmatch(tag)
    if not match:
        raise ValueError("Unsupported release version")
    major, minor, patch, stage, number = match.groups()
    return int(major), int(minor), int(patch), {"alpha": 0, "beta": 1, "rc": 2, None: 3}[stage], int(number or 0)

class HTTPSRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urllib.parse.urlsplit(newurl).scheme != "https":
            raise ValueError("Update redirect must use HTTPS")
        return super().redirect_request(req, fp, code, msg, headers, newurl)

def fetch(url: str, maximum: int) -> bytes:
    if urllib.parse.urlsplit(url).scheme != "https":
        raise ValueError("Updates require HTTPS")
    request = urllib.request.Request(url, headers={"User-Agent": "Jaunt updater", "Cache-Control": "no-cache"})
    with urllib.request.build_opener(HTTPSRedirect()).open(request, timeout=30) as response:
        data = response.read(maximum + 1)
    if len(data) > maximum:
        raise ValueError("Update artifact exceeds its size limit")
    return data

def installation(root: Path | None = None) -> dict:
    path = (root or state_dir()) / "installation.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text())

def status(root: Path | None = None) -> dict:
    root = root or state_dir()
    config = installation(root)
    result = {"supported": bool(config), "automatic": bool(config and config.get("automatic", True))}
    try:
        result.update(json.loads((root / "update-status.json").read_text()))
    except (OSError, ValueError):
        pass
    return result

def configure(enabled: bool) -> dict:
    if type(enabled) is not bool:
        raise ValueError("Automatic update preference must be true or false")
    config = installation()
    if not config:
        raise ValueError("Use the public installer once to enable automatic updates")
    config["automatic"] = enabled
    atomic_json(state_dir() / "installation.json", config)
    return status()

def update(*, automatic: bool = False, allow_restart: bool = False) -> dict:
    from .cli import control
    root = state_dir()
    config = installation(root)
    if not config or (automatic and not config.get("automatic", True)):
        return {"state": "disabled"}
    def record(state: str, **extra) -> dict:
        result = {"state": state, "checkedAt": int(time.time()), **extra}
        atomic_json(root / "update-status.json", result)
        return result
    with open(root / "update.lock", "a") as lock:
        os.chmod(root / "update.lock", 0o600)
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {"state": "checking"}
        try:
            record("checking")
            page = config["page"].rstrip("/")
            repo = config["repository"]
            if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo):
                raise ValueError("Invalid release repository")
            published = json.loads(fetch(page + "/config.json", 16384))
            tag = published["release"]
            if version(tag) <= version(config["tag"]):
                return record("current", version=config["tag"])
            base = f"https://github.com/{repo}/releases/download/{tag}"
            manifest = json.loads(fetch(base + "/host-manifest.json", 16384))
            pep = tag[1:].replace("-alpha.", "a").replace("-beta.", "b").replace("-rc.", "rc")
            name = f"jaunt_host-{pep}-py3-none-any.whl"
            if manifest.get("schema") != 1 or manifest.get("wheel") != name or not re.fullmatch(r"[a-f0-9]{64}", manifest.get("sha256", "")):
                raise ValueError("Invalid release manifest")
            cache = root / "updates"
            cache.mkdir(mode=0o700, exist_ok=True)
            wheel = cache / name
            if not wheel.exists() or hashlib.sha256(wheel.read_bytes()).hexdigest() != manifest["sha256"]:
                data = fetch(base + "/" + name, 16 * 1024 * 1024)
                if hashlib.sha256(data).hexdigest() != manifest["sha256"]:
                    raise ValueError("Release checksum mismatch")
                with tempfile.NamedTemporaryFile(dir=cache, delete=False) as out:
                    out.write(data); staged = Path(out.name)
                os.replace(staged, wheel)
            # Stage first, then defer safely. The installer performs another atomic
            # admission/shutdown check immediately before changing the runtime.
            live = control("status")
            active = sum(bool(s["alive"] and not s.get("tmux")) for s in live["sessions"])
            authorized = allow_restart is True and not automatic
            if active and not authorized:
                return record("deferred", version=tag, activeShells=active,
                              message="Update downloaded. It will install after ordinary shells finish.")
            with zipfile.ZipFile(wheel) as archive:
                info = archive.getinfo("jaunt/installer.sh")
                if info.file_size > 128 * 1024:
                    raise ValueError("Invalid bundled installer")
                script = archive.read(info)
            with tempfile.TemporaryDirectory(prefix="install-", dir=cache) as tmp:
                installer = Path(tmp) / "install.sh"; installer.write_bytes(script)
                env = os.environ.copy()
                # Never inherit restart authorization or dev/source overrides into automatic work.
                for key in list(env):
                    if key.startswith("JAUNT_"):
                        del env[key]
                env.update(JAUNT_STATE=str(root), JAUNT_PAGE_URL=page, JAUNT_REPO=repo,
                           JAUNT_VERSION=tag, JAUNT_PREFIX=config["prefix"], JAUNT_BIN_DIR=config["bin"],
                           JAUNT_SKIP_PAIR="1")
                if config.get("noService"):
                    env["JAUNT_NO_SERVICE"] = "1"
                if authorized:
                    env["JAUNT_ALLOW_RESTART"] = "1"
                record("installing", version=tag)
                fd = os.open(root / "update.log", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
                with os.fdopen(fd, "wb") as log:
                    result = subprocess.run(["bash", str(installer)], env=env, stdout=log, stderr=subprocess.STDOUT, timeout=900)
                if result.returncode:
                    return record("deferred", version=tag, message="Update not applied. The previous runtime was retained; see private update.log.")
            return record("installed", version=tag)
        except Exception as exc:
            return record("error", message=str(exc)[:180])

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--automatic", action="store_true")
    parser.add_argument("--allow-restart", action="store_true")
    args = parser.parse_args()
    result = update(automatic=args.automatic, allow_restart=args.allow_restart)
    print(json.dumps(result))

if __name__ == "__main__":
    main()
