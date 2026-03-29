use crate::config::JauntConfig;
use jaunt_protocol::messages::*;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

pub struct FileBrowser {
    roots: Vec<PathBuf>,
    write_enabled: bool,
    default_show_hidden: bool,
}

impl FileBrowser {
    pub fn new(config: &JauntConfig) -> Self {
        Self {
            roots: config.resolve_roots(),
            write_enabled: config.files.write,
            default_show_hidden: config.files.show_hidden,
        }
    }

    pub fn validate_path(&self, path: &Path) -> Result<PathBuf, String> {
        let canonical = std::fs::canonicalize(path).map_err(|e| format!("invalid path: {e}"))?;
        for root in &self.roots {
            if let Ok(root_canonical) = std::fs::canonicalize(root) {
                if canonical.starts_with(&root_canonical) {
                    return Ok(canonical);
                }
            }
        }
        Err("path outside allowed roots".to_string())
    }

    pub fn browse(&self, path: &str, show_hidden: Option<bool>) -> Result<RpcData, String> {
        let show_hidden = show_hidden.unwrap_or(self.default_show_hidden);
        let path = PathBuf::from(path);
        let canonical = self.validate_path(&path)?;

        let entries = std::fs::read_dir(&canonical).map_err(|e| format!("read_dir failed: {e}"))?;

        let mut result: Vec<DirEntry> = Vec::new();
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let metadata = entry.metadata();
            let (size, modified, permissions, file_type) = match metadata {
                Ok(m) => {
                    let size = m.len();
                    let modified = m
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    let permissions = m.permissions().mode() as u16;
                    let ft = if m.is_dir() {
                        EntryType::Directory
                    } else if m.file_type().is_symlink() {
                        let target = std::fs::read_link(entry.path())
                            .map(|p| p.to_string_lossy().into_owned())
                            .unwrap_or_default();
                        EntryType::Symlink { target }
                    } else {
                        EntryType::File
                    };
                    (size, modified, permissions, ft)
                }
                Err(e) => {
                    eprintln!("warning: metadata read failed for {}: {e}", name);
                    (0, 0, 0, EntryType::File)
                }
            };

            result.push(DirEntry {
                hidden: name.starts_with('.'),
                name,
                entry_type: file_type,
                size,
                modified,
                permissions,
            });
        }

        if !show_hidden {
            result.retain(|e| !e.hidden);
        }
        result.sort_by(|a, b| a.name.cmp(&b.name));

        Ok(RpcData::DirListing {
            path: canonical.to_string_lossy().into_owned(),
            entries: result,
        })
    }

    pub fn preview(&self, path: &str, max_bytes: u64) -> Result<RpcData, String> {
        let path = PathBuf::from(path);
        let canonical = self.validate_path(&path)?;

        let content = std::fs::read(&canonical).map_err(|e| format!("read failed: {e}"))?;

        let truncated = content.len() as u64 > max_bytes;
        let content = if truncated {
            String::from_utf8_lossy(&content[..max_bytes as usize]).into_owned()
        } else {
            String::from_utf8_lossy(&content).into_owned()
        };

        Ok(RpcData::FilePreview {
            path: canonical.to_string_lossy().into_owned(),
            content,
            truncated,
        })
    }

    pub fn delete(&self, path: &str) -> Result<(), String> {
        if !self.write_enabled {
            return Err("write access disabled".into());
        }
        let path = PathBuf::from(path);
        let canonical = self.validate_path(&path)?;
        if canonical.is_dir() {
            std::fs::remove_dir_all(&canonical)
        } else {
            std::fs::remove_file(&canonical)
        }
        .map_err(|e| format!("delete failed: {e}"))
    }
}
