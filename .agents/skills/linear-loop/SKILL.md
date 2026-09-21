---
name: linear-loop
description: Start, stop or inspect the session-bound Codex version of the jaunt Linear loop. Use for "démarre la boucle Linear", "start the Linear agent", "arrête la boucle", or "linear loop status". Do not start it when asked only to implement or modify the loop.
---

# linear-loop (Codex)

Same board, app actor, plans, verdicts, dependency gate, change surfaces, claims,
worktrees, CI and squash-merge workflow as the Claude loop. Codex skills are in
`.agents/skills/`; Claude's remain in `.claude/skills/`. The shared
`scripts/linear_agent.mjs` is the authority, not a second Codex board/state store.

## Setup and runtime

Requires a **local interactive Codex CLI** with `exec --json`, `exec resume`,
`queue --thread --message`, and `CODEX_THREAD_ID`; Node 22+, git, gh and ps.
The queue capability is checked by the launcher; do not claim older CLIs or
app-server-only sessions are supported. `jaunt-linear-codex owner` must identify
the actual interactive CLI, never a shell PID or long-lived app-server daemon.

From the intended canonical checkout (verify `scripts/linear_agent.mjs` exists):

```bash
node scripts/linear_codex.mjs install
jaunt-linear repo
jaunt-linear-codex owner
```

Installation links `jaunt-linear` and `jaunt-linear-codex` into `~/.local/bin`,
and the three skills into `${CODEX_HOME:-$HOME/.codex}/skills`. It refuses to
overwrite another installation. Repository-local discovery also works from
`.agents/skills`. A new session may be needed to refresh the skill catalog.
Do not use an unguarded `git rev-parse` outside this checkout: `$HOME` can itself
be a git repository. Never replace a working canonical launcher with a worktree
copy: all runtimes/worktrees share the canonical `.dev-state`.

On a fresh clone, copy `scripts/linear-credentials.example.json` to
`.dev-state/linear-credentials.json` and fill in the Linear application secret.
The placeholder is rejected. Never stage credentials. Optional `owner` selects
notification subscribers (user id, name, email or list); without it active
non-guest team members are subscribed. The app actor is never subscribed.

## Models

The orchestrator uses the model selected for this Codex session. Workers inherit
the user's Codex CLI model. Like Claude's `bypassPermissions` workers, they
default to `danger-full-access` with noninteractive approvals (`never`). This is
for the explicitly invoked autonomous loop, not ordinary coding sessions. Use
`--sandbox workspace-write` (or `read-only`) on worker/resume, or
`JAUNT_CODEX_SANDBOX`, to restrict execution; restricted workers may need to stop
when a git/network operation is denied. The setting is recorded and preserved
on resume. No global Codex permission settings are changed.
Choose a worker model/effort with `--model <model-id> --effort <effort>` on
`worker`/`resume`, or `JAUNT_CODEX_MODEL` / `JAUNT_CODEX_EFFORT` before dispatch.
Explicit settings are recorded and preserved on resume. This installation uses
`gpt-6-astra`; this example is not a required entitlement or a fallback. Survey
subagents inherit their parent model unless the user selects another. Never
translate opus/sonnet/haiku into guessed Codex IDs. An unavailable model is an
error to report, not permission to silently switch providers/models.

## No argument

Report state, then act: off means start; on means one `$linear-orchestrator`
pass now, then re-arm. Explicit `status` is read-only. Invocation authorizes the
board operations and ticket workflow in the orchestrator/worker skills; it does
not bypass each ticket's plan approval.

## Start

Inspect `jaunt-linear watcher` and `jaunt-linear-codex status` first. If a Claude
watcher or another Codex owner is live, report ownership and do not start a
competing orchestrator. One canonical board has one active orchestrator.
Takeover requires stopping the old loop, waiting for its watcher/watchdog to
exit, then starting this one; claims and transcripts remain intact.

```bash
jaunt-linear loop-on
jaunt-linear-codex arm
jaunt-linear watcher
```

Read `$linear-orchestrator` and run one pass immediately. Report its actual
results and the health from both status commands. The adapter launches the
existing watcher/watchdog detached from the temporary command shell but **bound
to the owning Codex CLI process**, whose identity is checked every second.
Shell `&`, PTY IDs, `functions.wait`, and Claude's `run_in_background` are not
substitutes for this wake-up mechanism.

The watcher polls every 30 seconds without calling a model. A board change or
30-minute reconciliation interval ends it. The adapter saves the event in
`.dev-state/codex/watcher-event.json` and uses `codex queue` to wake this exact
thread. Each pass calls `arm` again. The independent watchdog survives ordinary
wakes and reports `watcher-lost` after 600 seconds without a healthy watcher.
Queue failures remain on disk (`delivered: false`); report them.

## Stop

```bash
jaunt-linear loop-off
jaunt-linear-codex status
jaunt-linear status
gh pr list --state open
```

The shared flag stops polling in both runtimes. Do not use `pkill` patterns.
In-flight workers are not killed by loop-off: they retain context and must check
the flag before merging. Claims, approval waits and PRs remain; name them when
reporting the stop. Closing the owner CLI terminates its running workers too;
their saved transcripts remain resumable by exact ID.

## Status and recovery

```bash
jaunt-linear-codex status
jaunt-linear status
jaunt-linear board
gh pr list --state open
```

Report flag, watcher/watchdog pulses, delivery errors, claim phases and PR state
together. `stalled` means enabled without a watcher; `unguarded` means no watchdog.
Launch is not proof of delivery/progress. Never infer health with pgrep.
Logs, worker thread IDs and events live in `.dev-state/codex/`.

Legacy claims without `runtime` belong to Claude; Codex claims explicitly carry
`runtime: "codex"`. Resume with the owning runtime and exact session ID, never
`--last`. The adapter refuses a live duplicate worker or Claude claim. Human
replies posted while stopped are read on the next pass.

Always state the lifetime caveat: this loop operates only while its owning local
Codex CLI session stays open. It is not cron or a machine-wide service.

## Worker health

Include `jaunt-linear workers` when reporting status. Lifecycle files under canonical
`.dev-state/workers/` distinguish running, suspect, unknown, resting, finished,
suspended and interrupted work. A process heartbeat is not model progress. The
watchdog also emits `worker-lost` / `worker-recovery-due`; the orchestrator uses the
runtime-specific `recover` launcher after reconciliation. Retries preserve the
claim, exact session, worktree and settings. Quota timestamps must be explicit
ISO timestamps with an offset (structured `retry_at` / `reset_at` / `resets_at`, or
an ISO timestamp in output), or `resets [Sep 25 at] 7pm (Europe/Paris)` with an
explicit IANA timezone. Ambiguous/DST or unsupported text uses bounded backoff instead
of inventing a reset date. Real quota expiry and macOS process behavior are not
validated by the offline fixtures. Loop-off and owner closure prevent new retries.
