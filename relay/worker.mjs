/** jaunt's blind WebSocket relay. No terminal/file/clipboard plaintext is stored.
 * One Durable Object per unguessable host room; Hibernation WebSocket API.
 * Relay capabilities authorize routing only. End-to-end authentication is on the host.
 */
const MAX_FRAME = 132000;
const MAX_CLIENTS = 16;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const roomPattern = /^[A-Za-z0-9_-]{24}$/;

export async function digest(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

function emit(ws, value) {
  try { ws.send(JSON.stringify(value)); } catch { /* Closing socket; never log payloads. */ }
}
function close(ws, code, reason) { try { ws.close(code, reason); } catch {} }

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return Response.json({service: 'jaunt-relay', protocol: 1, ok: true}, {
        headers: {'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': env.APP_ORIGIN || 'https://moukrea.github.io'}
      });
    }
    const match = url.pathname.match(/^\/v1\/room\/([A-Za-z0-9_-]+)$/);
    if (!match || !roomPattern.test(match[1])) return new Response('Not found', {status: 404});
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket required', {status: 426});
    }
    const origin = request.headers.get('Origin');
    if (origin && origin !== (env.APP_ORIGIN || 'https://moukrea.github.io')) {
      return new Response('Origin not allowed', {status: 403});
    }
    return env.ROOMS.get(env.ROOMS.idFromName(match[1])).fetch(request);
  }
};

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    // Pings do not wake the Durable Object or spend CPU handling JavaScript.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  sockets(role) {
    return this.ctx.getWebSockets().filter(ws => ws.readyState === 1 && ws.deserializeAttachment()?.role === role);
  }

  async fetch(request) {
    if (this.ctx.getWebSockets().length >= MAX_CLIENTS + 5) {
      return new Response('Too many connections in this room', {status: 429});
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({id: crypto.randomUUID(), role: 'pending', since: Date.now(),
      bytes: 0, frames: 0, window: Date.now()});
    const alarm = await this.ctx.storage.getAlarm();
    if (!alarm) await this.ctx.storage.setAlarm(Date.now() + 20000);
    return new Response(null, {status: 101, webSocket: client});
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > MAX_FRAME) return close(ws, 1009, 'Frame too large');
    let m;
    try { m = JSON.parse(raw); } catch { return close(ws, 1003, 'JSON required'); }
    if (!m || typeof m !== 'object' || Array.isArray(m)) return close(ws, 1003, 'Invalid envelope');
    const s = ws.deserializeAttachment();
    if (!s) return close(ws, 1008, 'No connection state');
    const now = Date.now();
    if (now - s.window >= 1000) { s.bytes = 0; s.frames = 0; s.window = now; }
    s.bytes += raw.length; s.frames += 1;
    if (s.frames > 180 || s.bytes > 4 * 1024 * 1024) return close(ws, 1008, 'Slow down');
    ws.serializeAttachment(s);

    if (s.role === 'pending') {
      if (m.type !== 'auth' || !tokenPattern.test(m.token || '')) return close(ws, 1008, 'Authentication required');
      if (now - s.since > 20000) return close(ws, 1008, 'Authentication expired');
      const presented = await digest(m.token);
      if (m.role === 'host') {
        if (!tokenPattern.test(m.clientToken || '')) return close(ws, 1008, 'Invalid capability');
        const clientHash = await digest(m.clientToken);
        // Atomic first registration: no unauthenticated room takeover on reconnect.
        const accepted = await this.ctx.storage.transaction(async txn => {
          const auth = await txn.get('auth');
          if (auth) return auth.host === presented && auth.client === clientHash;
          await txn.put('auth', {host: presented, client: clientHash});
          return true;
        });
        if (!accepted) return close(ws, 1008, 'Unauthorized');
        const previous = this.sockets('host');
        s.role = 'host'; ws.serializeAttachment(s);
        for (const old of previous) close(old, 4001, 'Host reconnected');
        emit(ws, {type: 'ready'});
        for (const client of this.sockets('client')) {
          emit(ws, {type: 'peer.joined', peer: client.deserializeAttachment().id});
          emit(client, {type: 'host.online'});
        }
        return;
      }
      if (m.role === 'client') {
        const auth = await this.ctx.storage.get('auth');
        if (!auth || auth.client !== presented) return close(ws, 1008, 'Unauthorized or host not registered');
        if (this.sockets('client').length >= MAX_CLIENTS) return close(ws, 1008, 'Client limit reached');
        s.role = 'client'; ws.serializeAttachment(s);
        const host = this.sockets('host')[0];
        emit(ws, {type: 'ready', peer: s.id, hostOnline: !!host});
        if (host) emit(host, {type: 'peer.joined', peer: s.id});
        return;
      }
      return close(ws, 1008, 'Invalid role');
    }

    if (m.type === 'route' && m.data && typeof m.data === 'object') {
      if (s.role === 'client') {
        const host = this.sockets('host')[0];
        if (host) emit(host, {type: 'route', from: s.id, data: m.data});
        else emit(ws, {type: 'host.offline'});
      } else if (s.role === 'host') {
        const client = this.sockets('client').find(c => c.deserializeAttachment().id === m.to);
        if (client) emit(client, {type: 'route', data: m.data});
      }
      return;
    }
    if (m.type === 'disconnect' && s.role === 'host') {
      const client = this.sockets('client').find(c => c.deserializeAttachment().id === m.to);
      if (client) close(client, 4002, 'Host closed this channel');
      return;
    }
    close(ws, 1008, 'Invalid envelope');
  }

  async webSocketClose(ws, code, reason, wasClean) {
    const s = ws.deserializeAttachment();
    close(ws, code === 1005 ? 1000 : code, 'Closed');
    if (s?.role === 'host') {
      const other = this.sockets('host').find(h => h !== ws && h.readyState === 1);
      if (!other) for (const client of this.sockets('client')) emit(client, {type: 'host.offline'});
    } else if (s?.role === 'client') {
      for (const host of this.sockets('host')) emit(host, {type: 'peer.left', peer: s.id});
    }
  }

  async webSocketError(ws) { await this.webSocketClose(ws, 1011, 'Socket error', false); }

  async alarm() {
    let pending = false;
    for (const ws of this.ctx.getWebSockets()) {
      const s = ws.deserializeAttachment();
      if (s?.role !== 'pending') continue;
      if (Date.now() - s.since >= 20000) close(ws, 1008, 'Authentication expired');
      else pending = true;
    }
    if (pending) await this.ctx.storage.setAlarm(Date.now() + 20000);
  }
}
