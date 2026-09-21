// Local worker evidence and recovery policy. Importing this module starts nothing.
import { readFile, writeFile, mkdir, rename, readdir, open, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

export const hash = text => createHash('sha256').update(text).digest('hex');
export const runtimeOf = claim => claim.runtime || 'claude';
export async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
export async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
    await rename(tmp, path);
  } finally { await rm(tmp, { force: true }); }
}
export function processIdentity(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    if (process.platform === 'linux') {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ').at(-1).split(' ');
      if (stat[0] === 'Z') return null;
      return { pid, started: `${readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()}:${stat[19]}` };
    }
    const text = execFileSync('ps', ['-p', String(pid), '-o', 'lstart=', '-o', 'stat='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (!text || /\sZ\S*$/.test(text)) return null;
    return { pid, started: text.replace(/\s+\S+$/, '') };
  } catch { return null; }
}
// Unknown is deliberately distinct from gone (EPERM / unavailable ps).
export function identityState(identity) {
  if (!identity?.pid || !identity.started) return 'unknown';
  const current = processIdentity(identity.pid);
  if (current) return current.started === identity.started ? 'alive' : 'gone';
  try { process.kill(identity.pid, 0); return 'unknown'; }
  catch (e) { return e.code === 'ESRCH' ? 'gone' : 'unknown'; }
}
export async function withWorkerLock(state, id, action) {
  if (!/^[A-Z][A-Z0-9]*-\d+$/.test(id)) throw new Error('invalid worker identifier');
  const path = join(state, 'workers', `${id}.lock`), reap = `${path}.reap`;
  await mkdir(dirname(path), { recursive: true });
  // The reaper serializes stale-lock removal; launchers also check its presence.
  try { await readFile(reap); throw new Error('worker lock recovery in progress'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  let fd;
  try { fd = await open(path, 'wx', 0o600); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const guard = await open(reap, 'wx', 0o600);
    try {
      const old = await readJson(path);
      if (identityState(old) !== 'gone') throw new Error(`${id} launch/cleanup already in progress or uncertain`);
      await rm(path);
    } finally { await guard.close(); await rm(reap); }
    return withWorkerLock(state, id, action);
  }
  try { await fd.writeFile(JSON.stringify(processIdentity(process.pid))); return await action(); }
  finally { await fd.close(); await rm(path, { force: true }); }
}
export function sameAttempt(claim, record) {
  return Boolean(record && claim.claimedAt === record.claimedAt && claim.issue === record.issue && runtimeOf(claim) === record.runtime && (!claim.session || claim.session === record.session));
}
export function workerHealth(claim, record, { now = Date.now(), identity = identityState } = {}) {
  if (!sameAttempt(claim, record)) return { state: 'unknown', reason: 'no matching lifecycle record' };
  const wrapper = identity(record.wrapper), child = identity(record.child);
  if (child === 'alive' || (!record.endedAt && wrapper === 'alive')) {
    const fresh = now - Date.parse(record.heartbeatAt || record.startedAt) < 45000;
    return { state: fresh && wrapper === 'alive' ? 'running' : 'suspect', reason: 'process still exists; never relaunch' };
  }
  if (child === 'unknown' && !(record.spawnFailed || record.childExited)) return { state: 'unknown', reason: 'child identity/exit not established' };
  if (wrapper === 'unknown' && !record.endedAt) return { state: 'unknown', reason: 'wrapper identity unknown' };
  if (['awaiting-approval', 'queued'].includes(claim.phase)) return { state: 'resting', reason: claim.phase };
  if (record.cancelled) return { state: ['owner-closed', 'state-unreadable'].includes(record.cancelled) ? 'interrupted' : 'suspended', reason: record.cancelled };
  if (record.endedAt && record.code === 0 && !record.failure) return { state: 'finished', reason: 'reconcile normal completion before resuming' };
  return { state: 'interrupted', reason: record.failure?.kind || 'process exited unexpectedly' };
}
// Claude's explicit local reset form. Reject ambiguous DST times rather than
// treating the host timezone as the provider timezone. Missing date means the
// next occurrence, evaluated once when the error is captured.
export function textualReset(message, now = Date.now()) {
  const match = message.match(/resets?\s+(?:(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:,?\s+(\d{4}))?\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*\(([^)]+)\)/i);
  if (!match) return null;
  const [, month, day, year, h, m = '0', meridian, zone] = match;
  if (+h < 1 || +h > 12 || +m > 59) return null;
  let formatter;
  try { formatter = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); }
  catch { return null; }
  const parts = ms => Object.fromEntries(formatter.formatToParts(ms).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
  const today = parts(now), hour = (+h % 12) + (meridian.toLowerCase() === 'pm' ? 12 : 0);
  const monthNumber = month ? ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(month.slice(0,3).toLowerCase()) + 1 : today.month;
  const dates = month ? [Date.UTC(+(year || today.year), monthNumber-1, +day), ...(year ? [] : [Date.UTC(today.year+1, monthNumber-1, +day)])]
    : [Date.UTC(today.year, today.month-1, today.day), Date.UTC(today.year, today.month-1, today.day+1)];
  for (const date of dates) {
    const d = new Date(date);
    if (month && (d.getUTCMonth()+1 !== monthNumber || d.getUTCDate() !== +day)) return null;
    const nominal = date + hour*3600000 + (+m)*60000, matches = [];
    // Offsets used by modern IANA zones are multiples of fifteen minutes.
    for (let offset = -14*60; offset <= 14*60; offset += 15) {
      const candidate = nominal + offset*60000, p = parts(candidate);
      if (p.year === d.getUTCFullYear() && p.month === d.getUTCMonth()+1 && p.day === d.getUTCDate() && p.hour === hour && p.minute === +m) matches.push(candidate);
    }
    if (matches.length > 1) return null;
    if (matches.length === 1 && matches[0] >= now) return new Date(matches[0]).toISOString();
  }
  return null;
}
export function classifyFailure(value, now = Date.now()) {
  const message = typeof value === 'string' ? value : JSON.stringify(value || '');
  // Raw provider output stays local. No prompt/output text is returned in status.
  const quota = /quota|usage.limit|rate.limit|hit your.*limit|limit.*reset/i.test(message);
  const permanent = /unauth|authentication|invalid.*(?:api.key|model|config)|ENOENT|command not found|permission denied/i.test(message);
  const candidate = typeof value === 'object' && value ? (value.retry_at || value.reset_at || value.resets_at) : null;
  const iso = candidate || message.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})/)?.[0];
  const resetAt = quota && typeof iso === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(iso) && Number.isFinite(Date.parse(iso)) ? new Date(iso).toISOString() : quota ? textualReset(message, now) : null;
  return { kind: quota ? 'quota' : permanent ? 'configuration' : 'transient', resetAt, resetSource: resetAt ? (candidate ? 'structured' : iso ? 'explicit ISO timestamp' : 'explicit local reset with IANA timezone') : null };
}
export function progressBudget(claim, schedule) {
  const stages = ['planning', 'implementing', 'landing'];
  return schedule?.progressPhase && stages.indexOf(claim.phase) > stages.indexOf(schedule.progressPhase)
    ? { ...schedule, attempts: 0, progressPhase: claim.phase } : schedule;
}
export function retryDecision(record, schedule, now = Date.now()) {
  const attempts = schedule?.attempts || 0;
  if (record.failure?.kind === 'configuration') return { blocked: 'configuration', attempts };
  if (attempts >= 3) return { blocked: 'retry budget exhausted', attempts };
  const base = Date.parse(record.endedAt || schedule?.detectedAt || new Date(now).toISOString());
  const deadline = Math.max(base + [60000, 300000, 1800000][attempts], Date.parse(record.failure?.resetAt || '') + 30000 || 0);
  return { attempts, retryAt: new Date(deadline).toISOString(), due: now >= deadline };
}
export function lifecyclePaths(state, claim) {
  const dir = join(state, 'workers', claim.issue, hash(claim.claimedAt));
  return { dir, current: join(dir, 'current.json'), schedule: join(dir, 'schedule.json') };
}
export async function saveAttempt(state, record) {
  const p = lifecyclePaths(state, record);
  await atomicJson(join(p.dir, `${record.attempt}.json`), record);
  // Only launch writes current.json; a late old wrapper cannot select itself.
}
export async function currentAttempt(state, claim) {
  const p = lifecyclePaths(state, claim), pointer = await readJson(p.current);
  return pointer?.attempt ? readJson(join(p.dir, `${pointer.attempt}.json`)) : null;
}
export async function beginAttempt(state, claim, details) {
  const p = lifecyclePaths(state, claim);
  const record = { ...details, issue: claim.issue, claimedAt: claim.claimedAt, runtime: runtimeOf(claim), attempt: randomUUID(), startedAt: new Date().toISOString(), session: details.session || claim.session || null };
  await saveAttempt(state, record);
  await atomicJson(p.current, { attempt: record.attempt });
  return record;
}
export async function workerReports(state, { now = Date.now(), identity = identityState } = {}) {
  const names = await readdir(join(state, 'claims')).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
  const reports = [];
  for (const name of names.filter(n => n.endsWith('.json'))) {
    const claim = await readJson(join(state, 'claims', name));
    if (!claim?.claimedAt) continue;
    const record = await currentAttempt(state, claim);
    const health = workerHealth(claim, record, { now, identity });
    const p = lifecyclePaths(state, claim);
    let schedule = await readJson(p.schedule);
    if (schedule?.claimedAt !== claim.claimedAt) schedule = null;
    schedule = progressBudget(claim, schedule);
    if (health.state === 'interrupted') {
      const detectedAt = schedule?.attempt === record.attempt ? schedule.detectedAt : new Date(now).toISOString();
      const decision = retryDecision(record, { ...schedule, detectedAt }, now);
      const next = { ...schedule, ...decision, issue: claim.issue, claimedAt: claim.claimedAt, attempt: record.attempt, detectedAt, progressPhase: claim.phase };
      schedule = next;
    }
    reports.push({ issue: claim.issue, runtime: runtimeOf(claim), phase: claim.phase, ...health, attempt: record?.attempt, schedule: health.state === 'interrupted' ? schedule : null });
  }
  return reports;
}
// Called only by the watchdog. Persist notifications separately from retry counters.
export async function workerWake(state, now = Date.now()) {
  if (!(await readJson(join(state, 'linear-loop.json')))?.enabled) return null;
  const reports = await workerReports(state, { mark: false, now });
  for (const report of reports) {
    if (!report.attempt || ['running', 'resting'].includes(report.state)) continue;
    if (await readJson(join(state, 'claims', `${report.issue}.stop`))) continue;
    const claim = await readJson(join(state, 'claims', `${report.issue}.json`));
    const p = lifecyclePaths(state, claim), notification = join(p.dir, 'notification.json');
    const due = report.state === 'interrupted' && report.schedule?.due && !report.schedule?.blocked;
    const wake = report.state === 'finished' ? 'worker-finished' : due ? 'worker-recovery-due' : 'worker-lost';
    // Known future cooldown does not repeatedly spend model calls.
    const old = await readJson(notification);
    const key = `${report.attempt}:${report.state}:${wake}:${report.schedule?.blocked || ''}`;
    if (old?.key === key && (!due || now - Date.parse(old.at) < 300000)) continue;
    // First observation of an abrupt crash establishes a durable retry clock.
    if (report.state === 'interrupted') {
      try { await withWorkerLock(state, report.issue, async () => {
        const latest = await currentAttempt(state, claim);
        if (latest?.attempt === report.attempt) {
          const existing = await readJson(p.schedule);
          await atomicJson(p.schedule, { ...report.schedule, attempts: existing?.progressPhase === report.schedule.progressPhase ? (existing?.attempts || 0) : report.schedule.attempts });
        }
      }); } catch (error) {
        if (error.code === 'EEXIST' || /already in progress|lock recovery/.test(error.message)) continue;
        throw error;
      }
    }
    await atomicJson(notification, { key, at: new Date(now).toISOString(), wake, issue: report.issue, attempt: report.attempt });
    return { wake, workers: [report], events: [] };
  }
  return null;
}
export async function recoveryPreflight({ state, claim, record, agent, prState, now = Date.now() }) {
  if (!(await readJson(join(state, 'linear-loop.json')))?.enabled) throw new Error('loop is off');
  if (await readJson(join(state, 'claims', `${claim.issue}.stop`))) throw new Error('stop requested');
  if (!sameAttempt(claim, record)) throw new Error('claim/session/runtime generation mismatch');
  if (workerHealth(claim, record).state !== 'interrupted') throw new Error('worker is not confirmed interrupted');
  const p = lifecyclePaths(state, claim), schedule = await readJson(p.schedule);
  const decision = retryDecision(record, progressBudget(claim, schedule), now);
  if (!decision.due || decision.blocked) throw new Error(decision.blocked || `retry deferred until ${decision.retryAt}`);
  const siblings = await workerReports(state);
  for (const sibling of siblings.filter(r => r.issue !== claim.issue && r.runtime === runtimeOf(claim))) {
    if (sibling.state === 'running' || sibling.state === 'suspect') {
      const siblingClaim = await readJson(join(state, 'claims', `${sibling.issue}.json`));
      const budget = await readJson(lifecyclePaths(state, siblingClaim).schedule);
      if (budget?.attempts > 0) throw new Error('another recovery is active in this runtime');
    }
    if (sibling.schedule?.retryAt && Date.parse(sibling.schedule.retryAt) > now) {
      const siblingClaim = await readJson(join(state, 'claims', `${sibling.issue}.json`));
      const siblingRecord = await currentAttempt(state, siblingClaim);
      if (siblingRecord?.failure?.kind === 'quota') throw new Error(`runtime quota deferred until ${sibling.schedule.retryAt}`);
    }
  }
  const issue = await agent('show', claim.issue);
  if (['completed', 'canceled'].includes(issue.state?.type)) throw new Error('ticket completed/canceled; reconcile closure');
  if ((issue.inverseRelations?.nodes || []).some(r => r.type === 'blocks' && !['completed', 'canceled'].includes(r.issue?.state?.type))) throw new Error('direct prerequisite not delivered');
  if (await prState(record) === 'MERGED') throw new Error('PR merged; reconcile closure');
  const verdict = await agent('verdict', claim.issue, '--peek');
  if (claim.phase !== 'planning' && verdict.verdict !== 'approved') throw new Error('approval no longer current; reconcile feedback');
  if (claim.phase === 'planning' && ['declined', 'approved'].includes(verdict.verdict)) throw new Error('planning phase changed; reconcile verdict');
  const gate = await agent('independent', claim.issue);
  if (!gate.independent) throw new Error('dependency/surface gate refuses recovery');
  const latest = (await agent('claims')).find(c => c.issue === claim.issue);
  if (!latest || JSON.stringify(latest) !== JSON.stringify(claim)) throw new Error('claim changed during recovery');
  if (!(await readJson(join(state, 'linear-loop.json')))?.enabled || await readJson(join(state, 'claims', `${claim.issue}.stop`))) throw new Error('loop/stop changed during recovery');
  if (workerHealth(claim, record).state !== 'interrupted') throw new Error('process evidence changed');
  return { ...decision, progressPhase: claim.phase, attempts: decision.attempts + 1 };
}

export async function cleanupWorktree({ root, state, claim, pr, record, run, remove, release }) {
  if (!claim || pr.state !== 'MERGED' || !pr.headRefOid || !pr.mergeCommit?.oid) throw new Error('verified merged PR required');
  if (record) {
    const health = workerHealth(claim, record);
    if (['running', 'suspect', 'unknown'].includes(health.state)) throw new Error(`worker ${health.state}; preserve worktree`);
  } else throw new Error('no worker lifecycle evidence; preserve worktree');
  const entries = (await run('git', ['worktree', 'list', '--porcelain'], root)).split('\n\n');
  const matches = entries.filter(e => e.split('\n').includes(`branch refs/heads/${pr.headRefName}`));
  if (matches.length !== 1 || !pr.headRefName.includes(claim.issue)) throw new Error('ambiguous worktree');
  const cwd = matches[0].split('\n').find(l => l.startsWith('worktree ')).slice(9);
  if (cwd === root) throw new Error('refusing canonical checkout cleanup');
  if ((await run('git', ['rev-parse', 'HEAD'], cwd)).trim() !== pr.headRefOid) throw new Error('local commits differ from merged PR head');
  // GitHub's merged PR head is authoritative for squash coverage; require the
  // merge commit to be present in the fetched remote main as additional evidence.
  await run('git', ['merge-base', '--is-ancestor', pr.mergeCommit.oid, 'origin/main'], root);
  const inspect = () => run('git', ['status', '--porcelain=v1', '--untracked-files=all', '--ignored', '-z'], cwd);
  let dirty = await inspect();
  if (dirty && dirty !== '?? plan.md\0') throw new Error(`local changes/untracked/ignored files prevent cleanup: ${JSON.stringify(dirty)}`);
  if (dirty) {
    const plan = await readFile(join(cwd, 'plan.md'));
    const receipt = await readJson(join(state, 'workers', claim.issue, hash(claim.claimedAt), 'publication.json'));
    if (receipt?.claimedAt !== claim.claimedAt || receipt.hash !== hash(plan) || !receipt.document) throw new Error('plan differs from verified publication; preserve draft');
    await mkdir(join(state, 'workers', claim.issue, hash(claim.claimedAt), 'archive'), { recursive: true });
    await writeFile(join(state, 'workers', claim.issue, hash(claim.claimedAt), 'archive', 'plan.md'), plan, { mode: 0o600 });
  }
  // release verifies JAU-50 closure first, then invokes removal, then deletes claim.
  return release(async () => {
    if ((await inspect()) !== dirty || (await run('git', ['rev-parse', 'HEAD'], cwd)).trim() !== pr.headRefOid) throw new Error('worktree changed during closure verification');
    if (dirty) {
      const plan = await readFile(join(cwd, 'plan.md'));
      const receipt = await readJson(join(state, 'workers', claim.issue, hash(claim.claimedAt), 'publication.json'));
      if (hash(plan) !== receipt.hash) throw new Error('draft changed during cleanup');
      await rm(join(cwd, 'plan.md'));
    }
    try { await remove(cwd); }
    catch (error) {
      if (dirty) await writeFile(join(cwd, 'plan.md'), await readFile(join(state, 'workers', claim.issue, hash(claim.claimedAt), 'archive', 'plan.md')), { mode: 0o600 });
      throw error;
    }
  });
}
