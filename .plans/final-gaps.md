# Final Gaps Assessment and Implementation Plan

**Date**: 2026-03-27
**Scope**: jaunt ecosystem -- jaunt-host (Rust), web client (SolidJS/TS), cairn-p2p (Rust + TS), Tauri desktop/mobile

---

## Executive Summary

Five gaps remain between "works on LAN demo" and "production-quality remote access product". They range from critical architectural work (browser-over-internet connectivity) to straightforward build pipeline fixes (GitHub Pages deployment). This plan assesses each honestly, estimates effort, and provides an implementation order that maximizes value delivered at each stage.

**Total estimated effort**: 12-18 developer-days across all gaps.

---

## Gap 1: Browser Over Internet (4G -> GitHub Pages -> Host Behind NAT)

### Current State: RED -- not functional

**What the Rust cairn crate has (fully implemented):**
- Identify protocol -- peers exchange observed addresses on connect
- AutoNAT -- probes whether the node is publicly reachable
- Kademlia DHT with IPFS bootstrap nodes (`DEFAULT_BOOTSTRAP_NODES` in `swarm.rs:466-471`)
- Circuit Relay v2 client -- connecting through relay nodes
- DCUtR -- hole punching to upgrade relayed connections to direct
- UPnP -- automatic port mapping on supported routers
- TCP, QUIC, WebSocket, DNS transports composed via `SwarmBuilder`

All of these are composed into `CairnBehaviour` in `/home/emeric/code/cairn/packages/rs/cairn-p2p/src/transport/swarm.rs:442-452`. The Rust side is feature-complete for NAT traversal.

**What the TS browser cairn library has:**
- WebSocket transport only (line 115-119 of `libp2p-node.ts`)
- No Identify protocol
- No Circuit Relay v2 client
- No Kademlia DHT
- No WebRTC
- No connection to bootstrap nodes
- The comment at line 112-114 explicitly says: "WebRTC and WebTransport are omitted: WebRTC requires the identify service and additional config"

**What the npm dependencies provide:**
The `cairn-p2p` package.json already lists all required dependencies:
- `@libp2p/circuit-relay-v2: ^2.0.0`
- `@libp2p/kad-dht: ^13.0.0`
- `@libp2p/webrtc: ^5.0.0`
- `@libp2p/websockets: ^9.0.0`
- `@libp2p/webtransport: ^5.0.0`

These are listed as dependencies but **none are used in the browser code path** of `createCairnNode()`.

### The Connection Path (What Needs to Work)

```
Phone on 4G
    |
    | HTTPS (static files)
    v
GitHub Pages  (serves SolidJS app + cairn-p2p browser bundle)
    |
    | Browser creates cairn node
    v
Browser cairn node
    |
    | 1. Try direct WebSocket to host /ws address
    |    FAILS: home NAT blocks incoming connections
    |
    | 2. Connect to DHT bootstrap nodes (IPFS public nodes)
    |    SUCCEEDS: bootstrap nodes are publicly reachable over WS
    |
    | 3. Look up host PeerId in DHT
    |    SUCCEEDS: host registered itself when it started
    |
    | 4. Connect to host through circuit relay
    |    SUCCEEDS: relay node forwards traffic
    |
    | 5. DCUtR attempts hole punch for direct connection
    |    MAY SUCCEED: depends on NAT type
    v
Host behind home NAT (running jaunt-host with full Rust cairn)
```

### What Must Change in cairn-p2p TS (browser path)

**File: `/home/emeric/code/cairn/packages/ts/cairn-p2p/src/transport/libp2p-node.ts`**

The `createCairnNode()` browser branch (lines 109-120) must be expanded to include:

1. **Identify service** -- required by WebRTC and circuit relay
2. **Circuit Relay v2 transport** -- so `/p2p-circuit` addresses can be dialed
3. **Kademlia DHT** -- for finding the host's relay address via bootstrap nodes
4. **Bootstrap node connection** -- connect to IPFS public bootstrap nodes on startup

```typescript
// Current browser code (line 109-120):
} else {
    if (config.websocketEnabled) {
      const { webSockets } = await import('@libp2p/websockets');
      const { all } = await import('@libp2p/websockets/filters');
      transports.push(webSockets({ filter: all }));
    }
}

// Needs to become:
} else {
    if (config.websocketEnabled) {
      const { webSockets } = await import('@libp2p/websockets');
      const { all } = await import('@libp2p/websockets/filters');
      transports.push(webSockets({ filter: all }));
    }
    // WebRTC for browser-to-server direct connections
    if (config.webrtcEnabled) {
      const { webRTC } = await import('@libp2p/webrtc');
      transports.push(webRTC());
    }
}
```

And the `createLibp2p()` call (lines 138-152) must add services:

```typescript
const node = await createLibp2p({
    ...(privateKey ? { privateKey } : {}),
    addresses: { listen: listenAddrs },
    transports: transports as any[],
    streamMuxers: [yamux()],
    connectionEncrypters: [noise()],
    services: {
      identify: identify(),                    // NEW
      circuitRelayTransport: circuitRelayTransport(), // NEW
      kadDHT: kadDHT({ /* bootstrap peers */ }),      // NEW
    },
    // ...
});
```

### Additional Changes Required

**File: `/home/emeric/code/cairn/packages/ts/cairn-p2p/src/transport/libp2p-node.ts`**
- Add `services` to the `createLibp2p()` config with identify, circuit relay transport, and kadDHT
- Add bootstrap peer addresses (same IPFS nodes the Rust crate uses)
- Browser listen addresses should include WebRTC for relay-upgraded connections

**File: `/home/emeric/code/cairn/packages/ts/cairn-p2p/src/node.ts`**
- `startTransport()` should connect to bootstrap nodes after starting
- May need to wait for identify to complete before returning (so listen addrs are populated)

**File: `/home/emeric/code/jaunt/web/src/lib/profile.ts`**
- `ConnectionProfile` should carry `bootstrap_nodes?: string[]`
- `getWsMultiaddrs()` should also return `/p2p-circuit` addresses (relay paths)

**File: `/home/emeric/code/jaunt/web/src/lib/cairn.ts`**
- `connectToHost()` should pass bootstrap nodes from profile to cairn config
- Add fallback: if direct dial fails, attempt DHT lookup and relay connection

**File: `/home/emeric/code/jaunt/crates/jaunt-host/src/node.rs`**
- After starting, wait for address discovery (Identify/AutoNAT)
- Include both local and public/relay addresses in connection profile
- Register the host's PeerId+addresses in DHT periodically

**File: `/home/emeric/code/jaunt/crates/jaunt-protocol/src/profile.rs`**
- Add `bootstrap_nodes` and `relay_addrs` to `ConnectionProfile`

### npm Packages Needed

All are already in `cairn-p2p`'s package.json dependencies (installed but unused):
- `@libp2p/circuit-relay-v2` -- already listed
- `@libp2p/kad-dht` -- already listed
- `@libp2p/webrtc` -- already listed

Additional packages needed for browser services:
- `@libp2p/identify` -- **NOT in dependencies, must be added** (peer address exchange)
- `@libp2p/bootstrap` -- **NOT in dependencies, must be added** (auto-connect to bootstrap peers)

### Blockers

1. **cairn-p2p npm publish cycle**: Changes to the TS library must be published to npm before the web client CI can use them (unless we switch web's dependency from `file:` to the git repo)
2. **No relay infrastructure**: The IPFS public relay nodes have capacity limits and may not be reliable. For production, self-hosted relay nodes are recommended.
3. **WebRTC browser-to-Rust compatibility**: libp2p-webrtc in the browser needs the Rust host to also support WebRTC signaling. The Rust crate does NOT currently include the `webrtc` feature. This means WebRTC is only useful for browser-to-browser, not browser-to-Rust-host.

### Effort Estimate: LARGE (5-7 days)

- Phase 1 (Identify + Circuit Relay in browser): 2 days
- Phase 2 (DHT bootstrap + relay address in profile): 2 days
- Phase 3 (Integration testing with simulated NAT): 1-2 days
- Phase 4 (WebRTC, optional): 1 day

---

## Gap 2: Tauri Desktop/Mobile Clients

### Current State: YELLOW -- scaffolded but hollow

**What exists today:**

The Tauri project is scaffolded at `/home/emeric/code/jaunt/tauri/src-tauri/` with:

- `tauri.conf.json` -- window config, points frontend to `../../web/dist`
- `Cargo.toml` -- depends on `tauri 2`, `cairn-p2p` (git), `jaunt-protocol` (path)
- `src/lib.rs` -- 7 Tauri commands defined: `pair_with_pin`, `pair_with_link`, `get_sessions`, `send_command`, `create_session`, `kill_session`, `is_connected`
- `src/cairn_bridge.rs` -- Rust implementation of the cairn integration
- `src/main.rs` -- entry point calling `run()`

**The CI/CD pipeline is complete:**

`/home/emeric/code/jaunt/.github/workflows/tauri-release.yml` builds for:
- Linux x86_64 and aarch64 (deb, AppImage, rpm)
- macOS x86_64 and aarch64 (dmg)
- Windows x86_64 (msi, exe)
- Android (APK via `cargo tauri android build`)
- Publishes to APT repo, RPM repo, Homebrew tap

### Architectural Assessment

The architecture is correct in principle:

```
+------------------------------------------+
|  Tauri App                               |
|  +------------------------------------+  |
|  | SolidJS Frontend (webview)         |  |
|  | Same code as web client            |  |
|  | Uses @tauri-apps/api for IPC       |  |
|  +------------------------------------+  |
|               |  IPC (invoke)            |
|  +------------------------------------+  |
|  | Rust Backend                       |  |
|  | cairn-p2p Rust crate (DIRECT)      |  |
|  | Full NAT traversal, QUIC, TCP, WS  |  |
|  | Circuit Relay, DCUtR, mDNS, DHT    |  |
|  +------------------------------------+  |
+------------------------------------------+
```

The key advantage: the Tauri backend uses the **Rust** cairn crate directly, not the TS library. This means it gets all transport capabilities the Rust crate has -- QUIC, TCP, circuit relay, DCUtR, UPnP, Kademlia DHT -- without any of the browser transport limitations.

### What's Broken

1. **`cairn_bridge.rs` creates a new Node per function call.** Every `get_sessions()`, `send_command()`, `create_session()`, `kill_session()` call creates a fresh node with `create_node()` (line 162-164). This means no persistent connection, no session reuse, and massive overhead.

2. **No persistent cairn node or session state.** The `AppState` struct only holds `connected: bool`, `host_name: String`, `peer_id: String`. There is no reference to a cairn Node or Session. The actual Node must be held in an `Arc<Mutex<Option<Node>>>` across Tauri command invocations.

3. **`cairn_bridge::pair_pin()` and `pair_link()` do not start transport.** They create a node and call `pair_enter_pin()` / `pair_scan_qr()`, but these are the cairn-level pairing methods, not the transport-level connection. After pairing, the code must call `node.start_transport()` and `node.connect_transport()` to establish the libp2p connection.

4. **No PTY streaming over IPC.** The Tauri commands are request-response only. For terminal streaming, the frontend needs a streaming channel. Tauri v2 provides `tauri::ipc::Channel` for this, or the frontend can use `EventTarget` with Tauri events.

5. **The frontend (SolidJS web app) currently uses cairn-p2p TS via browser imports.** In Tauri, the frontend should NOT use the TS cairn library at all -- it should communicate exclusively through Tauri IPC to the Rust backend. The SolidJS code in `cairn.ts` would need a Tauri-specific adapter that calls `invoke()` instead of the TS cairn Node API.

### Exact Files and Changes Needed

| File | Change |
|------|--------|
| `tauri/src-tauri/src/lib.rs` | Replace `AppState` with a struct holding `Arc<Mutex<Option<CairnNode>>>` and `Arc<Mutex<Option<Session>>>`. Add `pair_with_url`, `connect`, `disconnect`, `send_pty_input` commands. Add event emission for PTY output. |
| `tauri/src-tauri/src/cairn_bridge.rs` | Complete rewrite: hold a persistent Node + Session. Add `start_transport()`, `connect()`, PTY streaming via Tauri events. |
| `tauri/src-tauri/Cargo.toml` | Add `tauri-plugin-fs` if file browser is needed. Verify cairn-p2p git dep compiles. |
| `web/src/lib/cairn.ts` | Extract transport interface. Add Tauri adapter that uses `@tauri-apps/api/core` `invoke()` and `listen()`. |
| `web/src/lib/cairn-tauri.ts` | **New file**: Tauri-specific cairn adapter implementing the same interface as `cairn.ts` but routing through IPC. |
| `web/package.json` | Add `@tauri-apps/api` as optional dependency (only loaded in Tauri context). |

### Blockers

1. **cairn-p2p Rust crate API**: The Tauri bridge calls `cairn_p2p::create_with_config()`, `node.pair_enter_pin()`, `node.connect()`, etc. These must exist on the Rust crate's public API. Current code compiles against a git branch -- API stability is not guaranteed.

2. **Frontend dual-mode**: The SolidJS app must work in both browser (using cairn-p2p TS) and Tauri (using IPC to Rust backend). This requires a clean transport abstraction layer.

3. **Mobile specifics**: iOS requires code signing and App Store submission. Android requires the NDK and generates APKs. Both are handled in the CI workflow but have not been tested end-to-end.

### Effort Estimate: MEDIUM (3-5 days)

- Rewrite `cairn_bridge.rs` with persistent state: 1 day
- Add PTY streaming via Tauri events: 1 day
- Frontend adapter layer (detect Tauri vs browser, route accordingly): 1 day
- Test on desktop (Linux/Mac): 0.5 day
- Test mobile builds (Android APK): 0.5-1 day

---

## Gap 3: GitHub Pages Deployment

### Current State: YELLOW -- pipeline exists, dependency blocks production

**What exists:**

`/home/emeric/code/jaunt/.github/workflows/web.yml` is a complete GitHub Pages deployment workflow:
- Triggers on push to `main` with changes in `web/`
- Installs Node.js 22, runs `npm ci`, runs `npm run build`
- Uploads `web/dist` as a Pages artifact
- Deploys to GitHub Pages

The Vite build config (`/home/emeric/code/jaunt/web/vite.config.ts`) uses `base: './'` which is correct for GitHub Pages subpath deployment.

### The Blocking Issue

**The `cairn-p2p` dependency is a local `file:` link:**

```json
// web/package.json line 18:
"cairn-p2p": "file:../../cairn/packages/ts/cairn-p2p"
```

This works locally because the `cairn` repo is at `~/code/cairn/`, a sibling of `~/code/jaunt/`. But in CI, the `cairn` repo is not checked out alongside `jaunt`, so `npm ci` will fail.

**However**: `cairn-p2p` IS published to npm at version `0.4.1` (verified). And the locally installed version in `web/node_modules/cairn-p2p/package.json` shows version `0.4.1`.

### Fix

**File: `/home/emeric/code/jaunt/web/package.json`**
Change line 18 from:
```json
"cairn-p2p": "file:../../cairn/packages/ts/cairn-p2p"
```
to:
```json
"cairn-p2p": "^0.4.1"
```

This is the single change needed. The npm registry already has the correct version.

### Secondary Considerations

1. **The build must actually succeed**: Need to verify `npm run build` (vite build) completes without errors after switching to the npm dependency.

2. **Version coordination**: When cairn-p2p TS gets new features (Gap 1 changes for relay/DHT), the npm package must be published BEFORE the web client can use those features in production. This creates a release coordination requirement between the cairn and jaunt repos.

3. **GitHub Pages domain and HTTPS**: GitHub Pages serves from `https://<user>.github.io/jaunt/`. The cairn WebSocket connections from the browser will target `ws://` (not `wss://`) because the host's WS listener doesn't have TLS. Browsers allow `ws://` connections from HTTPS pages to local network addresses but may block connections to public IP addresses. This is a mixed content issue that will surface when Gap 1 (internet connectivity) is implemented.

4. **Base path**: The `base: './'` in vite.config.ts means the app works at any subpath. This is correct for GitHub Pages deployment under `/jaunt/`.

### Effort Estimate: SMALL (0.5 day)

- Change the dependency: 5 minutes
- Verify the build: 15 minutes
- Push and verify CI: 30 minutes
- Handle any build errors: 1-2 hours

---

## Gap 4: PIN Pairing from Web UI

### Current State: YELLOW -- backend complete, frontend stub

**Host side is fully implemented:**

`/home/emeric/code/jaunt/crates/jaunt-host/src/pairing_server.rs` implements:
- HTTP server on port 9867
- `GET /pair?pin=<PIN>` returns full `ConnectionProfile` as JSON
- CORS headers (`Access-Control-Allow-Origin: *`) for browser cross-origin requests
- PIN normalization (uppercase, strip hyphens/spaces)
- 403 on invalid PIN, 200 with profile on valid PIN
- OPTIONS preflight handling

`/home/emeric/code/jaunt/crates/jaunt-host/src/node.rs` starts the server:
- Lines 65-78: `start_pairing_server()` is called with the current PIN and profile
- The server runs as a background task

**Frontend is deliberately broken:**

`/home/emeric/code/jaunt/web/src/components/PairingScreen.tsx` `handlePinPair()` (lines 114-141):
1. Initializes a cairn node
2. Calls `pairEnterPin()` (cairn-level, not network-level)
3. Then immediately sets an error: "PIN pairing requires the full URL from jaunt-host"

The error is intentional because PIN alone cannot locate the host on the network. But now that the HTTP pairing endpoint exists, the fix is straightforward.

### What Needs to Change

The flow should be:
1. User enters PIN
2. User also enters host address (IP or hostname) -- **new input field**
3. Browser fetches `http://<address>:9867/pair?pin=<PIN>`
4. On success, receives full ConnectionProfile
5. Proceeds with `pairFromProfile()` exactly as the URL path does

### Exact Files and Changes

**File: `/home/emeric/code/jaunt/web/src/components/PairingScreen.tsx`**

1. Add a host address input field below the PIN field
2. Replace `handlePinPair()` implementation:

```typescript
async function handlePinPair() {
    const p = pin().trim();
    const addr = hostAddr().trim();
    if (!p) return;
    if (!addr) {
      setErrorMsg('Enter the host address shown by jaunt-host');
      setPhase('error');
      return;
    }

    try {
      setPhase('initializing');
      setStatusMsg('Fetching connection profile...');

      // Fetch profile from the pairing HTTP endpoint
      const host = addr.includes(':') ? addr : `${addr}:9867`;
      const resp = await fetch(`http://${host}/pair?pin=${encodeURIComponent(p)}`);

      if (resp.status === 403) {
        throw new Error('Invalid PIN');
      }
      if (!resp.ok) {
        throw new Error(`Pairing server returned ${resp.status}`);
      }

      const profile: ConnectionProfile = await resp.json();
      await pairFromProfile(profile);
    } catch (e: any) {
      setPhase('error');
      setErrorMsg(e.message);
    }
}
```

3. The `hostAddr` signal already exists on line 12 but is unused. Wire it to a new input field.

**File: `/home/emeric/code/jaunt/web/src/lib/profile.ts`**

No changes needed -- `ConnectionProfile` already handles all the fields the pairing server returns.

**File: `/home/emeric/code/jaunt/crates/jaunt-host/src/node.rs`**

The host should display the pairing server address more prominently:
```
  PIN:     A1B2-C3D4
  Address: 192.168.1.100
  URL:     https://moukrea.github.io/jaunt/#<base64>
```

### Edge Cases

1. **CORS**: The pairing server already sends `Access-Control-Allow-Origin: *`. Browser fetch will work.
2. **Mixed content**: GitHub Pages is HTTPS. Fetching `http://192.168.1.100:9867/pair` from an HTTPS page is blocked by browsers for non-localhost addresses. This means PIN pairing from the deployed GitHub Pages site will NOT work unless the host is on the same LAN and the browser is lenient (Chrome allows mixed content to private IPs). For production, the pairing server should support HTTPS or the web app should have a local development mode.
3. **Localhost**: When testing locally (`http://localhost:5173`), mixed content is not an issue.

### Effort Estimate: SMALL (0.5-1 day)

- Update PairingScreen: 2-3 hours
- Update host address display: 30 minutes
- Test locally: 1 hour
- Handle mixed content edge case (document limitation): 30 minutes

---

## Gap 5: Full Playwright Verification

### Current State: RED -- no test infrastructure

**What exists:**
- `playwright` is installed as a devDependency in `web/package.json` (v1.58.2)
- No `playwright.config.ts` exists anywhere in the repo
- No `.spec.ts` test files exist
- No test harness for spawning `jaunt-host`
- The `.harness/` directory exists but contains only an empty `logs/` directory

**Previously verified features (manual/ad-hoc):**
- Connect via URL: YES (verified by Playwright in previous sessions)
- Auto-reconnect on refresh: YES (verified)
- Session list loads: YES (verified)
- Create session: YES (verified)
- Open session in tab: YES (verified)
- Terminal PTY streaming: YES (verified)
- Split panes: PARTIALLY (verified creation, not resize drag)

**NOT verified:**
- PIN pairing (deliberately broken, see Gap 4)
- Connect over internet (cannot test locally, see Gap 1)
- Tauri client (incomplete, see Gap 2)

### Test Infrastructure Needed

**File: `/home/emeric/code/jaunt/web/playwright.config.ts`** (new)

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:5173',
  },
  webServer: {
    command: 'npm run dev',
    port: 5173,
    reuseExistingServer: true,
    timeout: 10_000,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
```

**File: `/home/emeric/code/jaunt/web/e2e/fixtures.ts`** (new)

Test fixture that:
1. Spawns `jaunt-host serve` as a child process
2. Captures the URL and PIN from stderr output
3. Provides them to tests as fixtures
4. Kills the process after the test

**File: `/home/emeric/code/jaunt/web/e2e/helpers.ts`** (new)

Helper functions for common test operations (wait for session list, create session, etc.)

### Test Matrix

| Feature | Test File | Depends On | Status |
|---------|-----------|------------|--------|
| Connect via URL | `url-connect.spec.ts` | jaunt-host running | Writable now |
| Session list loads | `session-list.spec.ts` | URL connect | Writable now |
| Create session | `session-create.spec.ts` | URL connect | Writable now |
| Open session in tab | `session-tab.spec.ts` | Create session | Writable now |
| Terminal PTY streaming | `terminal-pty.spec.ts` | Session tab | Writable now |
| Split panes | `split-panes.spec.ts` | Session tab | Writable now |
| Auto-reconnect | `auto-reconnect.spec.ts` | URL connect | Writable now |
| PIN pairing | `pin-pairing.spec.ts` | Gap 4 fix | After Gap 4 |
| Internet connect | `internet-connect.spec.ts` | Gap 1 fix | After Gap 1 (Docker) |
| Tauri client | `tauri.spec.ts` | Gap 2 fix | After Gap 2 |

### CI Integration

**File: `/home/emeric/code/jaunt/.github/workflows/pr.yml`**

Add a test job that:
1. Builds jaunt-host
2. Installs Playwright browsers
3. Runs the e2e test suite
4. Uploads trace artifacts on failure

### Effort Estimate: MEDIUM (2-3 days)

- Playwright config + fixtures: 0.5 day
- Core test suite (7 tests): 1 day
- CI integration: 0.5 day
- Debug and stabilize: 0.5-1 day

---

## Prioritized Implementation Order

### Priority 1: GitHub Pages Deployment (Gap 3)

**Why first**: One-line change that unblocks production deployment. No dependencies. Immediate value -- anyone can access the web client.

**Effort**: 0.5 day
**Blockers**: None
**Files**: `web/package.json` (1 line change)

### Priority 2: PIN Pairing (Gap 4)

**Why second**: Small effort, high UX impact. The backend is already done. Only the frontend needs a new input field and a fetch call. Unblocks a major user-facing feature.

**Effort**: 0.5-1 day
**Blockers**: None (pairing server already exists and works)
**Files**:
- `web/src/components/PairingScreen.tsx` -- add address input, rewrite `handlePinPair()`
- `crates/jaunt-host/src/node.rs` -- improve PIN display to show address

### Priority 3: Playwright Test Suite (Gap 5)

**Why third**: Once Gaps 3 and 4 are done, we have testable features. Writing tests now validates existing work and prevents regressions as Gaps 1 and 2 are implemented.

**Effort**: 2-3 days
**Blockers**: jaunt-host must be built (for test fixtures)
**Files**:
- `web/playwright.config.ts` (new)
- `web/e2e/fixtures.ts` (new)
- `web/e2e/*.spec.ts` (7+ new test files)
- `.github/workflows/pr.yml` (add test job)

### Priority 4: Tauri Desktop/Mobile (Gap 2)

**Why fourth**: The scaffolding exists but the cairn bridge is non-functional. Fixing this enables desktop and mobile clients with superior connectivity (full Rust cairn stack). However, the web client is the primary access path and should be solid first.

**Effort**: 3-5 days
**Blockers**: cairn-p2p Rust API stability
**Files**:
- `tauri/src-tauri/src/lib.rs` -- persistent state, new commands
- `tauri/src-tauri/src/cairn_bridge.rs` -- complete rewrite
- `web/src/lib/cairn-tauri.ts` (new) -- Tauri IPC adapter
- `web/src/lib/cairn.ts` -- extract interface

### Priority 5: Browser Over Internet (Gap 1)

**Why last**: Largest scope, most complexity, requires changes across both the cairn TS library and the jaunt web client. The value is immense (remote access from anywhere), but the implementation spans two repos and multiple protocol layers.

**Effort**: 5-7 days
**Blockers**:
- cairn-p2p npm publish cycle for TS library changes
- No self-hosted relay infrastructure (relying on IPFS public relays)
- Mixed content (HTTPS page -> WS connection) needs resolution
**Files**:
- `cairn/packages/ts/cairn-p2p/src/transport/libp2p-node.ts` -- add identify, relay, DHT to browser
- `cairn/packages/ts/cairn-p2p/package.json` -- add `@libp2p/identify`, `@libp2p/bootstrap`
- `cairn/packages/ts/cairn-p2p/src/node.ts` -- bootstrap node connection after transport start
- `web/src/lib/profile.ts` -- expand ConnectionProfile
- `web/src/lib/cairn.ts` -- relay/DHT-aware connection logic
- `crates/jaunt-host/src/node.rs` -- include relay addresses in profile
- `crates/jaunt-protocol/src/profile.rs` -- add relay/bootstrap fields

---

## Dependency Graph

```
Gap 3 (GitHub Pages)         Gap 4 (PIN Pairing)
  [0.5 day]                    [0.5-1 day]
       \                        /
        \                      /
         v                    v
      Gap 5 (Playwright Tests)
           [2-3 days]
               |
               v
      Gap 2 (Tauri Desktop/Mobile)
           [3-5 days]
               |
               v
      Gap 1 (Browser Over Internet)
           [5-7 days]
```

Gaps 3 and 4 are independent and can be done in parallel.
Gap 5 benefits from having Gaps 3 and 4 done (more features to test).
Gap 2 is independent of Gap 1 (Tauri uses Rust cairn, not TS).
Gap 1 is the final piece and the most complex.

---

## Risk Register

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| cairn-p2p TS changes break browser bundle size (Gap 1) | Medium | Medium | Lazy-load relay/DHT services; monitor bundle size |
| IPFS public relays are unreliable (Gap 1) | High | High | Self-host relay nodes; document relay infrastructure setup |
| Mixed content blocks WS from HTTPS page (Gap 1) | High | High | Use WSS on host (requires TLS cert), or serve web app via HTTP for LAN usage |
| Tauri Rust cairn API breaks on update (Gap 2) | Medium | Medium | Pin cairn-p2p git rev in Cargo.toml |
| PIN pairing CORS fails on deployed site (Gap 4) | Low | Medium | Pairing server already sends CORS headers; test from deployed site |
| Playwright tests flaky due to timing (Gap 5) | Medium | Low | Use explicit waits, increase timeouts, retry on CI |
| cairn-p2p npm publish coordination (Gap 1) | Medium | High | Automate npm publish in cairn CI; use npm canary channel for prereleases |

---

## Appendix: Verified Feature Matrix

| Feature | Browser (LAN) | Browser (Internet) | Tauri Desktop | Tauri Mobile |
|---------|:---:|:---:|:---:|:---:|
| Connect via URL | WORKS | BLOCKED (Gap 1) | N/A (uses IPC) | N/A |
| Connect via PIN | BLOCKED (Gap 4) | BLOCKED (Gap 1+4) | BROKEN (Gap 2) | BROKEN (Gap 2) |
| Auto-reconnect | WORKS | BLOCKED (Gap 1) | NOT IMPL | NOT IMPL |
| Session management | WORKS | BLOCKED (Gap 1) | BROKEN (Gap 2) | BROKEN (Gap 2) |
| Terminal PTY | WORKS | BLOCKED (Gap 1) | NOT IMPL | NOT IMPL |
| Split panes | WORKS | BLOCKED (Gap 1) | N/A (uses web) | N/A (uses web) |
| File browser | WORKS | BLOCKED (Gap 1) | NOT IMPL | NOT IMPL |
| NAT traversal | N/A (LAN) | BLOCKED (Gap 1) | NOT IMPL | NOT IMPL |
| GitHub Pages deploy | BLOCKED (Gap 3) | BLOCKED (Gap 1+3) | N/A | N/A |
| Automated tests | NONE (Gap 5) | NONE | NONE | NONE |
