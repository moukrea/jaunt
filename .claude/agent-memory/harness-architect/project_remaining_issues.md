---
name: remaining-issues-plan
description: Comprehensive plan for 5 remaining issues in jaunt+cairn ecosystem -- auto-reconnect, PIN pairing, daemon mode, NAT traversal, and test infrastructure. Key architectural decisions documented.
type: project
---

Plan written to `.plans/remaining-issues.md` on 2026-03-27 covering 5 issues.

**Key architectural decisions:**

1. **Auto-reconnect**: The primary blocker is likely that the Rust cairn crate does not implement SESSION_RESUME protocol handling. The full Noise XX handshake fallback should work if the browser preserves its libp2p identity seed (which it does via IndexedDB). The `tryResumeConnection()` code path is correct in structure.

2. **PIN pairing**: PIN alone cannot locate a host on the network. Recommended approach: add an HTTP pairing endpoint on jaunt-host (port 9867) that serves the full ConnectionProfile when given the correct PIN. Browser fetches this via `GET /pair?pin=<PIN>`. For Tier 1: PIN rendezvous via signaling server.

3. **Daemon mode**: IPC via Unix socket at `~/.config/jaunt/jaunt.sock`. JSON over length-prefixed frames. Commands: `daemon`, `pair`, `status`, `unpair`. Keep `serve` as backward-compatible alias (daemon + auto-pair in one process).

4. **NAT traversal**: 4-phase approach. Phase 1: STUN + libp2p Identify for public address discovery. Phase 2: Kademlia DHT with bootstrap nodes. Phase 3: Circuit Relay v2. Phase 4: WebRTC (future).

5. **Testing**: No tests exist today. Playwright for e2e, test harness spawns jaunt-host as child process. Requires snag daemon as prerequisite.

**Why:** These decisions minimize changes to the cairn libraries (external dependency) and keep the jaunt-host protocol simple. The HTTP pairing endpoint and IPC socket are standard Unix patterns that work without additional infrastructure.

**How to apply:** Reference `.plans/remaining-issues.md` when implementing any of these issues. The plan includes exact file lists, implementation steps, and test plans for each issue.
