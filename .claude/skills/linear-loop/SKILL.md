---
name: linear-loop
description: Start, stop or inspect the autonomous jaunt Linear loop — launches the watcher that wakes this session whenever the board moves, and reports what is claimed. Use for "démarre la boucle Linear", "start the Linear agent", "arrête la boucle", "où en est la boucle", "linear loop status".
---

# linear-loop

The on/off switch. Invoking this skill is what starts the loop — nothing watches
the board until someone asks for it.


## Read the current instructions before acting

At startup and on every wake, read the canonical instructions from disk before
board actions. A cached skill invocation does not prove freshness. Use the actual
claude session ID ($CLAUDE_SESSION_ID); if it is unavailable, obtain the actual session
ID from the runtime, never invent one or reuse another session's receipt.

```bash
jaunt-linear skills-read --if-stale --runtime claude --session "$CLAUDE_SESSION_ID"
# `unchanged: true` → nothing to read or acknowledge. Otherwise read both
# returned file contents, then use the exact returned fingerprint:
jaunt-linear skills-ack --runtime claude --session "$CLAUDE_SESSION_ID" --fingerprint <fingerprint>
```

Acknowledge only after reading. If acknowledgement reports stale/error, reread
and resolve it before board actions. The receipt is per runtime and session;
`loop-on`, status and watcher rearming never acknowledge instructions. `skills`
in the loop status reports `unknown`, `fresh`, `stale` or `error`. Missing files
are errors. A `skills-changed` wake carries the paths and reloading instruction;
follow it before reconciling the board. The local watcher checks even when the
board is quiet or the API unavailable, with notifications deduplicated for five minutes per outstanding state; a
lost delivery is retried after that interval. Status retains the alert until
explicit acknowledgement.

Keep the existing owner session and workers alive. Reading new instructions does
not erase old context or prove model comprehension. Replacing the owner needs a
separate supervision handoff; do not kill it to refresh prose. Existing watcher
processes need their normal controlled rearm to load this new detection code.

## On a fresh clone

The scripts and skills are versioned; the credentials are not, and never will be.
Two things do not come with the clone:

1. The `jaunt-linear` launcher — a symlink outside the repo. Create it with the
   repair procedure below.
2. `.dev-state/linear-credentials.json` — copy
   `scripts/linear-credentials.example.json` there and fill in the client secret
   from Linear > Settings > API > Applications. `linear_agent.mjs` refuses to
   mint a token while the placeholder is still in place, so a half-done setup
   fails loudly instead of silently acting as the wrong identity.

The optional `owner` key in that file says who gets subscribed to the tickets the
loop opens and parks — Linear notifies subscribers and nobody else, so a ticket
with none announces itself to no one (JAU-44). Leave it out and every active,
non-guest member of the team is subscribed, which is what a one-human board
wants and needs no setup. Set it on a bigger team: an email, a display name, a
full name or a user id, or a list of them. The app actor is never subscribed to
its own writing.

`jaunt-linear` is on the PATH and resolves the checkout itself. Keep it that way:
no checkout path belongs in a skill or any other file. If the launcher is missing
or dangling (fresh machine, repo moved), repair it with this — and only this:

```bash
for c in "$(git rev-parse --show-toplevel 2>/dev/null)" \
         "$CLAUDE_PROJECT_DIR" "$CLAUDE_PROJECT_DIR/jaunt" \
         "$(readlink -f ~/.claude/skills/linear-loop 2>/dev/null)/../../.."; do
  if [ -f "$c/scripts/linear_agent.mjs" ]; then
    ln -sfn "$(readlink -f "$c/scripts/linear_agent.mjs")" ~/.local/bin/jaunt-linear && break
  fi
done
jaunt-linear repo   # must print a real checkout, else none of the candidates matched
```

The loop over candidates and the `-f` guard are both load-bearing, so do not
"simplify" this to a single `ln -sfn`:

- `git rev-parse --show-toplevel` is **not** reliable here. `$HOME` is itself a
  git repository on this machine, so run from anywhere outside the checkout it
  happily returns `/home/eco` — a real answer to a different question.
- `$CLAUDE_PROJECT_DIR` is frequently unset in a Bash tool call, which turns the
  path into `/jaunt/scripts/...`.
- `ln -sfn` overwrites, so an unguarded command replaces a *working* launcher
  with a dangling one. That turns the repair procedure into the outage.
- Candidate 4 only works because `~/.claude/skills/linear-loop` is a symlink into
  `<checkout>/.claude/skills/`, so three levels up lands on the checkout. Move
  the skills or change that depth and this last resort goes silent.

## No argument given

Report the state — and then work, unless there is a reason not to:

- loop off → Start.
- loop on → run one orchestrator pass now (`linear-orchestrator`), then make sure
  the watcher is running.

A human asking about the loop is asking for the board to move, not for a status
line.

## Start

Before starting, check `jaunt-linear-codex status` if installed. If an active
Codex adapter owns this checkout, do not start a second orchestrator. Stop that
loop and wait for its watcher/watchdog to exit before an explicit takeover.
Claims, approvals and transcripts are shared; their `runtime` selects how to
resume them (missing runtime means Claude).

```bash
jaunt-linear loop-on --runtime claude --session "$CLAUDE_SESSION_ID"
```

For an already enabled legacy loop with no registered instruction owner, run
the same `loop-on --runtime claude --session` command from its actual owner;
this binds only instruction metadata, never worker supervision.

Then launch **both** processes, each as its own Bash call with
`run_in_background: true`:

```bash
node "$(jaunt-linear repo)/scripts/linear_watch.mjs" --interval 30
node "$(jaunt-linear repo)/scripts/linear_watch.mjs" --watchdog --grace 600
```

**`run_in_background: true` is the whole mechanism, not a preference.** A `&` at
the end of an ordinary foreground Bash call is not the same thing and has already
cost an outage: the process dies with the call, and — worse — the harness has no
background task to notify, so nothing ever wakes the session again. If you catch
yourself typing `&`, you are writing the bug (JAU-52).

Then confirm it took, rather than assuming:

```bash
jaunt-linear watcher      # alive: true, stalled: false, unguarded: false
```

Then invoke `linear-orchestrator` once immediately, so the board moves now rather
than at the next change.

Report back: that the watcher is running **with what `jaunt-linear watcher`
said**, what the first pass did, and the caveat below.

## How the loop actually runs

There is no cron. The watcher polls Linear every 30 s, **stays silent while
nothing moves, and exits as soon as something does** — a backgrounded command
re-invokes this session when it terminates, so the watcher dying *is* the
wake-up. Nothing is spent while the board is still.

Two consequences worth keeping straight:

- The wake-up carries no payload. The harness hands over the watcher's **output
  file**; the orchestrator reads it for the event list, and first takes its
  `wakeId` (`jaunt-linear wake take`) so a re-read wake costs nothing.
- There is no periodic exit any more: a quiet board is no model turn at all.
  Worker exits and board changes reach the watcher through one outbox, which
  sends each fact once (JAU-62).
- Each pass must relaunch the watcher, or the loop ends silently after one
  wake-up. That is `linear-orchestrator` §6.

### And the watchdog, which is what makes that last line survivable

An obligation the orchestrator has to remember is an obligation it can miss —
and it did, for 1 h 40, while the flag said `enabled: true` and a human comment
went unread. So the guarantee is not discipline, it is a second process:

```bash
node "$(jaunt-linear repo)/scripts/linear_watch.mjs" --watchdog --grace 600
```

The watchdog never calls Linear and never calls a model. It reads the watcher's
pulse every 15 s, hands finished or lost workers to the outbox for the watcher
to deliver, and **exits only when the loop has gone blind** — the same mechanism,
turned against the failure it used to hide. Its exit is a wake-up that says
`watcher-lost`, and the orchestrator relaunches everything.

What makes it worth its own process: it **survives the ordinary wake-ups**. A
`board-changed` kills the watcher and leaves the watchdog counting. So the
watcher needs relaunching on every pass, and the watchdog only after it has
fired. The 600 s of grace is longer than any plausible orchestration pass — so a
pass running with no watcher is silent, not an alarm — and far shorter than the
1 h 40 it exists to prevent.

It cannot be the watcher itself (dead by the time anyone needs it) nor a shell
loop that never returns (a process that never ends never wakes the session).
That is why it is shaped the way it is.

## Where the work ends up

The loop merges to `main`. A worker carries its ticket to a pushed branch, a
green PR and a squash merge on its own (`linear-worker` §7); the orchestrator
only cleans up behind it. Nothing waits on a human except the plan approval — no
review is required on `main`.

Two consequences for the switch:

- **Branch names always carry the ticket identifier.** That is what makes
  Linear's GitHub integration move the ticket: push to *In Progress*, merge to
  *Done*. A branch named without it lands its work and leaves the board saying
  nothing happened. The loop must never `move` for those two transitions — the
  one state it does own is ***Waiting for human***, which git has no way of
  knowing about.
- **`status` does not show the landing.** A claim says a ticket is held, not
  whether its PR is open, red, or already merged. What it does show is the
  phase — `planning`, `awaiting-approval`, `queued`, `implementing`, `landing` —
  so a session waiting on you is distinguishable from one that is working.
  Only the last two hold files: a claim in the first three consumes nothing and
  no longer stops the loop dispatching anything else.
- **What is waiting on you is a column, not a reading of comment threads.**
  `jaunt-linear board` lists it under `waitingOnHuman`; empty is the normal
  state.

## Stop

```bash
jaunt-linear loop-off
```

That is the whole stop. The watcher and the watchdog both read the flag on every
tick and exit on their own within one interval — you do not have to kill
anything, and **you must not reach for `pkill -f linear_watch.mjs`**: it matches
on a string, so it would also kill the watcher of any other checkout of this repo
on the machine. `KillShell` on the two background tasks is the legitimate way to
make it instant.

Stopping does **not** touch claims. A ticket in flight stays claimed, its worker
session keeps its transcript, and restarting resumes exactly there — say so when
you stop, naming what is held.

It does not touch **open PRs** either, and auto-merge is disabled on this
repository, so nothing merges while the loop is off. A PR left green and
unmerged stays that way indefinitely, and goes stale as soon as someone else
merges. List the open PRs when you stop (`gh pr list --state open`) and name
them alongside the claims — a stopped loop with work sitting in review is not
the same thing as a stopped loop with nothing outstanding.

## Status

```bash
jaunt-linear watcher        # is anything actually watching?
jaunt-linear status         # the same answer, plus every claim and its session UUID
jaunt-linear board          # priorities, blockers, needsPass
gh pr list --state open     # what is landing, and what is stuck landing
```

A loop flagged on with no watcher running is **stalled, not running**, and that
distinction is the whole point of checking. `jaunt-linear watcher` settles it,
and `status` now carries the same three fields:

| field | means |
|---|---|
| `stalled: true` | the flag says on and **nothing is watching** — the board is calm because nobody is looking |
| `unguarded: true` | a watcher is up but the watchdog is not: the loop runs on the orchestrator remembering, which is what failed |
| `watcher.reason` | `polling`, `never started`, `process gone`, `heartbeat stale`, or `exited: <wake>` |

**Never settle this with `pgrep`.** Every form of it lies here, including the
ones that look careful: the shell running the check carries the pattern in its
own command line, so `pgrep -f linear_watch.mjs` matches itself — and so does
`pgrep -af "node .*linear_watch"`, which was measured doing exactly that. The
verdict comes from the pulse the watcher writes, or it is not a verdict.

Report them together: `watcher` says whether anything is looking, the flag says
whether it is supposed to, the claims say what is held, the PR list says what has
actually left the machine.

## The caveat to state every time

The watcher is a background task of this session. **It only runs while a Claude
Code session is open on this project.** Close the session and the loop pauses
until one is running again. Never describe it as running unattended on the
machine; say what it actually is.

That is deliberate, and it is the settled scope: the loop lives exactly as long
as the session — never less, never more. The watchdog narrows the "never less"
to a bounded gap; it does not, and must not, make the loop outlive the session.

Nothing is lost during a pause: verdicts are read from the Linear thread, so an
answer written while nobody was listening is picked up on the next pass.

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
