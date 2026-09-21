// Canonical instruction receipts. These are evidence of an explicit read, not
// evidence that a model understood it; they never transfer process ownership.
import { createHash, randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

const digest = value => createHash('sha256').update(value).digest('hex');
async function read(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function write(path, value) {
  const tmp = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(tmp, path);
}
function identity(runtime, session) {
  if (!['codex', 'claude'].includes(runtime) || typeof session !== 'string' || !session.trim()) {
    throw new Error('skills require --runtime codex|claude and the actual --session ID');
  }
  return { runtime, session };
}
export function skillStore(root, { now = Date.now } = {}) {
  const dir = join(root, '.dev-state', 'skills');
  const ownerPath = join(dir, 'owner.json');
  const receiptPath = who => join(dir, `${digest(JSON.stringify(who))}.json`);
  async function snapshot(runtime) {
    if (!['codex', 'claude'].includes(runtime)) throw new Error('unknown skill runtime');
    const files = await Promise.all(['linear-loop', 'linear-orchestrator'].map(async name => {
      const path = join(root, runtime === 'codex' ? '.agents' : '.claude', 'skills', name, 'SKILL.md');
      return { path, content: await readFile(path, 'utf8') };
    }));
    return { fingerprint: digest(JSON.stringify(files)), files };
  }
  async function status(who) {
    try {
      who ||= await read(ownerPath);
      if (!who) return { state: 'unknown', reason: 'no session registered', action: 'Read the canonical linear-loop and linear-orchestrator skills and register the actual owner session.' };
      who = identity(who.runtime, who.session);
      const current = await snapshot(who.runtime);
      const receipt = await read(receiptPath(who));
      return { ...who, state: !receipt ? 'unknown' : receipt.fingerprint === current.fingerprint ? 'fresh' : 'stale',
        current: current.fingerprint, acknowledged: receipt?.fingerprint ?? null,
        paths: current.files.map(f => f.path),
        action: 'Before board actions, run jaunt-linear skills-read with this runtime/session, read every returned file, then skills-ack with the returned fingerprint. Keep the current owner and workers alive.' };
    } catch (error) { return { ...who, state: 'error', error: error.message, action: 'Repair instruction access and reread before board actions; do not acknowledge unreadable instructions.' }; }
  }
  return {
    status,
    async bind(runtime, session) {
      const who = identity(runtime, session);
      await mkdir(dir, { recursive: true });
      await write(ownerPath, who);
      return status(who); // Binding does not acknowledge anything.
    },
    async read(runtime, session) {
      const who = identity(runtime, session);
      return { ...who, ...(await snapshot(runtime)) };
    },
    async acknowledge(runtime, session, fingerprint) {
      const who = identity(runtime, session);
      if (!/^[a-f0-9]{64}$/.test(fingerprint || '')) throw new Error('skills-ack requires the fingerprint returned by skills-read');
      if ((await snapshot(runtime)).fingerprint !== fingerprint) throw new Error('skills changed since reading; reread before acknowledging');
      await mkdir(dir, { recursive: true });
      await write(receiptPath(who), { ...who, fingerprint, readAt: new Date().toISOString() });
      // A concurrent edit stays stale even if it happened during the write.
      return status(who);
    },
    async wake() {
      const current = await status();
      const key = digest(JSON.stringify(current));
      const path = join(dir, 'notification.json');
      let previous;
      try { previous = await read(path); } catch { previous = null; }
      if (current.state === 'fresh') {
        if (previous) await write(path, { key: null });
        return null;
      }
      // Persist before delivery to avoid a tight wake loop, but retry a lost
      // report/queue delivery after five minutes until the owner acknowledges.
      if (previous?.key === key && now() - previous.at < 300_000) return null;
      await mkdir(dir, { recursive: true });
      await write(path, { key, at: now() });
      return { wake: 'skills-changed', skills: current, events: [] };
    },
  };
}
