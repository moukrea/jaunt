<p align="center">
  <strong>Access your machine's shell sessions from any device, anywhere, with zero infrastructure.</strong>
</p>

<p align="center">
  <a href="#installation">Installation</a> &bull;
  <a href="#quick-start">Quick Start</a> &bull;
  <a href="#web-client">Web Client</a> &bull;
  <a href="#architecture">Architecture</a> &bull;
  <a href="#commands">Commands</a> &bull;
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

---

## What is Jaunt?

Jaunt lets you access your machine's shell sessions and files from any device, anywhere, with zero infrastructure. No server to deploy, no port to forward, no VPN to configure. You run `jaunt-host serve` on your machine, scan a QR code on your phone, and you're in.

Jaunt is a thin bridge between two focused tools:
- **[cairn](https://github.com/moukrea/cairn)** handles all networking — encrypted P2P tunnels, pairing, NAT traversal, reconnection, signaling, relay
- **[snag](https://github.com/moukrea/snag)** handles all shell sessions — spawn, adopt, attach, kill, scrollback

Jaunt's sole job is to connect the two and wrap them in a frictionless experience.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        HOST MACHINE                         │
│                                                             │
│  ┌──────────────────────┐      ┌──────────────────────┐    │
│  │     jaunt-host       │      │        snag           │    │
│  │                      │      │   (PTY multiplexer)   │    │
│  │  ┌────────────────┐  │      │                       │    │
│  │  │  cairn node    │◄─┼──────┼── P2P tunnel ◄───────┼─── │ ── clients
│  │  │  (all network) │  │      │                       │    │
│  │  └────────────────┘  │      │  sessions:            │    │
│  │  ┌────────────────┐  │  ──► │  - dev (zsh)          │    │
│  │  │  snag bridge   │  │      │  - ci (bash)          │    │
│  │  └────────────────┘  │      └──────────────────────┘    │
│  │  ┌────────────────┐  │                                  │
│  │  │  file browser  │  │                                  │
│  │  └────────────────┘  │                                  │
│  └──────────────────────┘                                  │
└─────────────────────────────────────────────────────────────┘
```

## Installation

### From Source

Requires the [Rust toolchain](https://rustup.rs/) (stable).

```bash
git clone https://github.com/moukrea/jaunt.git
cd jaunt
cargo build --release
```

Binaries are at `target/release/jaunt-host` and `target/release/jaunt-client`.

### Homebrew (Linux)

```bash
brew tap moukrea/tap
brew install jaunt
```

### Debian / Ubuntu

```bash
curl -fsSL https://moukrea.github.io/apt-repo/pubkey.gpg | sudo gpg --dearmor -o /usr/share/keyrings/moukrea.gpg
echo "deb [signed-by=/usr/share/keyrings/moukrea.gpg] https://moukrea.github.io/apt-repo stable main" | \
  sudo tee /etc/apt/sources.list.d/moukrea.list
sudo apt update && sudo apt install jaunt
```

### Fedora / RHEL

```bash
sudo rpm --import https://moukrea.github.io/rpm-repo/pubkey.gpg
sudo tee /etc/yum.repos.d/moukrea.repo << 'EOF'
[moukrea]
name=moukrea Repository
baseurl=https://moukrea.github.io/rpm-repo/
gpgcheck=0
repo_gpgcheck=1
gpgkey=https://moukrea.github.io/rpm-repo/pubkey.gpg
enabled=1
EOF
sudo dnf install jaunt
```

### Arch Linux

Download the `PKGBUILD` from the [latest release](https://github.com/moukrea/jaunt/releases/latest) and build:

```bash
makepkg -si
```

### Pre-built Binaries (CLI)

Download from the [latest release](https://github.com/moukrea/jaunt/releases/latest):

| Platform | Architecture | Archive |
|----------|-------------|---------|
| Linux | x86_64 | `jaunt-<version>-linux-x86_64.tar.gz` |
| Linux | aarch64 | `jaunt-<version>-linux-aarch64.tar.gz` |

### Desktop App (Tauri)

Native desktop app with the full web UI. Download from the [latest release](https://github.com/moukrea/jaunt/releases/latest):

| Platform | Format |
|----------|--------|
| Linux | `.AppImage`, `.deb` |
| macOS | `.dmg` |
| Windows | `.msi` |

### Android App

Download the APK from the [latest release](https://github.com/moukrea/jaunt/releases/latest):

| Platform | Format |
|----------|--------|
| Android | `.apk` |

### Requirements

- Linux
- [snag](https://github.com/moukrea/snag) installed on the host machine

## Quick Start

**On your machine (host):**

```bash
jaunt-host serve
```

This displays a PIN code and QR code. Scan the QR code from a web browser or enter the PIN from the CLI client.

**From another machine (client):**

```bash
# Pair via link (from QR code URL)
jaunt-client pair link "https://jaunt.app/#..."

# Or pair via PIN
jaunt-client pair pin A1B2-C3D4 --alias mybox

# List sessions
jaunt-client connect mybox sessions

# Send a command
jaunt-client connect mybox send dev "cargo test"

# Create a new session
jaunt-client connect mybox new --name build
```

## Web Client

The web client is a SolidJS SPA hosted on GitHub Pages. No installation needed — works from any browser.

**Stack:** SolidJS + xterm.js + cairn-p2p (npm) + UnoCSS + Vite

**Features:**
- Automatic pairing via QR code URL (connection profile embedded in URL fragment)
- PIN-based manual pairing
- Full terminal emulation (xterm.js with WebGL rendering)
- File browser with hidden files toggle and "open session here"
- Session management (create, attach, kill, rename)
- Settings panel for manual cairn infrastructure configuration
- Mobile-responsive layout
- IndexedDB persistence for paired hosts and settings
- PWA support (works offline after first load)

Scan the QR code from `jaunt-host serve` or open the link — the web client extracts the connection profile from the URL fragment (never sent to any server) and connects automatically.

## Tauri App

The Tauri 2.0 app wraps the web client with native capabilities:

- **Native cairn Rust crate** — QUIC transport, better NAT traversal than WebRTC
- **OS keychain** for cairn identity persistence
- **Native notifications** for session events
- **Background operation** — stays connected while minimized
- **Cross-platform** — Linux, macOS, Windows, Android, iOS

Build: `cd tauri/src-tauri && cargo tauri build`

## Commands

### Host (`jaunt-host`)

| Command | Description |
|---------|-------------|
| `jaunt-host serve` | Start the host daemon (default) |
| `jaunt-host devices list` | List paired devices |
| `jaunt-host devices revoke <peer_id>` | Revoke a paired device |

### Client (`jaunt-client`)

| Command | Description |
|---------|-------------|
| `jaunt-client pair pin <PIN> [--alias NAME]` | Pair via PIN code |
| `jaunt-client pair link <URL> [--alias NAME]` | Pair via link with embedded profile |
| `jaunt-client connect <HOST> sessions` | List sessions on a host |
| `jaunt-client connect <HOST> attach <SESSION>` | Attach to a session |
| `jaunt-client connect <HOST> send <SESSION> <CMD>` | Send a command to a session |
| `jaunt-client connect <HOST> new [--name N]` | Create a new session |
| `jaunt-client connect <HOST> kill <SESSION>` | Kill a session |
| `jaunt-client connect <HOST> files [PATH]` | Browse files on the host |
| `jaunt-client hosts list` | List paired hosts |
| `jaunt-client hosts remove <ALIAS>` | Remove a paired host |

## Configuration

### Host (`~/.config/jaunt/config.toml`)

```toml
[server]
shell = "/bin/zsh"
auto_session = true
require_approval = true

[cairn]
# All fields optional. Omitting everything = Tier 0 (zero infra).
# signal_server = "wss://signal.example.com"
# signal_auth_token = "your-secret-token"
# turn_server = "turn:relay.example.com:3478"
# turn_username = "user"
# turn_password = "pass"

[files]
enabled = true
roots = ["~"]
show_hidden = false
write = false
```

### Client (`~/.config/jaunt/client.toml`)

```toml
[cairn]
# Default cairn config for PIN pairing on Tier 1+.
# Not needed for Tier 0 or QR/link pairing (config is embedded).
# signal_server = "wss://signal.example.com"
```

## Infrastructure Tiers

| Tier | What you need | Discovery | Best for |
|------|--------------|-----------|----------|
| **0** (default) | Nothing | 5-30s via DHT/mDNS | Same LAN, simple NATs |
| **1** | Signaling + TURN server | Sub-second | Corporate firewalls, symmetric NAT |
| **2** | + Server peer | Instant | Offline messaging, multi-device sync |

QR/link pairing embeds the infrastructure config automatically. No manual client configuration needed.

## Dependencies

- **[cairn](https://github.com/moukrea/cairn)** (Rust crate) - P2P connectivity
- **[snag](https://github.com/moukrea/snag)** (CLI binary) - PTY session management

## License

[MIT](LICENSE)
