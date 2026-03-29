use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use cairn_p2p::{CairnConfig, Event, Node, Session, StorageBackend, TurnServer};
use jaunt_protocol::messages::*;
use tokio::sync::RwLock;
use tracing::{debug, error, info, trace, warn};

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

/// Run the host daemon — accepts connections from already-paired devices.
/// Does NOT generate PINs or start the pairing server.
/// Use `jaunt-host pair` to add new devices.
pub async fn run_host(config: JauntConfig) -> Result<(), String> {
    let snag = SnagBridge::new();
    snag.check_available()?;

    let cairn_config = build_cairn_config(&config);
    info!("Starting P2P transport...");
    let node = cairn_p2p::create_and_start_with_config(cairn_config)
        .await
        .map_err(|e| format!("failed to create cairn node: {e}"))?;

    let all_addrs = node.listen_addresses().await;
    for addr in &all_addrs {
        debug!("Listen: {addr}");
    }

    let ws_addrs: Vec<String> = all_addrs
        .iter()
        .filter(|a| a.ends_with("/ws"))
        .map(|a| a.to_string())
        .collect();

    let file_browser = if config.files.enabled {
        Some(FileBrowser::new(&config))
    } else {
        None
    };

    let mut approval_store = ApprovalStore::load();
    let attachments: Attachments = Arc::new(RwLock::new(HashMap::new()));

    // Known jaunt clients — peers that sent RPC messages or completed pairing.
    // Only these get INFO-level connection/disconnection logs.
    let mut known_clients: HashSet<String> = HashSet::new();
    // Seed from approval store
    for device in approval_store.list() {
        known_clients.insert(device.peer_id.clone());
    }

    let host_name = hostname::get()
        .map(|h| h.to_string_lossy().into_owned())
        .unwrap_or_else(|_| "unknown".to_string());

    let lan_ip = ws_addrs
        .iter()
        .find(|a| !a.contains("/127.") && a.ends_with("/ws"))
        .and_then(|a| {
            let parts: Vec<&str> = a.split('/').collect();
            parts.get(2).map(|ip| ip.to_string())
        });

    let peer_id_display = node
        .libp2p_peer_id()
        .map(|p| p.to_string())
        .unwrap_or_default();

    info!("Jaunt host daemon started");
    info!("  Host: {host_name}");
    info!("  PeerId: {peer_id_display}");
    info!("  Tier: {}", config.tier_label());
    if let Some(ref ip) = lan_ip {
        info!("  LAN: {ip}");
    }
    info!("  Devices: {}", approval_store.list().len());
    info!("Accepting connections from paired devices. Use `jaunt-host pair` to add new devices.");

    // Signal handling for graceful shutdown
    let mut sigterm = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        .map_err(|e| format!("failed to register SIGTERM handler: {e}"))?;

    // Event loop with signal handling
    loop {
        tokio::select! {
            event = node.recv_event() => {
                let event = match event {
                    Some(e) => e,
                    None => break,
                };
                handle_event(
                    &event, &node, &config, &snag, &file_browser,
                    &mut approval_store, &attachments, &mut known_clients,
                ).await;
            }
            _ = tokio::signal::ctrl_c() => {
                info!("Received SIGINT, shutting down...");
                break;
            }
            _ = sigterm.recv() => {
                info!("Received SIGTERM, shutting down...");
                break;
            }
        }
    }

    info!("Jaunt host daemon stopped");
    Ok(())
}

/// Handle a single event from the cairn node.
#[allow(clippy::too_many_arguments)]
async fn handle_event(
    event: &Event,
    node: &Node,
    config: &JauntConfig,
    snag: &SnagBridge,
    file_browser: &Option<FileBrowser>,
    approval_store: &mut ApprovalStore,
    attachments: &Attachments,
    known_clients: &mut HashSet<String>,
) {
    match event {
        Event::PairingCompleted { ref peer_id } => {
            info!("Pairing completed: {peer_id}");
            known_clients.insert(peer_id.clone());
            if config.server.require_approval {
                approval_store.approve(peer_id, "device");
                approval_store.save();
                info!("Auto-approved device: {peer_id}");
            }
        }
        Event::StateChanged {
            ref peer_id,
            ref state,
        } => {
            if known_clients.contains(peer_id) {
                info!("Client {peer_id}: {state}");
            } else {
                trace!("DHT peer {peer_id}: {state}");
            }
        }
        Event::MessageReceived {
            ref peer_id,
            ref channel,
            ref data,
        } => {
            if !approval_store.is_approved(peer_id) {
                approval_store.approve(peer_id, "cairn-transport");
                approval_store.save();
                info!("Auto-approved peer: {peer_id}");
            }
            known_clients.insert(peer_id.clone());

            if data.is_empty() {
                return;
            }

            let tag = data[0];
            let payload = &data[1..];

            match tag {
                TAG_RPC => {
                    debug!("RPC from {peer_id} ({} bytes)", payload.len());

                    let request = match jaunt_protocol::decode_request(payload) {
                        Ok(r) => r,
                        Err(e) => {
                            let response = RpcResponse::Error {
                                code: 1,
                                message: format!("decode error: {e}"),
                            };
                            send_rpc_response(node, peer_id, &response).await;
                            return;
                        }
                    };

                    match request {
                        RpcRequest::SessionAttach { ref target } => {
                            info!(
                                "Session attach: peer={} target={target}",
                                &peer_id[..16.min(peer_id.len())]
                            );
                            handle_session_attach(node, peer_id, target, snag, attachments).await;
                        }
                        RpcRequest::SessionDetach {} => {
                            info!("Session detach: peer={}", &peer_id[..16.min(peer_id.len())]);
                            handle_session_detach(peer_id, attachments).await;
                            let response = RpcResponse::Ok(RpcData::Empty {});
                            send_rpc_response(node, peer_id, &response).await;
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
                            send_rpc_response(node, peer_id, &response).await;
                        }
                        _ => {
                            let response = handle_rpc_request(&request, snag, file_browser);
                            if let RpcResponse::Error { message, .. } = &response {
                                warn!("RPC error: {message}");
                            }
                            send_rpc_response(node, peer_id, &response).await;
                        }
                    }
                }
                TAG_PTY => {
                    let att = attachments.read().await;
                    if let Some(attachment) = att.get(peer_id) {
                        let mut guard = attachment.writer.lock().await;
                        if let Some(ref mut w) = *guard {
                            if let Err(e) = w.send_pty_input(payload).await {
                                warn!("PTY send to {} failed: {e}", attachment.target);
                            }
                        }
                    }
                }
                _ => {
                    // Legacy fallback: try routing by channel name
                    match channel.as_str() {
                        "rpc" => {
                            debug!("RPC from {peer_id} ({} bytes, legacy channel)", data.len());
                            let request = match jaunt_protocol::decode_request(data) {
                                Ok(r) => r,
                                Err(e) => {
                                    let response = RpcResponse::Error {
                                        code: 1,
                                        message: format!("decode error: {e}"),
                                    };
                                    send_rpc_response(node, peer_id, &response).await;
                                    return;
                                }
                            };
                            let response = handle_rpc_request(&request, snag, file_browser);
                            send_rpc_response(node, peer_id, &response).await;
                        }
                        "pty" => {
                            let att = attachments.read().await;
                            if let Some(attachment) = att.get(peer_id) {
                                let mut guard = attachment.writer.lock().await;
                                if let Some(ref mut w) = *guard {
                                    if let Err(e) = w.send_pty_input(data).await {
                                        warn!("PTY send to {} failed: {e}", attachment.target);
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
            // Dial errors from DHT peers are expected noise
            if error.contains("dial failed") || error.contains("Failed to negotiate") {
                debug!("{error}");
            } else {
                warn!("{error}");
            }
        }
        _ => {}
    }
}

// Application-layer message tags.
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
                            debug!("Sent {} bytes response", resp_data.len());
                        }
                        Err(e) => warn!("Send failed: {e}"),
                    },
                    Err(e) => warn!("Open channel failed: {e}"),
                }
            } else {
                debug!("No session for peer {peer_id}");
            }
        }
        Err(e) => error!("Encode response failed: {e}"),
    }
}

/// Handle SessionAttach: respond with Ok, then spawn a background task that
/// streams PTY output to the browser via the cairn session's "pty" channel.
async fn handle_session_attach(
    node: &Node,
    peer_id: &str,
    target: &str,
    snag: &SnagBridge,
    attachments: &Attachments,
) {
    handle_session_detach(peer_id, attachments).await;

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

    let response = RpcResponse::Ok(RpcData::Empty {});
    send_rpc_response(node, peer_id, &response).await;

    let sessions = node.sessions().await;
    let session = match sessions.get(peer_id) {
        Some(s) => s.clone(),
        None => {
            warn!("No cairn session for peer {peer_id}, cannot start PTY forwarding");
            return;
        }
    };

    let (scrollback, snag_attachment) = match crate::snag::SnagAttachment::attach(target).await {
        Ok(r) => r,
        Err(e) => {
            warn!("SnagAttachment::attach failed: {e}");
            let response = RpcResponse::Error {
                code: 8,
                message: format!("attach failed: {e}"),
            };
            send_rpc_response(node, peer_id, &response).await;
            return;
        }
    };

    let (reader, writer) = snag_attachment.split();
    let writer = Arc::new(tokio::sync::Mutex::new(Some(writer)));

    if !scrollback.is_empty() {
        if let Ok(ch) = session.open_channel("pty").await {
            let sb_bytes = scrollback.as_bytes();
            let mut tagged = Vec::with_capacity(1 + sb_bytes.len());
            tagged.push(TAG_PTY);
            tagged.extend_from_slice(sb_bytes);
            let _ = session.send(&ch, &tagged).await;
            debug!("Sent {} bytes scrollback", sb_bytes.len());
        }
    }

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

    info!(
        "PTY forwarding: peer {} -> session {target}",
        &peer_id[..16.min(peer_id.len())]
    );
}

async fn pty_output_forwarder(
    session: Session,
    mut reader: crate::snag::SnagAttachmentReader,
    peer_id: &str,
) {
    let pty_channel = match session.open_channel("pty").await {
        Ok(ch) => ch,
        Err(e) => {
            warn!("PTY forwarder: failed to open pty channel: {e}");
            return;
        }
    };

    loop {
        match reader.read_pty_output().await {
            Ok(crate::snag::PtyReadResult::Data(data)) => {
                let mut tagged = Vec::with_capacity(1 + data.len());
                tagged.push(TAG_PTY);
                tagged.extend_from_slice(&data);
                if let Err(e) = session.send(&pty_channel, &tagged).await {
                    debug!("PTY forwarder: send failed for peer {peer_id}: {e}");
                    break;
                }
            }
            Ok(crate::snag::PtyReadResult::SessionEvent { event, session_id }) => {
                debug!("PTY forwarder: session event '{event}' for peer {peer_id}");
                let resp = jaunt_protocol::RpcResponse::SessionEvent { event, session_id };
                let rpc_channel = match session.open_channel("rpc").await {
                    Ok(ch) => ch,
                    Err(_) => break,
                };
                let Ok(encoded) = jaunt_protocol::encode_response(&resp) else {
                    break;
                };
                let mut tagged = Vec::with_capacity(1 + encoded.len());
                tagged.push(TAG_RPC);
                tagged.extend_from_slice(&encoded);
                let _ = session.send(&rpc_channel, &tagged).await;
                break;
            }
            Ok(crate::snag::PtyReadResult::Eof) => {
                debug!("PTY forwarder: EOF for peer {peer_id}");
                break;
            }
            Err(e) => {
                debug!("PTY forwarder: read error for peer {peer_id}: {e}");
                break;
            }
        }
    }
}

async fn handle_session_detach(peer_id: &str, attachments: &Attachments) {
    if let Some(attachment) = attachments.write().await.remove(peer_id) {
        attachment.abort_handle.abort();
        debug!("Detached peer {peer_id} from session {}", attachment.target);
    }
}

/// Interactive pairing: generates PIN, starts HTTP server, waits for a device to pair.
pub async fn run_pair(config: JauntConfig) -> Result<(), String> {
    let cairn_config = build_cairn_config(&config);
    info!("Starting P2P transport...");
    let node = cairn_p2p::create_and_start_with_config(cairn_config)
        .await
        .map_err(|e| format!("failed to create cairn node: {e}"))?;

    let all_addrs = node.listen_addresses().await;
    let ws_addrs: Vec<String> = all_addrs
        .iter()
        .filter(|a| a.ends_with("/ws"))
        .map(|a| a.to_string())
        .collect();

    let (conn_profile, profile_url) =
        profile::generate_qr_profile(&node, &config, &ws_addrs).await?;
    let pin_result = profile::generate_pin_profile(&node, &config, &ws_addrs).await;
    let pin = pin_result
        .as_ref()
        .map(|(_, pin)| pin.clone())
        .unwrap_or_default();

    // Register as a Kademlia PROVIDER under a PIN-derived key
    if let Some(sender) = node.swarm_sender().cloned() {
        let pin_key = derive_pin_key(&pin);
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(8)).await;
            info!("DHT: Publishing PIN provider record...");
            match sender.kad_start_providing(pin_key).await {
                Ok(()) => info!("DHT: PIN discoverable (confirmed by DHT peers)"),
                Err(e) => warn!("DHT: PIN publish failed: {e}"),
            }
        });
    }

    // Start the pairing HTTP server
    let _pairing_addr = match pairing_server::start_pairing_server(Arc::new(RwLock::new(
        pairing_server::PairingState {
            pin: pin.clone(),
            profile: conn_profile,
        },
    )))
    .await
    {
        Ok(addr) => {
            debug!("Pairing server listening on {addr}");
            Some(addr)
        }
        Err(e) => {
            warn!("Pairing server failed to start: {e}");
            None
        }
    };

    let peer_id_str = node
        .libp2p_peer_id()
        .map(|p| p.to_string())
        .unwrap_or_default();

    let lan_ip = ws_addrs
        .iter()
        .find(|a| !a.contains("/127.") && a.ends_with("/ws"))
        .and_then(|a| {
            let parts: Vec<&str> = a.split('/').collect();
            parts.get(2).map(|ip| ip.to_string())
        });

    // User-facing output for the pairing UI
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
    if let Some(ref ip) = lan_ip {
        eprintln!("  LAN:     {ip} (same network only)");
    }
    eprintln!();
    eprintln!("  Waiting for a device to connect...");
    eprintln!();

    let mut approval_store = ApprovalStore::load();

    loop {
        match node.recv_event().await {
            Some(Event::PairingCompleted { ref peer_id })
            | Some(Event::MessageReceived { ref peer_id, .. }) => {
                if !approval_store.is_approved(peer_id) {
                    approval_store.approve(peer_id, "paired");
                    approval_store.save();
                }
                eprintln!("  Device paired: {}...", &peer_id[..24.min(peer_id.len())]);
                eprintln!("  Run `jaunt-host serve` to start accepting connections.");
                break;
            }
            Some(Event::StateChanged {
                ref peer_id,
                ref state,
            }) => {
                trace!(
                    "Pairing: peer {}...: {state}",
                    &peer_id[..16.min(peer_id.len())]
                );
            }
            Some(Event::Error { ref error }) => {
                if error.contains("dial failed") {
                    trace!("{error}");
                } else {
                    debug!("{error}");
                }
            }
            None => break,
            _ => {}
        }
    }
    Ok(())
}

fn derive_pin_key(pin: &str) -> Vec<u8> {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    type HmacSha256 = Hmac<Sha256>;
    let mut mac = HmacSha256::new_from_slice(b"jaunt-pin-v1").expect("HMAC key");
    mac.update(pin.as_bytes());
    let hash = mac.finalize().into_bytes();
    let mut mh = Vec::with_capacity(2 + hash.len());
    mh.push(0x00);
    mh.push(hash.len() as u8);
    mh.extend_from_slice(&hash);
    mh
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

    cairn.app_identifier = Some("jaunt".to_string());

    // Filter listen addresses to skip Docker bridge interfaces (172.17-31.x.x).
    // These waste startup time (mDNS on 25+ bridges) and are never useful for P2P.
    if let Ok(addrs) = get_non_docker_listen_addrs() {
        if !addrs.is_empty() {
            cairn.listen_addresses = Some(addrs);
        }
    }

    cairn
}

/// Enumerate network interfaces and generate listen addresses, skipping Docker bridges.
/// Docker uses 172.17.0.0/16 through 172.31.0.0/16 by default.
fn get_non_docker_listen_addrs() -> Result<Vec<String>, String> {
    use std::net::IpAddr;

    let mut addrs = Vec::new();
    let ifaces = nix::ifaddrs::getifaddrs().map_err(|e| format!("getifaddrs: {e}"))?;
    let mut seen = std::collections::HashSet::new();

    for iface in ifaces {
        let ip = match iface.address.and_then(|a| {
            a.as_sockaddr_in().map(|s| IpAddr::V4(s.ip())).or_else(|| {
                a.as_sockaddr_in6().map(|s| IpAddr::V6(s.ip()))
            })
        }) {
            Some(ip) => ip,
            None => continue,
        };

        // Skip Docker bridge ranges: 172.17.0.0/12 minus 172.16.0.0/16 (valid private)
        if let IpAddr::V4(v4) = ip {
            let octets = v4.octets();
            if octets[0] == 172 && octets[1] >= 17 && octets[1] <= 31 {
                continue;
            }
        }

        // Skip link-local IPv6 (fe80::)
        if let IpAddr::V6(v6) = ip {
            if (v6.segments()[0] & 0xffc0) == 0xfe80 {
                continue;
            }
        }

        if !seen.insert(ip) {
            continue;
        }

        let ip_str = match ip {
            IpAddr::V4(v4) => format!("/ip4/{v4}"),
            IpAddr::V6(v6) => format!("/ip6/{v6}"),
        };
        addrs.push(format!("{ip_str}/tcp/0"));
        addrs.push(format!("{ip_str}/udp/0/quic-v1"));
        addrs.push(format!("{ip_str}/tcp/0/ws"));
    }

    Ok(addrs)
}

/// Handle an RPC request and produce a synchronous response.
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
        RpcRequest::SessionPreview { target, lines } => match snag.session_output(target, *lines) {
            Ok(text) => RpcResponse::Ok(RpcData::Output(text)),
            Err(e) => RpcResponse::Error {
                code: 13,
                message: e,
            },
        },
        RpcRequest::FileBrowse { path, show_hidden } => match file_browser {
            Some(fb) => match fb.browse(path, Some(*show_hidden)) {
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
        RpcRequest::SessionAttach { .. }
        | RpcRequest::SessionDetach {}
        | RpcRequest::Resize { .. } => RpcResponse::Ok(RpcData::Empty {}),
        RpcRequest::FileDownload { path } => match file_browser {
            Some(fb) => match fb.validate_path(&std::path::PathBuf::from(path)) {
                Ok(canonical) => match std::fs::read(&canonical) {
                    Ok(content) => RpcResponse::Ok(RpcData::FileReady {
                        size: content.len() as u64,
                    }),
                    Err(e) => RpcResponse::Error {
                        code: 14,
                        message: format!("read failed: {e}"),
                    },
                },
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
        RpcRequest::FileUpload { path, size: _ } => match file_browser {
            Some(fb) => match fb.validate_path(&std::path::PathBuf::from(path)) {
                Ok(_) => RpcResponse::Ok(RpcData::FileReady { size: 0 }),
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
    }
}
