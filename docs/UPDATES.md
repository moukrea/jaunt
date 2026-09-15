# Updates without losing sessions or identities

## Host

The public installer configures automatic updates by default. The host checks the release selected by the published Page after startup and every 15 minutes. This keeps it on the owner's validated deployment channel. A source checkout has no automatic installation authority; it must first be installed through the public installer.

A new wheel is downloaded over HTTPS and verified against its release manifest. The installer is read from that verified wheel. Compatible hosts replace the Python runtime in place with `exec`: the daemon PID, child shell processes and open PTY descriptors remain alive. The bounded replay buffer and terminal geometry pass through an unlinked private file descriptor. Shell environment variables, working directories and running commands remain in their original processes. Clients reconnect using their existing keys. This does not require tmux.

File transfers defer installation until they finish. The installer validates the new runtime before requesting handoff and stops accepting new sessions during the switch. If preparation fails, the old host resumes serving its existing shells. Automatic mode never inherits `jaunt_ALLOW_RESTART` or developer download overrides.

**Migration from older hosts:** releases without runtime handoff cannot preserve their PTYs across a runtime replacement. The installer detects that capability and defers while ordinary shells are active. Ending them still requires explicit approval through **Update and restart** or `jaunt update --allow-restart`. An ordinary `jaunt update` never grants that permission. After this one-time migration, subsequent compatible updates use handoff automatically.

Settings follows the update through its progress and reconnection automatically. Application updates preserve shells; explicitly stopping/restarting the daemon or rebooting the computer still ends ordinary shells. This mechanism is not recovery after a daemon crash or power loss.

The detached updater uses a private lock to prevent overlapping updates and retains the old runtime until the verified replacement is ready. Host identity and device records are preserved. Private `installation.json`, `update-status.json`, `update.log` and staged wheels are never release assets. Failed checks do not revoke devices.

## Android

The APK checks public Android releases automatically, with a manual check in Settings. It verifies downloaded bytes, package identity, a strictly newer version and the same signing certificate before opening Android's installer. App data and pairing are retained during an update. Android requires user confirmation for APK installation and may ask once for permission to install updates from jaunt. This is an OS boundary, not a missing cloud service or end-user account.

See [Android details and validation](ANDROID.md). Update checks, signature checks and functional tests do not constitute an independent security audit.

## Desktop application

The desktop GUI has its own release version and updater, separate from the host/CLI. It checks the published channel shortly after startup and every 15 minutes, selects the Linux/macOS package for the current CPU, and verifies SHA-256 after downloading and again before installation. Settings provides a manual check and an automatic-update toggle.

A visible activity row follows checking, downloading, verification, readiness and errors. **Install and reopen** applies a verified package and reopens the same application profile. With automatic updates enabled, closing the app also applies a ready update. The detached GUI installer never stops the host service or terminates its shells. A system `.deb`/`.rpm` installation or protected macOS application location may require OS authorization. macOS builds remain unsigned and unnotarized.

An installation result is retained in the private desktop profile. Failure is displayed on the next launch; it is not immediately hidden by the startup check. Older desktop builds need one installation of a release that includes this updater, using the public package or `jaunt gui --install-only`.

## Visible progress

Web and desktop image transfers retain their actual result: verified upload and quoted path insertion without Enter, or host clipboard completion plus Ctrl+V delivery. They do not claim that a CLI recognized an attachment. Host checks show completion, failure or explicit deferral for active work. Android uses native progress dialogs for checks and APK downloads, followed by the OS installer confirmation.
