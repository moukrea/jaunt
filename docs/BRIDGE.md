# Claude Code ↔ Codex bridge

Two real interactive sessions, one Claude Code and one Codex, opened in jaunt shells on the same project, automatically know about each other and can message each other, at your request or on their own initiative. One switch per host. Nothing to install, configure or announce.

## What you see

**Settings → selected machine → AI sessions** shows a single switch, *Claude Code ↔ Codex bridge*, when **both** `claude` and `codex` are installed for the host's user. If either is missing the section does not appear. If both are present but too old for the mechanisms jaunt relies on, the row shows *Unavailable* with the reason.

- **Off** (default): nothing is installed in either runtime; your sessions behave exactly as before.
- **On**: jaunt adds its integration to both runtimes (details below), then every Claude Code or Codex session started from a jaunt shell registers itself. Sessions already open when you flip the switch join after their next restart or `/clear`; the settings list says so per session.
- The list under the switch shows the bridged sessions (runtime, terminal, project, idle/working) as the host actually verified them.
- The activity strip shows each cross-runtime message with its real state: accepted, delivered to the session, failed (with the reason), cancelled.

Turning it **off** removes the integration entries from both runtimes, refuses any further bridge tool call with an explicit answer, drops pending deliveries and unblocks sessions waiting for a reply. Your Claude Code and Codex sessions keep running and their own native mechanisms (Claude ↔ Claude peer messaging, Codex multi-agent features) are untouched at all times: jaunt only connects the two runtimes to each other.

## What "aware" means

Each session receives, as ordinary hook context, the list of relevant sessions of the *other* runtime (a session that is open in a jaunt shell on the project but has not registered yet, because it has not received a prompt or its hooks are not trusted yet, is announced as present and not yet reachable): terminal name, id, whether it is idle or working, how its workspace relates to yours (same project, another worktree of the same repository, a nested directory). "Relevant" is computed from real paths and git metadata, never from folder names. Sessions on unrelated projects are not listed. The roster says explicitly that it covers only the other runtime, and names the other sessions of your *own* runtime open on the project (jaunt does not relay between those; on Claude Code, its own ListAgents / SendMessage tools reach them), so the cross-runtime list is never mistaken for the full list of agents on the project. The roster is injected at session start, after a resume/compaction, and on your next prompt only when something changed. An idle session costs nothing; it is brought up to date when it resumes work.

Deciding to talk stays with the models: the context says who is there and how to reach them, and asks them to contact a peer only when their work benefits from it.

## What "message" means

Sessions call the `jaunt_send` tool (with `jaunt_peers` to list, `jaunt_wait_reply` to wait). The host validates the sender and the recipient, then delivers into the **actual open conversation**:

- **Claude Code** receives it through the same private per-session inbox Claude Code uses for its own cross-session messages. It is rendered in the terminal as a message from `jaunt · <sender id>`, wrapped for the model as a cross-session message, and starts a turn even when the session is idle.
- **Codex** receives it through `codex queue`, Codex's own way of queuing a message for a running thread. It appears as the next turn of that thread (immediately when idle, after the current turn otherwise).

Every message carries its provenance in the text (`[jaunt bridge] Message from the … session in jaunt terminal "…" (id …)`) and an explicit note that it comes from another AI session, not from you. Replies are correlated to the message they answer. Ping-pong is bounded (six hops), and at most eight messages per minute travel between any two sessions.

States are what the host can verify: *delivered* means the runtime accepted the message for that conversation, not that the model has read or answered it. A reply arriving with `in_reply_to` is the proof of the round trip.

## What jaunt installs when you turn it on

- **Claude Code**: hook entries (`SessionStart`, `UserPromptSubmit`, `PostCompact`, `Stop`, `SessionEnd`) in `~/.claude/settings.json`, all running `… -m jaunt.cli bridge-hook claude`; one user-scope MCP server named `jaunt-bridge` registered with `claude mcp add`; and three `permissions.allow` rules naming only the bridge's own tools (`mcp__jaunt-bridge__jaunt_peers`, `…jaunt_send`, `…jaunt_wait_reply`), so a session running in *don't ask* or auto mode can still use the bridge. No other permission is granted.
- **Codex**: the same hook events in `~/.codex/hooks.json`, and one MCP server named `jaunt-bridge` registered with `codex mcp add`.
- Both point at small executables jaunt writes under its own state directory (`~/.local/share/jaunt/bridge/hook-<runtime>` and `mcp-<runtime>`), which call the jaunt runtime with the host state directory as an argument.

Entries are attributable (the jaunt command in them), added next to your existing hooks and servers without rewriting anything else, and removed one by one when you turn the bridge off. The commands point at the jaunt runtime that survives host updates, so nothing needs redoing after an update. Outside a jaunt shell, or while the bridge is off, the hook and MCP server exit silently: your other Claude Code and Codex sessions never talk to the host.

## Identity, scope and permissions

- A participant is a triple: jaunt terminal, runtime process, conversation id. Registration is accepted only from hooks whose process descends from a jaunt shell the host owns. A new conversation in the same terminal (`/clear`, a new session) supersedes the old one; messages addressed to the old id are refused, never redirected.
- Only sessions started from jaunt shells take part. Enabling the bridge never exposes other conversations on the machine.
- Permissions, approvals and sandboxes of each runtime apply unchanged. A bridge message is not an authorization; the recipient may need to approve the `jaunt_send` tool the first time, exactly like any MCP tool.
- Claude Code reviews inbound peer messages itself: a Claude session that bypasses permission prompts (`--dangerously-skip-permissions`, auto mode) auto-accepts a message only from a sender that attests the same class; jaunt attests the sender's real class from its hook payload (Codex in full-access/YOLO mode counts as bypassing). Any other combination shows Claude's *Deliver / Deny* prompt, as with its own peers; setting `crossSessionInbound` to `accept` in your Claude settings is your decision, jaunt does not change it.
- A reply that the asking session is waiting for (`wait_seconds` / `jaunt_wait_reply`) is returned by that call only; it is not pushed into the conversation a second time.
- Scope is one host. Cross-machine sessions are not bridged.
- The host stores no conversation content. Message previews shown in the activity strip stay in the client.

## Limitations you should know

- Sessions already open when the bridge is turned on take part only after a restart or `/clear`: both runtimes read hooks and MCP servers at session start.
- Codex asks you once, in the terminal, to trust newly configured hooks (*Press t to trust all*). jaunt does not answer that prompt for you; until you do, that Codex session is not bridged.
- A Codex session that has not yet received its first prompt has no thread to deliver into; sending to it fails with a clear message until it has started.
- The Claude Code inbox used for delivery is the one Claude Code ships for its own cross-session messages; it is versioned (`peerProtocol`) but not a documented public API. jaunt checks that the session exposes it and reports precisely when it does not.
- Claude Code versions before 2.1.230 and Codex versions before 0.150 are reported as incompatible.
- The protocol and this integration have not received an independent security audit.

See [validation](BRIDGE_VALIDATION.md) for what was actually tested, with which versions.
