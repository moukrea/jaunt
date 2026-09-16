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
