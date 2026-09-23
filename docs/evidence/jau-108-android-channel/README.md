# Android update channel trial (JAU-108, 2026-09-23)

Emulator `jaunt-validation` (Android 14, API 34), published APKs only, channel
`moukrea_107` candidate 2 (`android-v0.1.0-beta.34.ch.moukrea.107.2`, versionCode 34003).

From production android 35 (versionCode 35000), older candidate refused before download:
- `06-switch-result.png`: Settings → jaunt → Change channel.
- `10-channel-list.png`, `11-menu-selected.png`, `12-menu-switch-result.png`: Settings → Update channel → Switch everything (JAU-99), list read from `ch/index.json`.

From production android 34 (versionCode 34), switch to the candidate:
- `15-prod34-switch.png`: first install permission prompt.
- `17-os-installer.png`, `18-installed.png`: Android installer; installed version 0.1.0-beta.34.ch.moukrea.107.2 (34003).

After closing PR #107 (channel removed from the public Page):
- `20-channel-removed.png`: Check for updates reports the missing channel and offers main.
- `21-return-main-installer.png`: Return to main installs production android 35 (35000).
