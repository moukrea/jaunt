---
name: linear-loop
description: Start, stop or inspect the autonomous jaunt Linear loop — launches the watcher that wakes this session whenever the board moves, and reports what is claimed. Use for "démarre la boucle Linear", "start the Linear agent", "arrête la boucle", "où en est la boucle", "linear loop status".
---

# linear-loop

The on/off switch. Invoking this skill is what starts the loop — nothing watches
the board until someone asks for it.

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

```bash
jaunt-linear loop-on
```

Then launch the watcher, with `run_in_background: true`:

```bash
node "$(jaunt-linear repo)/scripts/linear_watch.mjs" --interval 30 --max-minutes 30
```

Then invoke `linear-orchestrator` once immediately, so the board moves now rather
than at the next change.

Report back: that the watcher is running, what the first pass did, and the caveat
below.

## How the loop actually runs

There is no cron. The watcher polls Linear every 30 s, **stays silent while
nothing moves, and exits as soon as something does** — a backgrounded command
re-invokes this session when it terminates, so the watcher dying *is* the
wake-up. Nothing is spent while the board is still.

Two consequences worth keeping straight:

- The wake-up carries no payload. The harness hands over the watcher's **output
  file**; the orchestrator reads it for the event list.
- Each pass must relaunch the watcher, or the loop ends silently after one
  wake-up. That is `linear-orchestrator` §6.

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
  phase — `planning`, `awaiting-approval`, `implementing`, `landing` — so a
  session waiting on you is distinguishable from one that is working.
- **What is waiting on you is a column, not a reading of comment threads.**
  `jaunt-linear board` lists it under `waitingOnHuman`; empty is the normal
  state.

## Stop

```bash
jaunt-linear loop-off
```

Then kill the running watcher (`KillShell` on its background task, or
`pkill -f linear_watch.mjs`). The flag alone stops the next pass from
relaunching it; killing it makes the stop immediate.

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
jaunt-linear status         # loop flag + every claim, with its worker session UUID
jaunt-linear board          # priorities, blockers, needsPass
gh pr list --state open     # what is landing, and what is stuck landing
```

A loop flagged on with no watcher process is stalled, not running, and that
distinction is the whole point of checking — `pgrep -f linear_watch.mjs` settles
it. Report all three together: the flag says whether it watches, the claims say
what is held, the PR list says what has actually left the machine.

## The caveat to state every time

The watcher is a background task of this session. **It only runs while a Claude
Code session is open on this project.** Close the session and the loop pauses
until one is running again. Never describe it as running unattended on the
machine; say what it actually is.

Nothing is lost during a pause: verdicts are read from the Linear thread, so an
answer written while nobody was listening is picked up on the next pass.
