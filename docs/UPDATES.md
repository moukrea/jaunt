# Updates without losing sessions or identities

## Publication evidence

Product merges are queued by `auto-release.yml`. Versions are assigned on an
immutable publication commit derived from the CI-validated main source. The
coordinator updates the public channel only after required builds and checksum
verification. A failed publication retains its receipt for retry; a merge alone
does not make a version available. The public configuration's `releaseSource`
identifies the source whose delivery was verified. See [publication and
recovery](DEPLOYMENT.md#automatic-publication-after-a-product-merge).

## Host

The public installer configures automatic updates by default. The host checks the release selected by the published Page after startup and every 15 minutes. This keeps it on the owner's validated deployment channel. A source checkout has no automatic installation authority; it must first be installed through the public installer.

A new wheel is downloaded over HTTPS and verified against its release manifest. The installer is read from that verified wheel. Compatible hosts replace the Python runtime in place with `exec`: the daemon PID, child shell processes and open PTY descriptors remain alive. The bounded replay buffer and terminal geometry pass through an unlinked private file descriptor. Shell environment variables, working directories and running commands remain in their original processes. Clients reconnect using their existing keys. This does not require tmux.

### How a client-driven update proceeds

1. **Check for updates** in Settings sends one `updates.install` request. The daemon starts the detached updater and answers with an operation identifier.
2. The updater writes every state change to the private `update-status.json` (`checking`, `downloading`, `verifying`, `installing` with a human-readable step, then `current`, `installed`, `deferred` or `error`). The daemon watches that file and **pushes** each change to all connected clients as `update.progress`; the client keeps only a slow fallback poll.
3. The installer prepares the new runtime beside the old one (private virtual environment, pip with retries, import check, handoff capability check). Nothing running is touched until that succeeds.
4. Right before replacing the runtime the daemon broadcasts `host.restarting`. Clients show *Updating host · shells are kept* instead of an outage, and the desktop app reconnects its local bridge within a second. The daemon itself waits for in-flight client actions to drain (up to 20 s) instead of failing when one is still running.
5. After the `exec`, the client's welcome carries the final update state and the new host version. The activity row ends with *Update installed · shells were kept*.

The truth of "which version is running" is the daemon's own runtime record, not the installed pointer. Pruning old runtimes keeps the installed pointer, one previous version for rollback, and always the runtime the live daemon executes (a failed handoff can leave it older than both); removing it would make the daemon unable to import anything it had not loaded yet, and `jaunt update` and `jaunt doctor` then say the service must be restarted. If a handoff ever fails, the installer points `current` back at the previous runtime, records nothing and reports the reason; the next check still offers the release instead of claiming the host is up to date. Installer failures surface their own last message (for example a dependency download failure) rather than a bare exit code. Old runtime directories are pruned, keeping the previous one for rollback.

A `deferred` state (a file transfer in progress, or ordinary shells on a legacy host) resumes by itself as soon as the reason disappears; nobody has to click again. Automatic mode never inherits `jaunt_ALLOW_RESTART` or developer download overrides.

**Migration from older hosts:** releases without runtime handoff cannot preserve their PTYs across a runtime replacement. The installer detects that capability and defers while ordinary shells are active. Ending them still requires explicit approval through **Update and restart** or `jaunt update --allow-restart`. An ordinary `jaunt update` never grants that permission. After this one-time migration, subsequent compatible updates use handoff automatically.

Settings follows the update through its progress and reconnection automatically. Application updates preserve shells; explicitly stopping/restarting the daemon or rebooting the computer still ends ordinary shells. This mechanism is not recovery after a daemon crash or power loss.

The detached updater uses a private lock to prevent overlapping updates and retains the old runtime until the verified replacement is ready. Host identity and device records are preserved. Private `installation.json`, `runtime.json`, `update-status.json`, `update.log` and staged wheels are never release assets. Failed checks do not revoke devices.

When the host was started outside its user service (for example by the desktop app before the service existed), `jaunt service install` enables the unit for the next login instead of starting a second daemon next to the running one. `jaunt start` prefers the installed service and waits for a daemon that is mid-handoff rather than spawning a competing process.

`tests/client_update_e2e.py` exercises this whole path against a real installation with a private loopback mirror: an actual newer wheel, pushed progress, the in-place handoff with the same daemon and shell PIDs, a second "up to date" check and a broken release that is refused with its reason while the previous runtime keeps serving.

## Android

The APK checks public Android releases automatically, with a manual check in Settings. It verifies downloaded bytes, package identity, a strictly newer version and the same signing certificate before opening Android's installer. App data and pairing are retained during an update. Android requires user confirmation for APK installation and may ask once for permission to install updates from jaunt. This is an OS boundary, not a missing cloud service or end-user account.

See [Android details and validation](ANDROID.md). Update checks, signature checks and functional tests do not constitute an independent security audit.

## Desktop application

The desktop GUI has its own release version and updater, separate from the host/CLI. It checks the published channel shortly after startup and every 15 minutes, selects the Linux/macOS package for the current CPU, and verifies SHA-256 after downloading and again before installation. Settings provides a manual check and an automatic-update toggle.

A visible activity row follows checking, downloading, verification, readiness and errors. **Install and reopen** applies a verified package and reopens the same application profile. With automatic updates enabled, closing the app also applies a ready update. The detached GUI installer never stops the host service or terminates its shells. A system `.deb`/`.rpm` installation or protected macOS application location may require OS authorization. macOS builds remain unsigned and unnotarized.

An installation result is retained in the private desktop profile. Failure is displayed on the next launch; it is not immediately hidden by the startup check. Older desktop builds need one installation of a release that includes this updater, using the public package or `jaunt gui --install-only`.

## Visible progress

Web and desktop image transfers retain their actual result: verified upload and quoted path insertion without Enter, or host clipboard completion plus Ctrl+V delivery. They do not claim that a CLI recognized an attachment. Host checks show completion, failure or explicit deferral for active work. Android uses native progress dialogs for checks and APK downloads, followed by the OS installer confirmation.
