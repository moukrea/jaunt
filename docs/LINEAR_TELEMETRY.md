# Linear worker telemetry

After this revision is installed in the canonical checkout, run:

```sh
jaunt-linear telemetry JAU-38
```

This local, read-only JSON report works with active claims and released claim
cycles. It needs no Linear credentials or provider request. Installing a desktop
package does not activate the development harness. Workers must keep using the
installed canonical launcher; they must not point a worktree's CLI at production
state to activate this feature. Existing processes need the normal harness
upgrade/restart workflow to collect new telemetry.

## Records and report

Schema version 1 extends existing attempt files under
`.dev-state/workers/<issue>/<sha256(claimedAt)>/<attempt>.json`. Each launch,
resume and recovery has a distinct attempt; heartbeats and duplicate terminal
snapshots do not create attempts. The current pointer is not a second record.

Claim writes atomically preserve `telemetryHistory`, including approval, queue,
implementation, landing and external-wait transitions. Registration in an
unchanged phase does not restart its interval. At release, `telemetry-claim.json`
archives identity, history and the verified Linear state before deleting the
claim. Each claim cycle has a separate directory. Failed archive persistence
preserves the claim. An active claim takes precedence over an archive left by
an interrupted release. Attempt files can finish updating after archival without
overwriting phase history.

The report enumerates all retained attempts, including older cycles. Missing
legacy telemetry remains unknown. Phase entries refer to overlapping attempts;
each attempt exposes requested settings, their source, observed model evidence,
usage coverage and execution outcome. Usage is allocated to a phase only when
the entire attempt interval fits inside one observed phase interval. Shared or
incomplete intervals remain unallocated; no time-based proration is performed.
Elapsed phase time includes waiting, and execution elapsed time is wrapper wall
time. Neither is CPU time or billable time. Exit code zero is not proof of a
merged PR; release state is explicitly sourced from Linear.

## Measurements, estimates and gaps

Every usage metric distinguishes `measured`, `estimated` and `unavailable`.
Missing values are `null`, never implicit zero. `knownUsageSubtotal` sums only
attributable values and exposes coverage counts; it is not the complete cost of
a ticket. Main-loop token coverage differs from monetary scope, so token and USD
fields must not be treated as interchangeable totals.

- Codex `turn.completed.usage` supplies per-turn input, cached input and output
  counters. Repeated terminal snapshots replace the same turn. A missing turn
  start or unfinished turn leaves coverage incomplete. No USD price conversion
  or effective model/effort inference is performed.
- Claude main-loop assistant messages supply partial input/cache counters by
  message ID; result usage supersedes them. Assistant output counts are ignored
  as placeholders. Crash results cannot erase earlier partial evidence. Nested
  assistant messages are excluded from these main-loop counters.
- Claude result USD values are **client estimates** and include subagent spend.
  The init event's `claude_code_version` distinguishes older invocation totals
  from session totals restored on resume since 2.1.277. For restored totals,
  attempt attribution requires a consecutive, normally exited prior attempt
  with the same session, known session estimate, and nondecreasing total.
  Otherwise the raw scoped estimate remains visible under `reportedCost` and
  the attempt cost is unavailable. Unknown versions never imply a resume cost
  scope. A new session can use its initial estimate directly. A decreasing total,
  failed baseline, overlap or missing baseline is not silently repaired.

The normalization follows the [Codex event types](https://github.com/openai/codex/blob/main/sdk/typescript/src/events.ts)
and [Claude cost/usage semantics](https://code.claude.com/docs/en/agent-sdk/cost-tracking).
The installed Claude 2.1.278 binary's init schema/emission was also inspected for
`claude_code_version`. Schema inspection and offline fixtures do not constitute
live provider or invoice validation.

Orchestrator evaluations, historical deleted records and unreported usage remain
gaps. Claude's reported estimate can include nested work while its token counters
exclude that work. Codex's supported stream does not establish a whole-tree cost.
Do not claim savings from this report alone. Retry/wake deduplication, activation
and routing policy are separate work.

## Settings, privacy and compatibility

The runtime adapter accepts optional `--rationale <text>` alongside existing
model/effort options. This records operator-authored selection metadata without
changing precedence or recovery settings. Reports expose that rationale locally;
it must contain no secrets. Requested settings identify explicit options, saved
settings, runtime environment/defaults, recovery or routed resume. An argument
is not evidence of an effective setting. Claude assistant model names provide
observed main-loop model evidence; unsupported effective model/effort fields
remain unavailable.

Telemetry and release archives contain allowlisted metadata/counters, not
provider events, prompts or tool output. Existing lifecycle records already have
other local fields; the report never emits those. Files use the existing private
atomic-write mechanism. Malformed archives or attempt identity mismatches fail
the read rather than inventing a reassuring zero. There is no history backfill,
automatic deletion policy or retrospective billing lookup.

## Project accounting

[Project development costs](LINEAR_COSTS.md) adds local native-history import,
continuous collection, dated API-equivalent estimates and separate subscription
allocation. `telemetry <ID>` keeps its existing worker-only contract. The project
collector reconciles overlapping native/attempt evidence and uses each historical
attempt's provider, including after a claim is handed from Claude to Codex.
