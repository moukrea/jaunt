# Delivery prompt — jaunt

You have authorized GitHub access to `moukrea/jaunt`. Integrate and deploy the project in this archive. Do not read the old implementation for inspiration: this project is a rewrite. Preserve the previous state on a backup branch, then work through a branch and PR. Do not force-push or delete history.

The non-negotiable requirement is real access to arbitrary shells through a mobile/desktop UI, not just Claude/Codex agents. One-command host installation, no VPN/Tailscale or server configuration for end users. Pair once by QR code, persistent keys, network changes without pairing again, files, images, clipboard, multiple sessions, and notifications.

## Execution

1. Read README.md, SECURITY.md, docs/VALIDATION.md, and docs/DEPLOYMENT.md; inspect the delivered code. Do not rewrite working components merely to simplify them. Do not hide documented limitations.
2. Install build/test dependencies and generate and commit a real package-lock.json. Check current versions and security advisories. `npm run prepare-web` must produce a local jsQR copy and its license. No runtime JavaScript from a CDN. Verify every import and resource under the published `/jaunt/` path.
3. Run pytest, relay Node tests, real Miniflare tests, check_project, build_release, and browser E2E tests. Read failures and fix their causes; never just remove assertions or features. Report commands, versions, and actually observed results.
4. Deploy the Worker using the authorized Cloudflare account. The required secrets are CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID. If Cloudflare authorization is unavailable, request ONLY that missing authorization through the appropriate secure mechanism and explain that a GitHub token does not grant it. Never invent a URL or borrow another project's public relay.
5. Configure APP_ORIGIN, verify health AND real WebSockets, then set jaunt_RELAY_URL in GitHub. Publish the host tag/release and its three assets before Pages. Set jaunt_RELEASE_TAG and enable Pages through Actions. Trigger the Pages workflow and verify its actual URL.
6. Perform a real installation from the public release on a clean machine, not editable source. Verify the checksum, user service, startup, and QR code. Verify identity-preserving upgrades and refusal to silently kill active ordinary shells. Destroying them must continue to require explicit restart authorization.
7. Run the end-to-end acceptance flow: public page → pairing → shell → command with proven output → new tab → return to the first shell → image/text upload → download with byte comparison → relay/network interruption → same session without a new QR → revocation. On an authorized physical phone, test camera QR scanning, keyboard, gallery, rotation, Wi-Fi/mobile switching, PWA, and push with the screen locked. Never claim to have used a phone if none is available.
8. Preserve the distinction between upload-plus-path without Enter and conditional native paste. Do not claim a Claude/Codex attachment when only a path was inserted. Make the headless fallback explicit. Never promise an OS clipboard that does not exist.
9. Never publish host.json, .dev-state, secrets, QR codes, vault exports, or private terminal logs. Inspect ZIP/release contents and workflows before publication. Do not run destructive scans on the user's personal directories for tests.
10. Deliver the published URL, validated installation command, tag/release, test report, and remaining unvalidated limitations. Do not hand over 40 manual tasks. Owner deployment happens once; end users must not need Cloudflare/GitHub accounts to connect.

## Publication blockers

An unconfigured relay, falsely claimed image paste, nonfunctional created shell, artificially passing tests, missing JS import, invented release/URL, or repository secrets block publication. The protocol's security has not been audited: retain that disclosure even when all tests pass.
