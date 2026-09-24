# jaunt — delivery validated on September 14, 2026

## Human channel validation before merge — JAU-119 (2026-09-24)

The implementation run passed all 375 JavaScript tests with Node
`--test-concurrency=1`. Plain `npm test` passed 374/375: the unchanged watcher
assertion `pulse > 5` after 1.5 seconds at `tests/linear_wakes.test.mjs:159`
failed, matching the recorded JAU-113 symptom. After adding the final withdrawn
acceptance regression, all 43 focused validation/landing tests passed. The final
376-test tree also passed sequentially and in the push CI. A later regression
covering session registration for a new claim cycle passed with all 44 focused
validation/landing tests, while refusing reuse of the old cycle's receipt.
Project and whitespace checks passed.

Temporary-state fixtures exercised exact candidate acceptance, source/build SHA
separation, paginated comments and edits, changed/exempt plan scope, missing or
stale approvals, wrong humans/threads, unavailable APIs, lost publication
responses, partial parking/FIFO/decision operations, superseded discussion
subjects, and verified MERGED recovery after channel cleanup. The landing tests
observed no child retarget on the first refusal and no merge on a refusal after
retargeting. Real launcher subprocesses with offline model/Linear adapters
resumed the exact Codex and Claude sessions for candidate replies and replacement
plans; initial Claude plan approval still selects a fresh implementation session.

These tests did not perform a live human channel trial or activate the canonical
launcher. The guard trusts the publisher's delivered asset receipts and freshly
checks its ledger, public selection and build parent; it does not redownload
package bytes. The worker still interprets prose instructions and records that
interpretation in its review reason. Linear and GitHub have no atomic shared
transaction, so an edit after the final read cannot cancel a merge already in
flight. This harness-only change produces no installable product package.

## Offline file navigation — JAU-41 (2026-09-23)

The real browser/loopback relay/host scenario passed after killing the relay,
submitting a directory path, and reconnecting: the requested directory's witness
file appeared and the input matched its path. The same scenario verified that
editing the field or leaving Files cancels the deferred read, and that the latest
submission replaces an earlier one. It observes the actual encrypted listing
reply after reconnection, not just the cached list. The pending message was
visually checked in `test-results/offline-file-navigation.png`; CI publishes this
capture in `browser-evidence`. No terminal input replay was added.

`pytest -q` passed 396 tests; `npm run test:relay` passed both Miniflare tests;
`tests/i18n_e2e.py` passed all six languages. The new message and its path
placeholder survived `prepare-web` in all six catalogs; the source catalogs in
`host/jaunt/locales` also carry the key because preparation copies them to web. Syntax, project and whitespace checks
passed. Two full parallel JavaScript runs passed 310/312 tests: the unchanged
watcher tests at `tests/linear_wakes.test.mjs:154` and `:244` missed their fixed
poll-count deadlines. That file passed all 15 tests in isolation; all 312 JavaScript tests passed when
the same package test list ran with Node `--test-concurrency=1`. Desktop native
host reconnection and a multi-host pending request were reviewed in code, not
exercised in this browser scenario.



## Project cost accounting — JAU-73 (2026-09-23)

The approved public-price amendment was validated on 2026-09-24. All 31 focused
tests pass, including legacy configuration compatibility, separate public and
paid amounts, missing regional prices, conditional/already-included/unknown
taxes, dated provenance, historical validity and shared allocation guards.
Plain `npm test` passes 342/343 before the final landing rebase, with only the
same JAU-113 idle-watcher pulse assertion below failing. `python3
scripts/check_project.py` and `git diff --check` pass.

A private scan at 16:22 UTC on 2026-09-24 read 999 retained files. The Jaunt
subset included 6,452 Claude events (1,818,877,850 normalized input tokens and
4,497,871 output tokens) and 1,524 Codex events (185,179,960 input and 500,702
output). The report kept 96 Claude and 47 Codex overlapping/ambiguous events
excluded. The repeat at 16:24 reused 996 projections, reparsed three changing
files, observed five new events, and changed no existing counters. The report
now shows the separately sourced 500 USD/month public comparison. Its combined
tax-inclusive amount, historical payments and Jaunt monetary allocation remain
unavailable. The France 20% scenario is conditional, not residence evidence.
No public reference was inserted into the paid ledger. These observations do
not establish complete lifetime history or activate the canonical collector.

Initial implementation observations from 2026-09-23:

The 25 focused cost tests pass. The full suite passes all 337 tests with Node's
`--test-concurrency=1` placed before the test file arguments. Plain `npm test`
passes 336/337 here: the existing idle-watcher assertion at
`tests/linear_wakes.test.mjs:159` expects more than five pulses in 1.5 seconds.
A full archive of the unchanged branch base reproduces exactly that assertion
(311/312); the isolated watcher test passes. This is the symptom tracked by
JAU-113, not evidence that the default local suite is green. Source project
checks and `git diff --check` pass.

Synthetic cases cover cumulative snapshots, forked ancestor headers, missing
baselines and counter resets, Claude partial/final snapshots, duplicate and
conflicting evidence, historical Claude attempts after a Codex claim handover,
wrapper/native overlap, copied classifier records, explicit account mappings,
dated model/tier/context-band prices, cache-category gaps, subscription coverage,
currency separation, period boundaries, private persistence, source rotation,
truncation/deletion, concurrent collector refusal and credential-free CLI use.
The collector's foreground watch was started and stopped against synthetic
sources; no production worker was launched or stopped by these tests.

A metadata-only scan of the available local native sources and retained worker
records was run into a private review directory outside the canonical state.
At 17:38 UTC it processed 936 files and consolidated 32,274 event identities
across all projects. Its then-attributable Jaunt subset included 6,452 Claude
and 1,130 Codex events; excluded overlapping evidence remained visible. The
immediate second scan reused 931 file projections, reparsed five changing files,
observed two new events and changed no already observed event counters. These
are moving observations, not a complete project lifetime or fixed benchmark.
No transcript bodies, credentials, private session inventory or financial
receipts are committed as fixtures or evidence.

The available evidence still has missing cumulative baselines, counter resets,
unsupported/missing usage and no archived Codex directory. No historically
validated tariff table, payment evidence or account mapping was supplied for
this local trial. API-equivalent totals, subscription payments and Jaunt's
allocated monetary cost therefore remain unavailable; client estimates retain
their separate scopes. Current public pricing was consulted, not backdated.
The new canonical collector has not been activated. A merge or desktop package
alone does not establish live collection. See [the cost contract](LINEAR_COSTS.md).


## PR trial artifacts — JAU-24 (2026-09-23)

PR #91's Android run (35796247091) uploaded `android-debug-apk` (3,161,694 bytes,
expiring after 14 days) beside the unchanged `android-validation` reports.
The downloaded archive held only `app-debug.apk`: `aapt2` read package
`dev.jaunt.android.debug`, version `0.1.0-beta.31-debug`, minimum API 26, and
`apksigner` verified a v2 signature by `CN=Android Debug`. The instrumentation
APK is not published. The APK was not installed: no device was attached and the
local emulator image was missing, so installation beside the release app and
pairing remain unobserved.

`scripts/dev.py --state <temporary directory>` started from a fresh virtualenv
(`pip install -e . -r requirements-dev.txt`) served the web app and printed a
pairing link, with all host state in that directory. Electron from source aborted
at startup on this Ubuntu machine (`apparmor_restrict_unprivileged_userns=1`,
SUID sandbox not configured); a minimal Electron app launched with
`--user-data-dir` reported that directory as `userData`. No desktop package was
built for this PR, whose paths do not trigger the desktop workflow. The same four
offline adapter tests fail locally on unchanged main and this branch (220/224),
while the PR's CI passed; `check_project.py --source` and `git diff --check`
passed.


## Durable worker telemetry — JAU-38 (2026-09-22)

`npm test` passed 224 tests after rebasing on main through JAU-34, JAU-63 and
JAU-65. `python3 scripts/check_project.py --source` and `git diff --check` passed.
The offline Codex and Claude adapters persist structured usage, preserve their
exact sessions across a failed attempt and recovery, and avoid counting repeated
terminal events twice. CLI tests read retained attempts without credentials or
an active claim and verify that provider prompt text is absent from the report.

Accounting cases cover unknown versus zero, requested/observed model mismatch,
Claude input snapshots versus final results, placeholder output exclusion,
crash-zero preservation, old invocation estimates versus recent restored session
estimates, and unavailable attribution without a safe prior baseline. Persistence
cases cover repeated phase registration, legacy gaps, multi-phase allocation,
release and reopening, late attempt finalization, archive write failure,
corruption and phase identity when legacy transitions share a timestamp. Existing approval, external-wait, routing, recovery and landing tests
remain green.

Runtime schema checks used the official Codex event types and Claude cost-tracking
documentation, plus the installed Claude 2.1.278 init version field. These are not
live provider accounting measurements. Claude USD values are client estimates;
Codex monetary cost and unsupported effective settings remain unavailable. See
[the telemetry contract](LINEAR_TELEMETRY.md) for exact coverage and limitations.

No production runtime was replaced, restarted or redirected to this worktree.
The dirty canonical checkout was preserved. Harness activation remains separate
(JAU-67/JAU-71); wake deduplication remains JAU-62. No desktop package is claimed
as delivery of this development-harness change.


## Deterministic worker routing — JAU-65 (2026-09-22)

After rebasing on JAU-34 and JAU-63 (`de1e52d`), **212 npm tests passed**.
The 30 routing tests cover complete paginated attribution, edited human replies,
reaction replacement, approval/decline/feedback forwarding without registering a
verdict, deferred replies drained on a quiet poll, changed claims, stop/loop-off,
unknown process evidence, recovery deadlines, replay and concurrent routing.
Acceptance intent is persisted before launch; simulated response loss is recovered
from worker lifecycle evidence, while an unproven launch remains an escalation.

Two additional offline adapter scenarios launch real subprocesses behind fake
Codex/Claude and Linear commands. Each resumed the exact recorded session once;
the routed human comment caused no intermediary owner queue call. Ordinary worker
completion still notified the owner. Actual watcher/watchdog subprocess fixtures
continued polling after handled events, and the external-wait fixture exited to
the orchestrator without invoking ordinary routing. A legacy watcher regression
found in the first full run was fixed: without a verified owner handoff, the old
wake path is preserved, including quiet periodic exits.

The first PR CI run exposed an existing lock-publication race in
`withWorkerLock`: a contender parsed the exclusive lock between file creation
and identity write. Partial JSON now reports the existing busy/uncertain outcome
without deleting the lock; a deterministic empty/truncated-file regression test
checks preservation and eventual admission after release.

JavaScript syntax checks passed for all five changed runtime modules, and
`python3 scripts/check_project.py --source` passed. No application transport or UI
code changed. The source check omits the optional generated QR vendor asset.

These are isolated local tests, not evidence of live deployment or measured token
savings. The canonical checkout was observed at `77f1ba0` with existing tracked
and untracked changes and was left intact. Operational activation remains with
JAU-67/71. Bare watcher processes without a supervising owner handoff use the
existing orchestrator path; ambiguous attribution, missing/currently inapplicable
verdicts, structural changes and external waits are also escalated. The existing
verdict query remains bounded to 100 comments, so routing escalates if that reader
cannot establish an actionable current plan even though routing attribution is
paginated. Periodic rearming and cross-producer deduplication remain JAU-62 work.

## Durable post-merge waits — JAU-63 (2026-09-22)

The worktree was rebased onto JAU-34's merged `611d792` discussion/label cycle.
The complete local `npm test` run passed **179 tests**. A focused run of wait and
landing tests passed **37 tests**. Module syntax checks and
`python3 scripts/check_project.py` passed. The first complete run exposed missing
module copies in isolated CLI fixtures; those fixtures now include the new wait
module and the activity dependency, and the complete run passes.

Temporary state directories, real temporary Git repositories and injected
GitHub/Linear responses cover exact merged-head admission, dirty worktrees,
remaining landing reservations, wrong owners, preserved claim/work history,
noncontending completed surfaces, old verdict protection, and guarded closure.
Queue tests cover fresh feedback, stop, dependency refusal, owner replacement
and recovery of routing after promotion. Cleanup retains unacknowledged reply
and queued-worker routing events; acknowledgement records observed processing,
not consent or runtime queue acceptance.

Wait tests cover silent/inaccessible peers and accepted-but-held messages,
deadline/restart deduplication, disabled loops, stop during API reads, bounded
publication retries, lost create responses, preserved comment IDs after label
failure, and Linear-only reply discovery after retry exhaustion. Explicit thread
pagination covers a directly requested ticket independently of the board's
first-page window. Action decisions reject old approval, ordinary reactions,
bot/unrelated replies and newer contradictory feedback. Transfer targets match
complete issue identifiers. Revised requests retain history and require a fresh
decision. Discussion integration closes only the wait's own expectation and
consumed decision; unrelated subjects and unread resolution information remain.

These are local/injected network observations, not a real bridge handoff or
production activation. The canonical launcher checkout was inspected read-only:
it remains at `77f1ba0` with tracked and untracked local work. It was not replaced,
and its running watcher has not loaded this worktree's wait protocol. No live
wait request, human wait decision, publisher activation or product release is
claimed. Canonical activation and a real Linear-only round trip remain an
operational follow-up; JAU-67 separately tracks label activation and JAU-66
tracks the exclusive publisher handoff. No production publication lock,
workflow, tag, variable or secret was changed by this ticket.

## Linear discussion lifecycle — JAU-34 (2026-09-22)

Implemented separate permanent provenance, unread harness information and active
subject labels. A claim-independent revisioned ledger tracks unresolved subjects;
human acknowledgments clear only earlier information, never unrelated work.
The watcher synchronizes marked/tracked tickets, including archived/completed
ones, before polling. Per-ticket failures preserve their ledger and report
activity degradation while healthy board polling continues.

Observed locally: 18 focused activity tests passed, including pagination beyond
100 issues/comments, approval versus 👀, partial replies, stale reactions,
third-party labels, provenance retries, partial publication failure, busy locks,
missing/corrupt ledgers, deleted source comments/tickets, verified transfers,
nested reply roots and an actual watcher subprocess with a fake CLI. The existing
full npm suite passed 160 tests. The watcher fixture also verified targeted
activity failure/recovery notifications and deduplication while polling continues.
Source project checks and git diff whitespace checks passed.

A read-only query against Linear verified the label mutation schema, comment
parent/user fields and list-shaped reactions. No production label mutation or
human acknowledgment lifecycle was exercised with this worktree code. The dirty
canonical checkout was preserved; activation and actual live observations must
be recorded separately, and the merge alone is not evidence of activation.
No desktop/Android package is required for this harness-only change.



## Automatic publication queue — JAU-30 (2026-09-21)

The release coordinator was tested against temporary real Git repositories and
bare remotes with injected GitHub/publication APIs. **49 focused tests passed**,
covering component classification, harness-only npm test edits, transitive and
deleted build helpers, synchronized generated versions, exact source parentage,
atomic tag/receipt collision refusal, stale receipt writers, unvalidated sources,
missing selected credentials, partial publication and continuation after another
merge. Draft-upload interruption tests change the rebuilt bytes deliberately and
verify that retries retain the original frozen artifacts, including a lost final
publication response. Asset checks cover checksums, exact inventories, native
Linux package architecture names and staging path rejection.

The earlier full local run passed 165 pytest tests (before the seven additional
publication recovery cases), 138 npm tests and both real Miniflare relay tests.
Actionlint 1.7.7 passed on all six changed workflows and the new coordinator.
These are local/simulated publication results, not proof of production delivery.

Read-only GitHub inspection found host beta.41, desktop beta.33 and Android
beta.31 all tagged at `7ab213386519e003a4958436deb5675f9c5f069c`; no application
source backlog was found through `e15ca88`. The package.json changes in that
interval only extended the harness test command. The RELEASE_TOKEN secret name
exists, but its effective permissions have not yet been exercised by the new
Actions preflight. CLOUDFLARE_API_TOKEN and the relay-production environment were
absent during inspection. Live activation, generated releases and public delivery
are not claimed here; the ticket handover must report their actual observations.

## Linear instruction freshness — JAU-47 (September 21, 2026)

Observed locally: `npm test` passed all **119 tests**, including eight isolated
freshness cases. `python3 scripts/check_project.py --source` and
`git diff --check` passed. Fixtures exercised the actual watcher process with
an unavailable API: it reported `skills-changed` before making an API call,
deduplicated the next identical notification, and honored loop-off. Isolated
Codex and Claude CLI fixtures covered migration from an unbound enabled loop,
read/bind/acknowledge, and rejection of binding while stopped. Content changes,
reversions, runtime/session isolation, unreadable files, obsolete acknowledgements,
five-minute retry after simulated lost delivery, and unchanged adapter ownership
records were checked. The queue test verifies canonical read instructions and
exact owner targeting; it does not invoke a real model.

Receipts identify an explicit acknowledgement of canonical skill contents, not
model comprehension or removal of old context. The watcher retries outstanding
notifications after five minutes when it is running; recovery of a failed runtime
delivery still depends on existing watchdog/rearm behavior. A watcher already in
memory needs a normal controlled rearm to load the new detector. No production
owner, watcher or worker was terminated or transferred for these tests. Live
Claude/Codex interactive rereading and activation are not claimed by the offline
fixtures. Owner replacement is separately tracked by JAU-58. Desktop packages do not install this development harness; their build status
is separate from instruction-refresh validation.



## Linear landing coordination — JAU-25 (2026-09-21)

Observed locally on the rebased JAU-47/JAU-45 baseline: `npm test` passed
**138 tests**, including 18 landing/stack scenarios. `python3
scripts/check_project.py --source`, JavaScript syntax checks and
`git diff --check` passed.

Two real Node processes requested the same canonical test store concurrently:
one acquired the turn, both persisted in FIFO order. Isolated CLI execution
recorded the landing phase without changing another claim. Tests cover exact
session/cycle ownership, stop and loop-off, uncertain locks, invalid JSON values,
claim-admission/release guards, repeated approval reads, pre-upgrade landing
session refresh without merge admission, and published-plan hashes.

Temporary Git repositories exercised multi-commit parent squash merges, children
with and without their own commits, immutable original-base records, dirty and
missing-base refusals, a textual conflict, and a clean rebase whose functional
check detects a removed export. The last case intentionally demonstrates that
textual success alone cannot establish semantic compatibility.

Injected GitHub responses exercised paginated child inventories, partial
retarget failure and retry, changed children, stop during retargeting, required
checks, moved heads/main, explicit policy refusal followed by same-owner retry,
and lost merge/read responses without a duplicate merge. Unknown merge errors
retain attempted-head evidence; they are not classified as safe refusals.

The actual `gh pr view` JSON fields were read successfully on merged PR #81.
Editing PR #82 with the installed `gh pr edit` failed on the deprecated Projects
classic GraphQL field. A REST PATCH updated its description successfully; child
retargeting therefore uses REST PATCH too, followed by a fresh PR read.
No production child PR was retargeted and no real network failure was induced.
This is local canonical-checkout coordination, not a distributed lock or a
GitHub merge queue. External writers can still advance main or introduce a
child PR after the final inventory; GitHub strict checks protect the merge head,
while external child creation is outside the cooperative protocol.

The canonical checkout was explicitly left at its existing dirty version during
this implementation. These commands become active only when the orchestrator
updates that checkout while preserving its local work and reloads its skill
receipt. The worker has not claimed live activation or a multi-worker production
exercise. Desktop packages do not install these development-harness commands.

## Linear follow-up closure — JAU-50 (2026-09-21)

After rebasing onto the versioned Codex baseline `c24d5c5` (JAU-39), `npm test`
passed **84 tests**, including the Codex runtime/session cases. The targeted
Codex worker and orchestrator changes are now integrated into `.agents/skills/`;
they retain JAU-39's actual-state checks and user-facing handover requirements.

The closure cases use temporary state and injected issue reads: absent/empty/stale
inventories, incomplete evidence, reasoned discards, retained follow-up IDs
across a missing relation, both relation directions, missing targets/API errors,
claim and stop preservation, explicit unstarted cleanup, work history across
re-planning, concurrent local changes, and malformed state. Isolated CLI tests
exercise stdin inventory writes/reads and reject missing/conflicting creation
expectations before loading credentials. `python3 scripts/check_project.py
--source` and `git diff --check` passed. These checks are the worker's validation,
not instructions for a human to check out a branch or run the test suite.

Observed on the board during diagnosis: PR #76 was correctly linked as a draft,
while the ticket remained Backlog after its approval verdict restored that state.
The team's automation had start/review/merge destinations and no draft rule.
No desktop package was produced for that harness-only change; `browser-evidence`
was a test-results archive, not a harness installer or functional delivery.

At this commit, live creation/release with the newly integrated code and runtime
activation are not yet claimed as validated. The final Linear handover must
record actual follow-up links, explicit expectations, closure checks and the
observed PR/ticket states after delivery. Ambiguous network creation recovery
remains a documented manual verification path, not an exactly-once guarantee.

## Linear CLI priority names — September 21, 2026 (JAU-55)

`create --priority` and `priority <ID>` now accept only
`urgent|high|medium|low|none`. Numeric inputs are rejected; `none` maps to Linear
0, and omitting the create option leaves priority unspecified. Board sorting
and existing ticket priorities are unchanged.

Observed locally: both targeted priority tests passed, and `npm test` passed
all 55 tests. Coverage includes the five numeric mappings, optional omission,
invalid values, and 21 isolated CLI invocations rejecting invalid priorities
before credentials access or waiting for description stdin. No live Linear
mutation was used to test this change. Successful API payloads and external
CLI callers were not exercised; the generic flag parser remains JAU-40 scope.

The separate, uncommitted Codex runtime adaptations in the canonical checkout
were not incorporated into this change.

Latest: [host update rework validation](HOST_UPDATE_VALIDATION.md). Current delivery: [session controls, client feedback, public release tests and limitations](SESSION_CONTROLS_VALIDATION.md). Earlier host beta.5 / Android beta.3 delivery: [historical consolidated report](PUBLIC_DELIVERY.md). The sections below retain historical observations; later reports supersede their test counts and version-specific status.

**Page: https://moukrea.github.io/jaunt/**

**Relay: wss://jaunt-relay.moukrea.workers.dev**

**Release: [v0.1.0-beta.2](https://github.com/moukrea/jaunt/releases/tag/v0.1.0-beta.2)**

```sh
bash -o pipefail -c 'curl -qfL --connect-timeout 10 --max-time 120 https://moukrea.github.io/jaunt/install.sh | bash'
```

The previous form of this command (`curl -fsSL … | bash`) was executed in a clean Ubuntu VM without editable source. See [bootstrap corrections and Fedora testing](INSTALLER_FEDORA.md) for the current command. End users create no GitHub/Cloudflare account and configure neither a public server nor a VPN. **The protocol and product remain without an independent security audit.** SECURITY.md limitations, including the shared Pages origin, still apply.

## History and publication

The archive was integrated without reading the old implementation for inspiration. Original commit `eb71cfe9b80749d3c53f11e428f027b0d64fb372` is preserved on `backup/pre-rewrite-20260914`. PRs [8](https://github.com/moukrea/jaunt/pull/8) and [9](https://github.com/moukrea/jaunt/pull/9) were merged after required checks, without bypassing protections, force-pushing, or deleting history. Beta.1 remains immutable; host corrections were published in beta.2.

The owner granted Wrangler OAuth through the browser. jaunt Worker version `00dd364c-c69c-4e89-8878-00ebd38ca414` uses `ROOMS` / `Room`, SQLite migration `v1`, and APP_ORIGIN `https://moukrea.github.io`. No other project's relay was used. HTTP health, WebSocket authentication, bidirectional routing, ping/pong, and rejection of an unauthorized origin were verified. Real encrypted pairing and shell operation were then tested publicly.

[Beta.2 release](https://github.com/moukrea/jaunt/actions/runs/34855623613): three public assets (wheel, host-manifest.json, SHA256SUMS) downloaded and verified before [Pages](https://github.com/moukrea/jaunt/actions/runs/34855764137). GitHub variables jaunt_RELAY_URL, jaunt_RELEASE_TAG, and jaunt_PAGE_URL were set. The page's 25 resource requests, including JS modules, images, jsQR/xterm licenses, installer, and service worker, were compared with delivered bytes under `/jaunt/`. No runtime JS came from a CDN.

OAuth credentials are stored encrypted with a key in the local system keyring. CLOUDFLARE_ACCOUNT_ID is set in GitHub; a future Actions relay deployment still requires its own CLOUDFLARE_API_TOKEN. The observed deployment used local OAuth, not a GitHub token or an OAuth token copied as a permanent API secret. This does not involve end users.

## Commands and observed results

Development setup: `python3 -m venv .venv`, then `pip install -e . -r requirements-dev.txt pip-audit` and `npm ci`. Editable development installation is separate from wheel testing.

| Command | Result |
|---|---|
| `npm install`, then `npm ci` | Real package-lock.json resolved and committed; reproducible installation |
| `npm run prepare-web` | 20 resources; jsQR 1.4.0 and Apache license copied locally |
| `pytest -q` | **36 passed**; real PTY, Web Crypto interoperability, atomic upgrade, interrupted send |
| `npm test` | **17 passed** |
| `npm run test:relay` | **1 real workerd/Miniflare integration passed**, SQLite and WebSockets |
| `python scripts/check_project.py` | Passed without the `--source` exemption |
| `python scripts/build_release.py` | Beta.2 wheel, manifest, and checksums built |
| `python -m playwright install chromium` | Chromium actually installed |
| `python tests/browser_e2e.py` | **20 scenarios passed** in CI with the Python relay |
| `jaunt_E2E_RELAY=workerd python tests/browser_e2e.py` | **20 scenarios passed**, locally and in CI |
| `python tests/installer_e2e.py` | **8 checks passed** on beta.2, locally and in CI |
| `jaunt_INSTALLER_ONLINE=1 python tests/installer_e2e.py` | **8 checks passed** on beta.1, using a loopback mirror and PyPI dependencies in fresh environments |
| `npm audit` | **0 known vulnerabilities** in the resolved graph |
| `pip-audit` | **0 known vulnerabilities**; the local jaunt package is absent from PyPI and therefore not covered |

[Beta.2 CI](https://github.com/moukrea/jaunt/actions/runs/34855112550): seven successful jobs, including 36 host tests across Linux/macOS × Python 3.11/3.13 and both sets of 20 browser scenarios. Branch-protection requirements `lint` and `test` execute real checks; the latter depends on all full suites succeeding.

Local versions: Python 3.14.2, Node 25.5.0, npm 11.8.0, pytest 9.1.1, Playwright 1.62.0, Chromium 151.0.7922.34. CI: Node 22, Python 3.11/3.13. Host: websockets 16.0, cryptography 50.0.1, qrcode 8.2, pywebpush 2.5.0. Build: setuptools 84.0.0, pip 26.2.1, Wrangler 4.131.2, direct Miniflare 4.20260730.0; Wrangler also uses Miniflare 5.20260911.1-alpha. Miniflare overrides: sharp 0.35.4 and undici 7.29.0.

Initial cryptography/pip and Miniflare/sharp/undici advisories were addressed with pinned updates and overrides, then retested. Sources: [cryptography](https://github.com/pyca/cryptography/security/advisories), [sharp](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c), [undici](https://github.com/advisories/GHSA-4cwx-7wf7-3272). The supplied xterm bundle's exact provenance/version remains limited as described in THIRD_PARTY_NOTICES.md; npm audit does not cover this bundle.

## Public acceptance test on a clean machine

QEMU/KVM Ubuntu 24.04 VM, Python 3.12.3, official image verified against SHA-256 `612b2c0cc1bc413a6cb8c38fd611794caf0f2b436c50013d8b3794db12ad7354`. No source code or editable runtime was installed there. Public beta.1 installation produced a QR code and enabled systemd user service; a real reboot confirmed automatic startup, relay connectivity, and retained identity. The public beta.1 → beta.2 upgrade preserved devices.

A private acceptance script drove SSH and Chromium against the public page. It ran the then-current installation command, `jaunt status`, `jaunt pair --json`, `systemctl --user` commands, and UI interactions. QR codes and private output remain outside the repository. Results:

- Public pairing and an authenticated encrypted channel through Cloudflare.
- Arbitrary shell, `printf`/`cat`, and `PUBLIC_jaunt_PROVED` verified in both the terminal and a file; second tab and return to the first.
- Multi-chunk Unicode/binary uploads and downloads compared byte for byte.
- Image transferred and quoted path inserted without Enter; a sentinel file verified that nothing executed automatically. Native paste was disabled on this headless VM.
- Page reload with remembered identity and no new QR code.
- Real outbound VM network interruption through a temporary rule limited to that VM and removed in a `finally` block: same shell PID and session, with a proven `RESUMED` command after reconnecting without pairing.
- Public upgrade refused with two ordinary shells active; daemon retained.
- Upgrade with `jaunt_ALLOW_RESTART=1`: explicit restart, shells terminated, service active, host/device identities preserved, browser reconnected.
- Revocation disconnected the browser and disabled shell creation.
- No uncaught browser exception.

The eleven checks were recorded in `docs/evidence/public-report.json`, alongside workerd and beta.2 installer evidence. At that point, `browser-report.json` retained the earlier 18-scenario local run as historical evidence; the referenced CI proved the 20-scenario suite. The evidence files have since been updated for the later delivery described in PUBLIC_DELIVERY.md.

## Failures fixed without removing features or assertions

- A late directory-list response overwrote the typed path: per-host drafts and request revisions fixed it; the test delays real encrypted responses.
- Assertions read the terminal before asynchronous delivery: bounded waits now check actual output, insertion, or completed attachment.
- A Bash check separate from shutdown raced with shell creation: atomic daemon upgrade shutdown closes admission.
- Relay pongs masked host loss: authenticated host messages are monitored separately and trigger reconnection. The test suspends the real host while leaving the relay running.
- A WebSocket exception during send terminated the PTY output task: interrupted sends become ConnectionError and close the channel. Two real-PTY regressions fail with the old transport and pass after the fix, including replay and fresh output on the same PID.
- Headless tests inherited the desktop environment and personal profiles: graphical variables are removed and test shells run without profiles in temporary directories.
- Killing only the Miniflare parent left workerd connected: the harness now interrupts its own isolated process group.

## Limitations and reports that must remain visible

These observations describe the initial beta.2 delivery; later validation below and in PUBLIC_DELIVERY.md records subsequent progress.

- The agent used no physical phone. The user reported successful mobile pairing after forgetting a remembered entry; that does not validate camera, keyboard/IME, gallery, rotation, Wi-Fi/mobile handoff, suspended PWA, or locked-screen push. The user also reported failed Android screenshot paste into Claude Code; that specific flow was still under investigation at this point.
- Actual Web Push delivery and native paste inside Claude/Codex were not validated. An inserted path is not a native attachment; no OS clipboard is promised on a headless host.
- launchd, macOS/WSL installation, bootstrap without Python, Safari/Firefox, real tmux, sustained load, relay quotas/costs, and SLA were not validated in this initial run.
- The protocol, host, frontend, and relay have no independent audit.

## Artifacts and privacy

Each release's three assets were downloaded, checksums verified, and wheel contents inspected. Gitleaks 8.30.1 found no leaks in the wheels. The initial snapshot produced one reviewed false positive: xterm's JavaScript FourKeyMap/TwoKeyMap initialization. Checks cover the project and its fixtures, never destructive scans of personal directories. No host.json, development state, QR code, vault, secret, or private terminal content is published. Workflows were reviewed and use npm ci; Pages verifies all three assets before deployment. The ZIP is built from an allowlist, with CRC checks, byte comparisons, and per-file checksums. The jsQR license is preserved intact, including its final newline.

## Usability fixes following user feedback

Paste could treat empty text as a successful paste. It now opens a rich paste area when the API supplies no useful content, accepts FileList/DataTransfer images and embedded PNG data from HTML, and neither inserts HTML nor downloads external URLs. A single image is automatically sent to the host clipboard and then Ctrl+V in the captured session when a native backend is available. Headless hosts retain the explicit path option. Host errors are no longer disguised as mobile clipboard permission failures.

The local workerd flow reached **22 scenarios**, including reading a real image through Chromium's Clipboard API and simulating an empty-text result followed by rich paste to a real host. The latter simulates only clipboard input; it does not claim Android interaction.

A separate Xvfb/X11 VM also received the image from the browser through the public Worker and installed beta.2 wheel. The xclip PNG matched the uploaded file exactly, and the PTY received only byte `16` (Ctrl+V), without Enter. This pre-publication test injected the branch UI files into Chromium at the page's origin; see `native-clipboard-report.json`. It does not prove attachment display inside actual Claude Code/Codex. The user reported that both Attach modes worked on their device; the Paste-specific fix still awaited confirmation on their phone.

Transfers is no longer a permanent tab. Tracking, cancellation, and paths remain available under Files → Transfer activity after a transfer; the browser saves downloads.

macOS CI revealed another closure case: the reaper's alive flag could remain true after the process had actually exited. Closing now checks Popen.poll before signaling the process group. EPERM is tolerated only if the process has since exited; failure on a living child remains an error. A regression verifies that an already exited PID is never signaled. This brought the local suite to 37 tests and prepared beta.3.

## Android client and beta.3 follow-up — 2026-09-14

PR #10 passed every CI job, including 37 Python tests on Linux/macOS and both browser relay backends, then merged as `f85b9cb`. Public host `v0.1.0-beta.3` was published by run `34859426583`; all three public assets, wheel contents and checksums were verified, and the wheel secret scan found no leaks. Pages run `34859891960` succeeded; its beta.3 configuration and changed interface resources were compared with the merged source. The isolated Ubuntu VM upgraded from the public installer with its identity preserved and its user service active.

Android local build observations:

- JDK 17; Gradle 9.5.0 with official distribution SHA-256; AGP 9.3.2; compile SDK 37.0 / target 36 / minimum 26.
- `android/gradlew -p android :app:assembleRelease :app:lintRelease :app:assembleDebug :app:assembleDebugAndroidTest :app:testDebugUnitTest :app:lintDebug --write-locks --write-verification-metadata sha256 --no-daemon`: successful. Two native protocol unit tests passed (bidirectional encryption, replay/tamper rejection and proof binding). The native channel also authenticated against the actual public Python host, independently of these unit fixtures.
- Android lint: no errors. Remaining warnings concern the deliberately retained target API 36, the compatible Gradle version, JavaScript being enabled for the bundled interface and feature-guard analysis; these are reviewed boundaries, not suppressed assertions. A renderer-loss recovery callback was subsequently added following the WebKit lint warning.
- OSV queried all 21 resolved Android release runtime Maven artifacts: no reported advisories on 2026-09-14. This is database coverage, not a security audit. WebKit was updated to 1.17.0 and the JVM JSON test library to 20260814 after checking available versions.
- `apksigner verify --verbose --print-certs`: signed release APK verifies with APK Signature Scheme v2, RSA 4096, certificate SHA-256 `0c94f35fe68a30eb155c4aa5b9003f633b5b4884f191c54f84bdeeec956348fe`. Local signed APK installation and launch succeeded in the emulator. Release debugging is disabled; the end-to-end automation below used the debug build's WebView debugging, not a production debug endpoint.
- Android 14/API 34 x86_64 emulator: installed APK → public Cloudflare relay → public release-installed beta.3 host → real shell command and output file; native Android text clipboard round-trip; native Java encrypted notification channel; actual Android notification with the app backgrounded and emulator screen off; native Android image clipboard → upload → isolated host X11 clipboard → PTY byte `16` (Ctrl+V), no Enter, PNG bytes equal; rotation and network toggle retain the same shell ID/PID; Android Save dialog writes exact binary fixture bytes.
- Android clipboard fixture is a separate instrumentation APK. It is not in the signed application. All host/clipboard/image tests used synthetic data in the isolated VM/emulator, never the user's desktop clipboard or personal folders.
- After shared-interface integration: `npm test` and actual `npm run test:relay` passed; `python tests/browser_e2e.py` passed all 22 browser scenarios; `python scripts/check_project.py` passed. GitHub CI repeats both browser relay backends before merge.

Evidence: `docs/evidence/android-report.json` and `android-dependency-audit.json`. Physical Android camera scanning, real keyboard/IME behavior, gallery variants, actual Wi-Fi/mobile handoff, deep idle/OEM battery behavior and attachment recognition inside an actual Claude Code/Codex version are not claimed. Screen-off emulator notification delivery is not proof of guaranteed deep-idle push. The protocol and native implementation remain independently unaudited.

A release-specific blank-start observation blocked publication during validation. The native container now keeps an explicit opening/retry screen until the bundled application confirms readiness and requests a redraw. Three consecutive cold starts of the non-debuggable signed release then displayed the workspace. Initial clean-run CI also rejected two missing Gradle metadata checksums; a fresh dependency-cache resolution generated the missing POM/module checksums without disabling verification.

## Automatic updates — implementation validation

The requested host updater adds six failure/safety tests: a downloaded update defers with a real active-session status even when restart authorization is inherited; tampered wheel bytes cannot reach host shutdown; automatic installation strips restart and developer overrides; explicit restart is handled separately; older/invalid release tags are rejected; disabling automatic updates prevents network access. `pytest -q`: **43 passed**. The real installer suite still passes all **8 checks**, including active PTY refusal and explicit restart. Public automatic version-to-version installation and Android's real update installer are tracked separately from these tests and must be recorded after release publication.

The signed (non-debuggable) APK paired successfully through Android's Documents/gallery picker using a QR image, against the public beta.3 host and Cloudflare relay. Android's real camera permission dialog and the native ZXing scanner launch were also exercised; an actual physical camera decoding a QR is still not claimed. The APK deliberately bypasses the old WebView's BarcodeDetector for gallery QR decoding: that API crashed in the emulator when Google Play Services was absent; bundled jsQR decoded the same pairing successfully.

The automatic-update shutdown guard now also defers during file transfers. An actual temporary upload remains writable after a refused restart and completes with identical bytes before shutdown is allowed. The full Python suite now reports **45 passed**. Android release discovery uses the verified public Page channel instead of requiring each device to consume GitHub API quota. Native JVM tests: **3 passed**. The signed APK also executed a command through its Android Compose/keyboard input; the resulting host file contained the exact expected bytes.

## Shared workspace release

See [workspace validation](WORKSPACE_VALIDATION.md) for the current desktop/shared-session, terminal geometry, Android insets and notification changes. Earlier beta observations above remain historical and do not imply that every new platform combination was tested.

## Subsequent delivery regressions

See [delivery regression fixes](DELIVERY_REGRESSIONS.md) for the user-reported shell environment, Ubuntu startup, launcher/icon, Android scrolling and notification defects discovered after the earlier delivery. Earlier passing tests did not cover these paths.

## Hero preview alignment — 2026-09-15

The web presentation now mirrors the application's sidebar, machine card, connection header, session controls, tab icons, terminal footer and transfer controls. The phone preview includes the session list, key row and labeled bottom navigation. Shell, Codex and Claude previews remain synchronized; the latter two use the same bundled Meteor icons as live sessions. The preview uses illustrative terminal output, not a live connection.

Playwright checks at 1440, 1024 and 390 CSS pixels passed: all three preview selections and matching phone icons, no JavaScript errors, no horizontal page overflow, and entry into the actual workspace. Desktop and mobile screenshots were inspected. Decorative orbit overflow at 1024 pixels was corrected. The presentation remains hidden in native apps and installed PWA mode.
## Codex Linear baseline — September 21, 2026

Integrated the existing local Codex adapter and three `.agents/skills` into the
JAU-39 branch based on `ab7888b`, retaining the merged named-priority validation.
The shared claim guard rejects switching an existing claim between Claude and
Codex even before a session is recorded; legacy claims still belong to Claude.
The canonical checkout's uncommitted source files were preserved.

Observed on Linux: all **69 `npm test` tests passed**, including **14 Codex
adapter tests** and the existing named-priority regressions. The project checker
passed after `npm run prepare-web`, and all three new skills passed the skill
frontmatter validator. The isolated adapter fixture exercises repeated arming,
thread-ID persistence, exact-session resume, retained model settings and loop-off.
Other adapter tests cover identity isolation, runtime ownership, durable wake
events, queue delivery failure, owner closure and failed process startup.
These fixtures use temporary state and no Linear or model API calls.

The real JAU-39 worker registered its actual Codex thread, published its plan,
parked for approval, and resumed the same session. The canonical `verdict`
registered the human reaction and moved its claim to `implementing`; Linear
returned to its previous `Backlog` state. This observation uses the pre-existing
canonical adapter, not a fresh installation of this branch. The local CLI help
confirmed `exec --json`, exact-ID `exec resume`, and `queue --thread --message`.

Both skill families now require reading actual PR/Linear states and actual
artifacts instead of inferring progress from a push or package availability from
changed paths. Desktop packages do not install this development harness.

Not validated locally: a fresh installation, the full live wake/approval/merge
cycle using the newly versioned source, macOS adapter execution, or older CLIs
without `queue`. No second live loop was started and no canonical launcher was
reinstalled for these checks. JAU-50 closure and JAU-54 recovery are separate
dependent work, not delivered by this baseline.

## Worker supervision and recovery — September 21, 2026 (JAU-54)

`npm test`: **99 tests passed**. `python3 scripts/check_project.py`: passed.
The new offline subprocess fixtures exercised both Codex and Claude launchers:
failed child, durable watchdog deadline/wake, exact-session resume with the saved
model, and rejection of a second recovery after normal completion. Fixtures use
fake CLIs and no provider/Linear API calls. Other checks cover live orphan children,
PID identity, stale attempt completion, launch exclusion, stop/loop flags, current
approval and direct-prerequisite refusal, merged-before-retry, persistent retry
budgets, forward-phase reset, provider cooldown isolation and explicit timezone
reset parsing (including ambiguous DST rejection).

Temporary Git repositories exercised squash-merge cleanup and refusal of an extra
local commit. Cleanup tests also covered unpublished/modified drafts, ignored files,
archive restoration after removal failure, closure validation before removal and
claim replacement during removal. The existing JAU-50 release checks still pass.

No real provider quota was exhausted, real active worker killed, or real ticket
recovered during these tests. Process behavior on macOS and unsupported/localized
quota messages remain unverified; unknown identity defers recovery, and unsupported
reset text uses bounded backoff. Existing workers without the new generation-bound
lifecycle records are reported as unknown; their identity is never reconstructed
from a PID guess. Native transcripts remain the context source. New launches use
the supervised runtime wrapper. Recovery remains bound to an enabled loop and a
live owner, and the generic prerequisite traversal defect remains tracked in JAU-56.

## Leaving human approval waiting — September 21, 2026 (JAU-43)

`npm test`: **111 tests passed**. `python3 scripts/check_project.py`: passed.
Offline fixtures exercise the shared claim writer for all four exits from
`awaiting-approval`, repeated waiting, queued approvals, feedback and refusal,
repeated answer registration, pending/no-plan reads, manual board moves, and
legacy restoration debt. They use temporary state and injected board operations;
no fixture contacts Linear. Session/runtime, claim generation and work history
are retained. Missing destinations, deleted states and network failures preserve
the claim, while a remote success followed by interruption retries without a
second board move. Concurrent replacement claims are preserved.

Release fixtures verify closure validation before restoration, restoration before
worktree removal, both closure and unstarted-release paths, and preservation of
claim/stop/inventory on restoration or removal failure. Existing supervision,
cleanup and closure checks also passed. A retry after successful restoration and
failed removal does not repeat the board mutation.

The real canonical launcher registered JAU-43's human approval, moved its claim
to `implementing` and restored `Backlog` using the pre-existing verdict path.
The new direct-claim/release paths were not installed or exercised against the
live board during validation. Canonical local edits were left untouched.
A simultaneous human board move and API mutation is not an atomic transaction;
local generation checks and remote rereads do not provide remote compare-and-set.
