---
name: snag Unix socket protocol
description: Complete wire protocol, types, and socket path logic for connecting to the snag daemon from jaunt
type: project
---

Complete snag IPC protocol as of /home/emeric/code/snag (v0.2.0).

**Why:** Jaunt needs to integrate with snag either by shelling out to the binary or by connecting directly to its Unix socket. The socket protocol is the lower-latency path.

**How to apply:** Use these exact types and framing rules when implementing a snag client in jaunt.

---

## Socket path resolution (src/config.rs)

Priority order in `Config::socket_path()`:
1. `config.socket` field (explicit override)
2. `$XDG_RUNTIME_DIR/snag/snag.sock`
3. `/tmp/snag-{uid}/snag.sock` (uid from `nix::unistd::getuid()`)

Config file: `$XDG_CONFIG_HOME/snag/config.toml` or `$HOME/.config/snag/config.toml` or `/etc/snag/config.toml`

---

## Wire framing (src/protocol/codec.rs)

Every message (request or response) is a frame:
```
[1 byte: msg_type] [4 bytes: payload_len, little-endian u32] [N bytes: payload]
```
- Header size: 5 bytes
- Max payload: 16 MB
- Payload encoding: **MessagePack via rmp-serde**, EXCEPT:
  - `Request::PtyInput` and `Response::PtyOutput` payloads are **raw bytes** (no msgpack wrapper)

---

## Message type constants (src/protocol/types.rs)

Requests:
- 0x01 MSG_SESSION_NEW
- 0x02 MSG_SESSION_KILL
- 0x03 MSG_SESSION_RENAME
- 0x04 MSG_SESSION_LIST
- 0x05 MSG_SESSION_INFO
- 0x06 MSG_SESSION_ATTACH
- 0x07 MSG_SESSION_DETACH
- 0x08 MSG_SESSION_SEND
- 0x09 MSG_SESSION_OUTPUT
- 0x0A MSG_SESSION_CWD
- 0x0B MSG_SESSION_PS
- 0x0C MSG_SESSION_SCAN
- 0x0D MSG_SESSION_ADOPT
- 0x0E MSG_RESIZE
- 0x10 MSG_PTY_INPUT  (raw bytes payload)
- 0xF0 MSG_DAEMON_STATUS
- 0xF1 MSG_DAEMON_STOP

Responses:
- 0x80 MSG_OK
- 0x81 MSG_ERROR
- 0x82 MSG_PTY_OUTPUT  (raw bytes payload)
- 0x83 MSG_SESSION_EVENT

---

## Request enum (src/protocol/types.rs)

```rust
pub enum Request {
    SessionNew { shell: Option<String>, name: Option<String>, cwd: Option<String> },
    SessionKill { target: String },
    SessionRename { target: String, new_name: String },
    SessionList { all: bool },
    SessionInfo { target: String },
    SessionAttach { target: String, read_only: bool },
    SessionDetach,
    SessionSend { target: String, input: String },
    SessionOutput { target: String, lines: Option<u32>, follow: bool },
    SessionCwd { target: String },
    SessionPs { target: String },
    SessionScan,
    SessionAdopt { pts_or_pid: String, name: Option<String> },
    Resize { cols: u16, rows: u16 },
    PtyInput(Vec<u8>),
    DaemonStatus,
    DaemonStop,
}
```

`target` fields accept session ID or name (server resolves ambiguity).

---

## Response enum

```rust
pub enum Response {
    Ok(ResponseData),
    Error { code: u16, message: String },
    PtyOutput(Vec<u8>),
    SessionEvent { event: String, session_id: String },
}

pub enum ResponseData {
    SessionCreated { id: String },
    SessionList(Vec<SessionInfo>),
    SessionInfo(SessionInfo),
    Output(String),
    Cwd(String),
    ProcessInfo(Vec<ProcessEntry>),
    ScanResult(Vec<DiscoveredSession>),
    DaemonStatus { pid: u32, uptime_secs: u64, session_count: usize },
    Empty,
}
```

---

## Key structs

```rust
pub struct SessionInfo {
    pub id: String,
    pub name: Option<String>,
    pub shell: String,
    pub cwd: String,
    pub state: String,          // e.g. "running", "exited"
    pub fg_process: Option<String>,
    pub attached: usize,
    pub adopted: bool,
    pub created_at: String,     // ISO 8601 string
}

pub struct ProcessEntry { pub pid: u32, pub command: String }

pub struct DiscoveredSession {
    pub pts: String, pub holder_pid: u32, pub holder_fd: i32,
    pub shell_pid: Option<u32>, pub command: String, pub cwd: String,
    pub adoptable: bool,
}
```

---

## DaemonClient API (src/client.rs)

```rust
impl DaemonClient {
    pub async fn connect(config: &Config) -> Result<Self>
    // Auto-starts daemon via fork+exec `snag daemon start --socket <path>` if not running

    pub async fn request(&mut self, req: &Request) -> Result<Response>
    pub async fn read_response(&mut self) -> Result<Response>
    pub async fn send_raw(&mut self, data: &[u8]) -> Result<()>
    // Wraps data as PtyInput frame
    pub async fn send_resize(&mut self, cols: u16, rows: u16) -> Result<()>
    pub async fn send_detach(&mut self) -> Result<()>
    pub fn into_stream(self) -> UnixStream
}
```

Retry logic: 20 attempts × 100ms = 2s timeout waiting for daemon.

---

## Serialization dependency

- `rmp-serde = "1"` (MessagePack)
- `serde = { version = "1", features = ["derive"] }`
- All Request/Response types are `#[derive(Debug, Clone, Serialize, Deserialize)]`

---

## Integration options for jaunt

**Option A — shell out to `snag` CLI:** Simple, no protocol impl needed. Use `SessionList`, `SessionNew`, etc. via subprocess.

**Option B — direct Unix socket:** Connect to `$XDG_RUNTIME_DIR/snag/snag.sock` (or `/tmp/snag-{uid}/snag.sock`), implement the 5-byte framing + rmp-serde encode/decode. Gives lower latency and streaming (PtyOutput, SessionEvent).

For PTY attach/streaming use Option B — `SessionAttach` followed by reading `PtyOutput` frames and writing `PtyInput` frames.
