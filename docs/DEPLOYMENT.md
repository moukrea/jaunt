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

## Host, desktop and Android releases, then Pages

1. Pass CI. Create the host tag, currently `v0.1.0-beta.10` (Python version `0.1.0b10`). The release workflow builds the wheel and publishes it with `host-manifest.json` and `SHA256SUMS`. Beta releases are explicitly marked as prereleases. Never overwrite an existing release's assets.
2. For Android, publish the tag, currently `android-v0.1.0-beta.7`, with its signed APK, `SIGNING-CERTIFICATE.txt`, and `SHA256SUMS`; verify the public assets. Keep the same signing key for updates.
3. Publish `desktop-v0.1.0-beta.9`: Linux x64/ARM64 archives, deb/rpm packages, macOS x64/ARM64 zip/dmg packages, and `SHA256SUMS`. Verify the public archives before advertising them. The Linux package must retain Chromium sandbox support; macOS builds are unsigned.
4. Set repository variables `jaunt_RELAY_URL` (actual WSS URL), `jaunt_RELEASE_TAG` (`v0.1.0-beta.10`), `jaunt_ANDROID_RELEASE_TAG` (`android-v0.1.0-beta.7`), `jaunt_DESKTOP_RELEASE_TAG` (`desktop-v0.1.0-beta.9`), and optionally `jaunt_PAGE_URL` (defaults to the repository's page URL). Never put host tokens or pairing secrets in public variables.
5. Enable Pages in GitHub Actions mode. `pages.yml` builds the web app, validates configuration, copies the installer, and publishes it.
6. Do not run Pages with a nonexistent release. The deployment prompt requires this order.

## Required remote acceptance testing

On a Linux machine without an exposed incoming port: install from the published page, scan the QR code in Chrome Android, create a shell, run a command, upload and download a file, paste an image, test both image modes according to host capabilities, close/reopen the PWA, switch Wi-Fi/mobile networks, return to the same shell without a QR code, test push with the screen locked, and revoke the device. Repeat the minimal path on macOS and Firefox/Safari when available.

Never mark an unexecuted test as validated. The included local report does not by itself prove production Cloudflare connectivity or physical-phone behavior.

## Publication and operations

Keep technical logs without payloads, monitor errors and quotas, plan identity rotation and private host-state backups, and do not turn the relay into file storage. Worker updates may break connections; hosts and clients must reconnect without pairing again. Removing code does not roll back Durable Object migrations.

Primary sources: [Durable Object WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), [Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/), [GitHub Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages), [uv installation](https://docs.astral.sh/uv/getting-started/installation/).

## Earlier deployment, September 14–15, 2026

See [the current delivery report](SESSION_CONTROLS_VALIDATION.md) for subsequent releases and observed acceptance results.

Pages: https://moukrea.github.io/jaunt/ ; relay: `wss://jaunt-relay.moukrea.workers.dev` ; host release: `v0.1.0-beta.9` ; APK: `android-v0.1.0-beta.5`.

The Worker was deployed using owner-authorized Wrangler OAuth, stored locally with encryption and a key in the system keyring. `CLOUDFLARE_ACCOUNT_ID` is set in GitHub; a future relay deployment through Actions will need its own `CLOUDFLARE_API_TOKEN`. No temporary OAuth token was copied into a permanent API secret. End users do not need to take any Cloudflare or GitHub action. See [VALIDATION.md](VALIDATION.md) for observed results and their limitations.
