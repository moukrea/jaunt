import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { waitStore, WAIT_PHASE, waitWake, assertWaitResolved, promoteWaitQueue } from '../scripts/linear_waits.mjs';
import { atomicJson, readJson, workerHealth, workerReports } from '../scripts/linear_workers.mjs';
import { writeClaim, registerAnswer, contendingClaims, closureStore, readWaitThread, syncWaitDiscussion } from '../scripts/linear_agent.mjs';
import { observeActivity, updateSubjects } from '../scripts/linear_activity.mjs';

async function fixture(t) {
  const stateDir = await mkdtemp(join(tmpdir(), 'jaunt-waits-'));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const c = { issue: 'JAU-999', claimedAt: '2026-09-22T00:00:00Z', runtime: 'codex', session: 'real-session', phase: 'implementing', workStartedAt: '2026-09-22T00:00:01Z' };
  const f = { stateDir, c, who: { runtime: c.runtime, session: c.session }, time: Date.parse('2026-09-22T01:00:00Z'), comments: [], calls: [], syncs: [], promotions: 0 };
  f.claimPath = join(stateDir, 'claims', `${c.issue}.json`);
  await atomicJson(f.claimPath, c); await atomicJson(join(stateDir, 'linear-loop.json'), { enabled: true });
  f.input = { pr: 100, reason: 'Peer unavailable', owner: 'release owner', nextAction: 'confirm exclusive coordinator handoff', resource: 'jaunt-production-release' };
  f.thread = async id => {
    if (f.offline) throw Error('Linear unavailable');
    return { identifier: id, comments: structuredClone(f.comments), relations: { nodes: [{ type: 'related', relatedIssue: { identifier: c.issue } }] } };
  };
  f.make = () => waitStore({ stateDir, now: () => f.time, readThread: f.thread, agentId: 'agent',
    verifyMerge: async () => { if (f.badProof) throw Error('merge not verified'); return { pr: 100, head: 'a'.repeat(40), merge: 'b'.repeat(40), cwd: '/isolated' }; },
    persistClaim: r => writeClaim(r, { stateDir }),
    publish: async (id, body, parent) => {
      f.calls.push({ id, body, parent });
      const comment = { id: `comment-${f.calls.length}`, body, createdAt: new Date(f.time).toISOString(), parent: parent ? { id: parent } : null, user: { id: 'agent' } };
      if (!f.dropCreate) f.comments.push(comment);
      if (f.lostResponse) { f.lostResponse = false; throw Error('lost create response'); }
      return { id: comment.id, activity: { ok: !f.labelFailure } };
    },
    syncDiscussion: async w => { f.syncs.push(structuredClone(w)); if (f.labelFailure) throw Error('label sync failed'); },
    promoteQueued: async () => { f.promotions++; return [{ ticket: 'JAU-998', claimedAt: 'other-cycle', runtime: 'codex', session: 'other-session' }]; },
  });
  f.store = f.make();
  f.begin = () => f.store.begin(c.issue, f.who, f.input);
  f.read = () => f.store.read(c.issue);
  f.reply = async body => {
    const w = await f.read(); f.time++;
    const r = { id: `human-${f.comments.length}`, body: typeof body === 'function' ? body(w) : body,
      createdAt: new Date(f.time).toISOString(), parent: { id: w.posts.request.id }, user: { id: 'human', email: 'human@example.invalid' } };
    f.comments.push(r); return r;
  };
  return f;
}

test('verified wait releases only completed file contention, preserves identity/history, and cannot be bypassed by claim or verdict', async t => {
  const f = await fixture(t);
  await assert.rejects(writeClaim({ ...f.c, phase: WAIT_PHASE }, { stateDir: f.stateDir }), /wait begin/);
  f.badProof = true; await assert.rejects(f.begin(), /merge not verified/);
  assert.equal((await readJson(f.claimPath)).phase, 'implementing'); f.badProof = false;
  await assert.rejects(f.store.begin(f.c.issue, { ...f.who, session: 'invented' }, f.input), /exact wait owner/);
  const w = await f.begin(), c = await readJson(f.claimPath);
  assert.equal(c.phase, WAIT_PHASE); assert.equal(c.workStartedAt, f.c.workStartedAt);
  assert.deepEqual(contendingClaims([c, { issue: 'JAU-2', phase: 'landing' }]).map(c => c.issue), ['JAU-2']);
  await writeClaim({ ...c }, { stateDir: f.stateDir });
  assert.equal((await f.read()).id, w.id);
  for (const phase of ['planning', 'implementing', 'queued']) await assert.rejects(writeClaim({ ...c, phase }, { stateDir: f.stateDir }), /post-merge/);
  for (const verdict of ['approved', 'feedback', 'declined']) {
    const r = await registerAnswer({ identifier: c.issue }, { verdict }, c, {}, [], 'agent', { persistClaim: () => assert.fail('old verdict must not mutate'), decidePhase: () => assert.fail('must not requeue') });
    assert.equal(r.phase, WAIT_PHASE);
  }
  await assert.rejects(assertWaitResolved(f.stateDir, c), /unresolved/);
  await assert.rejects(closureStore({ stateDir: f.stateDir }).release(c.issue), /unresolved/);
  assert.equal(f.promotions, 1); await f.make().reconcile(); assert.equal(f.promotions, 1);
});

test('resting external wait never overrides live process evidence; status shows overdue progress separately', async t => {
  const f = await fixture(t), w = await f.begin(), c = await readJson(f.claimPath);
  const r = { ...c, child: { pid: 123 }, wrapper: { pid: 124 }, endedAt: new Date(f.time).toISOString(), code: 0 };
  assert.equal(workerHealth(c, r, { identity: () => 'gone' }).state, 'resting');
  assert.equal(workerHealth(c, r, { identity: () => 'alive' }).state, 'suspect');
  f.time = Date.parse(w.deadline) + 1;
  const reports = await workerReports(f.stateDir, { now: f.time });
  assert.equal(reports[0].state, 'unknown'); assert.equal(reports[0].progress.overdue, true);
  assert.equal(reports[0].progress.owner, f.input.owner);
});

test('deadline, restart, Linear-only replies and event acknowledgement are durable and bounded', async t => {
  const f = await fixture(t), w = await f.begin();
  f.time = Date.parse(w.deadline) + 1;
  assert.equal((await waitWake(f.stateDir, f.time)).wake, 'wait-overdue');
  assert.equal(await waitWake(f.stateDir, f.time + 1), null);
  const first = await f.make().reconcile();
  assert.ok(first.events.some(e => e.type === 'wait-overdue')); assert.equal(f.calls.length, 2);
  assert.equal((await f.make().reconcile()).events.length, 0); assert.equal(f.calls.length, 2);
  const reply = await f.reply('Le peer retient le message, voici ma correction.');
  const withReply = await f.make().reconcile();
  const event = withReply.events.find(e => e.type === 'wait-reply');
  assert.equal(event.comment, reply.id); assert.equal(event.session, f.c.session);
  await f.store.acknowledge(f.c.issue, event.id, 'same owner read the reply');
  f.time += 300001;
  assert.ok(!(await f.make().reconcile()).events.some(e => e.id === event.id));
  assert.equal((await f.read()).state, 'open');
  assert.equal(f.calls.length, 2, 'no repeated deadline comments');
});

test('network-created comment with lost response is recovered; label failure never republishes', async t => {
  const f = await fixture(t); f.lostResponse = true;
  let w = await f.begin(); assert.match(w.error, /lost create/); assert.equal(f.calls.length, 1);
  f.time += 300001; await f.make().reconcile(); w = await f.read();
  assert.equal(w.posts.request.id, 'comment-1'); assert.equal(f.calls.length, 1);
  f.labelFailure = true; f.time = Date.parse(w.deadline) + 1;
  await f.store.reconcile(); assert.equal(f.calls.length, 1);
  f.labelFailure = false; f.time += 300001; await f.store.reconcile();
  assert.equal(f.calls.length, 2, 'only the new deadline message');
});

test('ambiguous absent create is never blindly retried; API retries stop after three attempts', async t => {
  const f = await fixture(t); f.dropCreate = true; f.lostResponse = true;
  await f.begin();
  for (let i = 0; i < 5; i++) { f.time += 300001; await f.make().reconcile(); }
  const w = await f.read(); assert.equal(w.failures, 3); assert.equal(f.calls.length, 1); assert.match(w.error, /ambiguous/);
  assert.equal((await readJson(f.claimPath)).phase, 'implementing', 'no files released before the wait is visible');
});

test('stopped and disabled loop preserve waiting evidence without alerts or resolutions', async t => {
  const f = await fixture(t), w = await f.begin(); f.time = Date.parse(w.deadline) + 1;
  await atomicJson(join(f.stateDir, 'claims', `${f.c.issue}.stop`), { stop: true });
  assert.equal(await waitWake(f.stateDir, f.time), null);
  assert.match((await f.store.reconcile()).errors[0].error, /stop/); assert.equal(f.calls.length, 1);
  await rm(join(f.stateDir, 'claims', `${f.c.issue}.stop`));
  await atomicJson(join(f.stateDir, 'linear-loop.json'), { enabled: false });
  assert.equal(await waitWake(f.stateDir, f.time), null);
  await assert.rejects(f.store.resolve(f.c.issue, f.who, { evidence: 'observed' }), /loop is off/);
  assert.equal((await f.read()).id, w.id);
});

test('silence, reactions, bot/old/unrelated replies and newer corrections never count as the action decision', async t => {
  const f = await fixture(t); await f.begin();
  const resolve = comment => f.store.resolve(f.c.issue, f.who, { comment, evidence: 'observed outcome' });
  await assert.rejects(resolve('old-plan'), /latest explicit/);
  const free = await f.reply('/approve'); await assert.rejects(resolve(free.id), /latest explicit/);
  const yes = await f.reply(w => `/wait ${w.id} approve`);
  const correct = await f.reply('Attends, je corrige la demande.');
  await assert.rejects(resolve(yes.id), /latest explicit/);
  f.comments.splice(f.comments.indexOf(correct), 1);
  yes.botActor = { id: 'bot' }; await assert.rejects(resolve(yes.id), /latest explicit/); delete yes.botActor;
  yes.parent = null; await assert.rejects(resolve(yes.id), /latest explicit/);
  yes.parent = { id: (await f.read()).posts.request.id };
  const result = await resolve(yes.id);
  assert.equal(result.state, 'resolved'); assert.equal(result.discussionResolved, true);
  await assert.rejects(assertWaitResolved(f.stateDir, await readJson(f.claimPath)), /routing events unacknowledged/);
  for (const event of (await f.read()).events.filter(e => !e.acknowledged && ['wait-reply', 'wait-queued-ready'].includes(e.type))) {
    await f.store.acknowledge(f.c.issue, event.id, 'recipient processing observed');
  }
  await assertWaitResolved(f.stateDir, await readJson(f.claimPath));
  assert.equal((await readJson(f.claimPath)).phase, WAIT_PHASE, 'does not restart implementation');
  assert.equal(f.calls.length, 2); await resolve(yes.id); assert.equal(f.calls.length, 2);
});

test('peer unavailable/held outcomes remain attempts, not approval; reschedule requires evidence', async t => {
  const f = await fixture(t); await f.begin();
  for (const result of ['peer silent', 'peer inaccessible', 'accepted but held for review']) {
    await f.store.attempt(f.c.issue, f.who, { action: 'request handoff', result });
  }
  assert.equal((await f.read()).attempts.length, 3); assert.equal((await f.read()).state, 'open');
  const deadline = new Date(f.time + 1800000).toISOString();
  await assert.rejects(f.store.attempt(f.c.issue, f.who, { action: 'retry', result: 'scheduled', deadline }), /evidence/);
  await f.store.attempt(f.c.issue, f.who, { action: 'contact owner', result: 'new deadline agreed', evidence: 'Linear reply', deadline });
  assert.equal((await f.read()).generation, 2);
});

test('transfer requires a verified related target included in the approved action', async t => {
  const f = await fixture(t); f.input.nextAction = 'transfer coordination to JAU-1000'; await f.begin();
  const yes = await f.reply(w => `/wait ${w.id} approve`);
  await assert.rejects(f.store.resolve(f.c.issue, f.who, { comment: yes.id, evidence: 'transfer', ticket: 'JAU-100' }), /not part/);
  await assert.rejects(f.store.resolve(f.c.issue, f.who, { comment: yes.id, evidence: 'transfer', ticket: 'JAU-1001' }), /not part/);
  const w = await f.store.resolve(f.c.issue, f.who, { comment: yes.id, evidence: 'related target owns explicit obligation', ticket: 'JAU-1000' });
  assert.equal(w.resolution.ticket, 'JAU-1000');
});

test('wait thread fetch paginates explicitly requested Done ticket, refuses incomplete pages', async () => {
  const calls = [];
  const thread = await readWaitThread('JAU-999', async (_q, v) => {
    calls.push(v); return { issue: { identifier: v.id, comments: { nodes: [{ id: v.cursor || 'first' }], pageInfo: { hasNextPage: !v.cursor, endCursor: 'second' } } } };
  });
  assert.equal(thread.comments.length, 2); assert.deepEqual(calls.map(c => c.cursor), [null, 'second']);
  await assert.rejects(readWaitThread('JAU-999', async () => ({ issue: { identifier: 'JAU-999', comments: { nodes: [] } } })), /incomplete/);
});

test('discussion wait stays open on acknowledgement, resolution touches only its subjects and remains unread', () => {
  const request = { id: 'request', createdAt: '2026-09-22T00:01:00Z', body: '**Attendu de toi :** confirm handoff', user: { id: 'agent' }, reactions: [] };
  const response = { id: 'reply', createdAt: '2026-09-22T00:02:00Z', body: 'approve scoped action', user: { id: 'human', email: 'h@example.invalid' } };
  const issue = { createdAt: '2026-09-22T00:00:00Z', comments: [request, response] };
  let ledger = observeActivity({ version: 1, issue: 'JAU-999', revision: 0, since: issue.createdAt, subjects: [{ key: 'unrelated', source: 'issue', title: 'other work', owner: 'worker', state: 'open' }], technical: [] }, issue, 'agent');
  assert.equal(ledger.active, true); assert.equal(ledger.unread, false);
  ledger = updateSubjects(ledger, { revision: ledger.revision, subjects: ledger.subjects.filter(s => s.key !== 'unrelated').map(s => ({ ...s, state: 'resolved', reason: 'outcome verified', evidence: 'receipt' })) }, issue.comments);
  issue.comments.push({ id: 'resolution', createdAt: '2026-09-22T00:03:00Z', body: 'resolved', user: { id: 'agent' }, reactions: [] });
  ledger = observeActivity(ledger, issue, 'agent');
  assert.equal(ledger.unread, true); assert.equal(ledger.subjects.find(s => s.key === 'unrelated').state, 'open');
});

test('exhausted label retries still discover Linear replies and preserve pending-admission session refresh', async t => {
  const f = await fixture(t); f.labelFailure = true;
  await f.begin();
  for (let i = 0; i < 3; i++) { f.time += 300001; await f.make().reconcile(); }
  assert.equal((await f.read()).failures, 3);
  const c = await readJson(f.claimPath); assert.equal(c.phase, 'implementing');
  await writeClaim({ ...c }, { stateDir: f.stateDir });
  const reply = await f.reply('La réponse est uniquement ici, dans Linear.');
  const result = await f.make().reconcile();
  assert.ok(result.events.some(e => e.comment === reply.id));
  assert.equal(f.calls.length, 1, 'label failures do not duplicate request');
  f.labelFailure = false; f.time += 300001; await f.make().reconcile();
  assert.equal((await readJson(f.claimPath)).phase, WAIT_PHASE);
});

test('lost attempt response is reconciled by marker without recording a new attempt', async t => {
  const f = await fixture(t); await f.begin(); f.lostResponse = true;
  await assert.rejects(f.store.attempt(f.c.issue, f.who, { action: 'handoff', result: 'held' }), /lost create/);
  assert.equal(f.calls.length, 2);
  await f.make().reconcile();
  assert.equal((await f.read()).posts['attempt-1'].id, 'comment-2');
  assert.equal((await f.read()).attempts.length, 1); assert.equal(f.calls.length, 2);
});

test('stop arriving during a network read prevents the next publication', async t => {
  const f = await fixture(t); await f.begin();
  const original = f.thread;
  f.thread = async id => {
    const result = await original(id);
    await atomicJson(join(f.stateDir, 'claims', `${f.c.issue}.stop`), { stop: true });
    return result;
  };
  f.store = f.make();
  await assert.rejects(f.store.attempt(f.c.issue, f.who, { action: 'inspect peer', result: 'unavailable' }), /stop requested/);
  assert.equal(f.calls.length, 1);
});

test('queue sweep rejects fresh feedback, stop, dependencies and changed owners; crash recovery preserves promoted routing', async () => {
  const candidate = { issue: 'JAU-1', claimedAt: 'cycle', runtime: 'codex', session: 'exact', phase: 'queued' };
  let held = { ...candidate }, allowed = true, answer = 'approved', independent = true, promotions = 0;
  const deps = { claims: async () => [held], enabled: async () => allowed, verdict: async () => ({ verdict: answer }),
    independent: async () => ({ independent }), ready: async () => { promotions++; held = { ...held, phase: 'implementing' }; return { promoted: true }; } };
  answer = 'feedback'; assert.deepEqual(await promoteWaitQueue([candidate], deps), []);
  answer = 'approved'; allowed = false; assert.deepEqual(await promoteWaitQueue([candidate], deps), []);
  allowed = true; independent = false; assert.deepEqual(await promoteWaitQueue([candidate], deps), []);
  independent = true; held = { ...candidate, session: 'replacement' }; assert.deepEqual(await promoteWaitQueue([candidate], deps), []);
  held = { ...candidate };
  const first = await promoteWaitQueue([candidate], deps); assert.equal(first[0].session, 'exact'); assert.equal(promotions, 1);
  assert.deepEqual(await promoteWaitQueue([candidate], deps), first, 'replayed journal recovers routing after prior promotion');
  assert.equal(promotions, 1);
});

test('actual wait discussion integration closes only its decision and expectation, retains revision guard and transfer evidence', async () => {
  const w = { issue: 'JAU-1', state: 'resolved', posts: { request: { id: 'request' } }, resolution: { comment: 'reply', evidence: 'verified receipt' } };
  let ledger = { revision: 4, subjects: [
    { key: 'expect:request', source: 'request', state: 'open' },
    { key: 'feedback:reply', source: 'reply', state: 'open' },
    { key: 'unrelated', source: 'issue', state: 'open' },
  ] }, patch, checks = 0;
  const service = { sync: async () => ({ ok: true }), read: async () => ledger, update: async (_id, p) => { patch = p; } };
  await syncWaitDiscussion(w, { service, check: async () => { checks++; } });
  assert.equal(checks, 2); assert.equal(patch.revision, 4);
  assert.deepEqual(patch.subjects.map(s => s.key), ['expect:request', 'feedback:reply']);
  assert.ok(patch.subjects.every(s => s.evidence === 'verified receipt' && s.state === 'resolved'));
  let called = false;
  await assert.rejects(syncWaitDiscussion(w, { service: { ...service, update: () => { called = true; } }, check: async () => { if (++checks > 3) throw Error('stop'); } }), /stop/);
  assert.equal(called, false);
});

test('lost request response and exhausted offline retries recover request before routing human input', async t => {
  const f = await fixture(t); f.lostResponse = true; await f.begin();
  f.offline = true;
  for (let i = 0; i < 3; i++) { f.time += 300001; await f.make().reconcile(); }
  assert.equal((await f.read()).failures, 3);
  f.time++;
  f.comments.push({ id: 'only-linear', body: 'Voici ma réponse', createdAt: new Date(f.time).toISOString(), parent: { id: 'comment-1' }, user: { id: 'human', email: 'h@example.invalid' } });
  f.offline = false;
  const result = await f.make().reconcile();
  assert.ok(result.events.some(e => e.comment === 'only-linear'));
  assert.equal((await f.read()).posts.request.id, 'comment-1');
  assert.equal(f.calls.filter(c => c.body.includes(':request -->')).length, 1);
});

test('Linear correction revises the immutable action without carrying over old approval', async t => {
  const f = await fixture(t); const old = await f.begin();
  const correction = await f.reply('Transférer plutôt à JAU-1000.');
  const revised = await f.store.revise(f.c.issue, f.who, { action: 'transfer to JAU-1000', reason: 'human requested transfer', comment: correction.id });
  assert.notEqual(revised.id, old.id); assert.equal(revised.history[0].id, old.id);
  assert.equal(revised.history[0].supersededBy, correction.id);
  assert.equal((await f.store.decision(f.c.issue, f.who)).verdict, 'pending');
  const yes = await f.reply(w => `/wait ${w.id} approve`);
  const decision = await f.store.decision(f.c.issue, f.who);
  assert.equal(decision.verdict, 'approved'); assert.equal(decision.comment, yes.id);
  assert.equal((await f.read()).state, 'open', 'decision is not delivery');
});
