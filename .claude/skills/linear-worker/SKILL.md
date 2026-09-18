---
name: linear-worker
description: Carry one jaunt Linear ticket from plan to merged PR inside a dedicated worker session — survey, post a plan for approval, declare the change surface, implement on the worktree branch, then push, open the PR, watch the CI and squash-merge it. Use when a spawned session is told to work a ticket, or for "travaille JAU-x".
---

# linear-worker

You own **one ticket**, end to end, in your own git worktree. You do not order
the board, do not set priorities, do not touch another ticket. The orchestrator
owns that, and it is writing relations while you work.

`jaunt-linear` is on the PATH. Every Linear write goes through it, as the
**jaunt Agent** app — never by another route.

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
jaunt-linear attachments <ID>     # downloads screenshots — open them with Read
```

**Read the comments, not just the description.** Scope, corrections and
dependencies are usually stated in replies. A ticket's latest comment often
contradicts its body, and the comment wins.

For a display bug, open the screenshot. Diagnosing one from CSS alone means
describing a symptom you never saw.

## 2. Survey, then verify

Send an **Explore** subagent at the areas the ticket names — you have the `Agent`
tool, use it. Its report is a survey, not a verification.

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

Before posting the plan:

```bash
jaunt-linear surface <ID> --files web/js/app.mjs,web/style.css --symbols .settings-row,.settings-group
```

This is how the orchestrator keeps another worker off your files. Declaring
nothing is not neutral — the gate treats an undeclared surface as "overlap
cannot be ruled out" and blocks other tickets from being dispatched at all.

## 4. Post the plan and stop

```bash
jaunt-linear plan <ID> --summary "<3-6 lignes, en français>" \
  --expects "approuver (👍 sur ce commentaire) ou répondre des corrections" \
  "$(cat plan.md)"
jaunt-linear claim <ID> awaiting-approval --session "$CLAUDE_CODE_SESSION_ID"
```

The long plan goes into a Linear **document**; `--summary` is what the human
actually reads on the ticket. Write the summary so it can be answered *without*
opening the document: what changes, what does not, what you need from them. If
the summary runs past a screen, it is not a summary.

A **re-plan answers someone**, so it takes `--reply <commentId>` — the id of the
comment that asked for the change, from `verdict`'s `messages`. The digest then
lands inside that thread instead of starting a third conversation at the root.
A first plan has nobody to answer and stays at the root.

`CLAUDE_CODE_SESSION_ID` — not `CLAUDE_SESSION_ID`, which does not exist. An
unset variable expands to an empty string and used to erase the claim's session
address, which is how a human's approval finds you again. Check it landed:
`jaunt-linear status` must show your UUID, not `""`.

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
`jaunt-linear create "<title>" --parent <ID> --desc -`. That is the deliverable;
describing a split in prose for a human to retype is not doing the work.

Then **stop your turn**. Do not implement. The human answers on the ticket —
`/approve`, `/decline`, 👍 or free text — and the orchestrator reopens you with
their answer.

## 5. Resume on the verdict

```bash
jaunt-linear verdict <ID>
```

| verdict | what to do |
|---|---|
| `approved` | implement (§6), then land it (§7) |
| `feedback` | the human is steering: fold it in, retract the superseded plan with `jaunt-linear uncomment <COMMENT-ID>`, post a new one, stop again |
| `declined` | comment that it is parked, `jaunt-linear move <ID> "Backlog"`, tell the orchestrator you are done |
| `pending` | nothing was answered — stop; you will be reopened |
| `no-plan` | no plan for this claim. A `note` about a stale plan means an earlier cycle left one behind: ignore it, go to §2 |

## 6. Implement

On your worktree branch, and nowhere else.

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

Linear's GitHub integration reads the ticket identifier out of the branch name,
and it has been doing so all along: pushing the branch moves the ticket to *In
Progress*, merging its PR moves it to *Done*. **Never call `move` for either** —
`move` is for what git cannot see. A branch without the identifier lands its work
and leaves the board untouched: `chore/linear-loop` merged that way and its five
tickets had to be moved by hand afterwards.

### Rebase before you push, not after

`main` is protected and its required checks are **strict** — a branch behind
`main` cannot merge however green it is. Rebasing first costs one CI round
instead of two.

```bash
git fetch origin
git rebase origin/main
npm test                       # a rebase that applies is not a rebase that works
```

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

### Merge

```bash
gh pr merge <n> --squash --delete-branch
```

Auto-merge is disabled on this repository: nothing merges while you are not
looking, and a green PR you walk away from simply stays open. If the merge is
refused because `main` moved while your CI ran, rebase onto `origin/main`,
`git push --force-with-lease`, and watch again.

`--delete-branch` will then print `fatal: 'main' is already used by worktree at
…` and exit non-zero. **The merge already happened.** That error comes from the
local half of the command, which tries to check `main` out in your worktree, and
`main` is checked out in the main clone. Read the state instead of re-running the
merge on the strength of an exit code:

```bash
gh pr view <n> --json state --jq .state     # MERGED — you are done
```

The remote branch is deleted anyway, by the repository's own
`delete_branch_on_merge`.

The merge is what makes the ticket *Done*. Check that it did, rather than
assuming — the integration takes a second or two, but it runs on the branch name,
and you are the one who chose it.

### Hand over

```bash
jaunt-linear comment <ID> "<la PR, ce qui a été testé, comment l'essayer, ce qui reste>"
```

Write it for someone who did not watch the run, and give them something to
**try**, not only to read. A PR touching `web/**`, `desktop/**`, `package*.json`
or `scripts/prepare_web.mjs` builds installable `desktop-Linux` and
`desktop-macOS` packages — link those artifacts. Otherwise give the command that
runs the branch. Reading a diff is not testing a change (JAU-24).

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
