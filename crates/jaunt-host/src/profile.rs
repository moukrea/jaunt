use crate::config::JauntConfig;
use cairn_p2p::Node;
use jaunt_protocol::profile::*;

pub async fn generate_qr_profile(
    node: &Node,
    config: &JauntConfig,
) -> Result<(ConnectionProfile, String), String> {
    let qr_data = node
        .pair_generate_qr()
        .await
        .map_err(|e| format!("failed to generate QR: {e}"))?;

    let host_name = hostname::get()
        .map(|h| h.to_string_lossy().into_owned())
        .unwrap_or_else(|_| "unknown".to_string());

    let profile = ConnectionProfile {
        pairing: PairingData::Qr {
            qr_data: qr_data.payload,
        },
        signal_server: config.cairn.signal_server.clone(),
        signal_auth_token: config.cairn.signal_auth_token.clone(),
        turn_server: config.cairn.turn_server.clone(),
        turn_username: config.cairn.turn_username.clone(),
        turn_password: config.cairn.turn_password.clone(),
        host_name,
    };

    let url = encode_profile_url(&profile, config.server.web_url.as_deref());
    Ok((profile, url))
}

pub async fn generate_pin_profile(
    node: &Node,
    config: &JauntConfig,
) -> Result<(ConnectionProfile, String), String> {
    let pin_data = node
        .pair_generate_pin()
        .await
        .map_err(|e| format!("failed to generate PIN: {e}"))?;

    let host_name = hostname::get()
        .map(|h| h.to_string_lossy().into_owned())
        .unwrap_or_else(|_| "unknown".to_string());

    let profile = ConnectionProfile {
        pairing: PairingData::Pin {
            pin: pin_data.pin.clone(),
        },
        signal_server: config.cairn.signal_server.clone(),
        signal_auth_token: config.cairn.signal_auth_token.clone(),
        turn_server: config.cairn.turn_server.clone(),
        turn_username: config.cairn.turn_username.clone(),
        turn_password: config.cairn.turn_password.clone(),
        host_name,
    };

    Ok((profile, pin_data.pin))
}
