// JAU-15: the agent's own Linear writes no longer wake the model. Only positive
// evidence that the agent alone moved a ticket removes its events; anybody
// else, nobody identifiable, or a failed read still wakes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { selfAuthored, filterSelf, decisive, attributionWindows, attributionQuery, attribute, ATTRIBUTION_PAGE, STAMP_SKEW_MS, reviewWindows, repinSelf } from '../scripts/linear_attribution.mjs';
import { withoutSelfWrites } from '../scripts/linear_watch.mjs';

const ME = 'agent';
const HUMAN = 'human';
const T = n => new Date(Date.UTC(2026, 8, 23, 10, 0, n)).toISOString();
const SINCE = T(10);
const issue = ({ history = [], comments = [], creator = ME, createdAt = T(0) } = {}) =>
  ({ identifier: 'JAU-1', createdAt, creator: { id: creator }, history: { nodes: history }, comments: { nodes: comments } });
const entry = (actorId, updatedAt, createdAt = updatedAt) => ({ actorId, createdAt, updatedAt, botActor: null });
const comment = (user, createdAt, reactions = [], editedAt = null) => ({ user: { id: user }, createdAt, editedAt, reactions });
const reaction = (user, createdAt, emoji = '+1') => ({ user: { id: user }, createdAt, emoji });

test('the agent alone is self, anybody else is not', () => {
  assert.equal(selfAuthored(issue({ history: [entry(ME, T(11))], comments: [comment(ME, T(12))] }), ME, SINCE).self, true);
  assert.equal(selfAuthored(issue({ comments: [comment(HUMAN, T(12))] }), ME, SINCE).self, false);
  // The same window holding both: the human's write must wake.
  const mixed = selfAuthored(issue({ history: [entry(ME, T(11))], comments: [comment(HUMAN, T(12))] }), ME, SINCE);
  assert.deepEqual([mixed.self, mixed.others.map(o => o.kind)], [false, ['comment']]);
});

test('a human reaction on the agent comment is not the agent', () => {
  const v = selfAuthored(issue({ comments: [comment(ME, T(1), [reaction(HUMAN, T(12), 'eyes')])] }), ME, SINCE);
  assert.equal(v.self, false);
  assert.deepEqual(v.others, [{ kind: 'reaction', userId: HUMAN, at: T(12), emoji: 'eyes', onAgent: true }]);
});

test('only what happened after the window counts', () => {
  // Merged history entry: created before the window, extended into it by the agent.
  const v = selfAuthored(issue({ history: [entry(ME, T(11), T(5)), entry(HUMAN, T(4))], comments: [comment(HUMAN, T(3), [reaction(HUMAN, T(2))])] }), ME, SINCE);
  assert.equal(v.self, true);
  // An edit by the agent after the window, on an old comment.
  assert.equal(selfAuthored(issue({ comments: [comment(ME, T(1), [], T(11))] }), ME, SINCE).self, true);
});

test('nothing identifiable wakes: unsigned history, no evidence, missing issue', () => {
  assert.equal(selfAuthored(issue({ history: [entry(null, T(11))] }), ME, SINCE).self, false, 'an integration or unknown actor');
  const none = selfAuthored(issue(), ME, SINCE);
  assert.deepEqual([none.self, none.unexplained], [false, true], 'a deleted comment or withdrawn reaction leaves no trace');
  assert.deepEqual(selfAuthored(null, ME, SINCE), { self: false, mine: 0, others: [], unexplained: true });
});

test('creation is attributed to the creator when the ticket is new', () => {
  assert.equal(selfAuthored(issue({ comments: [comment(ME, T(1))] }), ME, null).self, true);
  assert.equal(selfAuthored(issue({ creator: HUMAN }), ME, null).self, false);
});

test('a full page of changes cannot prove the agent alone', () => {
  const history = Array.from({ length: ATTRIBUTION_PAGE }, (_, i) => entry(ME, T(20 + i)));
  const v = selfAuthored(issue({ history }), ME, SINCE);
  assert.deepEqual([v.self, v.truncated], [false, true]);
});

test('filterSelf removes only attributable events of self tickets', () => {
  const events = [
    { type: 'comment', ticket: 'JAU-1' }, { type: 'ticket-edited', ticket: 'JAU-1' },
    { type: 'comment', ticket: 'JAU-2' }, { type: 'ticket-gone', ticket: 'JAU-1' },
    { type: 'activity-failed', errors: [] }, { type: 'state-changed', ticket: 'JAU-3' },
  ];
  const out = filterSelf(events, { 'JAU-1': { self: true }, 'JAU-2': { self: false } });
  assert.equal(out.suppressed, 2);
  assert.deepEqual(out.events.map(e => `${e.type}:${e.ticket ?? ''}`), ['comment:JAU-2', 'ticket-gone:JAU-1', 'activity-failed:', 'state-changed:JAU-3']);
});

// JAU-89: a 👀 ("read") was already consumed by sync-activity; only a 👍/👎 on
// the agent's side of the thread is a decision worth a model turn.
test('a reaction decides only as an approval or refusal on the agent comment', () => {
  const on = (user, emoji) => selfAuthored(issue({ comments: [comment(user, T(1), [reaction(HUMAN, T(12), emoji)])] }), ME, SINCE).others[0];
  assert.equal(decisive(on(ME, '+1')), true);
  assert.equal(decisive(on(ME, ':thumbsdown:')), true);
  assert.equal(decisive(on(ME, 'eyes')), false);
  assert.equal(decisive(on(HUMAN, '+1')), false, 'a 👍 on a human message decides nothing');
});

test('filterSelf drops tickets only non-deciding reactions moved, and nothing else', () => {
  const react = (emoji, onAgent = true) => ({ kind: 'reaction', userId: HUMAN, at: T(12), emoji, onAgent });
  const verdicts = {
    'JAU-1': { self: false, others: [react('eyes')], unexplained: false },
    'JAU-2': { self: false, others: [react('eyes'), react('+1', false)], unexplained: false },
    'JAU-3': { self: false, others: [react('+1')], unexplained: false },
    'JAU-4': { self: false, others: [react('eyes'), { kind: 'comment-edit', userId: HUMAN, at: T(12) }], unexplained: false },
    'JAU-5': { self: false, others: [react('eyes')], unexplained: false, truncated: true },
    'JAU-6': { self: false, others: [], unexplained: true },
    'JAU-7': { self: false, others: [react('eyes')], unexplained: false },
  };
  const events = [
    { type: 'comment-updated', ticket: 'JAU-1' }, { type: 'ticket-edited', ticket: 'JAU-2' },
    { type: 'comment-updated', ticket: 'JAU-3' }, { type: 'comment-updated', ticket: 'JAU-4' },
    { type: 'comment-updated', ticket: 'JAU-5' }, { type: 'comment-updated', ticket: 'JAU-6' },
    { type: 'state-changed', ticket: 'JAU-7' }, { type: 'comment-updated', ticket: 'JAU-8' },
  ];
  const out = filterSelf(events, verdicts);
  assert.deepEqual([out.suppressed, out.idle], [0, 2]);
  assert.deepEqual(out.events.map(e => e.ticket), ['JAU-3', 'JAU-4', 'JAU-5', 'JAU-6', 'JAU-7', 'JAU-8']);
});

test('the watcher drops a 👀 and counts it apart from its own writes', async () => {
  const notes = [];
  const wakes = { note: async (reason, n) => notes.push([reason, n]) };
  const previous = { tickets: { 'JAU-1': { u: T(10) }, 'JAU-2': { u: T(10) } } };
  const eyes = { self: false, others: [{ kind: 'reaction', userId: HUMAN, at: T(12), emoji: 'eyes', onAgent: true }], unexplained: false };
  const kept = await withoutSelfWrites([{ type: 'comment-updated', ticket: 'JAU-1' }, { type: 'ticket-edited', ticket: 'JAU-2' }], previous, wakes,
    async () => ({ verdicts: { 'JAU-1': eyes, 'JAU-2': { self: true } } }));
  assert.deepEqual(kept, []);
  assert.deepEqual(notes, [['self-authored', 1], ['idle-reaction', 1]]);
});

test('windows open at the previous updatedAt, or at creation', () => {
  const previous = { tickets: { 'JAU-1': { u: T(10) } } };
  assert.deepEqual(attributionWindows([{ type: 'comment', ticket: 'JAU-1' }, { type: 'ticket-created', ticket: 'JAU-9' }, { type: 'ticket-gone', ticket: 'JAU-4' }], previous),
    { 'JAU-1': T(10), 'JAU-9': null });
});

test('one aliased query per batch; a failed batch leaves no verdict', async () => {
  const { query, variables } = attributionQuery(['JAU-1', 'JAU-2']);
  assert.match(query, /t0: issue\(id: \$i0\)/);
  assert.deepEqual(variables, { i0: 'JAU-1', i1: 'JAU-2' });
  const calls = [];
  const graphql = async (q, vars) => {
    calls.push(Object.values(vars));
    if (vars.i0 === 'JAU-3') throw new Error('graphql 429');
    return Object.fromEntries(Object.keys(vars).map((k, i) => [`t${i}`, issue({ history: [entry(ME, T(11))] })]));
  };
  const out = await attribute({ 'JAU-1': SINCE, 'JAU-2': SINCE, 'JAU-3': SINCE }, { graphql, agentId: ME, batch: 2 });
  assert.deepEqual(calls, [['JAU-1', 'JAU-2'], ['JAU-3']]);
  assert.deepEqual(Object.keys(out.verdicts), ['JAU-1', 'JAU-2']);
  assert.equal(out.errors[0].tickets[0], 'JAU-3');
});

test('the watcher drops its own writes, counts them, and wakes when it cannot tell', async () => {
  const notes = [];
  const wakes = { note: async (reason, n) => notes.push([reason, n]) };
  const previous = { tickets: { 'JAU-1': { u: T(10) }, 'JAU-2': { u: T(10) } } };
  const events = [{ type: 'comment', ticket: 'JAU-1' }, { type: 'comment-updated', ticket: 'JAU-2' }];
  let asked;
  const kept = await withoutSelfWrites(events, previous, wakes, async w => { asked = w; return { verdicts: { 'JAU-1': { self: true }, 'JAU-2': { self: false } } }; });
  assert.deepEqual(asked, { 'JAU-1': T(10), 'JAU-2': T(10) });
  assert.deepEqual(kept, [{ type: 'comment-updated', ticket: 'JAU-2' }]);
  assert.deepEqual(notes, [['self-authored', 1]]);
  // A failed attribution keeps every event: never silence on doubt.
  assert.deepEqual(await withoutSelfWrites(events, previous, wakes, async () => { throw new Error('graphql 503'); }), events);
  // Nothing attributable: no Linear call at all.
  assert.deepEqual(await withoutSelfWrites([{ type: 'ticket-gone', ticket: 'JAU-1' }], previous, wakes, async () => { throw new Error('must not be called'); }), [{ type: 'ticket-gone', ticket: 'JAU-1' }]);
});

// JAU-103: the two wakes of 23/09, from the raw Linear history (ids shortened).
const WORKFLOW = { id: 'linear', type: 'workflow' };
const auto = (at, relationChanges = [{ type: 'ar' }], extra = {}) =>
  ({ actorId: null, botActor: WORKFLOW, createdAt: at, updatedAt: at, relationChanges, ...extra });
const Z = s => `2026-09-23T${s}Z`;

test('trace 08:23: the relation Linear copies onto a duplicate target is not a human', () => {
  // JAU-101 marked duplicate of JAU-102 by the agent; Linear moved its
  // `related JAU-84` onto JAU-102, signing both sides as its workflow bot.
  const jau102 = issue({
    creator: HUMAN, createdAt: Z('08:22:52.612'),
    history: [entry(ME, Z('08:23:40.292'), Z('08:23:40.115')), auto(Z('08:23:39.380')), entry(ME, Z('08:23:39.164'), Z('08:23:38.757'))],
    comments: [comment(ME, Z('08:23:39.598'))],
  });
  const v = selfAuthored(jau102, ME, Z('08:22:53.000'));
  assert.deepEqual([v.self, v.mine, v.automated, v.others], [true, 3, 1, []]);
  const jau84 = issue({ history: [auto(Z('08:23:39.380')), entry(ME, Z('07:47:23.470'), Z('07:19:51.867'))] });
  const only = selfAuthored(jau84, ME, Z('07:47:23.450'));
  assert.deepEqual([only.self, only.mine, only.unexplained], [true, 0, false], 'nothing but Linear moved it: nothing to wake for');
});

test('trace 05:42: a workflow entry that never bumped updatedAt no longer lingers', () => {
  // 01:42 Linear dropped JAU-87's "blocked by JAU-81" without moving updatedAt;
  // the agent's relation at 05:41 then opened a window that still held it.
  const jau87 = issue({ history: [entry(ME, Z('05:41:29.487')), auto(Z('01:42:02.828'), [{ type: 'br' }]), entry(ME, Z('01:16:06.984'), Z('01:08:49.230'))] });
  assert.equal(selfAuthored(jau87, ME, Z('01:16:06.960')).self, true);
});

test('trace 05:42: a 👀 on the agent\'s fresh comment leaves no event awake', () => {
  // JAU-99: human creation, then the agent's triage and comment, then a 👀 read
  // by the same poll (this machine ran ~21 s behind Linear).
  const jau99 = issue({
    creator: HUMAN, createdAt: Z('05:40:47.418'),
    history: [entry(ME, Z('05:42:24.981'), Z('05:41:30.797')), entry(ME, Z('05:41:29.512'), Z('05:41:27.665'))],
    comments: [comment(ME, Z('05:41:30.105'), [reaction(HUMAN, Z('05:42:15.625'), 'eyes')])],
  });
  const v = selfAuthored(jau99, ME, Z('05:40:47.500'));
  assert.equal(v.self, false);
  const out = filterSelf([{ type: 'comment', ticket: 'JAU-99' }], { 'JAU-99': v });
  assert.deepEqual([out.events, out.idle], [[], 1]);
});

test('workflow entries count when they carry more than relations, or are not relations', () => {
  for (const extra of [{ toStateId: 'done' }, { toPriority: 1 }, { addedLabelIds: ['l'] }, { toAssigneeId: HUMAN }, { relationChanges: null }]) {
    const v = selfAuthored(issue({ history: [entry(ME, T(11)), auto(T(12), [{ type: 'ar' }], extra)] }), ME, SINCE);
    assert.equal(v.self, false, JSON.stringify(extra));
  }
  // An integration (GitHub) stays another author.
  const gh = { actorId: null, botActor: { id: 'gh', type: 'integration' }, createdAt: T(12), updatedAt: T(12), relationChanges: [{ type: 'ar' }] };
  assert.equal(selfAuthored(issue({ history: [entry(ME, T(11)), gh] }), ME, SINCE).self, false);
});

test('the write the previous pulse saw does not leak back into the window', () => {
  // updatedAt of the issue is stamped a few ms before its history entry.
  const since = Z('07:46:26.349');
  const human = issue({ history: [entry(HUMAN, Z('07:46:26.365'), Z('07:46:26.240')), entry(ME, Z('07:50:00.000'))] });
  assert.equal(selfAuthored(human, ME, since).self, true);
  // Extended past the skew, the same merged entry is a new write and counts.
  const later = new Date(Date.parse(since) + STAMP_SKEW_MS).toISOString();
  assert.equal(selfAuthored(issue({ history: [entry(HUMAN, later, Z('07:46:26.240')), entry(ME, Z('07:50:00.000'))] }), ME, since).self, false);
  // An entry created inside the window counts however close to its start.
  assert.equal(selfAuthored(issue({ history: [entry(HUMAN, Z('07:46:26.360')), entry(ME, Z('07:50:00.000'))] }), ME, since).self, false);
});

test('a 👀 hides nothing the agent did not write, nor a deciding reaction', () => {
  const eyes = { kind: 'reaction', userId: HUMAN, at: T(12), emoji: 'eyes', onAgent: true };
  const verdicts = {
    'JAU-1': { self: false, mine: 1, others: [eyes], unexplained: false },
    'JAU-2': { self: false, mine: 0, others: [eyes], unexplained: false },
    'JAU-3': { self: false, mine: 1, others: [{ ...eyes, emoji: '+1' }], unexplained: false },
    'JAU-4': { self: false, mine: 1, others: [eyes, { kind: 'creation', userId: HUMAN, at: T(1) }], unexplained: false },
  };
  const events = ['JAU-1', 'JAU-2', 'JAU-3', 'JAU-4'].map(ticket => ({ type: 'comment', ticket }));
  events.push({ type: 'state-changed', ticket: 'JAU-1' }, { type: 'ticket-gone', ticket: 'JAU-1' });
  const out = filterSelf(events, verdicts);
  assert.deepEqual(out.events.map(e => `${e.type}:${e.ticket}`), ['comment:JAU-2', 'comment:JAU-3', 'comment:JAU-4', 'ticket-gone:JAU-1']);
  assert.equal(out.idle, 2);
});

test('the watcher logs the batches attribution could not read, and wakes for them', async t => {
  const logged = t.mock.method(console, 'error', () => {});
  const wakes = { note: async () => {} };
  const events = [{ type: 'comment', ticket: 'JAU-1' }];
  const kept = await withoutSelfWrites(events, { tickets: { 'JAU-1': { u: T(10) } } }, wakes,
    async () => ({ verdicts: {}, errors: [{ tickets: ['JAU-1'], error: 'graphql 400' }] }));
  assert.deepEqual(kept, events);
  assert.match(logged.mock.calls[0].arguments[0], /JAU-1.*graphql 400/);
});

test('board: a ticket the agent alone annotated since review stays reviewed', () => {
  const ledger = { tickets: { 'JAU-1': { issueUpdatedAt: T(1) }, 'JAU-2': { issueUpdatedAt: T(1) }, 'JAU-3': { issueUpdatedAt: T(5) } } };
  const issues = [{ identifier: 'JAU-1', updatedAt: T(9) }, { identifier: 'JAU-2', updatedAt: T(9) }, { identifier: 'JAU-3', updatedAt: T(5) }, { identifier: 'JAU-4', updatedAt: T(9) }];
  // Unchanged and never-reviewed tickets are not asked about.
  assert.deepEqual(reviewWindows(issues, ledger), { 'JAU-1': T(1), 'JAU-2': T(1) });
  assert.deepEqual(repinSelf(issues, ledger, { 'JAU-1': { self: true }, 'JAU-2': { self: false }, 'JAU-4': { self: true } }), ['JAU-1']);
  assert.deepEqual([ledger.tickets['JAU-1'].issueUpdatedAt, ledger.tickets['JAU-2'].issueUpdatedAt], [T(9), T(1)]);
  assert.equal(ledger.tickets['JAU-4'], undefined, 'a never-reviewed ticket gains no pin');
});

test('real watcher: its own write moves the baseline without a wake, a human one wakes', async t => {
  const { mkdtemp, rm, mkdir, writeFile, copyFile, readFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { skillStore } = await import('../scripts/linear_skills.mjs');
  const { wakeStore } = await import('../scripts/linear_wakes.mjs');
  const root = await mkdtemp(join(tmpdir(), 'jaunt-attribution-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'scripts'));
  await mkdir(join(root, '.dev-state'));
  for (const name of ['linear_watch.mjs', 'linear_workers.mjs', 'linear_telemetry.mjs', 'linear_wakes.mjs', 'linear_attribution.mjs', 'linear_skills.mjs']) {
    await copyFile(new URL(`../scripts/${name}`, import.meta.url), join(root, 'scripts', name));
  }
  for (const name of ['linear-loop', 'linear-orchestrator']) {
    const dir = join(root, '.agents/skills', name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'SKILL.md'), 'fixture');
  }
  const skills = skillStore(root);
  await skills.bind('codex', 'fixture-session');
  await skills.acknowledge('codex', 'fixture-session', (await skills.read('codex', 'fixture-session')).fingerprint);
  await writeFile(join(root, '.dev-state/linear-loop.json'), JSON.stringify({ enabled: true }));
  const pulseFile = join(root, '.dev-state/linear-pulse.json');
  const agentAt = self => `import {appendFile} from 'node:fs/promises';
    const cmd = process.argv[2];
    await appendFile(new URL('../calls.txt', import.meta.url), cmd + ' ' + (process.argv[3] ?? '') + '\\n');
    const out = cmd === 'pulse' ? { at: 'now', tickets: { 'JAU-1': { u: '2', s: 'Backlog', c: 'two', cu: '2' } } }
      : cmd === 'attribute' ? { verdicts: { 'JAU-1': { self: ${self}, others: [] } } } : { ok: true, errors: [] };
    console.log(JSON.stringify(out));`;
  // A short bound for the quiet run; the waking run exits on its wake first.
  const run = (minutes = '0.003') => promisify(execFile)(process.execPath, [join(root, 'scripts/linear_watch.mjs'), '--interval', '0.01', '--max-minutes', minutes], { timeout: 8000 });

  await writeFile(pulseFile, JSON.stringify({ tickets: { 'JAU-1': { u: '1', s: 'Backlog', c: 'one', cu: '1' } } }));
  await writeFile(join(root, 'scripts/linear_agent.mjs'), agentAt(true));
  const quiet = JSON.parse((await run()).stdout);
  assert.equal(quiet.wake, 'interval-elapsed', 'the agent’s own comment woke nobody');
  assert.equal(JSON.parse(await readFile(pulseFile, 'utf8')).tickets['JAU-1'].c, 'two', 'the baseline moved past it');
  assert.match(await readFile(join(root, 'calls.txt'), 'utf8'), /attribute \{"JAU-1":"1"\}/, 'windowed from the previous updatedAt');
  assert.ok((await wakeStore(join(root, '.dev-state')).status()).metrics['suppressed:self-authored'] >= 1);

  await writeFile(pulseFile, JSON.stringify({ tickets: { 'JAU-1': { u: '1', s: 'Backlog', c: 'one', cu: '1' } } }));
  await writeFile(join(root, 'scripts/linear_agent.mjs'), agentAt(false));
  const woke = JSON.parse((await run('0.1')).stdout);
  assert.equal(woke.wake, 'board-changed');
  assert.deepEqual(woke.events.map(e => e.type), ['comment']);
});
