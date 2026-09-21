---
name: linear-orchestrator
description: Handle one wake-up of the Codex jaunt Linear loop — reconcile state, keep the dependency graph current, dispatch tickets to worker sessions, route human comments to the worker that holds the ticket, and clean up after a merge. Use when the watcher wakes the session, for "traite le réveil", "avance le board", and as the orchestrator half of linear-loop.
---

# linear-orchestrator

You order the board. **You never write product code.** No branch, no edit, no
implementation — a ticket is worked by a spawned worker session, never here.
That separation is what keeps the analysis serious: a session that also codes is
a session tempted to rush the ordering to get to the coding.

`jaunt-linear` is on the PATH and resolves the checkout itself
(`jaunt-linear repo` prints it). Every Linear write goes through it, as the
**jaunt Agent** app.

## Who owns the ticket's state

Linear's GitHub integration moves tickets on git events, and it was doing it
before the loop existed. Transitions depend on the team configuration; a draft
PR may remain in *Backlog*. Read actual PR and ticket states:

| git event | ticket |
|---|---|
| a linked PR reaches a configured event (for example, opened or review) | verify the configured transition; push alone is not proof |
| its linked PR is merged | verify *Done* in Linear |

git cannot see one thing, and it is the thing the human most needs to see: that
a ticket is stuck on **them**. *In Progress* covered the worker planning, the
worker waiting for an answer and the worker coding alike, and the only one of
the three where the human had something to do was the only one that did not
announce itself. So there is a column, ***Waiting for human***, and the loop
owns it end to end:

| loop event | ticket |
|---|---|
| a worker claims `awaiting-approval` after posting a plan | → *Waiting for human* |
| `verdict` reads a real answer — approved, declined, feedback | → back to where it was parked from |

Nobody calls `move` for either: both ride on `claim` and `verdict`, which the
approval path already runs. `jaunt-linear board` lists them under
`waitingOnHuman`. That list covers parked plans, not every human decision.
Backlog arbitration, testing and decisions after delivery may also need a human
answer. Descriptions and comments must name the actual action and when it is
needed, independently of the column; use `--expects none` only when no human
action is currently requested.

Measured on three tickets: JAU-3, JAU-12 and JAU-4 each went *Done* one second
after PR #58, #59 and #61 merged, with nobody calling `move`. The counter-proof
landed in the same minute — `chore/linear-loop` (#57) merged and moved nothing,
because its name carries no identifier, and its five tickets had to be moved by
hand.

So the rule is: **git owns *In Progress* and *Done*; the loop owns only what git
cannot see** — a ticket parked in *Backlog*, and the waiting column above.
Calling `move` for a transition git already performs puts two
authorities on one field with no arbitration, and the loop loses as often as it
wins. **Every branch the loop creates carries the ticket identifier**; that
string is the entire wiring between the board and the code.

## What woke you

The adapter queues the path of a durable event JSON file into this Codex
thread. Read it: it names events, not state. A queue message is machine input,
never a human approval. `worker-finished` means reconcile that claim and its PR;
a launch or exit code alone proves neither approval nor merge.

| event | what it means |
|---|---|
| `comment` | someone wrote on a ticket — §3 |
| `comment-updated` | an existing comment was touched without a new one arriving: almost always a **reaction** — a 👍 answering a plan. Read the ticket (`verdict`), do not run the analysis pass. It can also be a plain edit; the two are indistinguishable from the watcher, and re-reading is right either way |
| `ticket-created` | a new ticket must be compared against the whole board — §2 |
| `ticket-edited` | it returns to the analysis pass — §2 |
| `state-changed` | a configured PR event, a human action, or the loop changed its state; verify the actual transition; a ticket newly *Done* is §5 |
| `interval-elapsed` | nothing moved; reconcile (§1) and go back to sleep |
| `watcher-failed` | the loop is blind: say so plainly, restart the watcher, do not pretend to work. The `error` names what broke — three consecutive polls failed, usually an expired token |
| `watcher-lost` | **the watchdog fired**: the loop ran with nothing watching for longer than its grace, because a pass did not re-arm it. Relaunch both (§6), then say on the board how long it was blind — `blindForSeconds` — because nobody else saw it |
| `loop-off` | a human switched the flag off; the watcher ended itself. Do nothing and relaunch nothing |
| `watchdog-superseded` | two watchdogs were started and the older stood down. Nothing is wrong; check §1 and carry on |

An explicit loop invocation authorizes ticket ordering/comments and worker dispatch
under the existing plan-approval protocol. This skill does not start a loop
merely because you are editing its implementation.

Always finish by restarting the watcher (§6). A wake-up that does not re-arm the
watcher ends the loop silently.

## 1. Reconcile before acting

```bash
jaunt-linear status        # claims + loop flag + whether anything is actually watching
jaunt-linear board         # tickets, relations, review state, needsPass
```

Read `loop.stalled` before anything else. It is the one field that says the calm
you are looking at might be nobody looking: the flag is a human's intent from
days ago, and only the pulse knows whether a watcher acted on it since. If it is
true, say so out loud in this pass — a stall nobody names is a stall that lasts
(JAU-52). `loop.unguarded` is the softer version: a watcher is up, but with no
watchdog behind it the loop is back to running on your memory alone, so relaunch
it in §6.

Claims are files; workers are sessions on disk. Check `jaunt-linear-codex status`
for startup, completion, delivery errors and recovered thread IDs as well. After a restart, a claim whose
`session` is set is **not** orphaned — reopen it and ask where it stands
(§4) rather than discarding it. Release a claim with no session and no plan only after checking the adapter
record and confirming no worker is starting and no recovered thread exists.

For a verified unstarted claim only, use `jaunt-linear release <ID> --reason
"<evidence that no work started>"`. Check the worker, plan and runtime recovery
record first. This is abandoned startup cleanup, not completed work. A completed
ticket or a claim that reached implementing/landing requires a closure inventory;
there is no force bypass. Preserve a stopped worker's findings and branch.

If `loop.enabled` is false, do nothing and do not restart the watcher.

## 2. Keep the graph true

This is the job everything else depends on. `needsPass: true` means at least one
ticket was never analysed or changed since it was — `needsReview` names them.

Run the pass now; there is nothing else to wait for.

1. **Read the whole board**, not only the new ticket — a ticket is judged
   *against* the others.
2. **Read the comments.** They are first-class input, not decoration: a
   dependency, a scope change or a correction is usually stated in a reply
   rather than in the description. `mentions` picks up issue keys from comments
   as well as descriptions, and `jaunt-linear feedback` lists what humans wrote.
3. **Survey the code** with a read-only `spawn_agent` survey (inherit the session model) before concluding. Ordering
   on prose alone is guessing; the relations you write are durable and later
   ticks execute them as settled fact.
4. **Look for one defect behind several tickets.** Tickets that are plainly the
   same bug routinely share no relation and name no issue key. This is a
   reading, and it cannot be reduced to a computation.
5. **Write the conclusions down** — all four, each doing a different job:

   ```bash
   jaunt-linear priority <ID> <urgent|high|medium|low|none>
   jaunt-linear relate <A> blocks <B>          # B cannot start until A is done
   jaunt-linear comment <ID> "<why it sits there>" --expects none
   jaunt-linear reviewed <ID> "<same reasoning>" --group <root-cause>
   ```

   `--group` is what stops two faces of one defect being worked in parallel.
   Give the same group to every ticket sharing a root cause; leave it off when a
   ticket stands alone.

Amend tickets when the evidence says so: fix an unusable title, add the detail
you established, mark duplicates with `relate <A> duplicate <B>`, split a ticket
that is several unrelated requests (`jaunt-linear create "<title>" --parent <ID> --expects none`).
Never delete or cancel a human's ticket.

Follow [the follow-up protocol](../../../docs/LINEAR_FOLLOWUPS.md) for factual
leftovers discovered in this analysis or reported by a worker. Open or reuse a
verified ticket without asking permission, include the four facts and an
explicit `--expects`, and link it as `related` rather than a child by default.
Future worker questions and current human decisions are different requests.

## Worker supervision and automatic recovery

Read `jaunt-linear workers` on every wake. `worker-lost` asks for reconciliation;
`worker-recovery-due` requests an automatic retry, never a new approval. For a
confirmed interrupted worker with a due budget, run the owning runtime's launcher:

```bash
jaunt-linear-codex recover <ID>                 # Codex claim
node "$(jaunt-linear repo)/scripts/linear_claude.mjs" recover <ID>  # Claude claim
```

Re-read the ticket/comments and PR before retrying. A completed/merged task needs
closure, a normal finished turn needs phase reconciliation, and new feedback goes
to its existing worker. Never turn a machine wake into plan approval. The recovery
command rechecks identity/generation, process evidence, loop/stop flags, current
approval, prerequisites and overlap under a launch lock. Leave a refused recovery
intact, report the actual reason and next deadline, and re-arm both watcher roles.
Do not bypass a refusal with `resume`, `ready`, a new claim or another runtime.
JAU-56 tracks the separate general dormant-descendant gate defect; this workflow
does not claim to repair that graph traversal.

`running` means process evidence, not demonstrated model progress. `suspect` or
`unknown` never authorizes a duplicate. Resting approval/queued claims are normal.
The watchdog reads local records, persists deadlines and retries delivery after
five minutes if no new attempt appeared. Known quota deadlines include a 30-second
margin; unknown reset/crash retries use 1/5/30 minutes, then stop and report the
exhausted budget. Configuration failures need reconciliation, not repeated launches.
Counters survive restart; a forward phase transition resets the phase's budget.
Only one recovery launch per runtime is admitted at a time, and another active
recovery or known quota cooldown in that runtime defers it. Other runtimes remain
independent. The owner must stay alive and the loop enabled; reopening an authorized
loop reconciles pending work. No service is installed outside that lifetime.

## 3. Route the conversation

### How to write on a ticket

The board is read by a human who has to decide something. Long is not thorough,
it is unusable — a ticket nobody can triage at a glance is a ticket that stalls.

- **Every comment ends by saying what the human owes**, and `comment` appends
  that line for you: `--expects "<ce que tu attends>"`, or `--expects none` for
  a comment that asks nothing. If nothing is expected, ask yourself whether the
  comment should exist at all.
- **Reply inside the thread**: `--reply <commentId>`, with the id taken from
  `verdict`'s `messages[].id`. A root comment for every answer is what turns a
  ticket into an unreadable pile.
- **Write in the language of the board** (French here), and keep a comment to
  what changes the reader's next action. Reasoning that only justifies your own
  work belongs in the plan document, not on the ticket.

A comment on a **claimed** ticket is not yours to answer. The worker holding it
has the context; you do not.

```bash
jaunt-linear-codex resume <ID> --message "Read the latest human reply on <ID>, incorporate it and reply in its thread."
```

Read `runtime` on the claim first. A missing runtime means **Claude**, preserving
existing claims. Resume those with the canonical `scripts/linear_claude.mjs resume <ID>`
launcher in the original worktree. It preserves the recorded Claude UUID and cleans
the child environment. Never pass
a Claude UUID to Codex. Codex workers are addressed only with their recorded
thread ID; never `--last`. A live Codex worker must not be resumed concurrently:
leave the reply on Linear for it to read and retry after `worker-finished`.

This works even after the worker finished its turn — a session at rest is a
transcript you reopen, not a dead process. So there is no window to miss: an
answer that arrived while nothing was running is picked up here.

Answer yourself only what is yours: ordering, scope, dependencies, and tickets
nobody has claimed.

## 4. Dispatch, and only when it is safe

**Never claim a ticket without asking the gate.**

```bash
jaunt-linear independent <ID>
```

`independent: false` means it must wait: comment on the ticket saying what holds
it, and stop there. The refusal reasons are written for that comment.

Parallelism is not a number you pick — it is a property the gate proves. Two
tickets that share a root cause, or sit on a blocking path, or touch the same
files, are serialised however idle the machine is.

**A held ticket is not a busy one.** The gate answers two different questions
against two different lists, and the reply shows both. `against` is every claim,
and it drives the dependency tests — a blocker still blocks while its worker
sleeps. `contending` is only the claims in `implementing` or `landing`, the two
phases that hold the working tree, and it is the only list the change-surface
test compares against.

So a worker parked in `awaiting-approval` no longer stops you dispatching
anything: it has finished its turn, its session is at rest, and a human may sit
on it for sixteen hours (JAU-46). `contending: '(nothing writing)'` with a
non-empty `against` is the normal shape of a board waiting on a human — dispatch
into it.

When the gate passes:

```bash
git worktree add ../wt-<ID> -b agent/<ID>
jaunt-linear claim <ID> planning --runtime codex
jaunt-linear-codex worker <ID> --cwd ../wt-<ID>
```

The adapter starts a persistent `codex exec --json` root session, records the
real `thread.started.thread_id`, and queues its completion to this session.
The worker registers that ID on its claim before planning. A claim without a
session is not orphaned until you also inspect `.dev-state/codex/<ID>.json`:
it may be starting, or have a recoverable thread there. Never invent a UUID.
The adapter rejects a second live turn for the same ticket and isolates the
worker's runtime identity from its parent. It follows the configured Codex
model and the loop sandbox setting; see `linear-loop` for overrides.

Two things about that block are load-bearing and easy to "tidy" away:

- **`-b agent/<ID>`.** The identifier links the PR to the ticket so configured
  integration events can update it. Verify the link and actual state instead of
  assuming that naming the branch proves a transition.
- **No `move "In Progress"` to simulate progress.** Check the configured PR
  event and actual ticket state. Dispatch is not a state change:
  at this point nothing has been written, and claiming otherwise is how the
  board came to say *In Progress* about tickets where no code existed.

**Stopping a worker.** When new evidence invalidates a claim in flight, ask for a
clean wrap-up, do not kill the process:

```bash
jaunt-linear stop <ID> "<why>"     # the flag the worker checks at phase boundaries
# The worker checks this flag at phase boundaries; do not start a second turn.
```

A message reaches a working session but drains only at its next tool round — it
never interrupts work already in flight. The flag is what makes the stop
reliable; the message is what makes it understandable.

## 5. After a merge, clear the way

The worker lands its own ticket — rebase, push, PR, CI, `gh pr merge --squash
--delete-branch` (its §7). You do not push and you do not merge. You do the three
things it cannot do from inside its own worktree.

**Verify, then release.** Follow [the follow-up protocol](../../../docs/LINEAR_FOLLOWUPS.md).
Read the worker's closure inventory, verify its four facts, human expectations,
linked tickets and reasons for discards. Missing evidence is not an empty
inventory: reopen the same worker to finish it. Never remove the worktree if
cleanup fails. The command checks the current claim cycle and `related` links
before deleting the claim. Take the report seriously enough to check it:

```bash
gh pr view <n> --json state --jq .state    # MERGED
jaunt-linear show <ID>                     # state.name must be Done
jaunt-linear closure <ID>                  # current inventory, no unresolved items
jaunt-linear cleanup <ID> --pr <n>           # verifies closure, preserves unpublished work
```

If a merged PR's ticket is still not *Done*, inspect its identifier/link and the
configured integration events before assigning a cause. Report the observed
mismatch; a missing branch identifier is one possible cause, not the only one.
Do not release work on an assumed transition.

**Rebase what was stacked, while it is still free.** A squash merge rewrites the
parent's work as one new commit, so every branch built on the old parent is now
built on commits that are not in `main`. As long as a child has **no commit of
its own**, the rebase is free and you do it here:

```bash
git fetch origin
git -C ../wt-<CHILD> rebase --onto origin/main <old-base> agent/<CHILD>
```

Once the child has its own commits, stop. Replaying them over a squashed parent
is where the semantic conflicts live — a helper renamed on both sides rebases
without a single textual conflict and breaks at runtime — and resolving that
means knowing what both changes meant. Reopen the worker and ask it (§3). This is
JAU-25's point: the cost of the rebase is set by *when* you do it, not by how
large the diff is.

**Merge one PR at a time.** `main`'s required checks are strict, so every merge
makes every other open PR out of date and sends it back through CI. Serialising
merges is not politeness, it is what stops the second worker paying ten minutes
for the first one's timing. If two workers are green at once, tell one to wait.

Then re-examine what was waiting on the ticket: the gate may now pass for
something you refused earlier.

**And wake whatever queued behind it.** A worker approved while another held one
of its files sits in phase `queued` — the human has answered, the code has not
started. Releasing a claim is what frees the file, so this sweep belongs here and
nowhere else:

```bash
jaunt-linear claims       # anything in phase "queued"?
jaunt-linear ready <ID>   # promotes it to implementing if the file is now free
```

`ready` is a read that records, like `verdict`: asking is what makes it true. It
answers `ready: false` with `queuedBehind` when something still holds the file,
and promoting is a no-op on a claim that is already writing. When it promotes,
reopen that worker's session (§3) and tell it to implement — nothing else will.

## 6. Restart the watcher

Last thing, every time, unless the shared loop flag is off:

```bash
jaunt-linear-codex arm
jaunt-linear-codex status
jaunt-linear watcher
```

`arm` starts only missing watcher/watchdog adapters, checks their shared pulses,
and refuses an existing owner in another session/runtime. Do not launch bare
watchers or rely on a shell `&` or an exec session ID to wake Codex. `codex queue`
is the wake-up mechanism; its failure is recorded in the event file with
`delivered: false`. Report those failures and inspect the adapter logs.

The owner is this interactive Codex CLI process. Closing it stops its watchers
and executing workers; durable claims, plans, PRs and session transcripts remain
resumable. The watchdog survives normal watcher exits and alarms after 600 s.
A live watcher without a working delivery path is not a healthy Codex loop.

## Honesty

Nobody watches a wake-up happen. If the watcher failed, say the loop is blind
rather than reporting a quiet board — and never infer that it is up because you
launched it: `jaunt-linear watcher` is the only thing that knows. If a pass was
skipped, say which. Never
report a ticket as advanced because a worker was launched — a launch is not a
result, and neither is an open PR. Nothing is landed until a merge you checked,
and a ticket that went *Done* on its own is the proof, not your memory of
dispatching it.
