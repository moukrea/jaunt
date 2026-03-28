use std::collections::HashMap;
use std::sync::Arc;

use cairn_p2p::{CairnConfig, Event, Node, Session, StorageBackend, TurnServer};
use jaunt_protocol::messages::*;
use tokio::sync::RwLock;

use crate::approval::ApprovalStore;
use crate::config::JauntConfig;
use crate::files::FileBrowser;
use crate::pairing_server;
use crate::profile;
use crate::snag::SnagBridge;

/// Tracks a peer's PTY attachment: the target snag session, a handle
/// to abort the output-forwarding task, and a writer for sending PTY input.
struct PtyAttachment {
    target: String,
    abort_handle: tokio::task::AbortHandle,
    writer: Arc<tokio::sync::Mutex<Option<crate::snag::SnagAttachmentWriter>>>,
}

/// Shared state for per-peer PTY attachments.
type Attachments = Arc<RwLock<HashMap<String, PtyAttachment>>>;

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
    let is_useful = |a: &&String| -> bool { !a.contains("/172.") || a.contains("/172.16.") };
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
    let (conn_profile, profile_url) =
        profile::generate_qr_profile(&node, &config, &ws_addrs).await?;
    let pin_result = profile::generate_pin_profile(&node, &config, &ws_addrs).await;
    let pin = pin_result
        .as_ref()
        .map(|(_, pin)| pin.clone())
        .unwrap_or_default();

    // Register as a Kademlia PROVIDER under a PIN-derived key.
    // Clients compute the same key, call get_providers(), and get our PeerId.
    // Provider records are the core IPFS DHT mechanism — they work reliably.
    if let Some(sender) = node.swarm_sender().cloned() {
        let pin_key = {
            use hmac::{Hmac, Mac};
            use sha2::Sha256;
            type HmacSha256 = Hmac<Sha256>;
            let mut mac = HmacSha256::new_from_slice(b"jaunt-pin-v1").expect("HMAC key");
            mac.update(pin.as_bytes());
            mac.finalize().into_bytes().to_vec()
        };
        tokio::spawn(async move {
            // Wait for DHT bootstrap to complete
            tokio::time::sleep(std::time::Duration::from_secs(8)).await;
            match sender.kad_start_providing(pin_key).await {
                Ok(()) => eprintln!("  DHT: PIN discoverable (provider record published)"),
                Err(e) => eprintln!("  DHT: PIN publish failed: {e}"),
            }
        });
    }

    // Start the pairing HTTP server so browsers can fetch the profile via PIN
    let _pairing_addr = match pairing_server::start_pairing_server(Arc::new(RwLock::new(
        pairing_server::PairingState {
            pin: pin.clone(),
            profile: conn_profile,
        },
    )))
    .await
    {
        Ok(addr) => Some(addr),
        Err(e) => {
            eprintln!("  Warning: pairing server failed to start: {e}");
            None
        }
    };

    // Initialize file browser for cairn RPC handler
    let file_browser = if config.files.enabled {
        Some(FileBrowser::new(&config))
    } else {
        None
    };

    // Load approval store
    let mut approval_store = ApprovalStore::load();

    // Per-peer PTY attachment tracking
    let attachments: Attachments = Arc::new(RwLock::new(HashMap::new()));

    // Display status
    let host_name = hostname::get()
        .map(|h| h.to_string_lossy().into_owned())
        .unwrap_or_else(|_| "unknown".to_string());

    // Find the primary LAN IP for the pairing display
    let lan_ip = ws_addrs
        .iter()
        .find(|a| !a.contains("/127.") && a.ends_with("/ws"))
        .and_then(|a| {
            // Extract IP from multiaddr like /ip4/192.168.1.119/tcp/35833/ws
            let parts: Vec<&str> = a.split('/').collect();
            parts.get(2).map(|ip| ip.to_string())
        });

    let peer_id_display = node
        .libp2p_peer_id()
        .map(|p| p.to_string())
        .unwrap_or_default();

    eprintln!("Jaunt host daemon started");
    eprintln!("  Host:    {host_name}");
    eprintln!("  Tier:    {}", config.tier_label());
    eprintln!();
    eprintln!("  ┌─ Connect from anywhere ──────────────────────┐");
    eprintln!("  │  PIN:    {pin:<42}│");
    eprintln!("  │  PeerId: {peer_id_display}");
    eprintln!("  │                                               │");
    eprintln!("  │  Enter the PIN in the Jaunt app to connect.   │");
    eprintln!("  │  Works over the internet — no IP needed.      │");
    eprintln!("  └───────────────────────────────────────────────┘");
    eprintln!();
    eprintln!("  URL:     {profile_url}");
    if let Some(ref ip) = lan_ip {
        eprintln!("  LAN:     {ip} (same network only)");
    }
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

                // Route by tag byte (application-layer multiplexing).
                // cairn strips channel names, so we can't rely on them.
                // First byte: TAG_RPC (0x01) or TAG_PTY (0x02).
                // Fall back to channel name for legacy/untagged messages.
                if data.is_empty() {
                    continue;
                }

                let tag = data[0];
                let payload = &data[1..];

                match tag {
                    TAG_RPC => {
                        eprintln!("RPC from {peer_id} ({} bytes, tagged)", payload.len());

                        let request = match jaunt_protocol::decode_request(payload) {
                            Ok(r) => r,
                            Err(e) => {
                                let response = RpcResponse::Error {
                                    code: 1,
                                    message: format!("decode error: {e}"),
                                };
                                send_rpc_response(&node, peer_id, &response).await;
                                continue;
                            }
                        };

                        match request {
                            RpcRequest::SessionAttach { ref target } => {
                                eprintln!("  SessionAttach target={target}");
                                handle_session_attach(&node, peer_id, target, &snag, &attachments)
                                    .await;
                            }
                            RpcRequest::SessionDetach {} => {
                                eprintln!("  SessionDetach");
                                handle_session_detach(peer_id, &attachments).await;
                                let response = RpcResponse::Ok(RpcData::Empty {});
                                send_rpc_response(&node, peer_id, &response).await;
                            }
                            RpcRequest::Resize { cols, rows } => {
                                let att = attachments.read().await;
                                if let Some(attachment) = att.get(peer_id) {
                                    let mut guard = attachment.writer.lock().await;
                                    if let Some(ref mut w) = *guard {
                                        let _ = w.send_resize(cols, rows).await;
                                    }
                                }
                                let response = RpcResponse::Ok(RpcData::Empty {});
                                send_rpc_response(&node, peer_id, &response).await;
                            }
                            _ => {
                                let response = handle_rpc_request(&request, &snag, &file_browser);
                                if let RpcResponse::Error { message, .. } = &response {
                                    eprintln!("  RPC error: {message}");
                                }
                                send_rpc_response(&node, peer_id, &response).await;
                            }
                        }
                    }
                    TAG_PTY => {
                        // PTY input from browser: forward to attached snag session
                        let att = attachments.read().await;
                        if let Some(attachment) = att.get(peer_id) {
                            let mut guard = attachment.writer.lock().await;
                            if let Some(ref mut w) = *guard {
                                if let Err(e) = w.send_pty_input(payload).await {
                                    eprintln!("PTY send to {} failed: {e}", attachment.target);
                                }
                            }
                        }
                    }
                    _ => {
                        // Legacy fallback: try routing by channel name
                        match channel.as_str() {
                            "rpc" => {
                                eprintln!(
                                    "RPC from {peer_id} ({} bytes, legacy channel)",
                                    data.len()
                                );
                                let request = match jaunt_protocol::decode_request(data) {
                                    Ok(r) => r,
                                    Err(e) => {
                                        let response = RpcResponse::Error {
                                            code: 1,
                                            message: format!("decode error: {e}"),
                                        };
                                        send_rpc_response(&node, peer_id, &response).await;
                                        continue;
                                    }
                                };
                                let response = handle_rpc_request(&request, &snag, &file_browser);
                                send_rpc_response(&node, peer_id, &response).await;
                            }
                            "pty" => {
                                let att = attachments.read().await;
                                if let Some(attachment) = att.get(peer_id) {
                                    let mut guard = attachment.writer.lock().await;
                                    if let Some(ref mut w) = *guard {
                                        if let Err(e) = w.send_pty_input(data).await {
                                            eprintln!(
                                                "PTY send to {} failed: {e}",
                                                attachment.target
                                            );
                                        }
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
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

// Application-layer message tags.
// cairn's dispatch_incoming strips channel names, so ALL messages arrive with
// channel "". We prefix every message with a 1-byte tag so both sides can
// distinguish RPC traffic from PTY traffic.
const TAG_RPC: u8 = 0x01;
const TAG_PTY: u8 = 0x02;

/// Send an RPC response back to the peer, prefixed with TAG_RPC.
async fn send_rpc_response(node: &Node, peer_id: &str, response: &RpcResponse) {
    match jaunt_protocol::encode_response(response) {
        Ok(resp_data) => {
            let mut tagged = Vec::with_capacity(1 + resp_data.len());
            tagged.push(TAG_RPC);
            tagged.extend_from_slice(&resp_data);
            let sessions = node.sessions().await;
            if let Some(session) = sessions.get(peer_id) {
                match session.open_channel("rpc").await {
                    Ok(ch) => match session.send(&ch, &tagged).await {
                        Ok(_) => {
                            eprintln!("  Sent {} bytes response (tagged RPC)", resp_data.len())
                        }
                        Err(e) => eprintln!("  Send failed: {e}"),
                    },
                    Err(e) => eprintln!("  Open channel failed: {e}"),
                }
            } else {
                eprintln!("  No session for peer {peer_id}");
            }
        }
        Err(e) => eprintln!("  Encode response failed: {e}"),
    }
}

/// Handle SessionAttach: respond with Ok, then spawn a background task that
/// runs `snag output <target> --follow` and streams PTY output to the browser
/// via the cairn session's "pty" channel.
async fn handle_session_attach(
    node: &Node,
    peer_id: &str,
    target: &str,
    snag: &SnagBridge,
    attachments: &Attachments,
) {
    // Kill any existing attachment for this peer first
    handle_session_detach(peer_id, attachments).await;

    // Verify the target session exists
    match snag.session_info(target) {
        Ok(_info) => {}
        Err(e) => {
            let response = RpcResponse::Error {
                code: 8,
                message: format!("session not found: {e}"),
            };
            send_rpc_response(node, peer_id, &response).await;
            return;
        }
    }

    // Send the Ok response immediately so the browser knows attach succeeded
    let response = RpcResponse::Ok(RpcData::Empty {});
    send_rpc_response(node, peer_id, &response).await;

    // Get the cairn session handle for this peer
    let sessions = node.sessions().await;
    let session = match sessions.get(peer_id) {
        Some(s) => s.clone(),
        None => {
            eprintln!("  No cairn session for peer {peer_id}, cannot start PTY forwarding");
            return;
        }
    };

    // Attach to the snag session via the daemon's Unix socket
    let (scrollback, snag_attachment) = match crate::snag::SnagAttachment::attach(target).await {
        Ok(r) => r,
        Err(e) => {
            eprintln!("  SnagAttachment::attach failed: {e}");
            let response = RpcResponse::Error {
                code: 8,
                message: format!("attach failed: {e}"),
            };
            send_rpc_response(node, peer_id, &response).await;
            return;
        }
    };

    // Split into reader (for output forwarding task) and writer (for input from event loop)
    let (reader, writer) = snag_attachment.split();
    let writer = Arc::new(tokio::sync::Mutex::new(Some(writer)));

    // Send scrollback so the terminal isn't blank (tagged as PTY output)
    if !scrollback.is_empty() {
        if let Ok(ch) = session.open_channel("pty").await {
            let sb_bytes = scrollback.as_bytes();
            let mut tagged = Vec::with_capacity(1 + sb_bytes.len());
            tagged.push(TAG_PTY);
            tagged.extend_from_slice(sb_bytes);
            let _ = session.send(&ch, &tagged).await;
            eprintln!("  Sent {} bytes scrollback (tagged PTY)", sb_bytes.len());
        }
    }

    // Spawn the PTY output forwarding task
    let peer_id_owned = peer_id.to_string();
    let task = tokio::spawn(async move {
        pty_output_forwarder(session, reader, &peer_id_owned).await;
    });

    let abort_handle = task.abort_handle();
    attachments.write().await.insert(
        peer_id.to_string(),
        PtyAttachment {
            target: target.to_string(),
            abort_handle,
            writer,
        },
    );

    eprintln!("  PTY forwarding started for peer {peer_id} -> session {target}");
}

/// Long-running task: reads PTY output from the SnagAttachmentReader and forwards
/// each chunk to the browser via the cairn session's "pty" channel.
async fn pty_output_forwarder(
    session: Session,
    mut reader: crate::snag::SnagAttachmentReader,
    peer_id: &str,
) {
    let pty_channel = match session.open_channel("pty").await {
        Ok(ch) => ch,
        Err(e) => {
            eprintln!("  PTY forwarder: failed to open pty channel: {e}");
            return;
        }
    };

    loop {
        match reader.read_pty_output().await {
            Ok(Some(data)) => {
                let mut tagged = Vec::with_capacity(1 + data.len());
                tagged.push(TAG_PTY);
                tagged.extend_from_slice(&data);
                if let Err(e) = session.send(&pty_channel, &tagged).await {
                    eprintln!("  PTY forwarder: send failed for peer {peer_id}: {e}");
                    break;
                }
            }
            Ok(None) => {
                eprintln!("  PTY forwarder: session exited for peer {peer_id}");
                break;
            }
            Err(e) => {
                eprintln!("  PTY forwarder: read error for peer {peer_id}: {e}");
                break;
            }
        }
    }
}

/// Handle SessionDetach: abort the PTY forwarding task.
async fn handle_session_detach(peer_id: &str, attachments: &Attachments) {
    if let Some(attachment) = attachments.write().await.remove(peer_id) {
        attachment.abort_handle.abort();
        eprintln!(
            "  Detached peer {peer_id} from session {}",
            attachment.target
        );
    }
}

/// Interactive pairing: displays PIN + URL, waits for a peer, approves it.
pub async fn run_pair(config: JauntConfig) -> Result<(), String> {
    let cairn_config = build_cairn_config(&config);
    let node = cairn_p2p::create_and_start_with_config(cairn_config)
        .await
        .map_err(|e| format!("failed to create cairn node: {e}"))?;

    let all_addrs = node.listen_addresses().await;
    let is_useful = |a: &&String| -> bool { !a.contains("/172.") || a.contains("/172.16.") };
    let ws_addrs: Vec<String> = all_addrs
        .iter()
        .filter(is_useful)
        .filter(|a| a.ends_with("/ws"))
        .map(|a| a.to_string())
        .collect();

    let (_conn_profile, profile_url) =
        profile::generate_qr_profile(&node, &config, &ws_addrs).await?;
    let pin_result = profile::generate_pin_profile(&node, &config, &ws_addrs).await;
    let pin = pin_result
        .as_ref()
        .map(|(_, pin)| pin.clone())
        .unwrap_or_default();

    let peer_id_str = node
        .libp2p_peer_id()
        .map(|p| p.to_string())
        .unwrap_or_default();

    eprintln!();
    eprintln!("  ┌─────────────────────────────────────┐");
    eprintln!("  │          JAUNT PAIRING MODE          │");
    eprintln!("  └─────────────────────────────────────┘");
    eprintln!();
    eprintln!("  PIN:     {pin}");
    eprintln!(
        "  PeerId:  {}...",
        &peer_id_str[..24.min(peer_id_str.len())]
    );
    eprintln!("  URL:     {profile_url}");
    eprintln!();
    eprintln!("  Waiting for a device to connect...");
    eprintln!();

    let mut approval_store = ApprovalStore::load();

    loop {
        match node.recv_event().await {
            Some(Event::MessageReceived { ref peer_id, .. }) => {
                if !approval_store.is_approved(peer_id) {
                    approval_store.approve(peer_id, "paired");
                    approval_store.save();
                }
                eprintln!(
                    "  ✓ Device paired: {}...",
                    &peer_id[..24.min(peer_id.len())]
                );
                eprintln!("  Run `jaunt-host serve` to start accepting connections.");
                break;
            }
            Some(Event::StateChanged {
                ref peer_id,
                ref state,
            }) => {
                eprintln!("  Peer {}...: {state}", &peer_id[..16.min(peer_id.len())]);
            }
            None => break,
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

/// Handle an RPC request and produce a synchronous response.
/// SessionAttach/SessionDetach/Resize are handled separately in the event loop.
fn handle_rpc_request(
    request: &RpcRequest,
    snag: &SnagBridge,
    file_browser: &Option<FileBrowser>,
) -> RpcResponse {
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
        RpcRequest::SessionKill { target } => match snag.kill_session(target) {
            Ok(()) => RpcResponse::Ok(RpcData::Empty {}),
            Err(e) => RpcResponse::Error {
                code: 4,
                message: e,
            },
        },
        RpcRequest::SessionSend { target, input } => match snag.send_input(target, input) {
            Ok(()) => RpcResponse::Ok(RpcData::Empty {}),
            Err(e) => RpcResponse::Error {
                code: 5,
                message: e,
            },
        },
        RpcRequest::SessionInfo { target } => match snag.session_info(target) {
            Ok(info) => RpcResponse::Ok(RpcData::SessionInfo(info)),
            Err(e) => RpcResponse::Error {
                code: 6,
                message: e,
            },
        },
        RpcRequest::SessionRename { target, new_name } => {
            match snag.rename_session(target, new_name) {
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
            Some(fb) => match fb.browse(path) {
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
            Some(fb) => match fb.preview(path, *max_bytes) {
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
            Some(fb) => match fb.delete(path) {
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
        // These are handled in the event loop, not here
        RpcRequest::SessionAttach { .. }
        | RpcRequest::SessionDetach {}
        | RpcRequest::Resize { .. } => RpcResponse::Ok(RpcData::Empty {}),
        RpcRequest::FileDownload { .. } | RpcRequest::FileUpload { .. } => {
            RpcResponse::Ok(RpcData::Empty {})
        }
    }
}
