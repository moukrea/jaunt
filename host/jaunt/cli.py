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
from .i18n import tr,configure as configure_language,save as save_language,LANGUAGES
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


def daemon_alive() -> bool:
    """True while some process holds the daemon lock, including one mid-handoff."""
    path = state_dir() / "daemon.lock"
    try:
        with open(path, "a+") as lock:
            import fcntl
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                return True
            fcntl.flock(lock, fcntl.LOCK_UN)
    except OSError:
        pass
    return False


def wait_for_control(seconds: float) -> bool:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            control("status")
            return True
        except (OSError, ValueError, RuntimeError):
            time.sleep(0.1)
    return False


def service_unit_exists() -> bool:
    if platform.system() == "Linux" and shutil.which("systemctl"):
        return (Path.home() / ".config/systemd/user/jaunt.service").exists()
    return False


def start() -> None:
    try:
        control("status")
        return
    except (OSError, ValueError):
        pass
    # A daemon replacing its runtime briefly has no control socket. Spawning a
    # second daemon here would only fail on the lock after a slow timeout.
    if daemon_alive():
        if wait_for_control(15):
            return
        raise RuntimeError("A jaunt host is already running but did not answer. Read host.log.")
    state = State()
    if not state.data["relay"]:
        raise RuntimeError("Relay not configured. Run jaunt init --relay wss://YOUR-RELAY.workers.dev")
    logpath = state.root / "host.log"
    # Prefer the installed user service so the daemon stays managed by it.
    if service_unit_exists() and os.environ.get("jaunt_NO_SERVICE") != "1":
        started = subprocess.run(["systemctl", "--user", "start", "jaunt.service"], capture_output=True, text=True)
        if started.returncode == 0 and wait_for_control(10):
            return
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
        preserve = os.environ.get("jaunt_PRESERVE_DAEMON") == "1"
        if not preserve:
          with contextlib.suppress(OSError):
            control("upgrade.stop", {"allowRestart": os.environ.get("jaunt_ALLOW_RESTART") == "1"})
            time.sleep(0.6)
        subprocess.run(["systemctl", "--user", "daemon-reload"], check=True)
        envs = [key for key in ("DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "XAUTHORITY") if os.environ.get(key)]
        if envs:
            subprocess.run(["systemctl", "--user", "import-environment", *envs], check=False)
        running = False
        if preserve:
            try:
                control("status"); running = True
            except (OSError, ValueError, RuntimeError):
                running = False
        managed = subprocess.run(["systemctl", "--user", "is-active", "--quiet", "jaunt.service"]).returncode == 0
        if running and not managed:
            # The live daemon was started outside systemd (for example by the desktop
            # app). Starting the unit now would spawn a second daemon that fails on
            # the lock and restarts forever. Enable it for the next login instead.
            subprocess.run(["systemctl", "--user", "enable", "jaunt.service"], check=True)
            print(tr('User service enabled; the running host and its shells were kept.'))
        else:
            subprocess.run(["systemctl", "--user", "enable", "--now", "jaunt.service"], check=True)
            print(tr('User service installed. For startup before login: loginctl enable-linger "$USER"'))
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
        if os.environ.get("jaunt_PRESERVE_DAEMON") != "1":
          with contextlib.suppress(OSError):
            control("upgrade.stop", {"allowRestart": os.environ.get("jaunt_ALLOW_RESTART") == "1"})
            time.sleep(0.6)
        if os.environ.get("jaunt_PRESERVE_DAEMON") == "1":
            print(tr('Login service updated; active shells preserved.'))
            return
        domain = f"gui/{os.getuid()}"
        subprocess.run(["launchctl", "bootout", domain, str(dest)], capture_output=True)
        subprocess.run(["launchctl", "bootstrap", domain, str(dest)], check=True)
        print(tr('Login service installed.'))
    else:
        raise RuntimeError("No user service manager found. jaunt start still works; it won't auto-start after reboot.")


def main() -> None:
    language_arg=next((arg.split('=',1)[1] for arg in sys.argv[1:] if arg.startswith('--language=')),None)
    if '--language' in sys.argv and sys.argv.index('--language')+1<len(sys.argv):language_arg=sys.argv[sys.argv.index('--language')+1]
    configure_language(language_arg);argparse._=tr
    parser = argparse.ArgumentParser(prog="jaunt", description=tr('Your own shell. Anywhere.'))
    parser.add_argument("--language",choices=("system",*LANGUAGES),help=tr('Override the display language'))
    parser.add_argument("--version", action="version", version=__version__)
    sub = parser.add_subparsers(dest="command", required=True)
    language_parser=sub.add_parser("language",help=tr('Set the display language for this host'))
    language_parser.add_argument("language",choices=("system",*LANGUAGES))
    init = sub.add_parser("init", help=tr('Configure this host (existing identity is preserved)'))
    init.add_argument("--relay")
    init.add_argument("--page")
    init.add_argument("--name")
    sub.add_parser("desktop-bridge", help=argparse.SUPPRESS)
    for hidden in ("bridge-hook", "bridge-mcp"):
        hidden_parser = sub.add_parser(hidden, help=argparse.SUPPRESS)
        hidden_parser.add_argument("runtime", choices=("claude", "codex"))
        hidden_parser.add_argument("--state", default="")
    gui = sub.add_parser("gui", help=tr('Install or open the desktop workspace'))
    gui.add_argument("--install-only", action="store_true", help=tr('Install the desktop app and application icon without opening it'))
    sub.add_parser("start", help=tr('Start the host in the background'))
    sub.add_parser("daemon", help=tr('Run in the foreground (used by the service)'))
    sub.add_parser("stop", help=tr('Stop the host; plain PTYs will close'))
    sub.add_parser("status")
    update = sub.add_parser("update", help=tr('Check and apply a verified host release; active ordinary shells are preserved'))
    update.add_argument("--allow-restart", action="store_true", help=tr('Explicitly authorize closing active ordinary shells'))
    sub.add_parser("doctor", help=tr('Diagnose relay, runtime, clipboard and persistence'))
    pair = sub.add_parser("pair", help=tr('Show a one-use, ten-minute QR and pairing string'))
    pair.add_argument("--json", action="store_true")
    pair.add_argument("--qr-svg", action="store_true", help=tr('Include a QR image in JSON for the native desktop UI'))
    pair.add_argument("--no-qr", action="store_true")
    sub.add_parser("devices")
    link = sub.add_parser("link", help=tr('Link this host to another jaunt host (paste its pairing code)'))
    link.add_argument("code")
    sub.add_parser("links", help=tr('List linked hosts'))
    unlink = sub.add_parser("unlink", help=tr('Remove a linked host'))
    unlink.add_argument("room")
    agents = sub.add_parser("agents", help=tr('Agents and machines: pending requests, decisions, trust, log'))
    agents.add_argument("action", choices=["status", "pending", "allow", "deny", "trust", "block", "revoke", "log", "shells", "kill", "cut"])
    agents.add_argument("target", nargs="?", default="")
    agents.add_argument("--right", choices=["exec", "type"], default="exec")
    agents.add_argument("--trust", choices=["1h", "24h", "always"], default="")
    rev = sub.add_parser("revoke")
    rev.add_argument("id")
    notify = sub.add_parser("notify", help=tr('Notify connected browsers and registered push subscriptions'))
    notify.add_argument("title")
    notify.add_argument("--body", default="")
    notify.add_argument("--session", default=os.environ.get("jaunt_SESSION_ID", ""))
    clip = sub.add_parser("clip", aliases=["clipboard"], help=tr('Share stdin as text with jaunt, or read the remote clipboard'))
    clip.add_argument("--get", action="store_true")
    run = sub.add_parser("run", help=tr('Run a local command, then notify on completion'))
    run.add_argument("args", nargs=argparse.REMAINDER)
    service = sub.add_parser("service")
    service.add_argument("action", choices=["install", "stop", "uninstall"])
    args = parser.parse_args()
    try:
        if args.command == "language":
            save_language(args.language);print(tr("Language preference saved."))
        elif args.command == "desktop-bridge":
            from .desktop import bridge
            asyncio.run(bridge())
        elif args.command in ("bridge-hook", "bridge-mcp"):
            if args.state:
                os.environ["jaunt_STATE"] = args.state
            from .bridge_client import hook_main, mcp_main
            sys.exit((hook_main if args.command == "bridge-hook" else mcp_main)(args.runtime))
        elif args.command == "gui":
            from .desktop import install_gui
            desktop = Path.home() / ".local/share/jaunt-desktop/current" / ("jaunt.app/Contents/MacOS/jaunt" if platform.system() == "Darwin" else "jaunt-desktop")
            system_desktop = shutil.which("jaunt-desktop") if platform.system() == "Linux" else None
            restricted=Path("/proc/sys/kernel/apparmor_restrict_unprivileged_userns")
            needs_package=restricted.exists() and restricted.read_text().strip()=="1" and not system_desktop
            if args.install_only or needs_package:
                desktop = install_gui()
            elif system_desktop:
                desktop = Path(system_desktop)
            elif not desktop.is_file():
                desktop = install_gui()
            if not args.install_only:
                subprocess.Popen([str(desktop)], start_new_session=True, stdin=subprocess.DEVNULL)
        elif args.command == "update":
            start()
            try:
                record = json.loads((state_dir() / "runtime.json").read_text())
                os.kill(int(record["pid"]), 0)
                if not Path(record["runtime"]).exists():
                    print("jaunt: " + tr("The running host executes a runtime whose files were removed. Restart it to load the installed version: systemctl --user restart jaunt (shells end)."), file=sys.stderr)
            except (OSError, ValueError, KeyError, TypeError):
                pass
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
            print(tr('Configured {0}. Identity saved privately in {1}.' ,state.data['name'],state.root))
        elif args.command == "daemon":
            logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
            from .daemon import Host
            async def run_host():
                await Host(State()).run()
            asyncio.run(run_host())
        elif args.command == "start":
            start()
            print(tr('jaunt is running. Run jaunt pair to add a device.'))
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
                print(tr('\n  jaunt  /  Pair this machine\n'))
                if not args.no_qr:
                    import qrcode
                    qr = qrcode.QRCode(border=2, error_correction=qrcode.constants.ERROR_CORRECT_L)
                    qr.add_data(result["url"])
                    qr.print_ascii(invert=True)
                print("\n" + tr("Open or scan (expires in 10 minutes, one use):") + "\n" + result["url"])
                print("\n" + tr("Or paste this complete string into jaunt:") + "\n" + result["code"] + "\n")
                print(tr('Treat this code like a password. Never put it in an issue or a build log.'))
        elif args.command == "revoke":
            print(json.dumps(control("revoke", {"id": args.id}), indent=2))
        elif args.command == "link":
            print(json.dumps(control("links.add", {"code": args.code})["links"], indent=2))
        elif args.command == "links":
            print(json.dumps(control("links.list"), indent=2))
        elif args.command == "unlink":
            print(json.dumps(control("links.remove", {"room": args.room})["links"], indent=2))
        elif args.command == "agents":
            if args.action == "status":
                print(json.dumps(control("agents.status"), indent=2))
            elif args.action == "pending":
                print(json.dumps(control("agents.status")["pending"], indent=2))
            elif args.action in ("allow", "deny"):
                decision = "deny" if args.action == "deny" else (args.trust or "once")
                print(json.dumps(control("agents.decide", {"id": args.target, "decision": decision}), indent=2))
            elif args.action in ("trust", "block"):
                level = "block" if args.action == "block" else "trust"
                print(json.dumps(control("agents.trust", {"requester": args.target, "right": args.right, "level": level, "duration": args.trust or "always"})["requesters"], indent=2))
            elif args.action == "revoke":
                print(json.dumps(control("agents.revoke", {"all": True} if args.target in ("", "all") else {"requesters": [args.target]})["requesters"], indent=2))
            elif args.action == "log":
                print(json.dumps(control("agents.status")["log"], indent=2))
            elif args.action == "shells":
                print(json.dumps(control("agents.status")["agentShells"], indent=2))
            elif args.action == "kill":
                print(json.dumps(control("agents.kill", {"shell": args.target})["agentShells"], indent=2))
            elif args.action == "cut":
                print(json.dumps(control("agents.cut", {"session": args.target})["log"][-1], indent=2))
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
                               "hostClipboard": status["machine"]["clipboard"], "runtime": status.get("runtime", ""),
                               "runtimePresent": bool(status.get("runtime")) and Path(status["runtime"]).exists()})
                if not result["runtimePresent"]:
                    result["warning"] = "The running host's runtime files were removed; restart the host service to load the installed version."
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
        print("jaunt: "+tr(str(exc)), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
