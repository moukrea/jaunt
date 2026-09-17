# jaunt desktop 0.1.0-beta.27

- Bundles the beta.33 interface (agent shells listed in Settings with Kill).

# jaunt desktop 0.1.0-beta.26

- Bundles the beta.32 interface (Agents and machines settings, approval modal).

# jaunt desktop 0.1.0-beta.25

- Bundles the beta.31 client (no client change).

# jaunt desktop 0.1.0-beta.24

- Archive updates no longer fail on a leftover staging directory; bundles the beta.30 client (channel re-keying on desync).

# jaunt desktop 0.1.0-beta.23

- Checks the published version at every launch and asks Update now / Ignore; an `available` state announces a version without downloading when automatic updates are off.

# jaunt desktop 0.1.0-beta.22

- Bundles the beta.28 interface (lazy scrollback with a local IndexedDB cache).

# jaunt desktop 0.1.0-beta.21

- Bundles the beta.27 interface (host icons, "Local" host name).

# jaunt desktop 0.1.0-beta.20

- Bundles the beta.26 interface (visible-only terminal subscriptions, acknowledged output).

# jaunt desktop 0.1.0-beta.19

- Bundles the beta.25 interface (host symbol and switcher in the top bar, tinted per-host activity strip).

# jaunt desktop 0.1.0-beta.18

- Bundles the beta.24 interface (split picker under its button, Enter/Escape in rename).

# jaunt desktop 0.1.0-beta.17

- Bundles the beta.23 interface (top bar no longer turns orange at normal latency).

# jaunt desktop 0.1.0-beta.16

- Bundles the beta.22 interface (latency tiers). No desktop-specific change.

# jaunt desktop 0.1.0-beta.15

- Bundles the beta.21 interface: *System* language entry, refreshed public page copy. No desktop-specific change.

# jaunt desktop 0.1.0-beta.14

This update fixes the first-use issues of the workspace features (touch swipe over a tab scrolls the strip, split with an existing session under shared open sessions, Enter after an inserted text) and keeps the workspace refinements of host beta.19: shared open sessions per host (same tabs, panes and active session on every client and on the host itself) with the *Only displayed sessions exist* sub-option, a Close view / Terminate session choice on the × of tabs and panes, direct pane closing, a held press before dragging a tab on a scrolling tab strip, switch-style settings toggles, and the *New shell in folder* button next to *New shell*. It keeps the **AI sessions** settings group for the selected host: one switch for the Claude Code ↔ Codex bridge (shown only when both runtimes are installed on that host), the list of bridged sessions, and activity rows for cross-runtime messages with their real delivery state. See `docs/BRIDGE.md`.

It keeps the beta.11 update experience: pushed host update progress, *Updating host · shells are kept* during the in-place runtime restart, fast local bridge reconnection.

A native desktop application sharing the same responsive UI as the browser and Android client, with local host controls. Local and remote devices attach to the same ordinary shells without tmux. Desktop tabs support persistent, resizable split panes; mobile layouts show those sessions as separate tabs.

Linux: install the `.deb` or `.rpm`, or use `jaunt gui` for a verified per-user archive installation. macOS: open the matching CPU's application archive/disk image, or use `jaunt gui` from an installed host. Desktop builds are unsigned on macOS. No launcher disables Chromium's sandbox. Notifications require the app to be running.

The protocol has not received an independent security audit. See `docs/UPDATES.md`, `docs/BRIDGE.md` and their validation reports for behavior, observed tests and remaining limits.
