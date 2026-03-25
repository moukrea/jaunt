---
name: cairn-p2p Rust crate public API
description: Complete public API of the cairn-p2p crate at /home/emeric/code/cairn/packages/rs/cairn-p2p/ — all structs, enums, methods, and factory functions
type: project
---

# cairn-p2p Rust Crate Public API

Crate name: `cairn_p2p`, version `0.2.0`, lib name `cairn_p2p`.

## Top-level re-exports (src/lib.rs)

```rust
// Factory functions
pub fn create() -> Result<ApiNode>
pub fn create_with_config(config: CairnConfig) -> Result<ApiNode>
pub fn create_server() -> Result<ApiNode>
pub fn create_server_with_config(mut config: CairnConfig) -> Result<ApiNode>

// Type aliases
pub type Node = ApiNode;
pub type Session = ApiSession;
pub type Channel = ApiChannel;
```

## Config (src/config.rs)

```rust
pub enum TransportType { Quic, Tcp, WsTls, WebTransport, CircuitRelayV2 }

pub struct TurnServer {
    pub url: String,
    pub username: String,
    pub credential: String,
}

pub struct ReconnectionPolicy {
    pub connect_timeout: Duration,           // default: 30s
    pub transport_timeout: Duration,         // default: 10s
    pub reconnect_max_duration: Duration,    // default: 3600s
    pub reconnect_backoff_initial: Duration, // default: 1s
    pub reconnect_backoff_max: Duration,     // default: 60s
    pub reconnect_backoff_factor: f64,       // default: 2.0
    pub rendezvous_poll_interval: Duration,  // default: 30s
    pub session_expiry: Duration,            // default: 86400s
    pub pairing_payload_expiry: Duration,    // default: 300s
}

pub struct MeshSettings {
    pub mesh_enabled: bool,     // default: false
    pub max_hops: u8,           // default: 3, valid: 1-10
    pub relay_willing: bool,    // default: false
    pub relay_capacity: u16,    // default: 10
}

pub enum StorageBackend {
    Filesystem { path: PathBuf },  // default: ".cairn"
    InMemory,
    Custom(String),
}

pub struct ManifestConfig {
    pub enabled: bool,
    pub endpoint: String,              // must be https:// if enabled
    pub refresh_interval: Duration,
}

pub struct InfrastructureManifest {
    pub version: u32,
    pub stun_servers: Vec<String>,
    pub tracker_urls: Vec<String>,
    pub bootstrap_nodes: Vec<String>,
    pub signature: String,
}

pub struct CairnConfig {
    pub stun_servers: Vec<String>,                   // default: google + cloudflare STUN
    pub turn_servers: Vec<TurnServer>,
    pub signaling_servers: Vec<String>,
    pub tracker_urls: Vec<String>,
    pub bootstrap_nodes: Vec<String>,
    pub transport_preferences: Vec<TransportType>,   // default: Quic,Tcp,WsTls,WebTransport,CircuitRelayV2
    pub reconnection_policy: ReconnectionPolicy,
    pub mesh_settings: MeshSettings,
    pub storage_backend: StorageBackend,
    pub server_mode: bool,
    pub manifest_config: Option<ManifestConfig>,
}

impl CairnConfig {
    pub fn tier0() -> Self
    pub fn tier1(signaling_servers: Vec<String>, turn_servers: Vec<TurnServer>) -> Self
    pub fn tier2(signaling_servers, turn_servers, tracker_urls, bootstrap_nodes) -> Self
    pub fn tier3(signaling_servers, turn_servers, tracker_urls, bootstrap_nodes, mesh_settings) -> Self
    pub fn default_server() -> Self  // server_mode=true, session_expiry=7days, relay_willing=true
    pub fn validate(&self) -> Result<()>
}

// Builder pattern
pub struct CairnConfigBuilder { ... }
impl CairnConfigBuilder {
    pub fn new() -> Self
    pub fn stun_servers(self, servers: Vec<String>) -> Self
    pub fn turn_servers(self, servers: Vec<TurnServer>) -> Self
    pub fn signaling_servers(self, servers: Vec<String>) -> Self
    pub fn tracker_urls(self, urls: Vec<String>) -> Self
    pub fn bootstrap_nodes(self, nodes: Vec<String>) -> Self
    pub fn transport_preferences(self, prefs: Vec<TransportType>) -> Self
    pub fn reconnection_policy(self, policy: ReconnectionPolicy) -> Self
    pub fn mesh_settings(self, settings: MeshSettings) -> Self
    pub fn storage_backend(self, backend: StorageBackend) -> Self
    pub fn server_mode(self, enabled: bool) -> Self
    pub fn manifest_config(self, config: ManifestConfig) -> Self
    pub fn build(self) -> Result<CairnConfig>
}

pub fn manifest_verify_key() -> [u8; 32]
pub fn verify_manifest(manifest_json: &str) -> Result<InfrastructureManifest>
```

## Error types (src/error.rs)

```rust
pub enum ErrorBehavior { Retry, Reconnect, Abort, ReGenerate, Wait, Inform }

pub enum CairnError {
    TransportExhausted { details: String, suggestion: String },
    SessionExpired { session_id: String, expiry_duration: Duration },
    PeerUnreachable { peer_id: String, timeout: Duration },
    AuthenticationFailed { session_id: String },
    PairingRejected { peer_id: String },
    PairingExpired { expiry: Duration },
    MeshRouteNotFound { peer_id: String, suggestion: String },
    VersionMismatch { local_version: String, remote_version: String, suggestion: String },
    Protocol(String),
    Crypto(String),
    KeyStore(String),
    Transport(String),
    Discovery(String),
    Pairing(String),
    Identity(#[from] IdentityError),
}

impl CairnError {
    pub fn transport_exhausted(details: impl Into<String>) -> Self
    pub fn transport_exhausted_with_suggestion(details, suggestion) -> Self
    pub fn session_expired(session_id: impl Into<String>, expiry: Duration) -> Self
    pub fn peer_unreachable(peer_id: impl Into<String>, timeout: Duration) -> Self
    pub fn auth_failed(session_id: impl Into<String>) -> Self
    pub fn pairing_rejected(peer_id: impl Into<String>) -> Self
    pub fn pairing_expired(expiry: Duration) -> Self
    pub fn mesh_route_not_found(peer_id: impl Into<String>) -> Self
    pub fn version_mismatch(local: impl Into<String>, remote: impl Into<String>) -> Self
    pub fn error_behavior(&self) -> ErrorBehavior
}

pub type Result<T> = std::result::Result<T, CairnError>;
```

## ApiNode (src/api/node.rs) — public as `Node`

```rust
pub struct ApiNode { /* private fields */ }

impl ApiNode {
    pub fn new(config: CairnConfig) -> Result<Self>
    pub fn config(&self) -> &CairnConfig
    pub fn identity(&self) -> &IdentityKeypair
    pub fn local_identity(&self) -> &LocalIdentity
    pub fn peer_id(&self) -> &PeerId
    pub fn trust_store(&self) -> &RwLock<Box<dyn TrustStore>>
    pub fn event_sender(&self) -> mpsc::Sender<Event>
    pub fn custom_registry(&self) -> &Arc<RwLock<HashMap<u16, Arc<dyn Fn(&str, &[u8]) + Send + Sync>>>>

    // Event loop
    pub async fn recv_event(&self) -> Option<Event>

    // Custom message handler registration (type codes 0xF000-0xFFFF)
    pub async fn register_custom_message<F>(&self, type_code: u16, handler: F) -> Result<()>
    where F: Fn(&str, &[u8]) + Send + Sync + 'static

    // Pairing — QR code
    pub async fn pair_generate_qr(&self) -> Result<QrPairingData>
    pub async fn pair_scan_qr(&self, data: &[u8]) -> Result<PeerId>

    // Pairing — PIN code
    pub async fn pair_generate_pin(&self) -> Result<PinPairingData>
    pub async fn pair_enter_pin(&self, pin: &str) -> Result<PeerId>

    // Pairing — deep link / URI
    pub async fn pair_generate_link(&self) -> Result<LinkPairingData>
    pub async fn pair_from_link(&self, uri: &str) -> Result<PeerId>

    // Connection
    pub async fn connect(&self, peer_id: &str) -> Result<ApiSession>
    pub async fn unpair(&self, peer_id: &str) -> Result<()>

    // Diagnostics
    pub async fn network_info(&self) -> NetworkInfo
    pub async fn set_nat_type(&self, nat_type: NatType)
}

// Pairing result types
pub struct QrPairingData {
    pub payload: Vec<u8>,          // raw CBOR bytes for QR encoding
    pub expires_in: Duration,
}
pub struct PinPairingData {
    pub pin: String,               // 8-char Crockford Base32
    pub expires_in: Duration,
}
pub struct LinkPairingData {
    pub uri: String,               // cairn:// URI
    pub expires_in: Duration,
}

// Internal (used by transport connector injection in tests)
pub struct ConnectResult {
    pub transport_type: FallbackTransportType,
    pub ratchet: DoubleRatchet,
    pub session_id: SessionId,
}
```

## ApiSession (src/api/node.rs) — public as `Session`

```rust
pub struct ApiSession { /* private, Clone */ }

impl ApiSession {
    pub fn peer_id(&self) -> &str
    pub async fn state(&self) -> ConnectionState

    // Accessors for internal subsystems
    pub fn ratchet(&self) -> Option<&Arc<RwLock<DoubleRatchet>>>
    pub fn state_machine(&self) -> Option<&Arc<RwLock<SessionStateMachine>>>
    pub fn message_queue(&self) -> &Arc<Mutex<MessageQueue>>
    pub fn outbox(&self) -> &Arc<RwLock<Vec<Vec<u8>>>>

    // Channel management
    pub async fn open_channel(&self, name: &str) -> Result<ApiChannel>

    // Sending
    pub async fn send(&self, channel: &ApiChannel, data: &[u8]) -> Result<()>

    // Callbacks / subscriptions
    pub async fn on_message<F>(&self, channel: &ApiChannel, callback: F)
    where F: Fn(&[u8]) + Send + Sync + 'static

    pub async fn on_state_change<F>(&self, callback: F)
    where F: Fn(ConnectionState) + Send + Sync + 'static

    pub async fn on_custom_message<F>(&self, type_code: u16, callback: F) -> Result<()>
    where F: Fn(&[u8]) + Send + Sync + 'static

    // Incoming dispatch (called by transport layer)
    pub async fn dispatch_incoming(&self, envelope_bytes: &[u8]) -> Result<()>

    // Reconnection support
    pub async fn drain_message_queue(&self) -> Result<Vec<Vec<u8>>>

    // Teardown
    pub async fn close(&self) -> Result<()>
}
```

## ApiChannel (src/api/node.rs) — public as `Channel`

```rust
pub struct ApiChannel { /* name: String, open: Arc<AtomicBool>, Clone, Debug */ }

impl ApiChannel {
    pub fn name(&self) -> &str
    pub fn is_open(&self) -> bool
    pub fn close(&self)
}
```

## Events (src/api/events.rs)

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConnectionState {
    Connected, Unstable, Disconnected, Reconnecting, Suspended, Reconnected, Failed
}

#[derive(Debug, Clone)]
pub enum Event {
    StateChanged { peer_id: String, state: ConnectionState },
    MessageReceived { peer_id: String, channel: String, data: Vec<u8> },
    PairingCompleted { peer_id: String },
    PairingFailed { peer_id: String, error: String },
    ChannelOpened { peer_id: String, channel_name: String },
    ChannelClosed { peer_id: String, channel_name: String },
    Error { error: String },
}

pub struct NetworkInfo {
    pub nat_type: NatType,
    pub external_addr: Option<SocketAddr>,
}
```

## Identity types (src/identity/)

```rust
// PeerId: 34-byte SHA-256 multihash of Ed25519 public key, base58-encoded
pub struct PeerId { bytes: [u8; 34] }
impl PeerId {
    pub fn from_public_key(public_key: &VerifyingKey) -> Self
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, IdentityError>
    pub fn as_bytes(&self) -> &[u8; 34]
    // also: Display (base58), FromStr (base58), Serialize/Deserialize, Hash, Eq
}

pub enum IdentityError {
    InvalidPeerId,
    Base58Decode(String),
    AlreadyPaired(PeerId),
}

// LocalIdentity: Ed25519 keypair + derived PeerId
pub struct LocalIdentity { /* private */ }
impl LocalIdentity {
    pub fn generate() -> Self
    pub fn from_keypair(keypair: SigningKey) -> Self
    pub fn peer_id(&self) -> &PeerId
    pub fn public_key(&self) -> VerifyingKey
    pub fn signing_key(&self) -> &SigningKey
    pub fn sign(&self, message: &[u8]) -> Signature
    pub fn verify(&self, message: &[u8], signature: &Signature) -> Result<(), CairnError>
}

// PairedPeerInfo: stored in trust store after successful pairing
pub struct PairedPeerInfo {
    pub peer_id: PeerId,
    pub public_key: VerifyingKey,
    pub paired_at: u64,            // unix timestamp
    pub pairing_mechanism: String,
    pub is_verified: bool,
}

// TrustStore trait
pub trait TrustStore: Send + Sync {
    fn add_peer(&mut self, info: PairedPeerInfo) -> Result<(), IdentityError>;
    fn remove_peer(&mut self, peer_id: &PeerId) -> Result<bool, IdentityError>;
    fn get_peer(&self, peer_id: &PeerId) -> Option<&PairedPeerInfo>;
    fn list_peers(&self) -> Vec<&PairedPeerInfo>;
    fn is_paired(&self, peer_id: &PeerId) -> bool;
}

// In-memory implementation
pub struct InMemoryTrustStore { ... }
impl InMemoryTrustStore {
    pub fn new() -> Self
    pub fn len(&self) -> usize
    pub fn is_empty(&self) -> bool
}
```

## Session types (src/session/)

```rust
pub struct SessionId(uuid::Uuid);  // UUID v7
impl SessionId {
    pub fn new() -> Self
    pub fn from_uuid(uuid: uuid::Uuid) -> Self
    pub fn as_uuid(&self) -> &uuid::Uuid
    pub fn as_bytes(&self) -> &[u8; 16]
}

pub enum SessionState {
    Connected, Unstable, Disconnected, Reconnecting, Suspended, Reconnected, Failed
}

pub struct SessionEvent {
    pub session_id: SessionId,
    pub from_state: SessionState,
    pub to_state: SessionState,
    pub timestamp: Instant,
    pub reason: Option<String>,
}

pub struct Session {
    pub id: SessionId,
    pub peer_id: String,
    pub created_at: SystemTime,
    pub expiry_duration: Duration,
    pub sequence_tx: u64,
    pub sequence_rx: u64,
    pub ratchet_epoch: u32,
    // state_machine is private
}
impl Session {
    pub fn new(peer_id: String) -> (Self, broadcast::Receiver<SessionEvent>)
    pub fn with_expiry(peer_id: String, expiry_duration: Duration) -> (Self, broadcast::Receiver<SessionEvent>)
    pub fn is_expired(&self) -> bool
    pub fn state(&self) -> SessionState
    pub fn transition(&mut self, to: SessionState, reason: Option<String>) -> Result<()>
    pub fn subscribe(&self) -> broadcast::Receiver<SessionEvent>
    pub fn next_sequence_tx(&mut self) -> u64
    pub fn advance_ratchet_epoch(&mut self)
}
```

## Channel (internal session layer, src/session/channel.rs)

```rust
pub const RESERVED_CHANNEL_PREFIX: &str = "__cairn_";
pub const CHANNEL_FORWARD: &str = "__cairn_forward";
pub const CHANNEL_INIT: u16 = 0x0303;
pub type StreamId = u32;

pub fn validate_channel_name(name: &str) -> Result<()>

pub enum ChannelState { Opening, Open, Rejected, Closed }

pub struct Channel {
    pub name: String,
    pub stream_id: StreamId,
    pub state: ChannelState,
    pub metadata: Option<Vec<u8>>,
}
impl Channel {
    pub fn new(name: String, stream_id: StreamId, metadata: Option<Vec<u8>>) -> Self
    pub fn accept(&mut self) -> Result<()>
    pub fn reject(&mut self) -> Result<()>
    pub fn close(&mut self) -> Result<()>
    pub fn is_open(&self) -> bool
}

pub struct ChannelInit {
    pub channel_name: String,
    pub metadata: Option<Vec<u8>>,   // serde_bytes
}
impl ChannelInit {
    pub fn encode(&self) -> Result<Vec<u8>>   // CBOR
    pub fn decode(bytes: &[u8]) -> Result<Self>
}

pub struct DataMessage {
    pub msg_id: [u8; 16],   // UUID v7
    pub payload: Vec<u8>,
}
impl DataMessage { pub fn new(payload: Vec<u8>) -> Self }

pub struct DataAck { pub acked_msg_id: [u8; 16] }
pub struct DataNack { pub nacked_msg_id: [u8; 16], pub reason: Option<String> }

pub enum ChannelEvent {
    Opened { channel_name: String, stream_id: StreamId, metadata: Option<Vec<u8>> },
    Accepted { stream_id: StreamId },
    Rejected { stream_id: StreamId, reason: Option<String> },
    Data { stream_id: StreamId, message: DataMessage },
    Closed { stream_id: StreamId },
}

pub struct ChannelManager { /* private */ }
impl ChannelManager {
    pub fn new(buffer_size: usize) -> (Self, mpsc::Receiver<ChannelEvent>)
    pub fn open_channel(&mut self, name: &str, stream_id: StreamId, metadata: Option<Vec<u8>>) -> Result<ChannelInit>
    pub async fn handle_channel_init(&mut self, stream_id: StreamId, init: ChannelInit) -> Result<()>
    pub async fn accept_channel(&mut self, stream_id: StreamId) -> Result<()>
    pub async fn reject_channel(&mut self, stream_id: StreamId, reason: Option<String>) -> Result<()>
    pub async fn handle_data(&self, stream_id: StreamId, message: DataMessage) -> Result<()>
    pub async fn close_channel(&mut self, stream_id: StreamId) -> Result<()>
    pub fn get_channel(&self, stream_id: StreamId) -> Option<&Channel>
    pub fn channel_count(&self) -> usize
}
```

## Pairing (src/pairing/)

```rust
// Core payload
pub struct PairingPayload {
    pub peer_id: PeerId,
    pub nonce: [u8; 16],
    pub pake_credential: Vec<u8>,
    pub connection_hints: Option<Vec<ConnectionHint>>,
    pub created_at: u64,
    pub expires_at: u64,
}
impl PairingPayload {
    pub fn is_expired(&self, now_unix: u64) -> bool
    pub fn to_cbor(&self) -> Result<Vec<u8>, MechanismError>
    pub fn from_cbor(data: &[u8]) -> Result<Self, MechanismError>
}

pub struct ConnectionHint {
    pub hint_type: String,
    pub value: String,
}

pub enum MechanismType { VerificationOnly, Initiation }

pub enum MechanismError {
    PayloadTooLarge { max: usize, actual: usize },
    Expired,
    InvalidFormat(String),
    InvalidPinCode(String),
    InvalidUri(String),
    CborError(String),
}

// Mechanism trait
pub trait PairingMechanism: Send + Sync {
    fn mechanism_type(&self) -> MechanismType;
    fn generate_payload(&self, payload: &PairingPayload) -> Result<Vec<u8>, MechanismError>;
    fn consume_payload(&self, raw: &[u8]) -> Result<PairingPayload, MechanismError>;
}

pub struct QrCodeMechanism;     // Default impl
pub struct PinCodeMechanism;    // Default impl
pub struct PairingLinkMechanism; // Default impl — cairn:// URI
pub struct PskMechanism;        // PSK-based

// PSK error
pub enum PskError { InvalidKey, ... }

// Custom adapter
pub struct CustomPayload { ... }
pub struct CustomPairingAdapter { ... }
pub enum AdapterError { ... }
pub struct CustomMechanism { ... }

// SAS verification helpers
pub fn derive_numeric_sas(transcript: &[u8]) -> Result<String, MechanismError>   // 6-digit
pub fn derive_emoji_sas(transcript: &[u8]) -> Result<Vec<String>, MechanismError> // 4 emoji

// State machine
pub enum PairingState { ... }
pub enum PairingRole { ... }
pub enum PairingError { ... }
pub const DEFAULT_PAIRING_TIMEOUT: Duration;

pub struct PairingSession { /* private */ }
impl PairingSession {
    pub fn new_initiator(identity: LocalIdentity, password: &[u8], timeout: Duration) -> (Self, PairingMessage)
    pub fn new_responder(identity: LocalIdentity, password: &[u8], timeout: Duration) -> Self
    pub fn handle_message(&mut self, msg: PairingMessage) -> Result<Option<PairingMessage>, PairingError>
}

// Messages (CBOR over wire)
pub enum PairingMessage { Request(PairRequest), Challenge(PairChallenge), Response(PairResponse), Confirm(PairConfirm), Reject(PairReject), Revoke(PairRevoke) }
pub enum PairRejectReason { ... }
pub enum PairingFlowType { ... }

// Rate limiter
pub struct RateLimiter { ... }
pub enum RateLimitError { ... }

// Unpairing
pub enum UnpairingEvent { ... }
pub enum UnpairingError { ... }
```

## Transport (src/transport/)

```rust
// High-level config
pub struct TransportConfig {
    pub quic_enabled: bool,          // default: true
    pub tcp_enabled: bool,           // default: true
    pub websocket_enabled: bool,     // default: true
    pub webtransport_enabled: bool,  // default: true
    pub per_transport_timeout: Duration,  // default: 10s
}

// 9-level fallback chain
pub enum FallbackTransportType {
    DirectQuic,       // P1
    StunHolePunch,    // P2
    DirectTcp,        // P3
    TurnUdp,          // P4
    TurnTcp,          // P5
    WebSocketTls,     // P6
    WebTransportH3,   // P7
    CircuitRelayV2,   // P8
    HttpsLongPoll,    // P9
}
impl FallbackTransportType {
    pub fn priority(self) -> u8
    pub fn tier0_available(self) -> bool
    pub fn all_in_order() -> &'static [FallbackTransportType]
}

pub struct TransportAttempt {
    pub priority: u8,
    pub transport_type: FallbackTransportType,
    pub timeout: Duration,
    pub available: bool,
}

pub struct TransportAttemptResult {
    pub transport_type: FallbackTransportType,
    pub error: Option<String>,
    // ...
}

// Also exported: FallbackChain, ConnectionQuality, ConnectionQualityMonitor,
// DegradationEvent, DegradationReason, MigrationEvent, QualityThresholds, TransportMigrator

// NAT detection
pub enum NatType {
    Open, FullCone, RestrictedCone, PortRestrictedCone, Symmetric, Unknown
}
// transport::NetworkInfo (separate from api::NetworkInfo but similar structure)
pub struct NetworkInfo { pub nat_type: NatType, pub external_addr: Option<SocketAddr> }
pub struct NatDetector { ... }

// Swarm (libp2p)
pub fn build_swarm(...) -> ...
pub struct SwarmController { ... }
pub struct SwarmCommandSender { ... }
pub enum CairnSwarmEvent { ... }
```

## Notes

- **All sessions start in `Connected` state.** State machine transitions: Connected→Unstable→Disconnected→Reconnecting→Suspended (backoff); Reconnected→Connected on success; Failed is terminal.
- **Channel names cannot start with `__cairn_`** — validated by `validate_channel_name()` and enforced in `ApiSession::open_channel()`.
- **Custom message type codes must be in range 0xF000–0xFFFF.**
- **Wire format**: messages use CBOR (`ciborium`) wrapped in `MessageEnvelope`. Payload is Double Ratchet encrypted when a ratchet is established.
- **SessionId**: UUID v7 (timestamp-ordered).
- **PeerId**: 34-byte SHA-256 multihash of Ed25519 pubkey, base58 string representation.
- **`recv_event()`** on `ApiNode` is the primary event loop entry point. Events are `mpsc` with capacity 256.

**Why:** Recorded for use when implementing a Jaunt harness or FFI wrapper over cairn-p2p.
**How to apply:** When writing Rust code that calls into cairn-p2p, use these exact signatures. When writing FFI/bindings, map these types to the target language.
