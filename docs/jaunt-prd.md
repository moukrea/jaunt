# Jaunt — Product Requirements Document

**Version:** 0.3
**Status:** Draft
**Dependencies:** [cairn](https://github.com/moukrea/cairn) (P2P connectivity), [snag](https://github.com/moukrea/snag) (PTY session management)

---

## 1. Vision

Jaunt lets you access your machine's shell sessions and files from any device, anywhere, with zero infrastructure. No server to deploy, no port to forward, no VPN to configure. You run `jaunt serve` on your machine, scan a QR code on your phone, and you're in.

Jaunt is a thin bridge between two focused tools: **cairn** handles all networking (encrypted P2P tunnels, pairing, NAT traversal, reconnection, signaling, relay), **snag** handles all shell sessions (spawn, adopt, attach, kill, scrollback). Jaunt's sole job is to connect the two and wrap them in a beautiful, frictionless experience — from a web browser on your phone while on the go to a Tauri desktop app on your laptop.

---

## 2. Problem Statement

Accessing your own machine remotely is either overkill or fragile:

- **SSH** requires port forwarding, dynamic DNS, firewall configuration, and breaks behind double NAT or carrier-grade NAT
- **VPNs** (Tailscale, WireGuard) work well but require account creation, daemon installation on every device, and are designed for network-level access — not "quickly check what cargo build is doing from my phone"
- **tmux over SSH** is the closest workflow but inherits all of SSH's infrastructure requirements and offers no mobile-friendly interface
- **Web-based terminals** (ttyd, Wetty) expose an HTTP server on your machine, requiring reverse proxies, TLS certificates, and authentication layers

None of these solve the core use case: **I want to glance at my machine from my phone in 5 seconds with zero setup on the client side.**

---

## 3. Target Users

- **Developers** who want to check on long-running builds, tests, or deployments from their phone while away from their desk
- **Homelab enthusiasts** who want to manage their server from any device without exposing ports
- **Power users** who run Claude Code or similar AI coding tools and want to monitor or interact with sessions remotely
- **Self-hosters** who refuse to depend on third-party services for something as basic as accessing their own machine

---

## 4. Core Concepts

### Host

The machine you want to access. Runs the `jaunt serve` daemon which:
- Creates a cairn node and listens for paired peers
- Bridges cairn messages to local snag session operations
- Exposes a file browser for navigating the host filesystem and spawning sessions from any directory
- Manages device approval (accept/reject incoming pairing requests)

### Client

Any device connecting to the host. Three client forms:
- **Web client** — static SPA hosted on GitHub Pages, zero install, works from any browser
- **Tauri app** — native app for desktop and mobile, richer experience
- **CLI client** — `jaunt connect` from another terminal, for headless/scripted access

### Pairing

Handled entirely by cairn. Three methods available out of the box:
- **PIN** — host displays a short code (e.g., `A1B2-C3D4`), client enters it. Best for same-room pairing.
- **QR code** — host displays a QR code, client scans it. Best for mobile.
- **Link** — host generates a URI, shared via any channel. Best for remote pairing.

All three use SPAKE2 under the hood. After pairing, cairn handles identity persistence and automatic reconnection — no re-pairing needed.

### Session

A snag-managed PTY session on the host. Jaunt does not manage sessions itself — it delegates entirely to snag and presents the results to the client.

---

## 5. Infrastructure Tiers

Jaunt supports all three cairn infrastructure tiers. The tier is a deployment choice — all Jaunt features work identically across tiers.

### Tier 0 — Zero Infrastructure (default)

- Peers discover each other via DHT/mDNS + public STUN
- Discovery: 5–30 seconds
- Works when both peers have public IPs, are on the same LAN, or are behind simple NATs
- No server to deploy. Default experience.

### Tier 1 — Signaling + Relay

- Add cairn's signaling server (Docker container) for sub-second peer discovery
- Add cairn's TURN relay for symmetric NAT and corporate firewall traversal
- Deployable for free on Cloudflare (per cairn docs) or ~$5/mo VPS
- **Both host and all clients must be configured to point to the same signaling/relay servers**

### Tier 2 — Server Peer

- Add cairn's server-mode peer alongside signaling and relay
- Enables store-and-forward messaging (offline peers receive messages on reconnect)
- Enables multi-device synchronization hub
- Docker Compose stack provided by cairn

### Client-Side Tier Awareness

This is the critical design constraint: **the client's cairn node must be configured with the same infrastructure endpoints as the host's cairn node.** Since the web client is a free static page and the Tauri app is a free download, infrastructure endpoints cannot be hardcoded — they must be communicated to the client.

Jaunt handles this transparently through **connection profiles**:

**QR code and link pairing (any tier):** The host embeds its cairn infrastructure config (signaling URL, auth token, TURN server, TURN credentials) into the QR code data and pairing link URL. The client extracts these on scan/click and creates its cairn node with the correct config. **Zero manual client configuration required.**

Example QR/link URL for Tier 1:
```
jaunt.app/#eyJwaW4iOiJBMUIyLUM...base64-encoded-connection-profile...
```

The web client reads the URL fragment (never sent to any server), decodes the connection profile, initializes cairn with those settings, and pairs automatically.

**PIN pairing on Tier 1+:** The PIN alone doesn't carry infrastructure config. Two options:
1. The host also displays a "connection profile" QR code or link that pre-configures the client without pairing. The user scans/opens it first, then enters the PIN.
2. The client has a settings panel where the user manually enters the signaling/relay server URLs.

**Reconnection (any tier):** Once paired, the client persists both the cairn identity AND the infrastructure config. Reconnection is automatic — no repeated configuration.

---

## 6. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        HOST MACHINE                         │
│                                                             │
│  ┌──────────────────────┐      ┌──────────────────────┐    │
│  │     jaunt serve      │      │        snag           │    │
│  │                      │      │   (PTY multiplexer)   │    │
│  │  ┌────────────────┐  │      │                       │    │
│  │  │  cairn node    │◄─┼──────┼── P2P tunnel ◄───────┼─── │ ── clients
│  │  │  (all network) │  │      │                       │    │
│  │  └────────────────┘  │      │  sessions:            │    │
│  │  ┌────────────────┐  │  ──►│  - dev (zsh)          │    │
│  │  │  snag bridge   │  │      │  - ci (bash)          │    │
│  │  └────────────────┘  │      │  - debug (zsh)        │    │
│  │  ┌────────────────┐  │      └──────────────────────┘    │
│  │  │  file browser  │  │                                  │
│  │  └────────────────┘  │                                  │
│  └──────────────────────┘                                  │
└─────────────────────────────────────────────────────────────┘
```

### 6.1. Host Daemon (`jaunt serve`)

A single process that creates a cairn node and maps incoming messages to local operations:

- **Cairn node** — handles all networking. Configured via Jaunt's `[cairn]` config section, which maps directly to `CairnConfig` fields: `signal_server`, `signal_auth_token`, `turn_server`, `turn_username`, `turn_password`, `identity_seed`, `listen_addr`.
- **Connection profile generator** — builds a JSON blob containing the cairn infrastructure config + pairing data, encodes it for QR/link embedding. This is how clients discover the host's infrastructure settings.
- **Snag bridge** — receives RPC messages on the `"rpc"` cairn channel, translates them to snag operations, sends responses back.
- **PTY relay** — relays raw PTY bytes between cairn's `"pty"` channel and snag's session I/O during attach.
- **File browser** — responds to file browsing requests. Serves directory listings with hidden file toggle, file preview, and file transfer via cairn's `"file"` channel.
- **Approval handler** — when cairn reports a new pairing request, prompts the user to accept or reject.

### 6.2. Web Client

A static SPA hosted on GitHub Pages (e.g., `jaunt.app`). Uses cairn's TypeScript package (`cairn-p2p`) for all networking.

**Stack:**
- SolidJS (lightweight, reactive)
- xterm.js + xterm-addon-fit + xterm-addon-webgl (terminal emulation)
- cairn-p2p (npm package — handles pairing, transport, channels, everything)
- UnoCSS (styling)
- Vite (build)

**Pairing flow (QR code, any tier):**

```
HOST                                        BROWSER
────                                        ───────

1. jaunt serve
   Generates connection profile:
   {
     pin: "A1B2-C3D4",
     qr_data: "<cairn QR data>",
     cairn: {
       signal_server: "wss://...",    // null for Tier 0
       signal_auth_token: "...",      // null for Tier 0
       turn_server: "turn:...",       // null for Tier 0
       turn_username: "...",          // null for Tier 0
       turn_password: "..."           // null for Tier 0
     }
   }
   
   Encodes as URL: jaunt.app/#<base64>
   Renders QR code from this URL
   
   Displays:
   ┌─────────────────────────────┐
   │  Jaunt                      │
   │                             │
   │  PIN: A1B2-C3D4             │
   │                             │
   │  ██████████████████         │
   │  ██              ██  QR →   │
   │  ██  ██████████  ██  full   │
   │  ██              ██  conn.  │
   │  ██████████████████  profile│
   │                             │
   │  Waiting for client...      │
   └─────────────────────────────┘

                                    2. User scans QR
                                       Browser opens jaunt.app/#<base64>

                                    3. Web client decodes fragment:
                                       - Extracts cairn infra config
                                       - Creates cairn node with those settings
                                       - Calls node.pairScanQr(qrData)

                                    4. cairn handles SPAKE2 + Noise XX

5. Host prompts: "Authorize?"
   [Y/n]

6. User approves
   ═══════════ PAIRED ═══════════

                                    7. Client persists cairn config +
                                       identity in browser storage

                                    8. Full terminal in browser
```

**Settings panel (for PIN pairing on Tier 1+):**

The web client includes a settings screen where users can manually configure cairn infrastructure endpoints. Settings are persisted in browser storage (IndexedDB). This is only needed when PIN pairing with Tier 1+ infrastructure — QR and link pairing carry the config automatically.

### 6.3. Tauri App (Desktop & Mobile)

Same SPA as the web client, wrapped in Tauri 2.0 for native capabilities.

**Advantages over browser:**
- **cairn Rust crate** linked natively — QUIC transport, better NAT traversal than WebRTC
- **Persistent key storage** — OS keychain for cairn identity and infrastructure config
- **Native notifications** — alerts when sessions exit or new output arrives
- **Background operation** — stays connected while minimized
- **QR scanner** — native camera access, passes data to cairn

**Platforms:** Linux, macOS, Windows, Android (Tauri 2.0 mobile), iOS (Tauri 2.0 mobile).

### 6.4. CLI Client

For headless access from another terminal. Uses cairn's Rust crate directly.

```bash
jaunt connect mybox              # connect to paired host "mybox"
jaunt connect mybox sessions     # list sessions
jaunt connect mybox attach dev   # attach to session "dev"
jaunt connect mybox files ~/     # browse files
jaunt connect mybox send dev "cargo test"  # fire-and-forget command
```

CLI client config file: `~/.config/jaunt/client.toml` with its own `[cairn]` section for infrastructure endpoints.

---

## 7. Message Channels

Jaunt uses cairn's named channels to separate traffic types:

| Channel | Direction | Content | Encoding |
|---|---|---|---|
| `"rpc"` | Bidirectional | Structured commands/responses | MessagePack |
| `"pty"` | Bidirectional | Raw terminal I/O during attach | Raw bytes |
| `"file"` | Bidirectional | File transfer streaming | Raw bytes with msgpack header |

### 7.1. RPC Messages (on `"rpc"` channel)

**Client → Host:**

```
SessionList {}
SessionCreate { shell?, name?, cwd? }
SessionAttach { target }
SessionDetach {}
SessionKill { target }
SessionSend { target, input }
SessionInfo { target }
SessionRename { target, new_name }

Resize { cols, rows }

FileBrowse { path, show_hidden }
FilePreview { path, max_bytes }
FileDownload { path }
FileUpload { path, size }
FileDelete { path }
```

**Host → Client:**

```
Ok { data }
Error { code, message }
SessionEvent { event, session_id }
```

### 7.2. Snag Bridge

| Jaunt RPC | Snag operation |
|---|---|
| `SessionList` | `snag list --json` |
| `SessionCreate` | `snag new --name <n> --shell <s> --cwd <p>` |
| `SessionAttach` | Connect to snag Unix socket, attach to session |
| `SessionKill` | `snag kill <id>` |
| `SessionSend` | `snag send <id> <input>` |
| `SessionInfo` | `snag info <id> --json` |
| `SessionRename` | `snag rename <id> <n>` |

---

## 8. Device Approval

Jaunt's only trust-related responsibility is the approval UX. cairn handles key exchange, identity persistence, and session authentication.

When cairn reports a new peer pairing:
1. Host displays the device name and platform in the TUI
2. User approves or rejects
3. If approved, Jaunt stores a local record (device name, cairn peer ID, approval timestamp) for display purposes
4. Future reconnections are automatic — cairn authenticates by key, Jaunt checks the peer ID against its approval list

Device revocation: remove the peer ID from Jaunt's approval list AND call cairn's unpair API to revoke at the protocol level.

---

## 9. File Browser

### 9.1. Purpose

The file browser's primary role is **navigating the filesystem to spawn shell sessions in any directory**. Users browse to a folder and tap "open session here" — Jaunt creates a snag session with that CWD.

Secondary features: file preview (text files), download, upload, delete. File transfers use cairn's `"file"` channel for streaming.

### 9.2. Hidden Files Toggle

Directory listings always include hidden entries (names starting with `.`), each flagged with `hidden: true`. The client-side UI filters them based on a toggle. This allows instant show/hide without a network round-trip.

### 9.3. Path Security

All file operations validate the requested path against configured root directories. Canonical path resolution prevents traversal attacks. Symlinks are resolved for validation but displayed as symlinks in the UI.

---

## 10. Configuration

### 10.1. Host Configuration

File: `~/.config/jaunt/config.toml`

```toml
[server]
# Default shell for new sessions created via Jaunt
shell = "/bin/zsh"

# Auto-create a session when a client connects with no sessions running
auto_session = true

# Require interactive approval for new devices
require_approval = true

[cairn]
# All fields are optional. Omitting everything = Tier 0 (zero infra).
# These map directly to cairn's CairnConfig.

# Signaling server (Tier 1+)
# signal_server = "wss://signal.example.com"
# signal_auth_token = "your-secret-token"

# TURN relay (Tier 1+)
# turn_server = "turn:relay.example.com:3478"
# turn_username = "user"
# turn_password = "pass"

# Deterministic identity (optional — omit for random)
# identity_seed = "hex-encoded-32-bytes"

# Listen address (optional)
# listen_addr = "0.0.0.0:0"

[files]
# Enable file browser
enabled = true

# Root paths clients can access (empty = home directory)
roots = ["~"]

# Show hidden files/directories by default (client can toggle)
show_hidden = false

# Allow file upload, download, and delete (default: browse + preview only)
write = false
```

### 10.2. CLI Client Configuration

File: `~/.config/jaunt/client.toml`

```toml
[cairn]
# Must match the host's cairn infrastructure for Tier 1+.
# Not needed for Tier 0 or if pairing via QR/link (config is embedded).
# signal_server = "wss://signal.example.com"
# signal_auth_token = "your-secret-token"
# turn_server = "turn:relay.example.com:3478"
# turn_username = "user"
# turn_password = "pass"
```

### 10.3. Web Client Configuration

Stored in browser IndexedDB. Populated automatically from QR/link pairing data. Can also be manually configured via a settings panel in the UI. Persists across browser sessions.

### 10.4. Tauri App Configuration

Stored in OS keychain (cairn identity) + SQLite (paired hosts, cairn infra config per host). Populated automatically from QR/link pairing data or manually via settings.

---

## 11. User Interface

### 11.1. Host TUI

```
┌─ Jaunt ─────────────────────────────────────────┐
│                                                  │
│  Status: listening (Tier 1 · signaling + relay)  │
│  Paired devices: 2                               │
│  Connected now: iPhone Emeric                    │
│                                                  │
│  PIN: A1B2-C3D4                                  │
│  ████████████  (QR includes connection profile)  │
│  ██        ██                                    │
│  ████████████                                    │
│                                                  │
│  Sessions:                                       │
│    dev      zsh   ~/project     cargo build      │
│    ci       bash  ~/ci          idle             │
│                                                  │
│  [q]uit  [r]efresh code  [d]evices               │
└──────────────────────────────────────────────────┘
```

### 11.2. Web / Tauri Client UI

```
┌─ Jaunt ── mybox ────────────────────────────────────────┐
│                                                          │
│  ┌─ Sessions ─────────────────────────────────────────┐ │
│  │ ▸ dev      zsh   ~/project      cargo build       │ │
│  │   ci       bash  ~/ci-runner    idle              │ │
│  │   debug    zsh   ~/project      gdb               │ │
│  │                                                    │ │
│  │   [+ New session]                                  │ │
│  └────────────────────────────────────────────────────┘ │
│                                                          │
│  ┌─ Terminal (dev) ───────────────────────────────────┐ │
│  │ $ cargo build                                      │ │
│  │    Compiling jaunt v0.1.0 (/home/emeric/project)   │ │
│  │ █                                                  │ │
│  └────────────────────────────────────────────────────┘ │
│                                                          │
│  tabs: [Terminal] [Files] [Settings]                    │
│  ● Connected via cairn · 12ms · Tier 1                  │
└──────────────────────────────────────────────────────────┘
```

**Key UI features:**
- Session list with status, CWD, and foreground process
- One-tap session creation and destruction
- Full terminal emulation via xterm.js (colors, cursor, resize)
- File browser tab with directory navigation, hidden files toggle, and "open session here" action
- File preview for text files, download/upload/delete when write access is enabled
- **Settings tab** with cairn infrastructure configuration (signaling, relay) for manual Tier 1+ setup
- Connection status indicator with latency and current tier
- Touch-friendly on mobile (pinch-to-zoom, virtual keyboard aware)

---

## 12. Non-Goals

- **Shell implementation** — Jaunt does not manage PTY sessions. Snag does.
- **P2P networking** — Jaunt does not implement NAT traversal, encryption, signaling, relay, or pairing protocols. Cairn does.
- **Infrastructure deployment** — Jaunt does not deploy signaling/relay servers. Cairn provides Docker images and Cloudflare deployment guides.
- **Custom wire protocol** — Jaunt sends MessagePack over cairn channels. No custom framing.
- **Authentication server** — no accounts, no cloud, no sign-up
- **Multi-user** — one host, one user identity. Multiple devices, but they all represent the same user.
- **Port forwarding / general networking** — Jaunt exposes sessions and files, not arbitrary TCP ports
- **Code editing** — Jaunt is a terminal + file browser, not an IDE

---

## 13. Success Criteria

1. A user can go from `jaunt serve` to a working terminal on their phone in under 30 seconds on first pairing
2. Reconnection after initial pairing takes under 5 seconds (cairn automatic reconnection)
3. Terminal latency is under 50ms on the same local network, under 200ms over the internet
4. The web client works in Chrome, Firefox, and Safari on both desktop and mobile
5. File browser can navigate and preview files on the host without noticeable lag
6. Tier 0 requires zero infrastructure — no server, no account, no DNS, no port forwarding
7. Tier 1+ infrastructure config is communicated automatically via QR/link pairing — no manual client configuration needed for the common case

---

## 14. Implementation Phases

### Phase 1 — Host + CLI Client (MVP)

- `jaunt-host` daemon: cairn Rust node, snag bridge (CLI mode), device approval, config, connection profile generation
- `jaunt-client` CLI: connect, pair (PIN), list sessions, attach, send, kill, client config with `[cairn]` section
- `jaunt-protocol` shared crate: RPC message types
- Basic TUI for host status
- Tier 0 and Tier 1 support

**Deliverable:** two Linux machines can pair and share shell sessions over cairn, on any tier.

### Phase 2 — Web Client

- SolidJS SPA with xterm.js + cairn-p2p npm package
- QR code pairing with embedded connection profile (auto-configures cairn on client)
- Settings panel for manual cairn infrastructure configuration
- Session management UI
- Mobile-responsive layout
- Deploy to GitHub Pages

**Deliverable:** access your machine from any browser, including mobile, on any tier.

### Phase 3 — File Browser + Tauri App

- File browser: directory navigation, hidden files toggle, "open session here", file preview
- File transfer: download, upload, delete via cairn `"file"` channel
- Tauri 2.0 wrapper with native cairn Rust crate, keychain, QR scanner
- Per-host cairn config persistence
- Android and iOS builds

**Deliverable:** native app experience with file management, on any tier.

### Phase 4 — Polish & Hardening

- Tier 2 support (server-mode peer integration, store-and-forward, multi-device sync)
- Per-device access control profiles
- Snag Unix socket direct integration (bypass CLI)
- Comprehensive test suite across all tiers
- Documentation, landing page
- Package distribution (AUR, Homebrew, crates.io, app stores)
- Shell completions for host and client CLIs

---

## 15. Technical Stack

### Host

| Component | Technology | Purpose |
|---|---|---|
| Runtime | Rust + Tokio | Host daemon |
| P2P | cairn-p2p (Rust crate) | Everything network: pairing, transport, encryption, channels, reconnection |
| Sessions | snag (CLI / Unix socket) | PTY session management |
| Serialization | rmp-serde (MessagePack) | RPC message encoding on cairn channels |
| Config | toml | Configuration file |
| TUI | ratatui + crossterm | Host status display |
| QR | qrcode crate | Connection profile QR rendering |

### Web Client

| Component | Technology | Purpose |
|---|---|---|
| Framework | SolidJS | Reactive UI |
| Terminal | xterm.js + addons | Terminal emulation |
| P2P | cairn-p2p (npm package) | Everything network |
| State | nanostores | Minimal state management |
| Styling | UnoCSS | Atomic CSS |
| Build | Vite | Fast builds |
| Hosting | GitHub Pages | Zero-cost static hosting |
| Storage | IndexedDB | Cairn config + identity persistence |

### Tauri App

| Component | Technology | Purpose |
|---|---|---|
| Shell | Tauri 2.0 | Native wrapper |
| Frontend | Same SPA as web client | UI reuse |
| Backend | Rust (cairn-p2p crate) | Native transport |
| Storage | SQLite | Per-host config, approved devices |
| Keychain | OS keychain via Tauri plugin | cairn identity persistence |

---

## 16. Project Structure

```
jaunt/
├── Cargo.toml                    # workspace root
├── crates/
│   ├── jaunt-host/               # host daemon binary
│   │   ├── src/
│   │   │   ├── main.rs
│   │   │   ├── node.rs           # cairn node setup + event handling
│   │   │   ├── profile.rs        # connection profile generation (QR/link embedding)
│   │   │   ├── snag.rs           # snag bridge (CLI + socket)
│   │   │   ├── files.rs          # file browser
│   │   │   ├── approval.rs       # device approval logic
│   │   │   ├── config.rs         # configuration (incl. [cairn] mapping)
│   │   │   └── tui.rs            # host TUI display
│   │   └── Cargo.toml
│   ├── jaunt-client/             # CLI client binary
│   │   ├── src/
│   │   │   ├── main.rs
│   │   │   ├── commands.rs
│   │   │   └── config.rs         # client config with [cairn] section
│   │   └── Cargo.toml
│   └── jaunt-protocol/           # shared RPC types + connection profile format
│       ├── src/
│       │   ├── lib.rs
│       │   ├── messages.rs       # request/response enums
│       │   └── profile.rs        # ConnectionProfile struct (shared between host/client)
│       └── Cargo.toml
├── web/                          # SolidJS web client
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── PairingScreen.tsx  # decodes connection profile from URL fragment
│   │   │   ├── SessionList.tsx
│   │   │   ├── Terminal.tsx
│   │   │   ├── FileBrowser.tsx
│   │   │   ├── Settings.tsx       # manual cairn infra config
│   │   │   └── StatusBar.tsx
│   │   ├── lib/
│   │   │   ├── cairn.ts          # cairn-p2p wrapper, reads config from profile or settings
│   │   │   ├── profile.ts        # connection profile decode/encode
│   │   │   ├── protocol.ts       # RPC encode/decode
│   │   │   └── store.ts          # app state + IndexedDB persistence
│   │   └── index.html
│   ├── package.json
│   └── vite.config.ts
├── tauri/                        # Tauri wrapper
│   ├── src-tauri/
│   │   ├── src/
│   │   │   ├── main.rs
│   │   │   └── cairn_bridge.rs   # cairn Rust crate → Tauri IPC
│   │   ├── Cargo.toml
│   │   └── tauri.conf.json
│   └── (shares web/ frontend)
└── docs/
    ├── jaunt-prd.md
    └── jaunt-tech-spec.md
```

---

## 17. Inspirations

- **Tailscale** — the "it just works" UX for networking
- **magic-wormhole** — simple code-based pairing (cairn's pairing is similar)
- **Eternal Terminal** — resilient remote connections (cairn's auto-reconnection provides this)
- **ttyd** — terminal in a browser (but server-exposed)
- **Termius** — beautiful mobile terminal app (but SSH-only)
