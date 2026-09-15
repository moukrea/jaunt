# Shared terminal workspace

Every shell belongs to the host daemon, not to the window that created it. The desktop app, Android app, and authorized browsers can attach to the same ordinary PTY at the same time. tmux is optional. Existing terminals created outside jaunt are not retroactively adopted; create a jaunt shell or explicitly attach an existing tmux session.

## Sessions and views

**New shell** immediately creates a terminal with an automatic name, such as `bash 1`. Its directory follows the previously active shell, including `cd` changes on supported hosts. The folder icon opens **New shell in folder**, with directory browsing and an optional name. If the OS cannot read a shell’s current directory, the host uses that shell’s initial directory.

Use **Sessions** beside the tabs to see every retained session on the selected host, including sessions with no open view. The list shows whether each shell is running and which devices have it open.

- **Rename** changes the shared session name. Double-click a tab name or click a pane title to rename it too.
- **Open** attaches this device to the existing shell and its retained history.
- The tab's **×** or **Close view** detaches only this view. The shell and other clients remain connected.
- **Terminate** asks for confirmation, then ends the shell and its jobs for all viewers. For tmux it explicitly kills that tmux session, including attachments outside jaunt.

Ordinary termination covers processes in the shell's POSIX terminal session, including background job-control groups. A process deliberately daemonized into a separate operating-system session is outside that boundary. Session termination is not a general process/container sandbox.

Exited shells retain their wait status until the session is removed, reserving the leader PID so that surviving background jobs can still be terminated safely.

Closing the app, losing a network connection, or locking its vault does not terminate shells. Plain shells do not survive a host daemon restart or reboot. Automatic host updates wait for ordinary active shells; explicitly authorizing an update/restart can terminate them. tmux remains available when restart-independent persistence is needed.

## Shared dimensions and scrolling

Each session has one PTY size. Clicking/touching or typing in a view makes that device control its size. Resizing a passive window does not steal control. Passive views retain the shared geometry and may scroll horizontally or vertically when the other device's terminal is larger. Click inside to fit it to your screen.

The terminal's measured inner element has no padding; surrounding UI margins are excluded from its row/column count. The footer, action keys, Android bars, and keyboard reserve their own space. The **↓ Latest** button returns to recent output; scrolling upward remains possible while output continues. **Select** opens a native text control for mobile selection handles and copying retained terminal text. Desktop mouse selection and Ctrl/Command+Shift+C remain available.

xterm 6 supports synchronized output (DEC mode 2026). Application-specific alternate-screen behavior still applies: the alternate screen is not an unlimited scrollback buffer. A terminal program can intentionally clear its own screen or choose to disable its own history. jaunt does not rewrite that program's escape sequences into fabricated output.

## Tiled tabs

On desktop, the two split icons choose side-by-side or above/below placement. Their inline chooser offers a new shell or any session outside the current split group. Drag the divider, or focus it and use arrow keys. Each tab can contain a split tree; selecting another tab preserves previous groups. The **Move pane to its own tab** icon in each pane header separates it without terminating any session.

Layouts, ratios, open views, host order, friendly names, and the default host are stored in this device's vault. They survive reconnection and app reopening. On mobile, each session in a split group appears as an ordinary tab; returning to desktop width restores the split arrangement. Layout preferences are per client, so one device does not rearrange another device's workspace.

## Desktop installation and host controls

The graphical host installer installs the desktop application for the current user when a desktop release is advertised. Existing hosts can use `jaunt gui` to install/open it, or `jaunt gui --install-only` to add the application launcher without opening a window. Linux packages and macOS applications are also provided in the desktop release. The application is named **jaunt** and uses the supplied artwork.

The desktop interface is the same bundled interface as the web client, with an additional **This computer** settings group: install/update the host, start it, install its login service, pair another device, and explicitly authorize an update/restart. It can also pair to other hosts as a normal client. Local shells are accessible through a private same-account Unix socket without requiring a relay connection; remote clients still authenticate through the encrypted relay.

Linux user-space archives rely on the system permitting Chromium's user-namespace sandbox. On Ubuntu restricting that mechanism, `jaunt gui` and the graphical installer automatically select the `.deb` package and request system authorization if required. The package configures its scoped AppArmor profile. Production launchers never add `--no-sandbox`. macOS desktop artifacts are unsigned; OS trust prompts may apply. Closing the desktop window leaves the daemon and shells running. Desktop notifications require the desktop app to remain running.

## Preferences and notifications

Settings uses a gear icon. Dark is the default. Light, System, and Circadian are also available; Circadian uses light from 07:00 until 19:00 in the device's local time zone. Terminal font preferences remain shared across that client's panes.

Each host exposes event switches for terminal bells, program notifications (OSC 9 and OSC 777), and session exit. These switches affect that host's event generation. Enable delivery separately on each client: native Android background notifications, browser Web Push, or desktop OS notifications. `jaunt notify` and `jaunt run -- command` remain available for explicit notifications and individual command completion. The shell cannot reliably infer every application's notion of “finished thinking.”

Notifications omit terminal output by default. Browser/OS permissions, force-stop, battery policies, network availability, and the host being online affect background delivery. No guaranteed delivery or independent security audit is claimed.

Program notifications preserve OSC 9 message text and OSC 777 title/body. Clicking a native notification selects its host and session, including after reconnecting or unlocking. Android follows the OS lock-screen privacy settings. Terminal output is not scraped to invent notification text.

Interface pictograms use pinned, locally bundled Lucide icons (ISC license). The supplied jaunt artwork remains the application logo; Linux packages include standard icon sizes and Android uses an adaptive launcher wrapper around that artwork.

## Updates and visible progress

Host/CLI and desktop versions are separate. The host checks automatically and waits for ordinary shells and transfers to finish before restarting. The desktop checks on startup and every 15 minutes, verifies downloads, and installs when its window closes. Settings offers manual checks and Install and reopen. Desktop installation preserves the app's saved machines and does not stop host shells; system packages may require an OS authorization prompt. Android verifies its APK and signing identity before handing installation to Android.

The activity strip remains visible through image preparation, upload, verification and insertion. Completion distinguishes a path inserted without Enter from a PNG placed in the host clipboard with Ctrl+V sent. It never promises that a specific CLI recognized an attachment. Update checks report current, installed, waiting for active shells, or failed; completed/error results remain until dismissed.
