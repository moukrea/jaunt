---
name: linear-orchestrator
description: Handle one wake-up of the jaunt Linear loop — reconcile state, keep the dependency graph current, dispatch tickets to worker sessions, route human comments to the worker that holds the ticket. Use when the watcher wakes the session, for "traite le réveil", "avance le board", and as the orchestrator half of linear-loop.
---

# linear-orchestrator

You order the board. **You never write product code.** No branch, no edit, no
implementation — a ticket is worked by a spawned worker session, never here.
That separation is what keeps the analysis serious: a session that also codes is
a session tempted to rush the ordering to get to the coding.

`jaunt-linear` is on the PATH and resolves the checkout itself
(`jaunt-linear repo` prints it). Every Linear write goes through it, as the
**jaunt Agent** app.

## What woke you

The watcher exits when the board moves, and the harness hands you its output
file. Read it: it names events, not state.

| event | what it means |
|---|---|
| `comment` | someone wrote on a ticket — §3 |
| `ticket-created` | a new ticket must be compared against the whole board — §2 |
| `ticket-edited` | it returns to the analysis pass — §2 |
| `state-changed` | usually a worker moving its own ticket — §4 |
| `interval-elapsed` | nothing moved; reconcile (§1) and go back to sleep |
| `watcher-failed` | the loop is blind: say so plainly, restart the watcher, do not pretend to work |

Always finish by restarting the watcher (§5). A wake-up that does not re-arm the
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
jaunt-linear move <ID> "In Progress"

UNSET=$(env | grep -oE '^(CLAUDECODE|CLAUDE_CODE_[A-Z_]*)' | sort -u | sed 's/^/-u /' | tr '\n' ' ')
cd ../wt-<ID> && env $UNSET claude -p --session-id "$SID" --permission-mode bypassPermissions \
  "Invoke the linear-worker skill for <ID>." &
```

Purging `CLAUDECODE` and `CLAUDE_CODE_*` is not optional: without it the spawned
session is treated as an ephemeral child, persists no transcript, and cannot be
resumed — which breaks routing and resumption both.

**Stopping a worker.** When new evidence invalidates a claim in flight, ask for a
clean wrap-up, do not kill the process:

```bash
jaunt-linear stop <ID> "<why>"     # the flag the worker checks at phase boundaries
SendMessage to the worker session  # the courtesy that explains it
```

A message reaches a working session but drains only at its next tool round — it
never interrupts work already in flight. The flag is what makes the stop
reliable; the message is what makes it understandable.

When a worker reports finished: verify its ticket and branch, `jaunt-linear
release <ID>`, remove the worktree, and re-examine what was waiting on it.

## 5. Restart the watcher

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
result.
