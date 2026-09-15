# Delivery regression fixes — September 15, 2026

This report follows user-reported failures after the previous release. Previous passing tests did not establish correct user shell startup, usable touch scrolling, or the default Ubuntu archive launch path.

## Reproduced causes and changes

- Bash login profiles can omit `.bashrc`. The service-launched shell therefore missed interactive PATH additions and prompt colors. New sessions load login environment and then the interactive bash configuration; missing SHELL uses the account shell.
- The published desktop archive aborts under Ubuntu 24.04 restricted user namespaces with a sandbox-helper error. The installer now selects the verified system package there, allowing its scoped AppArmor support to be installed without disabling Chromium sandboxing.
- The native logo extraResource excluded its source from the packaged web assets, breaking the in-app logo. The native resource now uses a generated desktop icon, retaining the original in web assets.
- Linux icon packaging used an unindexed 547×547 theme directory. It now includes eight standard sizes derived from the original artwork. Build hooks and explicit icon permissions remove umask-dependent unreadable launcher files.
- UI pictograms now come from pinned Lucide 1.46.0, bundled locally with its ISC license. Android uses an adaptive launcher wrapper around the supplied artwork.
- New-session UI no longer offers tmux. Existing tmux sessions and host compatibility remain intact.
- Android touch swipes did not scroll xterm's virtual viewport. A touch handler provides scrolling and momentum; keyboard resizing retains the reading anchor instead of jumping to the first or last row.
- Program notification text was discarded. OSC 9 messages and OSC 777 title/body now reach native notifications. Notification targets remain pending until their host/session is available. No terminal output is scraped.
- Split view is in the desktop tab bar, with direct creation beside/below, existing-session splits, persisted layout, and mobile tab fallback.

## Observed local validation

- `npm install` / `npm audit`: pinned dependencies and real lockfile; zero known vulnerabilities at the time of this run. Node 25.5.0, npm 11.8.0, Electron 44.3.0, electron-builder 26.15.3.
- `.venv/bin/python -m pytest -q`: 63 passed on Python 3.14.2, including real PTY login-PATH/color-prompt regression and chunked notification-content tests.
- `node --test tests/js.test.mjs tests/relay.test.mjs`: 21 passed.
- `npm run test:relay`: 2 real Miniflare/workerd routing tests passed.
- `npm run prepare-web` and `.venv/bin/python scripts/check_project.py`: passed; local jsQR, xterm, Lucide and licenses.
- `.venv/bin/python scripts/build_release.py`: built a non-editable 0.1.0b9 wheel.
- `.venv/bin/python tests/browser_e2e.py`, also with `jaunt_E2E_RELAY=workerd`: 23 scenarios passed per backend.
- `.venv/bin/python tests/terminal_render_e2e.py`: scrolling, keyboard-height reading anchor, selection and themes passed, plus actual isolated Claude Code and Codex startup. No authenticated model execution is claimed.
- `DISPLAY=:179 .venv/bin/python tests/shared_workspace_e2e.py`: shared local/remote PTY, geometry ownership, detachment/termination and mobile pane fallback passed.
- Signed Android release/debug builds, lint and unit tasks passed. `tests/android_workspace_e2e.py` on Android 14/API 34 emulator passed real touch swipe, actual keyboard anchor, system insets, rotation, screen-off OSC title/body and tapping the notification into the correct session.

Published-artifact and default-installer verification will be recorded after the immutable releases are available. Physical Android hardware, vendor-specific IMEs/battery policies, macOS runtime and ARM runtime are not validated by these tests. The protocol remains independently unaudited.
