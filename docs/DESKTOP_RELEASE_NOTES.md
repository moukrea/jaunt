# jaunt desktop 0.1.0-beta.12

This update adds the **AI sessions** settings group for the selected host: one switch for the Claude Code ↔ Codex bridge (shown only when both runtimes are installed on that host), the list of bridged sessions, and activity rows for cross-runtime messages with their real delivery state. See `docs/BRIDGE.md`.

It keeps the beta.11 update experience: pushed host update progress, *Updating host · shells are kept* during the in-place runtime restart, fast local bridge reconnection.

A native desktop application sharing the same responsive UI as the browser and Android client, with local host controls. Local and remote devices attach to the same ordinary shells without tmux. Desktop tabs support persistent, resizable split panes; mobile layouts show those sessions as separate tabs.

Linux: install the `.deb` or `.rpm`, or use `jaunt gui` for a verified per-user archive installation. macOS: open the matching CPU's application archive/disk image, or use `jaunt gui` from an installed host. Desktop builds are unsigned on macOS. No launcher disables Chromium's sandbox. Notifications require the app to be running.

The protocol has not received an independent security audit. See `docs/UPDATES.md`, `docs/BRIDGE.md` and their validation reports for behavior, observed tests and remaining limits.
