use serde::Deserialize;
use std::path::PathBuf;

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct JauntConfig {
    pub server: ServerConfig,
    pub cairn: CairnSection,
    pub files: FilesConfig,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct ServerConfig {
    pub shell: String,
    pub auto_session: bool,
    pub require_approval: bool,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct CairnSection {
    pub signal_server: Option<String>,
    pub signal_auth_token: Option<String>,
    pub turn_server: Option<String>,
    pub turn_username: Option<String>,
    pub turn_password: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct FilesConfig {
    pub enabled: bool,
    pub roots: Vec<String>,
    pub show_hidden: bool,
    pub write: bool,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            shell: std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string()),
            auto_session: true,
            require_approval: true,
        }
    }
}

impl Default for FilesConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            roots: vec!["~".to_string()],
            show_hidden: false,
            write: false,
        }
    }
}

impl JauntConfig {
    pub fn load() -> Self {
        let path = Self::config_path();
        match std::fs::read_to_string(&path) {
            Ok(contents) => toml::from_str(&contents).unwrap_or_default(),
            Err(_) => Self::default(),
        }
    }

    pub fn config_path() -> PathBuf {
        if let Ok(dir) = std::env::var("XDG_CONFIG_HOME") {
            PathBuf::from(dir).join("jaunt").join("config.toml")
        } else if let Ok(home) = std::env::var("HOME") {
            PathBuf::from(home)
                .join(".config")
                .join("jaunt")
                .join("config.toml")
        } else {
            PathBuf::from("/etc/jaunt/config.toml")
        }
    }

    pub fn config_dir() -> PathBuf {
        Self::config_path()
            .parent()
            .unwrap_or(&PathBuf::from("."))
            .to_path_buf()
    }

    pub fn resolve_roots(&self) -> Vec<PathBuf> {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
        self.files
            .roots
            .iter()
            .map(|r| {
                if r == "~" {
                    PathBuf::from(&home)
                } else if let Some(rest) = r.strip_prefix("~/") {
                    PathBuf::from(&home).join(rest)
                } else {
                    PathBuf::from(r)
                }
            })
            .collect()
    }

    pub fn tier_label(&self) -> &'static str {
        if self.cairn.signal_server.is_some() {
            "Tier 1"
        } else {
            "Tier 0"
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let cfg = JauntConfig::default();
        assert!(cfg.server.auto_session);
        assert!(cfg.server.require_approval);
        assert!(cfg.files.enabled);
        assert!(!cfg.files.write);
        assert!(cfg.cairn.signal_server.is_none());
    }

    #[test]
    fn test_parse_config() {
        let toml_str = r#"
[server]
shell = "/bin/zsh"
auto_session = false

[cairn]
signal_server = "wss://signal.example.com"

[files]
write = true
roots = ["~", "/tmp"]
"#;
        let cfg: JauntConfig = toml::from_str(toml_str).unwrap();
        assert_eq!(cfg.server.shell, "/bin/zsh");
        assert!(!cfg.server.auto_session);
        assert_eq!(
            cfg.cairn.signal_server.as_deref(),
            Some("wss://signal.example.com")
        );
        assert!(cfg.files.write);
        assert_eq!(cfg.files.roots.len(), 2);
    }

    #[test]
    fn test_tier_label() {
        let mut cfg = JauntConfig::default();
        assert_eq!(cfg.tier_label(), "Tier 0");
        cfg.cairn.signal_server = Some("wss://test".into());
        assert_eq!(cfg.tier_label(), "Tier 1");
    }
}
