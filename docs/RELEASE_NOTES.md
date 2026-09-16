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
