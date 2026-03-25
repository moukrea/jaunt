---
name: cairn transport-to-api wiring architecture
description: Complete architectural picture for wiring the transport layer to the API in cairn-p2p Rust crate — ApiNode internals, the transport_connector injection point, connect()/send()/dispatch_incoming flows, pairing payload structure, SwarmController role, Session vs ApiSession distinction, test coverage, and conformance runner status.
type: project
---

## Overview

The critical gap: API methods exist and compile, but are not wired to real network I/O. The transport_connector field is the designated injection point.

**Why:** The ACTION-PLAN (PROMPT.md) states: "API methods are not wired to the transport/crypto/session stack in any language. node.connect(), pairing methods, send()/on_message() all return placeholder errors."

**How to apply:** When wiring transport to API, use `transport_connector` as the integration seam. Do NOT rewrite existing structs — wire into the existing call sites.

---

## ApiNode struct (node.rs lines 34-57)

Fields:
- `config: CairnConfig`
- `identity: IdentityKeypair` — Ed25519 long-term identity
- `local_identity: LocalIdentity` — peer ID source
- `trust_store: RwLock<Box<dyn TrustStore>>` — paired peer registry
- `event_tx/rx: mpsc` — event bus (capacity 256)
- `sessions: RwLock<HashMap<String, ApiSession>>`
- `custom_registry: Arc<RwLock<HashMap<u16, Arc<dyn Fn(&str, &[u8])>>>>` — node-wide custom message handlers (0xF000-0xFFFF)
- `network_info: RwLock<NetworkInfo>`
- **`transport_connector: Option<Arc<dyn Fn(&str, &IdentityKeypair) -> Pin<Box<dyn Future<Output=Result<ConnectResult>> + Send>> + Send + Sync>>`** — THE wiring point (line 46-56)

The `transport_connector` is `None` by default. `#[cfg(test)]` exposes `set_transport_connector()` for injection. For production, wiring means either: (a) making `set_transport_connector` pub, or (b) adding a factory that builds the real SwarmController-backed connector and stores it.

---

## ConnectResult struct (node.rs lines 59-63)

```rust
pub struct ConnectResult {
    pub transport_type: FallbackTransportType,
    pub ratchet: DoubleRatchet,
    pub session_id: SessionId,
}
```

This is what a real transport connector must produce. It requires a completed Noise XX handshake (to derive session_key) and a DoubleRatchet initialized from that key.

---

## connect() flow (node.rs lines 297-338)

1. Checks trust_store — if paired peers exist, verifies `peer_id` is paired (skips check if empty store, i.e., first connection)
2. Calls `transport_connector(peer_id, &self.identity).await?` if connector is set, else `default_connect()`
3. Creates `SessionStateMachine` in `Connected` state
4. Wraps into `ApiSession::with_crypto(peer_id, event_tx, ratchet, state_machine).with_session_id(session_id)`
5. Stores session in `self.sessions`
6. Emits `Event::StateChanged { state: Connected }`

**default_connect() (lines 340-357):** Runs an entirely in-process Noise XX handshake (initiator and responder are both local). This is a simulation stub — it produces a valid ratchet but no real network I/O occurs. Hard-codes `FallbackTransportType::DirectQuic`.

---

## perform_noise_handshake() (node.rs lines 359-395)

In-process simulation: creates a fresh `IdentityKeypair` as the "remote". Both initiator and responder run synchronously in the same function. Returns `HandshakeResult { session_key, remote_static, transcript_hash }`. The session_key feeds `DoubleRatchet::init_initiator(session_key, bob_public, config)`.

**For real wiring:** This function needs to be replaced with an async flow that:
1. Uses `SwarmController.dial(multiaddr)` to establish a real libp2p connection
2. Sends/receives Noise XX messages over the request-response behaviour
3. Returns the handshake result from the remote peer's actual keys

---

## send() flow (ApiSession, lines 563-630)

1. Checks `channel.is_open()`
2. If disconnected state (Disconnected/Reconnecting/Suspended): enqueues in `MessageQueue`
3. If connected: Double Ratchet encrypt → produces `(header, ciphertext)`
4. Serializes as `[4-byte header_len_BE][header_json][ciphertext]`
5. Wraps in `MessageEnvelope { version:1, msg_type: DATA_MESSAGE, msg_id: UUID_v7, session_id, payload, auth_tag:None }`
6. CBOR-encodes envelope → pushes to `self.outbox: Vec<Vec<u8>>`
7. Emits `Event::MessageReceived` (NOTE: this is a bug/placeholder — send() should not emit a MessageReceived event; that's for incoming)

**Gap:** The outbox is an `Arc<RwLock<Vec<Vec<u8>>>>`. Nothing reads it and sends it over the wire. A real wiring layer must drain the outbox and pass bytes to `SwarmController` (via request-response send).

---

## dispatch_incoming() flow (ApiSession, lines 714-771)

1. CBOR-decodes `MessageEnvelope`
2. Records heartbeat activity
3. Dispatches by `msg_type`:
   - `DATA_MESSAGE`: decrypt ratchet → invoke all `message_callbacks` → emit `Event::MessageReceived`
   - `0xF000-0xFFFF`: invoke per-session custom handler
   - `HEARTBEAT/HEARTBEAT_ACK`: activity already recorded, no further action
   - unknown: silently ignored
4. Returns `Ok(())`

**Gap:** Nothing calls `dispatch_incoming()`. A real wiring layer must receive raw bytes from the swarm's `RequestReceived` event and call `session.dispatch_incoming(&bytes)`.

---

## Session vs ApiSession distinction

**`Session`** (`session/mod.rs`): Pure state — session ID, peer ID, state machine, sequence counters, expiry timer, ratchet epoch counter. No networking. Used to track session lifecycle facts.

**`ApiSession`** (`api/node.rs` lines 430-451): The public-facing handle. Wraps an `Arc<RwLock<SessionStateMachine>>`, an `Arc<RwLock<DoubleRatchet>>`, message callbacks, custom handlers, heartbeat monitor, message queue, outbox. This is what `connect()` returns to the user.

The two are not directly linked — `ApiSession` holds a `SessionStateMachine` (same type as used by `Session`) but separately.

---

## SwarmController (transport/swarm.rs)

Already fully implemented:
- `build_swarm(identity, config) -> Result<SwarmController>` — builds a real libp2p swarm with TCP+QUIC+WebSocket, mDNS, Kademlia DHT, request-response
- `SwarmController::listen_on(addr)` / `dial(addr)` / `shutdown()` / `next_event()`
- `SwarmCommandSender::kad_put_record(key, value)` / `kad_get_record(key)`
- Protocol ID: `"/cairn/1.0.0"` (`CAIRN_PROTOCOL` constant)
- `CairnCodec`: length-prefixed (4-byte BE u32) CBOR framing; 1 MiB cap
- Behaviour: `CairnBehaviour { mdns, kademlia, request_response }`
- Events: `SwarmEvent::RequestReceived { peer_id, request_id, request }` / `ResponseReceived` / `RequestFailed`

**NOT stored in ApiNode.** The wiring task must decide where to store it (likely in `ApiNode` alongside `transport_connector`, or the connector closure captures it).

---

## Pairing flow and PairingPayload

`PairingPayload` (pairing/mechanisms/mod.rs lines 46-53):
```rust
pub struct PairingPayload {
    pub peer_id: PeerId,
    pub nonce: [u8; 16],
    pub pake_credential: Vec<u8>,
    pub connection_hints: Option<Vec<ConnectionHint>>,
    pub created_at: u64,
    pub expires_at: u64,
}
```

`ConnectionHint` is `{ hint_type: String, value: String }`. No strongly typed hint types — callers set hint_type to strings like `"rendezvous"`. CBOR key mapping: 0=peer_id, 1=nonce, 2=pake_credential, 3=hints (array of [type,value] pairs), 4=created_at, 5=expires_at.

**In `create_pairing_payload()` (node.rs lines 153-174):** `connection_hints` is always `None`. For real wiring, this should be populated with the node's actual listen addresses (from `SwarmController.listen_on()` results, which emit `SwarmEvent::ListeningOn { address }`).

**Pairing exchange gap:** `run_pairing_exchange()` (lines 198-220) runs SPAKE2 entirely in-process between two local `PairingSession` instances. No network transport. The real flow should exchange `PairingSession` messages (request/challenge/response/confirm) over the wire via the swarm's request-response behaviour.

**Pairing completion gap:** `complete_pairing()` (lines 176-196) stores `self.local_identity.public_key()` as the remote peer's public key — a placeholder. Real wiring must extract the actual remote public key from the Noise XX handshake result.

---

## Pairing methods summary

| Method | Generates | Consumes | Gap |
|--------|-----------|----------|-----|
| `pair_generate_qr()` | CBOR bytes | — | connection_hints=None |
| `pair_scan_qr(data)` | — | CBOR bytes → PairingPayload | in-process PAKE only |
| `pair_generate_pin()` | "XXXX-XXXX" string | — | connection_hints=None |
| `pair_enter_pin(pin)` | — | pin → PairingPayload | remote_peer_id is random |
| `pair_generate_link()` | "cairn://pair?..." URI | — | connection_hints=None |
| `pair_from_link(uri)` | — | URI → PairingPayload | in-process PAKE only |

All produce valid CBOR/URI output and run real SPAKE2, but nothing goes over the wire.

---

## Node.start() — does it exist?

No `start()` method exists in the spec or code. The spec describes `Node` as a handle object — you call `connect()` directly. The libp2p swarm event loop is spawned inside `build_swarm()` via `tokio::spawn`. A real wiring design would call `build_swarm()` during `ApiNode::new()` or lazily on first `connect()`, and store the resulting `SwarmController`.

---

## Test coverage (cairn-p2p)

Total: ~724 test annotations across the crate. Key groups:

**api/node.rs tests (lines 831-end):**
- Node creation, identity, trust store, debug format
- `connect_creates_session`, `connect_wires_ratchet`, `connect_wires_state_machine`
- `connect_with_failing_transport` (uses set_transport_connector to inject failure)
- `connect_default_simulated` — verifies the in-process stub works
- `ratchet_can_encrypt_after_connect`
- Channel lifecycle: open, empty name error, reserved name error
- `send_produces_encrypted_envelope`, send on closed channel
- `session_close` and state machine transition on close
- Custom message registration (valid/invalid range)
- Pairing roundtrips for QR, PIN, Link — all self-contained (same node generates and scans)
- `pairing_emits_event`, `unpair_removes_trust`
- Dispatch incoming, message queue drain, state change callbacks

**transport/swarm.rs tests:**
- `build_swarm_with_default_config` — builds real libp2p swarm
- `listen_on_tcp_produces_event`, `listen_on_quic_produces_event` — actually binds ports
- `dial_unreachable_produces_failure` — real dial to 192.0.2.1
- `shutdown_terminates_event_loop`
- `transport_config_defaults`, `libp2p_keypair_conversion`

**session/mod.rs tests:** Full session lifecycle, state machine, sequence counters, events, expiry.

---

## Conformance runner status

Location: `/home/emeric/code/cairn/conformance/`

57+ YAML scenario files across: pairing/, session/, transport/, mesh/, forward/, crypto/, wire/, data/

**Rust runner** (`conformance/runners/rust-runner/`): partially implemented.
- `execute_scenario()` dispatches per action type
- `verify_cbor` and `verify_crypto` and `pair` actions are implemented
- `establish_session`, `send_data`, `open_channel`, `disconnect`, `reconnect`, `apply_nat`, `send_forward`, `wait` — all return `Skip("requires infrastructure (not yet implemented)")`

No JSON test vectors for cross-language validation of the full connect→send→receive flow. Fixture files exist for: CBOR encodings, key pairs, pairing vectors, ratchet initial state.
