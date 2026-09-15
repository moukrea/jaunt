# Session controls validation

The session manager previously nested full-width file-menu buttons inside a non-wrapping horizontal row. Actions overflowed the dialog; rename was absent from the list. It now uses responsive session cards and explicit Open, Rename, Close view and Terminate actions.

Ordinary shell creation no longer opens a naming dialog. The folder action provides directory navigation with an optional name. New hosts inherit the running source shell's current directory; older hosts use the last known initial directory. Desktop split controls select the orientation directly and show an inline new/existing-session chooser. Each tiled pane can move into an independent tab without creating or terminating a PTY.

Observed locally on 2026-09-15:

- Python 3.14.2: `python -m pytest -q` — 67 passed, including harmless late stream frames after termination, actual PTY directory inheritance after `cd`, explicit directory override and noncolliding automatic names.
- Node 25.5.0: `npm test` — 27 passed; `npm run test:relay` — 2 real Miniflare/workerd tests passed.
- `python tests/shared_workspace_e2e.py` in Electron with an isolated fixture host — passed. Exercises local/remote shared PTYs, both split orientations, existing-session selection, moving a pane to a tab, reload persistence, mobile flattening, session-action bounds at 390 and 1300 pixels, local rename/close/reopen/terminate, automatic creation with actual directory inheritance, and directory browsing. File contents prove commands executed.
- `python tests/browser_e2e.py` — 23 scenarios passed.
- `python tests/terminal_render_e2e.py` — scroll/keyboard geometry and actual isolated Claude Code/Codex startup passed.
- The built Linux desktop package passed the same expanded session-control E2E. `node scripts/check_desktop_package.mjs` verified bundled imports, artwork and launcher permissions.
- `python scripts/check_project.py` and `python scripts/build_release.py` passed during development.

The Electron test harness disables its sandbox in isolation; this is not a production launcher setting. The installed beta.8 Debian package started in Ubuntu 24.04 with renderer Seccomp=2 and NoNewPrivs=1; a new local shell wrote a fresh proof file. The signed APK passed Android emulator tests for actual IME resizing, touch scroll, rotation and notification contents/target selection. The first emulator attempt encountered an external UIAutomator process exit 137; rerunning the unchanged APK and test passed. The installer passed all 9 checks, including checksum rejection, noneditable wheel import, active-shell protection and explicitly authorized restart with preserved identity. The public delivery observations are recorded below. No physical-phone claim is made. The protocol remains independently unaudited.

An installation test exposed an additional defect: the old installer called `service stop` even with `jaunt_NO_SERVICE=1`, stopping the maintainer’s real local service. The service was restarted; ordinary PTYs cannot be recovered after a daemon stop. The installer now respects no-service mode during shutdown too. The fixture shadows both systemctl and launchctl and asserts that neither is invoked. This incident is not counted as successful isolation.

CI also reproduced a layout-save race on immediate reload after splitting. Session selection now persists the layout before rendering or waiting for terminal attachment. The immediate-reload assertion remains in the shared-workspace test.

## Visible operations and desktop updates

The activity strip retains upload progress and the actual final outcome: verified file/path insertion without Enter, or host clipboard completion plus Ctrl+V delivery. It does not claim recognition as a Claude Code/Codex attachment. It also follows host update states through checking, downloading, verifying, installation, explicit failure and deferral for active shells. Operation IDs prevent an old result from being displayed as a newly requested update's completion.

The desktop updater checks the published channel on startup and every 15 minutes, downloads only the matching project-owned release asset, and verifies SHA-256 both after download and before installation. Automatic installation runs when the desktop app closes. Settings provides an automatic-update toggle, manual check, visible progress and Install and reopen. Linux system packages and protected macOS application locations may require OS authorization. The detached installer does not call the host CLI or a service manager; terminal sessions belong to the separate host process.

Node tests cover version/asset selection, progress phases, current-version results, checksum rejection, revalidation before installation, and real archive extraction/application replacement in an isolated home while an unrelated process and saved identity data remain intact. The shared Electron test also uploads an image through the local bridge and verifies the persistent completion indicator. Android now displays an explicit check dialog and determinate download progress when a content length is available.

CI additionally encountered a generated base64url device ID beginning with a hyphen. The browser revocation test now passes `--` before the positional ID, as the desktop test already did; the revocation and session-preservation assertions remain unchanged.

## Published delivery — 2026-09-15

The release and public-install results below were recorded after publication. They supplement the local and CI observations above.

- PR: https://github.com/moukrea/jaunt/pull/22
- Page: https://moukrea.github.io/jaunt/
- Host: v0.1.0-beta.10 (CLI 0.1.0b10)
- Desktop: desktop-v0.1.0-beta.8
- Android: android-v0.1.0-beta.6 (versionCode 6)

A private packaged updater candidate downloaded and verified the existing public desktop beta.7, installed its Debian package and reopened the same profile in an Ubuntu 24.04 VM. Host and PTY PIDs remained unchanged, and commands executed before and after the update. Debug instrumentation required restarting only the fixture GUI. This candidate is not a claim that the old public beta.6 included an updater. The first minimal-VM attempt revealed a missing pkexec dependency; the delivered Debian/RPM packages now declare the OS authorization dependency. A concurrent fixture package installation also produced an explicit package-manager lock error; a subsequent retry succeeded.

The complete README is in English and now describes installation, the separate host/desktop/Android/web update mechanisms, session creation and directory inheritance, both split orientations, image delivery outcomes, notification behavior, and validation limits. All local documentation links were checked. npm audit reported zero vulnerabilities; pip-audit reported no known dependency vulnerabilities, with the editable project itself excluded from the external package catalogue. This is not a protocol audit.

The merged implementation is commit `937fb52ea56297326ce3fd090cb66802a76a063d`. Required CI, Android validation and both Linux/macOS distribution builds passed before merge. The final Node registry version check found only a newer Miniflare alpha; the tested stable Miniflare 4.20260730.0 was retained.

The three public host assets passed manifest/SHA-256 validation and a gitleaks scan of the extracted wheel. A real public beta.9→beta.10 installation in the Ubuntu VM retained host and device identity. Before Pages promotion this test explicitly selected the already published host tag. The public APK beta.5→beta.6 upgrade retained the existing pairing and reconnected over the owner’s real Worker. Native UI automation in the release APK created a shell, executed a command proven by a file, and terminated the fixture session. The APK was not debuggable, and its public checksum and pinned signing certificate matched.

All ten public desktop assets matched their published SHA-256 catalogue. Both Linux and macOS archives, for x64 and ARM64, contained the expected updater, visible activity UI, local jsQR and Lucide resources, the unchanged original logo, and current host/Android/desktop release links. Forbidden runtime-state paths were absent.

The exact installation command from the public Page subsequently passed in a fresh Ubuntu user account (enabled active user service and QR output) and a fresh Fedora 43 container. The deployed Page served all 29 checked resources beneath `/jaunt/` with byte equality. The real public recipe proved pairing, a completed host update check, arbitrary shell execution, switching tabs, multichunk upload/download byte equality, image/path insertion without Enter, reload and an actual guest network interruption returning to the same shell PID, protected upgrade refusal, explicitly authorized fixture restart with preserved identity, and revocation.

The public Android beta.5 application also performed its own beta.6 update through channel discovery, HTTPS download, checksum/signature verification, the Android permission screen and the OS package installer. Existing pairing survived. Its subsequent explicit check displayed an up-to-date result. Native UI automation needed to handle Android's uppercase button labels, checkable permission view, and the installer’s Open button; these were test navigation corrections, not application result overrides.

## Follow-up: consistent asynchronous feedback

The follow-up removes connection-error toast cascades, keeps dialog/pairing errors next to their action, and bounds short confirmation toasts. Activity controls keep stable DOM nodes while progress changes; completed results collapse into accessible history and late progress cannot overwrite completion. Downloads, service setup, network waits, cancellation and available-update actions use the same activity area. Hidden transfer history and Settings are no longer rebuilt on every download chunk.

Late asynchronous key generation and decrypted welcome responses are rejected when a replacement connection has begun. Transport interruptions retry; failed host verification still stops the connection. The native desktop bridge ignores cancelled starts and retries local connection failures. Android coalesces simultaneous checks/downloads and replaces its result dialog instead of stacking results.

Observed locally: 29 Node tests passed, including two stale-connection regressions. The dedicated feedback E2E passed with three real handshake interruptions, five interrupted RPCs, no error-toast cascade, reconnection to the same PTY, contextual errors, stable clickable progress controls, retained compact history and mobile terminal bounds. Browser E2E passed all 23 scenarios; shared Electron and actual isolated Claude Code/Codex terminal-render tests passed. The host/browser fixture now uses its own HOME and XDG data directories, so initial file browsing cannot enumerate personal directories. No physical phone or independent protocol audit is claimed.
