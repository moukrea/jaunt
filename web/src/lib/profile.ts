export interface ConnectionProfile {
  pairing: PairingData;
  signal_server?: string;
  signal_auth_token?: string;
  turn_server?: string;
  turn_username?: string;
  turn_password?: string;
  host_name: string;
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
