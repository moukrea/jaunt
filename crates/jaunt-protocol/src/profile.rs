use base64::Engine;
use serde::{Deserialize, Serialize};

/// Connection profile shared between host (generator) and all clients (consumers).
/// Contains pairing data and cairn infrastructure config for any tier.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionProfile {
    pub pairing: PairingData,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signal_server: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signal_auth_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_server: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_password: Option<String>,
    pub host_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PairingData {
    Qr { qr_data: Vec<u8> },
    Link { uri: String },
    Pin { pin: String },
}

/// Encode a connection profile into a URL with the profile as a base64url fragment.
/// The fragment is never sent to any server — it stays in the browser.
pub fn encode_profile_url(profile: &ConnectionProfile) -> String {
    let json = serde_json::to_vec(profile).unwrap();
    let encoded = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(&json);
    format!("https://jaunt.app/#{encoded}")
}

/// Decode a connection profile from a URL fragment (base64url-encoded JSON).
pub fn decode_profile_from_fragment(fragment: &str) -> Result<ConnectionProfile, String> {
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(fragment)
        .map_err(|e| format!("base64 decode error: {e}"))?;
    serde_json::from_slice(&bytes).map_err(|e| format!("JSON decode error: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_roundtrip_tier0() {
        let profile = ConnectionProfile {
            pairing: PairingData::Qr {
                qr_data: vec![1, 2, 3],
            },
            signal_server: None,
            signal_auth_token: None,
            turn_server: None,
            turn_username: None,
            turn_password: None,
            host_name: "mybox".into(),
        };
        let url = encode_profile_url(&profile);
        assert!(url.starts_with("https://jaunt.app/#"));
        let fragment = url.strip_prefix("https://jaunt.app/#").unwrap();
        let decoded = decode_profile_from_fragment(fragment).unwrap();
        assert_eq!(decoded.host_name, "mybox");
        assert!(decoded.signal_server.is_none());
        match decoded.pairing {
            PairingData::Qr { qr_data } => assert_eq!(qr_data, vec![1, 2, 3]),
            _ => panic!("wrong pairing type"),
        }
    }

    #[test]
    fn profile_roundtrip_tier1() {
        let profile = ConnectionProfile {
            pairing: PairingData::Pin {
                pin: "A1B2-C3D4".into(),
            },
            signal_server: Some("wss://signal.example.com".into()),
            signal_auth_token: Some("token123".into()),
            turn_server: Some("turn:relay.example.com:3478".into()),
            turn_username: Some("user".into()),
            turn_password: Some("pass".into()),
            host_name: "mybox".into(),
        };
        let url = encode_profile_url(&profile);
        let fragment = url.strip_prefix("https://jaunt.app/#").unwrap();
        let decoded = decode_profile_from_fragment(fragment).unwrap();
        assert_eq!(
            decoded.signal_server.as_deref(),
            Some("wss://signal.example.com")
        );
        assert_eq!(
            decoded.turn_server.as_deref(),
            Some("turn:relay.example.com:3478")
        );
    }

    #[test]
    fn profile_tier0_omits_optional_fields() {
        let profile = ConnectionProfile {
            pairing: PairingData::Qr { qr_data: vec![] },
            signal_server: None,
            signal_auth_token: None,
            turn_server: None,
            turn_username: None,
            turn_password: None,
            host_name: "host".into(),
        };
        let json = serde_json::to_string(&profile).unwrap();
        assert!(!json.contains("signal_server"));
        assert!(!json.contains("turn_server"));
    }

    #[test]
    fn profile_link_pairing() {
        let profile = ConnectionProfile {
            pairing: PairingData::Link {
                uri: "cairn://pair/abc123".into(),
            },
            signal_server: None,
            signal_auth_token: None,
            turn_server: None,
            turn_username: None,
            turn_password: None,
            host_name: "laptop".into(),
        };
        let url = encode_profile_url(&profile);
        let fragment = url.strip_prefix("https://jaunt.app/#").unwrap();
        let decoded = decode_profile_from_fragment(fragment).unwrap();
        match decoded.pairing {
            PairingData::Link { uri } => assert_eq!(uri, "cairn://pair/abc123"),
            _ => panic!("wrong pairing type"),
        }
    }

    #[test]
    fn decode_invalid_fragment() {
        assert!(decode_profile_from_fragment("!!!invalid!!!").is_err());
    }

    #[test]
    fn decode_valid_base64_invalid_json() {
        let encoded = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(b"not json");
        assert!(decode_profile_from_fragment(&encoded).is_err());
    }
}
