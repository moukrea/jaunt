# Agents and machines

What an AI session (Claude Code or Codex) running in a jaunt shell may do on a machine other than the one it runs on, and how that machine keeps control. This feature sits beside the [Claude Code ↔ Codex bridge](BRIDGE.md) and shares its MCP server; it does not change the bridge: no context about machines is injected into sessions, no message crosses hosts. A session learns about machines only by calling a tool.

## Model

- **Link**: nothing to pair twice. A device that is paired with several hosts already holds every pairing, so as soon as the switch is on it links the hosts among themselves: the client asks the target for a one-use code (`pair.issue`, an RPC of any authenticated device) and hands it to the requester host (`links.add`) together with the friendly names and icons it uses for both machines; renaming or re-iconing a machine on the device follows (`links.update`). Host A then enrolls on host B as one of B's devices with the same handshake, encrypted channel and relay as a phone; B lists A among its devices with kind `host`, confines it to the `agent.*` methods, and can revoke it. A machine that is not paired on any device can still be linked by hand (`jaunt pair` on B, then `jaunt link <code>` on A or the folded field under Settings → Agents and machines → Reachable machines).
- **Requester**: a linked host × a runtime (`host-…:claude`, `host-…:codex`). Trust is never granted to a machine as a whole.
- **Rights**, each with its own level per requester, decided on the machine that executes:
  - *Run commands* (`exec`): one-shot commands (phase 1), background agent shells (phase 2).
  - *Write into a shell* (`type`): typing into and reading an existing jaunt session (phase 3), also for local sessions of the same host.
- **Levels**: *ask* (default for an unknown requester; every request waits for an answer on your devices, refused after 2 minutes), *trust* for 1 h, 24 h or always, *block*. An expired trust falls back to ask. Revoking a requester removes its row; it asks again at its next request.
- **Four independent switches per host**, all off by default, under Settings → Agents and machines: *Commands and background shells on linked machines* (`exec`), *Typing into shells of this host* (`typeLocal`), *Typing into shells across machines* (`typeRemote`) and *Messages between sessions across machines* (`messages`). A switch governs the host both as requester and as target for that capability. Turning any on installs jaunt's MCP server in the runtimes found on that host; *messages* also installs the hooks (sessions have to register, as for the local bridge, but no roster is injected while the local bridge is off); everything off removes them. CLI: `jaunt agents features`, `jaunt agents enable|disable exec|typeLocal|typeRemote|messages`. Links are kept alive while `exec`, `typeRemote` or `messages` is on.

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

## Phase 2 (host 0.1.0-beta.33) — background agent shells

`jaunt_shell(host, action, …)` with `open` (cwd optional; one approval in *ask* mode), `send` (a line, Enter unless `enter: false`, 8 KiB max), `read` (from an offset, 64 KiB), `close`, `list`. An agent shell is a PTY started like a jaunt shell (login profile, interactive shell, display variables, `TERM=dumb`) but it is **not a session**: no tab, no entry in Sessions, no sharing, ignored by "only displayed sessions exist". It lives by a lease of 10 minutes renewed by every call and dies, without exception, when the agent closes it, when the lease expires, when the jaunt session that opened it ends (the requesting host releases it), when the requesting host stays disconnected for more than 2 minutes, when the requester is revoked or blocked, and when the host stops. Caps: 2 per requester, 8 per host. Settings lists live agent shells with *Kill*; the journal records open and close with the reason.

## Phase 3 (host 0.1.0-beta.34) — typing into existing shells, remote and local

The second right, *Write into a shell* (`type`), lets a session type into and read one of the owner's **existing** jaunt shells: on a linked machine, or on its own host (then the requester is the local row *Claude Code on this machine* / *Codex on this machine*, never its own shell).

| Tool | Does | Bounds |
|---|---|---|
| `jaunt_sessions(host?)` | The jaunt shells of a machine (this one when `host` is omitted): name, cwd, program, whether the requester may type there (`ask`, `trust`, `block`). | Read-only. |
| `jaunt_type(host?, session, input, enter?)` | Sends the text to that terminal as keystrokes, Enter appended unless `enter: false`. | 16 KiB per call; journaled with the text. |
| `jaunt_output(host?, session, limit?)` | The latest output of that terminal as plain text (escape sequences removed). | 16 KiB default, 64 KiB max. |

Decision on the target, per requester × shell: in *ask* mode the owner is asked **once per shell** (modal naming the shell and showing the text; *Allow for this shell*, *Trust 1 h*, *Trust always*, *Deny*); the grant lasts until the shell ends or the owner cuts the agent off. *Trust* covers every shell without a prompt; *block* refuses at once, independently of the `exec` level. While a requester may type into a shell, its tab carries a lightning badge (and the Sessions manager a note); clicking it **cuts the agent off**: the grant is dropped, and even a trusted requester must ask again for that shell (`jaunt agents cut <session>` does the same). Revoking or lowering a requester drops its grants and badges.

## Phase 4 (host 0.1.0-beta.35) — allow-lists

A requester in *ask* mode for `exec` may carry rules: whole commands or shell-style patterns (`*` anything, `?` one character) matched against the normalized command (whitespace collapsed). A matching one-shot command runs at once, journaled with `decision: rule` and the pattern; anything else still asks. Rules never apply to background shells or typing, and are ignored while the requester is trusted or blocked. They come from the approval modal (*Always allow this command* adds the exact command), from Settings (the *Rules…* button of the requester row: list, add, remove) or from the CLI (`jaunt agents rules [requester]`, `jaunt agents rule <requester> --pattern 'npm test *' [--remove]`, `jaunt agents allow <id> --trust rule`). At most 50 rules per requester, 200 characters each, never `*` alone. `jaunt_hosts` tells the session which commands are pre-approved.

## Phase 5 (host 0.1.0-beta.36) — messages between sessions across machines

With *messages* on, a Claude Code or Codex session on host A sees, through `jaunt_peers`, every Claude Code or Codex session open in a jaunt shell on a linked host that also has the switch on (ids `<machine>/<id>`, whatever the runtime: across machines even Claude ↔ Claude and Codex ↔ Codex go through jaunt, since neither runtime reaches another machine by itself), and writes to it with `jaunt_send(to="<machine>/<id>")`. The target host delivers into the session's own conversation exactly as the local bridge does (Claude Code's private inbox, `codex queue`), with the provenance in the text (`… session in jaunt terminal "x" on the machine "laptop" (id laptop/claude:…)`) and the note that it comes from another AI session. Replies use `in_reply_to` and travel back over the other direction's link; a session blocked in `jaunt_wait_reply` receives the reply in that call only. Hops (6) and the per-pair rate (8 per minute) apply; every message is journaled on both hosts (ids, states, never the text on the target beyond the delivery). Turning the switch off on a host refuses further messages there, ends pending waits, and, when the local bridge is off too, forgets its registered sessions. Nothing about other machines is injected into a session's context; the local bridge roster, when on, only says that other machines' sessions are one `jaunt_peers` call away.

## Validation

- `tests/test_agents.py`: policy levels, expiry and revocation; approvals (first answer wins, timeout denies); executor (exit codes, truncation, chunked reads, timeout kill of the process group, unknown cwd, one at a time, per-minute limit, log sweep).
- `tests/agents_e2e.py` (25 checks): two real hosts with their own relays. The MCP server is driven over stdio exactly as Claude Code starts it, as a session of a real jaunt shell on A. Observed: no agent tool listed while the switch is off; A enrolled on B with one pairing code; ask → owner "allow once" from the CLI → command ran on B and was journaled; deny → explicit refusal; "trust 1h" from the approval → later commands run at once and the table shows `exec: trust`, `type: ask`; 200 KB output read in chunks; 1 s timeout reported; block → refusal without prompt; revoke → asks again; unlink; an agent shell keeps state between sends and is read from an offset, dies at lease expiry (4 s in the run) with the reason journaled, dies when the requester is revoked, and dies when the jaunt session that opened it is terminated; phase 3: typing into a shell of B after one approval (mark on the session, keystrokes journaled), second input without a prompt, cut → asks again and deny refuses, type blocked independently of exec, a local session typing into another shell of its host under the local requester row and refused for its own shell; phase 4: "always allow this command" then the same command without a prompt while others ask, a `*` rule from the CLI shown in `jaunt_hosts` and inert once removed; phase 5, with stand-in `claude`/`codex` executables: the messages switch installs the hooks, sessions register without any roster, `jaunt_peers` lists the other machine's Claude Code and Codex sessions, a message to each lands in the right inbox (Codex queue, Claude socket) with its provenance and the sender's permission class, the reply comes back over the other link into the waiting call, switching off refuses and forgets; the bridge stays off and unchanged.
- The browser client: linking from Settings, the approval modal answered from the browser, the requester table (see `tests/agents_ui_e2e.py`, 10 checks, including the agent shell list with Kill, the typing approval, the tab badge and cutting off from the tab, "always allow this command" and the rules dialog).

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
