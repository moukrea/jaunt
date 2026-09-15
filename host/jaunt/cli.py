from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import logging
import os
import platform
import shlex
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path

from . import __version__
from .state import State, state_dir


def control(method: str, params: dict | None = None) -> object:
    with socket.socket(socket.AF_UNIX) as sock:
        sock.settimeout(60)
        sock.connect(str(state_dir() / "control.sock"))
        sock.sendall((json.dumps({"method": method, "params": params or {}}) + "\n").encode())
        data = b""
        while not data.endswith(b"\n"):
            chunk = sock.recv(65536)
            if not chunk:
                break
            data += chunk
            if len(data) > 7_000_000:
                raise RuntimeError("Unexpected response size")
    response = json.loads(data)
    if not response.get("ok"):
        raise RuntimeError(response.get("error", "Local request failed"))
    return response["result"]


def start() -> None:
    try:
        control("status")
        return
    except (OSError, ValueError):
        pass
    state = State()
    if not state.data["relay"]:
        raise RuntimeError("Relay not configured. Run jaunt init --relay wss://YOUR-RELAY.workers.dev")
    logpath = state.root / "host.log"
    fd = os.open(logpath, os.O_CREAT | os.O_APPEND | os.O_WRONLY, 0o600)
    with os.fdopen(fd, "a") as output:
        subprocess.Popen([sys.executable, "-m", "jaunt.cli", "daemon"],
                         stdin=subprocess.DEVNULL, stdout=output, stderr=output,
                         start_new_session=True, cwd=Path.home())
    for _ in range(60):
        time.sleep(0.1)
        try:
            control("status")
            return
        except (OSError, ValueError):
            continue
    raise RuntimeError(f"Host did not start. Read {logpath}")


def service_install() -> None:
    exe = str(Path(sys.executable).absolute())
    root = str(state_dir().resolve())
    if platform.system() == "Linux" and shutil.which("systemctl"):
        def quoted(s: str) -> str:
            return '"' + s.replace('\\', '\\\\').replace('"', '\\"').replace('%', '%%') + '"'
        unit = Path.home() / ".config/systemd/user/jaunt.service"
        unit.parent.mkdir(parents=True, exist_ok=True)
        unit.write_text(f'''[Unit]
Description=jaunt encrypted remote shell host
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart={quoted(exe)} -m jaunt.cli daemon
Environment={quoted("jaunt_STATE=" + root)}
Restart=on-failure
RestartSec=3
UMask=0077
KillMode=process
TimeoutStopSec=15

[Install]
WantedBy=default.target
''')
        with contextlib.suppress(OSError):
            control("upgrade.stop", {"allowRestart": os.environ.get("jaunt_ALLOW_RESTART") == "1"})
            time.sleep(0.6)
        subprocess.run(["systemctl", "--user", "daemon-reload"], check=True)
        envs = [key for key in ("DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "XAUTHORITY") if os.environ.get(key)]
        if envs:
            subprocess.run(["systemctl", "--user", "import-environment", *envs], check=False)
        subprocess.run(["systemctl", "--user", "enable", "--now", "jaunt.service"], check=True)
        print("User service installed. For startup before login: loginctl enable-linger \"$USER\"")
    elif platform.system() == "Darwin":
        import plistlib
        dest = Path.home() / "Library/LaunchAgents/dev.jaunt.host.plist"
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(plistlib.dumps({"Label": "dev.jaunt.host",
                                        "ProgramArguments": [exe, "-m", "jaunt.cli", "daemon"],
                                        "EnvironmentVariables": {"jaunt_STATE": root},
                                        "RunAtLoad": True, "KeepAlive": True,
                                        "StandardOutPath": str(Path(root) / "host.log"),
                                        "StandardErrorPath": str(Path(root) / "host.log")}))
        with contextlib.suppress(OSError):
            control("upgrade.stop", {"allowRestart": os.environ.get("jaunt_ALLOW_RESTART") == "1"})
            time.sleep(0.6)
        domain = f"gui/{os.getuid()}"
        subprocess.run(["launchctl", "bootout", domain, str(dest)], capture_output=True)
        subprocess.run(["launchctl", "bootstrap", domain, str(dest)], check=True)
        print("Login service installed.")
    else:
        raise RuntimeError("No user service manager found. jaunt start still works; it won't auto-start after reboot.")


def main() -> None:
    parser = argparse.ArgumentParser(prog="jaunt", description="Your own shell. Anywhere.")
    parser.add_argument("--version", action="version", version=__version__)
    sub = parser.add_subparsers(dest="command", required=True)
    init = sub.add_parser("init", help="Configure this host (existing identity is preserved)")
    init.add_argument("--relay")
    init.add_argument("--page")
    init.add_argument("--name")
    sub.add_parser("desktop-bridge", help=argparse.SUPPRESS)
    gui = sub.add_parser("gui", help="Install or open the desktop workspace")
    gui.add_argument("--install-only", action="store_true", help="Install the desktop app and application icon without opening it")
    sub.add_parser("start", help="Start the host in the background")
    sub.add_parser("daemon", help="Run in the foreground (used by the service)")
    sub.add_parser("stop", help="Stop the host; plain PTYs will close")
    sub.add_parser("status")
    update = sub.add_parser("update", help="Check and apply a verified host release; active ordinary shells are preserved")
    update.add_argument("--allow-restart", action="store_true", help="Explicitly authorize closing active ordinary shells")
    sub.add_parser("doctor", help="Diagnose relay, runtime, clipboard and persistence")
    pair = sub.add_parser("pair", help="Show a one-use, ten-minute QR and pairing string")
    pair.add_argument("--json", action="store_true")
    pair.add_argument("--qr-svg", action="store_true", help="Include a QR image in JSON for the native desktop UI")
    pair.add_argument("--no-qr", action="store_true")
    sub.add_parser("devices")
    rev = sub.add_parser("revoke")
    rev.add_argument("id")
    notify = sub.add_parser("notify", help="Notify connected browsers and registered push subscriptions")
    notify.add_argument("title")
    notify.add_argument("--body", default="")
    notify.add_argument("--session", default=os.environ.get("jaunt_SESSION_ID", ""))
    clip = sub.add_parser("clip", aliases=["clipboard"], help="Share stdin as text with jaunt, or read the remote clipboard")
    clip.add_argument("--get", action="store_true")
    run = sub.add_parser("run", help="Run a local command, then notify on completion")
    run.add_argument("args", nargs=argparse.REMAINDER)
    service = sub.add_parser("service")
    service.add_argument("action", choices=["install", "stop", "uninstall"])
    args = parser.parse_args()
    try:
        if args.command == "desktop-bridge":
            from .desktop import bridge
            asyncio.run(bridge())
        elif args.command == "gui":
            from .desktop import install_gui
            desktop = Path.home() / ".local/share/jaunt-desktop/current" / ("jaunt.app/Contents/MacOS/jaunt" if platform.system() == "Darwin" else "jaunt-desktop")
            system_desktop = shutil.which("jaunt-desktop") if platform.system() == "Linux" else None
            if system_desktop:
                desktop = Path(system_desktop)
            elif args.install_only or not desktop.is_file():
                desktop = install_gui()
            if not args.install_only:
                subprocess.Popen([str(desktop)], start_new_session=True, stdin=subprocess.DEVNULL)
        elif args.command == "update":
            start()
            print(json.dumps(control("updates.install", {"allowRestart": args.allow_restart}), indent=2))
        elif args.command == "init":
            try:
                control("status")
            except (OSError, ValueError):
                pass
            else:
                raise RuntimeError("Stop the running host before changing its configuration; identity will be preserved.")
            state = State()
            for key in ("relay", "page", "name"):
                value = getattr(args, key)
                if value:
                    state.data[key] = value
            if not state.data["relay"]:
                raise RuntimeError("Pass --relay wss://YOUR-RELAY.workers.dev")
            from .transport import relay_url
            relay_url(state.data["relay"], state.data["room"])
            state.save()
            print(f'Configured {state.data["name"]}. Identity saved privately in {state.root}.')
        elif args.command == "daemon":
            logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
            from .daemon import Host
            async def run_host():
                await Host(State()).run()
            asyncio.run(run_host())
        elif args.command == "start":
            start()
            print("jaunt is running. Run jaunt pair to add a device.")
        elif args.command == "pair":
            start()
            for _ in range(80):
                if control("status")["connected"]:
                    break
                time.sleep(0.25)
            else:
                raise RuntimeError("The host is not connected to its relay. Read host.log before pairing.")
            result = control("pair")
            if args.json:
                if args.qr_svg:
                    import base64, io, qrcode
                    from qrcode.image.svg import SvgPathImage
                    image = qrcode.make(result["url"], image_factory=SvgPathImage, border=4)
                    output = io.BytesIO()
                    image.save(output)
                    result["qr"] = base64.b64encode(output.getvalue()).decode()
                print(json.dumps(result))
            else:
                print("\n  jaunt  /  Pair this machine\n")
                if not args.no_qr:
                    import qrcode
                    qr = qrcode.QRCode(border=2, error_correction=qrcode.constants.ERROR_CORRECT_L)
                    qr.add_data(result["url"])
                    qr.print_ascii(invert=True)
                print("\nOpen or scan (expires in 10 minutes, one use):\n" + result["url"])
                print("\nOr paste this complete string into jaunt:\n" + result["code"] + "\n")
                print("Treat this code like a password. Never put it in an issue or a build log.")
        elif args.command == "revoke":
            print(json.dumps(control("revoke", {"id": args.id}), indent=2))
        elif args.command == "notify":
            print(json.dumps(control("notify", {"title": args.title, "body": args.body,
                                               "session": args.session}), indent=2))
        elif args.command in ("clip", "clipboard"):
            if args.get:
                print(control("clipboard")["text"], end="")
            else:
                text = sys.stdin.read(1024 * 1024 + 1)
                if len(text.encode()) > 1024 * 1024:
                    raise ValueError("Clipboard is limited to 1 MiB; upload a file instead.")
                control("clipboard", {"text": text})
        elif args.command == "run":
            command = args.args[1:] if args.args[:1] == ["--"] else args.args
            if not command:
                raise RuntimeError("Usage: jaunt run -- COMMAND [ARGUMENTS]")
            status = subprocess.call(command)
            with contextlib.suppress(Exception):
                control("notify", {"title": "Command completed" if status == 0 else "Command failed",
                                   "body": shlex.join(command)[:200] + f" · exit {status}",
                                   "session": os.environ.get("jaunt_SESSION_ID", "")})
            sys.exit(status)
        elif args.command == "doctor":
            from .clipboard import Clipboard
            result = {"version": __version__, "python": sys.version.split()[0], "platform": platform.system(),
                      "stateDirectory": str(state_dir()), "tmux": bool(shutil.which("tmux")),
                      "clipboard": Clipboard().capabilities(), "nativeWindows": False}
            try:
                status = control("status")
                result.update({"running": True, "relayConnected": status["connected"], "sessions": len(status["sessions"]),
                               "hostClipboard": status["machine"]["clipboard"]})
            except OSError:
                result["running"] = False
            result["note"] = "Plain shells survive network loss, not daemon restarts. tmux sessions are independently managed."
            print(json.dumps(result, indent=2))
        elif args.command == "service":
            if args.action == "install":
                service_install()
            elif platform.system() == "Linux" and shutil.which("systemctl"):
                subprocess.run(["systemctl", "--user", "stop", "jaunt.service"], check=False)
                if args.action == "uninstall":
                    subprocess.run(["systemctl", "--user", "disable", "jaunt.service"], check=False)
                    (Path.home() / ".config/systemd/user/jaunt.service").unlink(missing_ok=True)
                    subprocess.run(["systemctl", "--user", "daemon-reload"], check=False)
            elif platform.system() == "Darwin":
                dest = Path.home() / "Library/LaunchAgents/dev.jaunt.host.plist"
                subprocess.run(["launchctl", "bootout", f"gui/{os.getuid()}", str(dest)], check=False)
                if args.action == "uninstall":
                    dest.unlink(missing_ok=True)
            else:
                with contextlib.suppress(OSError):
                    control("stop")
        else:
            print(json.dumps(control(args.command), indent=2))
    except KeyboardInterrupt:
        sys.exit(130)
    except Exception as exc:
        print(f"jaunt: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
