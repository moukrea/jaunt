use serde::{Deserialize, Serialize};
use tauri::{Emitter, State};

mod cairn_bridge;

use cairn_bridge::CairnState;

// --- Tauri command result types ---

#[derive(Debug, Serialize, Deserialize)]
pub struct ConnectInfo {
    pub peer_id: String,
    pub host_name: String,
}

// --- Tauri commands ---

/// Connect to a host using a URL containing a base64url-encoded connection profile.
///
/// This is the primary connection path: the URL fragment contains the full
/// ConnectionProfile with pairing data, infrastructure config, and the host's
/// libp2p PeerId + multiaddrs.
#[tauri::command]
async fn connect_with_url(
    url: String,
    state: State<'_, CairnState>,
    app: tauri::AppHandle,
) -> Result<ConnectInfo, String> {
    let fragment = url
        .split('#')
        .nth(1)
        .ok_or("invalid URL: no fragment")?;

    let profile = jaunt_protocol::profile::decode_profile_from_fragment(fragment)?;

    // Pair using the profile's pairing data
    let peer_id = cairn_bridge::pair_from_profile(&state, &profile).await?;

    // Extract multiaddrs for the transport connection.
    // The native Rust client can dial ALL address types (TCP, QUIC, WS),
    // not just /ws like the browser.
    let addrs: Vec<String> = profile.ws_addrs.clone();

    // Connect via the native cairn transport stack.
    // The peer_id from pairing is the cairn-level peer ID. For libp2p transport
    // we use the same ID -- the host exposes it in the profile's ws_addrs.
    if !addrs.is_empty() {
        cairn_bridge::connect(&state, &peer_id, &addrs).await?;
        cairn_bridge::register_message_handler(&state, app).await?;
    }

    Ok(ConnectInfo {
        peer_id,
        host_name: profile.host_name,
    })
}

/// Connect to a host by providing its libp2p PeerId and multiaddrs directly.
///
/// The node must already be initialized (via connect_with_url or init_node).
/// This is used for reconnection when the profile data is already known.
#[tauri::command]
async fn connect_to_host(
    peer_id: String,
    addrs: Vec<String>,
    state: State<'_, CairnState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    // Initialize a fresh node if none exists
    if !cairn_bridge::is_connected(&state).await {
        cairn_bridge::init_node(&state, None).await?;
    }

    cairn_bridge::connect(&state, &peer_id, &addrs).await?;
    cairn_bridge::register_message_handler(&state, app).await?;
    Ok(())
}

/// Send an RPC request to the host and return immediately.
///
/// The response arrives asynchronously via the `cairn://rpc-response` event.
/// The request is msgpack-encoded using the jaunt-protocol crate, matching
/// the same wire format the web client uses.
#[tauri::command]
async fn send_rpc(data: Vec<u8>, state: State<'_, CairnState>) -> Result<(), String> {
    let request: jaunt_protocol::messages::RpcRequest =
        rmp_serde::from_slice(&data).map_err(|e| format!("decode request: {e}"))?;
    cairn_bridge::send_rpc(&state, &request).await
}

/// Send raw PTY input bytes to the host.
///
/// The input is prefixed with TAG_PTY (0x02) and sent on the RPC channel,
/// matching the same tag-based multiplexing the web client uses.
#[tauri::command]
async fn send_pty_input(data: Vec<u8>, state: State<'_, CairnState>) -> Result<(), String> {
    cairn_bridge::send_pty_input(&state, &data).await
}

/// Send a resize notification to the host.
#[tauri::command]
async fn send_resize(
    cols: u16,
    rows: u16,
    state: State<'_, CairnState>,
) -> Result<(), String> {
    let request = jaunt_protocol::messages::RpcRequest::Resize { cols, rows };
    cairn_bridge::send_rpc(&state, &request).await
}

/// Disconnect from the host and clean up.
#[tauri::command]
async fn disconnect(state: State<'_, CairnState>) -> Result<(), String> {
    cairn_bridge::disconnect(&state).await
}

/// Check if there is an active connection.
#[tauri::command]
async fn is_connected(state: State<'_, CairnState>) -> Result<bool, String> {
    Ok(cairn_bridge::is_connected(&state).await)
}

/// Get the connected host name.
#[tauri::command]
async fn get_host_name(state: State<'_, CairnState>) -> Result<String, String> {
    Ok(cairn_bridge::host_name(&state).await)
}

/// Get the connected peer ID.
#[tauri::command]
async fn get_peer_id(state: State<'_, CairnState>) -> Result<Option<String>, String> {
    Ok(cairn_bridge::peer_id(&state).await)
}

// --- Tauri app entry point ---

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(CairnState::default())
        .invoke_handler(tauri::generate_handler![
            connect_with_url,
            connect_to_host,
            send_rpc,
            send_pty_input,
            send_resize,
            disconnect,
            is_connected,
            get_host_name,
            get_peer_id,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
