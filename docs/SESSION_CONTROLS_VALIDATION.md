# Session controls validation

The session manager previously nested full-width file-menu buttons inside a non-wrapping horizontal row. Actions overflowed the dialog; rename was absent from the list. It now uses responsive session cards and explicit Open, Rename, Close view and Terminate actions.

Ordinary shell creation no longer opens a naming dialog. The folder action provides directory navigation with an optional name. New hosts inherit the running source shell's current directory; older hosts use the last known initial directory. Desktop split controls select the orientation directly and show an inline new/existing-session chooser. Each tiled pane can move into an independent tab without creating or terminating a PTY.

Observed locally on 2026-09-15:

- Python 3.14.2: `python -m pytest -q` — 65 passed, including harmless late stream frames after termination, actual PTY directory inheritance after `cd`, explicit directory override and noncolliding automatic names.
- Node 25.5.0: `npm test` — 21 passed; `npm run test:relay` — 2 real Miniflare/workerd tests passed.
- `python tests/shared_workspace_e2e.py` in Electron with an isolated fixture host — passed. Exercises local/remote shared PTYs, both split orientations, existing-session selection, moving a pane to a tab, reload persistence, mobile flattening, session-action bounds at 390 and 1300 pixels, local rename/close/reopen/terminate, automatic creation with actual directory inheritance, and directory browsing. File contents prove commands executed.
- `python tests/browser_e2e.py` — 23 scenarios passed.
- `python tests/terminal_render_e2e.py` — scroll/keyboard geometry and actual isolated Claude Code/Codex startup passed.
- The built Linux desktop package passed the same expanded session-control E2E. `node scripts/check_desktop_package.mjs` verified bundled imports, artwork and launcher permissions.
- `python scripts/check_project.py` and `python scripts/build_release.py` passed during development.

The Electron test harness disables its sandbox in isolation; this is not a production launcher setting. The installed beta.8 Debian package started in Ubuntu 24.04 with renderer Seccomp=2 and NoNewPrivs=1; a new local shell wrote a fresh proof file. The signed APK passed Android emulator tests for actual IME resizing, touch scroll, rotation and notification contents/target selection. The first emulator attempt encountered an external UIAutomator process exit 137; rerunning the unchanged APK and test passed. The installer passed all 8 checks, including checksum rejection, noneditable wheel import, active-shell protection and explicitly authorized restart with preserved identity. Release links will be recorded after publication. No physical-phone claim is made. The protocol remains independently unaudited.
