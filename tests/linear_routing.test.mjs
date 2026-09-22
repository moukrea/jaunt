import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routingStore, humanInput, bindingOf, routePreflight, acceptRoute, routeReceiptPath } from '../scripts/linear_routing.mjs';
import { atomicJson, readJson, hash } from '../scripts/linear_workers.mjs';
import { readRoutingThread, readAnswer } from '../scripts/linear_agent.mjs';
import { routeWake } from '../scripts/linear_watch.mjs';

const event = { wake: 'board-changed', events: [{ type: 'comment', ticket: 'JAU-1' }] };
const human = { id: 'human', email: 'human@example.invalid' };
const bot = { id: 'agent', email: 'agent@oauthapp.linear.app' };
const comment = (body = 'Please adjust this') => ({ id: 'reply', body, createdAt: '2026-09-22T10:00:00Z', user: human, reactions: [] });
async function fixture(t) {
  const state = await mkdtemp(join(tmpdir(), 'jaunt-routing-'));
  t.after(() => rm(state, { recursive: true, force: true }));
  const f = { state, claim: { issue: 'JAU-1', claimedAt: '2026-09-22T09:00:00Z', runtime: 'codex', session: 'exact', phase: 'awaiting-approval' },
    report: { issue: 'JAU-1', state: 'resting', attempt: 'old' },
    thread: { identifier: 'JAU-1', state: { type: 'started' }, agentId: 'agent', comments: [comment()] },
    verdict: { verdict: 'feedback' }, stop: false, calls: [], launches: 0 };
  await atomicJson(join(state, 'linear-loop.json'), { enabled: true });
  f.agent = async (...args) => {
    f.calls.push(args);
    const [cmd] = args;
    if (cmd === 'claims') return [f.claim];
    if (cmd === 'workers') return [f.report];
    if (cmd === 'routing-thread') return f.thread;
    if (cmd === 'stop-requested') return { stop: f.stop };
    if (cmd === 'verdict') { assert.equal(args[2], '--peek'); return f.verdict; }
    assert.fail(`unexpected command ${cmd}`);
  };
  f.launch = async route => {
    f.launched = route; f.launches++;
    await atomicJson(routeReceiptPath(state, route.key), { state: 'accepted', attempt: 'new' });
    return { outcome: 'handled' };
  };
  f.store = () => routingStore({ state, agent: f.agent, launch: route => f.launch(route) });
  f.run = e => f.store().drainPendingRoutes(e || event);
  return f;
}
for (const verdict of ['approved', 'declined', 'feedback']) test(`${verdict} routes to exact worker without registering approval or owner wake`, async t => {
  const f = await fixture(t); f.verdict = { verdict };
  assert.equal((await f.run()).event, null);
  assert.deepEqual(f.launched.binding, bindingOf(f.claim));
  assert.equal(f.launches, 1);
  assert.equal((await f.run()).event, null);
  assert.equal(f.launches, 1, 'durable replay receipt across store restart');
});
test('active worker reply survives restart and drains on a quiet poll', async t => {
  const f = await fixture(t); f.report.state = 'running';
  assert.equal((await f.run()).outcomes[0].outcome, 'deferred');
  assert.equal(f.launches, 0);
  f.report.state = 'finished';
  assert.equal((await f.run({ wake: 'board-changed', events: [] })).event, null);
  assert.equal(f.launches, 1);
  assert.equal((await f.run({ wake: 'board-changed', events: [] })).outcomes.length, 0);
});
test('newer human correction and reaction replacement change fingerprints, own writes do not', async t => {
  const f = await fixture(t);
  const first = humanInput(f.thread, f.claim);
  f.thread.comments.push({ ...comment('ack'), id: 'agent-comment', user: bot });
  assert.equal(humanInput(f.thread, f.claim), first);
  f.thread.comments[0].body = 'Edited feedback';
  assert.notEqual(humanInput(f.thread, f.claim), first);
  f.thread.comments = [{ ...comment('plan'), id: 'plan', user: bot, reactions: [{ emoji: '+1', user: human, createdAt: '2026-09-22T10:01:00Z' }] }];
  const approved = humanInput(f.thread, f.claim);
  f.thread.comments[0].reactions[0].emoji = '-1';
  assert.notEqual(humanInput(f.thread, f.claim), approved);
  f.thread.comments[0].reactions[0].emoji = '+1';
  f.thread.comments.push({ ...comment('Actually, change the scope'), createdAt: '2026-09-22T10:02:00Z' });
  const plan = f.thread.comments[0];
  f.verdict = readAnswer({ identifier: 'JAU-1' }, plan, new Date(plan.createdAt), f.thread.comments, bot.id);
  assert.equal(f.verdict.verdict, 'feedback');
  assert.equal((await f.run()).event, null);
});
for (const verdict of ['pending', 'no-plan']) test(`${verdict} never becomes an implementation approval`, async t => {
  const f = await fixture(t); f.verdict = { verdict };
  assert.ok((await f.run()).event); assert.equal(f.launches, 0);
});
for (const field of ['session', 'claimedAt', 'runtime']) test(`deferred route never migrates to changed ${field}`, async t => {
  const f = await fixture(t); f.report.state = 'running'; await f.run();
  f.report.state = 'finished'; f.claim[field] = field === 'runtime' ? 'claude' : 'changed';
  const r = await f.run({ wake: 'board-changed', events: [] });
  assert.match(r.outcomes[0].reason, /identity changed/); assert.equal(f.launches, 0);
});
test('legacy runtime remains Claude', async t => {
  const f = await fixture(t); delete f.claim.runtime;
  await f.run(); assert.equal(f.launched.binding.runtime, 'claude');
});
for (const state of ['unknown', 'suspect', 'suspended', 'interrupted']) test(`${state} reply is escalated, never ordinary resume`, async t => {
  const f = await fixture(t); f.report.state = state;
  assert.ok((await f.run()).event); assert.equal(f.launches, 0);
});
test('mixed batches preserve structural events and prohibit routing their ticket', async t => {
  const f = await fixture(t);
  const changed = { type: 'ticket-edited', ticket: 'JAU-1' };
  const result = await f.run({ ...event, events: [...event.events, changed, { type: 'ticket-created', ticket: 'JAU-2' }] });
  assert.deepEqual(result.event.events.slice(0, 3), [...event.events, changed, { type: 'ticket-created', ticket: 'JAU-2' }]);
  assert.equal(f.launches, 0);
  const next = await f.run({ ...event, events: [...event.events, { type: 'ticket-created', ticket: 'JAU-2' }] });
  assert.equal(f.launches, 1); assert.deepEqual(next.event.events, [{ type: 'ticket-created', ticket: 'JAU-2' }]);
});
test('loop-off and stop retain pending route without launching', async t => {
  const f = await fixture(t); f.stop = true;
  assert.equal((await f.run()).outcomes[0].outcome, 'deferred');
  f.stop = false; await atomicJson(join(f.state, 'linear-loop.json'), { enabled: false });
  assert.equal((await f.run()).outcomes[0].outcome, 'deferred');
  assert.equal(f.launches, 0);
  await atomicJson(join(f.state, 'linear-loop.json'), { enabled: true });
  await f.run({ wake: 'board-changed', events: [] }); assert.equal(f.launches, 1);
});
test('external waits and normal completions remain orchestrator-owned', async t => {
  const f = await fixture(t);
  for (const wake of ['external-wait', 'worker-finished', 'worker-lost', 'skills-changed']) {
    const e = { wake, events: [{ type: 'wait-reply', ticket: 'JAU-1' }] };
    assert.deepEqual((await f.run(e)).event, e);
  }
  f.claim.phase = 'awaiting-external'; assert.ok((await f.run()).event);
  assert.equal(f.launches, 0); assert.equal(f.calls.some(c => c[0] === 'verdict'), false);
});
test('unreadable evidence and launch refusals preserve fallback, not success', async t => {
  const f = await fixture(t); f.thread.comments[0].user = { id: 'unknown' };
  assert.match((await f.run()).outcomes[0].reason, /ambiguous author/);
  f.thread.comments[0].user = human; f.launch = async () => { throw Error('launch refused'); };
  assert.match((await f.run()).outcomes[0].reason, /launch refused/);
  assert.equal((await readJson(join(f.state, 'routing/pending/JAU-1.json'))).outcome, 'escalate');
});
test('guarded recovery due uses recovery route; cooldown retains it and exhausted budget escalates', async t => {
  const f = await fixture(t); f.report.state = 'interrupted'; f.report.schedule = { due: false };
  const e = { wake: 'worker-recovery-due', events: [], workers: [{ issue: 'JAU-1', attempt: 'old' }] };
  assert.equal((await f.run(e)).outcomes[0].outcome, 'deferred'); assert.equal(f.launches, 0);
  f.report.schedule = { due: true }; assert.equal((await f.run(e)).event, null);
  assert.equal(f.launched.kind, 'recovery');
  f.report.attempt = 'other'; f.report.schedule = { blocked: 'retry budget exhausted' };
  assert.match((await f.run({ ...e, workers: [{ issue: 'JAU-1', attempt: 'other' }] })).outcomes[0].reason, /exhausted/);
});
test('route acceptance recovers response loss but never replays an uncertain launch', async t => {
  const f = await fixture(t), route = { key: hash('route'), binding: bindingOf(f.claim) };
  let starts = 0;
  const record = { attempt: 'attempt', routeKey: route.key, wrapper: { pid: 123 }, heartbeatAt: 'now' };
  const args = { state: f.state, route, check: async () => {}, begin: async () => record,
    start: async () => { starts++; throw Error('response lost'); } };
  await assert.rejects(acceptRoute(args), /response lost/);
  await assert.rejects(acceptRoute({ ...args, current: null }), /uncertain route/);
  assert.equal((await acceptRoute({ ...args, current: record })).outcome, 'handled');
  assert.equal((await acceptRoute(args)).outcome, 'handled'); assert.equal(starts, 1);
});
test('acceptance crash before attempt creation is retained without retrying begin', async t => {
  const f = await fixture(t), route = { key: hash('gap'), binding: bindingOf(f.claim) };
  let begins = 0;
  const args = { state: f.state, route, check: async () => {}, begin: async () => { begins++; throw Error('crash'); } };
  await assert.rejects(acceptRoute(args), /crash/);
  await assert.rejects(acceptRoute(args), /uncertain/); assert.equal(begins, 1);
});
test('launch preflight rechecks identity, input, PR, flags and process under lock', async t => {
  const f = await fixture(t), owner = { thread: 'owner', pid: 123, started: 'boot', runtime: 'codex' };
  const route = { binding: bindingOf(f.claim), sourceAttempt: 'old', input: humanInput(f.thread, f.claim), kind: 'reply' };
  const record = { attempt: 'old', owner, code: 0 };
  const args = { state: f.state, route, claim: f.claim, record, owner, alive: () => true, agent: f.agent, health: () => ({ state: 'resting' }), prState: async () => 'OPEN' };
  assert.equal(await routePreflight(args), true);
  await assert.rejects(routePreflight({ ...args, alive: () => false }), /owner/);
  await assert.rejects(routePreflight({ ...args, owner: { ...owner, started: 'recycled' } }), /owner/);
  await assert.rejects(routePreflight({ ...args, record: { ...record, failure: { kind: 'quota' } } }), /recovery/);
  await assert.rejects(routePreflight({ ...args, health: () => ({ state: 'running' }) }), /resting/);
  await assert.rejects(routePreflight({ ...args, prState: async () => 'MERGED' }), /merged/);
  await assert.rejects(routePreflight({ ...args, route: { ...route, binding: { ...route.binding, session: 'other' } } }), /changed/);
  await atomicJson(join(f.state, 'claims/JAU-1.stop'), { reason: 'halt' });
  await assert.rejects(routePreflight(args), /stop requested/);
  await rm(join(f.state, 'claims/JAU-1.stop'));
  f.thread.comments[0].body = 'new words'; await assert.rejects(routePreflight(args), /input changed/);
});
test('thread reader paginates, includes attribution and refuses truncated pages', async () => {
  const cursors = [];
  const result = await readRoutingThread('JAU-1', async (query, vars) => {
    assert.match(query, /botActor/); assert.match(query, /reactions/); assert.match(query, /email/);
    cursors.push(vars.cursor);
    return { issue: { identifier: 'JAU-1', state: { type: 'started' }, comments: { nodes: [comment()], pageInfo: { hasNextPage: !vars.cursor, endCursor: 'next' } } } };
  });
  assert.deepEqual(cursors, [null, 'next']); assert.equal(result.comments.length, 2);
  await assert.rejects(readRoutingThread('JAU-1', async () => ({ issue: { identifier: 'JAU-1', comments: { nodes: [] } } })), /incomplete/);
});
test('watcher routing keeps handled events polling and preserves errors/unresolved batches', async () => {
  assert.equal(await routeWake(event, async () => ({ event: null, outcomes: [] })), null);
  assert.deepEqual(await routeWake(event, async () => ({ event, outcomes: [] })), event);
  const failed = await routeWake(event, async () => { throw Error('offline'); });
  assert.deepEqual(failed.events, event.events); assert.equal(failed.routingError, 'offline');
});

for (const role of ['watcher', 'watchdog', 'external-wait']) test(`real ${role} polling preserves supervision around routing (offline)`, async t => {
  const { copyFile, mkdir, writeFile } = await import('node:fs/promises');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const root = await mkdtemp(join(tmpdir(), 'jaunt-route-watch-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'scripts')); await mkdir(join(root, '.dev-state'));
  await copyFile(new URL('../scripts/linear_watch.mjs', import.meta.url), join(root, 'scripts/linear_watch.mjs'));
  await writeFile(join(root, '.dev-state/linear-loop.json'), '{"enabled":true}');
  await writeFile(join(root, 'scripts/linear_skills.mjs'), 'export const skillStore=()=>({wake:async()=>null});');
  await writeFile(join(root, 'scripts/linear_workers.mjs'), `
    import {writeFile} from 'node:fs/promises';
    let calls=0;export async function workerWake(state){
      if(++calls===2) {await writeFile(state+'/linear-loop.json','{"enabled":false}');return null;}
      return {wake:'worker-recovery-due',workers:[{issue:'JAU-1',attempt:'one'}],events:[]};
    }
  `);
  await writeFile(join(root, 'scripts/linear_agent.mjs'), `
    import {readFileSync,writeFileSync} from 'node:fs';
    const cmd=process.argv[2];
    if(cmd==='sync-activity')console.log('{"errors":[]}');
    if(cmd==='wait')console.log('${role === 'external-wait' ? '{"events":[{"type":"wait-reply","issue":"JAU-1"}]}' : '{"events":[]}'}');
    if(cmd==='pulse'){
      let n=0;try{n=Number(readFileSync('polls'));}catch{}n++;writeFileSync('polls',String(n));
      if(n===4)writeFileSync('.dev-state/linear-loop.json','{"enabled":false}');
      console.log(JSON.stringify({at:String(n),tickets:{'JAU-1':{c:String(n),s:'Backlog',u:'same'}},activityErrors:[]}));
    }
  `);
  await writeFile(join(root, 'scripts/linear_codex.mjs'), `
    import {appendFileSync} from 'node:fs';
    appendFileSync('routed.jsonl',process.argv[4]+'\\n');
    console.log('{"event":null,"outcomes":[]}');
  `);
  const args = ['scripts/linear_watch.mjs', '--interval', '0.01', ...(role === 'watchdog' ? ['--watchdog', '--grace', '600'] : ['--max-minutes', '1'])];
  const result = await promisify(execFile)(process.execPath, args, { cwd: root, timeout: 5000, env: { ...process.env, JAUNT_LINEAR_ROUTING_OWNER: '{}' } });
  const report = JSON.parse(result.stdout);
  assert.equal(report.wake, role === 'external-wait' ? 'external-wait' : 'loop-off');
  const { readFile } = await import('node:fs/promises');
  if (role === 'external-wait') await assert.rejects(readFile(join(root, 'routed.jsonl')), { code: 'ENOENT' });
  else {
    const routed = (await readFile(join(root, 'routed.jsonl'), 'utf8')).trim().split('\n');
    assert.equal(routed.length, role === 'watchdog' ? 1 : 3, 'handled events did not end polling');
  }
});

test('concurrent routers serialize the same input without a second launch', async t => {
  const f = await fixture(t);
  const launch = f.launch;
  f.launch = async route => { await new Promise(r => setTimeout(r, 20)); return launch(route); };
  const results = await Promise.all([f.run(), f.run()]);
  assert.equal(f.launches, 1);
  assert.ok(results.some(r => r.event === null));
  assert.equal((await f.run()).event, null); assert.equal(f.launches, 1);
});
test('replayed recovery wake is acknowledged after its accepted attempt advances', async t => {
  const f = await fixture(t);
  f.report.state = 'interrupted'; f.report.schedule = { due: true };
  const e = { wake: 'worker-recovery-due', workers: [{ issue: 'JAU-1', attempt: 'old' }], events: [] };
  assert.equal((await f.run(e)).event, null);
  f.report = { issue: 'JAU-1', state: 'running', attempt: 'new' };
  assert.equal((await f.run(e)).event, null); assert.equal(f.launches, 1);
});
