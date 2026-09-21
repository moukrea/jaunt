# Follow-ups before releasing a Linear claim

A factual leftover is work to track, not a sentence to lose in a closed issue.
Workers and orchestrators open it without asking permission, or reuse a ticket
whose scope and evidence they have actually read. Link it to the origin with
`related`; it is not automatically a sub-issue. Splitting the original request
into genuine children is a different operation.

Every factual follow-up includes:

- What was observed, without presenting a theory as a fact.
- Where: file and line, or a precise reproduction/evidence location.
- Why the origin's scope did not include the fix.
- What needs deciding, including who decides and when; explicitly say “none”
  when there is no arbitration.

Separate questions for the future worker from decisions currently owed by a
human. Creation requires `--expects "<action, person and timing>"` or
`--expects none`. The description receives one expectation line; conflicting
or duplicate marked lines are rejected before any API call. Comments continue
to use their own `--expects`. Backlog arbitration, a test after delivery, and a
later decision can need an answer outside **Waiting for human**. That column
tracks plan approval, not every human obligation. Update the conversation when
an expectation is resolved or changes; a creation-time line is not live state.

## Record an inventory

Always use the installed canonical `jaunt-linear`, never a worktree's script.
Read the current inventory first:

```sh
jaunt-linear closure JAU-50
jaunt-linear closure JAU-50 --file /tmp/closure.json
# JSON may also be supplied on stdin with --file -.
```

The JSON input is an object with an explicit `items` array. `{"items":[]}` is a
positive declaration that no leftovers remain; a missing inventory says nothing.
For example (replace the sample issue IDs and evidence with actual findings):

```json
{
  "items": [
    {
      "key": "reconnect-path",
      "observation": "Path validation fails after reconnect",
      "location": "host/path.py:42, reproduction in the origin comment",
      "excludedBecause": "The approved origin scope fixes test timing only",
      "decision": "Future worker: propose retry behavior; no human arbitration yet",
      "expects": "none",
      "disposition": "pending"
    }
  ]
}
```

Keep keys stable. Drafts may be incomplete and are saved with a list of problems;
a saved draft is not proof of closure. A disposition is one of:

- `pending`: still unresolved, including a creation whose outcome is uncertain.
- `ticket`: all four facts and an explicit expectation, plus `ticket: "JAU-60"`.
- `discarded`: observation, explicit expectation, and a nonempty `reason`.
  Keep all known facts; an intuition must explain what evidence is missing.
  Do not invent a file location just to fill a field.

Recorded entries cannot disappear in an update: discard them with a reason.
Recorded ticket identifiers cannot be erased or replaced. If an existing target
is wrong, retain that entry with an explanation and add a new keyed entry.

## Open or reuse, then relate

Read the board and candidate tickets before creating a duplicate. For a new
follow-up, write the four facts and the origin URL into a description file:

```sh
jaunt-linear create "<observed defect>" --expects none --desc - < /tmp/follow-up.md
# Immediately save the returned identifier as a ticket disposition in the inventory.
jaunt-linear closure JAU-50 --file /tmp/closure.json
jaunt-linear relate JAU-50 related JAU-60
```

Use an actual action instead of `none` if a human decision is needed now.
Prioritization belongs to the orchestrator; omit priority or use an explicit
named value when instructed. Creation retains the existing JAU-44 subscription
behavior and reports notification failures. Do not silently report delivery
when `notified.ok` is false.

On restart, read the inventory and the board. If creation succeeded and linking
failed, keep the recorded identifier and finish only the missing relation. Check
both relation directions before calling `relate` again. If creation timed out
without returning an identifier, leave the item pending, search the board and
verify the matching issue's evidence before attempting another creation. No
exactly-once API guarantee is assumed, and no automatic blind retry is performed.

## Verify and release

Before final handover, the worker records the current inventory and resolves
its problems. The handover names follow-up links and discard reasons, plus
actual tests and how to try the result. The orchestrator reads that inventory
before cleanup. For supervised completed work, use:

```sh
jaunt-linear closure JAU-50
jaunt-linear cleanup JAU-50 --pr <verified-merged-PR-number>
```

Release requires a current, fully resolved inventory, re-reads referenced issues
and verifies `related` in either direction. Missing targets, missing links,
unresolved entries and API failures leave the claim and stop flag intact.
Status does not decide whether an expectation is valid. The inventory is stored
atomically under canonical `.dev-state/closures/`, bound to `claimedAt`, and
survives claim release. A new claim cycle cannot reuse an old inventory.
The release receipt retains the verified inventory or unstarted cleanup reason.

For a claim confirmed never to have started work, the orchestrator may use
`release JAU-50 --reason "<evidence>"` after checking the worker, plan and runtime
recovery record. This exception is refused for completed issues and for claims
that reached implementing/landing, even if they returned to planning. Old active
claims are also protected. This is not a force-release option or a delivery.

The gate validates explicit declarations and referenced links. It cannot discover
an omitted finding or judge whether the evidence is persuasive. The worker and
orchestrator remain responsible for the factual review. It does not scan prose
for phrases, create tickets from guesses, or change board priorities.

## Supervised worktree cleanup

`cleanup` verifies the completed issue, merged PR head and merge commit, unique
worktree, stopped worker lifecycle, local commit coverage and every tracked,
untracked and ignored path. The only automatically archived local file is an
unchanged `plan.md` with a publication receipt from this claim generation. A plan
without a receipt or changed since publication remains in the worktree. No force
option is provided. Legacy lifecycle/publication records are not inferred.

The same release verifier checks the current closure and referenced `related`
tickets before removal. Only after removal succeeds does it save the release
receipt and delete claim/stop state. Removal failure preserves the claim and restores
an archived plan. `release` remains available for verified legacy/unstarted cleanup
and retains its inventory requirements; it does not delete a worktree. A preserved
worktree is a reported refusal, not a reason to bypass the checks automatically.
