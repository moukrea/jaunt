// JAU-62: every model wake-up leaves through one outbox, once, and a replay
// costs nothing. These cover the producers' dedup, the single outstanding
// batch, lost deliveries, and the watcher's own idle and transient behaviour.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, copyFile, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { wakeStore, wakeKey, REDELIVER_MS } from '../scripts/linear_wakes.mjs';
import { reportableErrors, transientError, TRANSIENT_STREAK, rateLimitedUntil, lowBudget } from '../scripts/linear_watch.mjs';

async function temporary(t) {
  const dir = await mkdtemp(join(tmpdir(), 'jaunt-wakes-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
const clock = (start = 1_000_000) => { const c = { t: start, now: () => c.t }; return c; };

test('one worker exit seen by the adapter and the watchdog leaves as one wake', async t => {
  const c = clock(), wakes = wakeStore(await temporary(t), c);
  const adapter = { wake: 'worker-finished', issue: 'JAU-61', attempt: 'a1', session: 's', code: 0 };
  const watchdog = { wake: 'worker-finished', workers: [{ issue: 'JAU-61', attempt: 'a1', state: 'finished' }], events: [] };
  assert.equal(wakeKey(adapter), wakeKey(watchdog));
  assert.equal(await wakes.deposit([adapter]), 1);
  assert.equal(await wakes.deposit([watchdog]), 0);
  const batch = await wakes.next();
  assert.equal(batch.wake, 'worker-finished');
  assert.equal(batch.issue, 'JAU-61');
  await wakes.delivered(batch.wakeId);
  await wakes.take(batch.wakeId);
  // Noticed late, after delivery: still the same fact.
  assert.equal(await wakes.deposit([watchdog]), 0);
  assert.equal(await wakes.next(), null);
  const { metrics } = await wakes.status();
  assert.deepEqual([metrics.deposited, metrics.duplicates, metrics.batches], [1, 2, 1]);
});

test('producers a few seconds apart share one batch', async t => {
  const c = clock(), wakes = wakeStore(await temporary(t), c);
  await wakes.deposit([{ wake: 'worker-finished', issue: 'JAU-61', attempt: 'a1' }]);
  c.t += 1000;
  assert.equal(await wakes.due({ settleMs: 5000 }), false);
  assert.equal(await wakes.next({ settleMs: 5000 }), null, 'still settling');
  await wakes.deposit([{ wake: 'board-changed', at: 'p2', events: [{ type: 'state-changed', ticket: 'JAU-61' }] }]);
  c.t += 4000;
  assert.equal(await wakes.due({ settleMs: 5000 }), true);
  const batch = await wakes.next({ settleMs: 5000 });
  assert.equal(batch.wake, 'batch');
  assert.deepEqual(batch.items.map(i => i.wake), ['worker-finished', 'board-changed']);
});

// JAU-70: four queued messages all read the same delivered event. Now the
// message names a batch, only one batch is ever outstanding, and a replay is
// answered before any model work.
test('a replayed wake is answered alreadyHandled and never queues another', async t => {
  const c = clock(), wakes = wakeStore(await temporary(t), c);
  await wakes.deposit([{ wake: 'board-changed', at: '08:37:45.902', events: [{ type: 'state-changed', ticket: 'JAU-70' }] }]);
  const first = await wakes.next();
  await wakes.delivered(first.wakeId);
  // More movement while the model has not taken the first batch: held back.
  for (const n of [1, 2, 3, 4]) {
    await wakes.deposit([{ wake: 'board-changed', at: `later-${n}`, events: [{ type: 'comment', ticket: 'JAU-70' }] }]);
    assert.equal(await wakes.next(), null, 'no second wake while one is outstanding');
  }
  const taken = await wakes.take(first.wakeId);
  assert.equal(taken.alreadyHandled, false);
  assert.equal(taken.pending, 4);
  for (let n = 0; n < 3; n++) assert.equal((await wakes.take(first.wakeId)).alreadyHandled, true);
  // A genuinely new human reply after the take is still delivered.
  const second = await wakes.next();
  assert.equal(second.wake, 'batch');
  assert.equal(second.items.length, 4);
  assert.notEqual(second.wakeId, first.wakeId);
  assert.equal((await wakes.take(first.wakeId)).alreadyHandled, true, 'an old id never takes the new batch');
  assert.equal((await wakes.take(second.wakeId)).alreadyHandled, false);
  assert.equal((await wakes.status()).metrics.alreadyHandled, 4);
});

test('a lost delivery is offered again; a taken one never is', async t => {
  const c = clock(), wakes = wakeStore(await temporary(t), c);
  await wakes.deposit([{ wake: 'worker-lost', issue: 'JAU-9', attempt: 'x' }]);
  const batch = await wakes.next();
  // Queue refused: offered again at once, same id.
  await wakes.delivered(batch.wakeId, false);
  assert.equal(await wakes.due(), true);
  assert.equal((await wakes.next()).wakeId, batch.wakeId);
  // Delivered but never taken (the output was never read): re-offered later.
  await wakes.delivered(batch.wakeId);
  c.t += REDELIVER_MS - 1;
  assert.equal(await wakes.next(), null);
  c.t += 1;
  assert.equal((await wakes.next()).wakeId, batch.wakeId);
  await wakes.take(batch.wakeId);
  c.t += 10 * REDELIVER_MS;
  assert.equal(await wakes.next(), null);
  const { metrics } = await wakes.status();
  assert.deepEqual([metrics.deliveryFailures, metrics.redeliveries], [1, 1]);
});

test('an unreadable outbox fails loudly instead of reading as empty', async t => {
  const dir = await temporary(t);
  await mkdir(join(dir, 'wakes'));
  await writeFile(join(dir, 'wakes/outbox.json'), '{torn');
  await assert.rejects(wakeStore(dir).next(), /wake outbox unreadable/);
});

// 23/09: one 503 produced activity-failed, then activity-recovered 30 s later.
test('transient activity errors are reported only when they persist', () => {
  assert.equal(transientError('graphql 503: Service Unavailable'), true);
  assert.equal(transientError('graphql 429: {"errors":[{"message":"ratelimited"}]}'), true);
  assert.equal(transientError('fetch failed'), true);
  assert.equal(transientError('JAU-2: issue not found'), false);
  assert.equal(transientError('graphql 400: bad query'), false);
  const streaks = new Map();
  const blip = [{ issue: 'JAU-77', error: 'graphql 503: <html>a</html>' }];
  assert.deepEqual(reportableErrors(blip, streaks), []);
  assert.deepEqual(reportableErrors([], streaks), [], 'cleared before the threshold: nothing to recover from');
  for (let n = 1; n < TRANSIENT_STREAK; n++) assert.deepEqual(reportableErrors([{ issue: 'JAU-77', error: `graphql 503: <html>${n}</html>` }], streaks), []);
  const persisting = reportableErrors([{ issue: 'JAU-77', error: 'graphql 503: <html>z</html>' }], streaks);
  assert.deepEqual(persisting, [{ issue: 'JAU-77', error: 'transient: graphql 503' }]);
  assert.deepEqual(reportableErrors([{ issue: 'JAU-77', error: 'graphql 503: other body' }], streaks), persisting, 'a changing body is not a new failure');
  assert.deepEqual(reportableErrors([{ issue: 'JAU-2', error: 'deleted ticket' }], new Map()), [{ issue: 'JAU-2', error: 'deleted ticket' }], 'a real failure is reported at once');
});

// The watcher fixture: a quiet board by default, a stubbed worker supervisor.
async function watchFixture(t, { pulse = "{at:new Date().toISOString(),tickets:{'JAU-1':{u:'1',s:'Backlog',c:'c1',cu:'1'}}}", sync = '{"errors":[]}', worker = 'null', agent = null } = {}) {
  const root = await temporary(t);
  await mkdir(join(root, 'scripts')); await mkdir(join(root, '.dev-state'));
  for (const name of ['linear_watch.mjs', 'linear_wakes.mjs']) await copyFile(new URL(`../scripts/${name}`, import.meta.url), join(root, 'scripts', name));
  await writeFile(join(root, '.dev-state/linear-loop.json'), '{"enabled":true}');
  await writeFile(join(root, 'scripts/linear_skills.mjs'), 'export const skillStore=()=>({wake:async()=>null});');
  await writeFile(join(root, 'scripts/linear_workers.mjs'), `let sent=false;export async function workerWake(){if(sent)return null;sent=true;return ${worker};}`);
  await writeFile(join(root, 'scripts/linear_agent.mjs'), agent ?? `
    import {appendFileSync} from 'node:fs';
    const cmd=process.argv[2];appendFileSync('calls.txt',cmd+'\\n');
    if(cmd==='sync-activity')console.log(${JSON.stringify(sync)});
    if(cmd==='wait')console.log('{"events":[]}');
    if(cmd==='pulse')console.log(JSON.stringify(${pulse}));
  `);
  const start = (...flags) => {
    const child = spawn(process.execPath, ['scripts/linear_watch.mjs', '--interval', '0.02', ...flags], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    const exited = new Promise(r => child.on('close', code => r({ code, out })));
    t.after(() => child.kill('SIGKILL'));
    return { child, exited, output: () => out };
  };
  return { root, start };
}
const pause = ms => new Promise(r => setTimeout(r, ms));
const race = (p, ms) => Promise.race([p, pause(ms).then(() => 'running')]);

test('an idle watcher never exits on a timer, and delivers a deposited wake within seconds', async t => {
  const { root, start } = await watchFixture(t);
  const w = start();
  // Many polls, and far past what used to be the periodic exit for this interval.
  assert.equal(await race(w.exited, 1500), 'running');
  assert.ok((await readFile(join(root, 'calls.txt'), 'utf8')).split('\n').filter(l => l === 'pulse').length > 5);
  assert.equal(w.output(), '');
  await wakeStore(join(root, '.dev-state')).deposit([{ wake: 'worker-finished', issue: 'JAU-61', attempt: 'a1', code: 0 }]);
  const { out } = await race(w.exited, 3000);
  const payload = JSON.parse(out);
  assert.equal(payload.wake, 'worker-finished');
  assert.ok(payload.wakeId);
  assert.equal(JSON.parse(await readFile(join(root, '.dev-state/linear-watch.json'), 'utf8')).wake, 'worker-finished');
});

test('a legacy --max-minutes watcher still ends interval-elapsed', async t => {
  const { start } = await watchFixture(t);
  const { out } = await race(start('--max-minutes', '0.005').exited, 3000);
  assert.equal(JSON.parse(out).wake, 'interval-elapsed');
});

test('a transient activity failure is held back until it persists', async t => {
  const { root, start } = await watchFixture(t, { sync: '{"errors":[{"issue":"JAU-77","error":"graphql 503: unavailable"}]}' });
  const w = start();
  // Persisting past the threshold: one activity-failed wake, normalised.
  const { out } = await race(w.exited, 5000);
  const payload = JSON.parse(out);
  assert.equal(payload.events[0].type, 'activity-failed');
  assert.equal(payload.events[0].errors[0].error, 'transient: graphql 503');
  assert.ok((await wakeStore(join(root, '.dev-state')).status()).metrics['suppressed:transient-activity'] >= TRANSIENT_STREAK - 1);
});

test('the watchdog hands a worker exit to the outbox instead of exiting on it', async t => {
  const { root } = await watchFixture(t, { worker: "{wake:'worker-finished',workers:[{issue:'JAU-61',attempt:'a1',state:'finished'}],events:[]}" });
  // A live watcher record, so the watchdog has nothing to report on its own.
  await writeFile(join(root, '.dev-state/linear-watch.json'), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), lastPollAt: new Date(Date.now() + 60_000).toISOString(), intervalSeconds: 30 }));
  const child = spawn(process.execPath, ['scripts/linear_watch.mjs', '--watchdog', '--interval', '0.02', '--grace', '600'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill('SIGKILL'));
  const exited = new Promise(r => child.on('close', r));
  assert.equal(await race(exited, 800), 'running');
  const status = await wakeStore(join(root, '.dev-state')).status();
  assert.equal(status.pending, 1);
  assert.equal(status.metrics.deposited, 1);
});

// 23/09 00:00 UTC: Linear answered 429 (2 M complexity points/h spent) and the
// watcher died `watcher-failed` for about an hour.
test('a 429 is a wait until the announced reset, not a failure', () => {
  const now = Date.parse('2026-09-23T00:00:00Z');
  assert.equal(rateLimitedUntil('graphql 503: nope', now), null);
  assert.equal(rateLimitedUntil('graphql 429 (reset 2026-09-23T00:20:00.000Z): ratelimited', now), Date.parse('2026-09-23T00:20:00Z'));
  assert.equal(rateLimitedUntil('graphql 429: no header', now), now + 5 * 60_000, 'no announced reset: back off five minutes');
  assert.equal(rateLimitedUntil('graphql 429 (reset 2026-09-23T09:00:00.000Z): far', now), now + 60 * 60_000, 'never blind for more than an hour at a time');
  assert.equal(lowBudget({ limit: 2_000_000, remaining: 400_000 }), true);
  assert.equal(lowBudget({ limit: 2_000_000, remaining: 1_700_000 }), false);
  assert.equal(lowBudget(null), false);
});

const limitedAgent = (resetInMs) => `
  import {appendFileSync} from 'node:fs';
  const cmd=process.argv[2];appendFileSync('calls.txt',cmd+'\\n');
  if(cmd==='sync-activity'){console.error('graphql 429 (reset '+new Date(Date.now()+${resetInMs}).toISOString()+'): ratelimited');process.exit(1);}
  if(cmd==='wait')console.log('{"events":[]}');
  if(cmd==='pulse')console.log('{"at":"x","tickets":{}}');
`;

test('a long Linear cut wakes the owner once, never as watcher-failed, and not again after a re-arm', async t => {
  const { root, start } = await watchFixture(t, { agent: limitedAgent(20 * 60_000) });
  const first = await race(start().exited, 3000);
  const payload = JSON.parse(first.out);
  assert.equal(payload.wake, 'linear-rate-limited');
  assert.ok(Date.parse(payload.until) > Date.now() + 15 * 60_000);
  const watch = JSON.parse(await readFile(join(root, '.dev-state/linear-watch.json'), 'utf8'));
  assert.equal(watch.wake, 'linear-rate-limited');
  assert.ok(watch.rateLimitedUntil);
  await wakeStore(join(root, '.dev-state')).take(payload.wakeId);
  // The pass re-arms while Linear is still cut: the same cut is not news.
  const again = start();
  assert.equal(await race(again.exited, 1500), 'running');
  assert.equal((await readFile(join(root, 'calls.txt'), 'utf8')).split('\n').filter(l => l === 'sync-activity').length, 2, 'no retry before the reset');
});

test('a short 429 is waited out silently and polling resumes', async t => {
  const { root, start } = await watchFixture(t, { agent: limitedAgent(1500) });
  const w = start();
  assert.equal(await race(w.exited, 2500), 'running');
  assert.ok((await readFile(join(root, 'calls.txt'), 'utf8')).split('\n').filter(l => l === 'sync-activity').length >= 2, 'polled again after the reset');
  assert.equal(w.output(), '');
});

test('with little budget left the watcher skips the activity sync and polls less often', async t => {
  const { root, start } = await watchFixture(t, { pulse: "{at:new Date().toISOString(),tickets:{},rateLimit:{limit:2000000,remaining:100000}}" });
  const w = start();
  assert.equal(await race(w.exited, 1000), 'running');
  const calls = (await readFile(join(root, 'calls.txt'), 'utf8')).trim().split('\n');
  assert.equal(calls.filter(l => l === 'sync-activity').length, 1, 'only the first poll, before the budget was known');
  assert.ok(calls.filter(l => l === 'pulse').length >= 2);
  assert.ok((await wakeStore(join(root, '.dev-state')).status()).metrics['suppressed:low-budget-sync'] >= 1);
  assert.equal(JSON.parse(await readFile(join(root, '.dev-state/linear-watch.json'), 'utf8')).rateLimit.remaining, 100000);
});
