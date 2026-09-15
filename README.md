# jaunt

<img src="web/assets/jaunt.png" width="96" alt="jaunt logo">

**Your shells, your files, your machine. From your phone.**

jaunt provides native desktop and Android applications, a mobile/desktop web client, and a POSIX host. It connects you to real terminals, including arbitrary shells, Claude Code, and Codex. The static web app uses a shared relay to carry encrypted outbound connections from the host and client.

**Host: 0.1.0-beta.11 · Desktop: 0.1.0-beta.10 · Android: 0.1.0-beta.8.** [Open jaunt](https://moukrea.github.io/jaunt/). Release publication and validation are tracked in the validation report. The protocol has **not received an independent security audit**. See the [latest validation report](docs/SEAMLESS_WORKSPACE_VALIDATION.md) for observed test results and unvalidated limitations.

## Install the host

```sh
bash -o pipefail -c 'curl -qfL --connect-timeout 10 --max-time 120 https://moukrea.github.io/jaunt/install.sh | bash'
```

Supports Linux, macOS, and WSL. Requires `curl`. The installer uses a compatible Python 3.11–3.14 runtime or installs a private Python runtime through uv. The host installs without administrator privileges. On Ubuntu with restricted user namespaces, the optional desktop app uses the system package installer and may request an administrator password to configure its sandbox. It verifies the release SHA-256, creates a private environment, and starts a user service when available. Automatic updates are enabled. Compatible hosts retain their shell processes during runtime replacement and wait for transfers to finish.

On Android, [install the signed APK](https://github.com/moukrea/jaunt/releases/download/android-v0.1.0-beta.8/jaunt-android-v0.1.0-beta.8.apk), then scan the QR code displayed by the host. On a desktop or in a browser, open **https://moukrea.github.io/jaunt/**. You can also paste the `jaunt1.…` pairing string. The QR code expires after ten minutes and can be used only once. Each remembered device then uses its own key, so switching Wi-Fi or mobile networks does not require pairing again. Keep the tab open for automatic reconnection; reopen the app if the mobile OS suspends or kills it.

```sh
jaunt gui                        # Open/install the native desktop workspace
jaunt pair                       # Pair another device
jaunt service install            # Install and enable the user service
jaunt status                     # Host and shell status
jaunt update                     # Check for an update without closing shells
jaunt doctor                     # Diagnostics without exposing secrets
jaunt devices                    # List authorized devices
jaunt revoke -- DEVICE_ID           # Revoke a lost device
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
| Existing tmux sessions | Legacy tmux sessions remain supported; new sessions in the UI are ordinary shared shells |
| Files | Browsing, hidden files, pagination, create directories, rename, non-recursive deletion, upload/download, text/image previews |
| Transfers | Visible progress and retained success/error results; detailed tracking in Files → Transfer activity; 48 KiB chunks, network resume offsets, upload SHA-256, atomic finalization, cancellation |
| Images | Gallery, file picker, paste, and drag-and-drop; PNG conversion for browser-decodable formats; path insertion or conditional native paste |
| Clipboard | Selection, retained scrollback copying, host clipboard read/write when available, headless text buffer, copy-only OSC 52 |
| Protection | Single-use QR codes, per-device keys, revocation, optional PIN/password-protected browser vault and automatic locking |
| Notifications | Optional native Android service or browser Web Push; terminal bells, program events, session exit, Settings test and CLI `notify`/`run` |
| Interface | Native desktop and Android apps with a shared bundled interface; browser client; local JavaScript |

## Desktop client only

To connect to other hosts without installing a local host service or jaunt CLI:

```sh
bash -o pipefail -c 'curl -qfL --connect-timeout 10 --max-time 120 https://moukrea.github.io/jaunt/install.sh | bash -s -- --client-only'
```

This installs the same desktop application and launcher, with remote pairing, sessions, files, notifications and automatic app updates. It does not start a daemon or show local host controls. It does not uninstall a previously installed host. Run the normal host installation command to enable local host integration later.

The installed browser application is named **jaunt (PWA)** so it can be distinguished from the native **jaunt** app. Both use the original transparent logo. Native Android uses the same artwork without a bundled dark background; individual launchers may apply their own icon treatment.

## Shared desktop workspace

Open **jaunt** from the host's applications menu or run `jaunt gui`. Host and remote clients share the same ordinary shells without tmux. **New shell** opens an automatically named shell immediately, inheriting the previous active shell’s current directory. The folder button lets you browse the host’s directories and optionally name the new shell. **Sessions** lists running and exited sessions: open, rename, close only your view, or explicitly terminate a shell for everyone. You can also rename a tab by double-clicking its title, or double-click a pane’s title. Drag tabs to reorder them; selecting a tab never changes its position. The device you interact with controls the shared terminal size.

The two **split icons** arrange panes side by side or above/below on desktop, using a new or existing session. Each pane can move into its own tab. Layouts survive reopening; mobile displays their sessions as normal tabs. The desktop sidebar can collapse, with the preference retained. Settings includes friendly host names, ordering and the default host, dark/light/system/circadian themes, and notification controls. Host settings follow the selected machine immediately, including its identity and update controls. The native desktop app also manages the local host service and pairs to other hosts; local service controls appear only for the local host, while desktop application updates remain separate. See the [workspace guide](docs/WORKSPACE.md) and [validation report](docs/WORKSPACE_VALIDATION.md).

## Image handling

Progress stays visible during upload and clipboard/path delivery. Completed operations collapse into a compact result; **Show history** retains the details. Cancelling a transfer is shown as cancellation, and errors stay with their operation. The final result states exactly what happened; errors stay visible with a retry action. A successful path insertion or Ctrl+V delivery does not prove that Claude Code or Codex recognized an attachment.

**Paste:** when a native backend is available, an image is uploaded to the host clipboard and pasted into the selected session with Ctrl+V. If the browser returns an empty clipboard, the UI offers a rich paste area and image picker. Attach retains both explicit modes. No Enter key is sent.

**Fallback with an active connection:** select or paste an image, upload it to the host, and insert its properly escaped path into the terminal. Nothing submits the command automatically. Claude, Codex, or another tool can read the file if its own mode supports it.

**Conditional native paste:** when the host has an accessible graphical clipboard (macOS, Wayland with `wl-clipboard`, or X11 with `xclip`), jaunt puts the PNG there and sends Ctrl+V to the terminal. This also depends on the CLI tool's shortcut and behavior. **On a headless host, jaunt cannot manufacture a native Claude/Codex attachment: it falls back to a file and its path.** HEIC and other formats the browser cannot decode can still be transferred as files, but are not converted to PNG.

## Automatic updates

| Component | Update behavior |
|---|---|
| Host / CLI | Same installation. Checks the published channel every 15 minutes, verifies downloads and replaces compatible runtimes without ending shell processes. Transfers finish first. Settings or `jaunt update` checks immediately. Older hosts without runtime handoff defer while ordinary shells are active; ending those shells still requires explicit confirmation. |
| Desktop app | Separate version from the host. Automatically checks, downloads and verifies an update; installs when you close the app. Settings provides a manual check, an automatic-update toggle and **Install and reopen**. Updating the GUI does not stop the host or its shells. System packages may request OS authorization. |
| Android APK | Automatically checks for a new APK. A visible check/download dialog leads to Android’s installation confirmation. The APK’s checksum and signing certificate are verified; Android does not permit silent self-installation. |
| Web client | Uses the version published on Pages. Reopen/reload to activate a downloaded service-worker update. |

Existing installations need the release containing their updater before that updater can run. Re-running the official host command updates the host and installs the advertised desktop app; it refuses to silently close active ordinary shells. Pairing keys are retained. See [updates and restart protection](docs/UPDATES.md).

## Connection and operation feedback

A network interruption has one persistent connection banner with a retry action. jaunt reconnects using the saved device key; it does not replay unsent terminal input. Revocation and failed host verification stop the connection and explain the next step. Errors in a dialog stay in that dialog; other action errors remain visible until dismissed. Short confirmation toasts are deduplicated and limited to two.

Uploads, downloads, service installation and update checks show progress and a final result in Activity. Network pauses are explicit, transfer cancellation is available, and completed history can be expanded. Available updates provide a direct action instead of an expiring toast.

## Notifications

Enable notifications in **Settings** and use its test action. Program notification titles and text are preserved when supplied; a plain terminal bell has no message body to recover. Clicking a notification selects the corresponding host and session. Desktop notifications require the app to be running; Android uses its optional foreground connection service; the web client uses browser Web Push. Notification content may appear on the lock screen according to OS settings.

## Known limitations

- Up to 16 active shells, 32 retained views, 2 MiB of raw replay per PTY, and 10,000 xterm scrollback lines. Copy-all covers retained history, not an unlimited log.
- Host file limit: 512 MiB. In-memory downloads are limited to 128 MiB in browsers without direct file writing; previews are limited to 16 MiB. Up to eight simultaneous uploads and 1 GiB of declared total size.
- Uploads resume after network interruptions while the host and page retain the transfer. Restart the upload after a host restart or full page reload; jaunt does not obtain unauthorized persistent access to the phone's local files.
- Ordinary shells survive disconnection and compatible runtime updates, **not an explicit daemon stop/restart or machine reboot**. tmux can survive a daemon restart, but not an OS reboot.
- Only one jaunt application tab per browser profile may own the vault at a time. Multiple terminal tabs inside jaunt and multiple devices are supported.
- Browser notifications require permission and Web Push support. In the APK, enable Android background notifications in Settings; Android battery restrictions may delay delivery. On iOS, use the installed PWA. Delivery depends on the network and push provider; it is not guaranteed in real time.
- A sleeping or powered-off host is unreachable. There is no remote wake-up, arbitrary TCP tunnel, graphical desktop, or native Windows shell support.
- Linux desktop packages are available for x64 and ARM64; macOS archives are unsigned and unnotarized. No native Windows desktop package is provided. Physical Android phone behavior and protected macOS updater authorization have not been validated; emulator results are documented separately.
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
npm test                         # Relay model, protocol/UI helpers and desktop updater
npm run test:relay               # Real Miniflare runtime; npm dependencies required
python scripts/check_project.py  # Resource consistency and syntax
python scripts/build_release.py  # Wheel, manifest, and SHA256SUMS
python tests/browser_e2e.py       # Real browser and host in temporary isolation
python tests/shared_workspace_e2e.py # Electron + browser sharing real PTYs; needs a display
python tests/terminal_render_e2e.py  # Scroll, selection and terminal geometry
python tests/installer_e2e.py        # Real wheel install and protected upgrade
```

Set `jaunt_BROWSER_EXECUTABLE=/path/to/chromium` to use a system browser. Otherwise run `python -m playwright install chromium`. Tests never change your browser's security policies.

## Initial deployment — once, by the project owner

Give [DEPLOY_AGENT_PROMPT.md](DEPLOY_AGENT_PROMPT.md) to an agent with GitHub access. It configures GitHub Pages, a host release, and **one Cloudflare relay for the entire project**. Cloudflare authorization is required; a GitHub token does not provide it. End users do not create infrastructure.

jaunt does not borrow relays from sshx, Happy, or Zedra. It does not depend on their servers, Tailscale, or a jaunt user account. The owner's Cloudflare account may incur quotas or costs; no free or unlimited relay is promised.

## Documentation

[Deployment](docs/DEPLOYMENT.md) · [Security](SECURITY.md) · [Protocol](docs/PROTOCOL.md) · [Troubleshooting](docs/TROUBLESHOOTING.md) · [Validation](docs/VALIDATION.md) · [Third-party notices](THIRD_PARTY_NOTICES.md)

English is the canonical documentation language. Translations: [Français](docs/i18n/fr/README.md), [Español](docs/i18n/es/README.md), [Italiano](docs/i18n/it/README.md), [Português](docs/i18n/pt/README.md), [Deutsch](docs/i18n/de/README.md). Each translated tree includes the security, deployment and validation guides.

Web, Android and desktop select the system language automatically. Override it in **Settings → Language**. The CLI uses the system locale; `jaunt --language fr --help` overrides one invocation and `jaunt language fr` saves the preference. Use `system` to restore automatic selection. Command names, arguments, terminal output and user content are never translated.

The public web address introduces the project; **Open workspace** enters the client. Native apps open the workspace directly.

## Android app

The Android client is an APK with a bundled WebView interface and native clipboard, camera, file, and background-notification integrations. See [Android installation, architecture, and validation](docs/ANDROID.md). The page advertises the APK after its public assets have been verified.

The APK is a native Android package with a bundled WebView, not a PWA installation. The interface and typography are shared with the web and desktop apps; native integration supplies camera, clipboard, file selection and notifications. See the update table above for installation confirmation requirements.
