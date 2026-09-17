"""Install and remove the jaunt bridge integrations in Claude Code and Codex.

Changes are targeted, attributable and reversible: hook entries carry a jaunt
marker in their command, MCP servers are named `jaunt-bridge` and registered
through each runtime's own CLI. Existing user hooks, plugins, permissions and
MCP servers are never rewritten. Nothing runs a model.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

MARKER = "jaunt.cli bridge-hook"
MCP_NAME = "jaunt-bridge"
# The bridge's own tools only route messages through the host; allowing them by
# name is what lets a session in "don't ask" or auto mode use the bridge at all.
# Nothing else gains a permission.
TOOL_RULES = [f"mcp__{MCP_NAME}__{tool}" for tool in ("jaunt_peers", "jaunt_send", "jaunt_wait_reply", "jaunt_hosts", "jaunt_run", "jaunt_read", "jaunt_shell")]
HOOK_EVENTS = {
    "claude": ["SessionStart", "UserPromptSubmit", "PostCompact", "Stop", "SessionEnd"],
    "codex": ["SessionStart", "UserPromptSubmit", "PostCompact", "Stop", "SessionEnd"],
}


def runtime_python() -> str:
    """The interpreter that will still exist after host updates: the `current` pointer when installed."""
    from .updates import installation
    prefix = installation().get("prefix")
    candidate = Path(prefix, "current/bin/python") if prefix else None
    if candidate and candidate.exists() and Path(candidate).resolve() != Path(sys.executable).resolve():
        # Only when that runtime actually carries the bridge (an older installed
        # release next to a source checkout would silently break every hook).
        try:
            probe = subprocess.run([str(candidate), "-c", "import jaunt.bridge_client"], capture_output=True, timeout=20)
            if probe.returncode == 0:
                return str(candidate)
        except (OSError, subprocess.SubprocessError):
            pass
    elif candidate and candidate.exists():
        return str(candidate)
    return sys.executable


def state_argument() -> str:
    from .state import state_dir
    return str(state_dir())


def wrapper_dir() -> Path:
    from .state import state_dir
    return state_dir() / "bridge"


def write_wrapper(kind: str, runtime: str) -> Path:
    """A plain executable per runtime: a single path works whether the runtime hands the
    command to a shell or executes it directly, and it survives host updates through the
    `current` pointer. The state directory travels as an argument (no reliance on env)."""
    import shlex
    directory = wrapper_dir()
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = directory / f"{kind}-{runtime}"
    log = shlex.quote(str(directory / "hook.log"))
    python = shlex.quote(runtime_python())
    state = shlex.quote(state_argument())
    if kind == "hook":
        # Never fail the runtime's own hook pipeline: a broken interpreter or a
        # stopped host is recorded in hook.log for diagnosis and exits 0.
        script = ("#!/bin/sh\n# Installed by jaunt (" + MARKER + "). Removed when the bridge is turned off.\n"
                  f"PY={python}\nLOG={log}\n"
                  "if [ ! -x \"$PY\" ]; then printf '%s hook-" + runtime + ": interpreter not executable: %s\\n' \"$(date '+%F %T')\" \"$PY\" >> \"$LOG\" 2>/dev/null; exit 0; fi\n"
                  f"\"$PY\" -m jaunt.cli bridge-hook {runtime} --state {state} \"$@\" 2>>\"$LOG\"\n"
                  "rc=$?\n"
                  "if [ \"$rc\" -ne 0 ]; then printf '%s hook-" + runtime + ": exit %s\\n' \"$(date '+%F %T')\" \"$rc\" >> \"$LOG\" 2>/dev/null; fi\n"
                  "exit 0\n")
    else:
        script = ("#!/bin/sh\n# Installed by jaunt (" + MARKER + "). Removed when the bridge is turned off.\n"
                  f"exec {python} -m jaunt.cli bridge-mcp {runtime} --state {state} \"$@\"\n")
    temp = path.with_suffix(".tmp")
    temp.write_text(script)
    temp.chmod(0o755)
    os.replace(temp, path)
    return path


def hook_command(runtime: str) -> str:
    import shlex
    return shlex.quote(str(write_wrapper("hook", runtime)))


def mcp_command(runtime: str) -> list[str]:
    return [str(write_wrapper("mcp", runtime))]


def remove_wrappers() -> None:
    directory = wrapper_dir()
    if directory.is_dir():
        for child in directory.iterdir():
            child.unlink(missing_ok=True)
        with contextlib_suppress(OSError):
            directory.rmdir()


class contextlib_suppress:
    def __init__(self, *exceptions):
        self.exceptions = exceptions
    def __enter__(self):
        return self
    def __exit__(self, kind, *_):
        return kind is not None and issubclass(kind, self.exceptions)


def mcp_env() -> str:
    from .state import state_dir
    return f"jaunt_STATE={state_dir()}"


def _write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix=".jaunt-", dir=path.parent)
    with os.fdopen(fd, "w") as stream:
        json.dump(value, stream, indent=2)
        stream.write("\n")
    if path.exists():
        shutil.copymode(path, temp)
    os.replace(temp, path)


def _is_ours(hook: dict) -> bool:
    command = str(hook.get("command", "")) if isinstance(hook, dict) else ""
    return MARKER in command or "/bridge/hook-" in command


def add_hooks(settings: dict, runtime: str) -> dict:
    hooks = settings.setdefault("hooks", {})
    if not isinstance(hooks, dict):
        raise ValueError("Unexpected hooks configuration shape; left untouched")
    for event in HOOK_EVENTS[runtime]:
        groups = hooks.setdefault(event, [])
        if not isinstance(groups, list):
            raise ValueError(f"Unexpected {event} hooks shape; left untouched")
        # Replace only our own entries; keep every user-defined group as it is.
        groups[:] = [g for g in groups if not (isinstance(g, dict) and all(_is_ours(h) for h in g.get("hooks", [])) and g.get("hooks"))]
        # Codex clamps SessionEnd hooks to 3 s and warns about longer timeouts.
        timeout = 3 if event == "SessionEnd" else 10
        groups.append({"hooks": [{"type": "command", "command": hook_command(runtime), "timeout": timeout}]})
    return settings


def remove_hooks(settings: dict) -> dict:
    hooks = settings.get("hooks")
    if not isinstance(hooks, dict):
        return settings
    for event in list(hooks):
        groups = hooks.get(event)
        if not isinstance(groups, list):
            continue
        kept = []
        for group in groups:
            if isinstance(group, dict) and isinstance(group.get("hooks"), list):
                remaining = [h for h in group["hooks"] if not _is_ours(h)]
                if not remaining and group["hooks"]:
                    continue
                group = {**group, "hooks": remaining}
            kept.append(group)
        if kept:
            hooks[event] = kept
        else:
            del hooks[event]
    if not hooks:
        settings.pop("hooks", None)
    return settings


def add_tool_rules(settings: dict) -> dict:
    permissions = settings.setdefault("permissions", {})
    if not isinstance(permissions, dict):
        raise ValueError("Unexpected permissions shape; left untouched")
    allow = permissions.setdefault("allow", [])
    if not isinstance(allow, list):
        raise ValueError("Unexpected permissions.allow shape; left untouched")
    for rule in TOOL_RULES:
        if rule not in allow:
            allow.append(rule)
    return settings


def remove_tool_rules(settings: dict) -> dict:
    permissions = settings.get("permissions")
    if isinstance(permissions, dict) and isinstance(permissions.get("allow"), list):
        permissions["allow"] = [r for r in permissions["allow"] if r not in TOOL_RULES]
        if not permissions["allow"]:
            del permissions["allow"]
        if not permissions:
            settings.pop("permissions", None)
    return settings


def claude_settings_path() -> Path:
    return Path(os.environ.get("CLAUDE_CONFIG_DIR", Path.home() / ".claude")) / "settings.json"


def codex_hooks_path() -> Path:
    return Path(os.environ.get("CODEX_HOME", Path.home() / ".codex")) / "hooks.json"


def _load(path: Path) -> dict:
    if not path.exists():
        return {}
    data = json.loads(path.read_text() or "{}")
    if not isinstance(data, dict):
        raise ValueError(f"{path} is not a JSON object")
    return data


def _run(command: list[str], timeout: int = 60) -> subprocess.CompletedProcess:
    env = {k: v for k, v in os.environ.items() if not k.startswith("CLAUDE") and k != "CLAUDECODE"}
    return subprocess.run(command, capture_output=True, text=True, timeout=timeout, env=env, stdin=subprocess.DEVNULL)


def install_claude(path: str, mcp_only: bool = False) -> dict:
    settings_path = claude_settings_path()
    # Agents and machines alone needs the MCP server and its allow rules, not the session hooks.
    settings = add_tool_rules(_load(settings_path) if mcp_only else add_hooks(_load(settings_path), "claude"))
    _write_json(settings_path, settings)
    # The runtime's own CLI keeps its MCP store consistent; the name is ours alone.
    _run([path, "mcp", "remove", "--scope", "user", MCP_NAME])
    result = _run([path, "mcp", "add", "--scope", "user", MCP_NAME, "-e", mcp_env(), "--", *mcp_command("claude")])
    if result.returncode:
        remove_hooks_file(settings_path)
        return {"ok": False, "error": "claude mcp add failed: " + (result.stderr or result.stdout).strip()[:160]}
    return {"ok": True, "hooks": str(settings_path), "mcp": MCP_NAME}


def uninstall_claude(path: str) -> dict:
    remove_hooks_file(claude_settings_path())
    if path:
        _run([path, "mcp", "remove", "--scope", "user", MCP_NAME])
    return {"ok": True}


def remove_hooks_file(path: Path) -> None:
    if path.exists():
        remaining = remove_tool_rules(remove_hooks(_load(path)))
        if remaining:
            _write_json(path, remaining)
        else:
            path.unlink()  # jaunt created it; leave nothing behind


def install_codex(path: str, mcp_only: bool = False) -> dict:
    hooks_path = codex_hooks_path()
    if not mcp_only:
        _write_json(hooks_path, add_hooks(_load(hooks_path), "codex"))
    _run([path, "mcp", "remove", MCP_NAME])
    result = _run([path, "mcp", "add", MCP_NAME, "--env", mcp_env(), "--", *mcp_command("codex")])
    if result.returncode:
        remove_hooks_file(hooks_path)
        return {"ok": False, "error": "codex mcp add failed: " + (result.stderr or result.stdout).strip()[:160]}
    return {"ok": True, "hooks": str(hooks_path), "mcp": MCP_NAME}


def uninstall_codex(path: str) -> dict:
    remove_hooks_file(codex_hooks_path())
    if path:
        _run([path, "mcp", "remove", MCP_NAME])
    return {"ok": True}


def install(runtimes: dict, mcp_only: bool = False) -> dict:
    results = {}
    for name, installer in (("claude", install_claude), ("codex", install_codex)):
        if name not in runtimes:
            continue
        try:
            results[name] = installer(runtimes[name]["path"], mcp_only)
        except Exception as exc:
            results[name] = {"ok": False, "error": str(exc)[:160]}
    return results


def uninstall(runtimes: dict) -> dict:
    results = {}
    for name, remover in (("claude", uninstall_claude), ("codex", uninstall_codex)):
        try:
            results[name] = remover(runtimes.get(name, {}).get("path") or shutil.which(name) or "")
        except Exception as exc:
            results[name] = {"ok": False, "error": str(exc)[:160]}
    remove_wrappers()
    return results


def installed(runtimes: dict) -> dict:
    """What is actually present on disk right now, independent of the stored preference."""
    state = {}
    for name, path in (("claude", claude_settings_path()), ("codex", codex_hooks_path())):
        try:
            hooks = _load(path).get("hooks", {})
            present = any(_is_ours(h) for groups in hooks.values() if isinstance(groups, list)
                          for g in groups if isinstance(g, dict) for h in g.get("hooks", []))
        except (OSError, ValueError):
            present = False
        state[name] = {"hooks": present}
    return state
