use crate::config::JauntConfig;
use cairn_p2p::Node;
use jaunt_protocol::profile::*;

pub async fn generate_qr_profile(
    node: &Node,
    config: &JauntConfig,
    listen_addrs: &[String],
) -> Result<(ConnectionProfile, String), String> {
    let qr_data = node
        .pair_generate_qr()
        .await
        .map_err(|e| format!("failed to generate QR: {e}"))?;

    let host_name = hostname::get()
        .map(|h| h.to_string_lossy().into_owned())
        .unwrap_or_else(|_| "unknown".to_string());

    let libp2p_peer_id = node.libp2p_peer_id().map(|pid| pid.to_string());

    let profile = ConnectionProfile {
        pairing: PairingData::Qr {
            qr_data: qr_data.payload,
        },
        signal_server: config.cairn.signal_server.clone(),
        signal_auth_token: config.cairn.signal_auth_token.clone(),
        turn_server: config.cairn.turn_server.clone(),
        turn_username: config.cairn.turn_username.clone(),
        turn_password: config.cairn.turn_password.clone(),
        ws_addrs: listen_addrs.to_vec(),
        libp2p_peer_id,
        host_name,
    };

    if let Some(ref web_url) = config.server.web_url {
        if web_url.contains("localhost") || web_url.contains("127.0.0.1") {
            eprintln!(
                "  WARNING: web_url is set to '{}' — this URL is not reachable from other devices.",
                web_url
            );
            eprintln!(
                "           Remove the web_url setting from your config or set it to '{}'.",
                DEFAULT_WEB_URL
            );
        }
    }

    let url = encode_profile_url(&profile, config.server.web_url.as_deref());
    Ok((profile, url))
}

pub async fn generate_pin_profile(
    node: &Node,
    config: &JauntConfig,
    listen_addrs: &[String],
) -> Result<(ConnectionProfile, String), String> {
    let pin_data = node
        .pair_generate_pin()
        .await
        .map_err(|e| format!("failed to generate PIN: {e}"))?;

    let host_name = hostname::get()
        .map(|h| h.to_string_lossy().into_owned())
        .unwrap_or_else(|_| "unknown".to_string());

    let libp2p_peer_id = node.libp2p_peer_id().map(|pid| pid.to_string());

    let profile = ConnectionProfile {
        pairing: PairingData::Pin {
            pin: pin_data.pin.clone(),
        },
        signal_server: config.cairn.signal_server.clone(),
        signal_auth_token: config.cairn.signal_auth_token.clone(),
        turn_server: config.cairn.turn_server.clone(),
        turn_username: config.cairn.turn_username.clone(),
        turn_password: config.cairn.turn_password.clone(),
        ws_addrs: listen_addrs.to_vec(),
        libp2p_peer_id,
        host_name,
    };

    Ok((profile, pin_data.pin))
}
