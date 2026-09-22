# Trying a pull request before it merges

A reviewer must be able to try the change under review, and see the screen a
visual check was about, without building anything. The worker that owns the PR
prepares this; checkouts, builds and setup are its job, not the reviewer's.

This is a one-off trial of one PR head. It is not a release channel: channels
(JAU-26) and automatic releases after merge (JAU-30) are separate.

## Worker recipe

1. Identify the PR number and the exact head commit being offered.
2. List the workflows actually triggered for that commit
   (`gh run list --commit <sha>`). Path filters decide what exists: Android runs
   for `android/**`, `web/**`, `scripts/prepare_web.mjs` and its own workflow;
   desktop for `desktop/**`, `web/**`, `package*.json` and its own files. A
   harness-only change produces no installable package — say so.
3. Wait for those runs, then check the artifact itself
   (`gh run download <run-id> -n <artifact>`), not just its name.
4. Comment on the ticket when the PR opens, then update the same thread once
   artifacts are verified, before merging: version (PR, commit), platform, short
   procedure, expected result, checks actually done, limits. Use
   `--expects none` unless the plan named a human decision.

Artifacts expire (14 days for the APK, the repository default otherwise),
and downloading them requires a GitHub login with read access to the repository. Link the run
page (`https://github.com/moukrea/jaunt/actions/runs/<run-id>`), where the
artifact list is at the bottom. An expired artifact is re-created by re-running
the workflow for the same commit; never offer a link you have not opened.

This adds no human approval before merge: green CI remains the gate.

## Trial paths

### Android — `android-debug-apk`

The Android workflow uploads the debug APK of every PR it runs for. It installs
beside the release app (application ID `dev.jaunt.android.debug`, version
suffixed `-debug`), with its own storage: pair it anew from `jaunt pair`.
Android asks to allow installation from the browser or file manager used.

CI builds sign with the runner's generated debug key, which can differ between
runs. Installing a later PR's APK over an earlier one may be refused; uninstall
the debug app first, which removes its pairings. Debug builds do not
automatically install release updates. The release signing path (`android-v*` tags) is unchanged.

### Linux desktop — `desktop-Linux`

The artifact contains `.tar.gz`, `.deb` and `.rpm`. The `.tar.gz` extracts
without installation and without authorization. Run it with a fresh profile
and automatic updates off, so it neither touches the installed app's pairings
nor replaces itself with the latest release:

```sh
P=$(mktemp -d)/profile
mkdir -p "$P/updates" && echo '{"automatic":false}' > "$P/updates/preferences.json"
./jaunt-desktop --user-data-dir="$P"
```

Chromium's sandbox needs unprivileged user namespaces. Where the kernel
restricts them (`/proc/sys/kernel/apparmor_restrict_unprivileged_userns` is `1`,
the Ubuntu default) the archive and a source launch abort at startup; only the
`.deb`, with its AppArmor profile, runs there, and it replaces the installed
application. Do not suggest `--no-sandbox`. On such a machine, prefer Android or
the local workspace below, or say that no side-by-side desktop trial exists.

A separate client profile does not isolate the host: the desktop app can start
and drive the installed host, and every action taken in a shell is real.

macOS archives are unsigned; OS trust prompts apply.

### Local workspace — any web or host change

`scripts/dev.py` runs a host, a loopback relay and the web app from the PR's
checkout, all bound to `127.0.0.1`, with state in the directory you give it:

```sh
git fetch origin pull/<n>/head && git worktree add /tmp/jaunt-pr-<n> FETCH_HEAD
cd /tmp/jaunt-pr-<n>
python3 -m venv .venv && . .venv/bin/activate
pip install -e . -r requirements-dev.txt
npm ci && npm run prepare-web
python scripts/dev.py --state "$(mktemp -d)"
```

It prints a one-use pairing link for a browser on the same machine. The shells
it opens are real shells of the local user. The worker runs this itself to check
the change; hand it to a reviewer only when they asked for a local trial.

Serving `web/` on localhost against the production relay does not work: the
relay refuses origins other than the published page and `jaunt://app`.

## Screenshots of a visual check

A visual check comes with a capture of the screen concerned, reachable from
the ticket comment:

- a CI capture from `browser-evidence`, named by its exact file in the run;
- or a sanitized PNG committed under `docs/evidence/` by the PR, linked at the
  PR's commit (`https://github.com/moukrea/jaunt/blob/<sha>/docs/evidence/…`).

Remove pairing QR codes, links, secrets and private terminal content before
publishing. A capture saved only on the worker's disk is not published; do not
describe it as attached.
