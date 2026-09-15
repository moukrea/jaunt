# Installer corrections — September 15, 2026

The initial user report concerned Fedora: the command produced no output and the executable remained on beta.2. There was no remote access to that machine. The initial bootstrap corrections did not establish the cause on the user's machine. A subsequent report provided `curl (23) Failed writing body` during the `config.json` download.

## Reproduced defects and corrections

- The old `curl -fsSL … | bash` command returns 0 when curl fails and Bash receives empty input. The official command now uses Bash with `pipefail`, visible progress, a ten-second connection timeout, and a 120-second limit for the initial script download.
- A `.curlrc` output-file setting can absorb the script so nothing runs. This was reproduced using real curl and a local HTTP server. The leading `-q` ignores that configuration in the official command; internal downloads use `--disable`.
- The script immediately announces startup and each download. Unexpected errors identify the stage, line, and exit code without printing secrets or complete commands.
- Internal HTTPS downloads are bounded at 120 seconds per attempt. Selected connection/transfer errors trigger one visible IPv4 retry; HTTP and certificate failures are not bypassed. Redirects remain restricted to HTTPS.
- A curl process with a separate filesystem namespace cannot open the temporary-directory path created by Bash. A real Fedora-container curl reproduced exit 23 at `Downloading config.json`, before any installation mutation. Downloads now use shell output redirection: Bash opens the destination and curl writes through inherited stdout. This works even when curl cannot see the destination path. It does not bypass storage exhaustion or write denial on the destination filesystem.
- Active-shell guards, wheel verification, and identity preservation remain in place.

The curl documentation defines [exit 23 as a local write failure](https://curl.se/libcurl/c/libcurl-errors.html). That code alone does not identify the exact cause on the user's machine; filesystem isolation is the reproduced case addressed here.

## Observations

- `pytest -q tests/test_installer_bootstrap.py`: four failures against the previous bootstrap files, then four passes after the first correction. These cover network failure, HTTP failure, pipeline exit status, and `.curlrc` output redirection.
- `pytest -q`: 49 tests passed locally with Python 3.14.2 after the first correction.
- `python scripts/build_release.py`, `npm run prepare-web`, `python scripts/check_project.py`: passed.
- `python tests/installer_e2e.py`: eight checks passed, including tampered checksums, refusing to kill a real active shell, and explicitly authorized restart.
- Fedora 44, fresh official container, previous public script through `curl … | bash`: beta.5 installation succeeded. Fedora alone did not reproduce the user's problem.
- Fedora 44, fresh official container, corrected script piped into Bash: installed the real public beta.5 wheel, with private Python 3.12.14 installed by uv; exit 0 and version 0.1.0b5.
- Fedora 43, fresh official container: previous installer and public beta.2 wheel, followed by the corrected installer and public beta.5 wheel. Versions checked before/after; identity and device table preserved.
- The first corrected command was fetched from the published page and executed in a fresh Fedora 43 container after [Pages deployment](https://github.com/moukrea/jaunt/actions/runs/34931947575). Public installer bytes matched the reviewed source and version 0.1.0b5 was verified.
- `python tests/installer_namespace_e2e.py`: real public wheel installation with curl in a Fedora 44 container and Bash/Python outside it. No host directories are mounted into curl's container. Before the output-redirection fix, config download failed with exit 23. After the fix, the wheel installed from the public release, imported from the private runtime, and started the daemon with automatic updates enabled.
- Required CI includes real Fedora 43/44 installations. The Fedora 44 job additionally runs the separate-filesystem curl installation regression.

Fedora tests use isolated containers without a user service manager (`JAUNT_NO_SERVICE=1`) and suppress QR output (`JAUNT_SKIP_PAIR=1`). They validate installation and background startup, not systemd/SELinux on a physical Fedora workstation. The user service was previously validated on Ubuntu; no new physical Fedora validation is claimed.

These corrections apply to the Pages entry point and installer source. Published beta.5 assets and APK beta.3 remain immutable. The host does not need a new version number to use the updated Pages installer. The installer embedded in the beta.5 wheel retains its previous code until a future host release.

The protocol remains without an independent security audit.

## Follow-up: persistent exit 23 after shell redirection

The user subsequently reported the same write failure at line 65. The namespace regression had passed, but it had not resolved the remote user's failure. No claim is made that the remote filesystem or curl configuration has been diagnosed.

A separate Fedora 44 test with Python 3.14.7 and a completely full 4 KiB `/tmp` tmpfs reproduced the exact `curl: Failed writing body` error and the line-65 failure. A directory and empty file could still be created there, but writing the response failed. This test uses only a disposable Docker container; it does not fill any host or personal filesystem.

The installer now stages beside the runtime on the destination filesystem, checks that it can write 1 MiB there, and supplies that private temporary directory to pip/uv during installation. It does not change the host daemon's or shell sessions' TMPDIR. The staging directory is removed on exit. A full destination filesystem still produces a clear storage error; the installer does not delete user files to make room.

When curl returns 23 and Python is available, a standard-library HTTPS downloader retries the file independently. It uses normal certificate validation, rejects non-HTTPS redirects, bounds the whole transfer to 120 seconds and 128 MiB, detects incomplete bodies, and flushes/fsyncs the result. Wheel checksum verification still happens before runtime replacement. This fallback does not handle arbitrary TLS/HTTP failures by weakening validation.

Validation commands for this follow-up:

- `pytest -q`: 53 tests passed locally. Four new checks exercise the Python fallback's HTTPS and redirect boundaries.
- `python tests/installer_storage_e2e.py`: real Fedora installations with a full `/tmp`, and with every internal curl download forced to write to `/dev/full`. The second scenario exercises actual curl exit 23 followed by real public HTTPS downloads through Python. Both scenarios check the running daemon, staging cleanup, and absence of a deleted staging path in the daemon environment.
- `python tests/installer_e2e.py`: all eight existing checks passed, including active-shell preservation, checksum rejection, and explicit restart authorization.
- `python scripts/build_release.py`, `npm run prepare-web`, and `python scripts/check_project.py`: passed.

The required Fedora CI job runs both new installation scenarios in addition to the earlier namespace test. These are test-environment observations, not a claim of successful execution on the user's inaccessible Fedora machine.
