# Remaining Issues -- Implementation Plan

**Date**: 2026-03-27
**Scope**: jaunt-host (Rust), web client (SolidJS/TS), cairn-p2p (TS npm + Rust git dep)

---

## Issue 1: Auto-Reconnect is Broken

### Root Cause Analysis

The auto-reconnect flow has **two independent bugs** that compound to make it non-functional.

**Bug A: `initNode()` generates a random identity seed every time.**

In `cairn.ts:47-48`, the `initNode()` function always generates a fresh 32-byte random seed:

```ts
const seed = crypto.getRandomValues(new Uint8Array(32));
node = await Node.createWithIdentity(config, seed);
```

Meanwhile, `tryResumeConnection()` correctly calls `initNodeWithIdentity(libp2pSeed)` with the saved seed. So the resume path itself does use the correct identity. However, the first connection via `pairFromProfile()` calls `initNode()` which generates the random seed. Then `persistSessionState()` saves `node.libp2pPrivateKeySeed` -- this works because `Node.createWithIdentity()` stores the seed. So the seed IS saved to IndexedDB correctly after the initial connection.

The real problem is more subtle:

**Bug B: The host-side cairn session is keyed by libp2p PeerId, but session state is in-memory only.**

When `tryResumeTransport()` sends a `SESSION_RESUME` message to the host, the host's cairn node needs to have the saved session state for that remote PeerId in its `_savedSessions` map. But the host's cairn node uses `StorageBackend::Filesystem` for cairn-level persistence, and the Rust cairn crate's session-save mechanism may not be wired up. More critically, even if the TS cairn Node saves sessions in `_savedSessions`, the **Rust** cairn Node's `handle_session_resume()` equivalent must also have saved the session state from the original handshake.

The flow breaks down as follows:

1. Browser connects: `connectTransport()` does Noise XX handshake. The **TS** initiator creates a session and calls `_saveSessionForResume()`. The **Rust** responder (jaunt-host) handles `HANDSHAKE_FINISH`, creates a session, and also saves session state internally.
2. Browser refreshes: `tryResumeConnection()` sends `SESSION_RESUME` to the host.
3. The **Rust** host's cairn node receives the `SESSION_RESUME` message. The protocol handler in the TS cairn code calls `_handleSessionResume()` which checks `_savedSessions.get(remotePeerIdStr)`. But the **Rust** cairn crate may not implement `_handleSessionResume` at all -- the Rust crate uses the event-based `Event::MessageReceived` API, not a protocol-level handler that intercepts handshake messages before they reach the application.

**The actual root cause**: The cairn Rust crate exposes `recv_event()` which yields `Event::MessageReceived` for all incoming messages. The Noise XX handshake and SESSION_RESUME protocol are handled **inside** the cairn crate's transport layer before events reach the application. If the Rust cairn crate does NOT implement SESSION_RESUME handling (only the TS npm package does), then the host will not know how to respond to SESSION_RESUME and will either drop the connection or send an error.

Even if SESSION_RESUME is implemented in both, there is still the question of whether the Rust host **persists** session state across process restarts. If the host daemon is restarted, all in-memory session state is lost and resume will always fail, requiring a full re-handshake (which should work as the fallback).

**Bug C: After successful resume, the web app may not navigate correctly.**

Looking at `PairingScreen.tsx:50-52`:
```ts
if (ok) {
  setPhase('done');
  store.setView('sessions');
}
```

But in `App.tsx:44`, the condition for showing `PairingScreen` is `!store.connected() && store.view() !== 'settings'`. After resume, `tryResumeConnection()` calls `store.setConnected(true)` and then `PairingScreen` sets `store.setView('sessions')`. This should work -- the connected state hides PairingScreen and the view switches to SessionList.

However, `App.tsx:14` wraps the entire connected UI (header, nav) in `<Show when={store.connected()}>`. If the resume succeeds but there is a brief moment where connected is false (e.g., transport hiccup during the handshake), the UI could flash between states.

**Summary of bugs:**
1. **Primary**: Host-side SESSION_RESUME may not be implemented in the Rust cairn crate
2. **Fallback broken**: Even the full handshake fallback may fail if the Rust cairn crate's session handling has issues
3. **UI race**: Minor -- the flow looks correct but needs verification with actual connection

### Exact Files to Modify

| File | Change |
|------|--------|
| `web/src/lib/cairn.ts` | Fix `tryResumeConnection()` to handle SESSION_EXPIRED gracefully; add logging |
| `web/src/components/PairingScreen.tsx` | Add error boundary for resume failures; show reconnecting overlay |
| Rust cairn crate (external) | Verify SESSION_RESUME handler exists; if not, implement it |
| `crates/jaunt-host/src/node.rs` | If cairn Rust does not handle SESSION_RESUME, handle it at the application layer |

### Implementation Steps

#### Step 1: Verify the Rust cairn crate's SESSION_RESUME support

Check the cairn Rust crate source (`cairn-p2p` git dependency) for:
- Does the transport layer intercept `SESSION_RESUME` messages?
- Does it save session state after handshake?
- Does it persist session state to `StorageBackend::Filesystem`?

If the Rust crate does NOT support SESSION_RESUME:

#### Step 2a: Make the full-handshake fallback robust

Since `tryResumeConnection()` already falls back to `connectTransport()` (full Noise XX), ensure this path works end-to-end:
- After the fallback handshake succeeds, the host recognizes the new PeerId (same libp2p identity seed = same PeerId)
- The host auto-approves the reconnecting peer (it already does this in `node.rs:117-123`)
- The web client navigates to sessions view

#### Step 2b: Add host-side session persistence (if Rust cairn supports SESSION_RESUME)

If the Rust cairn crate DOES support SESSION_RESUME but does not persist across restarts:
- After each successful handshake, save session state to `~/.config/jaunt/cairn-data/sessions/`
- On startup, restore saved session states into the cairn node

#### Step 3: Improve the resume flow in cairn.ts

```ts
// In tryResumeConnection():
// 1. Always try resume first (if we have ratchet state)
// 2. On SESSION_EXPIRED or any resume failure, clear saved ratchet state but keep identity
// 3. Fall back to full handshake with the SAME identity (same PeerId)
// 4. On full handshake success, save new session state
// 5. On total failure, clear everything and show pairing screen
```

#### Step 4: Add reconnecting overlay in App.tsx

Instead of showing PairingScreen briefly during reconnection, show a dedicated "Reconnecting to <hostname>..." overlay:
- Use the `store.reconnecting()` signal (already exists)
- Show a minimal overlay with spinner and host name
- If resume fails, transition to PairingScreen with an explanation

### Test Plan

1. **Unit test**: Mock cairn Node to verify `tryResumeConnection()` flow:
   - Happy path: resume succeeds, returns true
   - Resume fails, fallback succeeds, returns true
   - Both fail, returns false
2. **Integration test**:
   - Start jaunt-host, connect from browser, note the saved connection in IndexedDB
   - Refresh the browser page
   - Verify the connection is restored (either via resume or fallback)
   - Verify the sessions view loads
3. **Playwright test**:
   - `auto-reconnect.spec.ts`: Connect, reload page, assert sessions view appears within 5 seconds

### Dependencies

- Depends on cairn Rust crate's SESSION_RESUME status (external dependency)
- No dependency on other issues

---

## Issue 2: PIN Code Pairing Doesn't Work

### Root Cause Analysis

The PIN pairing flow is explicitly broken by design. In `PairingScreen.tsx:134-135`:

```ts
setPhase('error');
setErrorMsg('PIN pairing requires the full URL from jaunt-host. Copy the URL shown by the host and open it in your browser instead.');
```

The `handlePinPair()` function calls `pairEnterPin()` on the cairn node, which succeeds (it just does a local SPAKE2 exchange and generates a random remote peer ID), but then hardcodes an error message. The underlying problem is fundamental: **a PIN alone does not contain enough information to locate the host on the network**.

The cairn TS `pairEnterPin()` method (node.ts:842-851) does:
1. Normalize and validate the PIN
2. Run a local SPAKE2 exchange (against itself -- this is a stub)
3. Generate a random peer ID (not the actual host's peer ID)
4. Mark that random ID as "paired"

This is completely non-functional for actual network connectivity because:
- The browser does not know the host's libp2p PeerId
- The browser does not know the host's listen addresses (multiaddrs)
- There is no rendezvous/discovery mechanism to find the host by PIN

The host side (`profile.rs:39-70`) generates a PIN profile that includes the PIN, listen addresses, libp2p_peer_id, and all infrastructure config. But this profile is never transmitted to the browser -- only the PIN string is shown to the user.

### Solution Design

**Option chosen: PIN encodes a lookup into the connection profile.**

The PIN alone cannot encode all the information needed (PeerId, addresses, TURN config). But we can make the PIN work as a short code that maps to the full profile through one of these mechanisms:

**Approach A (LAN-only, Tier 0): mDNS discovery + PIN as authentication**
1. Host advertises itself via mDNS with a service name derived from the PIN (e.g., `_jaunt._tcp` with TXT record containing a hash of the PIN)
2. Browser discovers the host via mDNS
3. PIN is used as the PAKE password for mutual authentication
4. Problem: browsers cannot do mDNS. This only works for native clients.

**Approach B (Works in browser): PIN + host address display**
1. Host shows: `PIN: A1B2-C3D4` and below it `Address: 192.168.1.100:35775`
2. User enters both PIN and address in the web UI
3. Browser dials the address, uses the PIN for PAKE authentication
4. Pro: Works without any infrastructure. Con: User has to enter more info.

**Approach C (Cleanest UX): PIN maps to a pre-shared URL on the same LAN**
1. Host runs a tiny HTTP server on a well-known port (e.g., 9867)
2. User enters just the PIN
3. Browser broadcasts/probes common LAN addresses for the HTTP server
4. When found, browser GETs `http://<addr>:9867/pair?pin=<PIN>`
5. Server returns the full connection profile if PIN matches
6. Pro: Clean UX. Con: Requires port scanning or broadcast which browsers can't do efficiently.

**Approach D (Recommended): QR/URL for initial pairing, PIN for re-pairing after identity change**
Accept that PIN-only pairing from a browser is not feasible without infrastructure. Instead:
1. **First pairing**: Always use the URL (click/paste) or QR code (scan with phone camera)
2. **Re-pairing after host key rotation**: Use PIN + the previously-known host address
3. The PIN entry field on PairingScreen becomes: "Have a PIN? Enter it along with the host address"

**Approach E (With Tier 1 infrastructure): PIN rendezvous via signaling server**
1. Host registers its connection profile with the signaling server under a key derived from the PIN
2. Browser derives the same key from the PIN, queries the signaling server
3. Server returns the full profile
4. Pro: Clean UX, works over internet. Con: Requires infrastructure (Tier 1).

### Recommended Implementation: Approach B + E

For Tier 0: Show PIN and address together, user enters both.
For Tier 1: PIN lookups via signaling server.

### Exact Files to Modify

| File | Change |
|------|--------|
| `web/src/components/PairingScreen.tsx` | Replace PIN-only input with PIN+Address or PIN-only (Tier 1) |
| `web/src/lib/cairn.ts` | Add `pairWithPinAndAddress()` function |
| `web/src/lib/profile.ts` | Add helper to construct profile from PIN + address |
| `crates/jaunt-host/src/node.rs` | Optionally: add HTTP pairing endpoint on well-known port |
| `crates/jaunt-host/src/profile.rs` | Show address alongside PIN in output |
| `crates/jaunt-host/src/main.rs` | Format PIN display to include address |

### Implementation Steps

#### Step 1: Update jaunt-host PIN display to include address

In `node.rs:84`, the host prints the PIN. Also print the host's primary LAN address:

```
  PIN:     A1B2-C3D4
  Address: 192.168.1.100:35775
  URL:     https://moukrea.github.io/jaunt/#<base64>
```

The address is extracted from `ws_addrs` -- pick the first /ws multiaddr and convert to `host:port`.

#### Step 2: Add a pairing HTTP endpoint to jaunt-host (optional, Tier 0 enhancement)

Add a tiny HTTP server on port 9867 that responds to `GET /pair?pin=<PIN>`:
- If PIN matches the current pairing session's PIN: return the full ConnectionProfile as JSON
- If PIN does not match: return 403
- This allows the browser to fetch the full profile by just knowing the PIN + host IP

This is optional but dramatically improves PIN UX on LAN.

#### Step 3: Update PairingScreen to support PIN + Address

Add a second input field below the PIN field for the host address. When both are filled:
1. Construct a ConnectionProfile from the address (synthesize multiaddr)
2. Call `initNode()` without a profile (no infrastructure)
3. Call `connectToHost(peerId, [multiaddr])` -- but we do not know the PeerId yet

This reveals the deeper problem: without the PeerId, we cannot do a Noise XX handshake. The PIN must be the authentication mechanism.

**Revised approach**: Use the optional HTTP endpoint (Step 2):
1. User enters PIN and host address (or just the host IP if on LAN)
2. Browser fetches `http://<address>:9867/pair?pin=<PIN>`
3. Server returns full ConnectionProfile (including PeerId, multiaddrs, infra config)
4. Browser proceeds with `pairFromProfile()` using the full profile

If the HTTP endpoint is unavailable, show "Use the full URL from jaunt-host instead."

#### Step 4: Signaling server PIN rendezvous (Tier 1, future)

When a signaling server is configured:
1. Host registers profile under HKDF-SHA256(PIN, "cairn-pin-rendezvous-v1")
2. Browser derives same key, queries signaling server
3. Server returns profile
4. This is a cairn-level feature and requires changes to both the Rust and TS cairn crates

### Test Plan

1. **Unit test**: Verify PIN normalization (already tested in cairn-p2p)
2. **Integration test (Tier 0 HTTP endpoint)**:
   - Start jaunt-host
   - Curl `http://localhost:9867/pair?pin=<correct-pin>` -- expect 200 with profile
   - Curl `http://localhost:9867/pair?pin=WRONG` -- expect 403
3. **Playwright test**:
   - `pin-pairing.spec.ts`: Enter correct PIN + address, verify connection
   - `pin-pairing-wrong.spec.ts`: Enter wrong PIN, verify error message

### Dependencies

- No blocking dependencies on other issues
- Tier 1 signaling server rendezvous is a future enhancement (depends on Issue 4)

---

## Issue 3: jaunt-host as a Daemon with Proper Pairing Flow

### Root Cause Analysis

Currently `jaunt-host serve` is the only mode. It:
1. Starts the cairn node and transport
2. Generates a fresh QR+PIN profile every time
3. Prints the PIN and URL to stderr
4. Enters an event loop
5. Auto-approves every connecting peer

This is fine for development but not for production:
- No way to run as a background daemon
- No way to control pairing separately from the daemon lifecycle
- No interactive confirmation before approving a device
- Re-running `serve` generates new pairing credentials, breaking any bookmarked URLs
- No way to see status or manage paired devices without killing the process

### Exact Files to Modify

| File | Change |
|------|--------|
| `crates/jaunt-host/src/main.rs` | Add `daemon`, `pair`, `status`, `unpair` subcommands |
| `crates/jaunt-host/src/node.rs` | Extract daemon logic; add IPC between daemon and pair command |
| `crates/jaunt-host/src/daemon.rs` | New: daemon mode with socket-based IPC |
| `crates/jaunt-host/src/pair.rs` | New: interactive pairing command |
| `crates/jaunt-host/src/ipc.rs` | New: IPC protocol between daemon and CLI commands |
| `crates/jaunt-host/src/approval.rs` | Add pending-approval state; interactive confirm/deny |
| `crates/jaunt-host/src/config.rs` | Add daemon-specific config (pid file path, socket path) |

### Implementation Steps

#### Step 1: Define the IPC protocol

The daemon runs as a long-lived background process. CLI commands communicate with it via a Unix socket at `~/.config/jaunt/jaunt.sock`.

IPC messages (JSON over length-prefixed frames):

```
// Request
{ "type": "status" }
{ "type": "generate_pairing", "timeout_secs": 300 }
{ "type": "approve_peer", "peer_id": "...", "name": "..." }
{ "type": "deny_peer", "peer_id": "..." }
{ "type": "unpair", "peer_id": "..." }

// Response
{ "type": "status_response", "state": "running", "peers": [...], "listen_addrs": [...] }
{ "type": "pairing_generated", "pin": "A1B2-C3D4", "url": "...", "qr_data": "..." }
{ "type": "peer_connecting", "peer_id": "...", "libp2p_peer_id": "..." }
{ "type": "peer_approved", "peer_id": "..." }
{ "type": "peer_denied", "peer_id": "..." }
{ "type": "error", "message": "..." }
```

#### Step 2: Implement `jaunt-host daemon`

```rust
#[derive(Subcommand)]
enum Command {
    /// Start the host daemon (foreground, for systemd/launchd)
    Daemon,
    /// Start and pair in one shot (current `serve` behavior, for quick testing)
    Serve,
    /// Generate a pairing profile and wait for a peer
    Pair {
        #[arg(long, default_value = "300")]
        timeout: u64,
    },
    /// Show daemon status
    Status,
    /// Unpair a device
    Unpair { peer_id: String },
    /// List paired devices
    Devices { #[command(subcommand)] action: DeviceAction },
}
```

The daemon:
1. Starts the cairn node and transport
2. Loads approved devices from `devices.json`
3. Listens on the IPC socket for commands
4. Accepts connections ONLY from approved devices
5. Does NOT generate pairing profiles or print URLs
6. Writes its PID to `~/.config/jaunt/jaunt.pid`

#### Step 3: Implement `jaunt-host pair`

The pair command:
1. Connects to the daemon via IPC
2. Sends `generate_pairing` request
3. Daemon generates a fresh pairing profile (QR + PIN + URL)
4. Daemon returns the profile to the pair command
5. Pair command displays: PIN, URL, and QR code in the terminal
6. Pair command enters a wait loop, receiving events from the daemon
7. When a peer connects using that pairing profile, daemon sends `peer_connecting`
8. Pair command shows: "Device 'Chrome on Pixel 7' (PeerId: 12D3K...) wants to connect. Approve? [Y/n]"
9. User types Y: pair command sends `approve_peer`, daemon saves to devices.json
10. User types N: pair command sends `deny_peer`, daemon drops the connection

#### Step 4: Implement `jaunt-host status`

Connects to daemon via IPC, sends `status`, displays:
```
jaunt-host daemon
  Status:    running (pid 12345)
  Uptime:    2h 15m
  Listen:    /ip4/192.168.1.100/tcp/35775/ws
  Tier:      Tier 0
  Devices:   2 paired, 1 connected
    - Chrome on Pixel 7  (12D3KooW...) [connected]
    - Firefox on MacBook  (12D3KooW...) [offline]
```

#### Step 5: Implement `jaunt-host unpair`

Connects to daemon, sends `unpair` with peer_id, daemon removes from devices.json and drops any active session.

#### Step 6: Keep `jaunt-host serve` as a convenience alias

`serve` combines daemon + pair in one shot (current behavior):
1. Starts the node inline (not as a separate daemon process)
2. Generates and displays pairing info
3. Auto-approves all connections (development mode)

This preserves backward compatibility for quick testing.

### Test Plan

1. **Unit test**: IPC message serialization/deserialization
2. **Integration test**:
   - Start `jaunt-host daemon` in background
   - Run `jaunt-host status` -- verify output
   - Run `jaunt-host pair` -- verify PIN and URL are displayed
   - Connect from browser -- verify peer_connecting event
   - Approve -- verify connection works
   - Run `jaunt-host unpair <id>` -- verify device removed
3. **Playwright test**:
   - `daemon-pairing.spec.ts`: Start daemon, run pair, connect from browser with URL, verify sessions load

### Dependencies

- No blocking dependencies on other issues
- The IPC socket protocol design should be done before implementation

---

## Issue 4: Tier 0 Internet Connectivity (NAT Traversal)

### Root Cause Analysis

Currently jaunt only works on the same LAN because:
1. The host listens on local TCP/QUIC/WS addresses (e.g., `/ip4/192.168.1.100/tcp/35775/ws`)
2. The connection profile contains these local addresses
3. The browser dials these addresses directly
4. When the browser is on a different network, these local addresses are unreachable

For internet connectivity, we need NAT traversal. The cairn TS package already has the building blocks (STUN detection, fallback chain, circuit relay types), but nothing is wired up at the transport layer.

### What Exists Today

**cairn-p2p (TS npm)**:
- `config.ts`: `stunServers`, `bootstrapNodes`, `transportPreferences` fields exist
- `DEFAULT_STUN_SERVERS`: Google and Cloudflare STUN servers are configured
- `fallback.ts`: 9-level transport fallback chain is implemented
- `nat.ts`: NAT detection types exist
- `transport/libp2p-node.ts`: Creates a libp2p node but only with WebSocket transport

**cairn-p2p (Rust crate)**:
- Has STUN support for NAT detection
- Uses libp2p with QUIC, TCP, and WS transports
- Unknown: does it configure AutoNAT, Identify, or Circuit Relay?

**libp2p ecosystem**:
- libp2p has built-in support for all required protocols
- IPFS provides public bootstrap nodes and circuit relay servers
- The `@libp2p/circuit-relay-v2` package exists for browser

### Implementation Steps

This is the most complex issue and should be broken into phases.

#### Phase 1: Public Address Discovery (STUN + Identify)

**Rust cairn crate changes:**
1. Enable the libp2p `Identify` protocol in the swarm. This allows peers to learn their observed external address.
2. Enable `AutoNAT` in the swarm. This detects the NAT type by asking other peers to dial back.
3. Include observed external addresses in the connection profile's `ws_addrs` field.

**jaunt-host changes:**
1. After starting the cairn node, wait briefly for address discovery
2. Include both local and observed external addresses in the profile
3. Print the public address (if discovered) in the status output

**No web changes needed for this phase.**

#### Phase 2: DHT Bootstrap Nodes

**Rust cairn crate changes:**
1. Add libp2p Kademlia DHT to the swarm
2. Connect to public bootstrap nodes on startup (IPFS bootstrap nodes or self-hosted)
3. Register the host's PeerId + addresses in the DHT

**cairn-p2p (TS) changes:**
1. When starting transport in browser, connect to the same bootstrap nodes
2. Before dialing the host, look up the host's addresses in the DHT

**jaunt-host changes:**
1. Pass bootstrap node addresses to cairn config

**Config:**
```toml
[cairn]
bootstrap_nodes = [
  "/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7...",
  "/ip4/104.131.131.82/tcp/4001/p2p/QmaCpDM..."
]
```

#### Phase 3: Circuit Relay

When direct connections fail (symmetric NAT on both sides):

**Rust cairn crate changes:**
1. Enable circuit relay v2 client in the swarm
2. Register as a relay reservation on available relay nodes
3. Include relay addresses in the connection profile

**cairn-p2p (TS) changes:**
1. Enable circuit relay v2 client in the browser libp2p node
2. When direct dial fails, attempt to connect via relay

**Connection profile changes:**
The profile should include relay addresses alongside direct addresses:
```json
{
  "ws_addrs": [
    "/ip4/192.168.1.100/tcp/35775/ws",
    "/ip4/relay.example.com/tcp/443/ws/p2p/QmRelay.../p2p-circuit/p2p/QmHost..."
  ]
}
```

#### Phase 4: Browser WebRTC (future, Tier 0+)

For browser-to-host over internet without relay infrastructure:

1. libp2p supports WebRTC for browser-to-server connections
2. STUN servers (already configured) enable ICE negotiation
3. This requires the host to support WebRTC as well (libp2p-webrtc on the Rust side)

This is a longer-term enhancement.

### Exact Files to Modify

| File | Change |
|------|--------|
| Rust cairn crate | Enable Identify, AutoNAT, Kademlia, Circuit Relay in swarm |
| `crates/jaunt-host/src/config.rs` | Add `bootstrap_nodes` field |
| `crates/jaunt-host/src/node.rs` | Pass bootstrap nodes to cairn config; wait for address discovery |
| `crates/jaunt-host/src/profile.rs` | Include external addresses in profile |
| `web/node_modules/cairn-p2p/src/transport/libp2p-node.ts` | Add circuit relay, identify to browser libp2p node |
| `web/src/lib/cairn.ts` | Pass bootstrap nodes to cairn config from profile |
| `web/src/lib/profile.ts` | Add `bootstrap_nodes` field to ConnectionProfile |
| `crates/jaunt-protocol/src/profile.rs` | Add `bootstrap_nodes` field to ConnectionProfile |

### Test Plan

1. **Phase 1 test**: Start jaunt-host behind a NAT. Verify the profile includes the public IP.
2. **Phase 2 test**: Start jaunt-host, verify it registers in the DHT. From another machine, look up the PeerId in the DHT.
3. **Phase 3 test**: Start jaunt-host behind symmetric NAT. Connect from browser on different network. Verify circuit relay is used.
4. **Note**: Internet connectivity is inherently hard to test locally. Use Docker containers with network namespaces to simulate NAT:
   - Container A: jaunt-host (behind simulated NAT)
   - Container B: browser (behind different simulated NAT)
   - Container C: relay/bootstrap node (public)

### Dependencies

- **Phase 1**: No dependencies on other issues
- **Phase 2**: Requires running or specifying bootstrap nodes (infrastructure decision)
- **Phase 3**: Requires Phase 2 (DHT for discovering relay nodes)
- **Phase 4**: No dependencies but is lowest priority

---

## Issue 5: Testing Strategy

### Current State

There are **zero tests** in the jaunt web app:
- No Playwright config file exists
- No `.spec.ts` or `.test.ts` files in `web/`
- Playwright is installed as a dependency (`node_modules/playwright` exists)
- No vitest or jest config for unit tests

The Rust crates have some tests in `config.rs` but nothing for the node or RPC logic.

### Test Infrastructure Setup

#### Step 1: Playwright Configuration

Create `web/playwright.config.ts`:
```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://localhost:3000',
  },
  webServer: {
    command: 'pnpm dev',
    port: 3000,
    reuseExistingServer: true,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
```

#### Step 2: Test Harness for jaunt-host

Create a test harness that:
1. Starts `jaunt-host serve` as a child process
2. Captures the PIN and URL from stderr
3. Exposes them to Playwright tests
4. Kills the process after the test

```ts
// web/e2e/fixtures.ts
import { test as base } from '@playwright/test';
import { spawn } from 'child_process';

export const test = base.extend<{ hostUrl: string; hostPin: string }>({
  hostUrl: async ({}, use) => {
    // Start jaunt-host, parse URL from output, provide to test
  },
  hostPin: async ({}, use) => {
    // Parse PIN from jaunt-host output
  },
});
```

#### Step 3: Test Specs

**e2e/url-pairing.spec.ts** (validates Issue 1 fix + basic connectivity):
```
1. Start jaunt-host serve
2. Navigate to the URL from jaunt-host output
3. Wait for "Sessions" view to appear
4. Assert the sessions list loads (may be empty)
5. Create a new session
6. Assert the terminal view opens
```

**e2e/auto-reconnect.spec.ts** (validates Issue 1):
```
1. Start jaunt-host serve
2. Navigate to the URL, wait for connection
3. Reload the page
4. Wait for reconnection (either resume or full handshake)
5. Assert the sessions view appears within 10 seconds
6. Verify previously created session is still listed
```

**e2e/pin-pairing.spec.ts** (validates Issue 2):
```
1. Start jaunt-host serve
2. Navigate to the web app (no URL fragment)
3. Enter the PIN (and address if Tier 0)
4. Assert connection succeeds
5. Assert sessions view appears
```

**e2e/disconnect-handling.spec.ts**:
```
1. Connect to jaunt-host
2. Kill jaunt-host process
3. Assert "disconnected" state is shown
4. Restart jaunt-host (new instance)
5. Assert reconnection attempt occurs
```

#### Step 4: Rust Integration Tests

Add integration tests for `jaunt-host`:
- `tests/rpc_test.rs`: Start the node, connect a mock client, send RPC requests, verify responses
- `tests/approval_test.rs`: Verify device approval/revocation flow

### Implementation Order

Tests should be written alongside the fixes they validate:

1. **First**: Set up Playwright config + test harness (no tests yet)
2. **With Issue 1 fix**: Write `url-pairing.spec.ts` and `auto-reconnect.spec.ts`
3. **With Issue 2 fix**: Write `pin-pairing.spec.ts`
4. **With Issue 3 fix**: Write `daemon-pairing.spec.ts`
5. **With Issue 4 fix**: Write `nat-traversal.spec.ts` (Docker-based)

---

## Implementation Priority and Dependency Graph

```
Issue 5 (Test infra)  <-- Set up first, used by all others
      |
      v
Issue 1 (Auto-reconnect)  <-- Highest user-facing impact
      |
      v
Issue 2 (PIN pairing)     <-- Second highest UX impact
      |
      v
Issue 3 (Daemon mode)     <-- Operational concern
      |
      v
Issue 4 (NAT traversal)   <-- Largest scope, lowest urgency
```

### Recommended order of work:

1. **Test infrastructure** (0.5 day): Playwright config, test harness, first smoke test
2. **Auto-reconnect** (1-2 days): Debug the exact failure, fix the resume or fallback path, write tests
3. **PIN pairing with HTTP endpoint** (1-2 days): Add pairing HTTP server to jaunt-host, update PairingScreen, write tests
4. **Daemon mode** (2-3 days): IPC protocol, daemon/pair/status commands, write tests
5. **NAT traversal Phase 1** (1-2 days): STUN + Identify for public address discovery
6. **NAT traversal Phase 2-3** (3-5 days): DHT + Circuit Relay (requires cairn crate changes)

### Risk Assessment

| Issue | Risk | Mitigation |
|-------|------|------------|
| 1 (Auto-reconnect) | Rust cairn crate may not support SESSION_RESUME | Full handshake fallback is sufficient for now |
| 2 (PIN pairing) | HTTP endpoint on well-known port may conflict | Make port configurable; use random port with mDNS |
| 3 (Daemon mode) | IPC complexity | Keep protocol simple (JSON over Unix socket) |
| 4 (NAT traversal) | Depends on external infrastructure (bootstrap nodes, relays) | Phase 1 (STUN/Identify) works without infrastructure |
| 5 (Testing) | jaunt-host requires snag daemon running | Mock snag in test fixtures or require it as prerequisite |
