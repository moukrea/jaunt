# jaunt 0.1.0-beta.28

Scrollback, designed rather than patched, after beta.26's bounded replay left older output unreachable:

- The host keeps each shell's output on disk (up to 32 MiB per shell, 8 MiB segments named by absolute offset, private 0600 files in the jaunt state directory; survives in-place host updates; deleted when the shell ends). Settings → *Keep terminal history on disk* turns it off, which deletes the files and keeps only the 2 MiB in memory.
- Opening a terminal renders the last 128 KiB. Scrolling to the top loads earlier output lazily ("Loading earlier output…"), 512 KiB per step, and rebuilds the terminal with the viewport kept at the same distance from the bottom while live output is queued. xterm keeps 50,000 lines (20,000 on phones).
- Every device caches what it renders in IndexedDB (browser, Android and desktop alike; asynchronous, large, survives reloads), keyed by host room, session and absolute stream offset: reconciliation is a range check, never a diff. A resume shows the cached tail at once and asks the host only for what follows; scrolling back is served from the cache and the host is asked only for ranges the device never received, including the bytes a slow link skipped. Per shell 32 MiB, 256 MiB in total, least recently used shells evicted, a shell's cache dropped when it ends or the host is forgotten.
- History replies are sized to one relay frame (64 KiB); requests are sequential and paced like all traffic.
- Activity titles (host update, transfers, AI sessions) use the host's friendly name when you set one.

The protocol has not undergone an independent security audit.

# jaunt 0.1.0-beta.27

- Host icons: a house for the local host and a cloud for remote hosts replace the monitor and globe. Each host can carry any icon of the icon set (about 2,100 Lucide icons), chosen in Settings → selected machine → Icon with a search; the choice is stored on the device and shows in the sidebar, the top bar, the host menu and toasts. *Default* restores the house or cloud.
- The local host is named "Local" in the app language instead of "This computer"; a friendly name set by the user still wins.

The protocol has not undergone an independent security audit.

# jaunt 0.1.0-beta.26

Performance on slow links and on phones, after a field report of 50 s round trips, endless "Restoring shell…" and RPC timeouts with five Claude Code sessions open (measured: ~25 KB/s and ~90 PTY writes per second at idle, far more while working; every write became one relay frame per client; no flow control; relay disconnections at the 180 frames/s limit; full 2 MiB replays on every resume).

- A device receives only the output of the terminals it displays. Hidden tabs, other hosts' tabs and a backgrounded app are detached on the host and cost nothing on the link; a terminal shown again catches up with a bounded tail (at most 128 KiB, full-screen programs redraw). Notifications are still detected on the host for every terminal.
- Per-viewer flow control: the client acknowledges output as xterm renders it, the host keeps a bounded window in flight (slow-start 128 KiB → 512 KiB, collapsing to 32 KiB when a viewer falls behind, remembered per device across tabs) and feeds a viewer that cannot keep up with the freshest slice only. Round trips, RPCs and uploads no longer queue behind terminal output. Validated in `tests/flow_control_e2e.py` on a 200 KB/s throttled link against a 400 KB/s producer.
- PTY reads are coalesced (up to 30 ms / 64 KiB) into one relay frame per viewer, keeping chatty TUIs under the relay's frame budget. The relay close code and reason are now logged when the host is disconnected.
- No "extreme latency" overlay while a terminal is being restored: the restore itself is the message.
- Host clipboard: the display is discovered from its sockets (`wayland-*`, `/tmp/.X11-unix`, Xwayland auth) at call time, so a host started by systemd before the graphical session, or updated in place, offers native image paste again instead of the path fallback.

The protocol has not undergone an independent security audit.

# jaunt 0.1.0-beta.25

- Top bar: the host is shown with a monitor icon (local host) or a globe (remote host) coloured by its connection state (green online, accent while connecting or reconnecting, red offline). The "Encrypted" label, its dot and the top New shell button are gone (the tab strip keeps New shell). Clicking the host name opens a menu to switch to another paired host. Latency stays on the right and is visible on mobile too.
- High latency no longer recolours the whole bar: the latency text itself turns the accent colour with the bold warning.
- Toasts about a host (program notifications, shared clipboard, revocation, test delivery) carry the host's name and icon, so a notice is never ambiguous with several hosts paired.
- Activity strip: tinted by the state of its most important operation (blue running, accent needs attention, red failed, green done), one operation shown at a time unless the history is opened, and only the selected host's operations; other hosts show a badge on their sidebar entry when something of theirs is running or needs attention.

The protocol has not undergone an independent security audit.

# jaunt 0.1.0-beta.24

- The split picker (new shell or existing session for the second pane) opens right under the split button that was clicked, left edges aligned, instead of at the far side of the terminal. It closes on Escape or a click elsewhere.
- Rename terminal dialog: Enter saves, Escape cancels; a Cancel button sits next to Save. The New terminal dialog also submits on Enter from its name or directory field.

The protocol has not undergone an independent security audit.

# jaunt 0.1.0-beta.23

- Fix: the top bar could turn the accent colour at normal latency (86 ms) without the warning text. The high-latency class was toggled with a non-boolean value on machines that had never been slow, and `classList.toggle` flips the class on every render in that case. Strict booleans now; the latency e2e checks that repeated normal renders never show the warning.

The protocol has not undergone an independent security audit.

# jaunt 0.1.0-beta.22

- Latency tiers. The client measures round trips continuously (more often while the link is degraded; an outstanding probe already counts). From 2 s the top bar turns the accent colour with **High latency, expect slowness** in bold next to the figure and the New shell button, on desktop and mobile, so slowness is not taken for a bug. From 15 s a waiting overlay with a spinner covers the tabs and terminals until the link settles (under 10 s); **Use anyway (expect lag and a rough experience)** lifts it for the current spike. Hysteresis on both tiers. Covered by `tests/latency_e2e.py` in CI.

The protocol has not undergone an independent security audit.

# jaunt 0.1.0-beta.21

- Public page and README rewritten around what jaunt actually does: several hosts in one workspace, shells and files on each, sessions that follow you across screens, the Claude Code ↔ Codex bridge, browser/Android/desktop clients. No new capability is claimed; the wording is stated plainly.
- The preview on the public page is now clearly interactive: two example hosts, a Files view, Claude Code and Codex tabs that look like the real TUIs, the phone mirrors what you click, the stage leans with the pointer (from its resting angle; disabled with reduced-motion), and the phone shows the current time. GitHub link with its icon.
- Language: the public page shows the language it detected instead of "System language"; in Settings the automatic entry is simply called *System*.
- Bridge: the roster injected into a session now states that it lists only sessions of the other runtime, and names the other sessions of the same runtime open on the project (not bridged by jaunt; on Claude Code, ListAgents / SendMessage reach them). Reported by a Claude Code session that took the cross-runtime list for the full list of agents. The `jaunt_peers` description says the same.

The protocol has not undergone an independent security audit.

# jaunt 0.1.0-beta.20

Fixes after the first use of the beta.19 workspace features, then the beta.19 changes themselves:

- Splitting a pane with an existing session works again with shared open sessions on: the host stored layouts in the wrong shape and collapsed the split. Concurrent clients no longer overwrite each other's newer workspace: an update based on an older revision is refused and the client re-applies the host's state.
- On touch screens, a swipe over a tab scrolls the tab strip (a non-passive touch listener blocked panning); the held press still reorders.
- *Send Enter after inserting* waits a moment after the text so TUI programs read a submit, not a newline; its checkbox is a switch.
- Bridge: a Claude Code session keeps its identity after `/clear` (the MCP server carried the old conversation id), bridge participants survive host updates (no more "not yet reachable" right after an update), and the `jaunt_send` description tells models not to wait for a reply to a greeting.

beta.19 workspace refinements:

- **Shared open sessions** (per host, Settings → selected machine): every client and the host itself show the same tabs, panes and active session; a change made anywhere follows everywhere. The host keeps that workspace and prunes it when sessions end. Sub-option **Only displayed sessions exist**: closing a tab or pane terminates its shell, the Sessions list and the close-or-terminate choice disappear for that host.
- The × on a tab or a pane opens a small choice, *Close view* (the shell keeps running) or *Terminate session*, instead of always sending the session to the background.
- Panes in a split view can be closed directly from their caption; moving a pane to its own tab remains available.
- On touch screens, when the tab strip scrolls horizontally, a tab must be held still for a moment before it can be dragged, so a swipe scrolls the strip as expected.
- Settings toggles are switches. The *New shell in folder* button sits next to *New shell*, on the right of the tab strip.

The Claude Code ↔ Codex bridge keeps the beta.18 behaviour (permission-class attestation, no double replies). The protocol has not undergone an independent security audit.
