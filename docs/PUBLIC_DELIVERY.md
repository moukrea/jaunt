# Public delivery — September 15, 2026

For the subsequent host beta.9 / desktop beta.7 / Android beta.5 corrections and public verification, see [delivery regression results](DELIVERY_REGRESSIONS.md). The observations below describe the earlier release.

The published application is **https://moukrea.github.io/jaunt/**. End users do not need a GitHub or Cloudflare account, VPN, or inbound server configuration.

- Host: [v0.1.0-beta.8](https://github.com/moukrea/jaunt/releases/tag/v0.1.0-beta.8), Python version `0.1.0b8`.
- Desktop: [0.1.0-beta.6](https://github.com/moukrea/jaunt/releases/tag/desktop-v0.1.0-beta.6), Linux x64/ARM64 tar/deb/rpm and macOS x64/ARM64 zip/dmg packages.
- Android: [signed beta.4 APK](https://github.com/moukrea/jaunt/releases/download/android-v0.1.0-beta.4/jaunt-android-v0.1.0-beta.4.apk), [release and checksums](https://github.com/moukrea/jaunt/releases/tag/android-v0.1.0-beta.4).
- Project relay: `wss://jaunt-relay.moukrea.workers.dev`, with `APP_ORIGIN=https://moukrea.github.io`.

## Validated installation

```sh
bash -o pipefail -c 'curl -qfL --connect-timeout 10 --max-time 120 https://moukrea.github.io/jaunt/install.sh | bash'
```

The exact command extracted from the public page installed `0.1.0b8` in a fresh Fedora 43 container. A subsequent `jaunt gui --install-only` downloaded and verified the desktop archive and created its application-menu entry. The normal installer performs this desktop setup automatically when it detects a graphical host. `jaunt gui` opens the installed desktop app; Linux distribution packages are also available from the desktop release.

A separate Ubuntu 24.04.5 VM upgraded the non-editable public beta.5 wheel to public beta.8, retaining host and device identities and its enabled, active user service. The initial upgrade explicitly selected the new public release before the default Pages channel switched. The subsequent public acceptance recipe used the published default installer without a version override.

Automatic host updates retain ordinary shells and transfers. Explicit restart authorization is required to destroy active shells, including background jobs which survive an exited shell. The final code also strips both current and legacy environment overrides from automatic installations. Android checks for updates and uses the Android system installer; its confirmation remains required.

## Observed checks

[PR #18](https://github.com/moukrea/jaunt/pull/18) merged after its checks passed. The [final CI](https://github.com/moukrea/jaunt/actions/runs/34950530292), [host release](https://github.com/moukrea/jaunt/actions/runs/34950562658), [desktop release](https://github.com/moukrea/jaunt/actions/runs/34948505167), and [Android release](https://github.com/moukrea/jaunt/actions/runs/34948504993) passed. Releases preceded [Pages deployment](https://github.com/moukrea/jaunt/actions/runs/34951111652).

| Command or actual environment | Result |
|---|---|
| `pytest -q` | 61 passed; Linux/macOS, Python 3.11 and 3.13 |
| `npm test` | 21 passed |
| `npm run test:relay` | Two real Miniflare/workerd tests: web and native desktop origins, authenticated routing and hibernation ping; foreign origins rejected |
| `npm run prepare-web`; `python scripts/check_project.py` | Pinned local jsQR/xterm assets and licenses generated; resource/import/syntax checks passed |
| `python scripts/build_release.py` | Wheel, manifest and SHA256SUMS built |
| `python tests/browser_e2e.py`, with development relay and `jaunt_E2E_RELAY=workerd` | 23 scenarios per backend, with real PTYs and transfers |
| `python tests/shared_workspace_e2e.py` under Xvfb | Same PTY in Electron/browser; last active view sizes it; close/reopen and termination; persistent split tabs and mobile flattening |
| `python tests/terminal_render_e2e.py` | Scroll to latest, final row/column bounds, text selection, theme persistence, synchronized output; actual isolated Claude Code/Codex startup locally |
| `python tests/installer_e2e.py` | 8 passed, including checksum tampering, non-editable import, retained identities and refusal of implicit restart |
| Fedora 43/44 CI; `installer_namespace_e2e.py`; `installer_storage_e2e.py` | Public installation, isolated curl, full temporary storage and curl-write-error recovery passed |
| Android Gradle unit/lint/debug/release builds and `apksigner verify` | Passed; public APK retains the established signing certificate |
| `python tests/android_workspace_e2e.py` | Android 14 emulator: real public relay and shell, actual keyboard opening/resize, system-bar bounds, rotation and terminal-BEL notification with screen off |
| Public APK beta.3 → beta.4, installed with `adb install -r` | Same authorized device reconnects without pairing; this check does not claim an in-app system-installer flow |
| Public Linux `.deb` installed in Ubuntu VM | Real shell command executed; renderer Seccomp=2 and NoNewPrivs=1, without a sandbox override |
| `python tests/desktop_remote_e2e.py`; installed public desktop in VM | Native desktop authenticates as a remote client through public WSS, executes a proven command and terminates the session |
| Public desktop + public Page + public wheel | Two proven commands in one shared PTY; close/reopen retains it; remote termination removes both views |
| Public installed host, shell exited with stubborn background job | Unapproved restart refused; desktop Terminate kills the remaining job and removes the session |
| Public assets | Three host assets, three Android assets and all ten desktop packages verified against checksums; archive paths, APK signer and original icon resources checked |
| Public Page | Correct three release tags; 25 resources checked under `/jaunt/` against built bytes, including local JS and licenses |
| Public relay | Health HTTP 200, real WebSocket HTTP 101 and ping/pong; foreign browser origin rejected with 403 |
| `gitleaks dir` on exported Git source, public wheel and extracted desktop application | No leaks detected |
| `npm audit`; `pip-audit --local --skip-editable` | No known vulnerabilities reported in the checked dependency environments |

The public acceptance driver ran **12 checks** against the release-installed VM: pairing, proven arbitrary-shell output, a 512-character input burst, second tab and return, upload/download byte comparison, image upload plus quoted path without Enter on a headless host, reload without QR, real IPv4/IPv6 interruption with the same shell PID afterward, refusal of implicit upgrade, authorized restart retaining identities, revocation, and no uncaught browser errors. See [public-report.json](evidence/public-report.json). Each run used a fresh fixture directory; no personal folders were scanned or deleted.

The final relay revision is `698962dd-b16a-49f8-b658-a3c5953b3da9` (Wrangler 4.131.2). It adds the exact native renderer origin `jaunt://app` alongside the configured web origin. Both public origins were checked with real WebSocket upgrades/ping-pong, and remote-client pairing/commands were verified from the unchanged installed desktop package. Routing and end-to-end authentication remain required.

Tool versions and development findings are in [WORKSPACE_VALIDATION.md](WORKSPACE_VALIDATION.md). The delivered UI and package files use the original artwork. The beta.6 host candidate was superseded before it became the default channel; the beta.7 publishing workflow was cancelled before a release was created. Tags and history were retained.

## Validation boundaries

The custom security protocol remains **independently unaudited**. Automated tests and dependency scanners do not establish a security certification.

No physical Android handset was available. Camera QR capture, gallery/OEM variations, physical gesture navigation, Wi-Fi/mobile handover, deep idle and locked-screen push on a real phone remain unvalidated. Emulator results are reported as emulator results.

macOS desktop execution and trust prompts, ARM hardware, desktop notification presentation across environments, and browser push-provider delivery remain platform-specific validation limits. macOS desktop builds are unsigned. Linux per-user archives require a working Chromium sandbox; use the distribution package where user namespaces are restricted. Production launchers do not disable the sandbox.

Actual isolated Claude Code/Codex startup screens were tested without authentication or model requests. Full agent conversations and every agent-specific image-attachment implementation are not claimed as tested. Image upload plus path insertion remains distinct from conditional native OS clipboard plus Ctrl+V; neither sends Enter automatically. A headless host does not acquire an OS clipboard by connecting a client.

Closing a view preserves its shell. Explicit termination ends its POSIX-session jobs; deliberately daemonized processes which create a separate OS session are outside that boundary. Ordinary shells cannot survive a host reboot or daemon restart; tmux remains optional for that separate persistence requirement.
