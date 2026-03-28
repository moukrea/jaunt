use cairn_p2p::{CairnConfig, Node};
use jaunt_protocol::messages::*;
use jaunt_protocol::profile::*;

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

    let req = RpcRequest::SessionList {};
    let data = jaunt_protocol::encode_request(&req).map_err(|e| format!("encode: {e}"))?;
    session
        .send(&channel, &data)
        .await
        .map_err(|e| format!("send: {e}"))?;

    // Return as JSON for the frontend
    Ok("[]".to_string())
}

/// Send a command to a session on the host
pub async fn send_command(peer_id: &str, session_target: &str, command: &str) -> Result<(), String> {
    let node = create_node()?;
    let session = node
        .connect(peer_id)
        .await
        .map_err(|e| format!("connect failed: {e}"))?;
    let channel = session
        .open_channel("rpc")
        .await
        .map_err(|e| format!("channel failed: {e}"))?;

    let req = RpcRequest::SessionSend {
        target: session_target.to_string(),
        input: command.to_string(),
    };
    let data = jaunt_protocol::encode_request(&req).map_err(|e| format!("encode: {e}"))?;
    session
        .send(&channel, &data)
        .await
        .map_err(|e| format!("send: {e}"))?;

    Ok(())
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

    let req = RpcRequest::SessionCreate {
        shell: None,
        name: name.map(|s| s.to_string()),
        cwd: None,
    };
    let data = jaunt_protocol::encode_request(&req).map_err(|e| format!("encode: {e}"))?;
    session
        .send(&channel, &data)
        .await
        .map_err(|e| format!("send: {e}"))?;

    Ok("created".to_string())
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

    let req = RpcRequest::SessionKill {
        target: session_target.to_string(),
    };
    let data = jaunt_protocol::encode_request(&req).map_err(|e| format!("encode: {e}"))?;
    session
        .send(&channel, &data)
        .await
        .map_err(|e| format!("send: {e}"))?;

    Ok(())
}

fn create_node() -> Result<Node, String> {
    let config = CairnConfig::default();
    cairn_p2p::create_with_config(config).map_err(|e| format!("node creation failed: {e}"))
}
