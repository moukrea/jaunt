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

// Callbacks for PTY data and RPC responses
let onPtyData: ((data: Uint8Array) => void) | null = null;
let pendingRpcResolve: ((resp: RpcResponse) => void) | null = null;

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

  // Determine tier
  if (profile?.signal_server) {
    store.setTier('Tier 1');
  } else {
    store.setTier('Tier 0');
  }

  return node;
}

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

export async function connectToHost(peerId: string): Promise<void> {
  if (!node) throw new Error('Node not initialized');

  session = await node.connect(peerId);

  // Open RPC channel
  rpcChannel = session.openChannel('rpc');

  // Listen for incoming messages on the RPC channel
  session.onMessage(rpcChannel, (data: Uint8Array) => {
    const resp = decodeResponse(data);
    if (pendingRpcResolve) {
      const resolve = pendingRpcResolve;
      pendingRpcResolve = null;
      resolve(resp);
    }
  });

  // Open PTY channel
  ptyChannel = session.openChannel('pty');
  session.onMessage(ptyChannel, (data: Uint8Array) => {
    if (onPtyData) onPtyData(data);
  });

  session.onStateChange((prev, current) => {
    store.setConnected(current === 'connected' || current === 'reconnected');
  });

  store.setConnected(true);
  store.setPeerId(peerId);
}

export async function sendRpc(request: RpcRequest): Promise<RpcResponse> {
  if (!session || !rpcChannel) throw new Error('Not connected');

  const data = encodeRequest(request);
  session.send(rpcChannel, data);

  // Wait for response
  return new Promise((resolve) => {
    pendingRpcResolve = resolve;
    // Timeout after 10s
    setTimeout(() => {
      if (pendingRpcResolve === resolve) {
        pendingRpcResolve = null;
        resolve({ Error: { code: 99, message: 'Request timed out' } });
      }
    }, 10000);
  });
}

export function sendPtyInput(data: Uint8Array): void {
  if (!session || !ptyChannel) return;
  session.send(ptyChannel, data);
}

export function sendResize(cols: number, rows: number): void {
  if (!session || !rpcChannel) return;
  const req: RpcRequest = { Resize: { cols, rows } };
  const data = encodeRequest(req);
  session.send(rpcChannel, data);
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
  if (session) {
    session.close();
    session = null;
  }
  rpcChannel = null;
  ptyChannel = null;
  store.setConnected(false);
}
