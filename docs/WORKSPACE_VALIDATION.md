# Workspace validation — 2026-09-15

This report records observations, not a certification. The custom protocol remains independently unaudited. Public release checks are recorded separately from the following candidate observations.

## Local observations

| Command / environment | Observed result |
|---|---|
| `.venv/bin/python -m pytest -q` | 61 passed, including a real shell/background job that ignores graceful termination, surviving jobs after shell exit, shared geometry ownership, split OSC parsing, encryption/replay, and safe updates |
| `npm test` | 21 passed, including split-tree retention, themes, cryptography, input pacing/order and disconnect-without-input-replay |
| `npm run test:relay` | Real workerd/Miniflare WebSocket upgrade, Durable Object registration, routing and hibernation ping passed |
| `npm run prepare-web` | Bundles pinned xterm/fit and jsQR locally, preserves their licenses, copies installer, regenerates service-worker inventory |
| `python scripts/check_project.py` | Local imports, resource paths and syntax passed |
| `python scripts/build_release.py` | A real non-editable host wheel, manifest and SHA256SUMS built successfully |
| `python tests/browser_e2e.py` | 23 scenarios passed: real PTY commands and 512-character bursts, independent clients, network recovery, exact-byte transfers, image/path/headless behavior, vault locking and revocation |
| `DISPLAY=:179 python tests/shared_workspace_e2e.py` | Actual Electron process and independent browser share one PTY; passive resize does not steal size; close/reopen retains shell; terminate closes all views; split tabs survive reload and flatten on mobile |
| `python tests/terminal_render_e2e.py` | Long-output wheel scroll and return to latest, final row/column bounds, native text selection control, persisted themes, synchronized-output fixture; installed Claude Code/Codex startup screens in isolated, unauthenticated profiles |
| Android Gradle debug build/unit tests | Build and native unit tests passed |
| `python tests/android_workspace_e2e.py` | Android 14 emulator: installed APK → project-owned public relay → isolated real host → proven command; actual screen tap opens IME and shrinks viewport; status-bar bounds, rotation and screen-off OS notification from a terminal BEL passed |
| Installed `.deb` in Ubuntu 24.04.5 VM | Native app opened, non-editable candidate wheel executed a proven local PTY command, renderer had Seccomp=2 and NoNewPrivs=1, and no sandbox override was present |
| `npm audit` | Zero reported vulnerabilities in the resolved dependency tree |

The local toolchain included Python 3.14.2, Node 25.5.0, npm 11.8.0, Java 17, Gradle 9.5.0, Electron 44.3.0, xterm 6.0.0, FitAddon 0.11.0, and jsQR 1.4.0. CI uses Node 22 and its configured Python/Linux/macOS matrix. The actual installed CLI startup checks used Claude Code 2.1.272 and codex-cli 0.154.0; they did not submit model requests or inspect user conversations/credentials.

Version references were checked against [Electron's official release record](https://releases.electronjs.org/release/v44.3.0) and [xterm's release notes](https://github.com/xtermjs/xterm.js/releases/tag/6.0.0). xterm 6 includes synchronized output support. npm's audit does not replace a Chromium/Electron security review or audit the custom protocol.

## Findings corrected during validation

- FitAddon measured a padded parent, allocating rows/columns outside the actual display area. A separate unpadded mount now provides the measured area; tests check both visible boundaries.
- The Android implementation padded WebView itself instead of its outer layout. The outer frame now consumes system/cutout/IME insets, and the shared UI receives the keyboard state.
- The original Android icon was an unrelated terminal drawing. Android now ships the exact supplied PNG; the browser/favicon/notification/desktop references use the same artwork.
- The supplied terminal bundle lacked exact build provenance. It is now rebuilt from pinned npm dependencies and both upstream licenses.
- Closing only a view and killing the underlying shell were conflated. They now have distinct UI actions and tests.
- Desktop package permissions inherited a private build umask, making the installed directory inaccessible to ordinary users. The packaging hook now normalizes application directories and executable/data permissions. Packaged sandbox validation is tracked separately from source-mode renderer tests. Explicit ALSA/GBM/DRM dependencies were also added after installation in the clean Ubuntu VM exposed a missing library.

CI additionally caught macOS Bash 3.2 compatibility in the environment-alias bootstrap and an old-wheel/new-installer state-directory mismatch. The compatibility bootstrap now runs before importing an old wheel, including subsequent CLI invocations. The real Fedora confined-curl test passes with the public beta.5 wheel and candidate installer.

The source-mode headless Electron test uses a test-only sandbox override in an isolated X server. The separate installed-package check passed without that override on the Ubuntu VM. Production main/preload code never disables the sandbox.

## Remaining validation boundaries

No physical Android handset was available. Real handset camera QR capture, gallery variations, gesture-navigation OEM behavior, physical rotation, Wi-Fi/mobile handover, and deep-idle notification delivery remain unvalidated. Emulator IME/system-bar/screen-off checks do not replace those tests.

Actual CLI startup and a synchronized-output fixture are tested; a complete authenticated model conversation, every CLI release's redraw behavior, and every agent-specific image-attachment implementation are not claimed as validated. Native clipboard transport and the explicit headless upload/path distinction remain separate from an agent's attachment recognition.

macOS desktop execution, OS trust prompts, ARM hardware, desktop notification presentation across desktop environments, and browser push-provider delivery require platform-specific evidence. Build results alone are not runtime validation. The browser fallback remains available, and no unconditional delivery or perfect behavior on every terminal/phone is promised.
