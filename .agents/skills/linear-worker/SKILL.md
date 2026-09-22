---
name: linear-worker
description: Carry one jaunt Linear ticket from plan to merged PR inside a persistent Codex worker session — survey, post a plan for approval, declare the change surface, implement on the worktree branch, then push, open the PR, watch the CI and squash-merge it. Use when a spawned session is told to work a ticket, or for "travaille JAU-x".
---

# linear-worker

You own **one ticket**, end to end, in your own git worktree. You do not order
the board, do not set priorities, do not touch another ticket. The orchestrator
owns that, and it is writing relations while you work.

`jaunt-linear` is on the PATH. Every Linear write goes through it, as the
**jaunt Agent** app — never by another route.

## Codex session and checkout

This is the Codex port of `.claude/skills/linear-worker/SKILL.md`. The ticket
protocol and landing rules below are identical. Use the installed canonical
`jaunt-linear` launcher, never a worktree's private copy: credentials, claims,
surfaces and approval receipts belong to the main checkout. The runner provides
`JAUNT_LINEAR_ROOT` for recovery if PATH is missing.

Before any work, read `jaunt-linear claims` and register the actual
`CODEX_THREAD_ID` with `jaunt-linear claim <ID> <current-phase> --session
"$CODEX_THREAD_ID" --runtime codex`. Preserve the phase; a resumed worker must
not reset approval or queued state. Refuse claims owned by Claude (including
legacy claims with no runtime). `codex exec resume <exact-id>` restores context;
subagents are for surveys, never a replacement for the durable ticket session.

An explicit invocation of this worker authorizes the ticket comments and the
approved implementation/PR/merge workflow below. It does not approve a new plan.
Read the stop flag and loop status before landing; if the loop is off, preserve
the branch/PR and finish without merging. The orchestrator resumes you later.

## Check the stop flag first, and between phases

```bash
jaunt-linear stop-requested <ID>
```

`stop: true` means the orchestrator learned something that invalidates your
claim — a ticket arrived showing yours depends on another, most often. Wrap up
cleanly: comment on the ticket saying where you got to and what is reusable, do
not start the next phase, and finish your turn. Check it again before
implementing, and between files on a long change.

You may also receive a message from the orchestrator mid-work. It arrives at your
next tool round, not as an interrupt, so treat the flag as the reliable signal
and the message as the explanation.

## 1. Understand the ticket

```bash
jaunt-linear show <ID>
jaunt-linear attachments <ID>     # downloads screenshots — open them with view_image
```

**Read the comments, not just the description.** Scope, corrections and
dependencies are usually stated in replies. A ticket's latest comment often
contradicts its body, and the comment wins.

For a display bug, open the screenshot. Diagnosing one from CSS alone means
describing a symptom you never saw.

## 2. Survey, then verify

Use `spawn_agent` for a read-only survey of the areas the ticket names.
Inherit the worker model unless the user selected another Codex model. Wait for
the report with `wait_agent`; if native delegation is unavailable, survey the
code yourself and say so. Its report is a survey, not a verification.

Then check, yourself, the specific things your plan will depend on:

- **Open every `file:line` you commit to changing.** Do not assert "six
  mechanical sites" about lines you have not read.
- **Grep every symbol's definition *and its other call sites*.** This is the one
  that matters: the danger is never what the survey said about the symbol, it is
  the callers nobody asked about. A CSS class you propose to restructure may be
  used in forty places, most of them screens the ticket never mentions.
- **Scope every selector and signature change** to the ticket's context, and show
  in the plan why it cannot reach further.

## 3. Declare your change surface

Before posting the plan, replace any orchestrator forecast with the scope you
verified in your own survey, even if the file list is unchanged:

```bash
jaunt-linear surface <ID> --files web/js/app.mjs,web/style.css --symbols .settings-row,.settings-group
```

The forecast enabled dispatch; this declaration describes the actual plan.
Use explicit repository-relative paths, including tests, and relevant symbols:
comparisons are exact, not glob or directory-prefix matches. Do not keep a
narrower forecast when your survey finds more work. Once claimed, you own this
surface; the orchestrator must not overwrite it.

A missing surface means overlap cannot be ruled out when another worker is
writing. The approval gate rechecks your verified scope against implementing
and landing claims; an expanded scope that now overlaps queues you (§5).
Declaring a surface does not itself authorize implementation or reserve files
while you are planning or waiting for approval.

## 4. Post the plan and stop

```bash
jaunt-linear plan <ID> --summary "<3-6 lignes, en français>" \
  --expects "approuver (👍 sur n'importe quel commentaire du fil) ou répondre des corrections" \
  < plan.md
jaunt-linear claim <ID> awaiting-approval --session "$CODEX_THREAD_ID" --runtime codex
```

The long plan goes into a Linear **document**; `--summary` is what the human
actually reads on the ticket. Write the summary so it can be answered *without*
opening the document: what changes, what does not, what you need from them. If
the summary runs past a screen, it is not a summary.

A **re-plan answers someone**, so it takes `--reply <commentId>` — the id of the
comment that asked for the change, from `verdict`'s `messages`. The digest then
lands inside that thread instead of starting a third conversation at the root.
A first plan has nobody to answer and stays at the root.

That `claim` is also what **parks the ticket in *Waiting for human***, the one
column that says the board is stuck on somebody rather than on an agent. It
remembers the state it moved the ticket out of (`parkedFrom` in the claim) and
`verdict` puts it back, so the parking is yours to make and never yours to
undo. Claim `awaiting-approval` even if you think the ticket is already parked:
a second claim on a parked ticket is a no-op and keeps `parkedFrom` intact.

`CODEX_THREAD_ID` is the durable Codex address. Require a nonempty value;
never substitute an invented UUID or `--last`. Check `jaunt-linear status`:
the claim must carry that session and `runtime: "codex"`. The adapter also saves
`thread.started.thread_id` in `.dev-state/codex/<ID>.json` for crash recovery.

The document covers: what the ticket actually asks, the files that change, the
approach, what you will *not* do, the risks — and one section that is not
optional:

> **Not verified** — everything the plan assumes without having checked it.

Verified findings and confident guesses read identically once written, and the
reader cannot tell them apart. Anything inferred from the survey rather than read
yourself, any behaviour promised without naming the mechanism and the file that
implements it, any screenshot you could not open: it goes there. An empty "Not
verified" section is a strong claim — only make it when it is true.

If the ticket asks to be split, split it here, with the analysis in hand:
`jaunt-linear create "<title>" --parent <ID> --expects none --desc -`. That is the deliverable;
describing a split in prose for a human to retype is not doing the work.

Then **stop your turn**. Do not implement. The human answers on the ticket —
`/approve`, `/decline`, 👍 or free text — and the orchestrator reopens you with
their answer.

A 👍 counts wherever they put it on your side of the thread, not only on the
plan comment: the natural gesture is to react to the message you have just read,
and telling them in words to scroll back up to the plan failed twice before it
was made true in the code (JAU-36). Do not ask them to aim. What a reaction
cannot outrank is a message they wrote *after* it — words that came later win,
so a 👍 followed by "ah, et aussi…" reads as `feedback`.

## 5. Resume on the verdict

```bash
jaunt-linear verdict <ID>
```

**Reading the verdict is what records it.** This command is the only one the
approval path is certain to run, so it does the bookkeeping itself rather than
leaving you a step to remember: on `approved` it posts the receipt in the plan's
thread (once, whatever you run it twice) and sets the claim to `implementing`;
on any real answer it takes the ticket back out of *Waiting for human*. What it
did comes back under `registered`. Use `--peek` when you only want to look — an
orchestrator checking on a worker, a human reading the board — because a peek
must not answer on the worker's behalf.

**Approved does not always mean *now*.** The dispatch gate lets a ticket start
while you are parked, because a sleeping claim holds no files (JAU-46) — so the
approval is where overlap gets checked instead. If another worker is writing a
file you declared, `registered` comes back with `phase: 'queued'` and
`queuedBehind`. The human is done with you; a file is not. Say so on the ticket,
name what you are waiting on, and stop. The orchestrator runs `jaunt-linear
ready <ID>` when that claim releases and reopens you.

| verdict | what to do |
|---|---|
| `approved` | implement (§6), then land it (§7) — unless `registered.phase` is `queued`: comment what holds you, stop |
| `feedback` | the human is steering: fold it in, retract the superseded plan with `jaunt-linear uncomment <COMMENT-ID>`, post a new one, stop again |
| `declined` | comment that it is parked, `jaunt-linear move <ID> "Backlog"`, tell the orchestrator you are done |
| `pending` | nothing was answered — stop; you will be reopened |
| `no-plan` | no plan for this claim. A `note` about a stale plan means an earlier cycle left one behind: ignore it, go to §2 |

## 6. Implement

On your worktree branch, and nowhere else.

The claim now reads `implementing` — `verdict` set it. That phase is the answer
to "is this session waiting on me or working?", so if you ever reach here
without having read a verdict, say so with
`jaunt-linear claim <ID> implementing --session "$CODEX_THREAD_ID" --runtime codex`. The
six phases are `planning`, `awaiting-approval`, `queued`, `implementing`,
`landing` and guarded `awaiting-external`; anything else is refused.

Only `implementing` and `landing` hold the working tree, and that is what the
dispatch gate compares against. It is also why reaching here in phase `queued`
means writing anyway would be the collision the queue exists to prevent: ask
`jaunt-linear ready <ID>` first, and implement only on `ready: true`.

Follow the repo's conventions (`AGENTS.md`, `START_HERE.md`) and Conventional
Commits: subject in the imperative, **72 characters or fewer**, and `git commit`
**alone in its command** — the hook fails on a compound one. Run `npm test`
before calling it done. If your change strays outside the surface you declared,
re-declare it before continuing, so the orchestrator can re-check overlap.

Committed is not delivered. Go to §7.

## 7. Land it

A branch on your disk is not a result. You carry the ticket all the way to
**merged**, yourself: reading a red CI means knowing what the change was trying
to do, and you are the only session that knows.

### The branch name is the wiring

```bash
git branch --show-current      # must contain <ID>
```

Linear's GitHub integration links the ticket through the branch identifier.
Status transitions depend on the team's configured PR events: a push alone is
not proof of *In Progress*, and a draft PR may leave the ticket in *Backlog*.
Read the actual PR and Linear states after opening the PR and after merging;
report discrepancies rather than inventing progress. Do not call `move` to
simulate a transition the integration is expected to perform. If a transition
is missing, inspect the PR link and configured event before naming its cause.

### Reserve before the final rebase and CI

Use the installed canonical launcher for every command below. Never run a
worktree's harness against production state. If the canonical checkout has not
been upgraded, report that fact to the orchestrator; do not overwrite its local
changes to activate new commands.

```bash
jaunt-linear landing acquire <ID> --runtime codex --session "$CODEX_THREAD_ID"
```

This enters `landing` and records the ticket, claim cycle, actual session and
worktree in a durable FIFO. Only `acquired: true` permits the final rebase,
prepare, push and CI round. When false, comment the owner on Linear, preserve
work, and finish the turn. The orchestrator resumes this same worker when it is
first. This wait is not the surface gate's `queued` phase. A bare `claim ...
landing` cannot enter without admission; refreshing an existing claim never
transfers the reservation to another session.

Once acquired, fetch and rebase a branch created from main:

```bash
git fetch origin
git rebase origin/main
jaunt-linear landing prepare <ID> --runtime codex --session "$CODEX_THREAD_ID"
npm test
```

`prepare` records the exact local head and current remote main, requiring main
to be an ancestor and a clean worktree. An unchanged published `plan.md` is
allowed only with its matching publication receipt. After any commit/rebase,
prepare again, rerun tests and push the new head. A new main invalidates the
prepared evidence; retain the turn, fetch, rebase and repeat the final checks.

### Stacked branches and conflicts belong to this worker

New worktrees normally start explicitly at `origin/main`. If the assigned
worktree deliberately starts on a parent branch, record provenance **before
its first own commit**, after registering this worker's real session:

```bash
jaunt-linear stack record <ID> --parent agent/<PARENT> --base <full-parent-SHA> --runtime codex --session "$CODEX_THREAD_ID"
```

The parent SHA must equal the child's initial head and current parent head.
The immutable record is bound to this claim cycle, separate from phase changes.
Prefer opening the child PR only after the parent has merged, with base main.
When the parent is verified merged, instead of the ordinary rebase above use:

```bash
jaunt-linear stack rebase <ID> --pr <parent-PR> --runtime codex --session "$CODEX_THREAD_ID"
```

This validates the recorded base, parent merge, repository, active child branch
and clean worktree, fetches origin, and returns a Git argv recipe. Execute the
returned `git rebase --onto origin/main <recorded-base> <child-branch>` in its
reported cwd, in this worker only. It never rewrites another worker's checkout.
Do this once for the parent squash, then use ordinary main rebases. Missing or
ambiguous provenance is a refusal, not permission to guess a merge-base.

On textual conflicts, inspect both changes' intent and resolve them here;
never discard one side wholesale to make Git succeed. If intent needs a human
decision, explain the concrete alternatives on the ticket and preserve the
branch/conflict evidence. After clean rebases too, inspect modified helper
definitions and callers and run `npm test` plus the surface's focused tests.
For UI work include syntax checking and the relevant browser e2e. A clean
textual rebase does not prove semantic compatibility.

### Push, open the PR, watch the checks

```bash
git push -u origin "$(git branch --show-current)"
gh pr create --fill --base main
gh pr checks <n> --watch
```

The required contexts are `lint` and `test`. `test` runs no test of its own: it
fails unless `host`, `browser-and-relay` and `installer-fedora` all succeed, so
`test` being red only tells you to look at the job underneath it. No human review
is required — green is the entire gate.

### Make the PR tryable

A reviewer must be able to try what is under review. When the PR opens, comment
on the ticket with what will be tryable and from which workflows; once the runs
finish and you have downloaded and checked the artifacts, update that thread
before merging with the exact run links, the platform, a short procedure, the
expected result, what you verified and the limits. A visual check links a
published capture of the screen concerned. `--expects none` unless the plan
named a human decision: this is no new approval gate. Recipes, artifact names
and the desktop sandbox limitation are in
[docs/PR_VALIDATION.md](../../../docs/PR_VALIDATION.md).

### A red CI: read it before you name it

```bash
gh run view <run-id> --log-failed
```

Then, and only then, choose:

| what the log shows | what to do |
|---|---|
| your change broke it | fix, `git commit`, push, watch again |
| a known flake — JAU-29: `browser_e2e` asserting on `proof.txt` against a list that is still empty | `gh run rerun <run-id> --failed` |

The two mistakes cost the same. Patching a flake fixes nothing and burns an
hour; rerunning a real failure hides a regression until someone else finds it.
The rule is not "rerun the e2e failures" — it is **read the log, then decide**,
and a failure you cannot recognise in the log is a real one until proven
otherwise.

### Merge through the reservation

```bash
jaunt-linear landing merge <ID> --pr <n> --runtime codex --session "$CODEX_THREAD_ID"
```

The command verifies the current owner, stop/loop flag, prepared head and main,
PR branch/base, and successful lint/test checks. It inventories all open child
PRs targeting this branch with pagination, persists their heads and original
bases before editing, retargets them to main, and verifies each before merging.
A changed/closed child or failed API read blocks the parent. It rechecks for
new children and changed parent/main before a squash merge with an exact head
condition. GitHub's strict protection is the final guard against external merges.
Do not bypass this with a direct `gh pr merge` or change repository settings.

The command avoids local branch deletion/checkout; GitHub still deletes the
remote branch after merging. It rereads actual PR state even if the merge
response was lost, releasing the turn only after verified MERGED evidence.
If that read also fails, retry the same command: a verified merged PR with the
recorded head completes without another merge request. An explicit GitHub policy/base/head refusal on a still-open PR records the
rejection and permits prepare/retest again without surrendering the turn.
An ambiguous attempt retains its original prepared-head evidence and ownership. Inspect the PR before doing anything else; an
unresolved attempted merge cannot simply be abandoned while the PR is open.
Preserve it for reconciliation, or explicitly close that PR after inspection
before releasing and later reopening/reacquiring for another attempt.

For an explicit abandonment before a merge attempt:

```bash
jaunt-linear landing release <ID> --reason "<why this final CI turn is abandoned>" --runtime codex --session "$CODEX_THREAD_ID"
```

This verifies the branch's PR state, keeps its branch/PR and records the reason.
It also works while the loop is off or stop is set; neither flag automatically
hands ownership to another worker. A crash, elapsed time or missing process
never expires a durable turn. An uncertain operation lock, stale cycle or
changed session needs orchestrator reconciliation of the existing owner and
remote PR; never delete the reservation to get unstuck. After releasing an
unmerged turn, acquire and prepare anew before any final CI or merge.

Read `landing status` and the actual PR/Linear states. A successful merge should
move the ticket to Done through the integration; verify it. The next worker may
then acquire the head of the file. This is local coordination for the canonical
checkout, not a distributed lock or a GitHub merge queue.

### Verify publication separately from merge

For product changes, inspect the `Automatic release` run and its durable
`jaunt-release-state` receipt for the merged source. `pending`/`failed` means
publication is not delivered. Only a delivered receipt, verified asset links and
the public Page's matching `releaseSource` justify reporting delivery. If a later
source is published already, verify the merged source's delivered history too.
Report a blocked/failed run precisely and track factual leftovers through the
follow-up protocol below. A docs/harness-only change needs no new package.

Do not bump versions, create tags or dispatch individual component/Pages
workflows in a ticket worker. The exclusive coordinator computes versions and
owns publication; manual retries go through `auto-release.yml` on main. Read
`docs/DEPLOYMENT.md` for activation, credential checks and recovery. Keep merge
landing reservations separate from the GitHub production publication lock.

### Retain an external obligation after verified merge

A merged PR with an unresolved delivery/coordination obligation must not retain
all source files in `landing`. Once **all code is merged**, use the canonical
launcher to enter the guarded `awaiting-external` phase:

```sh
jaunt-linear wait begin <ID> --runtime <actual-runtime> --session <actual-session> \
  --pr <merged-PR> --reason "<observed blocker>" --owner "<responsible person/session>" \
  --action "<one precise action requiring a decision>" --resource "jaunt-production-release"
jaunt-linear wait read <ID>
```

The default deadline is 15 minutes; `--deadline <UTC-ISO-ending-Z>` sets an explicit
future deadline. Admission requires the current claim cycle's verified merge
history, exact clean worktree/head, main ancestry and released landing reservation.
Missing legacy evidence, unpublished code or an ambiguous merge is a refusal,
not permission to free files. Do not bypass with a direct phase change. Preserve
pending admission on publication/label failure and retry reconciliation.

The request in Linear names the owner, reason, attempts, action and deadline.
Only `/wait <wait-id> approve` in that request's thread authorizes the named action;
`decline` refuses it and ordinary prose is feedback for this worker. Read the
current decision **before** acting:

```sh
jaunt-linear wait decision <ID> --runtime <actual-runtime> --session <actual-session>
```

`approved` authorizes only the recorded action, subject to its existing guards.
It does not prove delivery or replace the exclusive publication coordinator.
Old plan approval, reactions, silence, a bridge accepting a message, and a queue
accepting a resume are not this decision. A later correction supersedes it.
Never enable publication to unblock this wait. JAU-66 owns publisher activation.

Record actual attempts, including silent/inaccessible peers and messages held for
review; none of those outcomes is consent:

```sh
jaunt-linear wait attempt <ID> --runtime <actual-runtime> --session <actual-session> \
  --action "<attempt made>" --result "<observed outcome>"
```

Changing the deadline also requires `--evidence "<new progress/decision>"`. The
command can reset bounded reconciliation retries after diagnosis, but never
clears an ambiguous publication intent. Reconciliation searches the complete
Linear thread for its marker; absence after an uncertain create requires explicit
investigation, never blind republishing. Label failure with a known comment ID
requires `sync-activity`, not another comment.

If the human corrects or declines the proposed action, revise it from the latest
feedback without recycling its approval:

```sh
jaunt-linear wait revise <ID> --runtime <actual-runtime> --session <actual-session> \
  --comment <latest-feedback-id> --action "<corrected action>" --reason "<why it changed>"
```

This archives the old request, gives the corrected action a new wait identifier
and asks in Linear again. It resolves only the superseded request/feedback subjects.
The prior approval cannot authorize the corrected action. Preserve and acknowledge
routing events once their processing is observed; unresolved reply/queued-worker
routing also blocks cleanup, so no promoted worker loses its wake-up.

After verifying the outcome, resolve against the latest exact decision comment:

```sh
jaunt-linear wait resolve <ID> --runtime <actual-runtime> --session <actual-session> \
  --comment <decision-comment-id> --evidence "<observed outcome and proof link>"
```

For an explicitly approved transfer, add `--ticket <related-ID>`; that target must
be named in the immutable action and its related link verified. Record the four
follow-up facts and expectation on the target using the normal follow-up protocol.
The wait preserves its owner, publication resource and history until this proof;
source-file release never transfers publication authority. Resolve closes only
this request and consumed decision in the discussion ledger; other subjects and
unread delivery information remain. An unresolved wait or failed discussion
resolution refuses release/cleanup. No old verdict can restart merged code.

### Hand over

Before the final handover, follow [the follow-up protocol](../../../docs/LINEAR_FOLLOWUPS.md)
(path from the checkout root: `docs/LINEAR_FOLLOWUPS.md`). Open each factual
leftover without asking permission, or reuse a verified ticket. Record the four
facts, explicit human expectation and a `related` link to the origin. Do not use
sub-issues by default. Unverified intuitions need an explicit discard reason.

Save `jaunt-linear closure <ID> --file <json|->` for the current claim, including
`{"items":[]}` when nothing remains. Save the returned ticket ID before linking;
on a retry, finish that link instead of creating another ticket. Read the
inventory back with `jaunt-linear closure <ID>` and resolve every reported
problem. The orchestrator verifies related targets before releasing the claim.

Human decisions can be required in Backlog or after delivery as well as in
Waiting for human. State the action, who owes it and when in descriptions
(`create --expects`) and handover comments (`comment --expects`). Distinguish
future worker analysis from an actual question to the human; never infer
`none` from the issue's column.

```bash
jaunt-linear comment <ID> --expects "<action attendue ou none>" "<la PR, tests, essai, liens des suites et motifs des éléments écartés>"
```

Write it for someone who did not watch the run: explain the usable result and
link the verified PR and checks. Technical tests, checkouts and setup for
validation are the worker's responsibility, not homework for the human.
For user-facing builds, inspect the actual workflow runs and produced artifacts
before offering a download; changed paths alone do not prove a package exists.
Desktop packages do not install the Linear development harness. For harness
changes, describe the observed Linear/session workflow and its limitations;
do not present test evidence archives as an installable product.

Say it too if your branch was based on another ticket's, so the orchestrator
knows what is now stacked on a squashed commit.

Then finish your turn — the orchestrator releases the claim, removes the
worktree, and clears the way for whatever was waiting behind you.

## Honesty

- Tests failing goes in the Linear comment, with the output. Never move a ticket
  to a done-ish state on work that does not pass.
- Merging is what marks the ticket *Done*, so merge only what you would defend.
  A PR left open on a red or unread CI is a perfectly good outcome — say so, and
  name the run. An open PR nobody mentions is work that reads as landed and is
  not.
- Stuck is a fine outcome: comment what you tried and what blocked you, and stop.
  Silence is not.
- Never close a ticket you did not finish.
- Every comment you post carries `--expects` (what the human owes) and, when it
  answers someone, `--reply <commentId>` so it lands inside the thread. Write in
  the board's language — French here. Long detail goes in the plan document, not
  in the comment.

## Supervised recovery

The canonical runtime launcher records process identity, heartbeat, exact session,
exit and bounded failure classification independently of claims. Do not write those
records yourself. After recovery, read current comments, stop flag, phase, approval
and PR state before continuing. A recovery event grants no approval. Preserve drafts
and transcripts. A stale heartbeat is not proof that another worker may start.
The orchestrator uses `cleanup <ID> --pr <n>` after verified completion and closure;
it refuses unknown/live workers, unpublished commits and modified/unpublished drafts.
Legacy workers/plans without lifecycle/publication evidence require explicit evidence
review; never manufacture that evidence to get past a refusal.


## Discussion subjects and unread activity

Follow [the activity protocol](../../../docs/LINEAR_ACTIVITY.md). Before treating
new feedback or delivering work, run `jaunt-linear sync-activity <ID>` and read
`jaunt-linear discussion <ID>`. Use revision-checked `discussion --file` patches
through the canonical launcher to record each subject's owner, source and open,
resolved or transferred disposition. A reply acknowledges previous information;
it does not resolve every question. Keep ambiguous subjects open for analysis.

Publication opens review/expectation/plan subjects automatically. Separate
multiple questions when interpreting feedback. Resolve superseded plan subjects
with the replacement as evidence. Before handover, resolve delivered work with
proof and transfer leftovers to verified related tickets. The registry survives
claim cleanup and supplements the closure inventory. `--expects none`, Done,
silence and a stopped worker do not close it. Do not ask humans to maintain labels
or the registry. A final handover remains unread until the human acknowledges it.
