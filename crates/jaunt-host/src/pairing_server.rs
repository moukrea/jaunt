//! Tiny HTTP server for PIN-based pairing.
//!
//! Listens on port 9867 and responds to `GET /pair?pin=<PIN>` with the full
//! ConnectionProfile as JSON. This allows browser clients to connect using
//! just a PIN + the host's IP address.

use jaunt_protocol::profile::ConnectionProfile;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::RwLock;

/// The well-known port for the pairing HTTP endpoint.
pub const PAIRING_PORT: u16 = 9867;

/// Shared state for the pairing server.
pub struct PairingState {
    /// The current PIN (formatted, e.g. "A1B2-C3D4").
    pub pin: String,
    /// The full connection profile to return on successful PIN match.
    pub profile: ConnectionProfile,
}

/// Start the pairing HTTP server. Spawns a background task that listens
/// on `0.0.0.0:PAIRING_PORT` and serves the profile when a valid PIN is provided.
///
/// Returns the address the server is listening on.
pub async fn start_pairing_server(
    state: Arc<RwLock<PairingState>>,
) -> Result<std::net::SocketAddr, String> {
    let listener = TcpListener::bind(("0.0.0.0", PAIRING_PORT))
        .await
        .map_err(|e| format!("failed to bind pairing server on port {PAIRING_PORT}: {e}"))?;

    let addr = listener
        .local_addr()
        .map_err(|e| format!("failed to get local addr: {e}"))?;

    tokio::spawn(async move {
        loop {
            let (mut stream, _peer_addr) = match listener.accept().await {
                Ok(s) => s,
                Err(_) => continue,
            };
            let state = state.clone();
            tokio::spawn(async move {
                let _ = handle_connection(&mut stream, &state).await;
            });
        }
    });

    Ok(addr)
}

async fn handle_connection(
    stream: &mut tokio::net::TcpStream,
    state: &Arc<RwLock<PairingState>>,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut buf = vec![0u8; 4096];
    let n = stream.read(&mut buf).await?;
    let request = String::from_utf8_lossy(&buf[..n]);

    // Parse the first line: "GET /pair?pin=XXXX HTTP/1.1" or "OPTIONS /pair HTTP/1.1"
    let first_line = request.lines().next().unwrap_or("");
    let parts: Vec<&str> = first_line.split_whitespace().collect();

    if parts.len() < 2 {
        send_text_response(stream, 400, "Bad Request").await?;
        return Ok(());
    }

    let method = parts[0];
    let path = parts[1];

    // Handle OPTIONS for CORS preflight
    if method == "OPTIONS" {
        send_cors_preflight(stream).await?;
        return Ok(());
    }

    // Only handle GET requests
    if method != "GET" {
        send_text_response(stream, 405, "Method Not Allowed").await?;
        return Ok(());
    }

    // Parse path and query string
    let (base_path, query) = if let Some(idx) = path.find('?') {
        (&path[..idx], &path[idx + 1..])
    } else {
        (path, "")
    };

    if base_path != "/pair" {
        send_text_response(stream, 404, "Not Found").await?;
        return Ok(());
    }

    // Parse the pin query parameter
    let mut pin_param = None;
    for param in query.split('&') {
        if let Some(val) = param.strip_prefix("pin=") {
            // URL-decode the value (handle %20, +, etc.)
            let decoded = val.replace('+', " ").replace("%20", " ");
            pin_param = Some(decoded);
        }
    }

    let pin_input = match pin_param {
        Some(p) => p,
        None => {
            send_json_response(stream, 400, r#"{"error":"missing pin parameter"}"#).await?;
            return Ok(());
        }
    };

    // Normalize both PINs: uppercase, strip hyphens/spaces
    let normalize = |s: &str| -> String {
        s.chars()
            .filter(|c| *c != '-' && *c != ' ')
            .map(|c| c.to_ascii_uppercase())
            .collect()
    };

    let state = state.read().await;
    let normalized_input = normalize(&pin_input);
    let normalized_expected = normalize(&state.pin);

    if normalized_input != normalized_expected {
        send_json_response(stream, 403, r#"{"error":"invalid PIN"}"#).await?;
        return Ok(());
    }

    // PIN matches -- return the full profile as JSON
    let profile_json = serde_json::to_string(&state.profile)
        .unwrap_or_else(|_| r#"{"error":"serialization failed"}"#.to_string());

    send_json_response(stream, 200, &profile_json).await?;
    Ok(())
}

async fn send_text_response(
    stream: &mut tokio::net::TcpStream,
    status: u16,
    body: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let status_text = status_phrase(status);
    let response = format!(
        "HTTP/1.1 {status} {status_text}\r\n\
         Content-Type: text/plain\r\n\
         Content-Length: {}\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Connection: close\r\n\
         \r\n\
         {body}",
        body.len(),
    );
    stream.write_all(response.as_bytes()).await?;
    Ok(())
}

async fn send_json_response(
    stream: &mut tokio::net::TcpStream,
    status: u16,
    body: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let status_text = status_phrase(status);
    let response = format!(
        "HTTP/1.1 {status} {status_text}\r\n\
         Content-Type: application/json\r\n\
         Content-Length: {}\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Access-Control-Allow-Methods: GET, OPTIONS\r\n\
         Access-Control-Allow-Headers: Content-Type\r\n\
         Connection: close\r\n\
         \r\n\
         {body}",
        body.len(),
    );
    stream.write_all(response.as_bytes()).await?;
    Ok(())
}

async fn send_cors_preflight(
    stream: &mut tokio::net::TcpStream,
) -> Result<(), Box<dyn std::error::Error>> {
    let response = "HTTP/1.1 204 No Content\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Access-Control-Allow-Methods: GET, OPTIONS\r\n\
         Access-Control-Allow-Headers: Content-Type\r\n\
         Access-Control-Max-Age: 86400\r\n\
         Content-Length: 0\r\n\
         Connection: close\r\n\
         \r\n";
    stream.write_all(response.as_bytes()).await?;
    Ok(())
}

fn status_phrase(code: u16) -> &'static str {
    match code {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        _ => "Error",
    }
}
