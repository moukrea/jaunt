# Workspace and runtime update validation — 2026-09-15

Published versions: host `0.1.0b11`, desktop `0.1.0-beta.10`, Android `0.1.0-beta.8` / version code 8. No production host or ordinary user shell was stopped for these tests.

## Observed results

| Command | Observed result |
| --- | --- |
| `.venv/bin/python -m pytest -q` | 77 tests passed, including real foreground PTY program transitions. |
| `npm test` | 30 tests passed. |
| `npm run test:relay` | Both actual Miniflare/workerd WebSocket scenarios passed. |
| `.venv/bin/python scripts/check_project.py` | Python/JavaScript syntax, local imports, page resources and installer syntax passed. |
| `.venv/bin/python tests/browser_e2e.py` | 23 scenarios passed with real PTYs, authentication, reconnects, byte comparisons, clipboard fallback and revocation. |
| `jaunt_E2E_RELAY=workerd .venv/bin/python tests/browser_e2e.py` | The same 23 scenarios passed through the actual Worker implementation. |
| `.venv/bin/python tests/terminal_render_e2e.py` | Real isolated `claude` and `codex` startup, their Meteor tab/pane icons, terminal dimensions, selection and scroll-to-latest passed. No authenticated model invocation. |
| `DISPLAY=:179 .venv/bin/python tests/shared_workspace_e2e.py` | Electron and browser shared one PTY, ownership of dimensions, session controls and persistent split groups passed. |
| `.venv/bin/python tests/feedback_e2e.py` | Interrupted handshakes/RPCs, bounded contextual feedback, progress controls and switching between real hosts passed. |
| `.venv/bin/python tests/workspace_usability_e2e.py` | Stable tab positions, pointer reorder, double-click rename, no long-press rename, saved sidebar state, responsive Settings and retained mobile scroll anchor passed. |
| `.venv/bin/python tests/i18n_e2e.py` | Six browser locales, explicit saved overrides and six CLI help languages passed; command arguments and literal user data remained unchanged. |
| `.venv/bin/python tests/handoff_e2e.py` | Actual runtime `exec` retained daemon/PTY PIDs, environment, cwd and browser command execution. The inherited shell could still be terminated. |
| `.venv/bin/python scripts/build_release.py` then `.venv/bin/python tests/installer_e2e.py` | An installed wheel replaced its runtime while keeping a real shell alive. Identity and device records remained intact; no account service manager was touched. |
| `jaunt_LEGACY_RELEASE_DIR=<verified public beta.10 assets> .venv/bin/python tests/installer_e2e.py` | The real public legacy host refused migration with an active shell. Explicit restart of this isolated fixture closed it and preserved identity/devices. |
| `DISPLAY=:179 .venv/bin/python tests/client_only_e2e.py` | Actual Electron client-only mode made no local CLI calls; paired through the deployed owner relay and executed a command on an isolated remote host. Native language override and the `jaunt` window title passed. |
| `npm audit --omit=optional` | No vulnerabilities reported. |
| `.venv/bin/python -m pip_audit` | No known dependency vulnerabilities. The locally installed project itself is not a PyPI-auditable distribution. |
| Android Gradle release/debug builds, unit tests and lint | Passed after replacing an API-33-only stream helper with a read loop compatible with minimum API 26. Deprecation and other non-fatal lint warnings remain. |

The native client-only scenario uses the owner’s actual WSS relay because an insecure loopback relay must not be accepted from a packaged application origin. Its host state and shell are temporary test fixtures. No pairing material is included in this report.

## Public release verification

Published Page: https://moukrea.github.io/jaunt/. Host release: [v0.1.0-beta.11](https://github.com/moukrea/jaunt/releases/tag/v0.1.0-beta.11); desktop: [desktop-v0.1.0-beta.10](https://github.com/moukrea/jaunt/releases/tag/desktop-v0.1.0-beta.10); Android: [android-v0.1.0-beta.8](https://github.com/moukrea/jaunt/releases/tag/android-v0.1.0-beta.8).

Observed using Python 3.14.2, Node 25.5.0, npm 11.8.0, Electron 44.3.0, an isolated Ubuntu 24.04 VM and an Android API 34 emulator. Android builds used JDK 17. Native package administration was preauthorized inside the disposable VM; interactive administrator password entry was not tested.

- Downloaded all three public host assets and verified SHA-256; installed the release wheel with the official public installer, not an editable source checkout. The user service was enabled and running, and pairing produced a QR. Verified published Linux x64 desktop archive and Debian package against release checksums, packaged imports, original icons, six locale catalogs and local vendor licenses. Verified the public APK checksum, signing certificate, version code 8, embedded host release 11 and bundled resources. No private host state or pairing material was included in the inspected artifacts.
- The public Page served 41 checked resources byte-for-byte beneath `/jaunt/`. Owner Worker health and actual encrypted WebSockets passed. Public Page pairing, a proven shell command, switching between two sessions, image/path insertion without Enter, multichunk text/binary transfers with exact byte comparisons, reconnection after VM network interruption, reload with remembered identity and revocation all passed. Clipboard UI matched the actual X11 capability of the fixture.
- Replaying the official installer on public host 11 retained the daemon PID, both shell PIDs, identity and devices, then executed another command through the reconnected Page. This was a compatible **same-version runtime replacement**, not a claimed future-version upgrade. The older public host 10 correctly refused replacement with ordinary shells running. An explicitly authorized restart of that disposable legacy fixture migrated to 11 and preserved identity.
- The exact client-only command copied from the public Page installed desktop 10 in a fresh VM account without a CLI, local host identity or host service. The installed GUI had the title `jaunt`, no local-host controls, connected through the owner WSS relay and produced the exact host-side result `PUBLIC_CLIENT_ONLY`.
- The installed public desktop 9 discovered desktop 10, downloaded and verified it, installed the OS package and reopened the same profile. The host service and all shell PIDs remained unchanged; the active shell executed commands before and after the update. The resulting OS package version was `0.1.0~beta.10`.
- The public Android 7 app installed public Android 8 through its native update flow in the emulator. Version code 8 and reconnection with the same pairing were verified. Repeated explicit checks completed with a single visible up-to-date dialog. A test harness wait for the transient package-installer completion screen did not complete; installed version, reconnect and final update state were verified separately. No physical phone is claimed.
- Installed PWA launch used `jaunt (PWA)` and opened the workspace directly. Native Ubuntu startup, responsive Settings, shared sessions and French/system language override passed. The signed Android build executed a real remote shell command and its native French update check completed visibly.

The public installation and update harnesses used only temporary fixture accounts, device keys and terminal files. Private installation logs and QR values are not published. Repository CI and release workflows passed before publication. The hero-only follow-up was also checked at 1440, 1024 and 390 pixels, with all three synchronized shell/agent previews and the same bundled Meteor icons as live sessions.

## Remaining validation boundaries

Physical Android camera, gallery, lock-screen push and Wi-Fi/mobile handover have not been tested on an authorized physical phone. Emulator observations are reported separately. A launcher or browser can control icon masking and approval of installed PWA name/icon changes.

Hosts without runtime handoff need one protected migration. Existing ordinary shells on those versions cannot be retroactively preserved by the new code. Compatible updates retain processes; an explicit daemon stop, crash or machine reboot is not made survivable by this mechanism.

The encryption protocol has **not received an independent security audit**. Functional tests do not change that status.
