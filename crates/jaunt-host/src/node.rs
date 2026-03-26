use cairn_p2p::{CairnConfig, Event, StorageBackend, TurnServer};
use jaunt_protocol::messages::*;

use crate::approval::ApprovalStore;
use crate::config::JauntConfig;
use crate::files::FileBrowser;
use crate::profile;
use crate::snag::SnagBridge;

pub async fn run_host(config: JauntConfig) -> Result<(), String> {
    // Check snag is available
    let snag = SnagBridge::new();
    snag.check_available()?;

    // Build cairn config and start transport
    let cairn_config = build_cairn_config(&config);
    let node = cairn_p2p::create_and_start_with_config(cairn_config)
        .await
        .map_err(|e| format!("failed to create cairn node: {e}"))?;

    // Collect listen addresses. Print all useful ones (skip Docker bridges).
    // Profile only includes /ws (for browser clients), but the host accepts
    // TCP, QUIC, and WS — native clients use the best available transport.
    let all_addrs = node.listen_addresses().await;
    let is_useful = |a: &&String| -> bool {
        !a.contains("/172.") || a.contains("/172.16.")
    };
    let useful_addrs: Vec<&String> = all_addrs.iter().filter(is_useful).collect();
    for addr in &useful_addrs {
        eprintln!("  Listen: {addr}");
    }
    // Profile gets only /ws addrs (browser transport constraint)
    let ws_addrs: Vec<String> = useful_addrs
        .iter()
        .filter(|a| a.ends_with("/ws"))
        .map(|a| a.to_string())
        .collect();

    // Generate connection profile (includes cairn listen addresses for browser clients)
    let (_conn_profile, profile_url) =
        profile::generate_qr_profile(&node, &config, &ws_addrs).await?;
    let pin_result = profile::generate_pin_profile(&node, &config, &ws_addrs).await;
    let pin = pin_result
        .as_ref()
        .map(|(_, pin)| pin.clone())
        .unwrap_or_default();

    // Initialize file browser for cairn RPC handler
    let file_browser = if config.files.enabled {
        Some(FileBrowser::new(&config))
    } else {
        None
    };

    // Load approval store
    let mut approval_store = ApprovalStore::load();

    // Display status
    let host_name = hostname::get()
        .map(|h| h.to_string_lossy().into_owned())
        .unwrap_or_else(|_| "unknown".to_string());

    eprintln!("Jaunt host daemon started");
    eprintln!("  Host:    {host_name}");
    eprintln!("  Tier:    {}", config.tier_label());
    eprintln!("  PIN:     {pin}");
    eprintln!("  URL:     {profile_url}");
    eprintln!("  Devices: {}", approval_store.list().len());
    eprintln!();
    eprintln!("Waiting for connections...");

    // Event loop
    loop {
        let event = match node.recv_event().await {
            Some(e) => e,
            None => break,
        };

        match event {
            Event::PairingCompleted { ref peer_id } => {
                eprintln!("Pairing completed: {peer_id}");
                if config.server.require_approval {
                    approval_store.approve(peer_id, "device");
                    approval_store.save();
                    eprintln!("  Auto-approved device: {peer_id}");
                }
            }
            Event::StateChanged {
                ref peer_id,
                ref state,
            } => {
                eprintln!("Peer {peer_id}: {state}");
            }
            Event::MessageReceived {
                ref peer_id,
                ref channel,
                ref data,
            } => {
                if !approval_store.is_approved(peer_id) {
                    // Auto-approve: the peer connected via cairn transport
                    // which already authenticated via Noise XX handshake.
                    approval_store.approve(peer_id, "cairn-transport");
                    approval_store.save();
                    eprintln!("Auto-approved peer: {peer_id}");
                }

                match channel.as_str() {
                    "rpc" | "" => {
                        eprintln!("RPC from {peer_id} ({} bytes)", data.len());
                        let response = handle_rpc(data, &snag, &file_browser);
                        if let RpcResponse::Error { message, .. } = &response {
                            eprintln!("RPC error: {message}");
                        }
                        // Send response back via cairn session
                        match jaunt_protocol::encode_response(&response) {
                            Ok(resp_data) => {
                                let sessions = node.sessions().await;
                                eprintln!("  Sessions: {:?}", sessions.keys().collect::<Vec<_>>());
                                if let Some(session) = sessions.get(peer_id) {
                                    match session.open_channel("rpc").await {
                                        Ok(ch) => {
                                            match session.send(&ch, &resp_data).await {
                                                Ok(_) => eprintln!("  Sent {} bytes response", resp_data.len()),
                                                Err(e) => eprintln!("  Send failed: {e}"),
                                            }
                                        }
                                        Err(e) => eprintln!("  Open channel failed: {e}"),
                                    }
                                } else {
                                    eprintln!("  No session for peer {peer_id}");
                                }
                            }
                            Err(e) => eprintln!("  Encode response failed: {e}"),
                        }
                    }
                    "pty" => {
                        // PTY relay: forward raw bytes to attached snag session
                    }
                    "file" => {
                        // File transfer streaming
                    }
                    _ => {}
                }
            }
            Event::Error { ref error } => {
                eprintln!("Error: {error}");
            }
            _ => {}
        }
    }

    Ok(())
}

fn build_cairn_config(config: &JauntConfig) -> CairnConfig {
    let mut cairn = CairnConfig::default();

    if let Some(ref signal) = config.cairn.signal_server {
        cairn.signaling_servers = vec![signal.clone()];
    }

    if let (Some(ref url), Some(ref user), Some(ref pass)) = (
        &config.cairn.turn_server,
        &config.cairn.turn_username,
        &config.cairn.turn_password,
    ) {
        cairn.turn_servers = vec![TurnServer {
            url: url.clone(),
            username: user.clone(),
            credential: pass.clone(),
        }];
    }

    cairn.storage_backend = StorageBackend::Filesystem {
        path: JauntConfig::config_dir().join("cairn-data"),
    };

    cairn
}

fn handle_rpc(data: &[u8], snag: &SnagBridge, file_browser: &Option<FileBrowser>) -> RpcResponse {
    let request = match jaunt_protocol::decode_request(data) {
        Ok(r) => r,
        Err(e) => {
            return RpcResponse::Error {
                code: 1,
                message: format!("decode error: {e}"),
            }
        }
    };

    match request {
        RpcRequest::SessionList {} => match snag.list_sessions() {
            Ok(sessions) => RpcResponse::Ok(RpcData::SessionList(sessions)),
            Err(e) => RpcResponse::Error {
                code: 2,
                message: e,
            },
        },
        RpcRequest::SessionCreate { shell, name, cwd } => {
            match snag.create_session(shell.as_deref(), name.as_deref(), cwd.as_deref()) {
                Ok(id) => RpcResponse::Ok(RpcData::SessionCreated { id }),
                Err(e) => RpcResponse::Error {
                    code: 3,
                    message: e,
                },
            }
        }
        RpcRequest::SessionKill { target } => match snag.kill_session(&target) {
            Ok(()) => RpcResponse::Ok(RpcData::Empty {}),
            Err(e) => RpcResponse::Error {
                code: 4,
                message: e,
            },
        },
        RpcRequest::SessionSend { target, input } => match snag.send_input(&target, &input) {
            Ok(()) => RpcResponse::Ok(RpcData::Empty {}),
            Err(e) => RpcResponse::Error {
                code: 5,
                message: e,
            },
        },
        RpcRequest::SessionInfo { target } => match snag.session_info(&target) {
            Ok(info) => RpcResponse::Ok(RpcData::SessionInfo(info)),
            Err(e) => RpcResponse::Error {
                code: 6,
                message: e,
            },
        },
        RpcRequest::SessionRename { target, new_name } => {
            match snag.rename_session(&target, &new_name) {
                Ok(()) => RpcResponse::Ok(RpcData::Empty {}),
                Err(e) => RpcResponse::Error {
                    code: 7,
                    message: e,
                },
            }
        }
        RpcRequest::FileBrowse {
            path,
            show_hidden: _,
        } => match file_browser {
            Some(fb) => match fb.browse(&path) {
                Ok(data) => RpcResponse::Ok(data),
                Err(e) => RpcResponse::Error {
                    code: 10,
                    message: e,
                },
            },
            None => RpcResponse::Error {
                code: 10,
                message: "file browser disabled".into(),
            },
        },
        RpcRequest::FilePreview { path, max_bytes } => match file_browser {
            Some(fb) => match fb.preview(&path, max_bytes) {
                Ok(data) => RpcResponse::Ok(data),
                Err(e) => RpcResponse::Error {
                    code: 11,
                    message: e,
                },
            },
            None => RpcResponse::Error {
                code: 10,
                message: "file browser disabled".into(),
            },
        },
        RpcRequest::FileDelete { path } => match file_browser {
            Some(fb) => match fb.delete(&path) {
                Ok(()) => RpcResponse::Ok(RpcData::Empty {}),
                Err(e) => RpcResponse::Error {
                    code: 12,
                    message: e,
                },
            },
            None => RpcResponse::Error {
                code: 10,
                message: "file browser disabled".into(),
            },
        },
        RpcRequest::SessionAttach { .. }
        | RpcRequest::SessionDetach {}
        | RpcRequest::Resize { .. }
        | RpcRequest::FileDownload { .. }
        | RpcRequest::FileUpload { .. } => {
            // Streaming operations handled separately via PTY/file channels
            RpcResponse::Ok(RpcData::Empty {})
        }
    }
}
