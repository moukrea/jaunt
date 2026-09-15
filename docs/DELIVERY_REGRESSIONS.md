# Delivery regression fixes — September 15, 2026

This report follows user-reported failures after the previous release. Previous passing tests did not establish correct user shell startup, usable touch scrolling, or the default Ubuntu archive launch path.

## Reproduced causes and changes

- Bash login profiles can omit `.bashrc`. The service-launched shell therefore missed interactive PATH additions and prompt colors. New sessions load login environment and then the interactive bash configuration; missing SHELL uses the account shell.
- Unattended host updates skip GUI installation and system-authorization prompts. Interactive graphical installation and explicit `jaunt gui` still install the desktop app.
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

Installed candidate `.deb` plus non-editable 0.1.0b9 wheel passed on Ubuntu 24.04: real PTY execution, Seccomp=2/NoNewPrivs=1 renderer, decoded in-app logos, locally available Lucide and readable standard launcher icons. The candidate desktop also authenticated through the public relay and proved a remote command. `scripts/check_desktop_package.mjs` now checks these packaged resource paths and Linux metadata in CI.

A clean tracked-source export passed gitleaks. Scanning the binary ASAR produced two reviewed false positives in vendored JavaScript identifiers (`FourKeyMap` and `SequencerByKey`); no credential was present.

## Published delivery

PR [20](https://github.com/moukrea/jaunt/pull/20) merged as `cb0cb99910978e0874cf00235a046f47ff297d72` after all checks passed. Backup `backup/pre-delivery-fixes-20260915` preserves the previous state. No force-push or history deletion was used.

- Public page: https://moukrea.github.io/jaunt/
- Host: [v0.1.0-beta.9](https://github.com/moukrea/jaunt/releases/tag/v0.1.0-beta.9), exactly three assets. All checksums, archive paths and all 16 Python/installer source files were verified against the delivered source.
- Desktop: [desktop-v0.1.0-beta.7](https://github.com/moukrea/jaunt/releases/tag/desktop-v0.1.0-beta.7), ten Linux/macOS packages plus SHA256SUMS. All ten downloads matched the checksums. Installed public Ubuntu package: real local and remote shell execution, shared browser/desktop session, termination from either side, decoded logo, readable standard icons, and sandboxed renderer.
- Android: [android-v0.1.0-beta.5](https://github.com/moukrea/jaunt/releases/tag/android-v0.1.0-beta.5), versionCode 5. The public APK's 27 bundled web resources matched the source; the host installer is intentionally excluded by the Android build. Its checksum and existing signing certificate were verified. Installing it over the public beta.4 APK retained pairing and reconnected. Native UI automation on the release APK then created a shell, proved a command result on the host, and terminated the session. No debuggable release build was used.

The exact command extracted from the public page passed in a fresh Fedora 43 container and a fresh account in the Ubuntu 24.04 VM:

```sh
bash -o pipefail -c 'curl -qfL --connect-timeout 10 --max-time 120 https://moukrea.github.io/jaunt/install.sh | bash'
```

The interactive graphical Ubuntu installation automatically selected the public system desktop package. The host service was enabled, running and connected; a valid QR SVG was generated without printing or publishing its secret. Unattended host updates skip GUI setup so they cannot trigger desktop authorization prompts.

The public Page → Cloudflare → public wheel acceptance passed 12 checks: pairing, exact 512-character input, multiple shells, file byte comparison, image/path/no-Enter fallback, reload, real VM IPv4/IPv6 network interruption with the same session/PID, refusal to destroy active shells, explicitly authorized restart with retained identities, and revocation. See [the observed results](evidence/public-report-beta9.json).

This maintainer PC was also updated through the public installer to host 0.1.0b9 with its existing host/device keys preserved. A temporary service-created shell found and ran `codex-cli 0.154.0` through PATH and produced a colored prompt; only that temporary session was terminated. The public desktop beta.7 was installed and remained running on Ubuntu.

CI evidence: [PR checks](https://github.com/moukrea/jaunt/actions/runs/34960446113), [desktop packages](https://github.com/moukrea/jaunt/actions/runs/34960446067), [Android](https://github.com/moukrea/jaunt/actions/runs/34960446100). Publication: [host](https://github.com/moukrea/jaunt/actions/runs/34960988005), [desktop](https://github.com/moukrea/jaunt/actions/runs/34961170116), [Android](https://github.com/moukrea/jaunt/actions/runs/34961169894), [Pages](https://github.com/moukrea/jaunt/actions/runs/34961981670). The public page's 28 checked resources matched the delivered files under `/jaunt/`. The existing relay's health and real authenticated WebSockets passed; no relay URL or third-party relay was invented.

![Public desktop package with the supplied logo and Lucide interface icons](evidence/desktop-release-beta7.png)

## Remaining limits

Physical Android hardware, vendor-specific keyboards/battery policies, real Wi-Fi/mobile switching, macOS runtime and ARM runtime are not validated by these tests. Android emulator tests are identified as such. Authenticated Claude Code/Codex conversations are not covered by isolated startup tests. **The protocol remains independently unaudited.**
