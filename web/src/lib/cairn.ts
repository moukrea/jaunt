import { Node, NodeSession, NodeChannel } from 'cairn-p2p';
import type { CairnConfig } from 'cairn-p2p';
import type { ConnectionProfile } from './profile';
import { store } from './store';
import { encodeRequest, decodeResponse } from './protocol';
import type { RpcRequest, RpcResponse } from './protocol';

let node: Node | null = null;
let session: NodeSession | null = null;
let rpcChannel: NodeChannel | null = null;
let ptyChannel: NodeChannel | null = null;

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

  node = await Node.create(config);

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
  session = await (node as any).connectTransport(libp2pPeerId, addrs);
  console.log('[jaunt] Connected via cairn transport');

  // Open channels for RPC and PTY data
  rpcChannel = session.openChannel('rpc');
  ptyChannel = session.openChannel('pty');

  // Route incoming messages on the RPC channel
  session.onMessage(rpcChannel, (data: Uint8Array) => {
    console.log('[jaunt] RPC received:', data.length, 'bytes');
    if (pendingRpcResolve) {
      try {
        const resp = decodeResponse(data);
        console.log('[jaunt] Decoded response:', JSON.stringify(resp).substring(0, 200));
        const resolve = pendingRpcResolve;
        pendingRpcResolve = null;
        resolve(resp);
      } catch (e) {
        console.error('[jaunt] RPC decode failed, forwarding as PTY data:', e);
        if (onPtyData) onPtyData(data);
      }
    } else if (onPtyData) {
      // No pending RPC -- treat as PTY output
      onPtyData(data);
    }
  });

  // Route incoming messages on the PTY channel directly to terminal
  session.onMessage(ptyChannel, (data: Uint8Array) => {
    if (onPtyData) onPtyData(data);
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

  store.setConnected(true);
  store.setPeerId(libp2pPeerId);
}

/**
 * Send an RPC request and wait for the response.
 * The request is msgpack-encoded and sent on the "rpc" channel.
 */
export async function sendRpc(request: RpcRequest): Promise<RpcResponse> {
  if (!session || !rpcChannel) throw new Error('Not connected');

  const data = encodeRequest(request);
  console.log('[jaunt] sendRpc:', Object.keys(request)[0], 'data:', data.length, 'bytes');
  session.send(rpcChannel, data);

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
  if (session && ptyChannel) {
    session.send(ptyChannel, data);
  }
}

/**
 * Send a resize RPC on the "rpc" channel.
 */
export function sendResize(cols: number, rows: number): void {
  if (!session || !rpcChannel) return;
  const req: RpcRequest = { Resize: { cols, rows } };
  const data = encodeRequest(req);
  session.send(rpcChannel, data);
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
  ptyChannel = null;
  if (node) {
    await node.close();
    node = null;
  }
  store.setConnected(false);
}
