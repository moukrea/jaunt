use jaunt_protocol::messages::*;
use std::path::PathBuf;
use std::process::Command;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::UnixStream;

// ── Snag daemon protocol constants ──────────────────────────────────────────
// These match snag's protocol/types.rs and codec.rs exactly.

const MSG_SESSION_ATTACH: u8 = 0x06;
const MSG_SESSION_DETACH: u8 = 0x07;
const MSG_RESIZE: u8 = 0x0E;
const MSG_PTY_INPUT: u8 = 0x10;
const MSG_OK: u8 = 0x80;
// const MSG_ERROR: u8 = 0x81;
const MSG_PTY_OUTPUT: u8 = 0x82;
const MSG_SESSION_EVENT: u8 = 0x83;

const HEADER_SIZE: usize = 5;

/// Encode a snag protocol frame: [msg_type: u8][length: u32 LE][payload]
fn encode_frame(msg_type: u8, payload: &[u8]) -> Vec<u8> {
    let mut frame = Vec::with_capacity(HEADER_SIZE + payload.len());
    frame.push(msg_type);
    frame.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    frame.extend_from_slice(payload);
    frame
}

/// Read a single snag protocol frame from the stream.
/// Returns (msg_type, payload) or None on EOF.
async fn read_frame(
    reader: &mut (impl AsyncReadExt + Unpin),
) -> Result<Option<(u8, Vec<u8>)>, String> {
    let mut header = [0u8; HEADER_SIZE];
    match reader.read_exact(&mut header).await {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(format!("read frame header: {e}")),
    }
    let msg_type = header[0];
    let len = u32::from_le_bytes([header[1], header[2], header[3], header[4]]) as usize;
    if len > 16 * 1024 * 1024 {
        return Err(format!("frame too large: {len}"));
    }
    let mut payload = vec![0u8; len];
    reader
        .read_exact(&mut payload)
        .await
        .map_err(|e| format!("read frame payload: {e}"))?;
    Ok(Some((msg_type, payload)))
}

// ── SnagAttachment: a live connection to the snag daemon for PTY I/O ────────

/// A live PTY attachment to a snag session via the daemon's Unix socket.
/// Supports raw PTY input, output streaming, and resize.
pub struct SnagAttachment {
    writer: tokio::io::WriteHalf<UnixStream>,
    reader: tokio::io::ReadHalf<UnixStream>,
}

impl SnagAttachment {
    /// Connect to the snag daemon and attach to a session.
    /// Returns the initial scrollback text and the attachment handle.
    pub async fn attach(target: &str) -> Result<(String, Self), String> {
        let socket_path = snag_socket_path();
        let stream = UnixStream::connect(&socket_path)
            .await
            .map_err(|e| format!("connect to snag daemon at {}: {e}", socket_path.display()))?;

        let (mut reader, mut writer) = tokio::io::split(stream);

        // Send SessionAttach request
        // snag uses rmp_serde for non-PtyInput messages
        let attach_payload = rmp_serde::to_vec(&serde_json::json!({
            "SessionAttach": {
                "target": target,
                "read_only": false
            }
        }))
        .map_err(|e| format!("encode attach: {e}"))?;
        let frame = encode_frame(MSG_SESSION_ATTACH, &attach_payload);
        writer
            .write_all(&frame)
            .await
            .map_err(|e| format!("send attach: {e}"))?;
        writer
            .flush()
            .await
            .map_err(|e| format!("flush attach: {e}"))?;

        // Read the response
        let (msg_type, payload) = read_frame(&mut reader)
            .await?
            .ok_or_else(|| "snag daemon closed connection".to_string())?;

        let scrollback = if msg_type == MSG_OK {
            // Decode the response payload to extract scrollback text
            let resp: serde_json::Value =
                rmp_serde::from_slice(&payload).unwrap_or(serde_json::Value::Null);
            // The Ok response contains ResponseData::Output(scrollback) or ResponseData::Empty
            if let Some(serde_json::Value::String(text)) =
                resp.get("Ok").and_then(|v| v.get("Output"))
            {
                text.clone()
            } else {
                String::new()
            }
        } else {
            // Error or unexpected response
            let resp: serde_json::Value =
                rmp_serde::from_slice(&payload).unwrap_or(serde_json::Value::Null);
            let msg = resp
                .get("Error")
                .and_then(|v| v.get("message"))
                .and_then(|v| v.as_str())
                .unwrap_or("attach failed");
            return Err(msg.to_string());
        };

        Ok((scrollback, Self { writer, reader }))
    }

    /// Send raw PTY input bytes to the attached session.
    pub async fn send_pty_input(&mut self, data: &[u8]) -> Result<(), String> {
        let frame = encode_frame(MSG_PTY_INPUT, data);
        self.writer
            .write_all(&frame)
            .await
            .map_err(|e| format!("send pty input: {e}"))?;
        self.writer
            .flush()
            .await
            .map_err(|e| format!("flush pty input: {e}"))?;
        Ok(())
    }

    /// Send a resize event to the attached session.
    pub async fn send_resize(&mut self, cols: u16, rows: u16) -> Result<(), String> {
        let payload = rmp_serde::to_vec(&serde_json::json!({
            "Resize": { "cols": cols, "rows": rows }
        }))
        .map_err(|e| format!("encode resize: {e}"))?;
        let frame = encode_frame(MSG_RESIZE, &payload);
        self.writer
            .write_all(&frame)
            .await
            .map_err(|e| format!("send resize: {e}"))?;
        self.writer
            .flush()
            .await
            .map_err(|e| format!("flush resize: {e}"))?;
        Ok(())
    }

    /// Read the next PTY output chunk. Returns None on EOF or session exit.
    pub async fn read_pty_output(&mut self) -> Result<Option<Vec<u8>>, String> {
        match read_frame(&mut self.reader).await? {
            Some((MSG_PTY_OUTPUT, payload)) => Ok(Some(payload)),
            Some((MSG_SESSION_EVENT, _)) => Ok(None), // Session exited
            Some((MSG_OK, _)) => {
                // Ack from resize or other control message -- skip, read next
                // Recurse to get the actual PTY output
                Box::pin(self.read_pty_output()).await
            }
            Some((msg_type, _)) => {
                eprintln!("  SnagAttachment: unexpected msg_type=0x{msg_type:02x}");
                Box::pin(self.read_pty_output()).await
            }
            None => Ok(None), // EOF
        }
    }

    /// Split into reader and writer halves.
    pub fn split(self) -> (SnagAttachmentReader, SnagAttachmentWriter) {
        (
            SnagAttachmentReader {
                reader: self.reader,
            },
            SnagAttachmentWriter {
                writer: self.writer,
            },
        )
    }

    /// Send detach and close.
    pub async fn detach(mut self) {
        let payload = rmp_serde::to_vec(&serde_json::json!("SessionDetach")).unwrap_or_default();
        let frame = encode_frame(MSG_SESSION_DETACH, &payload);
        let _ = self.writer.write_all(&frame).await;
        let _ = self.writer.flush().await;
    }
}

/// Writer half of a SnagAttachment — for sending PTY input and resize.
pub struct SnagAttachmentWriter {
    writer: tokio::io::WriteHalf<UnixStream>,
}

impl SnagAttachmentWriter {
    /// Send raw PTY input bytes.
    pub async fn send_pty_input(&mut self, data: &[u8]) -> Result<(), String> {
        use tokio::io::AsyncWriteExt;
        let frame = encode_frame(MSG_PTY_INPUT, data);
        self.writer
            .write_all(&frame)
            .await
            .map_err(|e| format!("send pty input: {e}"))?;
        self.writer
            .flush()
            .await
            .map_err(|e| format!("flush pty input: {e}"))?;
        Ok(())
    }

    /// Send a resize event.
    pub async fn send_resize(&mut self, cols: u16, rows: u16) -> Result<(), String> {
        use tokio::io::AsyncWriteExt;
        let payload = rmp_serde::to_vec(&serde_json::json!({
            "Resize": { "cols": cols, "rows": rows }
        }))
        .map_err(|e| format!("encode resize: {e}"))?;
        let frame = encode_frame(MSG_RESIZE, &payload);
        self.writer
            .write_all(&frame)
            .await
            .map_err(|e| format!("send resize: {e}"))?;
        self.writer
            .flush()
            .await
            .map_err(|e| format!("flush resize: {e}"))?;
        Ok(())
    }
}

/// Reader half of a SnagAttachment — for reading PTY output.
pub struct SnagAttachmentReader {
    reader: tokio::io::ReadHalf<UnixStream>,
}

impl SnagAttachmentReader {
    /// Read the next PTY output chunk. Returns None on EOF or session exit.
    pub async fn read_pty_output(&mut self) -> Result<Option<Vec<u8>>, String> {
        match read_frame(&mut self.reader).await? {
            Some((MSG_PTY_OUTPUT, payload)) => Ok(Some(payload)),
            Some((MSG_SESSION_EVENT, _)) => Ok(None),
            Some((MSG_OK, _)) => Box::pin(self.read_pty_output()).await,
            Some((msg_type, _)) => {
                eprintln!("  SnagReader: unexpected msg_type=0x{msg_type:02x}");
                Box::pin(self.read_pty_output()).await
            }
            None => Ok(None),
        }
    }
}

/// Get the snag daemon socket path (same logic as snag's config.rs).
fn snag_socket_path() -> PathBuf {
    if let Ok(dir) = std::env::var("XDG_RUNTIME_DIR") {
        PathBuf::from(dir).join("snag").join("snag.sock")
    } else {
        let uid = nix::unistd::getuid();
        PathBuf::from(format!("/tmp/snag-{}", uid)).join("snag.sock")
    }
}

// ── SnagBridge: CLI-based operations (list, create, kill, info, etc.) ───────

pub struct SnagBridge {
    snag_path: String,
}

impl SnagBridge {
    pub fn new() -> Self {
        let snag_path = which_snag().unwrap_or_else(|| "snag".to_string());
        Self { snag_path }
    }

    pub fn check_available(&self) -> Result<(), String> {
        Command::new(&self.snag_path)
            .arg("--version")
            .output()
            .map_err(|e| format!("snag not found: {e}. Install snag first."))?;
        Ok(())
    }

    pub fn list_sessions(&self) -> Result<Vec<SessionInfo>, String> {
        let output = Command::new(&self.snag_path)
            .args(["list", "--json"])
            .output()
            .map_err(|e| format!("snag list failed: {e}"))?;

        if !output.status.success() {
            return Ok(Vec::new());
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let parsed: serde_json::Value =
            serde_json::from_str(&stdout).map_err(|e| format!("parse error: {e}"))?;

        let sessions = parsed["sessions"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| {
                        Some(SessionInfo {
                            id: v["id"].as_str()?.to_string(),
                            name: v["name"].as_str().map(|s| s.to_string()),
                            shell: v["shell"].as_str().unwrap_or("?").to_string(),
                            cwd: v["cwd"].as_str().unwrap_or("?").to_string(),
                            state: v["state"].as_str().unwrap_or("?").to_string(),
                            fg_process: v["fg_process"].as_str().map(|s| s.to_string()),
                            attached: v["attached"].as_u64().unwrap_or(0) as usize,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(sessions)
    }

    pub fn create_session(
        &self,
        shell: Option<&str>,
        name: Option<&str>,
        cwd: Option<&str>,
    ) -> Result<String, String> {
        let mut cmd = Command::new(&self.snag_path);
        cmd.arg("new");
        if let Some(s) = shell {
            cmd.args(["--shell", s]);
        }
        if let Some(n) = name {
            cmd.args(["--name", n]);
        }
        if let Some(c) = cwd {
            cmd.args(["--cwd", c]);
        }

        let output = cmd.output().map_err(|e| format!("snag new failed: {e}"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("snag new failed: {stderr}"));
        }
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }

    pub fn kill_session(&self, target: &str) -> Result<(), String> {
        let output = Command::new(&self.snag_path)
            .args(["kill", target])
            .output()
            .map_err(|e| format!("snag kill failed: {e}"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("snag kill failed: {stderr}"));
        }
        Ok(())
    }

    pub fn send_input(&self, target: &str, input: &str) -> Result<(), String> {
        let output = Command::new(&self.snag_path)
            .args(["send", target, input])
            .output()
            .map_err(|e| format!("snag send failed: {e}"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("snag send failed: {stderr}"));
        }
        Ok(())
    }

    pub fn session_info(&self, target: &str) -> Result<SessionInfo, String> {
        let output = Command::new(&self.snag_path)
            .args(["info", target, "--json"])
            .output()
            .map_err(|e| format!("snag info failed: {e}"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("snag info failed: {stderr}"));
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        let v: serde_json::Value =
            serde_json::from_str(&stdout).map_err(|e| format!("parse error: {e}"))?;
        Ok(SessionInfo {
            id: v["id"].as_str().unwrap_or("?").to_string(),
            name: v["name"].as_str().map(|s| s.to_string()),
            shell: v["shell"].as_str().unwrap_or("?").to_string(),
            cwd: v["cwd"].as_str().unwrap_or("?").to_string(),
            state: v["state"].as_str().unwrap_or("?").to_string(),
            fg_process: v["fg_process"].as_str().map(|s| s.to_string()),
            attached: v["attached"].as_u64().unwrap_or(0) as usize,
        })
    }

    pub fn rename_session(&self, target: &str, new_name: &str) -> Result<(), String> {
        let output = Command::new(&self.snag_path)
            .args(["rename", target, new_name])
            .output()
            .map_err(|e| format!("snag rename failed: {e}"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("snag rename failed: {stderr}"));
        }
        Ok(())
    }
}

fn which_snag() -> Option<String> {
    Command::new("which")
        .arg("snag")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
}
