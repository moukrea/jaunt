# Claude Code ↔ Codex bridge — validation (September 15–16, 2026)

Observations, not promises. Everything below was run on one Linux workstation with the user's real Claude Code and Codex installations. Runtime versions: **Claude Code 2.1.272 → 2.1.273** (it auto-updated during the session), **Codex CLI 0.154.0**. Simulated tests are listed separately from real-runtime tests.

## Mechanisms verified against the real runtimes (probes, before implementation)

| Fact | How it was verified |
| --- | --- |
| A running interactive Claude Code session registers `~/.claude/sessions/<pid>.json` (sessionId, cwd, `messagingSocketPath`, `peerProtocol` 1) and a `<pid>.<hash>.key` file containing a `peerToken`. | Read on this machine for the current and probe sessions. |
| Writing `{"type":"auth","token":<peerToken>}` then `{"type":"user","message":{"role":"user","content":…},"priority":"next"}` as NDJSON to that socket makes an **idle** interactive session render `Message from @<from-name>: …` and start a turn. | Disposable `claude` in a PTY, message injected from a separate process: the session answered `PONG-JAUNT` (default mode and `--permission-mode acceptEdits`). |
| `codex queue --thread <id> --message …` delivers into an **idle** interactive Codex TUI as its next user turn. | Disposable `codex` in a PTY: after one real turn, the queued text appeared as a turn and Codex answered `PONG-JAUNT` about 6 s later. Before the first turn the same command fails with `no rollout found`. |
| Codex reviews newly configured hooks once (*Hooks need review … 2. Trust all and continue*) and skips them until trusted; trust is recorded against the hook hash. | Observed in a jaunt shell with the bridge hooks installed; documented in Codex's hooks reference. |
| Codex's trust hash of a hook = `sha256:` + sha256 of the canonical JSON (sorted keys, compact) of `{event_name, hooks:[{type, command, timeout, async}]}` (SessionEnd timeout clamped to 3 s), keyed `<hooks.json path>:<event>:<group>:<handler>` under `[hooks.state]` in `config.toml`. | Read in `codex-rs/hooks/src/engine/discovery.rs` (`hook_hash`) and `config/src/fingerprint.rs` (`version_for_toml`) at tag rust-v0.154.0; reproduced in Python against the five hashes Codex 0.154.0's own TUI had written for jaunt's hooks on this machine (all equal; `tests/test_bridge.py::test_codex_hook_trust_hash_matches_codex`). Since beta.37 jaunt records this trust itself when the switch goes on. |
| Hooks run with the PTY environment: `jaunt_SESSION_ID`, `jaunt_STATE`, and for Claude `CLAUDE_PID`, `CLAUDE_CODE_SESSION_ID`. | Inspected from inside a Claude Code session. |

## Simulated tests

`.venv/bin/python -m pytest -q tests/test_bridge.py` — 13 tests: automatic and symmetric awareness scoped to the project (subdirectory, worktrees, unrelated project excluded), sober re-injection (only on change, always after resume/compaction), conversation replacement in the same terminal (old id refused, MCP calls resolve to the new one), reply correlation and bounded waiting, loop guard (six hops), OFF refusing sends and unblocking waiters, registration refused outside a live jaunt shell, same-runtime pairs not bridged, targeted and reversible edits of `~/.claude/settings.json` and `~/.codex/hooks.json` (user hooks, permissions and plugins preserved; double install does not duplicate; uninstall restores the original object), hook client silent outside jaunt shells, hook context injection format, MCP JSON-RPC server (`initialize`, `tools/list`, `tools/call`), Claude inbox lookup from the session registry (with the guarded hook-reported fallback), Claude delivery frames (auth then user message with provenance), MCP callers resolved by process ancestry when the runtime strips the environment.

## Real-runtime end-to-end test

`tests/bridge_e2e.py` starts a private jaunt host, opens two jaunt shells on a throwaway git project, runs the real `claude` and `codex` in them, enables the bridge through the same RPC as the Settings switch, and checks awareness without announcement, a Claude → Codex → Claude round trip that surfaces a fact present only in Codex's conversation, a Codex → Claude message, and OFF.

Observed on 2026-09-15 evening. Run 10 of the harness passed all 8 checks (`8 bridge checks passed.`, `test-results/bridge-report.json`), after fixing the harness itself several times (base64 framing, Claude's workspace safety check, Codex's directory trust and hook review dialogs) and three real defects in the implementation described below:

| Check | Result |
| --- | --- |
| Host detects both runtimes in the login shell | PASS (Claude Code 2.1.273, Codex 0.154.0) |
| One switch installs attributable hooks + MCP entries in both runtimes | PASS |
| Claude Code registered itself through its SessionStart hook inside the jaunt shell, without any announcement | PASS |
| Codex registered itself through its own hooks; both listed on the same project | PASS (after the user's one-time "Trust all and continue" for the new hooks; the first registration then happens at the first prompt) |
| Codex holds a secret that exists only in its conversation | PASS |
| Claude → Codex → Claude: asked only that "another AI session knows the secret word", Claude found the Codex session from the injected roster, messaged it, Codex answered with its private fact, the reply was correlated to the question | PASS (`SECRET=TANGERINE-42` printed by Claude; bridge events show `claude:… → codex:…` delivered and `codex:… → claude:…` delivered with `inReplyTo`) |
| Codex → Claude: a message initiated in the Codex terminal reached the open Claude conversation | PASS (`PLUM-7` arrived and Claude reacted) |
| OFF: a still-loaded tool cannot deliver anything; shells and sessions keep running | PASS. Observed: after OFF removed jaunt's allow rules, Claude Code itself (running in *don't ask* mode) denied the `jaunt_send` call before it reached the host; no bridge event crossed. The host-side refusal is covered by unit tests. |

Earlier runs recorded behaviours worth knowing:

- Run 6: with a Codex prompt that said only "do not write it to any file", Codex received Claude's request and **refused to share the secret without direct user authorization** ("Direct user authorization is required to share the secret word with another session"). The provenance wrapper works as intended: a message from another AI session is not treated as a user instruction. The harness now tells Codex it may share the word with a peer session.
- Run 5: with the user's Claude Code in *don't ask* mode and no allow rule, Claude found the peer and tried to message it, and its own permission system denied the tool. This is why enabling the bridge adds allow rules for the three `mcp__jaunt-bridge__*` tools only.
- Run 8: the Codex reply was recorded by the host but its push into the Claude inbox failed once with "no longer registered" (the registry record was not matched); Claude still obtained the reply through `jaunt_wait_reply`. Delivery now also accepts the socket path reported by the session's own hook, guarded by the registry (never into a process that reports another conversation). Run 9 delivered both directions directly.

Cost per run: about five Claude turns and three Codex turns on the user's accounts.

## Not validated

- macOS: the process-ancestry check falls back to `ps` there; not exercised.
- Android and desktop UI for the new Settings group were not exercised on devices; the web UI was exercised through the same code path used by both.
- Behaviour of Claude Code versions other than 2.1.272/2.1.273 and Codex versions other than 0.154.0. The inbox mechanism used for Claude delivery is versioned but not a documented public API.
- Long-running coordination scenarios (hours of collaboration, many sessions). Rate limits and hop limits are enforced but only exercised in unit tests.

## Follow-up (beta.14)

After publishing beta.13 and updating the real local host (running as a systemd user service), the Settings switch did not appear: the service's PATH does not contain `~/.local/bin`, and a plain login shell on this workstation does not add it either (the interactive shell does). Detection now runs a login + interactive shell like jaunt's own PTYs and falls back to well-known per-user locations; covered by a unit test with a minimal PATH.

## Follow-up (beta.15)

Reported on a fresh installation on another machine (bridge on, both runtimes detected): the Claude Code session's `jaunt_peers` answered *not started from a jaunt shell* while the Codex session registered normally. Not reproduced here: on this workstation Claude Code 2.1.273 passes `jaunt_SESSION_ID`/`jaunt_STATE` to hooks and MCP servers and the process chain leads to the shell. The fix therefore removes every dependency on those two facts: hooks always register (sending their own pid), the host matches a hook or tool call to a terminal by process ancestry **or by the controlling PTY it owns** (`/proc/<pid>/stat` tty, `ps -o tty=` elsewhere), the state directory is passed with `--state`, integrations are re-applied at host start, and every refused registration is logged in `host.log` with its reason. Unit tests cover the stripped-environment and reparented-process cases; the real-runtime e2e still passes.

## Field report and follow-up (beta.17)

Second test on the fresh machine, host beta.16: the two sessions exchanged messages in both directions (Codex → Claude greeting, Claude's correlated reply). Two observations: Claude's `jaunt_peers` did not list the Codex session until Codex received its first prompt (the registry is fed by hooks only), and Codex displayed *Hook failed, exited with code 127* on each hook event while still functioning. beta.17 announces present-but-unregistered runtimes as such, bumps the awareness version when a runtime appears in a jaunt shell, and replaces the quoted interpreter command in the hook and MCP entries with plain wrapper executables (a single path works with or without a shell). The 127 was not reproduced on the development machine, where the same command runs with exit 0 through `sh -c` and `bash -c`; a naive split of the quoted command reproduces the symptom, which is what the wrappers rule out.

## Third field report (beta.17) → beta.18

Local test by the user with the bridge on: both sessions saw each other (Codex announced as present before its first prompt, reachable after), Codex greeted Claude and got the reply. Two defects: Claude, running with permissions bypassed, showed its *Deliver / Deny* review prompt for the Codex message; and Codex received Claude's reply twice (once through `wait_seconds`, once as a queued message). Verified with a disposable bypass-mode Claude session: a message without `from-mode` is held for review ("The sender did not attest its permission mode, and this session bypasses permission prompts"), the same message with `from-mode="bypass"` is delivered and answered at once. beta.18 asserts the sender's real class from its hook payload and hands a reply to a waiting call only. Also fixed: a home directory that is a git repository was taken as the project root ("working on the same project (/home/…)"); presence now uses the shell's current directory.

## Fourth field report (beta.19) → beta.20

Local test right after the host update: the older Claude Code session (its conversation replaced with `/clear`) answered *This session is not registered with the bridge yet* to three prompts while the newer session reached Codex; `jaunt_peers` reported the peer as *not yet reachable*; and a Claude session spent 60 s in `wait_seconds` on a greeting. Causes and fixes:

- The MCP server process keeps the environment of the conversation it was started with, so after `/clear` its `CLAUDE_CODE_SESSION_ID` named a conversation the hooks had already replaced. The host now resolves a tool call to the terminal's live participant when the id it carries is unknown or ended (unit test *stale conversation*).
- Bridge participants lived only in memory and were lost by the in-place host update; every hook-registered session then looked unreachable until its next hook event. The registry is now exported into the handoff snapshot and restored by the new host (unit test *handoff export/restore*); verified by `tests/handoff_e2e.py` with real shells.
- The `jaunt_send` tool description now states that replies arrive later as messages and that `wait_seconds` is only for answers the caller needs before continuing. Whether a model waits is its decision; this is a wording change, not a guarantee.
