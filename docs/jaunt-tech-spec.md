# Jaunt — Technical Specification

**Version:** 0.2
**Status:** Draft
**Companion document:** [Jaunt PRD v0.3](./jaunt-prd.md)
**Dependencies:** [cairn](https://github.com/moukrea/cairn) ([docs](https://moukrea.github.io/cairn/)), [snag](https://github.com/moukrea/snag)

---

## 1. Overview

Jaunt is composed of four deliverables built from a single monorepo:

- **`jaunt-host`** — Rust binary. Runs on the machine to be accessed. Creates a cairn node, bridges cairn channels to snag sessions and local filesystem.
- **`jaunt-client`** — Rust binary. CLI client for headless/scripted remote access via cairn.
- **`jaunt-web`** — SolidJS SPA. Hosted on GitHub Pages. Browser client using cairn-p2p npm package.
- **`jaunt-tauri`** — Tauri 2.0 app. Wraps the web client with native Rust backend using cairn-p2p crate.

A shared crate **`jaunt-protocol`** defines RPC message types and the connection profile format.

---

## 2. Design Principles

1. **Jaunt owns nothing below it** — sessions belong to snag, networking belongs to cairn. Jaunt is glue + UX.
2. **cairn does all networking** — pairing (PIN/QR/link, SPAKE2), transport (QUIC/WebRTC), encryption (Noise XX + Double Ratchet), reconnection, signaling, relay. Jaunt never touches sockets, crypto, or NAT traversal.
3. **All tiers, all clients** — every Jaunt client (web, Tauri, CLI) supports cairn Tier 0/1/2. Infrastructure endpoints are communicated via connection profiles, not hardcoded.
4. **Browser-first** — the web client must work without installing anything. The Tauri app is an upgrade, not a requirement.
5. **Zero infrastructure by default** — Tier 0 works out of the box. Tier 1+ is opt-in via configuration.

---

## 3. Architecture

### 3.1. Host Daemon

Single-threaded async Rust process (tokio `current_thread`). Subsystems:

```
jaunt-host
├── cairn node              ← all networking (configured from [cairn] config section)
├── connection profiler     ← generates QR/link data with embedded cairn config
├── approval handler        ← prompts user on new pairing events
├── snag bridge             ← translates RPC → snag operations
│   ├── socket mode         ← preferred: direct snag Unix socket
│   └── CLI fallback        ← shells out to snag binary
├── file browser            ← directory listing, preview, transfer
└── TUI                     ← host status, QR display, activity log
```

**Why single-threaded:** the workload is I/O-bound — relaying bytes between cairn tunnel and snag socket. The bottleneck is network latency, not CPU.

### 3.2. Cairn Node Setup

The host creates a cairn node from its `[cairn]` config section, which maps directly to cairn's `CairnConfig`:

```rust
use cairn_p2p::{CairnConfig, create};

fn build_cairn_config(config: &JauntConfig) -> CairnConfig {
    CairnConfig {
        signal_server: config.cairn.signal_server.clone(),
        signal_auth_token: config.cairn.signal_auth_token.clone(),
        turn_server: config.cairn.turn_server.clone(),
        turn_username: config.cairn.turn_username.clone(),
        turn_password: config.cairn.turn_password.clone(),
        identity_seed: config.cairn.identity_seed.clone(),
        listen_addr: config.cairn.listen_addr.clone(),
        ..CairnConfig::default()
    }
}

let node = create(build_cairn_config(&config))?;
node.start().await?;
```

All fields are `Option`. Omitting everything = Tier 0 (DHT/mDNS + public STUN). Adding `signal_server` + `turn_server` = Tier 1. The host does not declare a "tier" — cairn infers it from what's configured.

### 3.3. Event Loop

The host subscribes to cairn events and dispatches:

```rust
let mut events = node.subscribe();
while let Some(event) = events.recv().await {
    match event {
        Event::PeerConnected { peer_id } => {
            if !approval_store.is_approved(&peer_id) {
                if config.require_approval {
                    tui.prompt_approval(&peer_id);
                } else {
                    approval_store.approve(&peer_id);
                }
            }
            tui.log_activity(&peer_id, "connected");
        }
        Event::MessageReceived { peer_id, channel, data } => {
            if !approval_store.is_approved(&peer_id) { continue; }
            match channel.as_str() {
                "rpc" => handle_rpc(&peer_id, &data, &snag, &files).await,
                "pty" => relay_pty_input(&peer_id, &data, &snag).await,
                "file" => handle_file_transfer(&peer_id, &data, &files).await,
                _ => {}
            }
        }
        Event::PeerDisconnected { peer_id } => {
            detach_if_attached(&peer_id, &snag).await;
            tui.log_activity(&peer_id, "disconnected");
        }
        _ => {}
    }
}
```

---

## 4. Connection Profiles

The key mechanism for multi-tier client support.

### 4.1. Profile Structure

```rust
/// Shared between host (generator) and all clients (consumers).
/// Defined in jaunt-protocol crate.
#[derive(Serialize, Deserialize)]
struct ConnectionProfile {
    /// Pairing data from cairn
    pairing: PairingData,

    /// cairn infrastructure config — all optional (null = Tier 0)
    #[serde(skip_serializing_if = "Option::is_none")]
    signal_server: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    signal_auth_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    turn_server: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    turn_username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    turn_password: Option<String>,

    /// Host display name
    host_name: String,
}

#[derive(Serialize, Deserialize)]
enum PairingData {
    Qr { qr_data: String },
    Link { uri: String },
    Pin { pin: String },
}
```

### 4.2. URL Encoding

```rust
fn encode_profile_url(profile: &ConnectionProfile) -> String {
    let json = serde_json::to_vec(profile).unwrap();
    let compressed = zstd::encode_all(&json[..], 3).unwrap();
    let encoded = base64_url::encode(&compressed);
    format!("https://jaunt.app/#{}", encoded)
}
```

Tier 0 profile: ~80 bytes JSON → ~60 bytes compressed. Tier 1+ with URLs: under 1KB compressed. Both fit in QR codes.

The URL fragment (`#...`) is never sent to any server — stays in the browser.

### 4.3. Host Generation

```rust
async fn generate_profile(node: &CairnNode, config: &JauntConfig) -> ConnectionProfile {
    let pairing = node.pair_generate_qr().await.unwrap();
    ConnectionProfile {
        pairing: PairingData::Qr { qr_data: pairing.data },
        signal_server: config.cairn.signal_server.clone(),
        signal_auth_token: config.cairn.signal_auth_token.clone(),
        turn_server: config.cairn.turn_server.clone(),
        turn_username: config.cairn.turn_username.clone(),
        turn_password: config.cairn.turn_password.clone(),
        host_name: hostname::get().unwrap().to_string_lossy().into(),
    }
}
```

### 4.4. Client Consumption

**Web (TypeScript):**
```typescript
const fragment = window.location.hash.slice(1);
if (fragment) {
    const profile = decodeProfile(fragment);
    const node = await Node.create({
        signalServer: profile.signal_server ?? undefined,
        signalAuthToken: profile.signal_auth_token ?? undefined,
        turnServer: profile.turn_server ?? undefined,
        turnUsername: profile.turn_username ?? undefined,
        turnPassword: profile.turn_password ?? undefined,
    });
    const peerId = await node.pairScanQr(profile.pairing.qr_data);
    await db.saveHostProfile(peerId, profile); // persist for reconnection
}
```

**CLI (Rust):**
```rust
// jaunt pair --link "https://jaunt.app/#eyJ..."
let profile = decode_profile_from_fragment(&link_fragment)?;
let node = create(profile_to_cairn_config(&profile))?;
node.start().await?;
let peer_id = node.pair_scan_qr(&profile.pairing.qr_data()).await?;
```

**Tauri (Rust backend):** same as CLI but profile decoded by frontend (JS), passed to backend via Tauri IPC.

---

## 5. Snag Integration

### 5.1. Communication Modes

```rust
enum SnagBridge {
    Socket { stream: UnixStream },  // preferred: snag Unix socket
    Cli { snag_path: PathBuf },     // fallback: shell out to snag binary
}
```

Socket mode for streaming PTY I/O (attach). CLI mode for one-shot operations (list, kill, send).

### 5.2. Attach Relay

```
Client ◄── cairn "pty" channel ──► Host ◄── snag socket ──► snagd ◄── PTY ──► shell
```

Two concurrent tokio tasks per attached client:
1. **snag → cairn**: read PTY output from snag socket, send on `"pty"` channel
2. **cairn → snag**: receive `"pty"` channel input, write to snag socket

Host does not interpret PTY bytes. Terminal emulation is the client's job.

### 5.3. Backpressure

64KB output buffer per client. Overflow drops frames. Client re-syncs from snag scrollback on reconnect.

### 5.4. Startup Check

`jaunt serve` verifies snag is installed and daemon is running. Fatal error with installation instructions if missing.

---

## 6. File Browser

### 6.1. Directory Listing Response

```rust
struct DirEntry {
    name: String,
    entry_type: EntryType,    // File, Directory, Symlink { target }
    size: u64,
    modified: u64,            // unix timestamp
    permissions: u16,         // octal
    hidden: bool,             // name starts with '.'
}
```

Hidden entries always included. Client filters based on UI toggle — no round-trip.

### 6.2. Path Security

Canonical path validation against configured roots. Symlinks resolved for validation, displayed as-is.

### 6.3. "Open Session Here"

`SessionCreate { cwd: "/path" }` → `snag new --cwd /path` → return session ID → client auto-attaches.

### 6.4. File Transfer

Via cairn `"file"` channel. Download: host streams 64KB chunks after `Ok { size, mime }` on `"rpc"`. Upload: client streams, host writes to temp file, atomic rename on completion.

---

## 7. Device Approval & Reconnection

### 7.1. Approval

cairn handles crypto. Jaunt handles UX: display device name, prompt `[Y/n]`, persist to `~/.config/jaunt/devices.json`.

### 7.2. Reconnection

cairn handles fully: Double Ratchet preserved, transport-agnostic, automatic retry with backoff, transparent message queuing.

Jaunt's only job on reconnect: if client was attached, re-send `SessionAttach` to get fresh scrollback from snag's ring buffer.

### 7.3. Revocation

`jaunt devices revoke <peer_id>` — removes from approval list. Next connection attempt rejected.

---

## 8. Web Client

### 8.1. Structure

```
web/src/
├── App.tsx
├── components/
│   ├── PairingScreen.tsx     # decode profile from URL fragment, PIN input
│   ├── SessionList.tsx
│   ├── Terminal.tsx           # xterm.js wrapper
│   ├── FileBrowser.tsx        # directory nav, hidden toggle, "open session here"
│   ├── Settings.tsx           # manual cairn infra config for PIN pairing on Tier 1+
│   └── StatusBar.tsx          # connection state, latency, tier
├── lib/
│   ├── cairn.ts              # create node from profile or manual settings
│   ├── profile.ts            # ConnectionProfile decode/encode
│   ├── protocol.ts           # RPC msgpack encode/decode
│   └── store.ts              # nanostores + IndexedDB (per-host cairn config + identity)
```

### 8.2. Persistence

IndexedDB stores per-host: `{ peerId, hostName, cairnConfig, pairedAt, lastSeen }`. On reconnection: load config, create cairn node, connect. No re-pairing, no re-configuration.

### 8.3. PWA

Service worker caches assets. Reconnects work even if GitHub Pages is unreachable.

---

## 9. Tauri App

### 9.1. Per-Host SQLite

```sql
CREATE TABLE hosts (
    peer_id TEXT PRIMARY KEY,
    host_name TEXT NOT NULL,
    cairn_signal_server TEXT,
    cairn_signal_auth_token TEXT,
    cairn_turn_server TEXT,
    cairn_turn_username TEXT,
    cairn_turn_password TEXT,
    paired_at TEXT NOT NULL,
    last_seen TEXT NOT NULL
);
```

Each host can use different cairn infrastructure. Tauri manages per-host config.

### 9.2. Native Features

OS keychain for cairn identity, native QR scanner (decoded profile passed to Rust backend via IPC), native notifications, background keepalive.

---

## 10. CLI Client

### 10.1. Config

`~/.config/jaunt/client.toml`: default `[cairn]` section for PIN pairing on Tier 1+.

`~/.config/jaunt/hosts.json`: per-host alias → `{ peer_id, cairn_config, paired_at }`.

### 10.2. Commands

```bash
jaunt pair --link "https://jaunt.app/#..."   # auto-extracts cairn config
jaunt pair --pin A1B2-C3D4 --alias mybox    # uses cairn config from client.toml
jaunt connect mybox sessions
jaunt connect mybox attach dev
jaunt connect mybox send dev "cargo test"
jaunt connect mybox files ~/project
jaunt hosts list
jaunt hosts remove mybox
jaunt devices list          # host mode
jaunt devices revoke <id>   # host mode
```

---

## 11. Security

| Threat | Mitigation |
|---|---|
| MITM during pairing | SPAKE2 via cairn |
| Brute-force pairing | cairn rate limiting |
| Eavesdropping | Noise XX + Double Ratchet (cairn) |
| Signaling/relay compromise | E2E encrypted, servers see ciphertext only (cairn) |
| Profile interception | Fragment never sent to server; TURN creds grant relay only (E2E encrypted); pairing data is one-time SPAKE2 |
| Stolen device | `jaunt devices revoke` on host |
| Path traversal | Canonical validation against roots |
| Host compromise | Out of scope (OS-level) |

---

## 12. Build & Distribution

Rust: `opt-level = "z"`, LTO, `panic = "abort"`, strip, musl static. Target 4–8 MB.

Web: `npm run build` → GitHub Pages. Target < 500KB gzipped.

Tauri: `cargo tauri build` → .deb, .AppImage, .dmg, .msi, .apk, .ipa.

---

## 13. Testing

- **Unit:** profile encode/decode roundtrip (Tier 0 and 1+), RPC msgpack roundtrip, path validation, approval store
- **Integration:** host + CLI pair via PIN (Tier 0), pair via link (Tier 1), web client QR pair, snag bridge (socket + CLI), file browser, reconnection + scrollback catch-up, multi-client attach
- **E2E:** QR → mobile browser → terminal (Tier 0 and 1), Tauri QR scan → native QUIC, cross-tier mismatch (graceful error)

---

## 14. Implementation Phases

### Phase 1 — Host + CLI Client (MVP) — 2–3 weeks
`jaunt-protocol` (RPC + ConnectionProfile), `jaunt-host` (cairn node, snag bridge CLI mode, approval, config, profile generation, TUI), `jaunt-client` (pair PIN + link, connect, sessions, client config). Tier 0 + Tier 1.

### Phase 2 — Web Client — 3–4 weeks
SolidJS + xterm.js + cairn-p2p npm. Profile decode from URL fragment. Settings panel. IndexedDB persistence. Mobile responsive. GitHub Pages deploy. All tiers.

### Phase 3 — File Browser + Tauri — 3–4 weeks
File browser with hidden toggle + "open session here" + transfer. Tauri 2.0 with native cairn, per-host SQLite, keychain, QR scanner. Android + iOS.

### Phase 4 — Hardening — 2–3 weeks
Tier 2 (server peer, store-and-forward). Snag socket mode. Per-device ACL. Cross-tier test suite. Docs, landing page, packaging, shell completions.
