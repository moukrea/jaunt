---
name: linear-orchestrator
description: Handle one wake-up of the jaunt Linear loop — reconcile state, keep the dependency graph current, dispatch tickets to worker sessions, route human comments to the worker that holds the ticket, and clean up after a merge. Use when the watcher wakes the session, for "traite le réveil", "avance le board", and as the orchestrator half of linear-loop.
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
before the loop existed:

| git event | ticket |
|---|---|
| a branch whose name contains the identifier is pushed | → *In Progress* |
| its PR is merged | → *Done* |

Measured on three tickets: JAU-3, JAU-12 and JAU-4 each went *Done* one second
after PR #58, #59 and #61 merged, with nobody calling `move`. The counter-proof
landed in the same minute — `chore/linear-loop` (#57) merged and moved nothing,
because its name carries no identifier, and its five tickets had to be moved by
hand.

So the rule is: **git owns *In Progress* and *Done*; the loop owns only what git
cannot see** — a ticket parked in *Backlog*, and anything waiting on a human
(JAU-18). Calling `move` for a transition git already performs puts two
authorities on one field with no arbitration, and the loop loses as often as it
wins. **Every branch the loop creates carries the ticket identifier**; that
string is the entire wiring between the board and the code.

## What woke you

The watcher exits when the board moves, and the harness hands you its output
file. Read it: it names events, not state.

| event | what it means |
|---|---|
| `comment` | someone wrote on a ticket — §3 |
| `ticket-created` | a new ticket must be compared against the whole board — §2 |
| `ticket-edited` | it returns to the analysis pass — §2 |
| `state-changed` | git moved it — a push made it *In Progress*, a merge made it *Done* — or a human did; a ticket newly *Done* is §5 |
| `interval-elapsed` | nothing moved; reconcile (§1) and go back to sleep |
| `watcher-failed` | the loop is blind: say so plainly, restart the watcher, do not pretend to work |

Always finish by restarting the watcher (§6). A wake-up that does not re-arm the
watcher ends the loop silently.

## 1. Reconcile before acting

```bash
jaunt-linear status        # claims + loop flag
jaunt-linear board         # tickets, relations, review state, needsPass
```

Claims are files; workers are sessions on disk. After a restart, a claim whose
`session` is set is **not** orphaned — reopen it and ask where it stands
(§4) rather than discarding it. A claim with no session and no plan on the
ticket is a genuine leftover: release it and say so.

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
3. **Survey the code** with an **Explore** subagent before concluding. Ordering
   on prose alone is guessing; the relations you write are durable and later
   ticks execute them as settled fact.
4. **Look for one defect behind several tickets.** Tickets that are plainly the
   same bug routinely share no relation and name no issue key. This is a
   reading, and it cannot be reduced to a computation.
5. **Write the conclusions down** — all four, each doing a different job:

   ```bash
   jaunt-linear priority <ID> <0-4>
   jaunt-linear relate <A> blocks <B>          # B cannot start until A is done
   jaunt-linear comment <ID> "<why it sits there>" --expects none
   jaunt-linear reviewed <ID> "<same reasoning>" --group <root-cause>
   ```

   `--group` is what stops two faces of one defect being worked in parallel.
   Give the same group to every ticket sharing a root cause; leave it off when a
   ticket stands alone.

Amend tickets when the evidence says so: fix an unusable title, add the detail
you established, mark duplicates with `relate <A> duplicate <B>`, split a ticket
that is several unrelated requests (`jaunt-linear create "<title>" --parent <ID>`).
Never delete or cancel a human's ticket.

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
SID=$(node -e 'console.log(require("./.dev-state/claims/JAU-3.json").session)')
claude -p --resume "$SID" "Emeric a répondu sur JAU-3 : « <son message> ». Prends-en compte et réponds-lui sur le ticket."
```

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

When the gate passes:

```bash
SID=$(uuidgen)
git worktree add ../wt-<ID> -b agent/<ID>
jaunt-linear claim <ID> planning --session "$SID"

UNSET=$(env | grep -oE '^(CLAUDECODE|CLAUDE_CODE_[A-Z_]*)' | sort -u | sed 's/^/-u /' | tr '\n' ' ')
cd ../wt-<ID> && env $UNSET claude -p --session-id "$SID" --permission-mode bypassPermissions \
  "Invoke the linear-worker skill for <ID>." &
```

Purging `CLAUDECODE` and `CLAUDE_CODE_*` is not optional: without it the spawned
session is treated as an ephemeral child, persists no transcript, and cannot be
resumed — which breaks routing and resumption both.

Two things about that block are load-bearing and easy to "tidy" away:

- **`-b agent/<ID>`.** The identifier in the branch name is what will move the
  ticket, twice, and link the PR to the board. Name the branch anything else and
  the whole ticket runs invisibly.
- **No `move "In Progress"`.** The push does it. Dispatch is not a state change:
  at this point nothing has been written, and claiming otherwise is how the
  board came to say *In Progress* about tickets where no code existed.

**Stopping a worker.** When new evidence invalidates a claim in flight, ask for a
clean wrap-up, do not kill the process:

```bash
jaunt-linear stop <ID> "<why>"     # the flag the worker checks at phase boundaries
SendMessage to the worker session  # the courtesy that explains it
```

A message reaches a working session but drains only at its next tool round — it
never interrupts work already in flight. The flag is what makes the stop
reliable; the message is what makes it understandable.

## 5. After a merge, clear the way

The worker lands its own ticket — rebase, push, PR, CI, `gh pr merge --squash
--delete-branch` (its §7). You do not push and you do not merge. You do the three
things it cannot do from inside its own worktree.

**Verify, then release.** Take the report seriously enough to check it:

```bash
gh pr view <n> --json state --jq .state    # MERGED
jaunt-linear show <ID>                     # state.name must be Done
jaunt-linear release <ID>
git worktree remove ../wt-<ID>
```

A merged PR whose ticket is still not *Done* a minute later means the branch name
carried no identifier. Move it by hand and name the miss in your pass — it is the
one failure mode that looks exactly like success, and the only sign is a ticket
sitting quietly in the wrong column.

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

## 6. Restart the watcher

Last thing, every time, unless the loop is off:

```bash
node "$(jaunt-linear repo)/scripts/linear_watch.mjs" --interval 30 --max-minutes 30
```

Run it with `run_in_background: true`. It stays silent while the board is still
and exits when something moves — that exit is the next wake-up. Nothing is spent
in between.

## Honesty

Nobody watches a wake-up happen. If the watcher failed, say the loop is blind
rather than reporting a quiet board. If a pass was skipped, say which. Never
report a ticket as advanced because a worker was launched — a launch is not a
result, and neither is an open PR. Nothing is landed until a merge you checked,
and a ticket that went *Done* on its own is the proof, not your memory of
dispatching it.
