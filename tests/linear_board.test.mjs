// JAU-112: one author per column. Backlog ↔ Todo belong to `triage`, In Progress
// to the loop once git stops writing it, In Review and Done stay git's. The
// board is never contacted: moves and settings are injected.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  WAITING_STATE, BACKLOG_STATE, TODO_STATE, PROGRESS_STATE,
  gitLeavesProgress, rankNext, triageMoves, nextClaimState, writeClaim, closureStore,
} from '../scripts/linear_agent.mjs';

test('the loop owns In Progress only when no git automation targets it', () => {
  // As measured on JAU, 23/09: PR opened → In Progress.
  const measured = [
    { event: 'review', state: { name: 'In Review' } },
    { event: 'merge', state: { name: 'Done' } },
    { event: 'start', state: { name: 'In Progress' } },
  ];
  assert.equal(gitLeavesProgress(measured), false);
  assert.equal(gitLeavesProgress(measured.map((a) => (a.event === 'start' ? { ...a, state: { name: 'In Review' } } : a))), true);
  assert.equal(gitLeavesProgress([{ event: 'draft', state: { name: 'in progress' } }]), false);
  assert.equal(gitLeavesProgress([{ event: 'draft', state: null }]), true);
  for (const unreadable of [undefined, null, {}]) assert.equal(gitLeavesProgress(unreadable), false);
});

const issue = (identifier, state, extra = {}) => ({
  identifier, state: { name: state }, priority: 3, sortOrder: 0, inverseRelations: { nodes: [] }, ...extra,
});

test('next ranks Todo before Backlog and never offers a parked ticket', () => {
  const blocked = { inverseRelations: { nodes: [{ type: 'blocks', issue: { identifier: 'JAU-9', state: { type: 'started' } } }] } };
  assert.equal(rankNext([
    issue('JAU-1', BACKLOG_STATE, { priority: 1 }),
    issue('JAU-2', WAITING_STATE, { priority: 1 }),
    issue('JAU-3', TODO_STATE, { priority: 4 }),
  ]).identifier, 'JAU-3');
  assert.equal(rankNext([issue('JAU-2', WAITING_STATE), issue('JAU-1', BACKLOG_STATE)]).identifier, 'JAU-1');
  assert.equal(rankNext([issue('JAU-2', WAITING_STATE), issue('JAU-3', TODO_STATE, blocked)]), null);
});

const reviewedAt = '2026-09-23T10:00:00Z';
const ticket = (identifier, state, extra = {}) => ({
  identifier, state, blockedBy: [], review: { state: 'reviewed', reviewedAt }, ...extra,
});
const forecast = (...ids) => new Map(ids.map((id) => [id, { declaredAt: '2026-09-23T10:05:00Z' }]));

test('triage promotes exactly the dispatch candidates', () => {
  const tickets = [
    ticket('JAU-1', BACKLOG_STATE),
    ticket('JAU-2', BACKLOG_STATE, { review: { state: 'changed-since-review', reviewedAt } }),
    ticket('JAU-3', BACKLOG_STATE, { review: { state: 'never-reviewed' } }),
    ticket('JAU-4', BACKLOG_STATE, { blockedBy: ['JAU-1'] }),
    ticket('JAU-5', BACKLOG_STATE),
    ticket('JAU-6', BACKLOG_STATE),
    ticket('JAU-7', BACKLOG_STATE),
    ticket('JAU-8', WAITING_STATE),
    ticket('JAU-9', PROGRESS_STATE),
  ];
  const surfaces = forecast('JAU-1', 'JAU-2', 'JAU-3', 'JAU-4', 'JAU-7', 'JAU-8', 'JAU-9');
  // A forecast older than the review belongs to an earlier analysis.
  surfaces.set('JAU-6', { declaredAt: '2026-09-23T09:00:00Z' });
  const { moves, held } = triageMoves(tickets, { claimed: new Set(['JAU-7']), surfaces });
  assert.deepEqual(moves.map((m) => [m.ticket, m.to]), [['JAU-1', TODO_STATE]]);
  assert.deepEqual(held, []);
  // Idempotent: once in Todo, the same facts move nothing.
  const again = triageMoves([ticket('JAU-1', TODO_STATE)], { surfaces, placed: new Set(['JAU-1']) });
  assert.deepEqual(again, { moves: [], held: [] });
});

test('triage takes back what it promoted, and a human placement only on a blocker', () => {
  const tickets = [
    ticket('JAU-1', TODO_STATE, { review: { state: 'changed-since-review', reviewedAt } }),
    ticket('JAU-2', TODO_STATE, { blockedBy: ['JAU-9'] }),
    ticket('JAU-3', TODO_STATE, { review: { state: 'never-reviewed' } }),
    ticket('JAU-4', TODO_STATE, { blockedBy: ['JAU-9'] }),
    ticket('JAU-5', TODO_STATE, { review: { state: 'changed-since-review', reviewedAt } }),
  ];
  const { moves, held } = triageMoves(tickets, {
    surfaces: forecast('JAU-1', 'JAU-2', 'JAU-4', 'JAU-5'),
    placed: new Set(['JAU-1', 'JAU-2']),
    claimed: new Set(['JAU-5']),
  });
  assert.deepEqual(moves.map((m) => [m.ticket, m.to, m.overrides ?? null]), [
    ['JAU-1', BACKLOG_STATE, null],
    ['JAU-2', BACKLOG_STATE, null],
    ['JAU-4', BACKLOG_STATE, 'human'],
  ]);
  assert.match(moves[1].reason, /bloqué par JAU-9/);
  assert.deepEqual(held.map((h) => h.ticket), ['JAU-3']);
});

test('coding moves to In Progress only from the waiting column, Backlog or Todo', () => {
  for (const currentState of [WAITING_STATE, BACKLOG_STATE, TODO_STATE]) {
    assert.equal(nextClaimState({ currentState, parkedFrom: BACKLOG_STATE, working: true }), PROGRESS_STATE);
  }
  for (const currentState of ['In Review', 'Done', PROGRESS_STATE]) {
    assert.equal(nextClaimState({ currentState, parkedFrom: BACKLOG_STATE, working: true }), null);
  }
  assert.equal(nextClaimState({ currentState: WAITING_STATE, parkedFrom: TODO_STATE }), TODO_STATE);
});

async function fixture(t, { phase, state, parkedFrom = null }) {
  const stateDir = await mkdtemp(join(tmpdir(), 'jaunt-board-'));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  await mkdir(join(stateDir, 'claims'));
  const claim = { issue: 'JAU-50', claimedAt: '2026-09-23T10:00:00Z', updatedAt: '2026-09-23T10:01:00Z',
    phase, parkedFrom, session: 'test-session', runtime: 'claude' };
  await writeFile(join(stateDir, 'claims/JAU-50.json'), JSON.stringify(claim));
  const origin = { identifier: 'JAU-50', state: { name: state, type: 'unstarted' }, relations: { nodes: [] }, inverseRelations: { nodes: [] } };
  const moves = [];
  const moveState = async (issue, target) => { moves.push(target); issue.state = { ...issue.state, name: target }; return { moved: true }; };
  const options = (owns) => ({ stateDir, readIssue: async () => origin, moveState, ownsProgress: async () => owns });
  const read = async () => JSON.parse(await readFile(join(stateDir, 'claims/JAU-50.json'), 'utf8'));
  return { stateDir, claim, origin, moves, options, read };
}

test('an approval goes to In Progress once the loop owns it, and back where it was until then', async (t) => {
  for (const [owns, expected] of [[true, PROGRESS_STATE], [false, TODO_STATE]]) {
    const f = await fixture(t, { phase: 'awaiting-approval', state: WAITING_STATE, parkedFrom: TODO_STATE });
    const unparked = [];
    await writeClaim({ ...f.claim, phase: 'implementing' }, { ...f.options(owns), unpark: true, onUnpark: (r) => unparked.push(r) });
    assert.deepEqual(f.moves, [expected]);
    assert.deepEqual(unparked, [expected]);
    assert.equal((await f.read()).parkedFrom, null);
  }
});

test('a queued approval returns to its column, and ready later moves it to In Progress', async (t) => {
  const f = await fixture(t, { phase: 'awaiting-approval', state: WAITING_STATE, parkedFrom: BACKLOG_STATE });
  await writeClaim({ ...f.claim, phase: 'queued' }, { ...f.options(true), unpark: true });
  assert.deepEqual(f.moves, [BACKLOG_STATE]);
  await writeClaim({ ...(await f.read()), phase: 'implementing' }, f.options(true));
  assert.deepEqual(f.moves, [BACKLOG_STATE, PROGRESS_STATE]);
  // Already implementing: nothing more to write.
  await writeClaim({ ...(await f.read()), updatedAt: 'later' }, f.options(true));
  assert.equal(f.moves.length, 2);
});

test('nothing git wrote is ever moved back', async (t) => {
  for (const state of ['In Review', 'Done']) {
    const f = await fixture(t, { phase: 'landing', state });
    await writeClaim({ ...f.claim, phase: 'implementing' }, f.options(true));
    assert.deepEqual(f.moves, []);
  }
});

test('a claim released while still In Progress sends the ticket back to Backlog', async (t) => {
  for (const [owns, state, expected] of [
    [true, PROGRESS_STATE, [BACKLOG_STATE]],
    [false, PROGRESS_STATE, []],
    [true, 'In Review', []],
  ]) {
    const f = await fixture(t, { phase: 'planning', state });
    const released = await closureStore(f.options(owns)).release('JAU-50', 'abandoned before any work');
    assert.equal(released.released, true);
    assert.deepEqual(f.moves, expected);
  }
});
