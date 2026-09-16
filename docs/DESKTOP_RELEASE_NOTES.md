# jaunt desktop 0.1.0-beta.13

This update brings the workspace refinements of host beta.19: shared open sessions per host (same tabs, panes and active session on every client and on the host itself) with the *Only displayed sessions exist* sub-option, a Close view / Terminate session choice on the × of tabs and panes, direct pane closing, a held press before dragging a tab on a scrolling tab strip, switch-style settings toggles, and the *New shell in folder* button next to *New shell*. It keeps the **AI sessions** settings group for the selected host: one switch for the Claude Code ↔ Codex bridge (shown only when both runtimes are installed on that host), the list of bridged sessions, and activity rows for cross-runtime messages with their real delivery state. See `docs/BRIDGE.md`.

It keeps the beta.11 update experience: pushed host update progress, *Updating host · shells are kept* during the in-place runtime restart, fast local bridge reconnection.

A native desktop application sharing the same responsive UI as the browser and Android client, with local host controls. Local and remote devices attach to the same ordinary shells without tmux. Desktop tabs support persistent, resizable split panes; mobile layouts show those sessions as separate tabs.

Linux: install the `.deb` or `.rpm`, or use `jaunt gui` for a verified per-user archive installation. macOS: open the matching CPU's application archive/disk image, or use `jaunt gui` from an installed host. Desktop builds are unsigned on macOS. No launcher disables Chromium's sandbox. Notifications require the app to be running.

The protocol has not received an independent security audit. See `docs/UPDATES.md`, `docs/BRIDGE.md` and their validation reports for behavior, observed tests and remaining limits.
