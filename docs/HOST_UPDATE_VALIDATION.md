# Host update rework — validation (September 15, 2026)

This report records what was observed while reworking the client-driven host update path (check, download, install, in-place runtime handoff, reconnection). All fixtures were disposable temporary directories with their own state, relay and service-manager sentinels. No real user host was restarted and no real shell was terminated.

## What changed

| Area | Before | After |
| --- | --- | --- |
| Progress | Client polled `updates.status` every second for up to 10 minutes | Host watches `update-status.json` and pushes `update.progress`; client keeps a 5 s fallback poll and a 30 min ceiling |
| Restart signalling | Disconnection during the `exec` looked like an outage | Host broadcasts `host.restarting` first; UI shows *Updating host · shells are kept*; desktop bridge reconnects after 1 s instead of 5 s |
| Admission | Installer gave up after 10 s if a client action was in flight | Daemon drains in-flight actions itself (20 s), refuses new shells meanwhile, restores admission on failure |
| Version truth | `installation.json` tag; an interrupted handoff reported "current" forever | Daemon writes `runtime.json`; the updater compares the published tag with the version really running and repairs the pointer |
| Failed handoff | Pointer left on the new runtime while the old one kept serving | Installer points `current` back, removes the failed runtime, reports the reason |
| Errors | "installer exit N" | The installer's own last failure line, network errors marked `retryable` |
| Deferred | Waited for the next 15 min automatic cycle, or forever | Daemon resumes a deferred update by itself once transfers/shells are gone |
| pip | Unconditional pip self-upgrade from PyPI, no retries | Skipped when already at the reviewed version; `--retries 5 --timeout 30` |
| Runtime directories | Grew forever | Previous runtime kept for rollback, older ones pruned |
| `jaunt start` | Spawned a competing daemon during a handoff (failed on the lock after 6 s) | Waits for the daemon holding the lock; prefers the installed user service |
| `jaunt service install` after handoff | `enable --now` could start a second daemon that crash-looped when the running one was started outside systemd | Enables only, keeps the running host |

## Commands and observed results

| Command | Result |
| --- | --- |
| `.venv/bin/python -m pytest -q` | 84 passed, including 7 new update tests (stale pointer, failure reason, retryable network errors, deferral reason, admission drain, stuck action refusal, one push per status change) |
| `npm test` | passed |
| `.venv/bin/python scripts/check_project.py` | passed |
| `LC_ALL=C.UTF-8 .venv/bin/python tests/handoff_e2e.py` | passed: same daemon and PTY PID, environment/cwd preserved, browser reattaches and executes |
| `.venv/bin/python scripts/build_release.py` then `tests/installer_e2e.py` | 8 installer checks passed with the reworked installer (rollback helper, progress reporting, pip retries, pruning) |
| `tests/client_update_e2e.py` (new) | 5 checks passed: install through `install.sh` with a loopback mirror; "Up to date"; browser-driven update beta.11 → beta.12 with pushed steps *Preparing the new runtime…*, *Installing the new runtime and its dependencies…*, *Updating the host service…*, *Restarting the host runtime*; same daemon and shell PID; command executed after reconnection; second check "Up to date"; a broken beta.13 refused with *cannot retain active sessions*, previous runtime and shell untouched, pointer unchanged, "Try again" offered |
| `tests/browser_e2e.py`, `tests/workspace_usability_e2e.py`, `tests/shared_workspace_e2e.py` | 23 + 1 + 1 scenarios passed after the client changes |

The browser suites assume an English locale; on a French workstation they must be run with `LC_ALL=C.UTF-8 LANGUAGE=en`.

## Not validated here

- The desktop application's local bridge during an update was changed (faster reconnection, explicit message) but only exercised through unit-level review, not through a packaged Electron run.
- Public 11 → 12 upgrade: no such release existed when this was written. The e2e above uses a repacked wheel with a higher version number on a loopback mirror.
- The reworked host-side pieces (daemon, updater, `jaunt start`) only take effect on hosts running a release that contains them. The very next public upgrade of an existing host still runs the previous updater; the web client improvements apply immediately through Pages.
