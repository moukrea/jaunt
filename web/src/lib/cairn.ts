import { Node, NodeSession, NodeChannel } from 'cairn-p2p';
import type { CairnConfig } from 'cairn-p2p';
import type { ConnectionProfile } from './profile';
import { store, saveConnection, loadConnection, clearConnection } from './store';
import type { SavedConnection } from './store';
import { encodeRequest, decodeResponse } from './protocol';
import type { RpcRequest, RpcResponse } from './protocol';

let node: Node | null = null;
let session: NodeSession | null = null;
let rpcChannel: NodeChannel | null = null;

// Application-layer message tags.
// cairn strips channel names in dispatch_incoming, so ALL messages arrive
// with channel "". We prefix every message with a 1-byte tag to distinguish
// RPC from PTY traffic.
const TAG_RPC = 0x01;
const TAG_PTY = 0x02;

// Callbacks for PTY data and RPC responses
let onPtyData: ((data: Uint8Array) => void) | null = null;
let pendingRpcResolve: ((resp: RpcResponse) => void) | null = null;

/**
 * Initialize a cairn node with optional infrastructure config from the profile.
 * This creates the node but does NOT start the transport layer yet.
 */
export async function initNode(profile?: Partial<ConnectionProfile>): Promise<Node> {
  const config: Partial<CairnConfig> = {};

  if (profile?.signal_server) {
    config.signalingServers = [profile.signal_server];
  }
  if (profile?.turn_server && profile?.turn_username && profile?.turn_password) {
    config.turnServers = [{
      url: profile.turn_server,
      username: profile.turn_username,
      credential: profile.turn_password,
    }];
  }

  config.storageBackend = 'memory';

  // Always use createWithIdentity so that libp2pPrivateKeySeed is available
  // for session persistence. Node.create() generates a random identity whose
  // seed cannot be extracted in the browser, breaking auto-reconnect.
  const seed = crypto.getRandomValues(new Uint8Array(32));
  node = await Node.createWithIdentity(config, seed);

  if (profile?.signal_server) {
    store.setTier('Tier 1');
  } else {
    store.setTier('Tier 0');
  }

  return node;
}

/**
 * Initialize a cairn node with a specific libp2p identity seed.
 * Used for session resumption -- the host identifies the browser by its PeerId.
 */
export async function initNodeWithIdentity(
  libp2pSeed: Uint8Array,
  profile?: Partial<ConnectionProfile>,
): Promise<Node> {
  const config: Partial<CairnConfig> = {};

  if (profile?.signal_server) {
    config.signalingServers = [profile.signal_server];
  }
  if (profile?.turn_server && profile?.turn_username && profile?.turn_password) {
    config.turnServers = [{
      url: profile.turn_server,
      username: profile.turn_username,
      credential: profile.turn_password,
    }];
  }

  config.storageBackend = 'memory';

  node = await Node.createWithIdentity(config, libp2pSeed);

  if (profile?.signal_server) {
    store.setTier('Tier 1');
  } else {
    store.setTier('Tier 0');
  }

  return node;
}

/**
 * Pair by scanning QR data. The QR payload contains the host's peer ID
 * and connection hints (multiaddrs), which cairn stores internally for
 * use during connect().
 */
export async function pairScanQr(data: Uint8Array): Promise<string> {
  if (!node) throw new Error('Node not initialized');
  return await node.pairScanQr(data);
}

export async function pairEnterPin(pin: string): Promise<string> {
  if (!node) throw new Error('Node not initialized');
  return await node.pairEnterPin(pin);
}

export async function pairFromLink(uri: string): Promise<string> {
  if (!node) throw new Error('Node not initialized');
  return await node.pairFromLink(uri);
}

/**
 * Wire a session to the UI: open channels, register message handlers,
 * and monitor state changes.
 */
function wireSession(s: NodeSession): void {
  session = s;

  // Open a single channel (cairn strips channel names, so everything arrives
  // on the same callback regardless). We use tag-based routing.
  rpcChannel = session.openChannel('rpc');

  // Route ALL incoming messages by tag byte
  session.onMessage(rpcChannel, (data: Uint8Array) => {
    if (data.length === 0) return;

    const tag = data[0];
    const payload = data.slice(1);

    if (tag === TAG_RPC) {
      // RPC response
      console.log('[jaunt] RPC received:', payload.length, 'bytes (tagged)');
      if (pendingRpcResolve) {
        try {
          const resp = decodeResponse(payload);
          console.log('[jaunt] Decoded response:', JSON.stringify(resp).substring(0, 200));
          const resolve = pendingRpcResolve;
          pendingRpcResolve = null;
          resolve(resp);
        } catch (e) {
          console.error('[jaunt] RPC decode failed:', e);
        }
      } else {
        console.warn('[jaunt] RPC response received but no pending resolve');
      }
    } else if (tag === TAG_PTY) {
      // PTY output
      console.log('[jaunt] PTY data received:', payload.length, 'bytes');
      if (onPtyData) onPtyData(payload);
    } else {
      // Legacy untagged message: try as RPC, fall back to PTY
      console.log('[jaunt] Untagged message:', data.length, 'bytes, first byte:', tag);
      if (pendingRpcResolve) {
        try {
          const resp = decodeResponse(data);
          console.log('[jaunt] Decoded legacy response:', JSON.stringify(resp).substring(0, 200));
          const resolve = pendingRpcResolve;
          pendingRpcResolve = null;
          resolve(resp);
        } catch (e) {
          console.error('[jaunt] Legacy decode failed, forwarding as PTY:', e);
          if (onPtyData) onPtyData(data);
        }
      } else if (onPtyData) {
        onPtyData(data);
      }
    }
  });

  // Monitor session state changes
  session.onStateChange((prev, current) => {
    console.log(`[jaunt] Session state: ${prev} -> ${current}`);
    if (current === 'disconnected' || current === 'failed') {
      store.setConnected(false);
    } else if (current === 'reconnected' || current === 'connected') {
      store.setConnected(true);
    }
  });

  session.onError((error) => {
    console.error('[jaunt] Session error:', error.code, error.message);
    store.setError(error.message);
  });
}

/**
 * Save the current session's ratchet state to the existing SavedConnection
 * record in IndexedDB. Called after a successful connect or resume.
 */
async function persistSessionState(libp2pPeerId: string, addrs: string[], hostName: string): Promise<void> {
  if (!node || !session) return;

  const libp2pSeed = node.libp2pPrivateKeySeed;
  if (!libp2pSeed) return;

  // Get session ID and ratchet state
  const sessionId = (session as any).sessionId as Uint8Array | null;
  const ratchet = (session as any).ratchet;
  const sequenceTx = (session as any).sequenceTx as number ?? 0;
  const sequenceRx = (session as any).sequenceRx as number ?? 0;

  const conn: SavedConnection = {
    hostLibp2pPeerId: libp2pPeerId,
    hostAddrs: addrs,
    libp2pSeed: Array.from(libp2pSeed),
    hostName,
    connectedAt: Date.now(),
  };

  if (sessionId && ratchet) {
    conn.sessionId = bytesToHex(sessionId);
    conn.ratchetState = ratchet.exportStateObject();
    conn.sequenceTx = sequenceTx;
    conn.sequenceRx = sequenceRx;
  }

  await saveConnection(conn);
  console.log('[jaunt] Session state saved to IndexedDB (sessionId:', conn.sessionId?.substring(0, 8), ')');
}

/**
 * Connect to the host via cairn's libp2p transport.
 *
 * 1. Starts the libp2p transport (WebSocket in browser).
 * 2. Calls node.connectTransport() which dials the host's /ws multiaddr,
 *    performs a Noise XX handshake, and establishes a Double Ratchet session.
 * 3. Opens an "rpc" channel and a "pty" channel on the session.
 * 4. Registers message handlers to route incoming data to the right callbacks.
 *
 * @param libp2pPeerId - The host's libp2p PeerId (from the connection profile)
 * @param addrs - The host's listen multiaddrs (from the connection profile)
 */
export async function connectToHost(libp2pPeerId: string, addrs: string[]): Promise<void> {
  if (!node) throw new Error('Node not initialized');

  console.log('[jaunt] Starting cairn transport...');
  await node.startTransport();
  console.log('[jaunt] Transport started');

  console.log('[jaunt] Connecting to host:', libp2pPeerId, 'addrs:', addrs);
  const s = await (node as any).connectTransport(libp2pPeerId, addrs);
  console.log('[jaunt] Connected via cairn transport');

  wireSession(s);

  store.setConnected(true);
  store.setPeerId(libp2pPeerId);

  // Persist the session state for future resumption
  await persistSessionState(libp2pPeerId, addrs, store.hostName());
}

/**
 * Try to resume a saved connection.
 *
 * First attempts SESSION_RESUME (single round-trip) using the saved ratchet state.
 * If that fails (SESSION_EXPIRED), falls back to a full Noise XX handshake.
 * If even that fails, returns false so the caller can show the pairing screen.
 *
 * @param saved - The saved connection data from IndexedDB
 * @returns true if reconnected successfully, false if a new pairing is needed
 */
export async function tryResumeConnection(saved: SavedConnection): Promise<boolean> {
  try {
    // Restore node with the same identity
    const libp2pSeed = new Uint8Array(saved.libp2pSeed);
    await initNodeWithIdentity(libp2pSeed);

    if (!node) throw new Error('Node not initialized');

    console.log('[jaunt] Starting cairn transport for resume...');
    await node.startTransport();
    console.log('[jaunt] Transport started');

    // Try resume first if we have ratchet state
    if (saved.sessionId && saved.ratchetState) {
      try {
        console.log('[jaunt] Attempting session resume...');
        const sessionIdBytes = hexToBytes(saved.sessionId);
        const s = await (node as any).tryResumeTransport(
          saved.hostLibp2pPeerId,
          saved.hostAddrs,
          {
            sessionId: sessionIdBytes,
            ratchetState: saved.ratchetState,
            sequenceTx: saved.sequenceTx ?? 0,
            sequenceRx: saved.sequenceRx ?? 0,
          },
        );
        console.log('[jaunt] Session resumed successfully');
        wireSession(s);
        store.setConnected(true);
        store.setPeerId(saved.hostLibp2pPeerId);
        store.setHostName(saved.hostName);

        // Update persisted state
        await persistSessionState(saved.hostLibp2pPeerId, saved.hostAddrs, saved.hostName);
        return true;
      } catch (e: any) {
        console.warn('[jaunt] Session resume failed:', e.message, '- falling back to full handshake');
      }
    }

    // Fall back to full handshake
    try {
      console.log('[jaunt] Attempting full handshake...');
      const s = await (node as any).connectTransport(saved.hostLibp2pPeerId, saved.hostAddrs);
      console.log('[jaunt] Full handshake succeeded');
      wireSession(s);
      store.setConnected(true);
      store.setPeerId(saved.hostLibp2pPeerId);
      store.setHostName(saved.hostName);

      // Persist the new session state
      await persistSessionState(saved.hostLibp2pPeerId, saved.hostAddrs, saved.hostName);
      return true;
    } catch (e: any) {
      console.warn('[jaunt] Full handshake also failed:', e.message);
      await clearConnection();
      return false;
    }
  } catch (e: any) {
    console.error('[jaunt] Resume connection error:', e);
    await clearConnection();
    return false;
  }
}

/**
 * Send an RPC request and wait for the response.
 * The request is msgpack-encoded and sent on the "rpc" channel.
 */
export async function sendRpc(request: RpcRequest): Promise<RpcResponse> {
  if (!session || !rpcChannel) throw new Error('Not connected');

  const data = encodeRequest(request);
  // Prefix with TAG_RPC so the host can distinguish from PTY input
  const tagged = new Uint8Array(1 + data.length);
  tagged[0] = TAG_RPC;
  tagged.set(data, 1);
  console.log('[jaunt] sendRpc:', Object.keys(request)[0], 'data:', data.length, 'bytes (tagged)',
    'session.state:', (session as any).state,
    'outbox:', (session as any).outbox?.length,
    'hasTransport:', (session as any).hasTransport);
  try {
    session.send(rpcChannel, tagged);
    console.log('[jaunt] sendRpc: send() returned, outbox now:', (session as any).outbox?.length);
  } catch (e: any) {
    console.error('[jaunt] sendRpc: send() threw:', e.message);
    throw e;
  }

  return new Promise((resolve) => {
    pendingRpcResolve = resolve;
    setTimeout(() => {
      if (pendingRpcResolve === resolve) {
        pendingRpcResolve = null;
        resolve({ Error: { code: 99, message: 'Request timed out' } });
      }
    }, 10000);
  });
}

/**
 * Send raw PTY input bytes on the "pty" channel.
 */
export function sendPtyInput(data: Uint8Array): void {
  if (session && rpcChannel) {
    // Prefix with TAG_PTY so the host routes to the PTY handler
    const tagged = new Uint8Array(1 + data.length);
    tagged[0] = TAG_PTY;
    tagged.set(data, 1);
    session.send(rpcChannel, tagged);
  }
}

/**
 * Send a resize RPC on the "rpc" channel.
 */
export function sendResize(cols: number, rows: number): void {
  if (!session || !rpcChannel) return;
  const req: RpcRequest = { Resize: { cols, rows } };
  const data = encodeRequest(req);
  // Prefix with TAG_RPC so the host routes to the RPC handler
  const tagged = new Uint8Array(1 + data.length);
  tagged[0] = TAG_RPC;
  tagged.set(data, 1);
  session.send(rpcChannel, tagged);
}

/**
 * Register a callback to receive PTY output data.
 */
export function setPtyDataCallback(cb: (data: Uint8Array) => void): void {
  onPtyData = cb;
}

export function getNode(): Node | null {
  return node;
}

export function getSession(): NodeSession | null {
  return session;
}

/**
 * Disconnect from the host and clean up.
 */
export async function disconnect(): Promise<void> {
  if (session) {
    session.close();
    session = null;
  }
  rpcChannel = null;
  if (node) {
    await node.close();
    node = null;
  }
  store.setConnected(false);
}

// --- Helpers ---

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}
