# Updates without losing sessions or identities

## Host

The public installer configures automatic updates by default. The host checks the release selected by the published Page after startup and every 15 minutes. This keeps it on the owner's validated deployment channel. A source checkout has no automatic installation authority; it must first be installed through the public installer.

A new wheel is downloaded over HTTPS and verified against its release manifest. The installer is read from that verified wheel. If ordinary shells or file transfers are still active, the update is staged and deferred. It is retried automatically after they finish. The installer checks again immediately before shutdown and atomically stops accepting new sessions, so a shell created during the download is also protected. Automatic mode never inherits `jaunt_ALLOW_RESTART` or developer download overrides.

Settings shows the update state and allows automatic updates to be disabled. “Check for updates” preserves running ordinary shells. “Update and restart” requires a separate, explicit confirmation that it can close ordinary shells. The equivalent local command is `jaunt update --allow-restart`; `jaunt update` alone never grants that permission.

The detached updater survives the daemon's normal restart, uses a private lock to prevent overlapping automatic updates, retains the old runtime until the verified replacement is ready, and preserves host identity/device records. Private `installation.json`, `update-status.json`, `update.log` and staged wheels remain in the host state directory and are never release assets. Failed checks are retried; they do not revoke a device or silently erase shells.

Hosts running an older version without the updater need one normal public-installer upgrade to receive this feature. That bootstrap must also preserve active shells unless explicit restart permission is given.

## Android

The APK checks public Android releases automatically, with a manual check in Settings. It verifies downloaded bytes, package identity, a strictly newer version and the same signing certificate before opening Android's installer. App data and pairing are retained during an update. Android requires user confirmation for APK installation and may ask once for permission to install updates from jaunt. This is an OS boundary, not a missing cloud service or end-user account.

See [Android details and validation](ANDROID.md). Update checks, signature checks and functional tests do not constitute an independent security audit.

## Desktop application

The desktop GUI has its own release version and updater, separate from the host/CLI. It checks the published channel shortly after startup and every 15 minutes, selects the Linux/macOS package for the current CPU, and verifies SHA-256 after downloading and again before installation. Settings provides a manual check and an automatic-update toggle.

A visible activity row follows checking, downloading, verification, readiness and errors. **Install and reopen** applies a verified package and reopens the same application profile. With automatic updates enabled, closing the app also applies a ready update. The detached GUI installer never stops the host service or terminates its shells. A system `.deb`/`.rpm` installation or protected macOS application location may require OS authorization. macOS builds remain unsigned and unnotarized.

An installation result is retained in the private desktop profile. Failure is displayed on the next launch; it is not immediately hidden by the startup check. Older desktop builds need one installation of a release that includes this updater, using the public package or `jaunt gui --install-only`.

## Visible progress

Web and desktop image transfers retain their actual result: verified upload and quoted path insertion without Enter, or host clipboard completion plus Ctrl+V delivery. They do not claim that a CLI recognized an attachment. Host checks show completion, failure or explicit deferral for active work. Android uses native progress dialogs for checks and APK downloads, followed by the OS installer confirmation.
