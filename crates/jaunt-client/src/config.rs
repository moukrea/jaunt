use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ClientConfig {
    #[serde(default)]
    pub cairn: CairnClientSection,
    #[serde(skip)]
    pub hosts: Vec<HostEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CairnClientSection {
    pub signal_server: Option<String>,
    pub signal_auth_token: Option<String>,
    pub turn_server: Option<String>,
    pub turn_username: Option<String>,
    pub turn_password: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HostEntry {
    pub alias: String,
    pub peer_id: String,
    pub host_name: String,
    pub signal_server: Option<String>,
    pub signal_auth_token: Option<String>,
    pub turn_server: Option<String>,
    pub turn_username: Option<String>,
    pub turn_password: Option<String>,
    pub paired_at: String,
}

impl ClientConfig {
    pub fn load() -> Self {
        let config_path = Self::config_path();
        let mut config: Self = match std::fs::read_to_string(&config_path) {
            Ok(contents) => toml::from_str(&contents).unwrap_or_default(),
            Err(_) => Self::default(),
        };

        // Load hosts from separate JSON file
        let hosts_path = Self::hosts_path();
        if let Ok(contents) = std::fs::read_to_string(&hosts_path) {
            config.hosts = serde_json::from_str(&contents).unwrap_or_default();
        }

        config
    }

    pub fn save(&self) {
        let hosts_path = Self::hosts_path();
        if let Some(parent) = hosts_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let hosts_json = serde_json::to_string_pretty(&self.hosts).unwrap_or_default();
        let _ = std::fs::write(&hosts_path, hosts_json);
    }

    pub fn config_path() -> PathBuf {
        if let Ok(dir) = std::env::var("XDG_CONFIG_HOME") {
            PathBuf::from(dir).join("jaunt").join("client.toml")
        } else if let Ok(home) = std::env::var("HOME") {
            PathBuf::from(home)
                .join(".config")
                .join("jaunt")
                .join("client.toml")
        } else {
            PathBuf::from("/etc/jaunt/client.toml")
        }
    }

    pub fn hosts_path() -> PathBuf {
        Self::config_path()
            .parent()
            .unwrap_or(&PathBuf::from("."))
            .join("hosts.json")
    }

    pub fn get_host(&self, alias: &str) -> Option<&HostEntry> {
        self.hosts.iter().find(|h| h.alias == alias)
    }

    pub fn add_host(&mut self, entry: HostEntry) {
        self.hosts.retain(|h| h.alias != entry.alias);
        self.hosts.push(entry);
    }

    pub fn remove_host(&mut self, alias: &str) {
        self.hosts.retain(|h| h.alias != alias);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let cfg = ClientConfig::default();
        assert!(cfg.hosts.is_empty());
        assert!(cfg.cairn.signal_server.is_none());
    }

    #[test]
    fn test_add_and_get_host() {
        let mut cfg = ClientConfig::default();
        cfg.add_host(HostEntry {
            alias: "mybox".into(),
            peer_id: "abc123".into(),
            host_name: "laptop".into(),
            signal_server: None,
            signal_auth_token: None,
            turn_server: None,
            turn_username: None,
            turn_password: None,
            paired_at: "2026-01-01T00:00:00Z".into(),
        });
        assert!(cfg.get_host("mybox").is_some());
        assert!(cfg.get_host("other").is_none());
    }

    #[test]
    fn test_remove_host() {
        let mut cfg = ClientConfig::default();
        cfg.add_host(HostEntry {
            alias: "mybox".into(),
            peer_id: "abc123".into(),
            host_name: "laptop".into(),
            signal_server: None,
            signal_auth_token: None,
            turn_server: None,
            turn_username: None,
            turn_password: None,
            paired_at: "2026-01-01T00:00:00Z".into(),
        });
        cfg.remove_host("mybox");
        assert!(cfg.get_host("mybox").is_none());
    }
}
