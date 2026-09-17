/** Local cache of terminal output, keyed by host room + session id and absolute stream offset.
 *
 * Offsets are the reconciliation key: the host numbers every byte of a session's output, so a
 * chunk cached at offset N is exactly what the host would send for [N, N+len). The cache holds a
 * list of contiguous ranges per session; "load earlier" reads from here first and only asks the
 * host for the parts it never saw (or skipped on a slow link). IndexedDB is used everywhere
 * (browser, Android WebView, Electron): asynchronous, hundreds of MB, survives reloads. */
const DB = 'jaunt-scrollback', PER_SESSION = 32 * 1024 * 1024, TOTAL = 256 * 1024 * 1024, MAX_CHUNK = 512 * 1024;
let dbPromise = null;
function open() {
  dbPromise ||= new Promise((resolve, reject) => {
    let request;
    try { request = indexedDB.open(DB, 1); } catch (error) { reject(error); return; }
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('chunks', {keyPath: ['key', 'offset']});
      db.createObjectStore('meta', {keyPath: 'key'});
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('scrollback database blocked'));
  }).catch(error => { dbPromise = null; throw error; });
  return dbPromise;
}
const req = r => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
// Walk a cursor request; fn returns false to stop early.
const each = (request, fn) => new Promise((resolve, reject) => { request.onsuccess = () => { const c = request.result; if (!c || fn(c) === false) return resolve(); c.continue(); }; request.onerror = () => reject(request.error); });
const done = tx => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('aborted')); });
function merge(ranges, start, end) {
  const out = [];
  let s = start, e = end;
  for (const [a, b] of ranges) {
    if (b < s || a > e) out.push([a, b]); else { s = Math.min(s, a); e = Math.max(e, b); }
  }
  out.push([s, e]); out.sort((x, y) => x[0] - y[0]);
  return out;
}
export class ScrollbackCache {
  constructor() { this.pending = new Map(); this.timer = 0; this.available = true; }
  /** Queue a chunk; flushed in one transaction shortly after (or by flush()). */
  put(key, offset, bytes) {
    if (!this.available || !bytes.length) return;
    const list = this.pending.get(key) || []; list.push({offset, bytes}); this.pending.set(key, list);
    if (!this.timer) this.timer = setTimeout(() => { this.timer = 0; this.flush().catch(() => {}); }, 300);
  }
  async flush(only = null) {
    const keys = only ? [only] : [...this.pending.keys()];
    if (!keys.length) return;
    let db; try { db = await open(); } catch { this.available = false; this.pending.clear(); return; }
    const tx = db.transaction(['chunks', 'meta'], 'readwrite'), chunks = tx.objectStore('chunks'), meta = tx.objectStore('meta');
    for (const key of keys) {
      const list = this.pending.get(key) || []; this.pending.delete(key);
      if (!list.length) continue;
      const m = (await req(meta.get(key))) || {key, ranges: [], bytes: 0, used: 0};
      for (const {offset, bytes} of list) {
        // Chunks straddling a cached range are still stored whole: ranges merge, reads slice.
        chunks.put({key, offset, end: offset + bytes.length, bytes});
        m.ranges = merge(m.ranges, offset, offset + bytes.length); m.bytes += bytes.length;
      }
      m.used = Date.now();
      if (m.bytes > PER_SESSION) await this.trim(chunks, m, PER_SESSION * 0.75);
      meta.put(m);
    }
    await done(tx);
  }
  async trim(chunks, m, keep) {
    // Drop the oldest chunks until `keep` bytes remain; ranges start after what was dropped.
    let dropped = 0, floor = 0;
    await each(chunks.openCursor(IDBKeyRange.bound([m.key, 0], [m.key, Number.MAX_SAFE_INTEGER])), cursor => {
      if (m.bytes - dropped <= keep) return false;
      dropped += cursor.value.bytes.length; floor = cursor.value.end; cursor.delete();
    });
    m.bytes -= dropped;
    m.ranges = m.ranges.map(([a, b]) => [Math.max(a, floor), b]).filter(([a, b]) => a < b);
  }
  /** Contiguous ranges cached for a session, oldest first. */
  async ranges(key) {
    await this.flush(key);
    try { const db = await open(); const m = await req(db.transaction('meta').objectStore('meta').get(key)); return m?.ranges || []; } catch { return []; }
  }
  /** Bytes [from, to) if the whole range is cached, else null. */
  async read(key, from, to) {
    if (to <= from) return new Uint8Array(0);
    const ranges = await this.ranges(key);
    if (!ranges.some(([a, b]) => a <= from && to <= b)) return null;
    let db; try { db = await open(); } catch { return null; }
    const out = new Uint8Array(to - from);
    const store = db.transaction('chunks').objectStore('chunks');
    let filled = 0;
    await each(store.openCursor(IDBKeyRange.bound([key, Math.max(0, from - MAX_CHUNK)], [key, to], false, true)), cursor => {
      const {offset, bytes} = cursor.value, lo = Math.max(from, offset), hi = Math.min(to, offset + bytes.length);
      if (lo < hi) { out.set(bytes.subarray(lo - offset, hi - offset), lo - from); filled += hi - lo; }
    });
    // Overlapping chunks may fill bytes twice; the range list said the span is contiguous.
    return filled >= to - from ? out : null;
  }
  /** The newest cached stretch, at most `max` bytes: {start, end, bytes} or null. */
  async tail(key, max) {
    const ranges = await this.ranges(key);
    if (!ranges.length) return null;
    const [s, e] = ranges[ranges.length - 1], start = Math.max(s, e - max);
    const bytes = await this.read(key, start, e);
    return bytes ? {start, end: e, bytes} : null;
  }
  async purge(key) {
    this.pending.delete(key);
    let db; try { db = await open(); } catch { return; }
    const tx = db.transaction(['chunks', 'meta'], 'readwrite');
    tx.objectStore('chunks').delete(IDBKeyRange.bound([key, 0], [key, Number.MAX_SAFE_INTEGER]));
    tx.objectStore('meta').delete(key);
    await done(tx);
  }
  /** Keep the total under TOTAL, dropping least recently used sessions first; also drops sessions not in `alive` for the given rooms. */
  async sweep(alive = null) {
    let db; try { db = await open(); } catch { return; }
    const metas = await req(db.transaction('meta').objectStore('meta').getAll());
    let total = metas.reduce((n, m) => n + m.bytes, 0);
    const doomed = new Set();
    if (alive) for (const m of metas) { const room = m.key.split(':')[0]; if (alive.has(room) && !alive.get(room).has(m.key)) doomed.add(m.key); }
    for (const m of metas.sort((x, y) => x.used - y.used)) { if (total <= TOTAL) break; if (!doomed.has(m.key)) { doomed.add(m.key); total -= m.bytes; } }
    for (const key of doomed) await this.purge(key);
  }
  async stats() {
    let db; try { db = await open(); } catch { return {sessions: 0, bytes: 0}; }
    const metas = await req(db.transaction('meta').objectStore('meta').getAll());
    return {sessions: metas.length, bytes: metas.reduce((n, m) => n + m.bytes, 0), ranges: Object.fromEntries(metas.map(m => [m.key, m.ranges]))};
  }
}
