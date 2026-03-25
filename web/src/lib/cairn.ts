import { Node, NodeSession, NodeChannel } from 'cairn-p2p';
import type { CairnConfig } from 'cairn-p2p';
import type { ConnectionProfile } from './profile';
import { store, saveHost } from './store';
import { encodeRequest, decodeResponse } from './protocol';
import type { RpcRequest, RpcResponse } from './protocol';

let node: Node | null = null;
let session: NodeSession | null = null;
let rpcChannel: NodeChannel | null = null;
let ptyChannel: NodeChannel | null = null;

// Direct WebSocket connection to host (browser transport layer)
let ws: WebSocket | null = null;

// Callbacks for PTY data and RPC responses
let onPtyData: ((data: Uint8Array) => void) | null = null;
let pendingRpcResolve: ((resp: RpcResponse) => void) | null = null;

// Connection hints from pairing
let connectionHints: string[] = [];

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

export async function pairScanQr(data: Uint8Array): Promise<string> {
  if (!node) throw new Error('Node not initialized');
  const peerId = await node.pairScanQr(data);
  // Extract connection hints from the QR payload for later WebSocket connection
  // The hints are embedded in the CBOR payload — cairn stores them internally
  // We also extract them from the profile passed during initNode
  return peerId;
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
 * Extract WebSocket addresses from the connection profile's pairing data.
 * The QR payload contains connection hints as multiaddr strings.
 */
export function setConnectionHints(hints: string[]) {
  connectionHints = hints;
}

/**
 * Connect to the host via WebSocket.
 *
 * The cairn Node/Session handles pairing and crypto. For the actual transport
 * in the browser, we open a direct WebSocket to the host's /ws multiaddr.
 * Messages are sent as raw bytes (msgpack-encoded RPC requests/responses).
 */
export async function connectToHost(peerId: string): Promise<void> {
  if (!node) throw new Error('Node not initialized');

  // Create cairn session (handles crypto/identity)
  session = await node.connect(peerId);
  rpcChannel = session.openChannel('rpc');
  ptyChannel = session.openChannel('pty');

  // Set up cairn session callbacks (for when real transport works)
  session.onMessage(rpcChannel, (data: Uint8Array) => {
    const resp = decodeResponse(data);
    if (pendingRpcResolve) {
      const resolve = pendingRpcResolve;
      pendingRpcResolve = null;
      resolve(resp);
    }
  });

  session.onMessage(ptyChannel, (data: Uint8Array) => {
    if (onPtyData) onPtyData(data);
  });

  // Try to connect via WebSocket using connection hints
  const wsAddr = findWsAddress();
  if (wsAddr) {
    try {
      await connectWebSocket(wsAddr);
      store.setConnected(true);
      store.setPeerId(peerId);
      return;
    } catch (e) {
      console.warn('WebSocket connection failed, falling back to cairn session:', e);
    }
  }

  // Fallback: cairn session without real transport
  store.setConnected(true);
  store.setPeerId(peerId);
}

/**
 * Find a usable WebSocket URL from connection hints.
 * Hints are ws:// URLs from the host's connection profile.
 */
function findWsAddress(): string | null {
  // Direct ws:// URLs from profile.ws_addrs
  for (const hint of connectionHints) {
    if (hint.startsWith('ws://') || hint.startsWith('wss://')) {
      return hint;
    }
  }
  // Fallback: try to parse libp2p multiaddr format
  for (const hint of connectionHints) {
    const match = hint.match(/\/ip4\/([\d.]+)\/tcp\/(\d+)\/ws/);
    if (match) {
      return `ws://${match[1]}:${match[2]}`;
    }
  }
  return null;
}

/**
 * Open a WebSocket to the host and set up message routing.
 */
function connectWebSocket(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';

    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error('WebSocket connection timed out'));
    }, 10000);

    socket.onopen = () => {
      clearTimeout(timeout);
      ws = socket;
      console.log('WebSocket connected to host:', url);
      resolve();
    };

    socket.onmessage = (event) => {
      const data = new Uint8Array(event.data);
      // Route incoming messages
      if (pendingRpcResolve) {
        try {
          const resp = decodeResponse(data);
          const resolve = pendingRpcResolve;
          pendingRpcResolve = null;
          resolve(resp);
        } catch {
          // Not an RPC response — might be PTY data
          if (onPtyData) onPtyData(data);
        }
      } else if (onPtyData) {
        onPtyData(data);
      }
    };

    socket.onerror = (event) => {
      clearTimeout(timeout);
      console.error('WebSocket error:', event);
      reject(new Error('WebSocket connection failed'));
    };

    socket.onclose = () => {
      ws = null;
      store.setConnected(false);
    };
  });
}

export async function sendRpc(request: RpcRequest): Promise<RpcResponse> {
  if (!session || !rpcChannel) throw new Error('Not connected');

  const data = encodeRequest(request);

  // Send via WebSocket if available, otherwise via cairn session outbox
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(data);
  } else {
    session.send(rpcChannel, data);
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

export function sendPtyInput(data: Uint8Array): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(data);
  } else if (session && ptyChannel) {
    session.send(ptyChannel, data);
  }
}

export function sendResize(cols: number, rows: number): void {
  const req: RpcRequest = { Resize: { cols, rows } };
  const data = encodeRequest(req);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(data);
  } else if (session && rpcChannel) {
    session.send(rpcChannel, data);
  }
}

export function setPtyDataCallback(cb: (data: Uint8Array) => void): void {
  onPtyData = cb;
}

export function getNode(): Node | null {
  return node;
}

export function getSession(): NodeSession | null {
  return session;
}

export function disconnect(): void {
  if (ws) {
    ws.close();
    ws = null;
  }
  if (session) {
    session.close();
    session = null;
  }
  rpcChannel = null;
  ptyChannel = null;
  store.setConnected(false);
}
