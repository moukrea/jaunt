import {t as tr} from './i18n.mjs';
import {b64, unb64, random, ephemeral, proof, verify, transcript, channel} from './crypto.mjs';

export function parsePairing(value) {
  let encoded = value.trim();
  if (encoded.slice(0,7).toLowerCase() === 'jaunt1.') encoded = encoded.slice(7);
  else if (encoded.includes('#pair=')) encoded = new URLSearchParams(encoded.split('#')[1]).get('pair');
  if (!encoded || encoded.length > 6000) throw new Error('Paste a complete jaunt pairing string or link.');
  let p;
  try { p = JSON.parse(new TextDecoder().decode(unb64(encoded))); }
  catch { throw new Error('This is not a valid jaunt pairing code.'); }
  if (p.v !== 1 || !/^[A-Za-z0-9_-]{24}$/.test(p.h) || !/^[A-Za-z0-9_-]{16}$/.test(p.p)) {
    throw new Error('Unsupported or incomplete pairing code.');
  }
  for (const key of ['t', 's']) if (unb64(p[key]).length !== 32) throw new Error('Invalid pairing capability.');
  const url = new URL(p.r);
  if (!['wss:', 'ws:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Invalid relay address.');
  }
  if (url.protocol === 'ws:' && !(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
      ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname))) {
    throw new Error('An encrypted wss:// relay is required.');
  }
  return {room: p.h, relay: p.r.replace(/\/$/, ''), relayToken: p.t, pairId: p.p, pairSecret: p.s,
    name: String(p.n || tr('Remote machine')).slice(0, 80), deviceId: random(16), secret: random(),
    deviceName: /Android/.test(navigator.userAgent) ? tr('Android browser') : tr('Web browser'),
    pending: true, added: Date.now()};
}

export class ConnectionInterrupted extends Error {constructor(message){super(message);this.code='connection';}}

export class Link extends EventTarget {
  constructor(machine, persist) {
    super();
    this.machine = machine; this.persist = persist;
    this.state = 'offline'; this.channel = null; this.ws = null;
    this.generation = 0; this.pending = new Map(); this.enabled = false;
    this.delay = 500; this.timer = null; this.nextAuth = 'device'; this.stage = '';
    this.sendQueue = Promise.resolve(); this.receiveQueue = Promise.resolve(); this.nextSend = 0;
    this.lastSeen = 0; this.lastHostSeen = 0; this.latency = null;
  }
  emit(type, value) { this.dispatchEvent(new CustomEvent(type, {detail: value})); }
  status(state, message = '') { this.state = state; this.message = message; this.emit('status', {state, message}); }
  start() { this.enabled = true; this.connect(); }
  stop(message = '') {
    this.enabled = false; clearTimeout(this.timer); clearInterval(this.heartbeat); clearTimeout(this.handshakeTimer); this.stopProbes();
    this.generation++; this.channel = null; this.ws?.close(); this.ws = null;
    this.rejectPending(); this.status('offline', message);
  }
  rejectPending() {
    for (const [id, p] of this.pending) { clearTimeout(p.timer); p.reject(new ConnectionInterrupted('Connection interrupted; operation was not replayed.')); }
    this.pending.clear();
  }
  reconnect() {
    if (!this.enabled) return;
    clearTimeout(this.timer); this.ws?.close(); this.connect();
  }
  connect() {
    if (!this.enabled) return;
    clearTimeout(this.timer); clearInterval(this.heartbeat); clearTimeout(this.handshakeTimer); this.stopProbes();
    this.ws?.close();
    const generation = ++this.generation;
    this.channel = null; this.stage = ''; this.rejectPending();
    this.sendQueue = Promise.resolve(); this.receiveQueue = Promise.resolve(); this.nextSend = 0;
    this.status('connecting');
    const ws = this.ws = new WebSocket(`${this.machine.relay}/v1/room/${this.machine.room}`);
    ws.onopen = () => {
      if (generation !== this.generation) return;
      this.lastSeen = Date.now();
      ws.send(JSON.stringify({type: 'auth', role: 'client', token: this.machine.relayToken}));
      this.heartbeat = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (Date.now() - this.lastSeen > 55000 ||
            (this.state === 'online' && Date.now() - this.lastHostSeen > 55000)) {
          this.reconnect(); return;
        }
        ws.send('ping');
        if (this.state === 'online') this.probe();
      }, 20000);
      // A probe that has not come back yet is already a latency measurement: report it
      // while it is outstanding so the UI can react to a stall before the pong arrives.
      this.stallTimer = setInterval(() => {
        if (this.state === 'online' && this.probeAt && Date.now() - this.probeAt > 2000) { this.latency = Date.now() - this.probeAt; this.emit('latency', this.latency); }
      }, 1000);
    };
    ws.onmessage = event => {
      this.receiveQueue = this.receiveQueue.then(async () => {
        if (generation !== this.generation) return;
        this.lastSeen = Date.now();
        if (event.data === 'pong') return;
        if (typeof event.data !== 'string' || event.data.length > 160000) throw new Error('Invalid relay frame');
        const m = JSON.parse(event.data);
        if (m.type === 'ready') {
          if (m.hostOnline) await this.handshake(generation);
          else this.status('waiting', tr('Waiting for the host'));
        } else if (m.type === 'host.online') {
          this.rejectPending(); await this.handshake(generation);
        } else if (m.type === 'host.offline') {
          clearTimeout(this.handshakeTimer); this.channel = null; this.hello=null; this.handshakeAttempt=null; this.rejectPending(); this.status('waiting', tr('Host offline — waiting for reconnection'));
        } else if (m.type === 'route') {
          await this.receive(m.data,generation);
        }
      }).catch(error => {
        if (generation !== this.generation) return;
        if(error.code==='connection' || ws.readyState!==WebSocket.OPEN){ws.close();return;}
        this.stop(tr('Secure channel could not be verified.'));
        this.emit('error', error.message);
      });
    };
    ws.onclose = () => {
      if (generation !== this.generation) return;
      clearInterval(this.heartbeat); clearTimeout(this.handshakeTimer); this.stopProbes();
      this.channel = null; this.rejectPending();
      if (this.enabled) {
        this.status('reconnecting', tr('Reconnecting automatically'));
        this.timer = setTimeout(() => this.connect(), this.delay * (0.8 + Math.random() * 0.4));
        this.delay = Math.min(this.delay * 1.7, 30000);
      }
    };
    ws.onerror = () => { /* close event drives retries; never invent an authentication error */ };
  }
  plain(data) {
    if (this.ws?.readyState !== WebSocket.OPEN) throw new ConnectionInterrupted('Connection is offline');
    this.ws.send(JSON.stringify({type: 'route', data}));
  }
  async handshake(generation=this.generation) {
    if(generation!==this.generation || !this.enabled)return;
    this.status('authenticating', tr('Verifying encrypted channel'));
    this.channel = null;
    const attempt={};this.handshakeAttempt=attempt;
    const keypair=await ephemeral();
    if(generation!==this.generation || this.handshakeAttempt!==attempt || !this.enabled)return;
    this.keypair=keypair;this.auth = this.nextAuth;
    this.hello = {type: 'hello', v: 1, auth: this.auth, id: this.machine.deviceId,
      pair: this.auth === 'pair' ? this.machine.pairId : '', nonce: random(), pub: keypair.publicKey};
    this.stage = 'challenge';
    this.plain(this.hello);
    clearTimeout(this.handshakeTimer);
    this.handshakeTimer = setTimeout(() => this.ws?.close(), 25000);
  }
  async receive(m,generation=this.generation) {
    if(generation!==this.generation || !this.enabled)return;
    if (m.type === 'error') {
      if (m.code === 'unknown-device' && this.machine.pending && this.auth === 'device') {
        this.nextAuth = 'pair'; this.delay = 150; this.ws.close(); return;
      }
      if (m.code === 'unknown-device' || m.code === 'pair-expired') {
        this.stop(m.message); this.emit('error', m.message); return;
      }
      throw new Error(m.message || tr('Host refused the connection'));
    }
    if (m.type === 'challenge' && this.stage === 'challenge') {
      const hello=this.hello,keypair=this.keypair;
      const secret = unb64(this.auth === 'pair' ? this.machine.pairSecret : this.machine.secret);
      const tx = transcript(this.machine.room, this.hello, m.nonce, m.pub);
      if (!await verify(secret, 'server', tx, m.mac)) throw new Error('Host identity verification failed. Do not continue.');
      if(generation!==this.generation || hello!==this.hello || !this.enabled)return;
      const secure=await channel(keypair.privateKey, m.pub, secret, tx);
      const mac=await proof(secret, 'client', tx);
      if(generation!==this.generation || hello!==this.hello || !this.enabled)return;
      this.channel = secure;
      this.keypair = null;
      this.stage = 'encrypted';
      this.plain({type: 'proof', mac});
      return;
    }
    if (m.type !== 'box' || !this.channel) throw new Error('Unexpected unencrypted data');
    // Only an authenticated host message proves end-to-end liveness.
    // A relay pong may continue while the host has lost its network.
    const secure=this.channel;
    const value = await secure.open(m);
    if(generation!==this.generation || secure!==this.channel || !this.enabled)return;
    this.lastHostSeen = Date.now();
    if (value.type === 'pair.ready') {
      await this.send({type: 'enroll', name: this.machine.deviceName, secret: this.machine.secret});
    } else if (value.type === 'welcome') {
      clearTimeout(this.handshakeTimer); this.delay = 500; this.nextAuth = 'device';
      this.machine.pending = false;
      this.machine.name = value.machine.name;
      delete this.machine.pairSecret; delete this.machine.pairId;
      await this.persist();
      if(generation!==this.generation || secure!==this.channel || !this.enabled)return;
      this.status('online'); this.emit('welcome', value);
      this.probe();
    } else if (value.type === 'reply') {
      const pending = this.pending.get(value.id);
      if (pending) {
        clearTimeout(pending.timer); this.pending.delete(value.id);
        if (value.ok) pending.resolve(value.result); else pending.reject(new Error(value.error));
      }
    } else if (value.type === 'pong') {
      if (value.at === this.probeAt) this.probeAt = 0;
      this.latency = Math.max(0, Date.now() - value.at); this.emit('latency', this.latency);
      // Degraded link: probe more often so recovery is noticed within seconds, not at the next heartbeat.
      if (this.latency >= 1500) this.probeSoon(3000);
    } else if (value.type === 'revoked') {
      this.stop(tr('Access revoked on the host')); this.emit('revoked', null);
    } else if (value.type === 'error') {
      this.emit('error', value.message);
    } else this.emit('message', value);
  }
  probe() {
    if (this.state !== 'online' || this.ws?.readyState !== WebSocket.OPEN) return;
    if (this.probeAt && Date.now() - this.probeAt < 60000) return; // one outstanding probe at a time
    this.probeAt = Date.now(); const at = this.probeAt;
    this.send({type: 'ping', at}).catch(() => { if (this.probeAt === at) this.probeAt = 0; });
  }
  probeSoon(delay) { clearTimeout(this.probeTimer); this.probeTimer = setTimeout(() => this.probe(), delay); }
  stopProbes() { clearTimeout(this.probeTimer); clearInterval(this.stallTimer); this.probeAt = 0; }
  send(value) {
    const generation = this.generation;
    const current = this.channel;
    const task = this.sendQueue.catch(() => {}).then(async () => {
      if (!current || current !== this.channel || generation !== this.generation) throw new ConnectionInterrupted('Connection is offline');
      while (this.ws?.bufferedAmount > 1024 * 1024) {
        await new Promise(resolve => setTimeout(resolve, 15));
        if (generation !== this.generation || this.ws?.readyState !== WebSocket.OPEN) throw new ConnectionInterrupted('Connection interrupted');
      }
      // Match host transport pacing: a rapid keyboard/IME burst must not fill
      // the peer queue or exceed the relay frame budget. Never replay across
      // a channel change while waiting for the next transmission slot.
      await new Promise(resolve => setTimeout(resolve, Math.max(0, this.nextSend - performance.now())));
      if (generation !== this.generation || current !== this.channel || this.ws?.readyState !== WebSocket.OPEN) throw new ConnectionInterrupted('Connection changed');
      const frame = await current.seal(value);
      if (generation !== this.generation || current !== this.channel) throw new ConnectionInterrupted('Connection changed');
      this.nextSend = performance.now() + Math.max(8, JSON.stringify(frame).length / (1.5 * 1024 * 1024) * 1000);
      this.plain(frame);
    });
    this.sendQueue = task;
    return task;
  }
  request(method, params = {}, timeout = 45000) {
    if (this.state !== 'online') return Promise.reject(new ConnectionInterrupted('Wait for the encrypted connection.'));
    const id = random(12);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Host response timed out.')); }, timeout);
      this.pending.set(id, {resolve, reject, timer});
      this.send({type: 'rpc', id, method, params}).catch(error => {
        clearTimeout(timer); this.pending.delete(id); reject(error);
      });
    });
  }
  async waitOnline(signal) {
    if (signal?.aborted) throw new Error('Transfer cancelled');
    if (this.state === 'online') return;
    if(!this.enabled)throw new Error(this.message || tr('Connection is stopped. Reconnect before retrying this transfer.'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error('Host remained offline. Retry when it is available.')); }, 120000);
      const change = () => { if (this.state === 'online') { cleanup(); resolve(); } else if(!this.enabled){cleanup();reject(new Error(this.message || tr('Connection stopped. Reconnect before retrying.')));} };
      const abort = () => { cleanup(); reject(new Error('Transfer cancelled')); };
      const cleanup = () => { clearTimeout(timer); this.removeEventListener('status', change); signal?.removeEventListener('abort', abort); };
      this.addEventListener('status', change); signal?.addEventListener('abort', abort, {once: true});
    });
  }
}
