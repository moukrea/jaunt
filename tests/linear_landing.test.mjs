import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { landingStore, landingState, assertLandingAdmission, assertLandingReleased } from '../scripts/linear_landing.mjs';
import { atomicJson, hash } from '../scripts/linear_workers.mjs';
import { writeClaim, registerAnswer } from '../scripts/linear_agent.mjs';
const exec = promisify(execFile);
const run = async (cmd, args, cwd) => (await exec(cmd, args, { cwd })).stdout;
const green = () => ['lint', 'test'].map(name => ({ name, status: 'COMPLETED', conclusion: 'SUCCESS' }));
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'jaunt-landing-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, 'repo'), stateDir = join(dir, 'state'), remote = join(dir, 'remote.git');
  await mkdir(root); await run('git', ['init', '-b', 'main'], root);
  const git = (...args) => run('git', args, root);
  await git('config', 'user.email', 'test@example.invalid'); await git('config', 'user.name', 'Test');
  await writeFile(join(root, 'base.txt'), 'base\n'); await git('add', '.'); await git('commit', '-m', 'base');
  await run('git', ['init', '--bare', remote], dir); await git('remote', 'add', 'origin', remote); await git('push', '-u', 'origin', 'main');
  const base = (await git('rev-parse', 'HEAD')).trim();
  await atomicJson(join(stateDir, 'linear-loop.json'), { enabled: true });
  const f = { dir, root, stateDir, git, base, remoteMain: base, prs: new Map(), children: [], calls: [], failEdit: null, mergeError: false, offline: false, mergeReadFailure: false };
  f.runner = async (cmd, args, cwd) => {
    if (cmd !== 'gh') return run(cmd, args, cwd);
    f.calls.push(args);
    if (f.offline) throw Error('offline');
    if (args[0] === 'api' && args.includes('repos/{owner}/{repo}/git/ref/heads/main')) return JSON.stringify({ object: { sha: f.remoteMain } });
    if (args[0] === 'api' && args.includes('repos/{owner}/{repo}/pulls')) {
      assert.ok(args.includes('--paginate')); assert.ok(args.includes('--slurp'));
      const current = f.children.filter(n => f.prs.get(n).baseRefName !== 'main').map(n => {
        const p = f.prs.get(n); return { number: n, base: { ref: p.baseRefName, repo: { full_name: 'test/repo' } }, head: { ref: p.headRefName, sha: p.headRefOid, repo: { full_name: 'test/repo' } } };
      });
      return JSON.stringify([current.slice(0, 1), current.slice(1)]);
    }
    const p = f.prs.get(Number(args[2]));
    if (args[0] === 'pr' && args[1] === 'view') {
      if (f.mergeReadFailure && p?.state === 'MERGED') throw Error('lost read response');
      if (!p) throw Error('missing PR'); return JSON.stringify(p);
    }
    if (args[1] === 'edit') {
      if (f.failEdit === p.number) throw Error('retarget refused'); p.baseRefName = 'main'; return '';
    }
    if (args[1] === 'merge') {
      assert.equal(args[args.indexOf('--match-head-commit') + 1], p.headRefOid);
      p.state = 'MERGED'; p.mergeCommit = { oid: 'a'.repeat(40) };
      if (f.mergeError) throw Error('lost merge response'); return '';
    }
    if (args[1] === 'list') return JSON.stringify([...f.prs.values()].filter(p => p.state === 'OPEN' && p.headRefName === args[args.indexOf('--head') + 1]).map(p => ({ number: p.number })));
    throw Error(`unhandled mock ${args.join(' ')}`);
  };
  f.store = landingStore({ root, stateDir, run: f.runner });
  f.worker = async (id, from = 'main') => {
    const cwd = join(dir, id), branch = `agent/${id}`;
    await git('worktree', 'add', '-b', branch, cwd, from);
    const c = { issue: id, phase: 'implementing', claimedAt: '2026-09-21T00:00:00Z', session: `session-${id}`, runtime: 'codex' };
    await atomicJson(join(stateDir, 'claims', `${id}.json`), c);
    return { c, cwd, branch, who: { runtime: c.runtime, session: c.session }, git: (...args) => run('git', args, cwd) };
  };
  f.pr = (number, worker, fields = {}) => {
    const p = { number, state: 'OPEN', headRefName: worker.branch, headRefOid: base, baseRefName: 'main', baseRefOid: base, mergeCommit: null, isCrossRepository: false, statusCheckRollup: green(), mergeStateStatus: 'CLEAN', ...fields };
    f.prs.set(number, p); return p;
  };
  return f;
}
async function reserve(f, w) { return f.store.acquire(w.c.issue, w.who, w.cwd); }
async function prepare(f, w) { await reserve(f, w); return f.store.prepare(w.c.issue, w.who); }

test('durable FIFO, identity, claim admission and phase refresh survive CLI lifetime', async t => {
  const f = await fixture(t), a = await f.worker('JAU-1'), b = await f.worker('JAU-2');
  await assert.rejects(writeClaim({ ...a.c, phase: 'landing' }, { stateDir: f.stateDir }), /landing acquire/);
  assert.equal((await reserve(f, a)).acquired, true);
  assert.equal((await reserve(f, b)).acquired, false);
  const again = landingStore({ root: f.root, stateDir: f.stateDir, run: f.runner });
  assert.equal((await again.acquire(a.c.issue, a.who, a.cwd)).position, 1);
  await writeClaim({ ...a.c, phase: 'landing' }, { stateDir: f.stateDir });
  await assert.rejects(f.store.prepare(b.c.issue, b.who), /held by JAU-1/);
  await assert.rejects(f.store.acquire(a.c.issue, { ...a.who, session: 'wrong' }, a.cwd), /exact claim/);
  await assert.rejects(assertLandingReleased(f.stateDir, a.c.issue), /reservation/);
  assert.equal((await f.store.release(a.c.issue, a.who, 'yield before CI')).next, b.c.issue);
  await assertLandingAdmission(f.stateDir, { ...a.c, phase: 'landing' }, { ...a.c, phase: 'landing' });
  await assert.rejects(assertLandingAdmission(f.stateDir, a.c), /landing acquire/);
  assert.equal((await reserve(f, b)).acquired, true);
  await atomicJson(join(f.stateDir, 'claims', 'JAU-2.json'), { ...b.c, claimedAt: 'new-cycle' });
  assert.equal((await f.store.status()).owner.current, false);
  await assert.rejects(reserve(f, b), /stale landing/);
});

test('two real processes contend for one global durable turn', async t => {
  const f = await fixture(t), a = await f.worker('JAU-1'), b = await f.worker('JAU-2');
  const modulePath = fileURLToPath(new URL('../scripts/linear_landing.mjs', import.meta.url));
  const script = `import {landingStore} from ${JSON.stringify(modulePath)};
const [root,stateDir,id,session,cwd]=process.argv.slice(1);
const store=landingStore({root,stateDir});
for(let i=0;i<100;i++){try{console.log(JSON.stringify(await store.acquire(id,{runtime:'codex',session},cwd)));break;}
catch(e){if(!/already in progress|recovery in progress|EEXIST/.test(e.message))throw e;await new Promise(r=>setTimeout(r,10));}}`;
  const results = await Promise.all([a, b].map(w => exec(process.execPath, ['--input-type=module', '-e', script, f.root, f.stateDir, w.c.issue, w.c.session, w.cwd])));
  assert.equal(results.map(r => JSON.parse(r.stdout)).filter(r => r.acquired).length, 1);
  assert.equal((await f.store.status()).queue.length, 2);
});

test('stop, loop-off, corrupt state and an uncertain operation lock fail closed', async t => {
  const f = await fixture(t), a = await f.worker('JAU-1'); await reserve(f, a);
  await atomicJson(join(f.stateDir, 'claims', 'JAU-1.stop'), { reason: 'pause' });
  await assert.rejects(f.store.prepare(a.c.issue, a.who), /stop requested/);
  await rm(join(f.stateDir, 'claims', 'JAU-1.stop'));
  await atomicJson(join(f.stateDir, 'linear-loop.json'), { enabled: false });
  await assert.rejects(reserve(f, a), /loop is off/);
  assert.equal((await f.store.status()).queue.length, 1);
  await atomicJson(join(f.stateDir, 'linear-loop.json'), { enabled: true });
  await writeFile(join(f.stateDir, 'workers', 'LANDING-0.lock'), '{}');
  await assert.rejects(reserve(f, a), /uncertain/);
  await rm(join(f.stateDir, 'workers', 'LANDING-0.lock'));
  await writeFile(join(f.stateDir, 'landing.json'), '{bad');
  await assert.rejects(f.store.status(), SyntaxError);
});

test('head, main, checks, PR identity and clean worktree are required', async t => {
  const f = await fixture(t), a = await f.worker('JAU-1'); await prepare(f, a); const p = f.pr(10, a);
  for (const patch of [{ headRefOid: 'b'.repeat(40) }, { state: 'CLOSED' }, { isCrossRepository: true }, { baseRefName: 'other' }, { mergeStateStatus: 'BEHIND' }, { statusCheckRollup: [] }, { statusCheckRollup: [{ name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE' }] }]) {
    const before = structuredClone(p); Object.assign(p, patch);
    await assert.rejects(f.store.merge(a.c.issue, a.who, 10)); Object.assign(p, before);
  }
  f.remoteMain = 'b'.repeat(40); await assert.rejects(f.store.merge(a.c.issue, a.who, 10), /main changed/); f.remoteMain = f.base;
  await writeFile(join(a.cwd, 'untracked'), 'keep'); await assert.rejects(f.store.prepare(a.c.issue, a.who), /dirty/);
  assert.equal(await readFile(join(a.cwd, 'untracked'), 'utf8'), 'keep');
  assert.equal(f.calls.some(args => args[1] === 'merge'), false);
});

test('verified published plan is allowed, an edited draft is preserved', async t => {
  const f = await fixture(t), a = await f.worker('JAU-1'); await reserve(f, a);
  await writeFile(join(a.cwd, 'plan.md'), 'approved plan');
  await atomicJson(join(f.stateDir, 'workers', a.c.issue, hash(a.c.claimedAt), 'publication.json'), { claimedAt: a.c.claimedAt, document: 'doc', hash: hash('approved plan') });
  await f.store.prepare(a.c.issue, a.who);
  await writeFile(join(a.cwd, 'plan.md'), 'different plan');
  await assert.rejects(f.store.prepare(a.c.issue, a.who), /dirty/);
});

test('paginated child PR retargets persist before mutation and survive a partial failure', async t => {
  const f = await fixture(t), a = await f.worker('JAU-1'); await prepare(f, a); f.pr(10, a);
  for (const n of [11, 12]) f.pr(n, { branch: `agent/JAU-${n}` }, { baseRefName: a.branch });
  f.children = [11, 12]; f.failEdit = 12;
  await assert.rejects(f.store.merge(a.c.issue, a.who, 10), /retarget refused/);
  assert.equal(f.prs.get(11).baseRefName, 'main');
  assert.equal((await landingState(f.stateDir)).queue[0].children.length, 2);
  assert.equal(f.calls.some(args => args[1] === 'merge'), false);
  f.failEdit = null; const result = await f.store.merge(a.c.issue, a.who, 10);
  assert.equal(result.merged, 10); assert.equal(f.prs.get(12).baseRefName, 'main');
  assert.equal(f.calls.filter(args => args[1] === 'edit' && args[2] === '11').length, 1);
  assert.equal((await f.store.status()).queue.length, 0);
  assert.equal((await landingState(f.stateDir)).history[0].children.length, 2);
});

test('lost merge responses retain evidence; retry reads MERGED without a second merge', async t => {
  const f = await fixture(t), a = await f.worker('JAU-1'); await prepare(f, a); f.pr(10, a);
  f.mergeError = true; f.mergeReadFailure = true;
  await assert.rejects(f.store.merge(a.c.issue, a.who, 10), /lost read/);
  assert.ok((await landingState(f.stateDir)).queue[0].mergeAttempted);
  f.mergeReadFailure = false;
  assert.equal((await f.store.merge(a.c.issue, a.who, 10)).merged, 10);
  assert.equal(f.calls.filter(args => args[1] === 'merge').length, 1);
});

test('abandon verifies PR state and cannot free an unresolved attempted merge', async t => {
  const f = await fixture(t), a = await f.worker('JAU-1'); await prepare(f, a); f.pr(10, a);
  f.offline = true; await assert.rejects(f.store.release(a.c.issue, a.who, 'yield'), /offline/); f.offline = false;
  const state = await landingState(f.stateDir); Object.assign(state.queue[0], { pr: 10, mergeAttempted: 'uncertain' }); await atomicJson(join(f.stateDir, 'landing.json'), state);
  await assert.rejects(f.store.release(a.c.issue, a.who, 'yield'), /unresolved/);
  f.prs.get(10).state = 'CLOSED';
  assert.equal((await f.store.release(a.c.issue, a.who, 'PR closed after inspection')).released, true);
});

test('re-reading approval preserves a worker already in landing', async () => {
  let written;
  await registerAnswer({ identifier: 'JAU-1' }, { verdict: 'approved' }, { issue: 'JAU-1', phase: 'landing' }, { id: 'plan', createdAt: '2026-01-01' }, [], 'agent', {
    persistClaim: async c => { written = c; }, decidePhase: async () => assert.fail('must not requeue a landing worker'), comment: async () => ({ id: 'ack' }),
  });
  assert.equal(written.phase, 'landing');
});

async function stacked(t, { own = true, conflict = false, semantic = false } = {}) {
  const f = await fixture(t), parent = await f.worker('JAU-1');
  await writeFile(join(parent.cwd, 'shared.txt'), 'parent one\n'); await parent.git('add', '.'); await parent.git('commit', '-m', 'parent one');
  await writeFile(join(parent.cwd, 'api.mjs'), 'export const oldName = () => 1;\n'); await parent.git('add', '.'); await parent.git('commit', '-m', 'parent two');
  const base = (await parent.git('rev-parse', 'HEAD')).trim(), child = await f.worker('JAU-2', parent.branch);
  await f.store.stackRecord(child.c.issue, child.who, child.cwd, parent.branch, base);
  if (own) {
    await writeFile(join(child.cwd, conflict ? 'shared.txt' : semantic ? 'consumer.mjs' : 'child.txt'), conflict ? 'child version\n' : semantic ? "import { oldName } from './api.mjs'; if(oldName()!==1)throw Error('bad');\n" : 'child only\n');
    await child.git('add', '.'); await child.git('commit', '-m', 'child work');
  }
  if (conflict || semantic) {
    await writeFile(join(parent.cwd, conflict ? 'shared.txt' : 'api.mjs'), conflict ? 'parent later\n' : 'export const newName = () => 1;\n');
    await parent.git('add', '.'); await parent.git('commit', '-m', 'parent later');
  }
  const parentHead = (await parent.git('rev-parse', 'HEAD')).trim();
  await f.git('merge', '--squash', parent.branch); await f.git('commit', '-m', 'squashed parent'); await f.git('push', 'origin', 'main');
  const merged = (await f.git('rev-parse', 'HEAD')).trim();
  f.pr(10, parent, { state: 'MERGED', headRefOid: parentHead, mergeCommit: { oid: merged } });
  return { f, parent, child, base, merged };
}

test('recorded squash base replays only child commits, including empty children', async t => {
  for (const own of [false, true]) {
    const { f, child, merged } = await stacked(t, { own });
    // Ordinary session refresh does not erase provenance.
    await writeClaim({ ...child.c, updatedAt: 'later' }, { stateDir: f.stateDir });
    const recipe = await f.store.stackRebase(child.c.issue, child.who, 10);
    await run(recipe.command, recipe.args, recipe.cwd);
    assert.equal(Number((await child.git('rev-list', '--count', `${merged}..HEAD`)).trim()), own ? 1 : 0);
    assert.equal(await readFile(join(child.cwd, 'shared.txt'), 'utf8'), 'parent one\n');
    if (own) assert.equal(await readFile(join(child.cwd, 'child.txt'), 'utf8'), 'child only\n');
  }
});

test('missing/wrong stack base and dirty child refuse a rebase without losing work', async t => {
  const { f, child, base } = await stacked(t);
  await assert.rejects(f.store.stackRecord(child.c.issue, child.who, child.cwd, 'other', base), /already recorded/);
  await writeFile(join(child.cwd, 'keep'), 'local');
  await assert.rejects(f.store.stackRebase(child.c.issue, child.who, 10), /dirty/);
  assert.equal(await readFile(join(child.cwd, 'keep'), 'utf8'), 'local'); await rm(join(child.cwd, 'keep'));
  const path = join(f.stateDir, 'stacks', child.c.issue, `${hash(child.c.claimedAt)}.json`);
  const record = JSON.parse(await readFile(path)); record.base = 'c'.repeat(40); await atomicJson(path, record);
  await assert.rejects(f.store.stackRebase(child.c.issue, child.who, 10));
  await rm(path); await assert.rejects(f.store.stackRebase(child.c.issue, child.who, 10), /missing or stale/);
});

test('textual conflict stays with worker; clean rebase still needs semantic tests', async t => {
  const textual = await stacked(t, { conflict: true });
  const recipe = await textual.f.store.stackRebase(textual.child.c.issue, textual.child.who, 10);
  await assert.rejects(run(recipe.command, recipe.args, recipe.cwd));
  assert.match(await textual.child.git('status', '--porcelain'), /UU shared.txt/);
  await textual.child.git('rebase', '--abort');
  const semantic = await stacked(t, { semantic: true });
  const clean = await semantic.f.store.stackRebase(semantic.child.c.issue, semantic.child.who, 10);
  await run(clean.command, clean.args, clean.cwd);
  await assert.rejects(run(process.execPath, ['consumer.mjs'], semantic.child.cwd), /does not provide an export named 'oldName'/);
});

test('a main advance keeps the owner and requires another rebase/prepare cycle', async t => {
  const f = await fixture(t), a = await f.worker('JAU-1'); await prepare(f, a); const p = f.pr(10, a);
  await writeFile(join(f.root, 'external.txt'), 'external merge\n'); await f.git('add', '.'); await f.git('commit', '-m', 'external change');
  f.remoteMain = (await f.git('rev-parse', 'HEAD')).trim();
  await assert.rejects(f.store.merge(a.c.issue, a.who, 10), /main changed/);
  await a.git('rebase', 'main');
  const evidence = await f.store.prepare(a.c.issue, a.who);
  assert.equal(evidence.base, f.remoteMain); p.headRefOid = evidence.head;
  assert.equal((await f.store.merge(a.c.issue, a.who, 10)).merged, 10);
});

test('changed children and a stop during retargeting prevent the parent merge', async t => {
  const f = await fixture(t), a = await f.worker('JAU-1'); await prepare(f, a); f.pr(10, a);
  f.pr(11, { branch: 'agent/JAU-11' }, { baseRefName: a.branch }); f.children = [11];
  const runner = f.runner;
  f.store = landingStore({ root: f.root, stateDir: f.stateDir, run: async (cmd, args, cwd) => {
    const result = await runner(cmd, args, cwd);
    if (cmd === 'gh' && args[1] === 'edit') await atomicJson(join(f.stateDir, 'claims', 'JAU-1.stop'), { reason: 'changed dependency' });
    return result;
  } });
  await assert.rejects(f.store.merge(a.c.issue, a.who, 10), /stop requested/);
  assert.equal(f.calls.some(args => args[1] === 'merge'), false);
  await rm(join(f.stateDir, 'claims', 'JAU-1.stop'));
  f.prs.get(11).headRefOid = 'b'.repeat(40);
  await assert.rejects(f.store.merge(a.c.issue, a.who, 10), /child PR changed/);
});

test('canonical CLI acquire persists landing and status without touching another claim', async t => {
  const { copyFile, symlink } = await import('node:fs/promises');
  const f = await fixture(t), a = await f.worker('JAU-1'), b = await f.worker('JAU-2');
  await mkdir(join(f.root, 'scripts'));
  for (const name of ['linear_agent.mjs', 'linear_landing.mjs', 'linear_workers.mjs', 'linear_watch.mjs', 'linear_skills.mjs']) await copyFile(new URL(`../scripts/${name}`, import.meta.url), join(f.root, 'scripts', name));
  await symlink(f.stateDir, join(f.root, '.dev-state'));
  const cli = async (...args) => JSON.parse(await run(process.execPath, [join(f.root, 'scripts', 'linear_agent.mjs'), ...args], a.cwd));
  assert.equal((await cli('landing', 'acquire', a.c.issue, '--runtime', 'codex', '--session', a.c.session)).acquired, true);
  assert.equal(JSON.parse(await readFile(join(f.stateDir, 'claims', 'JAU-1.json'))).phase, 'landing');
  assert.deepEqual(JSON.parse(await readFile(join(f.stateDir, 'claims', 'JAU-2.json'))), b.c);
  assert.equal((await cli('landing', 'status')).owner.issue, a.c.issue);
  await assert.rejects(cli('landing', 'acquire', a.c.issue, '--runtime', 'claude', '--session', a.c.session), /exact claim/);
  await assert.rejects(cli('landing', 'acquire', a.c.issue, '--unknown', 'x'), /unknown landing argument/);
});

test('valid JSON corruption cannot erase a durable owner', async t => {
  const f = await fixture(t), a = await f.worker('JAU-1'); await reserve(f, a);
  for (const value of [null, false, 0, '', {}, []]) {
    await atomicJson(join(f.stateDir, 'landing.json'), value);
    await assert.rejects(reserve(f, a), /invalid landing state/);
    assert.deepEqual(JSON.parse(await readFile(join(f.stateDir, 'landing.json'))), value);
  }
});

test('explicit GitHub refusal after main moves permits same-owner rebase and prepare', async t => {
  const f = await fixture(t), a = await f.worker('JAU-1'); await prepare(f, a); const p = f.pr(10, a);
  let reject = true;
  const store = landingStore({ root: f.root, stateDir: f.stateDir, run: async (cmd, args, cwd) => {
    if (cmd === 'gh' && args[1] === 'merge' && reject) {
      await writeFile(join(f.root, 'external.txt'), 'external merge\n'); await f.git('add', '.'); await f.git('commit', '-m', 'external');
      f.remoteMain = (await f.git('rev-parse', 'HEAD')).trim();
      throw Object.assign(new Error('policy rejected'), { code: 1, stderr: 'Pull request is not mergeable: the base branch policy prohibits the merge' });
    }
    return f.runner(cmd, args, cwd);
  } });
  await assert.rejects(store.merge(a.c.issue, a.who, 10), /explicitly rejected/);
  const entry = (await landingState(f.stateDir)).queue[0];
  assert.equal(entry.issue, a.c.issue); assert.equal(entry.mergeAttempted, undefined); assert.equal(entry.rejections.length, 1);
  await a.git('rebase', 'main'); const prepared = await store.prepare(a.c.issue, a.who); p.headRefOid = prepared.head;
  reject = false; assert.equal((await store.merge(a.c.issue, a.who, 10)).merged, 10);
});

test('pre-upgrade landing phase can refresh its exact session but cannot merge before acquisition', async t => {
  const f = await fixture(t), a = await f.worker('JAU-1');
  const legacy = { ...a.c, phase: 'landing' };
  await atomicJson(join(f.stateDir, 'claims', 'JAU-1.json'), legacy);
  await writeClaim({ ...legacy, updatedAt: 'resumed' }, { stateDir: f.stateDir });
  await assert.rejects(writeClaim({ ...legacy, session: 'other' }, { stateDir: f.stateDir }), /landing acquire/);
  f.pr(10, a); await assert.rejects(f.store.merge(a.c.issue, a.who, 10), /held by nobody/);
  assert.equal((await reserve(f, a)).acquired, true);
});
