const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const utf8 = value => encoder.encode(value);
export const text = value => decoder.decode(value);
export function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 16384) s += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
export function unb64(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_\-]*={0,2}$/.test(value)) throw new Error('Invalid encoded data');
  const s = atob(value.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(s, c => c.charCodeAt(0));
}
export function random(size = 32) { return b64(crypto.getRandomValues(new Uint8Array(size))); }
export async function hash(bytes) { return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)); }
export async function hexHash(bytes) { return [...await hash(bytes)].map(b => b.toString(16).padStart(2, '0')).join(''); }
function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
}
async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', secret, {name: 'HMAC', hash: 'SHA-256'}, false, ['sign', 'verify']);
}
export async function proof(secret, label, transcript) {
  return b64(new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), concat(utf8(label + ':'), transcript))));
}
export async function verify(secret, label, transcript, signature) {
  return crypto.subtle.verify('HMAC', await hmacKey(secret), unb64(signature), concat(utf8(label + ':'), transcript));
}
export function transcript(room, hello, nonce, publicKey) {
  return utf8(JSON.stringify(['jaunt-v1', room, hello.auth, hello.id, hello.pair || '',
    hello.nonce, hello.pub, nonce, publicKey]));
}
export async function ephemeral() {
  const pair = await crypto.subtle.generateKey({name: 'ECDH', namedCurve: 'P-256'}, true, ['deriveBits']);
  return {privateKey: pair.privateKey, publicKey: b64(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)))};
}
export async function channel(privateKey, publicKey, secret, transcriptBytes, server = false) {
  const peer = await crypto.subtle.importKey('raw', unb64(publicKey), {name: 'ECDH', namedCurve: 'P-256'}, false, []);
  const shared = await crypto.subtle.deriveBits({name: 'ECDH', public: peer}, privateKey, 256);
  const base = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  const aad = await hash(transcriptBytes), salt = await hash(secret);
  async function derive(direction) {
    return crypto.subtle.deriveKey({name: 'HKDF', hash: 'SHA-256', salt, info: concat(aad, utf8(direction))},
      base, {name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
  }
  const c2h = await derive('jaunt-c2h'), h2c = await derive('jaunt-h2c');
  let sent = 0, received = 0;
  function nonce(n) {
    const bytes = new Uint8Array(12);
    new DataView(bytes.buffer).setBigUint64(4, BigInt(n));
    return bytes;
  }
  return {
    async seal(value) {
      const n = ++sent;
      if (!Number.isSafeInteger(n)) throw new Error('Channel exhausted');
      const ct = await crypto.subtle.encrypt({name: 'AES-GCM', iv: nonce(n), additionalData: aad},
        server ? h2c : c2h, utf8(JSON.stringify(value)));
      return {type: 'box', n, ct: b64(new Uint8Array(ct))};
    },
    async open(frame) {
      if (frame.type !== 'box' || !Number.isSafeInteger(frame.n) || frame.n !== received + 1) {
        const error = new Error(`Out-of-order or replayed frame (expected ${received + 1}, got ${frame.n})`); error.code = 'desync'; throw error;
      }
      const data = await crypto.subtle.decrypt({name: 'AES-GCM', iv: nonce(frame.n), additionalData: aad},
        server ? c2h : h2c, unb64(frame.ct));
      const value = JSON.parse(text(data));
      received = frame.n;
      return value;
    }
  };
}
