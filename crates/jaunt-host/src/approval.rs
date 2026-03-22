use crate::config::JauntConfig;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApprovedDevice {
    pub peer_id: String,
    pub name: String,
    pub approved_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ApprovalStore {
    pub devices: Vec<ApprovedDevice>,
}

impl ApprovalStore {
    pub fn load() -> Self {
        let path = JauntConfig::config_dir().join("devices.json");
        match std::fs::read_to_string(&path) {
            Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
            Err(_) => Self::default(),
        }
    }

    pub fn save(&self) {
        let path = JauntConfig::config_dir().join("devices.json");
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let json = serde_json::to_string_pretty(self).unwrap_or_default();
        let _ = std::fs::write(&path, json);
    }

    pub fn is_approved(&self, peer_id: &str) -> bool {
        self.devices.iter().any(|d| d.peer_id == peer_id)
    }

    pub fn approve(&mut self, peer_id: &str, name: &str) {
        if !self.is_approved(peer_id) {
            self.devices.push(ApprovedDevice {
                peer_id: peer_id.to_string(),
                name: name.to_string(),
                approved_at: utc_now(),
            });
        }
    }

    pub fn revoke(&mut self, peer_id: &str) {
        self.devices.retain(|d| d.peer_id != peer_id);
    }

    pub fn list(&self) -> &[ApprovedDevice] {
        &self.devices
    }
}

fn utc_now() -> String {
    use std::time::SystemTime;
    let secs = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let days = secs / 86400;
    let t = secs % 86400;
    let (h, m, s) = (t / 3600, (t % 3600) / 60, t % 60);
    let mut d = days + 719468;
    let era = d / 146097;
    let doe = d - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if mo <= 2 { y + 1 } else { y };
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{m:02}:{s:02}Z")
}
