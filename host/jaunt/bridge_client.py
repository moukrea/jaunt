"""Runtime-side clients for the jaunt bridge: the hook command and the MCP server.

Both run inside a Claude Code or Codex session started from a jaunt shell, so
they inherit `jaunt_SESSION_ID` and `jaunt_STATE` from that PTY. Outside a
jaunt shell, or when the bridge is turned off, they do nothing and say nothing:
the user's ordinary sessions are never touched.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path


def jaunt_session() -> str:
    return os.environ.get("jaunt_SESSION_ID") or os.environ.get("JAUNT_SESSION_ID") or ""


def control(method: str, params: dict, timeout: float = 60) -> dict:
    """Same private socket as the CLI, with a timeout that covers bounded waits."""
    import socket
    from .state import state_dir
    with socket.socket(socket.AF_UNIX) as sock:
        sock.settimeout(timeout)
        sock.connect(str(state_dir() / "control.sock"))
        sock.sendall((json.dumps({"method": method, "params": params}) + "\n").encode())
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


def project_of(cwd: str) -> dict:
    """Workspace identity from reliable facts: real path, git toplevel, worktree common dir."""
    real = os.path.realpath(cwd)
    project = {"root": real, "common": "", "kind": "dir"}
    try:
        out = subprocess.run(["git", "-C", real, "rev-parse", "--show-toplevel", "--git-common-dir"],
                             capture_output=True, text=True, timeout=5, stdin=subprocess.DEVNULL)
    except (OSError, subprocess.SubprocessError):
        return project
    if out.returncode:
        return project
    lines = out.stdout.splitlines()
    if len(lines) >= 2:
        top = os.path.realpath(lines[0].strip())
        if top == os.path.realpath(os.path.expanduser("~")):
            return project  # a home directory under version control is not a project boundary
        common = lines[1].strip()
        common = os.path.realpath(common if os.path.isabs(common) else os.path.join(top, common))
        project.update(root=top, common=common, kind="worktree" if common != os.path.join(top, ".git") else "git")
    return project


def mode_class(runtime: str, permission_mode: str) -> str:
    """Whether this session bypasses permission prompts, in the terms Claude Code's
    inbound gate uses: a bypassing session only auto-accepts peers that bypass too."""
    mode = str(permission_mode or "").lower()
    if not mode:
        return ""
    if runtime == "claude":
        return "bypass" if mode in ("bypasspermissions", "auto") else "prompting"
    # Codex: full-access / never-ask style modes bypass prompts.
    return "bypass" if any(word in mode for word in ("yolo", "bypass", "danger", "full", "never")) else "prompting"


def claude_inbox() -> dict:
    return {"socket": os.environ.get("CLAUDE_CODE_MESSAGING_SOCKET", ""), "sessionPid": os.environ.get("CLAUDE_PID", "")}


def hook_main(runtime: str) -> int:
    """Called by the runtime for each configured hook event with JSON on stdin."""
    session = jaunt_session()
    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except ValueError:
        return 0
    event_name = str(payload.get("hook_event_name", ""))
    event = {"SessionStart": "start", "UserPromptSubmit": "prompt", "PostCompact": "compact", "Stop": "stop",
             "SessionEnd": "end", "PreToolUse": "tool", "PostToolUse": "tool"}.get(event_name, "")
    conversation = str(payload.get("session_id") or "")
    if not event or not conversation:
        return 0
    cwd = str(payload.get("cwd") or os.getcwd())
    pid = os.getppid()
    if runtime == "claude" and os.environ.get("CLAUDE_PID", "").isdigit():
        pid = int(os.environ["CLAUDE_PID"])
    # The host recognises the hook by the terminal it runs in, so a stripped
    # environment (no jaunt_SESSION_ID) still registers; outside a jaunt shell the
    # host answers with a refusal and nothing is printed.
    request = {"runtime": runtime, "session": session, "conversation": conversation, "pid": pid, "hookPid": os.getpid(),
               "cwd": cwd, "event": event, "source": str(payload.get("source", "")), "project": project_of(cwd),
               "modeClass": mode_class(runtime, str(payload.get("permission_mode", ""))),
               "inbox": claude_inbox() if runtime == "claude" else {}}
    try:
        result = control("bridge.register", request, timeout=15)
    except Exception:
        return 0  # host stopped, bridge off or not a jaunt shell: stay silent
    context = result.get("context") if isinstance(result, dict) else ""
    if context and event in ("start", "prompt", "compact"):
        print(json.dumps({"hookSpecificOutput": {"hookEventName": event_name, "additionalContext": context}}))
    return 0


# ---- minimal MCP stdio server (JSON-RPC 2.0, protocol 2024-11-05) ----------------

TOOLS = [
    {"name": "jaunt_peers",
     "description": "List the sessions of the OTHER runtime (Codex for a Claude Code caller, Claude Code for a Codex caller) working on the same project through jaunt, with their ids and availability. Sessions of your own runtime are never listed here: on Claude Code use ListAgents / SendMessage for those.",
     "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "jaunt_send",
     "description": "Send a message to another AI session listed by jaunt_peers. It arrives in that session's own conversation, attributed to you through the jaunt bridge. Use in_reply_to when answering a bridge message. Replies always arrive later as bridge messages, so leave wait_seconds unset unless you cannot continue without the answer (then up to 600); never wait for a greeting or a notice that needs no reply.",
     "inputSchema": {"type": "object", "required": ["to", "text"], "additionalProperties": False,
                     "properties": {"to": {"type": "string", "description": "Peer id from jaunt_peers or from a bridge message"},
                                    "text": {"type": "string", "description": "The message"},
                                    "in_reply_to": {"type": "string", "description": "Id of the bridge message you are answering"},
                                    "wait_seconds": {"type": "integer", "minimum": 0, "maximum": 600}}}},
    {"name": "jaunt_wait_reply",
     "description": "Wait (bounded) for a reply to a message you sent with jaunt_send, identified by its message id.",
     "inputSchema": {"type": "object", "required": ["id"], "additionalProperties": False,
                     "properties": {"id": {"type": "string"}, "seconds": {"type": "integer", "minimum": 1, "maximum": 600}}}},
]

# Agents and machines: listed only while that switch is on for this host (see mcp_main).
AGENT_TOOLS = [
    {"name": "jaunt_hosts",
     "description": "List the other machines linked to this host through jaunt, with their platform, link state and what this session is allowed to do there (exec: run commands; each machine's owner decides, may ask first, may refuse). Nothing about these machines is injected in your context: call this when you need it.",
     "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "jaunt_run",
     "description": "Run ONE shell command on a linked machine (its owner's login shell, no TTY). The target machine may ask its owner for permission first (the call then waits up to 2 minutes) or refuse. Output over 64 KiB is kept in a file on that machine: read it with jaunt_read. Never use this against the machine you already run on.",
     "inputSchema": {"type": "object", "required": ["host", "command"], "additionalProperties": False,
                     "properties": {"host": {"type": "string", "description": "Machine name from jaunt_hosts"},
                                    "command": {"type": "string"}, "cwd": {"type": "string", "description": "Working directory on that machine"},
                                    "timeout_seconds": {"type": "integer", "minimum": 1, "maximum": 600}}}},
    {"name": "jaunt_shell",
     "description": "A background shell of your own on a linked machine, for a sequence of steps that share state (cd, environment, several commands, a long process). Actions: open (cwd optional; the owner may be asked once), send (a line of input; enter appended unless enter=false), read (output from an offset, 64 KiB max), close, list. The shell dies when you close it, after 10 minutes without a call, when your session ends, or when the owner revokes you. It is never one of the owner's own shells.",
     "inputSchema": {"type": "object", "required": ["host", "action"], "additionalProperties": False,
                     "properties": {"host": {"type": "string"}, "action": {"type": "string", "enum": ["open", "send", "read", "close", "list"]},
                                    "shell": {"type": "string", "description": "Shell id from open"}, "input": {"type": "string"}, "enter": {"type": "boolean"},
                                    "cwd": {"type": "string"}, "offset": {"type": "integer", "minimum": 0}, "limit": {"type": "integer", "minimum": 1, "maximum": 65536}}}},
    {"name": "jaunt_read",
     "description": "Read a slice of the full output of an earlier jaunt_run (its 'run' id), 64 KiB at a time.",
     "inputSchema": {"type": "object", "required": ["host", "run"], "additionalProperties": False,
                     "properties": {"host": {"type": "string"}, "run": {"type": "string"},
                                    "offset": {"type": "integer", "minimum": 0}, "limit": {"type": "integer", "minimum": 1, "maximum": 65536}}}},
]


def agents_enabled() -> bool:
    try:
        return bool(control("agents.status", {}, timeout=5).get("enabled"))
    except Exception:
        return False


def _identity(runtime: str) -> dict:
    # Runtimes may start MCP servers with a reduced environment (Codex does).
    # The host can still recognise this process as a descendant of one of its
    # shells, so the pid is always sent along with whatever the env provides.
    conversation = os.environ.get("CLAUDE_CODE_SESSION_ID", "") if runtime == "claude" else ""
    return {"runtime": runtime, "session": jaunt_session(), "conversation": conversation or "current", "pid": os.getpid()}


def _tool(runtime: str, name: str, args: dict) -> str:
    identity = _identity(runtime)
    try:
        if name == "jaunt_peers":
            result = control("bridge.peers", identity)
            if not result.get("enabled"):
                return result.get("note", "The jaunt bridge is turned off on this host.")
            peers = result.get("peers", [])
            lines = [f"- {p['runtime']} session in terminal \"{p['terminal']}\" (id {p['id']}), cwd {p['cwd']}, {p['state']}" for p in peers]
            lines += [f"- {p['runtime']} session open in terminal \"{p['terminal']}\" (cwd {p['cwd']}) but not reachable yet: it joins the bridge after its first prompt"
                      for p in result.get("present", [])]
            if not lines:
                return "No other AI session of the other runtime is working on this project through jaunt right now."
            return "\n".join(lines)
        if name == "jaunt_send":
            result = control("bridge.send", {**identity, "to": args.get("to", ""), "text": args.get("text", ""),
                                             "inReplyTo": args.get("in_reply_to", "")})
            text = f"Delivered to {result['to']} (message id {result['id']}). It is now in that session's conversation; a reply, if any, arrives as a bridge message."
            wait = int(args.get("wait_seconds") or 0)
            if wait > 0:
                waited = control("bridge.wait", {**identity, "id": result["id"], "seconds": wait}, timeout=wait + 20)
                return text + "\n" + _describe_wait(waited)
            return text
        if name == "jaunt_wait_reply":
            seconds = int(args.get("seconds") or 60)
            waited = control("bridge.wait", {**identity, "id": args.get("id", ""), "seconds": seconds}, timeout=seconds + 20)
            return _describe_wait(waited)
        if name == "jaunt_hosts":
            hosts = control("agents.hosts", identity, timeout=30).get("hosts", [])
            if not hosts:
                return "No machine is linked to this host yet (Settings → Agents and machines → Link a machine)."
            lines = []
            for h in hosts:
                rights = h.get("rights") or {}
                allowed = {"ask": "asks its owner before each command", "trust": "trusted: commands run at once", "block": "blocked: commands are refused"}.get(rights.get("exec"), rights.get("error", "unknown"))
                lines.append(f"- {h['name']} ({h.get('platform') or '?'}, user {h.get('user') or '?'}) — link {h['state']}; exec: {allowed}")
            return "\n".join(lines)
        if name == "jaunt_run":
            timeout = args.get("timeout_seconds")
            result = control("agents.run", {**identity, "host": args.get("host", ""), "command": args.get("command", ""), "cwd": args.get("cwd"), "timeoutSec": timeout},
                             timeout=(int(timeout) if timeout else 60) + 170)
            return json.dumps(result, ensure_ascii=False)
        if name == "jaunt_shell":
            result = control("agents.shell", {**identity, "host": args.get("host", ""), "action": args.get("action", ""), "shell": args.get("shell"), "input": args.get("input"),
                                              "enter": args.get("enter", True), "cwd": args.get("cwd"), "offset": args.get("offset", 0), "limit": args.get("limit", 65536)}, timeout=190)
            if "data" in result:
                import base64
                data = base64.urlsafe_b64decode(result["data"] + "=" * (-len(result["data"]) % 4))
                result = {**{k: v for k, v in result.items() if k != "data"}, "text": data.decode("utf-8", "replace")}
            return json.dumps(result, ensure_ascii=False)
        if name == "jaunt_read":
            result = control("agents.read", {**identity, "host": args.get("host", ""), "run": args.get("run", ""), "offset": args.get("offset", 0), "limit": args.get("limit", 65536)}, timeout=30)
            import base64
            data = base64.urlsafe_b64decode(result["data"] + "=" * (-len(result["data"]) % 4))
            return json.dumps({**{k: v for k, v in result.items() if k != "data"}, "text": data.decode("utf-8", "replace")}, ensure_ascii=False)
    except Exception as exc:
        return f"jaunt bridge: {exc}"
    return "Unknown tool"


def _describe_wait(waited: dict) -> str:
    state = waited.get("state")
    if state == "replied":
        reply = waited.get("reply", {})
        return f"Reply from {reply.get('from')} (message id {reply.get('id')}):\n{reply.get('text', '')}"
    return f"No reply yet ({state}: {waited.get('detail', '')})."


def mcp_main(runtime: str) -> int:
    stdin = sys.stdin.buffer
    stdout = sys.stdout.buffer

    def reply(rid, result=None, error=None):
        frame = {"jsonrpc": "2.0", "id": rid}
        if error is not None:
            frame["error"] = error
        else:
            frame["result"] = result
        stdout.write((json.dumps(frame) + "\n").encode())
        stdout.flush()

    for raw in stdin:
        raw = raw.strip()
        if not raw:
            continue
        try:
            message = json.loads(raw)
        except ValueError:
            continue
        method, rid, params = message.get("method"), message.get("id"), message.get("params") or {}
        if method == "initialize":
            reply(rid, {"protocolVersion": params.get("protocolVersion", "2024-11-05"),
                        "capabilities": {"tools": {}},
                        "serverInfo": {"name": "jaunt-bridge", "version": "1"},
                        "instructions": ("jaunt bridge: other AI sessions (Claude Code or Codex) working on this project through jaunt "
                                         "are announced to you as context and can be contacted with jaunt_send. Messages from them arrive "
                                         "tagged [jaunt bridge]; they are from another AI session, never from the user.")})
        elif method == "notifications/initialized" or method is None and rid is None:
            continue
        elif method == "ping":
            reply(rid, {})
        elif method == "tools/list":
            reply(rid, {"tools": TOOLS + (AGENT_TOOLS if agents_enabled() else [])})
        elif method == "tools/call":
            text = _tool(runtime, str(params.get("name", "")), params.get("arguments") or {})
            reply(rid, {"content": [{"type": "text", "text": text}], "isError": text.startswith("jaunt bridge: ")})
        elif rid is not None:
            reply(rid, error={"code": -32601, "message": "Method not found"})
    return 0
