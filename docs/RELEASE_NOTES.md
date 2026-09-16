# jaunt 0.1.0-beta.19

Workspace refinements across web, desktop and Android, with one new host feature:

- **Shared open sessions** (per host, Settings → selected machine): every client and the host itself show the same tabs, panes and active session; a change made anywhere follows everywhere. The host keeps that workspace and prunes it when sessions end. Sub-option **Only displayed sessions exist**: closing a tab or pane terminates its shell, the Sessions list and the close-or-terminate choice disappear for that host.
- The × on a tab or a pane opens a small choice, *Close view* (the shell keeps running) or *Terminate session*, instead of always sending the session to the background.
- Panes in a split view can be closed directly from their caption; moving a pane to its own tab remains available.
- On touch screens, when the tab strip scrolls horizontally, a tab must be held still for a moment before it can be dragged, so a swipe scrolls the strip as expected.
- Settings toggles are switches. The *New shell in folder* button sits next to *New shell*, on the right of the tab strip.

The Claude Code ↔ Codex bridge keeps the beta.18 behaviour (permission-class attestation, no double replies). The protocol has not undergone an independent security audit.
