use cairn_p2p::{CairnConfig, Event, Node};
use jaunt_protocol::messages::*;
use jaunt_protocol::profile::*;

/// Tag byte for RPC messages (must match jaunt-host).
const TAG_RPC: u8 = 0x01;

/// Encode an RPC request with TAG_RPC prefix.
fn encode_tagged_request(request: &RpcRequest) -> Result<Vec<u8>, String> {
    let payload = jaunt_protocol::encode_request(request).map_err(|e| format!("encode: {e}"))?;
    let mut tagged = Vec::with_capacity(1 + payload.len());
    tagged.push(TAG_RPC);
    tagged.extend_from_slice(&payload);
    Ok(tagged)
}

/// Decode a response, stripping the TAG_RPC prefix if present.
fn decode_response(data: &[u8]) -> Result<RpcResponse, String> {
    let payload = if !data.is_empty() && data[0] == TAG_RPC {
        &data[1..]
    } else {
        data
    };
    jaunt_protocol::decode_response(payload).map_err(|e| format!("decode: {e}"))
}

/// Wait for an RPC response from the host.
async fn recv_rpc_response(node: &Node) -> Result<RpcResponse, String> {
    match node.recv_event().await {
        Some(Event::MessageReceived { data, .. }) => decode_response(&data),
        Some(_) => Err("unexpected event from host".to_string()),
        None => Err("connection closed".to_string()),
    }
}

/// Pair with a host using a PIN code
pub async fn pair_pin(pin: &str) -> Result<String, String> {
    let config = CairnConfig::default();
    let node =
        cairn_p2p::create_with_config(config).map_err(|e| format!("node creation failed: {e}"))?;

    let peer_id = node
        .pair_enter_pin(pin)
        .await
        .map_err(|e| format!("pairing failed: {e}"))?;

    Ok(peer_id.to_string())
}

/// Pair with a host using a link containing an embedded connection profile
pub async fn pair_link(link: &str) -> Result<(String, String), String> {
    let fragment = link
        .split('#')
        .nth(1)
        .ok_or("invalid link: no fragment")?;
    let profile = decode_profile_from_fragment(fragment)?;

    let mut config = CairnConfig::default();
    if let Some(ref s) = profile.signal_server {
        config.signaling_servers = vec![s.clone()];
    }
    if let (Some(ref url), Some(ref user), Some(ref pass)) = (
        &profile.turn_server,
        &profile.turn_username,
        &profile.turn_password,
    ) {
        config.turn_servers = vec![cairn_p2p::TurnServer {
            url: url.clone(),
            username: user.clone(),
            credential: pass.clone(),
        }];
    }

    let node =
        cairn_p2p::create_with_config(config).map_err(|e| format!("node creation failed: {e}"))?;

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

    Ok((peer_id.to_string(), profile.host_name))
}

/// Get sessions from a connected host
pub async fn get_sessions(peer_id: &str) -> Result<String, String> {
    let node = create_node()?;
    let session = node
        .connect(peer_id)
        .await
        .map_err(|e| format!("connect failed: {e}"))?;
    let channel = session
        .open_channel("rpc")
        .await
        .map_err(|e| format!("channel failed: {e}"))?;

    let data = encode_tagged_request(&RpcRequest::SessionList {})?;
    session
        .send(&channel, &data)
        .await
        .map_err(|e| format!("send: {e}"))?;

    match recv_rpc_response(&node).await? {
        RpcResponse::Ok(RpcData::SessionList(sessions)) => {
            serde_json::to_string(&sessions).map_err(|e| format!("json: {e}"))
        }
        RpcResponse::Error { message, .. } => Err(message),
        _ => Err("unexpected response".to_string()),
    }
}

/// Send a command to a session on the host
pub async fn send_command(
    peer_id: &str,
    session_target: &str,
    command: &str,
) -> Result<(), String> {
    let node = create_node()?;
    let session = node
        .connect(peer_id)
        .await
        .map_err(|e| format!("connect failed: {e}"))?;
    let channel = session
        .open_channel("rpc")
        .await
        .map_err(|e| format!("channel failed: {e}"))?;

    let data = encode_tagged_request(&RpcRequest::SessionSend {
        target: session_target.to_string(),
        input: command.to_string(),
    })?;
    session
        .send(&channel, &data)
        .await
        .map_err(|e| format!("send: {e}"))?;

    match recv_rpc_response(&node).await? {
        RpcResponse::Ok(_) => Ok(()),
        RpcResponse::Error { message, .. } => Err(message),
        _ => Err("unexpected response".to_string()),
    }
}

/// Create a new session on the host
pub async fn create_session(peer_id: &str, name: Option<&str>) -> Result<String, String> {
    let node = create_node()?;
    let session = node
        .connect(peer_id)
        .await
        .map_err(|e| format!("connect failed: {e}"))?;
    let channel = session
        .open_channel("rpc")
        .await
        .map_err(|e| format!("channel failed: {e}"))?;

    let data = encode_tagged_request(&RpcRequest::SessionCreate {
        shell: None,
        name: name.map(|s| s.to_string()),
        cwd: None,
    })?;
    session
        .send(&channel, &data)
        .await
        .map_err(|e| format!("send: {e}"))?;

    match recv_rpc_response(&node).await? {
        RpcResponse::Ok(RpcData::SessionCreated { id }) => Ok(id),
        RpcResponse::Error { message, .. } => Err(message),
        _ => Err("unexpected response".to_string()),
    }
}

/// Kill a session on the host
pub async fn kill_session(peer_id: &str, session_target: &str) -> Result<(), String> {
    let node = create_node()?;
    let session = node
        .connect(peer_id)
        .await
        .map_err(|e| format!("connect failed: {e}"))?;
    let channel = session
        .open_channel("rpc")
        .await
        .map_err(|e| format!("channel failed: {e}"))?;

    let data = encode_tagged_request(&RpcRequest::SessionKill {
        target: session_target.to_string(),
    })?;
    session
        .send(&channel, &data)
        .await
        .map_err(|e| format!("send: {e}"))?;

    match recv_rpc_response(&node).await? {
        RpcResponse::Ok(_) => Ok(()),
        RpcResponse::Error { message, .. } => Err(message),
        _ => Err("unexpected response".to_string()),
    }
}

fn create_node() -> Result<Node, String> {
    let config = CairnConfig::default();
    cairn_p2p::create_with_config(config).map_err(|e| format!("node creation failed: {e}"))
}
