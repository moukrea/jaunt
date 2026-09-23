# Project development costs

`jaunt-linear costs` imports local evidence for Jaunt without calling a provider,
Linear, or a billing API. It does not start workers, change model selection,
resume stopped sessions or edit landing reservations. Use the **installed
canonical launcher** after the harness upgrade; a desktop installation does not
install this command. Activation of a collector belongs to the orchestrator.

```sh
jaunt-linear costs scan
jaunt-linear costs report --format markdown
jaunt-linear costs report --from 2026-09-01T00:00:00Z --to 2026-10-01T00:00:00Z
jaunt-linear costs status
jaunt-linear costs watch --interval 60
```

`watch` stays in the foreground. Stop it with Ctrl-C or SIGTERM; this stops only
the collector. The interval is 10–3600 seconds. A failed scan preserves the last
ledger and is visible in collector status. There are no model-powered polls.
Use explicit UTC instants for weekly quota windows, including any observed reset
boundary. A reset is a consumption boundary, **not a payment**, and is never
multiplied by a subscription price.

## Four separate quantities

- **Observed tokens:** known source counters, with source coverage, partial
  samples and exclusions. Codex input includes cached input; Claude input does
  not. The report provides native fields and normalized input totals. Reasoning
  is displayed separately but never added to output again. Unknown is `null`;
  reported zero remains zero. `complete` on a subtotal describes its included
  samples, not completeness since the project began.
- **Estimated API equivalent:** observed model, service tier, token categories
  and an explicitly dated price table. It is not a bill, and only the priced
  subset is summed. Scoped USD estimates reported by clients appear separately,
  without a grand total: session resumes and subagents can overlap their scope.
- **Subscription payments:** amounts and periods entered with payment evidence
  references. `invoice-evidence-supplied` means the operator supplied that
  provenance, not that this tool authenticated a bank statement. User declarations
  have their own evidence kind. Catalog prices are never substituted for payments.
- **Estimated Jaunt allocation:** `api-equivalent-share-v1` multiplies a payment
  by Jaunt's API-equivalent weight divided by all project weights on the same
  account and full payment period. It requires explicit coverage attestation,
  account mappings, comparable price currencies, nonzero denominator, complete
  counters, known project attribution and no source gaps. It refuses unknown
  denominators, unassigned accounts, missing rates and ambiguous overlaps. The
  weight currency need not match the payment currency: the ratio is dimensionless.
  Payments in different currencies are never converted or added together.

Missing subscription data yields an unavailable payment/allocation, not a free
project. An operator's statement that API spending was zero is not established
by token counters. No revenue, margin or profitability is inferred. **Do not add
API-equivalent estimates to subscription payments.**

## Sources and reconciliation

Defaults are `~/.codex/sessions`, `~/.codex/archived_sessions`,
`~/.claude/projects`, and the canonical checkout's `.dev-state/workers`. Project
roots come from that checkout's Git worktree inventory. Historical removed
worktrees may need explicit roots or session mappings. Paths are matched with
directory boundaries, not with a substring such as "jaunt". Retained attempts
also establish worker attribution for the exact session and attempt interval.
Sessions outside recognized roots are other-project evidence; missing or
conflicting attribution remains unknown. Root selection should be reviewed
before relying on a historical report.

Native Codex totals are reconciled to consecutive deltas; repeat totals count
once. A first restored total without a baseline supplies only its last reported
usage and marks missing history. Counter resets are not charged as a fresh
lifetime total. A delta spanning missing observations has no inferred model.
A fork's first header can precede copied ancestor headers; explicitly older
inherited headers/events are skipped. An ambiguous fork baseline is skipped.
Unknown multi-session layouts remain gaps rather than invented history.

Claude message identities deduplicate parallel blocks and copied transcripts.
Only recognized terminal message snapshots supply native output counters;
placeholder output is unavailable. Final output supersedes a partial snapshot.
Conflicting input counters exclude that identity. Children have their own
session references and a parent link; parent evidence may fill missing project
attribution but never supplies a billing account.

For sessions with native evidence, wrapper usage is excluded in favor of native
records. This deliberately does not fill a partially retained transcript with a
potentially overlapping wrapper total; the excluded evidence stays in the
inventory. Without native records, overlapping wrapper intervals are excluded.
Classifiers use their own recorded routing time/phase identity and remain Claude
usage even when routing a Codex worker. Copied routing evidence counts once.
Missing classifier identity refuses inclusion. **Provider identity comes from
native formats or each historical attempt, never the current claim runtime.**

Roles are worker, orchestrator, subagent, classifier or unknown. Historical
attempt owner identities can establish orchestrator roles; explicit mappings
can supplement them. The report groups known Jaunt evidence by runtime, role,
month, ticket and account. Other projects are anonymous aggregate evidence.
The JSON inventory exposes hashed references and allowlisted counters, not
session paths or transcript content. It includes scoped client estimates as
alternative evidence, never as extra token-derived expenditure.

## Private configuration

The ledger and configuration live in `.dev-state/costs/`, outside Git. Imports
are validated and atomically replace configuration under the same collector
lock. Unknown fields are rejected. Paths must be absolute. Never put secrets in
metadata, aliases or evidence references. Billing evidence references should be
local pseudonymous labels, not invoice bodies, account emails or credential URLs.

```sh
jaunt-linear costs import --file /private/path/costs-config.json
jaunt-linear costs scan
```

An example with **no assumed tariff, payment or account identity**:

```json
{
  "version": 1,
  "projectRoots": ["/workspace/jaunt", "/workspace/wt-JAU-73"],
  "sources": [
    {"id": "codex", "kind": "codex", "path": "/home/me/.codex/sessions"},
    {"id": "claude", "kind": "claude", "path": "/home/me/.claude/projects"},
    {"id": "workers", "kind": "attempts", "path": "/workspace/jaunt/.dev-state/workers"}
  ],
  "mappings": [],
  "rates": [],
  "subscriptions": [],
  "coverage": []
}
```

Mapping entries have `runtime`, exactly one hashed `session` or `event` from the
private report, and optional `account`, `role`, `project` (`jaunt`, `other`, `unknown`). Multiple
Event mappings take precedence over session mappings and also support classifiers
without native sessions. Claude accounts are never guessed from a formula, directory or quota reset.
The session reference is SHA-256 of `runtime + ":" + actualSessionId`; native
Claude children use `parentSessionId + ":agent:" + agentId`. These hashes are
references, not proof of anonymization against someone who knows the original ID.
Do not publish the private event inventory when an aggregate suffices.

Each rate requires:

- A unique `id`, exact `runtime`, observed `model`, `tier`, and `currency`.
- `start` (inclusive) and `end` (exclusive) ISO instants, `retrievedAt`, an official
  HTTPS `source` without credentials/query/fragment, and an `evidence` reference
  supporting the validity period. Overlapping rates for the same model/tier are
  rejected within the same input-context band. `minInputTokens` (inclusive) and
  `maxInputTokens` (exclusive) are required to distinguish short/long context
  tariffs using total request input including caches. No model alias or
  historical validity is inferred.
- `perMillion`: nonnegative numbers for `uncached`, `cached`, `output`, and when
  applicable `cacheWrite5m`/`cacheWrite1h`. A missing positive category is unpriced.

No tariff is bundled by default. The official [OpenAI price table](https://developers.openai.com/api/docs/pricing)
and [Claude price table](https://platform.claude.com/docs/en/about-claude/pricing)
were consulted on 2026-09-23. They distinguish cache and processing categories;
that observation alone does not establish historical validity for every session.
Unknown service tiers, Codex cache-write scope, Claude cache TTL, regional pricing
or tool fees prevent an unsupported conversion. In particular, a current public
price must not be silently backdated. The [Claude usage contract](https://code.claude.com/docs/en/agent-sdk/cost-tracking)
also identifies reported USD amounts as client estimates rather than bills.

Subscription entries require unique `id`, `runtime`, pseudonymous `account`,
nonnegative paid `amount`, `currency`, `start`, `end`, `evidence`, and
`evidenceKind` (`invoice` or `user-declaration`). Overlapping payment periods for
the same account/runtime are rejected rather than charged twice. `coverage`
entries contain `runtime`, `account`, `start`, `end`, `evidence`: an operator's
explicit assertion that all projects for that account/period are covered.
An assertion does not override detected source gaps. Read the allocation's
`reasons` when it is unavailable. Reports filtered to a shorter window still
show whole overlapping subscription periods; there is no arbitrary proration.

## Persistence, privacy and recovery

Only JSONL files are read from native roots, and only attempt-named JSON files
from the worker source. Symlinks are not followed. Authentication files are not
opened. Malformed input produces fixed error codes without echoing its contents.
The collector projects counters, model/session metadata and provenance; it does
not retain raw events, prompts, responses or tool arguments.

Source paths are hashed in the ledger. Each scan hashes source contents and
reparses changed files; unchanged projections are reused. This is incremental
parsing, **not** an append-only tailer: a growing file is reparsed, and full source
bytes are read to detect same-size edits. Large archives therefore still cost
local I/O. A non-newline-terminated JSONL tail is deferred until the next scan.
Evidence survives rotations, truncation and deletion, with explicit gaps. A
previous final native snapshot cannot be erased by a truncated partial copy.
Changing project roots reparses present sources and reclassifies their identities;
retained events whose source context disappeared become unknown. Contradictory
source copies remain unknown until an explicit mapping resolves attribution.

Evidence and source checkpoints share one atomic ledger commit. Directories are
0700 and files 0600. A live or uncertain process lock blocks competing writes;
a provably dead process lock is recovered under a separate guard. Never remove
an uncertain lock to force progress. A corrupt ledger is preserved and reported;
it is not replaced with an empty history. Removing a configured source retains
its already collected evidence and records its absence.

Tests use synthetic histories. They establish normalization/reconciliation
behavior, not invoice accuracy, complete provider coverage or a recovered
project lifetime total. Missing historical prices, accounts, receipts, native
files and external machines remain explicit limitations.
