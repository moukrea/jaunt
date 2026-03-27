use std::sync::Arc;

use cairn_p2p::{CairnConfig, Channel, Event, Node, Session, TurnServer};
use jaunt_protocol::messages::{RpcRequest, RpcResponse};
use jaunt_protocol::profile::{ConnectionProfile, PairingData};
use tauri::Emitter;
use tokio::sync::Mutex;

/// Application-layer message tags (must match web/src/lib/cairn.ts).
const TAG_RPC: u8 = 0x01;
const TAG_PTY: u8 = 0x02;

/// Persistent cairn state shared across Tauri commands.
///
/// A single Node and Session are held for the lifetime of the connection.
/// The Node owns the libp2p swarm; the Session owns the encrypted channel
/// to the remote host.
pub struct CairnState {
    node: Mutex<Option<Node>>,
    session: Mutex<Option<Session>>,
    channel: Mutex<Option<Channel>>,
    peer_id: Mutex<Option<String>>,
    host_name: Mutex<String>,
}

impl CairnState {
    pub fn new() -> Self {
        Self {
            node: Mutex::new(None),
            session: Mutex::new(None),
            channel: Mutex::new(None),
            peer_id: Mutex::new(None),
            host_name: Mutex::new(String::new()),
        }
    }
}

impl Default for CairnState {
    fn default() -> Self {
        Self::new()
    }
}

/// Build a CairnConfig from an optional ConnectionProfile.
fn config_from_profile(profile: Option<&ConnectionProfile>) -> CairnConfig {
    let mut config = CairnConfig::default();

    if let Some(p) = profile {
        if let Some(ref s) = p.signal_server {
            config.signaling_servers = vec![s.clone()];
        }
        if let (Some(ref url), Some(ref user), Some(ref pass)) =
            (&p.turn_server, &p.turn_username, &p.turn_password)
        {
            config.turn_servers = vec![TurnServer {
                url: url.clone(),
                username: user.clone(),
                credential: pass.clone(),
            }];
        }
    }

    config
}

/// Initialize the cairn node. Must be called before connect.
pub async fn init_node(
    state: &CairnState,
    profile: Option<&ConnectionProfile>,
) -> Result<(), String> {
    let config = config_from_profile(profile);
    let node =
        cairn_p2p::create_with_config(config).map_err(|e| format!("node creation failed: {e}"))?;
    *state.node.lock().await = Some(node);
    Ok(())
}

/// Pair using a connection profile (from URL fragment).
/// Extracts pairing data and performs the cairn pairing handshake.
pub async fn pair_from_profile(
    state: &CairnState,
    profile: &ConnectionProfile,
) -> Result<String, String> {
    // Initialize node with profile config
    init_node(state, Some(profile)).await?;

    let mut node_guard = state.node.lock().await;
    let node = node_guard.as_mut().ok_or("node not initialized")?;

    let peer_id = match &profile.pairing {
        PairingData::Qr { qr_data } => node
            .pair_scan_qr(qr_data)
            .await
            .map_err(|e| format!("QR pairing failed: {e}"))?,
        PairingData::Link { uri } => node
            .pair_from_link(uri)
            .await
            .map_err(|e| format!("link pairing failed: {e}"))?,
        PairingData::Pin { pin } => node
            .pair_enter_pin(pin)
            .await
            .map_err(|e| format!("PIN pairing failed: {e}"))?,
    };

    let pid_str = peer_id.to_string();
    *state.peer_id.lock().await = Some(pid_str.clone());
    *state.host_name.lock().await = profile.host_name.clone();

    Ok(pid_str)
}

/// Connect to a host using its libp2p PeerId and multiaddrs.
///
/// This starts the libp2p transport (TCP, QUIC, WS -- full native stack),
/// then performs the cairn Noise XX handshake to establish an encrypted session.
/// The session and RPC channel are stored persistently in CairnState.
pub async fn connect(
    state: &CairnState,
    peer_id: &str,
    addrs: &[String],
) -> Result<(), String> {
    let mut node_guard = state.node.lock().await;
    let node = node_guard.as_mut().ok_or("node not initialized")?;

    // Start the transport layer (TCP + QUIC + WS + relay + DCUtR + DHT).
    // This is the key advantage over the browser: full native transports.
    log::info!("Starting cairn transport (native)...");
    node.start_transport()
        .await
        .map_err(|e| format!("transport start failed: {e}"))?;
    log::info!("Transport started");

    // Connect to the remote host
    log::info!("Connecting to host: {} addrs: {:?}", peer_id, addrs);
    let addr_strings: Vec<String> = addrs.to_vec();
    let session = node
        .connect_transport(peer_id, &addr_strings)
        .await
        .map_err(|e| format!("connect failed: {e}"))?;

    // Open the RPC channel (same channel name as the web client)
    let channel = session
        .open_channel("rpc")
        .await
        .map_err(|e| format!("channel open failed: {e}"))?;

    log::info!("Connected and channel opened");

    *state.session.lock().await = Some(session);
    *state.channel.lock().await = Some(channel);
    *state.peer_id.lock().await = Some(peer_id.to_string());

    Ok(())
}

/// Register a message callback on the session that forwards incoming data
/// to the Tauri frontend via events.
///
/// This must be called after connect(). It spawns a background listener
/// that emits `cairn://pty-output` and `cairn://rpc-response` events.
pub async fn register_message_handler(
    state: &CairnState,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let session_guard = state.session.lock().await;
    let session = session_guard.as_ref().ok_or("not connected")?;
    let channel_guard = state.channel.lock().await;
    let channel = channel_guard.as_ref().ok_or("no channel")?;

    let handle = app_handle.clone();
    session
        .on_message(channel, move |data: &[u8]| {
            if data.is_empty() {
                return;
            }

            let tag = data[0];
            let payload = &data[1..];

            match tag {
                TAG_RPC => {
                    // Forward RPC response to frontend
                    let _ = handle.emit("cairn://rpc-response", payload.to_vec());
                }
                TAG_PTY => {
                    // Forward PTY output to frontend
                    let _ = handle.emit("cairn://pty-output", payload.to_vec());
                }
                _ => {
                    // Untagged: treat as PTY
                    let _ = handle.emit("cairn://pty-output", data.to_vec());
                }
            }
        })
        .await;

    // Also register state change callback
    let handle2 = app_handle.clone();
    session
        .on_state_change(move |new_state| {
            let state_str = format!("{}", new_state);
            let _ = handle2.emit("cairn://state-changed", state_str);
        })
        .await;

    Ok(())
}

/// Send an RPC request (msgpack-encoded, TAG_RPC prefixed) to the host.
pub async fn send_rpc(state: &CairnState, request: &RpcRequest) -> Result<(), String> {
    let session_guard = state.session.lock().await;
    let session = session_guard.as_ref().ok_or("not connected")?;
    let channel_guard = state.channel.lock().await;
    let channel = channel_guard.as_ref().ok_or("no channel")?;

    let data =
        jaunt_protocol::messages::encode_request(request).map_err(|e| format!("encode: {e}"))?;

    // Prefix with TAG_RPC (matching the web client protocol)
    let mut tagged = Vec::with_capacity(1 + data.len());
    tagged.push(TAG_RPC);
    tagged.extend_from_slice(&data);

    session
        .send(channel, &tagged)
        .await
        .map_err(|e| format!("send: {e}"))?;

    Ok(())
}

/// Send raw PTY input to the host (TAG_PTY prefixed).
pub async fn send_pty_input(state: &CairnState, data: &[u8]) -> Result<(), String> {
    let session_guard = state.session.lock().await;
    let session = session_guard.as_ref().ok_or("not connected")?;
    let channel_guard = state.channel.lock().await;
    let channel = channel_guard.as_ref().ok_or("no channel")?;

    let mut tagged = Vec::with_capacity(1 + data.len());
    tagged.push(TAG_PTY);
    tagged.extend_from_slice(data);

    session
        .send(channel, &tagged)
        .await
        .map_err(|e| format!("send: {e}"))?;

    Ok(())
}

/// Disconnect from the host and clean up all state.
pub async fn disconnect(state: &CairnState) -> Result<(), String> {
    // Close channel
    if let Some(channel) = state.channel.lock().await.take() {
        channel.close();
    }

    // Close session
    if let Some(session) = state.session.lock().await.take() {
        let _ = session.close().await;
    }

    // Drop node (stops the swarm)
    *state.node.lock().await = None;
    *state.peer_id.lock().await = None;
    *state.host_name.lock().await = String::new();

    Ok(())
}

/// Check if there is an active connection.
pub async fn is_connected(state: &CairnState) -> bool {
    state.session.lock().await.is_some()
}

/// Get the connected host name.
pub async fn host_name(state: &CairnState) -> String {
    state.host_name.lock().await.clone()
}

/// Get the connected peer ID.
pub async fn peer_id(state: &CairnState) -> Option<String> {
    state.peer_id.lock().await.clone()
}
