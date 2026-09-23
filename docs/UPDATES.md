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

The APK checks public Android releases automatically, with a manual check in Settings. It follows the chosen update channel and verifies downloaded bytes, package identity, the channel's release tag, a strictly higher `versionCode` and the same signing certificate before opening Android's installer. App data and pairing are retained during an update. Android requires user confirmation for APK installation and may ask once for permission to install updates from jaunt. This is an OS boundary, not a missing cloud service or end-user account.

See [Android details and validation](ANDROID.md). Update checks, signature checks and functional tests do not constitute an independent security audit.

## Desktop application

The desktop GUI has its own release version and updater, separate from the host/CLI. It checks the published channel shortly after startup and every 15 minutes, selects the Linux/macOS package for the current CPU, and verifies SHA-256 after downloading and again before installation. Settings provides a manual check and an automatic-update toggle.

A visible activity row follows checking, downloading, verification, readiness and errors. **Install and reopen** applies a verified package and reopens the same application profile. With automatic updates enabled, closing the app also applies a ready update. The detached GUI installer never stops the host service or terminates its shells. A system `.deb`/`.rpm` installation or protected macOS application location may require OS authorization. macOS builds remain unsigned and unnotarized.

An installation result is retained in the private desktop profile. Failure is displayed on the next launch; it is not immediately hidden by the startup check. Older desktop builds need one installation of a release that includes this updater, using the public package or `jaunt gui --install-only`.

## Update channels

A channel lets a person follow the binaries of one pull request under review instead of production. This section is the contract every surface and the channel publisher implement; [`tests/fixtures/update_channels.json`](../tests/fixtures/update_channels.json) is its executable form and `scripts/update_channels.py` its reference implementation. The host, desktop and Android implement it (below).

**Names.** A channel name matches `[a-z][a-z0-9]{0,31}(_[1-9][0-9]{0,5})?`. `main` is the default and means production. `beta` is reserved for a future public channel. Only a per-pull-request sub-channel `<developer>_<pr>` (for example `moukrea_9`) whose developer part is not reserved can be published. A name is never a URL: it resolves to `<page>/ch/<name>/config.json`, where the Page and repository are those of the official installation (`installation.json` on the host, a single constant in desktop and Android).

**Channel document.** `ch/<name>/config.json` has the schema of the production `config.json` (`version` 1, `relay`, `page`, `repository`, `release`, `androidRelease`, `desktopRelease`, `releaseSource` as a full commit SHA) plus `channel`. A client rejects the document unless `channel` equals the requested name, `page` and `repository` equal the official ones, and all three release fields are candidates of that channel, of the matching component, with the same candidate number.

**Candidate tags.** A candidate extends the component's current production prerelease tag: `<production tag>.ch.<developer>.<pr>.<n>`, for example `v0.1.0-beta.41.ch.moukrea.9.2`, `desktop-v0.1.0-beta.33.ch.moukrea.9.2` and `android-v0.1.0-beta.31.ch.moukrea.9.2`. `n` starts at 1, increases with every pushed commit that is published, and is shared by the three components of one candidate. The separator is a dot, not a hyphen: in semver `41-ch` would be an alphanumeric identifier ranked above every later numeric beta. The host runtime version is the PEP 440 local version `0.1.0b41+ch.moukrea.9.2`; desktop and Android use `0.1.0-beta.41.ch.moukrea.9.2`. Candidate tags never match the production numbering (`next_tag` in `scripts/release_pipeline.py`).

**Order.** Versions compare by production base first, then production before its candidates, then by `n`. A candidate sorts above its base and below the next production release. Candidates of two different channels have no order. An unattended check on `main` installs only a newer production release; on a channel it installs only a newer candidate of that same channel. No automatic update crosses a channel.

**Explicit switch.** Only a person changing the channel setting may install a target that is not newer, including a return to `main`; the content of a document never triggers a switch. The host and desktop reinstall the target immediately. Android cannot install a lower `versionCode`, so its production codes are spaced: the next production release after code `C` gets `(C + 1) × 1000` while `C < 1000`, then the next multiple of 1000; a candidate gets its base code (spaced) plus `k`, a counter from 1 to 999 assigned by the publisher. Android can therefore move to a candidate published later, and returns to `main` automatically with the next production release; an immediate return on the same base requires uninstalling, which the app explains instead of failing.

**Removed channel.** When a pull request is merged or closed, its tags, prereleases and channel document are deleted. A client whose channel document is missing keeps its installed version, says the channel no longer exists and offers `main`; it does not switch by itself.

**Trust.** Host and desktop verify only a SHA-256 taken from the release itself, so the authority over what a channel installs is the publication trigger: a maintainer label or `workflow_dispatch` on a pull request of the official repository, never code from a fork. Android candidates are signed with the production key, and Android keeps checking the package name and signing certificate.

**Publisher.** `channel.yml` and `scripts/channel_release.py` produce and remove candidates; see [Channel candidates](DEPLOYMENT.md#channel-candidates). The latest `delivered` candidate of a live channel in `jaunt-channel-state` is the one its channel document points to.

**Host.** `installation.json` holds `channel` (`main` when absent; the public installer keeps it on reinstall). Settings shows it next to **Check for updates**: **Change channel** takes a sub-channel name and **Return to main** goes back; both call `updates.configure {channel}`, which stores the name and starts the explicit switch at once. The switch is recorded in `update-status.json` (`switch`) only while it is running or deferred, so a deferred switch resumes as a switch; automatic runs never carry it. `jaunt.channels` reimplements the contract for the wheel and is tested against the same fixtures. A missing channel document ends in the `channel-missing` state. `tests/client_update_e2e.py` exercises the switch, the removed channel and the return to `main` through the loopback mirror, without a publisher.

**Desktop.** `desktop/channels.cjs` reimplements the contract with the official Page and repository as its single constant, and `tests/desktop_updates.test.cjs` runs it against the same fixtures. `<userData>/updates/preferences.json` holds `channel` next to `automatic` (`main` when absent or invalid). Settings → Desktop app shows it with the same **Change channel** and **Return to main** controls as the host; both call the `switch` action, which stores the name, downloads the target, verifies its SHA-256 and installs and reopens at once. Only that installation plan carries `switch`: `.deb` then uses `apt-get install --allow-downgrades`, and `.rpm` chooses `dnf install`, `downgrade` or `reinstall` from `rpm`'s own comparison, because electron-builder writes the package version with `~` for `-` and ranks candidates of two channels although the contract does not. A missing channel document ends in `channel-missing` with **Return to main** in the desktop update activity.

**Android.** `UpdateChannels.java` reimplements the contract with the official Page and repository as its single constant; `UpdateChannelsTest` runs it against the same fixtures, which `android/app/build.gradle` adds as unit-test resources. The `app-updates` preferences hold `channel` (`main` when absent or invalid). Settings → jaunt shows it with the same **Change channel** and **Return to main** controls, through the `app.channel` and `app.channel.set` bridge actions. The switch installs the channel's release only when Android can: a comparable target that is not newer is explained before any download, and an APK whose `versionCode` is not higher is refused with the same explanation (wait for the next production release, or uninstall and reinstall, which loses the app's data). Automatic checks and the switch check the APK's version against the chosen tag; the package and signer checks are unchanged. A missing channel document shows **Return to main**. The debug APK keeps updates disabled and refuses a switch.

## Visible progress

Web and desktop image transfers retain their actual result: verified upload and quoted path insertion without Enter, or host clipboard completion plus Ctrl+V delivery. They do not claim that a CLI recognized an attachment. Host checks show completion, failure or explicit deferral for active work. Android uses native progress dialogs for checks and APK downloads, followed by the OS installer confirmation.
