use serde::{Deserialize, Serialize};

/// Client → Host RPC requests, sent on cairn's "rpc" channel as MessagePack.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RpcRequest {
    SessionList {},
    SessionCreate {
        shell: Option<String>,
        name: Option<String>,
        cwd: Option<String>,
    },
    SessionAttach {
        target: String,
    },
    SessionDetach {},
    SessionKill {
        target: String,
    },
    SessionSend {
        target: String,
        input: String,
    },
    SessionInfo {
        target: String,
    },
    SessionRename {
        target: String,
        new_name: String,
    },
    Resize {
        cols: u16,
        rows: u16,
    },
    FileBrowse {
        path: String,
        show_hidden: bool,
    },
    FilePreview {
        path: String,
        max_bytes: u64,
    },
    FileDownload {
        path: String,
    },
    FileUpload {
        path: String,
        size: u64,
    },
    FileDelete {
        path: String,
    },
}

/// Host → Client RPC responses, sent on cairn's "rpc" channel as MessagePack.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RpcResponse {
    Ok(RpcData),
    Error { code: u16, message: String },
    SessionEvent { event: String, session_id: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RpcData {
    SessionCreated {
        id: String,
    },
    SessionList(Vec<SessionInfo>),
    SessionInfo(SessionInfo),
    Output(String),
    DirListing {
        path: String,
        entries: Vec<DirEntry>,
    },
    FilePreview {
        path: String,
        content: String,
        truncated: bool,
    },
    FileReady {
        size: u64,
    },
    Empty {},
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: String,
    pub name: Option<String>,
    pub shell: String,
    pub cwd: String,
    pub state: String,
    pub fg_process: Option<String>,
    pub attached: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirEntry {
    pub name: String,
    pub entry_type: EntryType,
    pub size: u64,
    pub modified: u64,
    pub permissions: u16,
    pub hidden: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EntryType {
    File,
    Directory,
    Symlink { target: String },
}

pub fn encode_request(req: &RpcRequest) -> Result<Vec<u8>, String> {
    rmp_serde::to_vec_named(req).map_err(|e| format!("encode error: {e}"))
}

pub fn decode_request(data: &[u8]) -> Result<RpcRequest, String> {
    rmp_serde::from_slice(data).map_err(|e| format!("decode error: {e}"))
}

pub fn encode_response(resp: &RpcResponse) -> Result<Vec<u8>, String> {
    rmp_serde::to_vec_named(resp).map_err(|e| format!("encode error: {e}"))
}

pub fn decode_response(data: &[u8]) -> Result<RpcResponse, String> {
    rmp_serde::from_slice(data).map_err(|e| format!("decode error: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_roundtrip_session_list() {
        let req = RpcRequest::SessionList {};
        let data = encode_request(&req).unwrap();
        let decoded = decode_request(&data).unwrap();
        assert!(matches!(decoded, RpcRequest::SessionList {}));
    }

    #[test]
    fn request_roundtrip_session_create() {
        let req = RpcRequest::SessionCreate {
            shell: Some("/bin/zsh".into()),
            name: Some("dev".into()),
            cwd: Some("/home/user".into()),
        };
        let data = encode_request(&req).unwrap();
        let decoded = decode_request(&data).unwrap();
        match decoded {
            RpcRequest::SessionCreate { shell, name, cwd } => {
                assert_eq!(shell.as_deref(), Some("/bin/zsh"));
                assert_eq!(name.as_deref(), Some("dev"));
                assert_eq!(cwd.as_deref(), Some("/home/user"));
            }
            _ => panic!("wrong type"),
        }
    }

    #[test]
    fn request_roundtrip_session_send() {
        let req = RpcRequest::SessionSend {
            target: "dev".into(),
            input: "cargo test".into(),
        };
        let data = encode_request(&req).unwrap();
        let decoded = decode_request(&data).unwrap();
        match decoded {
            RpcRequest::SessionSend { target, input } => {
                assert_eq!(target, "dev");
                assert_eq!(input, "cargo test");
            }
            _ => panic!("wrong type"),
        }
    }

    #[test]
    fn request_roundtrip_resize() {
        let req = RpcRequest::Resize {
            cols: 120,
            rows: 40,
        };
        let data = encode_request(&req).unwrap();
        let decoded = decode_request(&data).unwrap();
        match decoded {
            RpcRequest::Resize { cols, rows } => {
                assert_eq!(cols, 120);
                assert_eq!(rows, 40);
            }
            _ => panic!("wrong type"),
        }
    }

    #[test]
    fn request_roundtrip_file_browse() {
        let req = RpcRequest::FileBrowse {
            path: "/home".into(),
            show_hidden: true,
        };
        let data = encode_request(&req).unwrap();
        let decoded = decode_request(&data).unwrap();
        match decoded {
            RpcRequest::FileBrowse { path, show_hidden } => {
                assert_eq!(path, "/home");
                assert!(show_hidden);
            }
            _ => panic!("wrong type"),
        }
    }

    #[test]
    fn request_roundtrip_session_rename() {
        let req = RpcRequest::SessionRename {
            target: "old".into(),
            new_name: "new".into(),
        };
        let data = encode_request(&req).unwrap();
        let decoded = decode_request(&data).unwrap();
        match decoded {
            RpcRequest::SessionRename { target, new_name } => {
                assert_eq!(target, "old");
                assert_eq!(new_name, "new");
            }
            _ => panic!("wrong type"),
        }
    }

    #[test]
    fn response_roundtrip_session_list() {
        let resp = RpcResponse::Ok(RpcData::SessionList(vec![SessionInfo {
            id: "abc123".into(),
            name: Some("dev".into()),
            shell: "/bin/zsh".into(),
            cwd: "/home/user".into(),
            state: "running".into(),
            fg_process: Some("cargo".into()),
            attached: 1,
        }]));
        let data = encode_response(&resp).unwrap();
        let decoded = decode_response(&data).unwrap();
        match decoded {
            RpcResponse::Ok(RpcData::SessionList(sessions)) => {
                assert_eq!(sessions.len(), 1);
                assert_eq!(sessions[0].id, "abc123");
                assert_eq!(sessions[0].name.as_deref(), Some("dev"));
            }
            _ => panic!("wrong type"),
        }
    }

    #[test]
    fn response_roundtrip_error() {
        let resp = RpcResponse::Error {
            code: 42,
            message: "not found".into(),
        };
        let data = encode_response(&resp).unwrap();
        let decoded = decode_response(&data).unwrap();
        match decoded {
            RpcResponse::Error { code, message } => {
                assert_eq!(code, 42);
                assert_eq!(message, "not found");
            }
            _ => panic!("wrong type"),
        }
    }

    #[test]
    fn response_roundtrip_dir_listing() {
        let resp = RpcResponse::Ok(RpcData::DirListing {
            path: "/home".into(),
            entries: vec![DirEntry {
                name: "user".into(),
                entry_type: EntryType::Directory,
                size: 4096,
                modified: 1700000000,
                permissions: 0o755,
                hidden: false,
            }],
        });
        let data = encode_response(&resp).unwrap();
        let decoded = decode_response(&data).unwrap();
        match decoded {
            RpcResponse::Ok(RpcData::DirListing { path, entries }) => {
                assert_eq!(path, "/home");
                assert_eq!(entries.len(), 1);
                assert!(matches!(entries[0].entry_type, EntryType::Directory));
            }
            _ => panic!("wrong type"),
        }
    }

    #[test]
    fn response_roundtrip_session_event() {
        let resp = RpcResponse::SessionEvent {
            event: "exited".into(),
            session_id: "abc".into(),
        };
        let data = encode_response(&resp).unwrap();
        let decoded = decode_response(&data).unwrap();
        match decoded {
            RpcResponse::SessionEvent { event, session_id } => {
                assert_eq!(event, "exited");
                assert_eq!(session_id, "abc");
            }
            _ => panic!("wrong type"),
        }
    }

    #[test]
    fn response_roundtrip_file_preview() {
        let resp = RpcResponse::Ok(RpcData::FilePreview {
            path: "/home/user/file.txt".into(),
            content: "hello world".into(),
            truncated: false,
        });
        let data = encode_response(&resp).unwrap();
        let decoded = decode_response(&data).unwrap();
        match decoded {
            RpcResponse::Ok(RpcData::FilePreview {
                path,
                content,
                truncated,
            }) => {
                assert_eq!(path, "/home/user/file.txt");
                assert_eq!(content, "hello world");
                assert!(!truncated);
            }
            _ => panic!("wrong type"),
        }
    }

    #[test]
    fn response_roundtrip_empty() {
        let resp = RpcResponse::Ok(RpcData::Empty {});
        let data = encode_response(&resp).unwrap();
        let decoded = decode_response(&data).unwrap();
        assert!(matches!(decoded, RpcResponse::Ok(RpcData::Empty {})));
    }
}
