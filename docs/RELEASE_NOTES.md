# jaunt host 0.1.0-beta.43

- fix(cli): bound language prescan to global arguments (JAU-61) (#86)
- Source: `8136fc7a8aa6333b35f0140ef532c2cedb51e53b`.

# jaunt 0.1.0-beta.41

**Settings that stay inside their section, and a requester's level within reach.** Each settings section now holds its own list instead of letting it spill under the separator into the next one, so what you read belongs to the heading above it. *Reachable machines* folds, and its pairing-code field moves into a modal opened on demand: machines paired on your device link by themselves, so the code is the exception, not the default path. In the requester table, the level badge of a right opens the choice directly — ask, trust for a while or always, block — and each row carries its own revoke, without going through the multi-select. Client only: the host is unchanged apart from its version.

The protocol has not undergone an independent security audit.

# jaunt 0.1.0-beta.40

**Each machine has its own settings, and the activity strip forgets what no longer matters.** The bar of the machine you are looking at now carries a gear: what that machine does and allows lives there — connection, version and updates, workspace, clipboard, authorized devices, AI sessions, agents and machines, the notifications it sends. The app settings keep what belongs to this device: security, terminal, and a *Your machines* group to name, re-icon, reorder your machines and choose which one opens at start. Next to the gear, a bell: an operation that ends without needing you leaves the activity strip after a minute, while a failure or something waiting for an answer is kept there with a badge, which also counts into the machine's badge in the sidebar. The terminal key row (Esc, Tab, Ctrl…) now appears only where there is no real keyboard: phone-width browsers and the Android app. The sidebar drops its decorative *Private by design* note.

The protocol has not undergone an independent security audit.

# jaunt 0.1.0-beta.39

**Tools that point at the right channel, and answers that match reality.** jaunt adds machines to an AI session's reach; it never replaces the messaging a runtime already has for its own sessions on one machine. The tools now say so where it matters: `jaunt_sessions` flags a shell that itself runs a Claude Code or Codex session, names the identity that session answers to in its own runtime, and states that typing there drives its terminal rather than talking to it; `jaunt_type` says the same, and its result warns that a long or multi-line text arrives in such a terminal as a pasted block that Enter does not submit — the keystrokes reached the terminal, nothing more. `jaunt_sessions` also reports the shell's current directory instead of the one it started in. And an approval nobody answered is now an **expiry**, distinct from a denial, in the journal and in the message the caller gets. Reported by a Claude Code session that had announced a message as sent when it had only been typed. Host only; the clients are unchanged.

The protocol has not undergone an independent security audit.

# jaunt 0.1.0-beta.38

**Unregistered sessions on other machines are named.** `jaunt_peers` now also lists, per linked machine, the Claude Code or Codex programs open in jaunt shells that have not registered with jaunt there, instead of showing nothing (the target host already sent them; the requester host dropped them). Settings no longer claim that such a session "was started before the bridge": Codex only runs its hooks from the first prompt on, so the note now says it joins at its next prompt, and that a session started before the switch needs a restart or `/clear` first. Validated live between two real hosts (commands, long output, background shell, typing into a remote and a local shell, messages both ways).

The protocol has not undergone an independent security audit.

# jaunt 0.1.0-beta.37

**Codex hooks now register without a review prompt.** Codex runs a hook from `hooks.json` only after it has been trusted; otherwise it skips it silently, which left every Codex session invisible to the bridge and to messages across machines on hosts where that review never happened (reported by a Claude Code session diagnosing a linked host). Turning the switch on now records the trust of jaunt's own hook in Codex's `config.toml`, exactly as Codex's TUI would (same hash, verified against hashes Codex 0.154.0 wrote itself), and removes it when the switch goes off; nothing else in that file is touched. Also: `jaunt_peers` names, per machine, the Claude Code or Codex programs open in jaunt shells that have not registered, instead of reporting nothing; its wording says what the registry knows rather than stating that no session exists; a delivery report says Claude Code may hold the message for review; every hook run touches `bridge/last-hook-codex` so "installed but never triggered" is visible; an unknown terminal id is reported as such. Host only; the clients are unchanged.

The protocol has not undergone an independent security audit.

# jaunt 0.1.0-beta.36

**Agents and machines: one switch per capability, and messages across machines.** The single switch becomes four, each off by default and decided per host: *Commands and background shells on linked machines*, *Typing into shells of this host*, *Typing into shells across machines*, and the new *Messages between sessions across machines*. Existing hosts keep what they had (the three shell capabilities on if the old switch was on). With messages on, a Claude Code or Codex session lists, through `jaunt_peers`, the sessions open in jaunt shells on linked machines that allow it too, and writes to them with `jaunt_send(to="<machine>/<id>")`, whatever the runtime on either side: the message lands in the session's own conversation exactly as with the local bridge, with its provenance and the machine it comes from; replies travel back and reach a waiting call. Nothing is injected into any session's context. CLI: `jaunt agents features`, `jaunt agents enable|disable <capability>`. Validated with stand-in runtimes on two real hosts (`tests/agents_e2e.py`, 25 checks) and in the browser (`tests/agents_ui_e2e.py`, 10 checks).

The protocol has not undergone an independent security audit.

# jaunt 0.1.0-beta.35

**Agents and machines, phase 4: allow-lists.** A requester that asks before each command can carry rules: whole commands or patterns with `*` and `?`. A matching one-shot command runs at once and is journaled with its rule; everything else still asks. Add a rule from the approval modal (*Always allow this command*), from the requester table in Settings (*Rules…*: list, add, remove) or from the CLI (`jaunt agents rule <requester> --pattern 'npm test *'`). Rules never cover background shells or typing, and are ignored while a requester is trusted or blocked. Sessions see their pre-approved commands in `jaunt_hosts`. This closes the four planned phases of Agents and machines. Validated on two real hosts (`tests/agents_e2e.py`, 21 checks) and in the browser (`tests/agents_ui_e2e.py`, 10 checks).

The protocol has not undergone an independent security audit.

# jaunt 0.1.0-beta.34

**Agents and machines, phase 3: typing into your existing shells.** The second right, *Write into a shell*, is live. A Claude Code or Codex session can list the jaunt shells of a linked machine, or of its own host (`jaunt_sessions`), type into one as if at its keyboard (`jaunt_type`) and read what the terminal shows (`jaunt_output`, plain text). The owner is asked once per shell (the modal names the shell and shows the text; *Allow for this shell*), or trusts the requester, or blocks it, independently of the right to run commands. A shell an agent may type into carries a lightning badge on its tab; clicking it cuts the agent off, and even a trusted requester must then ask again for that shell. A session never types into its own shell; local requesters appear as *Claude Code on this machine*. Every keystroke is journaled. Validated on two real hosts (`tests/agents_e2e.py`, 19 checks) and in the browser (`tests/agents_ui_e2e.py`, 8 checks).

The protocol has not undergone an independent security audit.

# jaunt 0.1.0-beta.33

**Agents and machines, phase 2: background agent shells.** `jaunt_shell` gives a session its own shell on a linked machine for a sequence of steps that share state: open (one approval in ask mode), send, read from an offset, close, list. Started like a jaunt shell but never a session — no tab, no Sessions entry, no sharing — it lives by a 10-minute lease renewed by every call and dies without exception when closed, when the lease expires, when the jaunt session that opened it ends, when the requesting host stays disconnected for two minutes, when the requester is revoked or blocked, and when the host stops. Two per requester, eight per host. Settings lists live agent shells with *Kill*; the journal records every open and close with its reason. Validated on two real hosts (`tests/agents_e2e.py`, 14 checks) and in the browser (`tests/agents_ui_e2e.py`, 6 checks).

**Nothing to pair twice.** A device paired with several hosts links them among themselves as soon as the switch is on: it asks the target for a one-use code and hands it to the requester host with the friendly names and icons it uses, so the requester shows up on the target as *host: my-laptop* and the target is listed on the requester under its own label and icon; renaming or re-iconing a machine follows. The pairing-code field remains, folded, for a machine that is not paired on any device. Linked hosts are confined to the agent methods on the target.

The protocol has not undergone an independent security audit.

# jaunt 0.1.0-beta.32

**Agents and machines, phase 1.** A second switch per host, off by default and independent of the Claude Code ↔ Codex bridge (which is untouched: no context injected, no message across hosts).

- Link two hosts with one pairing code (`jaunt link <code>`, or Settings → Agents and machines → Linked machines): host A enrolls on host B as a device of kind *host*, with the same handshake, channel and relay as a phone; revocable in B's devices.
- Claude Code and Codex sessions on A get `jaunt_hosts` (linked machines and what they allow), `jaunt_run` (one bounded command on a linked machine) and `jaunt_read` (chunks of a run's full output). A refusal is a distinct outcome, never a failed command.
- The target decides. Each requester (host × runtime) has its own level per right — *Run commands* now, *Write into a shell* reserved for phase 3: ask every time (approval modal on any device showing the target, push notification, or `jaunt agents allow|deny`; refused after 2 minutes; first answer wins), trust for 1 h, 24 h or always (with a confirmation), or block. Requester table with multi-select modify and revoke, revoke all, pending requests and a journal of the last 200 decisions, commands and refusals.
- Bounds: 60 s default and 600 s max, 64 KiB inline, one command at a time per requester, 20 per minute, full output kept 24 h on the target and readable in 64 KiB slices.
- Validated with two real hosts and the MCP server driven as Claude Code starts it (`tests/agents_e2e.py`, 10 checks) and in the browser (`tests/agents_ui_e2e.py`, 5 checks). See docs/AGENTS.md.

The protocol has not undergone an independent security audit.

# jaunt 0.1.0-beta.31

- Host update safety: the installer never removes the runtime directory that the live daemon executes. Before, it kept only the installed pointer and the newest other version by date, so a host whose in-place handoff had failed (daemon still on version N, N+1 and N+2 installed) lost its own files: lazy imports failed, `jaunt update` answered `[Errno 2] No such file or directory: …/bin/python`, and the host was unusable until restarted. The daemon now also runs its updater with the installed interpreter when its own is gone, and `jaunt update` / `jaunt doctor` say plainly that the service must be restarted to load the installed version.

The protocol has not undergone an independent security audit.

# jaunt 0.1.0-beta.30

- Secure channel: a rejected out-of-order frame no longer stops the connection for good. The client re-keys with a fresh handshake (up to three times in a row) and the message now carries the counters (`expected N, got M`) so a persistent case can be diagnosed. The host closes its relay socket when a send times out, instead of continuing with counters it cannot trust.
- Native image paste: jaunt shells now receive the graphical session's display variables (DISPLAY, WAYLAND_DISPLAY, XAUTHORITY) even when the host was started by systemd at boot, so Claude Code's own clipboard read sees the same clipboard jaunt writes to. On a Wayland session without `wl-clipboard`, Settings → Host clipboard and the paste dialog say what to install. Existing shells need to be reopened to get the variables.
- Desktop (archive installs): a leftover staging directory that cannot be removed no longer fails an update that was installed (`ENOTEMPTY … resources`).

The protocol has not undergone an independent security audit.

# jaunt 0.1.0-beta.29

- Fix (beta.26 regression): a coalesced PTY read could reach 96 KiB, exceed the relay frame limit and be dropped after sealing, leaving the client with a counter gap and the fatal "Out-of-order or replayed frame" banner. Output is now sent in frames of at most 48 KiB, live and during catch-up, and a frame the relay would refuse is rejected before sealing.
- Desktop: a closed local bridge first shows "Reconnecting to the local host…" (2 s retries) and only speaks of an unavailable host after four failed attempts; a host replacing itself no longer looks broken.
- Desktop and Android apps check the published version at every launch. When a newer one exists, a dialog asks to update or ignore (ignore lasts for that run). Desktop: with automatic updates on, the package is downloaded and verified first and *Install and reopen* is offered; with them off, the version is only announced and *Update now* downloads it. Android: the existing download-and-install dialog is now shown at each launch instead of at most every six hours (later foregrounds keep the six-hour throttle).

The protocol has not undergone an independent security audit.

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
