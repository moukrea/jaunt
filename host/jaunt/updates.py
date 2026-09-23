"""Verified release updates. Automatic mode never authorizes closing plain shells.

The updater runs detached from the daemon and reports through the private
``update-status.json`` file. The daemon watches that file and pushes every
change to connected clients, so a client never has to poll aggressively or
guess what happened across the runtime handoff.
"""
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
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path
from . import channels
from .state import atomic_json, state_dir

INSTALL_TIMEOUT = 1800
# The installer's own failure lines are the only ones worth showing to a person.
LOG_FAILURE = re.compile(r"^jaunt: (.+)$")

def version(tag: str) -> dict:
    """A host release tag, production or channel candidate; anything else is refused."""
    info = channels.parse(tag)
    if info["component"] != "host":
        raise ValueError("Unsupported release version")
    return info

def tag_from_version(text: str) -> str:
    """Turn a PEP 440 runtime version such as ``0.1.0b11`` or ``0.1.0b41+ch.moukrea.9.2`` into its release tag."""
    return channels.host_tag(text)

def channel(config: dict) -> str:
    name = config.get("channel", "main")
    return name if name == "main" or channels.publishable(name) else "main"

from .downloads import fetch

def running_tag(root: Path) -> str:
    """Release tag of the daemon actually serving shells, from its private runtime record."""
    try:
        record = json.loads((root / "runtime.json").read_text())
        os.kill(int(record["pid"]), 0)  # A stale record from a stopped daemon proves nothing.
        return tag_from_version(record.get("version", ""))
    except (OSError, ValueError, TypeError, KeyError):
        return ""

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
    # The last run may describe another channel; the configured one is what Settings shows.
    result["channel"] = channel(config)
    return result

def configure(enabled: bool | None = None, name: str | None = None) -> dict:
    """Store the automatic preference and/or the channel. Only a person calls this."""
    if enabled is not None and type(enabled) is not bool:
        raise ValueError("Automatic update preference must be true or false")
    if name is not None and name != "main" and not channels.publishable(name):
        raise ValueError("Unknown update channel name")
    config = installation()
    if not config:
        raise ValueError("Use the public installer once to enable automatic updates")
    if enabled is not None:
        config["automatic"] = enabled
    if name is not None:
        config["channel"] = name
    atomic_json(state_dir() / "installation.json", config)
    return status()

def failure_reason(log: Path) -> str:
    """Extract the installer's last explicit failure line, never raw command output."""
    try:
        lines = log.read_text(errors="replace").splitlines()[-200:]
    except OSError:
        return ""
    for line in reversed(lines):
        match = LOG_FAILURE.match(line.strip())
        if match:
            return match.group(1).strip()[:160]
    return ""

def update(*, automatic: bool = False, allow_restart: bool = False, switch: str = "") -> dict:
    """Install the configured channel's release when it is newer, or whatever it is on an explicit switch.

    ``switch`` names the channel a person just selected. It is honoured only while
    that channel is still the configured one and never on an automatic run.
    """
    from .cli import control
    root = state_dir()
    config = installation(root)
    if not config or (automatic and not config.get("automatic", True)):
        return {"state": "disabled"}
    name = channel(config)
    switching = bool(switch) and not automatic and switch == name
    def record(state: str, **extra) -> dict:
        result = {"state": state, "checkedAt": time.time(), "operation": os.environ.get("jaunt_UPDATE_ID", ""),
                  "manual": not automatic, "channel": name, **extra}
        # A deferred switch must resume as a switch; any other outcome ends it.
        if switching and state in ("checking", "downloading", "verifying", "deferred", "installing"):
            result["switch"] = name
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
            # A development installation (explicit jaunt_DEV_INSTALL=1 at install time)
            # records a loopback mirror so the whole update path can be exercised
            # end to end. Production installations never carry this block.
            dev = config.get("dev") if isinstance(config.get("dev"), dict) else None
            loopback = bool(dev)
            source = page + ("/config.json" if name == "main" else f"/ch/{name}/config.json")
            try:
                published = json.loads(fetch(source, 16384, allow_loopback=loopback))
            except urllib.error.HTTPError as exc:
                if exc.code != 404 or name == "main":
                    return record("error", retryable=True,
                                  message="Could not reach the update channel. Check the host's internet connection and try again.")
                # A merged or closed pull request deletes its channel: keep what is installed.
                return record("channel-missing", version=running_tag(root) or config["tag"],
                              message="This update channel no longer exists. The installed version is kept; switch back to main to follow production.")
            except OSError:
                return record("error", retryable=True,
                              message="Could not reach the update channel. Check the host's internet connection and try again.")
            if name != "main":
                channels.validate_document(published, name, page, repo)
            tag = published["release"]
            version(tag)
            # The running daemon is the truth. An earlier attempt may have switched the
            # installed pointer without completing the runtime handoff; comparing only
            # installation.json would then report "current" forever.
            current = running_tag(root) or config["tag"]
            if tag == current or not (switching or channels.automatic(name, current, tag)):
                if config.get("tag") != current:
                    config["tag"] = current
                    atomic_json(root / "installation.json", config)
                return record("current", version=current)
            base = f"https://github.com/{repo}/releases/download/{tag}"
            if dev and dev.get("releaseBase"):
                base = str(dev["releaseBase"]).rstrip("/")
            try:
                manifest = json.loads(fetch(base + "/host-manifest.json", 16384, allow_loopback=loopback))
            except OSError:
                return record("error", retryable=True, version=tag,
                              message="Could not download the release manifest. Check the host's internet connection and try again.")
            wheel_name = f"jaunt_host-{channels.python_version(tag)}-py3-none-any.whl"
            if manifest.get("schema") != 1 or manifest.get("wheel") != wheel_name or not re.fullmatch(r"[a-f0-9]{64}", manifest.get("sha256", "")):
                raise ValueError("Invalid release manifest")
            cache = root / "updates"
            cache.mkdir(mode=0o700, exist_ok=True)
            wheel = cache / wheel_name
            if not wheel.exists() or hashlib.sha256(wheel.read_bytes()).hexdigest() != manifest["sha256"]:
                record("downloading", version=tag)
                try:
                    data = fetch(base + "/" + wheel_name, 16 * 1024 * 1024, allow_loopback=loopback)
                except OSError:
                    return record("error", retryable=True, version=tag,
                                  message="The release download was interrupted. Check the host's internet connection and try again.")
                record("verifying", version=tag)
                if hashlib.sha256(data).hexdigest() != manifest["sha256"]:
                    raise ValueError("Release checksum mismatch")
                with tempfile.NamedTemporaryFile(dir=cache, delete=False) as out:
                    out.write(data); staged = Path(out.name)
                os.replace(staged, wheel)
                for stale in cache.glob("*.whl"):
                    if stale != wheel:
                        stale.unlink(missing_ok=True)
            # Stage first, then defer safely. The installer performs another atomic
            # admission/shutdown check immediately before changing the runtime.
            live = control("status")
            active = sum(bool(s["alive"] and not s.get("tmux")) for s in live.get("sessions", []))
            authorized = allow_restart is True and not automatic
            seamless = bool(live.get("machine", {}).get("seamlessUpdates"))
            transfers = live.get("activeTransfers", 0)
            if ((active and not seamless) or transfers) and not authorized:
                if transfers:
                    message = "Update downloaded. It will install as soon as file transfers finish."
                else:
                    message = "Update downloaded. This host cannot keep shells across this update; close them, or use Update and restart."
                return record("deferred", version=tag, activeShells=active, activeTransfers=transfers,
                              reason="transfers" if transfers else "shells", message=message)
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
                    if key.lower().startswith("jaunt_"):
                        del env[key]
                env.update(jaunt_STATE=str(root), jaunt_PAGE_URL=page, jaunt_REPO=repo,
                           jaunt_VERSION=tag, jaunt_PREFIX=config["prefix"], jaunt_BIN_DIR=config["bin"],
                           jaunt_SKIP_PAIR="1", jaunt_NO_GUI="1", jaunt_UPDATE_ID=os.environ.get("jaunt_UPDATE_ID", ""))
                if config.get("noService"):
                    env["jaunt_NO_SERVICE"] = "1"
                if dev:
                    env.update(jaunt_DEV_INSTALL="1", jaunt_RELEASE_BASE=base)
                    for key in ("TEST_SYSTEM_SITE", "PIP_NO_DEPS"):
                        if dev.get("env", {}).get(key) == "1":
                            env["jaunt_" + key] = "1"
                if authorized:
                    env["jaunt_ALLOW_RESTART"] = "1"
                record("installing", version=tag, message="Preparing the new runtime…")
                log_path = root / "update.log"
                fd = os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
                try:
                    with os.fdopen(fd, "wb") as log:
                        result = subprocess.run(["bash", str(installer)], env=env, stdout=log, stderr=subprocess.STDOUT,
                                                timeout=INSTALL_TIMEOUT)
                except subprocess.TimeoutExpired:
                    return record("error", version=tag,
                                  message=f"The installer did not finish within {INSTALL_TIMEOUT // 60} minutes. Existing shells were kept; try again.")
                if result.returncode:
                    try:
                        live = control("status")
                    except (OSError, ValueError, RuntimeError):
                        live = {}
                    active = sum(bool(s["alive"] and not s.get("tmux")) for s in live.get("sessions", []))
                    transfers = live.get("activeTransfers", 0)
                    if not authorized and (active and not live.get("machine", {}).get("seamlessUpdates") or transfers):
                        return record("deferred", version=tag, activeShells=active, activeTransfers=transfers,
                                      reason="transfers" if transfers else "shells",
                                      message="Update is waiting for active shells or transfers to finish.")
                    reason = failure_reason(log_path)
                    detail = f": {reason}" if reason else f" (installer exit {result.returncode})"
                    return record("error", version=tag, retryable=True,
                                  message=f"Host update failed{detail}. Existing shells were kept."[:240])
            return record("installed", version=tag, message="Update installed. Shells were kept running.")
        except Exception as exc:
            return record("error", message=str(exc)[:180])

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--automatic", action="store_true")
    parser.add_argument("--allow-restart", action="store_true")
    parser.add_argument("--switch", default="")
    args = parser.parse_args()
    result = update(automatic=args.automatic, allow_restart=args.allow_restart, switch=args.switch)
    print(json.dumps(result))

if __name__ == "__main__":
    main()
