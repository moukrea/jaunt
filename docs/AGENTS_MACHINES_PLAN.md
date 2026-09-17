# Agents and machines — implementation plan

Design source: the "Pont multi-hôtes" proposal (revision 3). This file is the working checklist; it is updated as work lands. Nothing here changes the Claude Code ↔ Codex messaging bridge.

## Phase 1 — link, discovery, one-shot commands, trust table, approvals

Host (Python):
- [x] `hostlink.py`: outbound link A → B over B's relay room as a client (hello/challenge/proof handshake, pair then device auth, encrypted channel, RPC request/reply, reconnect with backoff, `host.online/offline`).
- [x] `state.data['links']` on A; enrollment on B stores `kind: "host"` + A's room/name in `devices`; `Peer.is_host`.
- [x] `agents.py`: `Policy` (requester = host × runtime, rights `exec` and `type`, levels ask/trust(until)/block, first-use grants), `Approvals` (pending, broadcast `agent.approval`, decide, 120 s timeout → deny, first answer wins), `Executor` (`$SHELL -lc`, cwd, timeout 60 s default / 600 s max, 64 KiB inline, full log in `agent-runs/<id>.log`, 1 at a time per requester, 20/min, 24 h retention), `Gateway` (requester side: resolve caller runtime, forward to link or local).
- [x] Daemon RPCs — target side: `agent.run`, `agent.read` (host peers only, policy applied); UI/CLI side: `agents.status`, `agents.configure`, `agents.trust`, `agents.revoke`, `agents.decide`, `agents.log`, `links.add`, `links.remove`, `links.list`; requester side (control socket): `agents.hosts`, `agents.run`, `agents.read`.
- [x] Integrations: MCP entry installed when the agents switch is on even if the bridge is off; removed when both are off.
- [x] Notifications: approval → `notify()` push + broadcast; CLI `jaunt link/links/unlink`, `jaunt agents pending|allow|deny|log|status`.

Client (web, desktop, Android):
- [x] Settings group "Agents and machines": switch, reachable machines (linked by the client from its own pairings, with the device's friendly names and icons; pairing code only as a fallback), requester table with one column per right, multi-select modify/revoke, revoke all, log.
- [x] Automatic links: `pair.issue` RPC for authenticated devices, `links.add {code, name, icon, selfName}`, `links.update`, `info.agents.links`, client `syncLinks()` on every welcome/switch; linked hosts confined to `agent.*` RPCs.
- [x] Approval modal (command, cwd, requester, program), 4 actions, closes when answered elsewhere; toast/notification.
- [x] `jaunt_hosts`, `jaunt_run`, `jaunt_read` MCP tools.

Tests:
- [x] `tests/test_agents.py`: policy levels and expiry, first-use grants, approvals timeout and first-answer-wins, executor bounds, truncation, log file, rate limits.
- [x] host link covered end to end by `tests/agents_e2e.py` (two real hosts) instead of an in-process test: in-process handshake A ↔ B through the dev relay, enrollment as host device, RPC round trip, reconnect.
- [x] `tests/agents_e2e.py`: two real hosts, link by pairing code, MCP server driven over stdio as a Claude session on A; run on B refused (off), ask → approved from B's browser client, ask → timeout deny, trust → immediate, block; 2 MiB output read in chunks; bridge roster and messaging unchanged.

Docs: [x] `docs/AGENTS.md`, [x] README section, [x] PROTOCOL, [x] release notes.

## Phase 2 — background agent shells (lease)
- [x] `agent.shell open/send/read/close/list`, lease 10 min renewed by calls, kill on: close, lease expiry, requester session end (release from the requesting host), link down > 2 min (orphan grace), revocation/block, daemon stop; caps 2 per requester, 8 per host; never a jaunt session; listed in settings with kill; unit test + e2e (host and UI).

## Phase 3 — writing into existing shells (remote and local)
- [x] Right 2: `agent.sessions`, `agent.type`, `agent.output` (host peers) and `agents.sessions/type/output` on the control socket (host omitted = local); `Policy.grant/allowed_shell/cut/forget_session`; session `agents` marks broadcast with the session list; badge on the tab + cut (`agents.cut`, `jaunt agents cut`); local requester row `local:<runtime>`; MCP `jaunt_sessions`, `jaunt_type`, `jaunt_output`; unit test + e2e (host 5 checks, UI 2 checks).

## Phase 4 — allow-lists
- [x] Pre-authorised command patterns on "ask" requesters: `Policy.rules/add_rule/remove_rule/matches` (fnmatch on the normalized command, 50 × 200 chars, never `*`), `_authorize` short-circuit for kind `run`, approval decision `rule`, RPC `agents.rule {requester, pattern, remove?}`, rows carry `rules`, `agent.rights.rules` → `jaunt_hosts`; modal button, Settings rules dialog, CLI `agents rules|rule`, `allow --trust rule`; unit + e2e (host 2, UI 2).
