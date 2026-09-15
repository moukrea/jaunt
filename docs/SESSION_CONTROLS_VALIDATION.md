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

The Electron test harness disables its sandbox in isolation; this is not a production launcher setting. The installed beta.8 Debian package started in Ubuntu 24.04 with renderer Seccomp=2 and NoNewPrivs=1; a new local shell wrote a fresh proof file. The signed APK passed Android emulator tests for actual IME resizing, touch scroll, rotation and notification contents/target selection. The first emulator attempt encountered an external UIAutomator process exit 137; rerunning the unchanged APK and test passed. The installer passed all 9 checks, including checksum rejection, noneditable wheel import, active-shell protection and explicitly authorized restart with preserved identity. Release links will be recorded after publication. No physical-phone claim is made. The protocol remains independently unaudited.

An installation test exposed an additional defect: the old installer called `service stop` even with `jaunt_NO_SERVICE=1`, stopping the maintainer’s real local service. The service was restarted; ordinary PTYs cannot be recovered after a daemon stop. The installer now respects no-service mode during shutdown too. The fixture shadows both systemctl and launchctl and asserts that neither is invoked. This incident is not counted as successful isolation.

CI also reproduced a layout-save race on immediate reload after splitting. Session selection now persists the layout before rendering or waiting for terminal attachment. The immediate-reload assertion remains in the shared-workspace test.

## Visible operations and desktop updates

The activity strip retains upload progress and the actual final outcome: verified file/path insertion without Enter, or host clipboard completion plus Ctrl+V delivery. It does not claim recognition as a Claude Code/Codex attachment. It also follows host update states through checking, downloading, verifying, installation, explicit failure and deferral for active shells. Operation IDs prevent an old result from being displayed as a newly requested update's completion.

The desktop updater checks the published channel on startup and every 15 minutes, downloads only the matching project-owned release asset, and verifies SHA-256 both after download and before installation. Automatic installation runs when the desktop app closes. Settings provides an automatic-update toggle, manual check, visible progress and Install and reopen. Linux system packages and protected macOS application locations may require OS authorization. The detached installer does not call the host CLI or a service manager; terminal sessions belong to the separate host process.

Node tests cover version/asset selection, progress phases, current-version results, checksum rejection, revalidation before installation, and real archive extraction/application replacement in an isolated home while an unrelated process and saved identity data remain intact. The shared Electron test also uploads an image through the local bridge and verifies the persistent completion indicator. Android now displays an explicit check dialog and determinate download progress when a content length is available.

CI additionally encountered a generated base64url device ID beginning with a hyphen. The browser revocation test now passes `--` before the positional ID, as the desktop test already did; the revocation and session-preservation assertions remain unchanged.
