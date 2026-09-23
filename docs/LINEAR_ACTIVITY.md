# Linear discussion and unread activity

The canonical `jaunt-linear` launcher owns three team labels. Filter the Linear
board by **Du neuf du harnais** for new agent information, or **Discussion active**
for all conversations with outstanding work or information to acknowledge.

| Label | Meaning | Removal |
| --- | --- | --- |
| Créé par le harnais | Created by the harness; a provenance comment repeats the supplied reason/origin | Permanent |
| Du neuf du harnais | A meaningful agent publication has not been acknowledged | A human reply acknowledges preceding publications; 👀 or an approve/decline reaction acknowledges the target and older publications |
| Discussion active | At least one open subject, or unread agent information | Only when both are absent |

The labels are shared by the ticket, not separate inboxes for each developer.
Opening a ticket or reading a notification is not an observable acknowledgment.
A reply, `lu`, or 👀 is sufficient; 👀 never approves a plan. A reaction on an old
message does not acknowledge a newer one. Explicit technical approval receipts
are exempt. A delayed provenance repair represents the creation event, not fresh
unread information. Other applications and missing/unknown authors cannot clear
unread state; human attribution requires a non-app email on the API user.

`Waiting for human` retains its existing approval semantics. Done, silence,
`--expects none`, worker exit, or release of a claim never resolves subjects.
Approval resolves the plan decision only; promised implementation remains open.
New human prose opens a review subject automatically. Exact `lu`, `vu`, `merci`,
`/approve`, and `/decline` acknowledgments do not create another review subject.
The worker interprets actual questions and records their individual dispositions.

## Automatic synchronization and recovery

The watcher calls `jaunt-linear sync-activity --incremental` before each pulse,
after checking loop state and instruction updates. Incremental sync reads a
tracked ticket's full thread only when its `updatedAt` moved since its last
successful sync (comments and reactions bump it), with a full sweep every
30 minutes; a ticket missing from discovery is retried every poll. Reading every
tracked thread twice per poll cost ~50 000 of Linear's 2 M complexity points per
hour and got the loop cut off on 23/09. Below 25 % of the budget the watcher
skips the sync and polls four times less often; on a 429 it waits for the
announced reset, and a cut longer than the watchdog grace wakes the owner once
(`linear-rate-limited`). With the loop off no automatic sync occurs.
Run `jaunt-linear sync-activity JAU-34` to reconcile one ticket explicitly.
Failures are visible and retryable. Per-ticket errors return `ok: false` with an
`errors` list; healthy tickets and board polling continue. The watcher emits
`activity-failed` when the reported list changes and `activity-recovered` when it
clears. A transient error (Linear 5xx/429, network) is reported only after three
consecutive polls, as `transient: <status>`, so a passing 503 wakes nobody; other
errors are reported at once. A global discovery/API failure retains the bounded
retry policy: three failures, or twenty transient ones. A label change may cause one watcher wake;
unchanged synchronization performs no label mutations and creates no comments.

Tracking begins with the first new harness publication or explicit sync. Existing
comments form a baseline, not a historical unread flood. Existing conversations
get one baseline-review subject so their unanswered questions are not silently
assumed resolved; the worker replaces that uncertainty with explicit subjects. The creation marker
and managed labels allow discovery after partial failure. A missing ledger on
an already marked ticket opens a recovery subject; corrupt ledgers fail closed.
Tickets with ledgers remain tracked after Done and claim cleanup. Discovery and
comment reads paginate, including archived issues. Reactions are an API list,
not a paginated connection. There is no bulk attribution of old ticket origins.

Only targeted label add/remove mutations are used; third-party labels remain.
Each ticket's operations serialize using process-identity locks in the canonical
state directory. An uncertain/busy lock refuses the operation; retry later.
Label initialization uses a separate global lock. This is local coordination,
not a distributed lock against another machine or direct edits in Linear.
External changes converge on a later poll; there is no multi-request transaction.

Successful comment/create responses include `activity.ok`. On partial failure,
keep the returned ID and run the reported sync command; do not recreate content.
If the network response to creation itself is lost, inspect Linear before retrying.
Recovery checks for the provenance marker before publishing its comment. No
exactly-once guarantee is made for an ambiguous remote creation response.

## Subject ledger protocol for workers and orchestrators

Use only the canonical launcher, never a worktree harness against production.
The registry lives in `.dev-state/discussions/<ID>.json`, outside claims and
attempts. Do not edit it directly. Sync first, then read:

```bash
jaunt-linear sync-activity JAU-34
jaunt-linear discussion JAU-34
```

Update with a revision-checked patch, written to a file or stdin:

```bash
jaunt-linear discussion JAU-34 --file /tmp/subjects.json
```

```json
{
  "revision": 3,
  "subjects": [
    {
      "key": "feedback:comment-id",
      "title": "Explain the remaining validation",
      "owner": "worker",
      "source": "comment-id",
      "state": "resolved",
      "reason": "Answered with the observed result",
      "evidence": "reply-comment-id or verified result URL"
    }
  ]
}
```

`source` is an existing comment ID or `issue`. Keys are stable; omitted subjects
remain unchanged. New entries need a title, owner, source, and state. Closing an
entry requires a reason and evidence. Record distinct questions separately, with
who owes the next action and when in the title/reason and human-facing message.
An unknown or ambiguous question remains open; the code does not infer semantic
completion from prose. Read the new revision before another update.

A `transferred` entry also requires a `ticket` with a verified `related` link.
The target receives a stable open subject before the source can close. Retrying
preserves that target; it does not create another ticket. Follow the normal
follow-up protocol to create and relate a target first. The ledger complements,
and does not replace, the claim-scoped closure inventory.

Plan publication opens decision and delivery subjects; creation opens initial
work; an explicit human expectation in an agent comment opens an expectation.
When replanning, resolve the superseded decision/work with the new plan as
explicit evidence. On delivery, resolve each completed item individually and
transfer actual leftovers. Read-only `discussion`, `show`, `pulse`, and
`verdict --peek` do not synchronize labels. An empty/open-free ledger can still
have unread information: the final handover stays active until acknowledged.

Activation on a dirty canonical checkout is the orchestrator's responsibility;
merging a PR alone does not prove the running watcher loaded these changes.
