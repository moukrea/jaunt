// The wake outbox: the single place where local producers (watcher, watchdog,
// runtime adapter) hand a model wake-up over, and the single record of whether
// the model has taken it (JAU-62).
//
// Without it every producer woke the owner on its own, so one worker exit could
// cost three model turns, and a Codex queue message pointed at a mutable event
// file: four messages queued while the model was busy all read the same event
// (JAU-70, 22/09 08:37:45.902, read four times). Here each item has a stable
// key, is deposited once, and leaves in a batch with its own id. At most one
// batch is outstanding: until the model takes it, new items wait for the next
// one, so no queue ever accumulates pointers to the same work.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// A delivered batch nobody took is re-offered after this: long enough for any
// real pass to reach `wake take`, short enough that a lost delivery (queue
// refused, owner restarted, output never read) is not lost for good.
export const REDELIVER_MS = 10 * 60_000;
// Keys already delivered are remembered this long, so a producer that notices
// the same fact late (the watchdog after the adapter) adds nothing.
const SEEN_MS = 24 * 60 * 60_000;
const TAKEN_KEEP = 50;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const pidAlive = pid => {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
};

// The key a producer deposits under. The same worker attempt ending is one
// fact whether the adapter or the watchdog saw it first; a recovery wake stays
// distinct per notification, since `workerWake` already spaces those out.
export function wakeKey(event) {
  if (/^worker-/.test(event.wake || '')) {
    const issue = event.issue ?? event.workers?.[0]?.issue;
    const attempt = event.attempt ?? event.workers?.[0]?.attempt ?? event.session;
    if (issue && attempt) {
      return event.wake === 'worker-recovery-due'
        ? `worker:${issue}:${attempt}:recovery:${event.workers?.[0]?.schedule?.due ?? event.at ?? ''}`
        : `worker:${issue}:${attempt}:ended`;
    }
  }
  // A board batch is the difference between two pulses: its time and content
  // together identify it.
  if (event.wake === 'board-changed') return `board:${event.at ?? ''}:${createHash('sha256').update(JSON.stringify(event.events ?? [])).digest('hex').slice(0, 16)}`;
  return `${event.wake || 'wake'}:${randomUUID()}`;
}

// What the model reads: one item keeps the shape the skills already describe;
// several become a `batch` whose items are each handled as their own wake.
export function batchPayload(batch) {
  const payload = batch.items.length === 1
    ? { ...batch.items[0].event }
    : { wake: 'batch', items: batch.items.map(i => i.event), events: [] };
  return { ...payload, wakeId: batch.id };
}

export function wakeStore(state, { now = Date.now } = {}) {
  const dir = join(state, 'wakes');
  const path = join(dir, 'outbox.json');
  const lockPath = join(dir, 'outbox.lock');

  async function read() {
    try { return JSON.parse(await readFile(path, 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') return { version: 1, pending: [], batch: null, seen: {}, taken: [], metrics: {} };
      // A corrupt outbox is not an empty one: say so rather than drop wakes.
      throw new Error(`wake outbox unreadable: ${error.message}`);
    }
  }
  async function write(value) {
    await mkdir(dir, { recursive: true });
    const tmp = `${path}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
    await rename(tmp, path);
  }
  // Short critical sections from three processes; wait rather than fail, and
  // reap a lock whose holder is gone.
  async function locked(action) {
    await mkdir(dir, { recursive: true });
    for (let attempt = 0; ; attempt++) {
      let fd;
      try { fd = await open(lockPath, 'wx', 0o600); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        let holder = null;
        try { holder = JSON.parse(await readFile(lockPath, 'utf8')); } catch { /* being written */ }
        if (holder?.pid && !pidAlive(holder.pid)) { await rm(lockPath, { force: true }); continue; }
        if (attempt > 200) throw new Error('wake outbox lock held too long');
        await sleep(10);
        continue;
      }
      try {
        await fd.writeFile(JSON.stringify({ pid: process.pid }));
        const outbox = await read();
        const result = await action(outbox);
        await write(outbox);
        return result;
      } finally { await fd.close(); await rm(lockPath, { force: true }); }
    }
  }
  const count = (outbox, name, n = 1) => { outbox.metrics[name] = (outbox.metrics[name] || 0) + n; };
  const prune = outbox => {
    const limit = now() - SEEN_MS;
    for (const [key, at] of Object.entries(outbox.seen)) if (at < limit) delete outbox.seen[key];
  };

  // A new batch forms once the oldest pending item has waited `settleMs`, so
  // two producers noticing the same moment a few seconds apart share it.
  const ready = (outbox, settleMs) => outbox.pending.length > 0 && now() - outbox.pending[0].at >= settleMs;

  return {
    path,
    // Lock-free: polled every second by the watcher between Linear polls.
    async due({ settleMs = 0 } = {}) {
      const outbox = await read();
      const batch = outbox.batch;
      if (batch && !batch.takenAt) return !batch.deliveredAt || now() - batch.deliveredAt >= REDELIVER_MS;
      return ready(outbox, settleMs);
    },
    // Returns how many items were new. A key already pending, in the
    // outstanding batch or delivered recently is a duplicate, and counted.
    async deposit(events) {
      return locked(outbox => {
        prune(outbox);
        let added = 0;
        for (const event of events) {
          const key = event.key || wakeKey(event);
          const { key: _, ...body } = event;
          if (outbox.seen[key] || outbox.pending.some(i => i.key === key) || outbox.batch?.items.some(i => i.key === key)) {
            count(outbox, 'duplicates');
            continue;
          }
          outbox.pending.push({ key, event: body, at: now() });
          count(outbox, 'deposited');
          added += 1;
        }
        return added;
      });
    },
    // The batch to deliver now, or null. An untaken batch blocks the next one
    // until it is taken or its redelivery delay has passed.
    async next({ settleMs = 0 } = {}) {
      return locked(outbox => {
        const batch = outbox.batch;
        if (batch && !batch.takenAt) {
          if (batch.deliveredAt && now() - batch.deliveredAt < REDELIVER_MS) return null;
          if (batch.deliveredAt) count(outbox, 'redeliveries');
          batch.offeredAt = now();
          batch.attempts = (batch.attempts || 0) + 1;
          return batchPayload(batch);
        }
        if (!ready(outbox, settleMs)) return null;
        outbox.batch = { id: randomUUID(), items: outbox.pending, createdAt: now(), offeredAt: now(), attempts: 1, deliveredAt: null, takenAt: null };
        for (const item of outbox.pending) outbox.seen[item.key] = now();
        outbox.pending = [];
        count(outbox, 'batches');
        return batchPayload(outbox.batch);
      });
    },
    // `ok: false` keeps the batch offerable at once: the next deliverer retries.
    async delivered(id, ok = true) {
      return locked(outbox => {
        if (outbox.batch?.id !== id || outbox.batch.takenAt) return false;
        outbox.batch.deliveredAt = ok ? now() : null;
        if (!ok) count(outbox, 'deliveryFailures');
        return true;
      });
    },
    // The model's first gesture on a wake. A batch already taken — a replayed
    // queue message, a re-read output file — answers `alreadyHandled` and
    // costs nothing more.
    async take(id) {
      return locked(outbox => {
        const batch = outbox.batch;
        if (id && batch?.id !== id) {
          count(outbox, 'alreadyHandled');
          return { alreadyHandled: true, wakeId: id, known: outbox.taken.includes(id) };
        }
        if (!batch || batch.takenAt) {
          count(outbox, 'alreadyHandled');
          return { alreadyHandled: true, wakeId: id || batch?.id || null };
        }
        batch.takenAt = now();
        outbox.taken = [...outbox.taken, batch.id].slice(-TAKEN_KEEP);
        count(outbox, 'taken');
        return { alreadyHandled: false, ...batchPayload(batch), pending: outbox.pending.length };
      });
    },
    // Suppressions decided outside the outbox, counted with it so one place
    // answers "how many wakes did the model not pay for, and why".
    async note(reason, n = 1) {
      return locked(outbox => { count(outbox, `suppressed:${reason}`, n); });
    },
    async status() {
      const outbox = await read();
      const batch = outbox.batch && {
        id: outbox.batch.id, items: outbox.batch.items.length, attempts: outbox.batch.attempts,
        delivered: Boolean(outbox.batch.deliveredAt), taken: Boolean(outbox.batch.takenAt),
      };
      return { pending: outbox.pending.length, batch, metrics: outbox.metrics };
    },
  };
}
