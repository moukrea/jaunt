# jaunt

<img src="web/assets/jaunt.png" width="96" alt="jaunt logo">

**Your machines, your shells, your files. On every screen.**

jaunt connects the devices you carry to the machines you work on. Install a small host on each Linux or macOS machine, pair your phone, laptop or desktop once, and every one of them shows the same workspace: real shells in real PTYs, the files next to them, and the sessions you left running. Open, rename, split, reorder, close or terminate shells on any host from any device; with *shared open sessions* on, the same tabs, panes and active shell follow you from screen to screen. Claude Code and Codex run there like any other program, and when both are installed on a host, one switch lets their sessions on the same project know about each other and exchange messages. Clients: a browser (also installable as a PWA), a native Android app and a native desktop app; all three ship the same interface. Connections go host-out through a relay, end-to-end encrypted, with no open port, no VPN and no account.

**Host: 0.1.0-beta.41 · Desktop: 0.1.0-beta.33 · Android: 0.1.0-beta.31.** [Open jaunt](https://moukrea.github.io/jaunt/). Release publication and validation are tracked in the validation report. The protocol has **not received an independent security audit**. See the [latest validation report](docs/SEAMLESS_WORKSPACE_VALIDATION.md) for observed test results and unvalidated limitations.

## Install the host

```sh
bash -o pipefail -c 'curl -qfL --connect-timeout 10 --max-time 120 https://moukrea.github.io/jaunt/install.sh | bash'
```

Supports Linux, macOS, and WSL. Requires `curl`. The installer uses a compatible Python 3.11–3.14 runtime or installs a private Python runtime through uv. The host installs without administrator privileges. On Ubuntu with restricted user namespaces, the optional desktop app uses the system package installer and may request an administrator password to configure its sandbox. It verifies the release SHA-256, creates a private environment, and starts a user service when available. Automatic updates are enabled. Compatible hosts retain their shell processes during runtime replacement and wait for transfers to finish.

On Android, [install the signed APK](https://github.com/moukrea/jaunt/releases/download/android-v0.1.0-beta.31/jaunt-android-v0.1.0-beta.31.apk), then scan the QR code displayed by the host. On a desktop or in a browser, open **https://moukrea.github.io/jaunt/**. You can also paste the `jaunt1.…` pairing string. The QR code expires after ten minutes and can be used only once. Each remembered device then uses its own key, so switching Wi-Fi or mobile networks does not require pairing again. Keep the tab open for automatic reconnection; reopen the app if the mobile OS suspends or kills it.

```sh
jaunt gui                        # Open/install the native desktop workspace
jaunt pair                       # Pair another device
jaunt service install            # Install and enable the user service
jaunt status                     # Host and shell status
jaunt update                     # Check for an update without closing shells
jaunt doctor                     # Diagnostics without exposing secrets
jaunt devices                    # List authorized devices
jaunt revoke -- DEVICE_ID           # Revoke a lost device
jaunt link PAIRING_CODE          # Link this host to another host (agents and machines)
jaunt agents pending             # Requests from linked hosts waiting for your answer
jaunt notify "Build finished"     # Notify connected devices
jaunt run -- make test            # Notify when a command finishes
jaunt clipboard < notes.txt      # Make text available to the client
jaunt stop                       # Stop the host AND its non-tmux shells
```

Pairing grants access as the **system account running the host**, with all of that account's permissions. Do not run as root for ordinary use. A QR code grants shell access: never publish it.

## Features

| Area | Behavior |
|---|---|
| Hosts | Pair as many Linux/macOS machines as you like; each keeps its own sessions, files, settings and friendly name; switch from one sidebar; default host and ordering |
| Terminals | Real PTYs with your own shell, interactive keyboard, tabs, create/rename/open/detach/terminate, drag to reorder, split panes (side by side or stacked), shared sizing, mobile Ctrl/Alt/Esc/Tab/arrow keys, compose box for long input |
| Shared open sessions | Per host: every client and the host itself show the same tabs, panes, order and active shell; optional "only displayed sessions exist" mode |
| Reconnection | Bounded history, automatic reconnection, remembered state; a browser disconnect does not close the shell; shells survive in-place host updates |
| Existing tmux sessions | Legacy tmux sessions remain supported; new sessions in the UI are ordinary shared shells |
| Files | Browsing, hidden files, pagination, create directories, rename, non-recursive deletion, upload/download, text/image previews |
| Transfers | Visible progress and retained success/error results; detailed tracking in Files → Transfer activity; 48 KiB chunks, network resume offsets, upload SHA-256, atomic finalization, cancellation |
| Images | Gallery, file picker, paste, and drag-and-drop; PNG conversion for browser-decodable formats; path insertion or conditional native paste |
| Clipboard | Selection, retained scrollback copying, host clipboard read/write when available, headless text buffer, copy-only OSC 52 |
| Agents and machines | Four switches per host: commands and leased background shells on linked machines, typing into shells of this host, typing into shells across machines, messages between sessions across machines; each requester (host × runtime) with its own level (ask / trust / block), allow-lists, a journal; approvals from any device or the CLI |
| Claude Code ↔ Codex | One switch per host: sessions on the same project learn about each other through their hooks and can message each other's open conversation; off removes everything jaunt added |
| Protection | Single-use QR codes, per-device keys, revocation, optional PIN/password-protected browser vault and automatic locking |
| Notifications | Optional native Android service or browser Web Push; terminal bells, program events, session exit, Settings test and CLI `notify`/`run` |
| Interface | Native desktop and Android apps with a shared bundled interface; browser client and PWA; six languages; dark, light, system and circadian themes |
| Updates | Host replaces itself in place without ending shells; desktop app and APK check, verify and install their own updates |

## Desktop client only

To connect to other hosts without installing a local host service or jaunt CLI:

```sh
bash -o pipefail -c 'curl -qfL --connect-timeout 10 --max-time 120 https://moukrea.github.io/jaunt/install.sh | bash -s -- --client-only'
```

This installs the same desktop application and launcher, with remote pairing, sessions, files, notifications and automatic app updates. It does not start a daemon or show local host controls. It does not uninstall a previously installed host. Run the normal host installation command to enable local host integration later.

The installed browser application is named **jaunt (PWA)** so it can be distinguished from the native **jaunt** app. Both use the original transparent logo. Native Android uses the same artwork without a bundled dark background; individual launchers may apply their own icon treatment.

## Shared desktop workspace

Open **jaunt** from the host's applications menu or run `jaunt gui`. Host and remote clients share the same ordinary shells without tmux. **New shell** opens an automatically named shell immediately, inheriting the previous active shell’s current directory. The folder button lets you browse the host’s directories and optionally name the new shell. **Sessions** lists running and exited sessions: open, rename, close only your view, or explicitly terminate a shell for everyone. You can also rename a tab by double-clicking its title, or double-click a pane’s title (Enter saves, Escape cancels). The split picker opens right under the split button you clicked. Drag tabs to reorder them; selecting a tab never changes its position. The device you interact with controls the shared terminal size.

The two **split icons** arrange panes side by side or above/below on desktop, using a new or existing session. Each pane can move into its own tab. Layouts survive reopening; mobile displays their sessions as normal tabs. The desktop sidebar can collapse, with the preference retained. Settings includes friendly host names, ordering and the default host, dark/light/system/circadian themes, and notification controls. Host settings follow the selected machine immediately, including its identity and update controls. The native desktop app also manages the local host service and pairs to other hosts; local service controls appear only for the local host, while desktop application updates remain separate. See the [workspace guide](docs/WORKSPACE.md) and [validation report](docs/WORKSPACE_VALIDATION.md).

**Agents and machines.** Four switches per host let Claude Code and Codex sessions work across your machines under your rules: run commands or open leased background shells on linked machines, type into shells of this host or of linked machines (once you allow it for that shell), and exchange messages with sessions on other machines, whatever their runtime. Machines paired on the same device are linked by themselves; each requester (host × runtime) gets its own rights on the target — ask every time (approval on any of your devices or the CLI), trust for 1 h, 24 h or always, or block, plus allow-lists — with a journal. Sessions only learn about machines by calling a tool; nothing is injected into their context. See the [agents and machines guide](docs/AGENTS.md).

**Claude Code ↔ Codex bridge.** When both `claude` and `codex` are installed on a host, Settings shows one switch. Turned on, real Claude Code and Codex sessions opened in jaunt shells on the same project automatically know about each other (as ordinary hook context) and can message each other's open conversation, at your request or on their own initiative. Off by default; turning it off removes everything jaunt added to both runtimes. See the [bridge guide](docs/BRIDGE.md).

## Image handling

Progress stays visible during upload and clipboard/path delivery. Completed operations collapse into a compact result; **Show history** retains the details. Cancelling a transfer is shown as cancellation, and errors stay with their operation. The final result states exactly what happened; errors stay visible with a retry action. A successful path insertion or Ctrl+V delivery does not prove that Claude Code or Codex recognized an attachment.

**Paste:** when a native backend is available, an image is uploaded to the host clipboard and pasted into the selected session with Ctrl+V. If the browser returns an empty clipboard, the UI offers a rich paste area and image picker. Attach retains both explicit modes. No Enter key is sent.

**Fallback with an active connection:** select or paste an image, upload it to the host, and insert its properly escaped path into the terminal. Nothing submits the command automatically. Claude, Codex, or another tool can read the file if its own mode supports it.

**Conditional native paste:** when the host has an accessible graphical clipboard (macOS, Wayland with `wl-clipboard`, or X11 with `xclip`), jaunt puts the PNG there and sends Ctrl+V to the terminal. jaunt shells receive the display variables of the graphical session (DISPLAY, WAYLAND_DISPLAY, XAUTHORITY) even when the host was started by systemd at boot, so the program reading the clipboard sees the same display. On a Wayland session, install `wl-clipboard`: Claude Code reads the Wayland clipboard with `wl-paste`, and Settings → Host clipboard says so when it is missing. This also depends on the CLI tool's shortcut and behavior. **On a headless host, jaunt cannot manufacture a native Claude/Codex attachment: it falls back to a file and its path.** HEIC and other formats the browser cannot decode can still be transferred as files, but are not converted to PNG.

## Automatic updates

| Component | Update behavior |
|---|---|
| Host / CLI | Same installation. Checks the published channel every 15 minutes, verifies downloads and replaces compatible runtimes without ending shell processes. Transfers finish first. Settings or `jaunt update` checks immediately. Older hosts without runtime handoff defer while ordinary shells are active; ending those shells still requires explicit confirmation. |
| Desktop app | Separate version from the host. Every launch checks the published version and, when a newer one exists, asks **Update now** or **Ignore** (ignore lasts for that run); with automatic updates on, the update is downloaded and verified in the background and installs when you close the app or when you accept. Settings provides a manual check, an automatic-update toggle and **Install and reopen**. Updating the GUI does not stop the host or its shells. System packages may request OS authorization. |
| Android APK | Every launch checks for a new APK and asks **Update** or **Ignore**; later foregrounds re-check at most every six hours. A visible check/download dialog leads to Android’s installation confirmation. The APK’s checksum and signing certificate are verified; Android does not permit silent self-installation. |
| Web client | Uses the version published on Pages. Reopen/reload to activate a downloaded service-worker update. |

Existing installations need the release containing their updater before that updater can run. Re-running the official host command updates the host and installs the advertised desktop app; it refuses to silently close active ordinary shells. Pairing keys are retained. See [updates and restart protection](docs/UPDATES.md).

## Connection and operation feedback

A network interruption has one persistent connection banner with a retry action. jaunt reconnects using the saved device key; it does not replay unsent terminal input. Revocation and failed host verification stop the connection and explain the next step. Errors in a dialog stay in that dialog; other action errors remain visible until dismissed. Short confirmation toasts are deduplicated and limited to two.

Each device caches what it renders, keyed by the host's absolute stream offsets, and rebuilds the terminal with earlier output when you scroll to the top ("Loading earlier output…"), asking the host only for the parts it never received. Each device receives only the output of the terminals it displays: hidden tabs, other hosts' tabs and a backgrounded app cost nothing on the link, and a terminal shown again catches up with a bounded tail (full-screen programs redraw). Output is acknowledged as rendered and the host keeps a bounded amount in flight per viewer, so a phone on a poor link is never buried under a backlog and its round trips stay short. Notifications are detected on the host for every terminal, displayed or not. Latency is measured continuously with small round trips (more often while the link is degraded, and a probe that has not come back yet already counts). From 2 s the latency figure in the top bar turns the accent colour with **High latency, expect slowness** in bold, on desktop and mobile, so a slow link is not mistaken for a bug. From 15 s a waiting overlay covers the terminals until the link settles (under 10 s); **Use anyway** lifts it for the current spike. Both tiers use hysteresis to avoid flickering.

Uploads, downloads, service installation and update checks show progress and a final result in the Activity strip, which is tinted by the state of its most important operation (running, needs attention, failed, done), shows one operation at a time unless you open the history, and only lists the selected host's operations; other hosts carry a badge in the sidebar when something of theirs needs attention. The top bar shows the host with its icon (a house for the local host, named "Local" in your language, a cloud for a remote one, or any icon you pick per host in Settings) coloured by its connection state, and clicking the host name switches to another paired host. Network pauses are explicit, transfer cancellation is available, and completed history can be expanded. Available updates provide a direct action instead of an expiring toast.

## Notifications

Enable notifications in **Settings** and use its test action. Program notification titles and text are preserved when supplied; a plain terminal bell has no message body to recover. Clicking a notification selects the corresponding host and session. Desktop notifications require the app to be running; Android uses its optional foreground connection service; the web client uses browser Web Push. Notification content may appear on the lock screen according to OS settings.

## Known limitations

- Up to 16 active shells, 32 retained views, 2 MiB of output per PTY in memory plus up to 32 MiB per shell on the host's disk (Settings → Keep terminal history on disk), and 50,000 xterm scrollback lines (20,000 on phones). A device renders the last 128 KiB when it opens a terminal and loads earlier output lazily when you scroll to the top, from its local cache first (IndexedDB, up to 32 MiB per shell and 256 MiB in total, dropped when the shell ends) and from the host for what it never saw. A viewer on a slow link or a slow device is fed the freshest output in bounded slices; the bytes it skipped are still on the host and are fetched when it scrolls back. Copy-all covers what is rendered.
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
python tests/client_update_e2e.py    # Browser-driven host self-update, pushed progress, refusal of a broken release
python tests/bridge_e2e.py           # Real Claude Code and Codex sessions discover and message each other through the bridge (uses your real accounts)
python tests/workspace_sync_e2e.py   # Shared open sessions between two clients, close-or-terminate choice, displayed-only mode
python tests/latency_e2e.py          # High and extreme latency tiers (top bar warning, waiting overlay, "use anyway")
python tests/flow_control_e2e.py     # Visible-only subscriptions, bounded per-viewer backlog on a throttled link, catch-up, notifications from hidden tabs
python tests/scrollback_e2e.py       # On-disk host history, lazy loading when scrolling up, local cache serving a reload, disk history off
python tests/agents_e2e.py           # Two hosts linked by pairing code; an MCP-driven session runs commands on the other under ask / trust / block
python tests/agents_ui_e2e.py        # Linking from Settings, approval modal answered from the browser, requester table
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
