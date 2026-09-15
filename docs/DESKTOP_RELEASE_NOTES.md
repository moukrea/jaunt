# jaunt desktop 0.1.0-beta.10

A native desktop application sharing the same responsive UI as the browser and Android client, with local host controls. Local and remote devices attach to the same ordinary shells without tmux. Desktop tabs support persistent, resizable split panes; mobile layouts show those sessions as separate tabs.

**Sessions** lists running and exited sessions, opens existing shells, closes only a view, or explicitly terminates a shell and its jobs for all viewers. Clicking or typing selects which device controls the shared terminal size.

The app uses the original jaunt artwork, dark/light/system/circadian themes, friendly host names/order/defaults, and optional private OS notifications. It can start an installed host service and connect to other hosts. The official installer also offers `--client-only`, which installs the desktop client without a local host or local host controls.

Linux: install the `.deb` or `.rpm`, or use `jaunt gui` for a verified per-user archive installation. macOS: open the matching CPU's application archive/disk image, or use `jaunt gui` from an installed host. Desktop builds are unsigned on macOS. No launcher disables Chromium's sandbox. Notifications require the app to be running.

The protocol has not received an independent security audit. See `docs/WORKSPACE.md` and `docs/WORKSPACE_VALIDATION.md` for behavior, observed tests, and remaining validation limits.

This update replaces interface pictograms with Lucide, displays program notification text, and retains notification targets through reconnects. Linux packages contain standard icon-theme sizes and readable launcher metadata. On Ubuntu with restricted user namespaces, the host installer selects the system package to configure sandbox support.

Session controls now keep Open, Rename, Close view and Terminate inside each responsive session card. New shell creates an automatically named terminal immediately. New shell in folder offers directory browsing and an optional name. The host can inherit the active shell’s current directory. Desktop has separate side-by-side and above/below split controls, an inline choice of new or existing sessions, and a button to move each pane into its own tab. Mobile retains ordinary session tabs. Closing a view keeps its shell alive; termination still requires explicit confirmation.

The desktop app now checks for updates automatically, downloads and verifies the matching release, and installs it when you close the app. Settings offers Check desktop update, an automatic-update toggle, and Install and reopen when ready. System installations may ask for OS authorization. This updates the interface separately from the host and does not stop host shells. Uploads and update checks now show visible progress and a retained result instead of only a starting toast.

Connection interruptions now share one persistent status banner. Late asynchronous handshake results cannot overwrite a replacement connection. Dialog errors stay inline; action errors persist without toast cascades. Transfers expose waiting/cancellation/completion, completed activity collapses into accessible history, and update availability keeps its action visible.

This release fixes Settings layout, stable tab ordering, double-click renaming, reconnect/update feedback, and mobile scroll anchoring. It adds a persistent collapsed sidebar and six system-detected languages with an explicit override. The window title is simply `jaunt`. Claude and Codex foreground sessions use locally bundled Meteor brand icons.
