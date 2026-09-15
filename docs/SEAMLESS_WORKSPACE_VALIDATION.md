# Workspace and runtime update validation — 2026-09-15

Candidate versions: host `0.1.0b11`, desktop `0.1.0-beta.10`, Android `0.1.0-beta.8` / version code 8. Publication verification is pending while this branch is under test. No production host or ordinary user shell was stopped for these tests.

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

## Remaining validation boundaries

Public release installation, installed application updates, the published Page and the final signed APK are checked after publication; their observations will be appended here. Physical Android camera, gallery, lock-screen push and Wi-Fi/mobile handover have not been tested on an authorized physical phone. Emulator observations are reported separately. A launcher or browser can control icon masking and approval of installed PWA name/icon changes.

Hosts without runtime handoff need one protected migration. Existing ordinary shells on those versions cannot be retroactively preserved by the new code. Compatible updates retain processes; an explicit daemon stop, crash or machine reboot is not made survivable by this mechanism.

The encryption protocol has **not received an independent security audit**. Functional tests do not change that status.
