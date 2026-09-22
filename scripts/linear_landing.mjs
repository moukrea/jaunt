// One durable landing turn per canonical checkout. No timeout transfers ownership.
import { realpath, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { atomicJson, readJson, withWorkerLock, hash } from './linear_workers.mjs';
const exec = promisify(execFile);
const runDefault = async (cmd, args, cwd) => (await exec(cmd, args, { cwd, maxBuffer: 8 * 1024 * 1024 })).stdout;
const key = id => typeof id === 'string' && /^[A-Z][A-Z0-9]*-\d+$/.test(id);
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const same = (a, b) => ['issue', 'claimedAt', 'runtime', 'session'].every(k => a?.[k] === b?.[k]);
function identity(c) {
  if (!key(c?.issue) || !c.claimedAt || !['codex', 'claude'].includes(c.runtime) || typeof c.session !== 'string' || !c.session.trim()) throw new Error('landing requires a claim cycle and actual runtime/session');
  return Object.fromEntries(['issue', 'claimedAt', 'runtime', 'session'].map(k => [k, c[k]]));
}
export async function landingState(stateDir) {
  let state;
  try { state = JSON.parse(await readFile(join(stateDir, 'landing.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return { version: 1, queue: [], history: [] }; throw error; }
  if (!state || state.version !== 1 || !Array.isArray(state.queue) || !Array.isArray(state.history)) throw new Error('invalid landing state; preserve it for reconciliation');
  const seen = new Set();
  for (const item of state.queue) {
    identity(item);
    if (!item.branch || !item.cwd || seen.has(item.issue)) throw new Error('invalid or duplicate landing entry');
    seen.add(item.issue);
  }
  return state;
}
// Called at the common claim writer, including direct `claim ... landing`.
export async function assertLandingAdmission(stateDir, claim, previous) {
  const state = await landingState(stateDir);
  // A pre-upgrade landing worker must be able to register its unchanged
  // session before acquiring. This grants no merge right: owner() requires
  // the durable queue. Never refresh across a conflicting reservation.
  const resume = previous?.phase === 'landing' && same(previous, claim) && !state.queue.some(item => item.issue === claim.issue);
  if (!resume && !state.queue.some(item => same(item, claim))) throw new Error('request jaunt-linear landing acquire before entering landing');
}
export async function assertLandingReleased(stateDir, id) {
  if ((await landingState(stateDir)).queue.some(item => item.issue === id)) throw new Error('release the landing reservation before releasing the claim');
}

export function landingStore({ root, stateDir = join(root, '.dev-state'), run = runDefault, now = () => new Date().toISOString() }) {
  const file = join(stateDir, 'landing.json');
  const lock = action => withWorkerLock(stateDir, 'LANDING-0', action);
  const git = (args, cwd = root) => run('git', args, cwd);
  const gh = async args => JSON.parse(await run('gh', args, root));
  const save = state => atomicJson(file, state);
  async function held(id, who) {
    if (!key(id)) throw new Error('invalid issue identifier');
    const c = await readJson(join(stateDir, 'claims', `${id}.json`));
    identity(c);
    if (c.issue !== id || !who || who.session !== c.session || who.runtime !== c.runtime) throw new Error('resume the exact claim runtime/session');
    return c;
  }
  async function enabled(id) {
    if ((await readJson(join(stateDir, 'linear-loop.json')))?.enabled !== true) throw new Error('loop is off; preserve branch and reservation');
    if (await readJson(join(stateDir, 'claims', `${id}.stop`))) throw new Error('stop requested; preserve branch and reservation');
  }
  async function checkout(c, cwd) {
    cwd = await realpath(cwd);
    const common = await realpath((await git(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd)).trim());
    const expected = await realpath((await git(['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim());
    if (common !== expected) throw new Error('worktree belongs to a different repository');
    const branch = (await git(['branch', '--show-current'], cwd)).trim();
    if (!branch.split(/[^A-Za-z0-9-]+/).includes(c.issue)) throw new Error('worktree branch must carry the exact ticket identifier');
    return { cwd, branch };
  }
  async function clean(c, cwd) {
    const dirty = await git(['status', '--porcelain=v1', '--untracked-files=all', '-z'], cwd);
    if (!dirty) return;
    if (dirty === '?? plan.md\0') {
      const receipt = await readJson(join(stateDir, 'workers', c.issue, hash(c.claimedAt), 'publication.json'));
      if (receipt?.claimedAt === c.claimedAt && receipt.document && receipt.hash === hash(await readFile(join(cwd, 'plan.md')))) return;
    }
    throw new Error('dirty worktree; preserve changes before rebasing/preparing');
  }
  async function owner(id, who, state) {
    const c = await held(id, who), entry = state.queue[0];
    if (!same(c, entry)) throw new Error(`landing turn held by ${entry?.issue || 'nobody'}; acquire and wait`);
    if (!['implementing', 'landing'].includes(c.phase)) throw new Error('owner is not in an implementation/landing phase');
    await enabled(id);
    return { c, entry };
  }
  async function pr(number) {
    if (!/^\d+$/.test(String(number))) throw new Error('a PR number is required');
    return gh(['pr', 'view', String(number), '--json', 'number,state,headRefName,headRefOid,baseRefName,baseRefOid,mergeCommit,isCrossRepository,statusCheckRollup,mergeStateStatus']);
  }
  function matchesPr(p, entry) {
    if (p.isCrossRepository !== false || p.headRefName !== entry.branch || p.baseRefName !== 'main') throw new Error('PR does not match reserved repository branch/base');
  }
  async function children(branch) {
    // `--slurp` retains each paginated array, including a full last page.
    const pages = await gh(['api', '--paginate', '--slurp', '-X', 'GET', 'repos/{owner}/{repo}/pulls', '-f', 'state=open', '-f', `base=${branch}`, '-f', 'per_page=100']);
    if (!Array.isArray(pages) || pages.some(p => !Array.isArray(p))) throw new Error('invalid child PR inventory');
    return pages.flat();
  }
  async function mainHead() {
    const result = await gh(['api', 'repos/{owner}/{repo}/git/ref/heads/main']);
    if (!sha(result?.object?.sha)) throw new Error('cannot verify remote main');
    return result.object.sha;
  }
  function checks(p) {
    const all = p.statusCheckRollup;
    if (!Array.isArray(all)) throw new Error('missing checks');
    for (const name of ['lint', 'test']) {
      const found = all.filter(c => (c.name || c.context) === name);
      if (!found.length || found.some(c => c.__typename === 'StatusContext' ? c.state !== 'SUCCESS' : c.status !== 'COMPLETED' || c.conclusion !== 'SUCCESS')) throw new Error(`required check ${name} is not successful`);
    }
  }
  async function finish(state, entry, result) {
    state.history.push({ ...entry, ...result, releasedAt: now() });
    state.queue = state.queue.filter(e => e !== entry);
    await save(state);
    return { released: true, ...result, next: state.queue[0]?.issue || null };
  }
  async function status() {
    const state = await landingState(stateDir);
    const queue = await Promise.all(state.queue.map(async entry => {
      const current = await readJson(join(stateDir, 'claims', `${entry.issue}.json`));
      return { ...entry, current: same(entry, current), stopped: Boolean(await readJson(join(stateDir, 'claims', `${entry.issue}.stop`))) };
    }));
    return { owner: queue[0] || null, queue, enabled: (await readJson(join(stateDir, 'linear-loop.json')))?.enabled === true };
  }
  return {
    status,
    async verifyMerged(id, who, number, cwd) {
      return lock(async () => {
        const c = await held(id, who), state = await landingState(stateDir);
        await enabled(id);
        if (state.queue.some(e => e.issue === id)) throw new Error('landing reservation remains; reconcile merge first');
        const entry = [...state.history].reverse().find(e => same(c, e) && e.merged === Number(number));
        if (!entry?.prepared?.head || !entry.mergeAttempted) throw new Error('no matching verified merge history; preserve legacy evidence');
        const location = await checkout(c, cwd || entry.cwd);
        if (location.cwd !== entry.cwd || location.branch !== entry.branch) throw new Error('merged worktree changed');
        await clean(c, location.cwd);
        const p = await pr(number); matchesPr(p, entry);
        if (p.state !== 'MERGED' || p.headRefOid !== entry.prepared.head || p.mergeCommit?.oid !== entry.commit ||
            (await git(['rev-parse', 'HEAD'], location.cwd)).trim() !== p.headRefOid) throw new Error('merged head/commit mismatch');
        await git(['fetch', 'origin'], location.cwd);
        await git(['merge-base', '--is-ancestor', p.mergeCommit.oid, 'origin/main'], location.cwd);
        await clean(c, location.cwd);
        if ((await checkout(c, location.cwd)).branch !== entry.branch ||
            (await git(['rev-parse', 'HEAD'], location.cwd)).trim() !== p.headRefOid) throw new Error('worktree changed during merge verification');
        return { pr: p.number, head: p.headRefOid, merge: p.mergeCommit.oid, ...location };
      });
    },
    async acquire(id, who, cwd) {
      return lock(async () => {
        const c = await held(id, who);
        if (!['implementing', 'landing'].includes(c.phase)) throw new Error('approval and surface admission required before landing');
        await enabled(id);
        const location = await checkout(c, cwd), state = await landingState(stateDir);
        const existing = state.queue.find(e => e.issue === id);
        if (existing && (!same(c, existing) || existing.cwd !== location.cwd || existing.branch !== location.branch)) throw new Error('stale landing identity/worktree; preserve reservation');
        if (!existing) {
          state.queue.push({ ...identity(c), ...location, requestedAt: now() });
          await save(state);
        }
        return { acquired: same(c, state.queue[0]), owner: state.queue[0].issue, position: state.queue.findIndex(e => e.issue === id) + 1 };
      });
    },
    async prepare(id, who) {
      return lock(async () => {
        const state = await landingState(stateDir), { c, entry } = await owner(id, who, state);
        if ((await checkout(c, entry.cwd)).branch !== entry.branch) throw new Error('reserved branch changed');
        await clean(c, entry.cwd);
        if (entry.mergeAttempted) throw new Error('reconcile the attempted merge before preparing another head');
        const head = (await git(['rev-parse', 'HEAD'], entry.cwd)).trim(), base = await mainHead();
        await git(['merge-base', '--is-ancestor', base, head], entry.cwd);
        entry.prepared = { head, base, at: now() };
        await save(state);
        return entry.prepared;
      });
    },
    async merge(id, who, number) {
      return lock(async () => {
        const state = await landingState(stateDir), { c, entry } = await owner(id, who, state);
        let p = await pr(number); matchesPr(p, entry);
        if (entry.pr && entry.pr !== p.number) throw new Error('reservation already bound to another PR');
        if (p.state === 'MERGED') {
          if (!entry.mergeAttempted || entry.pr !== p.number || p.headRefOid !== entry.prepared?.head || !sha(p.mergeCommit?.oid)) throw new Error('no matching attempted-merge evidence');
          return finish(state, entry, { merged: p.number, commit: p.mergeCommit.oid });
        }
        if (p.state !== 'OPEN') throw new Error('PR is not open; inspect it and release explicitly');
        if ((await checkout(c, entry.cwd)).branch !== entry.branch) throw new Error('reserved branch changed');
        await clean(c, entry.cwd);
        if ((await git(['rev-parse', 'HEAD'], entry.cwd)).trim() !== entry.prepared?.head) throw new Error('local head changed; prepare and test the new commit');
        if (!sha(entry.prepared?.head) || p.headRefOid !== entry.prepared.head || await mainHead() !== entry.prepared.base) throw new Error('head/main changed or not prepared; rebase, prepare, test and push again');
        if (p.mergeStateStatus !== 'CLEAN') throw new Error('PR is not clean/mergeable');
        checks(p);
        entry.pr = p.number;
        entry.children ||= [];
        for (const child of await children(entry.branch)) {
          if (!Number.isInteger(child.number) || child.base?.ref !== entry.branch || child.head?.repo?.full_name !== child.base?.repo?.full_name) throw new Error('ambiguous child PR; inspect before merging');
          if (!entry.children.some(x => x.number === child.number)) entry.children.push({ number: child.number, branch: child.head.ref, head: child.head.sha, previousBase: entry.branch });
        }
        // Persist the entire inventory before the first external mutation.
        await save(state);
        for (const child of entry.children) {
          let current = await pr(child.number);
          if (current.state !== 'OPEN' || current.headRefName !== child.branch || current.headRefOid !== child.head || current.isCrossRepository !== false) throw new Error('child PR changed; preserve inventory and inspect');
          if (current.baseRefName === entry.branch) {
            await run('gh', ['api', '--method', 'PATCH', `repos/{owner}/{repo}/pulls/${child.number}`, '-f', 'base=main'], root);
            current = await pr(child.number);
          }
          if (current.state !== 'OPEN' || current.baseRefName !== 'main' || current.headRefOid !== child.head) throw new Error('child retarget not verified; parent cannot merge');
        }
        if ((await children(entry.branch)).length) throw new Error('new child PR appeared; retry inventory before merge');
        // Re-read after retargeting/network waits. GitHub strict checks cover the
        // remaining remote race; --match-head-commit forbids merging a new head.
        await owner(id, who, state);
        p = await pr(number); matchesPr(p, entry); checks(p);
        if (p.state !== 'OPEN' || p.mergeStateStatus !== 'CLEAN' || p.headRefOid !== entry.prepared.head || await mainHead() !== entry.prepared.base) throw new Error('PR/main changed during preparation');
        entry.mergeAttempted = now(); await save(state);
        let rejected = false;
        try { await run('gh', ['pr', 'merge', String(number), '--squash', '--match-head-commit', entry.prepared.head], root); }
        catch (error) {
          // Only explicit server/policy refusals are known not to have merged.
          // Network failures and unknown errors retain the attempted-head evidence.
          rejected = Number.isInteger(error.code) && /base branch policy prohibits the merge|Base branch was modified|Head branch was modified|Required status check .* (?:expected|failing)/i.test(error.stderr || '');
        }
        p = await pr(number); matchesPr(p, entry);
        if (p.state === 'OPEN' && rejected) {
          (entry.rejections ||= []).push({ at: entry.mergeAttempted, prepared: entry.prepared });
          delete entry.mergeAttempted;
          await save(state);
          throw new Error('merge explicitly rejected; turn retained, fetch/rebase/prepare and rerun checks');
        }
        if (p.state !== 'MERGED' || p.headRefOid !== entry.prepared.head || !sha(p.mergeCommit?.oid)) throw new Error('merge not verified; reservation retained, inspect PR and retry');
        return finish(state, entry, { merged: p.number, commit: p.mergeCommit.oid });
      });
    },
    async release(id, who, reason) {
      if (typeof reason !== 'string' || !reason.trim()) throw new Error('release needs an explicit reason');
      return lock(async () => {
        const c = await held(id, who), state = await landingState(stateDir), entry = state.queue.find(e => e.issue === id);
        if (!entry) return { released: false, reason: 'not queued' };
        if (!same(c, entry)) throw new Error('stale reservation; resume its exact owner');
        const open = await gh(['pr', 'list', '--state', 'open', '--head', entry.branch, '--json', 'number']);
        if (!Array.isArray(open)) throw new Error('cannot verify branch PRs');
        if (entry.mergeAttempted) {
          const p = await pr(entry.pr); matchesPr(p, entry);
          if (p.state === 'OPEN') throw new Error('attempted merge unresolved; keep reservation');
          if (!['MERGED', 'CLOSED'].includes(p.state)) throw new Error('unknown PR state');
          if (p.state === 'MERGED' && (p.headRefOid !== entry.prepared?.head || !sha(p.mergeCommit?.oid))) throw new Error('merged head differs from attempted head');
        }
        // An abandoned open PR is preserved, not closed or merged. Its old checks
        // never authorize a later merge: reacquisition requires a new prepare.
        return finish(state, entry, { abandoned: true, reason, openPRs: open.map(p => p.number) });
      });
    },
    async stackRecord(id, who, cwd, parent, base) {
      return lock(async () => {
        const c = await held(id, who); await enabled(id);
        const location = await checkout(c, cwd); await clean(c, location.cwd);
        if (typeof parent !== 'string' || parent.startsWith('-') || parent === location.branch || !sha(base)) throw new Error('stack needs parent branch and full base SHA');
        const path = join(stateDir, 'stacks', id, `${hash(c.claimedAt)}.json`), old = await readJson(path);
        if (old) {
          if (!same(old, c) || old.parent !== parent || old.base !== base || old.cwd !== location.cwd || old.branch !== location.branch) throw new Error('stack provenance already recorded; do not overwrite');
          return old;
        }
        const head = (await git(['rev-parse', 'HEAD'], location.cwd)).trim();
        const parentHead = (await git(['rev-parse', '--verify', `${parent}^{commit}`], location.cwd)).trim();
        if (head !== base || parentHead !== base) throw new Error('record the exact parent head before the first child commit');
        const entry = { ...identity(c), ...location, parent, base, initialHead: head, recordedAt: now() };
        await atomicJson(path, entry); return entry;
      });
    },
    async stackRebase(id, who, number) {
      const c = await held(id, who); await enabled(id);
      if (!['implementing', 'landing'].includes(c.phase)) throw new Error('approval and surface admission required before rebase');
      const entry = await readJson(join(stateDir, 'stacks', id, `${hash(c.claimedAt)}.json`));
      if (!entry || !same(entry, c) || !sha(entry.base)) throw new Error('missing or stale stack provenance; do not guess the old base');
      const location = await checkout(c, entry.cwd);
      if (location.branch !== entry.branch) throw new Error('child branch changed');
      await clean(c, entry.cwd);
      const parent = await pr(number);
      if (parent.state !== 'MERGED' || parent.isCrossRepository !== false || parent.headRefName !== entry.parent || parent.baseRefName !== 'main' || !sha(parent.mergeCommit?.oid)) throw new Error('verify the recorded parent was merged into main');
      await git(['fetch', 'origin'], entry.cwd);
      try { await git(['cat-file', '-e', `${parent.headRefOid}^{commit}`], entry.cwd); }
      catch { await git(['fetch', 'origin', `refs/pull/${number}/head`], entry.cwd); }
      await git(['merge-base', '--is-ancestor', entry.base, parent.headRefOid], entry.cwd);
      await git(['merge-base', '--is-ancestor', entry.base, 'HEAD'], entry.cwd);
      await git(['merge-base', '--is-ancestor', parent.mergeCommit.oid, 'origin/main'], entry.cwd);
      return { cwd: entry.cwd, command: 'git', args: ['rebase', '--onto', 'origin/main', entry.base, entry.branch],
        next: 'Run in the owning worker only. Resolve conflicts, verify helper definitions/callers, and run npm test plus surface tests even after a clean rebase.' };
    },
  };
}
