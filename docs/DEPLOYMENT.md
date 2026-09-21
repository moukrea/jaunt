# Maintainer deployment

End users only install the host. The **project owner** deploys these two components once:

1. GitHub Pages: HTML, JavaScript, CSS, logo, installer, and public configuration.
2. Cloudflare Worker with a SQLite Durable Object: WebSocket relay. Do not replace it with a looping GitHub Actions job, a personal tunnel, or another project's public servers.

## Preparation

Preserve the existing repository on a backup branch, then integrate the files on a working branch. Do not overwrite history or force-push. Install Python and Node 22+, then run `pip install -e . -r requirements-dev.txt`, `npm ci`, and `npm run prepare-web`. The build copies jsQR 1.4.0 and its license locally and generates a versioned PWA cache. Commit the genuinely resolved `package-lock.json` and review licenses; never invent a lockfile.

Deployment tools are pinned and the resolved lockfile is committed. The sharp/undici overrides address known advisories in the Miniflare 4 test dependency; see [VALIDATION.md](VALIDATION.md).

## Relay

- Create or select a Cloudflare account authorized for Workers and SQLite Durable Objects. Check the account's current terms and quotas.
- Authorize the agent to deploy, or set Actions secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` through GitHub's secure interface. The token must permit Worker deployment and Durable Object migration in that account.
- `relay.yml` runs Wrangler with `relay/wrangler.jsonc`: initial name `jaunt-relay`, binding `ROOMS`, class `Room`, SQLite migration `v1`.
- APP_ORIGIN must be `https://moukrea.github.io` (the origin, without `/jaunt/`). Do not use `*` in production. `config.json` must contain the Worker's actual WSS URL, without an appended `/v1/room/...` path; the client constructs that path.
- Verify `/health`, then **real pairing and an encrypted command**. An HTTP 200 health response does not validate WebSockets.

## Automatic publication after a product merge

`auto-release.yml` is the sole production publisher. Feature PRs do not bump
versions. After successful CI on `main`, a serialized coordinator reads every
first-parent commit after the durable cursor in `jaunt-release-state`. Replaced
GitHub concurrency notifications cannot remove commits from that queue. It
publishes one product source at a time, then dispatches itself to drain the rest.
A source without successful `lint` and `test` jobs in its main CI run remains
pending. Documentation, tests and Linear harness changes advance the cursor
without publishing a package; changing only the npm test command is also excluded.

Product classification follows `host/`, `web/`, `desktop/`, `android/`, `relay/`,
the installer, dependencies and build metadata, and local scripts referenced by
the release/build workflows and build package scripts. Local script calls and
imports are followed in both old and new revisions, including removed files.
Unresolved build commands/imports fail explicitly. Web changes, host locales
copied into web, and `prepare-web` affect all three packages. Relay changes also
require the relay deployment and a real authenticated bidirectional WebSocket
probe; package publication alone cannot satisfy them.

For affected components the coordinator allocates the next numbered beta tag
from existing tags, preserves independent host/desktop/Android version series,
and increases Android `versionCode` beyond the existing tags and source value.
A generated commit has exactly the validated main source as its parent. Only
version fields, public tag configuration and release notes may differ. Tags and
the pending receipt are pushed atomically; main is never bypassed or rewritten.
The tagged commit is the publication source of truth; development main does not
receive automated version commits. Notes name the source commit and its subject.

Host, desktop and Android reusable workflows build that exact commit. Verified
existing releases are reused on retry, never replaced. Verification checks the
expected tag target, full asset inventory and every checksum, including all ten
desktop OS/architecture/package combinations and the native deb/rpm architecture
names. Publishers first freeze the complete build in a temporary bundle inside a
release draft, then upload and verify its individual assets before publishing.
A retry reuses those original bytes even when rebuilding is not reproducible.
The bundle is removed only after the final assets are complete. Zero-length
server-side starter uploads may be removed from an unpublished draft to retry;
completed or public assets are never replaced. A corrupt or incompatible release
blocks with its receipt intact. If a publisher loses its response, retry the
coordinator, not an individual component publisher.

After required builds/deployment succeed, the coordinator verifies assets,
updates all three tag variables, then calls Pages with explicit tags and the
same release commit. It verifies the public `config.json`, including
`releaseSource`, before recording `delivered`. Repository variable updates are
not transactional: a failed promotion is retried with the same tags, and Pages
cannot run independently while the tuple is incomplete. The old independent
manual/tag triggers have been removed from current workflows. Never dispatch
historical workflow revisions or publish tags from a separate session; those
revisions predate this lock. Preflight refuses other active legacy publishers,
but coordination with people remains necessary to prevent a new outside writer.

### Activation and credentials

Before the first activation, coordinate the exclusive handoff with other release
sessions and verify that previous publications have finished. Keep repository
variable `JAUNT_AUTO_RELEASE_ENABLED` unset or `false` during this handoff.
Manually run **Automatic release** on main: even while disabled, its preflight
tests `RELEASE_TOKEN` by reading and rewriting the same three public tag variable
values. The token needs repository Variables read/write (or the equivalent
classic scope). Its presence alone is not evidence of working credentials.
`GITHUB_TOKEN` has Contents and Actions write for atomic receipt/tag pushes and
continuation dispatches; build jobs retain their existing scoped permissions.
No secret is stored in a receipt, URL, argument or public variable.

The initial public host, desktop and Android releases must exist, have verified
assets and point at the same ancestor of main. Otherwise bootstrap refuses and
the publisher must reconcile the baseline explicitly. Once preflight and the
exclusive handoff are verified, set `JAUNT_AUTO_RELEASE_ENABLED=true` and run
**Automatic release**. It initializes the durable branch and accounts for the
backlog. Do not point the baseline at a newer commit merely to skip an error.

Before allocating tags, selected-component preflight requires the Android
signing secret trio and/or relay credentials. Presence does not prove validity:
the actual signing/build/deployment checks still must succeed before delivery.
Android uses the existing signing secrets and keeps the signing identity.
For relay changes, configure `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`
securely as repository secrets, available to the coordinator preflight as well
as the deployment job. Environment-only secrets cannot satisfy that preflight. Missing authority
blocks relay delivery; local Wrangler OAuth is not available to Actions.
The relay probe verifies health and routing, not a physical-device acceptance
flow or an independent security audit.

### Recovery and delivery evidence

Read the **Automatic release** run summary and `state.json` on
`jaunt-release-state`. The append-only branch history records source SHA,
publication SHA, component tags, asset hashes, run ID and pending/failed/delivered
status. The current source is acknowledged only after public verification.
Rerun **Automatic release** to resume failures. A failed stage retains the same
versions. If the run is cancelled before its failure recorder executes, the
pending receipt still survives. If continuation dispatch fails after delivery,
rerunning scans onward from the already durable cursor.

Set `JAUNT_AUTO_RELEASE_ENABLED=false` to prevent new publication runs from
preparing work; it does not roll back or interrupt a run already admitted.
Do not delete the receipt branch or immutable tags to recover. An incompatible
existing release requires investigation and an explicit recovery decision.

**Merged is not delivered.** Linear's merge integration can close a ticket while
publication is pending or failed. The worker handover must separately name the
actual release run and delivery receipt (or the precise blocker). A harness-only
merge requires no new installable package. Development-channel previews remain
a separate feature; this workflow publishes the existing production beta channel.

## Required remote acceptance testing

On a Linux machine without an exposed incoming port: install from the published page, scan the QR code in Chrome Android, create a shell, run a command, upload and download a file, paste an image, test both image modes according to host capabilities, close/reopen the PWA, switch Wi-Fi/mobile networks, return to the same shell without a QR code, test push with the screen locked, and revoke the device. Repeat the minimal path on macOS and Firefox/Safari when available.

Never mark an unexecuted test as validated. The included local report does not by itself prove production Cloudflare connectivity or physical-phone behavior.

## Publication and operations

Keep technical logs without payloads, monitor errors and quotas, plan identity rotation and private host-state backups, and do not turn the relay into file storage. Worker updates may break connections; hosts and clients must reconnect without pairing again. Removing code does not roll back Durable Object migrations.

Primary sources: [Durable Object WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), [Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/), [GitHub Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages), [uv installation](https://docs.astral.sh/uv/getting-started/installation/).

## Earlier deployment, September 14–15, 2026

See [the current delivery report](SESSION_CONTROLS_VALIDATION.md) for subsequent releases and observed acceptance results.

Pages: https://moukrea.github.io/jaunt/ ; relay: `wss://jaunt-relay.moukrea.workers.dev` ; host release: `v0.1.0-beta.41` ; APK: `android-v0.1.0-beta.31`.

The Worker was deployed using owner-authorized Wrangler OAuth, stored locally with encryption and a key in the system keyring. `CLOUDFLARE_ACCOUNT_ID` is set in GitHub; a future relay deployment through Actions will need its own `CLOUDFLARE_API_TOKEN`. No temporary OAuth token was copied into a permanent API secret. End users do not need to take any Cloudflare or GitHub action. See [VALIDATION.md](VALIDATION.md) for observed results and their limitations.
