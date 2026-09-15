# jaunt

<img src="web/assets/jaunt.png" width="96" alt="jaunt logo">

**Your shells, your files, your machine. From your phone.**

jaunt provides native desktop and Android applications, a mobile/desktop web client, and a POSIX host. It connects you to real terminals, including arbitrary shells, Claude Code, and Codex. The static web app uses a shared relay to carry encrypted outbound connections from the host and client.

**Host: 0.1.0-beta.8 · Desktop: 0.1.0-beta.6 · Android: 0.1.0-beta.4.** [Open jaunt](https://moukrea.github.io/jaunt/). The relay and host release are deployed. The protocol has **not received an independent security audit**. See the [validation report](docs/PUBLIC_DELIVERY.md) for observed test results and unvalidated limitations.

## Install the host

```sh
bash -o pipefail -c 'curl -qfL --connect-timeout 10 --max-time 120 https://moukrea.github.io/jaunt/install.sh | bash'
```

Supports Linux, macOS, and WSL. Requires `curl`. The installer uses a compatible Python 3.11–3.14 runtime or installs a private Python runtime through uv. It never runs `sudo` implicitly. It verifies the release SHA-256, creates a private environment, and starts a user service when available. Automatic updates are enabled and wait until ordinary shells and transfers finish.

On Android, [install the signed APK](https://github.com/moukrea/jaunt/releases/download/android-v0.1.0-beta.4/jaunt-android-v0.1.0-beta.4.apk), then scan the QR code displayed by the host. On a desktop or in a browser, open **https://moukrea.github.io/jaunt/**. You can also paste the `jaunt1.…` pairing string. The QR code expires after ten minutes and can be used only once. Each remembered device then uses its own key, so switching Wi-Fi or mobile networks does not require pairing again. Keep the tab open for automatic reconnection; reopen the app if the mobile OS suspends or kills it.

```sh
jaunt gui                        # Open/install the native desktop workspace
jaunt pair                       # Pair another device
jaunt service install            # Install and enable the user service
jaunt status                     # Host and shell status
jaunt update                     # Check for an update without closing shells
jaunt doctor                     # Diagnostics without exposing secrets
jaunt devices                    # List authorized devices
jaunt revoke DEVICE_ID           # Revoke a lost device
jaunt notify "Build finished"     # Notify connected devices
jaunt run -- make test            # Notify when a command finishes
jaunt clipboard < notes.txt      # Make text available to the client
jaunt stop                       # Stop the host AND its non-tmux shells
```

Pairing grants access as the **system account running the host**, with all of that account's permissions. Do not run as root for ordinary use. A QR code grants shell access: never publish it.

## Features

| Area | Behavior |
|---|---|
| Terminals | Real PTYs, interactive keyboard, multiple tabs, create/rename/open/detach/terminate, shared sizing, mobile Ctrl/Alt/Esc/Tab/arrow keys |
| Reconnection | Bounded history, automatic reconnection, remembered state; a browser disconnect does not close the shell |
| tmux | Create or attach to a tmux session when tmux is installed; closing its view does not kill the tmux server |
| Files | Browsing, hidden files, pagination, create directories, rename, non-recursive deletion, upload/download, text/image previews |
| Transfers | Contextual tracking in Files → Transfer activity; 48 KiB chunks, network resume offsets, upload SHA-256, atomic finalization, cancellation |
| Images | Gallery, file picker, paste, and drag-and-drop; PNG conversion for browser-decodable formats; path insertion or conditional native paste |
| Clipboard | Selection, retained scrollback copying, host clipboard read/write when available, headless text buffer, copy-only OSC 52 |
| Protection | Single-use QR codes, per-device keys, revocation, optional PIN/password-protected browser vault and automatic locking |
| Notifications | Optional native Android service or browser Web Push; terminal bells, program events, session exit, Settings test and CLI `notify`/`run` |
| Interface | Native desktop and Android apps with a shared bundled interface; browser client; local JavaScript |

## Shared desktop workspace

Open **jaunt** from the host's applications menu or run `jaunt gui`. Host and remote clients share the same ordinary shells without tmux. **Sessions** lists every session: open it, close only your view, or explicitly terminate it for everyone. The device you interact with controls the shared terminal size.

**Arrange panes** creates resizable split tabs on desktop. Layouts survive reopening; mobile displays their sessions as normal tabs. Settings includes host names/order/defaults, dark/light/system/circadian themes, and notification controls. The native desktop app also manages the local host service and pairs to other hosts. See the [workspace guide](docs/WORKSPACE.md) and [validation report](docs/WORKSPACE_VALIDATION.md).

## Image handling

**Paste:** when a native backend is available, an image is uploaded to the host clipboard and pasted into the selected session with Ctrl+V. If the browser returns an empty clipboard, the UI offers a rich paste area and image picker. Attach retains both explicit modes. No Enter key is sent.

**Fallback with an active connection:** select or paste an image, upload it to the host, and insert its properly escaped path into the terminal. Nothing submits the command automatically. Claude, Codex, or another tool can read the file if its own mode supports it.

**Conditional native paste:** when the host has an accessible graphical clipboard (macOS, Wayland with `wl-clipboard`, or X11 with `xclip`), jaunt puts the PNG there and sends Ctrl+V to the terminal. This also depends on the CLI tool's shortcut and behavior. **On a headless host, jaunt cannot manufacture a native Claude/Codex attachment: it falls back to a file and its path.** HEIC and other formats the browser cannot decode can still be transferred as files, but are not converted to PNG.

## Known limitations

- Up to 16 active shells, 32 retained views, 2 MiB of raw replay per PTY, and 10,000 xterm scrollback lines. Copy-all covers retained history, not an unlimited log.
- Host file limit: 512 MiB. In-memory downloads are limited to 128 MiB in browsers without direct file writing; previews are limited to 16 MiB. Up to eight simultaneous uploads and 1 GiB of declared total size.
- Uploads resume after network interruptions while the host and page retain the transfer. Restart the upload after a host restart or full page reload; jaunt does not obtain unauthorized persistent access to the phone's local files.
- Ordinary shells survive disconnection, **not a daemon restart or machine reboot**. tmux can survive a daemon restart, but not an OS reboot.
- Only one jaunt application tab per browser profile may own the vault at a time. Multiple terminal tabs inside jaunt and multiple devices are supported.
- Browser notifications require permission and Web Push support. In the APK, enable Android background notifications in Settings; Android battery restrictions may delay delivery. On iOS, use the installed PWA. Delivery depends on the network and push provider; it is not guaranteed in real time.
- A sleeping or powered-off host is unreachable. There is no remote wake-up, arbitrary TCP tunnel, graphical desktop, or native Windows shell support.
- Production relay costs, quotas, and availability depend on the Cloudflare account. Basic relay safeguards are not a guaranteed commercial abuse-protection service.

## Local development

```sh
python3 -m venv .venv
. .venv/bin/activate
pip install -e . -r requirements-dev.txt
npm ci
npm run prepare-web
python scripts/dev.py
```

The runner listens only on `127.0.0.1`, starts a host and local relay, and displays a test QR code. **This does not expose the host to the Internet.** Use the HTTPS deployment on a physical phone: `localhost` refers to the phone, not the PC.

```sh
pytest -q                        # Python tests and Node interoperability tests
node --test tests/relay.test.mjs  # Deterministic Worker model
npm run test:relay               # Real Miniflare runtime; npm dependencies required
python scripts/check_project.py  # Resource consistency and syntax
python scripts/build_release.py  # Wheel, manifest, and SHA256SUMS
python tests/browser_e2e.py       # Real browser and host in temporary isolation
```

Set `jaunt_BROWSER_EXECUTABLE=/path/to/chromium` to use a system browser. Otherwise run `python -m playwright install chromium`. Tests never change your browser's security policies.

## Initial deployment — once, by the project owner

Give [DEPLOY_AGENT_PROMPT.md](DEPLOY_AGENT_PROMPT.md) to an agent with GitHub access. It configures GitHub Pages, a host release, and **one Cloudflare relay for the entire project**. Cloudflare authorization is required; a GitHub token does not provide it. End users do not create infrastructure.

jaunt does not borrow relays from sshx, Happy, or Zedra. It does not depend on their servers, Tailscale, or a jaunt user account. The owner's Cloudflare account may incur quotas or costs; no free or unlimited relay is promised.

## Documentation

[Deployment](docs/DEPLOYMENT.md) · [Security](SECURITY.md) · [Protocol](docs/PROTOCOL.md) · [Troubleshooting](docs/TROUBLESHOOTING.md) · [Validation](docs/VALIDATION.md) · [Third-party notices](THIRD_PARTY_NOTICES.md)

English is the default language for repository documentation and contribution guidance. Application localization is separate from the documentation language.

## Android app

The Android client is an APK with a bundled WebView interface and native clipboard, camera, file, and background-notification integrations. See [Android installation, architecture, and validation](docs/ANDROID.md). The page advertises the APK after its public assets have been verified.

The host updates automatically from the published channel, waiting until ordinary shells and transfers finish. Android automatically checks for a new APK and offers a verified update through the system installer. See [updates and explicit restart authorization](docs/UPDATES.md).
