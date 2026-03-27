---
name: SESSION_RESUME implementation plan
description: Detailed 6-unit implementation plan for cairn's session resumption protocol across Rust, TypeScript, and the jaunt web client. Plan lives at ~/code/cairn/.plans/session-resume.md
type: project
---

# SESSION_RESUME Implementation Plan

Full plan written to `/home/emeric/code/cairn/.plans/session-resume.md` on 2026-03-27.

## Key architectural decisions:
- HMAC-SHA256 proof (not signature-based) using a derived resumption key
- Resumption key = HKDF(root_key, info="cairn-session-resume-v1") — never expose root key
- Session index stored as `session:_index` JSON in keystore (avoids breaking KeyStore trait)
- Epoch increment only after resume (no forced ratchet step)
- Browser must reuse saved Ed25519 identity via Node.createWithIdentity
- SESSION_EXPIRED sent on failure (explicit reason code, no silent timeout)
- Nonce + 5-minute timestamp window for replay protection

## 6 implementation units:
1. Session Persistence (Rust) — persistence.rs, SavedSession struct
2. Resume Protocol Primitives (Rust) — HMAC proof, CBOR encode/decode, NonceCache
3. Resume Protocol Wiring (Rust) — try_resume_transport, responder handler, node.rs
4. Auto-Reconnect (Rust) — ConnectionClosed handler, reconnection_loop, backoff
5. Resume Protocol (TypeScript) — mirror of Rust primitives, Node.createWithIdentity
6. Browser Persistence (jaunt web) — IndexedDB save/load, tryReconnect, PairingScreen

**Why:** This enables reconnection after transport disruption (network drop, page refresh, process restart) without re-pairing or full Noise XX handshake.
**How to apply:** When implementing, follow the unit ordering (1→2→3→4 for Rust, 2→5→6 for TS). Units 1-2 and Unit 5 can be done in parallel.
