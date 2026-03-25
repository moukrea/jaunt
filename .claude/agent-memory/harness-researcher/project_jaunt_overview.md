---
name: jaunt project overview
description: Core architecture, goals, and dependencies of the Jaunt project
type: project
---

Jaunt is a remote shell/file access tool built as a thin bridge between **cairn** (P2P networking) and **snag** (PTY session management). It lets users access their machine's shell sessions and files from any device with zero infrastructure.

**Why:** Zero-infrastructure remote access — no SSH port forwarding, no VPN, no cloud accounts. Scan a QR code and you're in.

**How to apply:** Frame all implementation suggestions around Jaunt being glue/UX only. Never implement networking or PTY management directly — delegate fully to cairn and snag.

## Four deliverables (monorepo)
- `jaunt-host` — Rust binary, runs on the machine to be accessed
- `jaunt-client` — Rust CLI client for headless/scripted access
- `jaunt-web` — SolidJS SPA hosted on GitHub Pages
- `jaunt-tauri` — Tauri 2.0 app wrapping the web client
- `jaunt-protocol` — shared crate: RPC types + ConnectionProfile

## Key dependencies
- **cairn** (https://github.com/moukrea/cairn) — all networking: pairing (SPAKE2), transport (QUIC/WebRTC), encryption (Noise XX + Double Ratchet), NAT traversal, reconnection, signaling, relay
- **snag** (https://github.com/moukrea/snag) — all PTY session management

## Infrastructure tiers
- Tier 0: DHT/mDNS + public STUN, zero config
- Tier 1: self-hosted signaling + TURN relay (sub-second discovery, NAT-resilient)
- Tier 2: server-mode peer, store-and-forward

## Connection profiles
Critical mechanism: host embeds its cairn infra config into QR/link so clients auto-configure. JSON → zstd compress → base64url → URL fragment (`jaunt.app/#...`). Fragment never hits any server.

## Docs location
- PRD: /home/emeric/code/jaunt/docs/jaunt-prd.md (v0.3)
- Tech spec: /home/emeric/code/jaunt/docs/jaunt-tech-spec.md (v0.2)
