# Agents and machines

What an AI session (Claude Code or Codex) running in a jaunt shell may do on a machine other than the one it runs on, and how that machine keeps control. This feature sits beside the [Claude Code ↔ Codex bridge](BRIDGE.md) and shares its MCP server; it does not change the bridge: no context about machines is injected into sessions, no message crosses hosts. A session learns about machines only by calling a tool.

## Model

- **Link**: host A enrolls on host B as one of B's devices, with a one-use pairing code from B (`jaunt pair` on B, `jaunt link <code>` on A, or Settings → Agents and machines → Linked machines). Same handshake, same encrypted channel, same relay as a phone; B lists A among its devices with kind `host` and can revoke it.
- **Requester**: a linked host × a runtime (`host-…:claude`, `host-…:codex`). Trust is never granted to a machine as a whole.
- **Rights**, each with its own level per requester, decided on the machine that executes:
  - *Run commands* (`exec`): one-shot commands (phase 1), background agent shells (phase 2).
  - *Write into a shell* (`type`): typing into and reading an existing jaunt session (phase 3), also for local sessions of the same host.
- **Levels**: *ask* (default for an unknown requester; every request waits for an answer on your devices, refused after 2 minutes), *trust* for 1 h, 24 h or always, *block*. An expired trust falls back to ask. Revoking a requester removes its row; it asks again at its next request.
- The whole feature is one switch per host, off by default. Turning it on installs jaunt's MCP server in the runtimes found on that host (the bridge's hooks are not needed); turning both switches off removes it.

## Phase 1 (host 0.1.0-beta.32)

Tools exposed to a session while the switch is on for its host:

| Tool | Does | Bounds |
|---|---|---|
| `jaunt_hosts()` | Linked machines: platform, user, link state, and this requester's `exec` level there. | Read-only, on demand. |
| `jaunt_run(host, command, cwd?, timeout_seconds?)` | One command in the owner's login shell (`$SHELL -lc`, `/bin/sh -c` when SHELL is not a known shell), no TTY, with the graphical session's display variables. | 60 s default, 600 s max; 64 KiB of stdout+stderr inline; one command at a time per requester; 20 per minute; full output kept 24 h in `<state>/agent-runs/<id>.log` (0600). |
| `jaunt_read(host, run, offset?, limit?)` | A slice of a run's full output. | 64 KiB per read. |

A refusal is a distinct outcome: `{"status": "denied"…}` never looks like a failed command. Timeouts report `status: "timeout"` with what was captured.

Approvals reach every client showing the target host (modal with the requester, command, directory and timeout; *Allow once*, *Trust 1 h*, *Trust always* with a confirmation, *Deny*), a push notification through the existing channel, and the CLI: `jaunt agents pending`, `jaunt agents allow <id> [--trust 1h|24h|always]`, `jaunt agents deny <id>`. The first answer wins.

Settings → Agents and machines on the target shows the requester table (one column per right, multi-select modify and revoke, revoke all), pending requests and the journal (last 200 entries: decisions, commands with status and exit code, refusals, links). CLI: `jaunt agents status|trust|block|revoke|log`, `jaunt links`, `jaunt unlink`.

## Validation

- `tests/test_agents.py`: policy levels, expiry and revocation; approvals (first answer wins, timeout denies); executor (exit codes, truncation, chunked reads, timeout kill of the process group, unknown cwd, one at a time, per-minute limit, log sweep).
- `tests/agents_e2e.py`: two real hosts with their own relays. The MCP server is driven over stdio exactly as Claude Code starts it, as a session of a real jaunt shell on A. Observed: no agent tool listed while the switch is off; A enrolled on B with one pairing code; ask → owner "allow once" from the CLI → command ran on B and was journaled; deny → explicit refusal; "trust 1h" from the approval → later commands run at once and the table shows `exec: trust`, `type: ask`; 200 KB output read in chunks; 1 s timeout reported; block → refusal without prompt; revoke → asks again; unlink; the bridge stays off and unchanged.
- The browser client: linking from Settings, the approval modal answered from the browser, the requester table (see `tests/agents_ui_e2e.py`).

Not validated: macOS hosts as targets, links across the public relay between two physically distinct machines (both ends were on one workstation with loopback relays), Codex as requester runtime (the MCP path is the same; the runtime name only differs).

## Threats and answers

| Risk | Answer |
|---|---|
| Prompt injection makes an agent run destructive commands on trusted machines. | Default *ask*; trust per requester, revocable, optionally time-bound; every command in the journal; keep *ask* on machines where a mistake costs. |
| A host impersonates another. | The link is a device enrollment with its own secret; the relay cannot read or forge frames. |
| Runaway or chatty command. | Timeout, bounded inline output, one at a time, 20 per minute; output travels in ordinary relay frames. |
| Secrets in the output leak to the other machine. | Encrypted end to end to host A, then read locally by the session, like an `ssh` result; the journal stores sizes, not output. |
| Reflex approvals. | The prompt shows the full command, directory and requester; *Allow once* is the primary action; permanent trust asks a second confirmation. |

The protocol has not undergone an independent security audit.
