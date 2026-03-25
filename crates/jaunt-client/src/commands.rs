use cairn_p2p::{CairnConfig, Event, StorageBackend, TurnServer};
use jaunt_protocol::messages::*;
use jaunt_protocol::profile::*;

use crate::config::{ClientConfig, HostEntry};

fn build_cairn_config_for_host(host: &HostEntry, client_config: &ClientConfig) -> CairnConfig {
    let mut config = CairnConfig::default();

    let signal = host
        .signal_server
        .as_ref()
        .or(client_config.cairn.signal_server.as_ref());
    if let Some(s) = signal {
        config.signaling_servers = vec![s.clone()];
    }

    let turn_url = host
        .turn_server
        .as_ref()
        .or(client_config.cairn.turn_server.as_ref());
    let turn_user = host
        .turn_username
        .as_ref()
        .or(client_config.cairn.turn_username.as_ref());
    let turn_pass = host
        .turn_password
        .as_ref()
        .or(client_config.cairn.turn_password.as_ref());

    if let (Some(url), Some(user), Some(pass)) = (turn_url, turn_user, turn_pass) {
        config.turn_servers = vec![TurnServer {
            url: url.clone(),
            username: user.clone(),
            credential: pass.clone(),
        }];
    }

    config.storage_backend = StorageBackend::Filesystem {
        path: ClientConfig::config_path()
            .parent()
            .unwrap_or(&std::path::PathBuf::from("."))
            .join("cairn-client-data"),
    };

    config
}

pub async fn cmd_pair_pin(
    config: &ClientConfig,
    pin: &str,
    alias: Option<&str>,
) -> Result<(), String> {
    let mut cairn_config = CairnConfig::default();
    if let Some(ref s) = config.cairn.signal_server {
        cairn_config.signaling_servers = vec![s.clone()];
    }
    cairn_config.storage_backend = StorageBackend::Filesystem {
        path: ClientConfig::config_path()
            .parent()
            .unwrap_or(&std::path::PathBuf::from("."))
            .join("cairn-client-data"),
    };

    let node = cairn_p2p::create_with_config(cairn_config)
        .map_err(|e| format!("failed to create cairn node: {e}"))?;

    println!("Pairing with PIN: {pin}...");
    let peer_id = node
        .pair_enter_pin(pin)
        .await
        .map_err(|e| format!("pairing failed: {e}"))?;

    let alias = alias.unwrap_or("host").to_string();
    println!("Paired successfully with peer: {peer_id}");

    let mut config = ClientConfig::load();
    config.add_host(HostEntry {
        alias: alias.clone(),
        peer_id: peer_id.to_string(),
        host_name: "unknown".into(),
        signal_server: None,
        signal_auth_token: None,
        turn_server: None,
        turn_username: None,
        turn_password: None,
        paired_at: utc_now(),
    });
    config.save();

    println!("Host saved as: {alias}");
    Ok(())
}

pub async fn cmd_pair_link(
    config: &mut ClientConfig,
    link: &str,
    alias: Option<&str>,
) -> Result<(), String> {
    let fragment = link
        .split('#')
        .nth(1)
        .ok_or("invalid link: no fragment found")?;

    let profile = decode_profile_from_fragment(fragment)?;

    let mut cairn_config = CairnConfig::default();
    if let Some(ref s) = profile.signal_server {
        cairn_config.signaling_servers = vec![s.clone()];
    }
    if let (Some(ref url), Some(ref user), Some(ref pass)) = (
        &profile.turn_server,
        &profile.turn_username,
        &profile.turn_password,
    ) {
        cairn_config.turn_servers = vec![TurnServer {
            url: url.clone(),
            username: user.clone(),
            credential: pass.clone(),
        }];
    }
    cairn_config.storage_backend = StorageBackend::Filesystem {
        path: ClientConfig::config_path()
            .parent()
            .unwrap_or(&std::path::PathBuf::from("."))
            .join("cairn-client-data"),
    };

    let node = cairn_p2p::create_with_config(cairn_config)
        .map_err(|e| format!("failed to create cairn node: {e}"))?;

    println!("Pairing with host: {}...", profile.host_name);

    let peer_id = match &profile.pairing {
        PairingData::Qr { qr_data } => node
            .pair_scan_qr(qr_data)
            .await
            .map_err(|e| format!("QR pairing failed: {e}"))?,
        PairingData::Link { uri } => node
            .pair_from_link(uri)
            .await
            .map_err(|e| format!("link pairing failed: {e}"))?,
        PairingData::Pin { pin } => node
            .pair_enter_pin(pin)
            .await
            .map_err(|e| format!("PIN pairing failed: {e}"))?,
    };

    let alias = alias.unwrap_or(&profile.host_name).to_string();
    println!("Paired successfully with {}", profile.host_name);

    config.add_host(HostEntry {
        alias: alias.clone(),
        peer_id: peer_id.to_string(),
        host_name: profile.host_name,
        signal_server: profile.signal_server,
        signal_auth_token: profile.signal_auth_token,
        turn_server: profile.turn_server,
        turn_username: profile.turn_username,
        turn_password: profile.turn_password,
        paired_at: utc_now(),
    });
    config.save();

    println!("Host saved as: {alias}");
    Ok(())
}

pub async fn cmd_sessions(config: &ClientConfig, host: &HostEntry) -> Result<(), String> {
    let cairn_config = build_cairn_config_for_host(host, config);
    let node = cairn_p2p::create_with_config(cairn_config)
        .map_err(|e| format!("failed to create cairn node: {e}"))?;

    let session = node
        .connect(&host.peer_id)
        .await
        .map_err(|e| format!("connection failed: {e}"))?;

    let channel = session
        .open_channel("rpc")
        .await
        .map_err(|e| format!("channel open failed: {e}"))?;

    let request = RpcRequest::SessionList {};
    let data = jaunt_protocol::encode_request(&request).map_err(|e| format!("encode: {e}"))?;
    session
        .send(&channel, &data)
        .await
        .map_err(|e| format!("send failed: {e}"))?;

    if let Some(Event::MessageReceived { data, .. }) = node.recv_event().await {
        match jaunt_protocol::decode_response(&data) {
            Ok(RpcResponse::Ok(RpcData::SessionList(sessions))) => {
                if sessions.is_empty() {
                    println!("No sessions on {}", host.host_name);
                } else {
                    println!(
                        "{:<16}  {:<12}  {:<6}  {:<10}  CWD",
                        "ID", "NAME", "SHELL", "STATE"
                    );
                    for s in &sessions {
                        let name = s.name.as_deref().unwrap_or("-");
                        let shell = s.shell.rsplit('/').next().unwrap_or(&s.shell);
                        println!(
                            "{:<16}  {:<12}  {:<6}  {:<10}  {}",
                            &s.id[..8.min(s.id.len())],
                            name,
                            shell,
                            s.state,
                            s.cwd
                        );
                    }
                }
            }
            Ok(RpcResponse::Error { message, .. }) => return Err(message),
            _ => {}
        }
    }
    Ok(())
}

pub async fn cmd_attach(host: &HostEntry, _session: &str) -> Result<(), String> {
    println!(
        "Attaching to session on {}... (streaming PTY not yet implemented in CLI client)",
        host.host_name
    );
    Ok(())
}

pub async fn cmd_send(
    config: &ClientConfig,
    host: &HostEntry,
    session: &str,
    command: &str,
) -> Result<(), String> {
    let cairn_config = build_cairn_config_for_host(host, config);
    let node = cairn_p2p::create_with_config(cairn_config)
        .map_err(|e| format!("failed to create cairn node: {e}"))?;

    let conn = node
        .connect(&host.peer_id)
        .await
        .map_err(|e| format!("connection failed: {e}"))?;

    let channel = conn
        .open_channel("rpc")
        .await
        .map_err(|e| format!("channel open failed: {e}"))?;

    let request = RpcRequest::SessionSend {
        target: session.to_string(),
        input: command.to_string(),
    };
    let data = jaunt_protocol::encode_request(&request).map_err(|e| format!("encode: {e}"))?;
    conn.send(&channel, &data)
        .await
        .map_err(|e| format!("send failed: {e}"))?;

    println!("Sent command to {session} on {}", host.host_name);
    Ok(())
}

pub async fn cmd_files(config: &ClientConfig, host: &HostEntry, path: &str) -> Result<(), String> {
    let cairn_config = build_cairn_config_for_host(host, config);
    let node = cairn_p2p::create_with_config(cairn_config)
        .map_err(|e| format!("failed to create cairn node: {e}"))?;

    let session = node
        .connect(&host.peer_id)
        .await
        .map_err(|e| format!("connection failed: {e}"))?;

    let channel = session
        .open_channel("rpc")
        .await
        .map_err(|e| format!("channel open failed: {e}"))?;

    let request = RpcRequest::FileBrowse {
        path: path.to_string(),
        show_hidden: false,
    };
    let data = jaunt_protocol::encode_request(&request).map_err(|e| format!("encode: {e}"))?;
    session
        .send(&channel, &data)
        .await
        .map_err(|e| format!("send failed: {e}"))?;

    if let Some(Event::MessageReceived { data, .. }) = node.recv_event().await {
        match jaunt_protocol::decode_response(&data) {
            Ok(RpcResponse::Ok(RpcData::DirListing { path, entries })) => {
                println!("{path}:");
                for e in &entries {
                    if e.hidden {
                        continue;
                    }
                    let type_char = match &e.entry_type {
                        EntryType::Directory => "d",
                        EntryType::File => "-",
                        EntryType::Symlink { .. } => "l",
                    };
                    println!("  {type_char} {:>10}  {}", e.size, e.name);
                }
            }
            Ok(RpcResponse::Error { message, .. }) => return Err(message),
            _ => {}
        }
    }
    Ok(())
}

pub async fn cmd_new_session(
    config: &ClientConfig,
    host: &HostEntry,
    name: Option<&str>,
) -> Result<(), String> {
    let cairn_config = build_cairn_config_for_host(host, config);
    let node = cairn_p2p::create_with_config(cairn_config)
        .map_err(|e| format!("failed to create cairn node: {e}"))?;

    let session = node
        .connect(&host.peer_id)
        .await
        .map_err(|e| format!("connection failed: {e}"))?;

    let channel = session
        .open_channel("rpc")
        .await
        .map_err(|e| format!("channel open failed: {e}"))?;

    let request = RpcRequest::SessionCreate {
        shell: None,
        name: name.map(|s| s.to_string()),
        cwd: None,
    };
    let data = jaunt_protocol::encode_request(&request).map_err(|e| format!("encode: {e}"))?;
    session
        .send(&channel, &data)
        .await
        .map_err(|e| format!("send failed: {e}"))?;

    if let Some(Event::MessageReceived { data, .. }) = node.recv_event().await {
        match jaunt_protocol::decode_response(&data) {
            Ok(RpcResponse::Ok(RpcData::SessionCreated { id })) => println!("{id}"),
            Ok(RpcResponse::Error { message, .. }) => return Err(message),
            _ => {}
        }
    }
    Ok(())
}

pub async fn cmd_kill_session(
    config: &ClientConfig,
    host: &HostEntry,
    session_target: &str,
) -> Result<(), String> {
    let cairn_config = build_cairn_config_for_host(host, config);
    let node = cairn_p2p::create_with_config(cairn_config)
        .map_err(|e| format!("failed to create cairn node: {e}"))?;

    let session = node
        .connect(&host.peer_id)
        .await
        .map_err(|e| format!("connection failed: {e}"))?;

    let channel = session
        .open_channel("rpc")
        .await
        .map_err(|e| format!("channel open failed: {e}"))?;

    let request = RpcRequest::SessionKill {
        target: session_target.to_string(),
    };
    let data = jaunt_protocol::encode_request(&request).map_err(|e| format!("encode: {e}"))?;
    session
        .send(&channel, &data)
        .await
        .map_err(|e| format!("send failed: {e}"))?;

    println!("Killed session {session_target} on {}", host.host_name);
    Ok(())
}

pub fn cmd_hosts_list(config: &ClientConfig) {
    if config.hosts.is_empty() {
        println!("No paired hosts.");
        return;
    }
    println!("{:<16}  {:<20}  {:<40}  PAIRED", "ALIAS", "HOST", "PEER ID");
    for h in &config.hosts {
        println!(
            "{:<16}  {:<20}  {:<40}  {}",
            h.alias, h.host_name, h.peer_id, h.paired_at
        );
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
