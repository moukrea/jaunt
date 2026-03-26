export interface ConnectionProfile {
  pairing: PairingData;
  signal_server?: string;
  signal_auth_token?: string;
  turn_server?: string;
  turn_username?: string;
  turn_password?: string;
  /** Legacy: plain WebSocket URLs (ws://host:port) from the direct WS server. */
  ws_addrs?: string[];
  /** Cairn transport multiaddrs (e.g. /ip4/x.x.x.x/tcp/port/ws). */
  cairn_addrs?: string[];
  /** Host's libp2p PeerId for connectTransport(). */
  libp2p_peer_id?: string;
  host_name: string;
}

/**
 * Convert a ws:// URL to a libp2p multiaddr string.
 * e.g. "ws://192.168.1.100:54321" -> "/ip4/192.168.1.100/tcp/54321/ws"
 */
export function wsUrlToMultiaddr(url: string): string {
  const u = new URL(url);
  return `/ip4/${u.hostname}/tcp/${u.port}/ws`;
}

/**
 * Extract multiaddr connection hints from a profile.
 * Prefers cairn_addrs if present, otherwise converts ws_addrs.
 */
export function getMultiaddrs(profile: ConnectionProfile): string[] {
  if (profile.cairn_addrs && profile.cairn_addrs.length > 0) {
    return profile.cairn_addrs;
  }
  if (profile.ws_addrs && profile.ws_addrs.length > 0) {
    return profile.ws_addrs.map(wsUrlToMultiaddr);
  }
  return [];
}

export type PairingData =
  | { Qr: { qr_data: number[] } }
  | { Link: { uri: string } }
  | { Pin: { pin: string } };

export function decodeProfileFromFragment(fragment: string): ConnectionProfile {
  // URL-safe base64 decode
  const base64 = fragment.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4;
  const padded = pad ? base64 + '='.repeat(4 - pad) : base64;
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json) as ConnectionProfile;
}

export function encodeProfileToFragment(profile: ConnectionProfile): string {
  const json = JSON.stringify(profile);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  const base64 = btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
