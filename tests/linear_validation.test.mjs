import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validationStore, readValidation, validationSnapshot, validationRequirement, channelCandidate, assertValidationResolved } from '../scripts/linear_validation.mjs';
import { atomicJson, readJson, hash, workerReports, beginAttempt } from '../scripts/linear_workers.mjs';
import { readValidationThread, readAnswer, writeClaim, registerAnswer, channelDelivery } from '../scripts/linear_agent.mjs';

const agent = { id: 'agent', email: 'agent@oauthapp.linear.app', name: 'Agent' };
const user = { id: 'human', email: 'human@example.invalid', name: 'Human' };
const source = 'a'.repeat(40), build = 'b'.repeat(40);
const repository = 'moukrea/jaunt', page = 'https://moukrea.github.io/jaunt/';
function channelFixture() {
  const tags = { host: 'v0.1.0-beta.1.ch.human.1.1', desktop: 'desktop-v0.1.0-beta.1.ch.human.1.1', android: 'android-v0.1.0-beta.1.ch.human.1.1' };
  const receipts = Object.fromEntries(Object.entries(tags).map(([k, tag]) => [k, { tag, sha: build, url: `https://github.com/${repository}/releases/tag/${tag}`, hashes: { 'artifact.bin': 'c'.repeat(64) } }]));
  const c = { source, sha: build, n: 1, run: '3', status: 'delivered', tags, receipts };
  const row = { name: 'human_1', pr: 1, n: 1, releaseSource: source, release: tags.host, desktopRelease: tags.desktop, androidRelease: tags.android };
  return { state: { schema: 1, channels: { human_1: { pr: 1, status: 'live', candidates: [c] } } },
    index: { version: 1, repository, page, channels: [row] }, document: { ...row, version: 1, channel: 'human_1', repository, page }, c };
}
async function fixture(t, requirement = 'required') {
  const stateDir = await mkdtemp(join(tmpdir(), 'jaunt-validation-'));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const claim = { issue: 'JAU-119', phase: 'implementing', claimedAt: '2026-09-24T00:00:00Z', updatedAt: '2026-09-24T00:00:00Z', session: 'exact', runtime: 'codex' };
  await atomicJson(join(stateDir, 'claims/JAU-119.json'), claim);
  await atomicJson(join(stateDir, 'linear-loop.json'), { enabled: true });
  let time = Date.parse(claim.claimedAt), commentId = 0;
  const f = { stateDir, claim, who: { session: claim.session, runtime: claim.runtime }, clock: () => new Date(time += 1000).toISOString(),
    publications: 0, releases: 0, restored: [], failPublish: false, losePublish: false, failRelease: false, failPersist: false, failSync: false };
  f.comment = (body, by = user, parent) => {
    const at = f.clock(), c = { id: `comment-${commentId++}`, body, user: by, createdAt: at, updatedAt: at, reactions: [], parent: parent ? { id: parent } : null };
    f.t.comments.push(c); return c;
  };
  f.t = { identifier: claim.issue, title: 'Fix under review', description: 'Try the product before main', comments: [], state: { name: 'In Review', type: 'started' } };
  const p = f.comment('<!-- jaunt-agent:plan -->\nApproved plan', agent);
  p.reactions.push({ emoji: '+1', user, createdAt: f.clock() });
  f.publication = { claimedAt: claim.claimedAt, document: 'doc', content: 'Plan content', documentHash: hash('Plan content'), comment: p.id, commentHash: hash(p.body), validation: validationRequirement(requirement, 'Explicitly approved scope') };
  f.publication.scopeHash = hash(JSON.stringify({ title: f.t.title, description: f.t.description }));
  f.pr = { number: 1, author: { login: 'human' }, state: 'OPEN', headRefOid: source, headRefName: 'agent/JAU-119', baseRefName: 'main', isCrossRepository: false };
  f.channel = channelFixture();
  f.current = () => readJson(join(stateDir, 'claims/JAU-119.json'));
  const persistence = { stateDir, readIssue: async () => f.t, moveState: async (_issue, to) => { f.restored.push(to); f.t.state.name = to; return { moved: true }; } };
  f.dependencies = { stateDir, agentId: agent.id, now: f.clock, readThread: async () => structuredClone(f.t), readPlan: async () => f.publication,
    planVerdict: (t, p, comments) => readAnswer(t, p, new Date(p.createdAt), comments, agent.id), readPr: async () => structuredClone(f.pr),
    readCandidate: async p => channelCandidate(f.channel.state, p, f.channel.index, f.channel.document, { repository, page }),
    readReviewer: async id => id === user.id ? user : agent,
    publish: async (_id, body, parent) => {
      f.publications++;
      if (f.failPublish) throw Error('create offline');
      const c = f.comment(body, agent, parent);
      if (f.losePublish) { f.losePublish = false; throw Error('lost create response'); }
      return c;
    },
    persistClaim: async (c, opts) => {
      if (f.failPersist) throw Error('persist failed');
      return writeClaim(c, { ...persistence, ...opts });
    },
    park: async c => {
      const parkedFrom = f.t.state.name;
      await writeClaim({ ...c, phase: 'awaiting-validation', parkedFrom }, persistence);
      f.t.state.name = 'Waiting for human';
    },
    assertCanWait: async () => { if (f.mergeAttempted) throw Error('reconcile attempted merge'); },
    releaseLanding: async () => { f.releases++; if (f.failRelease) throw Error('release unavailable'); },
    syncDiscussion: async () => { if (f.failSync) throw Error('discussion unavailable'); },
  };
  f.store = () => validationStore(f.dependencies);
  f.record = async () => readValidation(stateDir, await f.current());
  f.review = async (options = {}) => f.store().review(claim.issue, f.who, { pr: 1, snapshot: (await f.store().read(claim.issue)).snapshot, reason: 'Read all current instructions', ...options });
  f.begin = () => f.store().begin(claim.issue, f.who, { reviewer: user.id, procedure: 'Open the affected screen', expected: 'The corrected result' });
  f.accept = async () => { const c = f.comment('testé et validé', user, (await f.record()).request.post.id); await f.store().decision(claim.issue, f.who); return c; };
  f.verify = () => f.store().verify(claim, f.pr);
  return f;
}

test('exact current delivered candidate is required independently of source/build identities', () => {
  const f = channelFixture(), pr = { number: 1, author: { login: 'human' }, headRefOid: source };
  const check = () => channelCandidate(f.state, pr, f.index, f.document, { repository, page });
  assert.deepEqual([check().source, check().sha], [source, build]);
  f.state.channels.human_1.candidates.push({ ...f.c, n: 2, status: 'publishing' });
  assert.equal(check().n, 1);
  for (const change of [() => f.c.status = 'publishing', () => f.c.source = build,
    () => f.c.sha = source, () => f.document.releaseSource = build, () => f.index.channels[0].n = 9,
    () => f.document.version = 9, () => f.state.channels.human_1.status = 'removed', () => f.c.receipts.android.sha = source,
    () => f.c.receipts.desktop.hashes = {}, () => f.c.tags.host = 'wrong', () => f.index.repository = 'https://example.invalid/repo']) {
    const before = structuredClone(f); change(); assert.throws(check); Object.assign(f, before);
    // Object.assign replaces c and state independently; retain their shared candidate reference.
    f.c = f.state.channels.human_1.candidates[0];
  }
});
test('channel reader verifies official public documents and generated build parent through fresh reads', async () => {
  const f = channelFixture(), pr = { number: 1, author: { login: 'human' }, headRefOid: source }, calls = [];
  let parent = source;
  const read = channelDelivery({ gh: async args => {
    calls.push(args);
    if (args[0] === 'repo') return { url: 'https://github.com/' + repository };
    if (args[1].endsWith('/pages')) return { html_url: page };
    if (args[1].includes('/contents/')) return { encoding: 'base64', content: Buffer.from(JSON.stringify(f.state)).toString('base64') };
    return { sha: build, parents: [{ sha: parent }] };
  }, fetchJson: async url => url.endsWith('index.json') ? f.index : f.document });
  assert.equal((await read(pr)).sha, build);
  parent = 'd'.repeat(40); await assert.rejects(read(pr), /child/);
  assert.equal(calls.filter(c => c[0] === 'repo').length, 2);
});
test('requirement, approved plan and fresh instructions are all necessary; exemption is not a merge flag', async t => {
  const f = await fixture(t, 'not-required');
  await assert.rejects(f.verify(), /not reviewed/);
  await f.review(); assert.equal((await f.verify()).requirement, 'not-required');
  const old = f.publication.validation; delete f.publication.validation;
  await assert.rejects(f.review(), /classification/); f.publication.validation = old;
  f.publication.content = 'Edited document'; await assert.rejects(f.verify(), /plan changed/);
  f.publication.content = 'Plan content'; f.t.comments[0].reactions = [];
  await assert.rejects(f.verify(), /not approved/);
  assert.throws(() => validationRequirement('no', 'reason'), /requires/);
});
test('changed ticket scope cannot reuse an exemption before or after its first review', async t => {
  for (const reviewed of [false, true]) {
    const f = await fixture(t, 'not-required');
    if (reviewed) await f.review();
    f.t.description += '\nA human channel trial is now required.';
    if (reviewed) { await f.review(); await assert.rejects(f.verify(), /replacement plan/); }
    else await assert.rejects(f.review(), /scope changed/);
  }
});
test('human acceptance binds exact request/candidate and persists across store lifetimes', async t => {
  const f = await fixture(t); await f.review(); await f.begin();
  assert.equal((await f.current()).phase, 'awaiting-validation');
  assert.equal(f.releases, 1);
  await assert.rejects(f.verify(), /not recorded/);
  const answer = f.comment('testé et validé', user, (await f.record()).request.post.id);
  assert.equal((await f.store().decision(f.claim.issue, null, { peek: true })).verdict, 'approved');
  assert.equal((await f.current()).phase, 'awaiting-validation', 'peek does not consume');
  await f.store().decision(f.claim.issue, f.who);
  assert.equal((await f.current()).phase, 'implementing');
  assert.equal(f.t.state.name, 'In Review');
  const proof = await f.verify(); assert.equal(proof.decision.id, answer.id); assert.equal(proof.candidate.sha, build);
  const count = f.publications; await f.store().decision(f.claim.issue, f.who); assert.equal(f.publications, count);
  await assertValidationResolved(f.stateDir, await f.current());
});
test('old plan reaction, silence, bots, wrong human and wrong thread never validate the candidate', async t => {
  for (const kind of ['silence', 'plan', 'bot', 'unknown', 'other-human', 'root']) {
    const f = await fixture(t); await f.review(); await f.begin();
    const request = (await f.record()).request;
    if (kind === 'plan') f.t.comments[0].reactions.push({ emoji: '+1', user, createdAt: f.clock() });
    else if (kind !== 'silence') f.comment('testé et validé', kind === 'bot' ? agent : kind === 'unknown' ? { id: 'unknown' } : kind === 'other-human' ? { ...user, id: 'other' } : user, kind === 'root' ? undefined : request.post.id);
    await assert.rejects(f.verify());
    if (kind === 'unknown') await assert.rejects(f.store().decision(f.claim.issue, f.who), /ambiguous/);
    else assert.notEqual((await f.store().decision(f.claim.issue, f.who)).verdict, 'approved', kind);
  }
});
test('later and edited instructions, withdrawn decisions and new heads invalidate receipts', async t => {
  for (const kind of ['human', 'forwarded', 'old-edit', 'decision-edit', 'decision-delete', 'head', 'page', 'candidate']) {
    const f = await fixture(t);
    const earlier = f.comment('Implementation context', agent);
    await f.review(); await f.begin(); const answer = await f.accept();
    if (kind === 'human') f.comment('Wait, also change the behavior');
    if (kind === 'forwarded') f.comment('Human instruction relayed: do not merge', agent);
    if (kind === 'old-edit') { earlier.body = 'New requirement'; earlier.updatedAt = f.clock(); }
    if (kind === 'decision-edit') { answer.body = 'refusé'; answer.updatedAt = f.clock(); }
    if (kind === 'decision-delete') f.t.comments = f.t.comments.filter(c => c.id !== answer.id);
    if (kind === 'head') f.pr.headRefOid = 'd'.repeat(40);
    if (kind === 'page') f.channel.document.releaseSource = build;
    if (kind === 'candidate') f.channel.c.source = build;
    await assert.rejects(f.verify(), undefined, kind);
  }
});
test('direct phase, closure and plan-verdict bypasses cannot consume pending human work', async t => {
  const f = await fixture(t); await f.review(); await f.begin(); const c = await f.current();
  for (const phase of ['implementing', 'landing', 'planning', 'awaiting-approval']) await assert.rejects(writeClaim({ ...c, phase }, { stateDir: f.stateDir }), /validation/);
  await assert.rejects(writeClaim({ ...c, session: 'other' }, { stateDir: f.stateDir }), /owner/);
  await assert.rejects(assertValidationResolved(f.stateDir, c), /unresolved/);
  const result = await registerAnswer(f.t, { verdict: 'approved' }, c, f.t.comments[0], f.t.comments, agent.id, { persistClaim: () => assert.fail('old plan cannot write') });
  assert.equal(result.phase, 'awaiting-validation');
  await assert.rejects(f.review(), /still pending/);
});
test('identity, loop and API failures refuse while preserving the saved request', async t => {
  const f = await fixture(t); await f.review(); await f.begin(); const saved = await f.record();
  await assert.rejects(f.store().decision(f.claim.issue, { ...f.who, session: 'other' }), /exact/);
  await atomicJson(join(f.stateDir, 'claims/JAU-119.stop'), { reason: 'stop' }); await assert.rejects(f.verify(), /stopped/);
  await rm(join(f.stateDir, 'claims/JAU-119.stop'));
  f.dependencies.readThread = async () => { throw Error('API unavailable'); }; await assert.rejects(f.verify(), /API unavailable/);
  assert.deepEqual(await f.record(), saved);
});
test('lost publication response is recovered by marker and never blindly duplicated', async t => {
  const f = await fixture(t); await f.review(); f.losePublish = true;
  await assert.rejects(f.begin(), /lost create/); assert.equal(f.releases, 0);
  await f.begin(); assert.equal(f.publications, 1); assert.equal((await f.current()).phase, 'awaiting-validation');
  const other = await fixture(t); await other.review(); other.failPublish = true;
  await assert.rejects(other.begin(), /create offline/); other.failPublish = false;
  await assert.rejects(other.begin(), /ambiguous/); assert.equal(other.publications, 1); assert.equal(other.releases, 0);
});
test('release and decision persistence failures keep durable state retryable', async t => {
  const f = await fixture(t); await f.review(); f.failRelease = true;
  await assert.rejects(f.begin(), /release unavailable/); assert.equal((await f.current()).phase, 'awaiting-validation');
  f.comment('testé et validé', user, (await f.record()).request.post.id);
  assert.equal((await f.store().decision(f.claim.issue, null, { peek: true })).verdict, 'feedback');
  await assert.rejects(f.store().decision(f.claim.issue, f.who), /admission incomplete/);
  assert.equal((await f.record()).state, 'waiting');
  f.failRelease = false; await f.begin(); assert.equal(f.publications, 1);
  f.failPersist = true; await assert.rejects(f.store().decision(f.claim.issue, f.who), /persist failed/);
  await writeClaim(await f.current(), { stateDir: f.stateDir });
  f.failPersist = false; await f.store().decision(f.claim.issue, f.who); assert.equal(f.publications, 2); await f.verify();
});
test('harmless request reactions do not edit the publication proof', async t => {
  const f = await fixture(t); await f.review(); await f.begin();
  const requestId = (await f.record()).request.post.id;
  const request = f.t.comments.find(c => c.id === requestId);
  request.reactions.push({ emoji: 'eyes', user, createdAt: f.clock() }); request.updatedAt = f.clock();
  await f.accept(); await f.verify();
});
test('new root instructions are actionable feedback and can enter explicit replanning', async t => {
  const f = await fixture(t); await f.review(); await f.begin();
  f.comment('Stop; change the scope first');
  assert.equal((await f.store().decision(f.claim.issue, null, { peek: true })).verdict, 'feedback');
  await f.review(); assert.equal((await f.current()).phase, 'planning');
  assert.equal((await f.record()).requiresPlan, true);
  await assert.rejects(f.verify(), /replacement plan/);
});
test('edited/removed request can be superseded but never accepted', async t => {
  for (const remove of [false, true]) {
    const f = await fixture(t); await f.review(); await f.begin();
    const id = (await f.record()).request.post.id;
    if (remove) f.t.comments = f.t.comments.filter(c => c.id !== id);
    else f.t.comments.find(c => c.id === id).body += '\nChanged request';
    await assert.rejects(f.verify());
    await f.review(); await f.begin(); await f.accept(); await f.verify();
  }
});
test('archived discussion and phase restoration survive a failed correction', async t => {
  for (const fail of ['failPersist', 'failSync']) {
    const f = await fixture(t); await f.review(); await f.begin();
    const answer = f.comment('refusé', user, (await f.record()).request.post.id);
    f[fail] = true; await assert.rejects(f.review({ comment: answer.id }));
    await writeClaim(await f.current(), { stateDir: f.stateDir });
    f[fail] = false; await f.review();
    assert.equal((await f.record()).history[0].discussionResolved, true);
    await f.begin(); await f.accept(); await assertValidationResolved(f.stateDir, await f.current());
  }
});
test('an ambiguous merge refuses validation before publication or parking', async t => {
  const f = await fixture(t); await f.review(); f.mergeAttempted = true;
  await assert.rejects(f.begin(), /attempted merge/);
  assert.equal(f.publications, 0); assert.equal(f.releases, 0); assert.equal((await f.current()).phase, 'implementing');
});
test('retained validation receipts after MERGED never ask for the removed channel', async t => {
  const f = await fixture(t); await f.review(); await f.begin(); await f.accept();
  f.pr.state = 'MERGED'; f.dependencies.readCandidate = async () => assert.fail('channel removed after merge');
  assert.equal((await f.store().decision(f.claim.issue, f.who)).stage, 'merged');
});
for (const accepted of [false, true]) test(`feedback after accepted=${accepted} starts correction without inherited acceptance`, async t => {
  const f = await fixture(t); await f.review(); await f.begin();
  if (accepted) await f.accept();
  const comment = f.comment('Please adjust the result', user, (await f.record()).request.post.id);
  await f.review({ comment: comment.id });
  assert.equal((await f.current()).phase, 'implementing');
  assert.equal((await f.record()).history.length, 1);
  assert.equal((await f.record()).history[0].feedback.id, comment.id);
  await f.begin(); assert.equal((await f.store().decision(f.claim.issue, null, { peek: true })).verdict, 'pending');
  await assert.rejects(f.verify(), /not recorded/);
});
test('a replacement plan replying inside trial feedback keeps its own approval', async t => {
  const f = await fixture(t); await f.review(); await f.begin();
  const feedback = f.comment('Change the scope', user, (await f.record()).request.post.id);
  await f.review({ comment: feedback.id });
  const plan = f.comment('<!-- jaunt-agent:plan -->\nReplacement scope', agent, feedback.id);
  Object.assign(f.publication, { comment: plan.id, commentHash: hash(plan.body) });
  await assert.rejects(f.review(), /not approved/);
  f.comment('/approve', user, plan.id);
  await f.review(); await f.begin(); await f.accept(); await f.verify();
});
test('complete validation reader handles more than 100 comments and rejects partial or changing pages', async t => {
  const f = await fixture(t);
  for (let n = 0; n < 130; n++) f.comment(`context ${n}`, agent);
  const cursors = [];
  const result = await readValidationThread(f.claim.issue, async (q, vars) => {
    assert.match(q, /updatedAt parent/); assert.match(q, /description/); cursors.push(vars.cursor);
    return { issue: { ...f.t, updatedAt: 'stable', comments: { nodes: f.t.comments.slice(vars.cursor ? 100 : 0, vars.cursor ? undefined : 100), pageInfo: { hasNextPage: !vars.cursor, endCursor: 'next' } } } };
  });
  assert.equal(result.comments.length, 131); assert.deepEqual(cursors, [null, 'next']);
  await assert.rejects(readValidationThread(f.claim.issue, async () => ({ issue: { ...f.t, comments: { nodes: [] } } })), /incomplete/);
  await assert.rejects(readValidationThread(f.claim.issue, async (_q, vars) => ({ issue: { ...f.t, updatedAt: vars.cursor || 'first', comments: { nodes: [], pageInfo: { hasNextPage: !vars.cursor, endCursor: 'next' } } } })), /changed during pagination/);
});
test('worker status exposes the retained validation obligation without recovery', async t => {
  const f = await fixture(t); await f.review(); await f.begin();
  await beginAttempt(f.stateDir, await f.current(), { wrapper: null, child: null, childExited: true, endedAt: f.clock(), code: 0 });
  const report = (await workerReports(f.stateDir))[0];
  assert.equal(report.state, 'resting'); assert.equal(report.progress.pr, 1); assert.equal(report.progress.reviewer, user.name);
});
