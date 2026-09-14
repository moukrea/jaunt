# Updates without losing sessions or identities

## Host

The public installer configures automatic updates by default. The host checks the release selected by the published Page after startup and every 15 minutes. This keeps it on the owner's validated deployment channel. A source checkout has no automatic installation authority; it must first be installed through the public installer.

A new wheel is downloaded over HTTPS and verified against its release manifest. The installer is read from that verified wheel. If ordinary shells or file transfers are still active, the update is staged and deferred. It is retried automatically after they finish. The installer checks again immediately before shutdown and atomically stops accepting new sessions, so a shell created during the download is also protected. Automatic mode never inherits `JAUNT_ALLOW_RESTART` or developer download overrides.

Settings shows the update state and allows automatic updates to be disabled. “Check for updates” preserves running ordinary shells. “Update and restart” requires a separate, explicit confirmation that it can close ordinary shells. The equivalent local command is `jaunt update --allow-restart`; `jaunt update` alone never grants that permission.

The detached updater survives the daemon's normal restart, uses a private lock to prevent overlapping automatic updates, retains the old runtime until the verified replacement is ready, and preserves host identity/device records. Private `installation.json`, `update-status.json`, `update.log` and staged wheels remain in the host state directory and are never release assets. Failed checks are retried; they do not revoke a device or silently erase shells.

Hosts running an older version without the updater need one normal public-installer upgrade to receive this feature. That bootstrap must also preserve active shells unless explicit restart permission is given.

## Android

The APK checks public Android releases automatically, with a manual check in Settings. It verifies downloaded bytes, package identity, a strictly newer version and the same signing certificate before opening Android's installer. App data and pairing are retained during an update. Android requires user confirmation for APK installation and may ask once for permission to install updates from Jaunt. This is an OS boundary, not a missing cloud service or end-user account.

See [Android details and validation](ANDROID.md). Update checks, signature checks and functional tests do not constitute an independent security audit.
