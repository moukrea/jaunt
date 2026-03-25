use crate::config::JauntConfig;
use cairn_p2p::Node;
use jaunt_protocol::profile::*;
use std::net::SocketAddr;

pub async fn generate_qr_profile(
    node: &Node,
    config: &JauntConfig,
    ws_addr: &SocketAddr,
) -> Result<(ConnectionProfile, String), String> {
    let qr_data = node
        .pair_generate_qr()
        .await
        .map_err(|e| format!("failed to generate QR: {e}"))?;

    let host_name = hostname::get()
        .map(|h| h.to_string_lossy().into_owned())
        .unwrap_or_else(|_| "unknown".to_string());

    // Build WS addresses from the WS server's bound address.
    // If bound to 0.0.0.0, enumerate non-loopback network interfaces.
    let ws_addrs = build_ws_addrs(ws_addr);

    let profile = ConnectionProfile {
        pairing: PairingData::Qr {
            qr_data: qr_data.payload,
        },
        signal_server: config.cairn.signal_server.clone(),
        signal_auth_token: config.cairn.signal_auth_token.clone(),
        turn_server: config.cairn.turn_server.clone(),
        turn_username: config.cairn.turn_username.clone(),
        turn_password: config.cairn.turn_password.clone(),
        ws_addrs,
        host_name,
    };

    let url = encode_profile_url(&profile, config.server.web_url.as_deref());
    Ok((profile, url))
}

pub async fn generate_pin_profile(
    node: &Node,
    config: &JauntConfig,
    ws_addr: &SocketAddr,
) -> Result<(ConnectionProfile, String), String> {
    let pin_data = node
        .pair_generate_pin()
        .await
        .map_err(|e| format!("failed to generate PIN: {e}"))?;

    let host_name = hostname::get()
        .map(|h| h.to_string_lossy().into_owned())
        .unwrap_or_else(|_| "unknown".to_string());

    let ws_addrs = build_ws_addrs(ws_addr);

    let profile = ConnectionProfile {
        pairing: PairingData::Pin {
            pin: pin_data.pin.clone(),
        },
        signal_server: config.cairn.signal_server.clone(),
        signal_auth_token: config.cairn.signal_auth_token.clone(),
        turn_server: config.cairn.turn_server.clone(),
        turn_username: config.cairn.turn_username.clone(),
        turn_password: config.cairn.turn_password.clone(),
        ws_addrs,
        host_name,
    };

    Ok((profile, pin_data.pin))
}

/// Build WebSocket URLs from the bound address.
/// If bound to 0.0.0.0, use the LAN IP. Otherwise use the specific IP.
fn build_ws_addrs(addr: &SocketAddr) -> Vec<String> {
    let port = addr.port();
    let ip = addr.ip();

    if ip.is_unspecified() {
        // Try to get the LAN IP by connecting to a public address
        // (doesn't actually send data, just resolves the local interface)
        if let Ok(socket) = std::net::UdpSocket::bind("0.0.0.0:0") {
            if socket.connect("8.8.8.8:80").is_ok() {
                if let Ok(local_addr) = socket.local_addr() {
                    return vec![format!("ws://{}:{port}", local_addr.ip())];
                }
            }
        }
        // Fallback
        vec![format!("ws://127.0.0.1:{port}")]
    } else {
        vec![format!("ws://{ip}:{port}")]
    }
}
