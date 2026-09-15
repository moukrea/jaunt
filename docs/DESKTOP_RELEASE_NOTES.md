# jaunt desktop 0.1.0-beta.11

This update follows a host update through its pushed progress instead of polling, shows the expected runtime restart as *Updating host · shells are kept* rather than a lost host, and reconnects the local host bridge within a second after the in-place replacement. Updates started from another device or by the automatic check are shown as an ordinary activity row once they start changing the host. Settings shows the live update step, a downloaded update waiting to install, or the last failed attempt, with a single "Try again" action.

French, Spanish, Italian, Portuguese and German interface text was rewritten as native UI copy.

A native desktop application sharing the same responsive UI as the browser and Android client, with local host controls. Local and remote devices attach to the same ordinary shells without tmux. Desktop tabs support persistent, resizable split panes; mobile layouts show those sessions as separate tabs. **Sessions** lists running and exited sessions, opens existing shells, closes only a view, or explicitly terminates a shell and its jobs for all viewers.

Linux: install the `.deb` or `.rpm`, or use `jaunt gui` for a verified per-user archive installation. macOS: open the matching CPU's application archive/disk image, or use `jaunt gui` from an installed host. Desktop builds are unsigned on macOS. No launcher disables Chromium's sandbox. Notifications require the app to be running.

The protocol has not received an independent security audit. See `docs/UPDATES.md` and `docs/HOST_UPDATE_VALIDATION.md` for behavior, observed tests and remaining validation limits.
