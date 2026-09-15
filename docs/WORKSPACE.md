# Shared terminal workspace

Every shell belongs to the host daemon, not to the window that created it. The desktop app, Android app, and authorized browsers can attach to the same ordinary PTY at the same time. tmux is optional. Existing terminals created outside jaunt are not retroactively adopted; create a jaunt shell or explicitly attach an existing tmux session.

## Sessions and views

Use **Sessions** beside the tabs to see every retained session on the selected host, including sessions with no open view. The list shows whether each shell is running and which devices have it open.

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

On desktop, use **Arrange panes** to split the active pane side by side or above/below with another session. Drag the divider, or focus it and use arrow keys. Each tab can contain a split tree; selecting another tab preserves previous groups. **Single pane** removes the active session from its group without terminating other sessions.

Layouts, ratios, open views, host order, friendly names, and the default host are stored in this device's vault. They survive reconnection and app reopening. On mobile, each session in a split group appears as an ordinary tab; returning to desktop width restores the split arrangement. Layout preferences are per client, so one device does not rearrange another device's workspace.

## Desktop installation and host controls

The graphical host installer installs the desktop application for the current user when a desktop release is advertised. Existing hosts can use `jaunt gui` to install/open it, or `jaunt gui --install-only` to add the application launcher without opening a window. Linux packages and macOS applications are also provided in the desktop release. The application is named **jaunt** and uses the supplied artwork.

The desktop interface is the same bundled interface as the web client, with an additional **This computer** settings group: install/update the host, start it, install its login service, pair another device, and explicitly authorize an update/restart. It can also pair to other hosts as a normal client. Local shells are accessible through a private same-account Unix socket without requiring a relay connection; remote clients still authenticate through the encrypted relay.

Linux user-space archives rely on the system permitting Chromium's user-namespace sandbox. On systems restricting that mechanism, install the `.deb`/`.rpm` package through the system package installer. Production launchers never add `--no-sandbox`. macOS desktop artifacts are unsigned; OS trust prompts may apply. Closing the desktop window leaves the daemon and shells running. Desktop notifications require the desktop app to remain running.

## Preferences and notifications

Settings uses a gear icon. Dark is the default. Light, System, and Circadian are also available; Circadian uses light from 07:00 until 19:00 in the device's local time zone. Terminal font preferences remain shared across that client's panes.

Each host exposes event switches for terminal bells, program notifications (OSC 9 and OSC 777), and session exit. These switches affect that host's event generation. Enable delivery separately on each client: native Android background notifications, browser Web Push, or desktop OS notifications. `jaunt notify` and `jaunt run -- command` remain available for explicit notifications and individual command completion. The shell cannot reliably infer every application's notion of “finished thinking.”

Notifications omit terminal output by default. Browser/OS permissions, force-stop, battery policies, network availability, and the host being online affect background delivery. No guaranteed delivery or independent security audit is claimed.
