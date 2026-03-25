use futures_util::{SinkExt, StreamExt};
use jaunt_protocol::messages::*;
use std::net::SocketAddr;
use tokio::net::TcpListener;

use crate::files::FileBrowser;
use crate::snag::SnagBridge;

/// Start a WebSocket server for browser clients.
/// Returns the listen address (ws://host:port).
pub async fn start_ws_server(
    snag: SnagBridge,
    file_browser: Option<FileBrowser>,
) -> Result<SocketAddr, String> {
    let listener = TcpListener::bind("0.0.0.0:0")
        .await
        .map_err(|e| format!("WS bind failed: {e}"))?;

    let addr = listener
        .local_addr()
        .map_err(|e| format!("WS addr failed: {e}"))?;

    let snag = std::sync::Arc::new(snag);
    let file_browser = std::sync::Arc::new(file_browser);

    tokio::spawn(async move {
        while let Ok((stream, peer_addr)) = listener.accept().await {
            let snag = snag.clone();
            let fb = file_browser.clone();
            tokio::spawn(async move {
                let ws = match tokio_tungstenite::accept_async(stream).await {
                    Ok(ws) => ws,
                    Err(e) => {
                        eprintln!("WS handshake failed from {peer_addr}: {e}");
                        return;
                    }
                };
                eprintln!("WS client connected: {peer_addr}");
                handle_ws_client(ws, &snag, &fb).await;
                eprintln!("WS client disconnected: {peer_addr}");
            });
        }
    });

    Ok(addr)
}

async fn handle_ws_client(
    ws: tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>,
    snag: &SnagBridge,
    file_browser: &Option<FileBrowser>,
) {
    let (mut tx, mut rx) = ws.split();

    while let Some(msg) = rx.next().await {
        let msg = match msg {
            Ok(m) => m,
            Err(_) => break,
        };

        let data = match msg {
            tokio_tungstenite::tungstenite::Message::Binary(d) => d,
            tokio_tungstenite::tungstenite::Message::Close(_) => break,
            _ => continue,
        };

        // Decode RPC request
        let request = match jaunt_protocol::decode_request(&data) {
            Ok(r) => r,
            Err(e) => {
                let resp = RpcResponse::Error {
                    code: 1,
                    message: format!("decode error: {e}"),
                };
                if let Ok(encoded) = jaunt_protocol::encode_response(&resp) {
                    let _ = tx
                        .send(tokio_tungstenite::tungstenite::Message::Binary(encoded.into()))
                        .await;
                }
                continue;
            }
        };

        // Handle request
        let response = handle_rpc(&request, snag, file_browser);

        // Send response
        if let Ok(encoded) = jaunt_protocol::encode_response(&response) {
            if tx
                .send(tokio_tungstenite::tungstenite::Message::Binary(encoded.into()))
                .await
                .is_err()
            {
                break;
            }
        }
    }
}

fn handle_rpc(
    request: &RpcRequest,
    snag: &SnagBridge,
    file_browser: &Option<FileBrowser>,
) -> RpcResponse {
    match request {
        RpcRequest::SessionList => match snag.list_sessions() {
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
            Ok(()) => RpcResponse::Ok(RpcData::Empty),
            Err(e) => RpcResponse::Error {
                code: 4,
                message: e,
            },
        },
        RpcRequest::SessionSend { target, input } => match snag.send_input(target, input) {
            Ok(()) => RpcResponse::Ok(RpcData::Empty),
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
                Ok(()) => RpcResponse::Ok(RpcData::Empty),
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
                Ok(()) => RpcResponse::Ok(RpcData::Empty),
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
        _ => RpcResponse::Ok(RpcData::Empty),
    }
}
