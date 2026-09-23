import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, copyFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { workerHealth, retryDecision, classifyFailure, processIdentity, identityState, beginAttempt, saveAttempt, currentAttempt, lifecyclePaths, atomicJson, readJson, workerReports, workerWake, recoveryPreflight, withWorkerLock, cleanupWorktree, hash } from '../scripts/linear_workers.mjs';
import { closureStore } from '../scripts/linear_agent.mjs';
const exec = promisify(execFile);
const claim = { issue: 'JAU-999', claimedAt: '2026-09-21T00:00:00Z', runtime: 'codex', session: 'exact', phase: 'implementing' };
const old = '2026-09-21T00:00:00Z';
const record = { ...claim, attempt: 'attempt', wrapper: {pid: 9, started: 'old'}, child: {pid: 10, started: 'old'}, childExited: true, endedAt: old, code: 1, startedAt: old };
const gone = () => 'gone';
const pause = ms => new Promise(r => setTimeout(r, ms));
async function temporary(fn) { const dir = await mkdtemp(join(tmpdir(), 'jaunt-workers-')); try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); } }

test('liveness never mistakes silence, live children, resting or other generations for interrupted work', () => {
  const health = (c, r, identity = gone) => workerHealth(c, r, { identity });
  assert.equal(health(claim, record).state, 'interrupted');
  assert.equal(health(claim, { ...record, childExited: false }, i => i?.pid === 10 ? 'alive' : 'gone').state, 'suspect');
  assert.equal(health(claim, { ...record, child: null, childExited: false }).state, 'interrupted'); // injected confirmed gone
  assert.equal(health(claim, { ...record, childExited: false }, () => 'unknown').state, 'unknown');
  for (const phase of ['queued', 'awaiting-approval']) assert.equal(health({ ...claim, phase }, record).state, 'resting');
  assert.equal(health(claim, { ...record, code: 0 }).state, 'finished');
  assert.equal(health(claim, { ...record, cancelled: 'owner-closed' }).state, 'interrupted');
  assert.equal(health(claim, { ...record, cancelled: 'loop-off' }).state, 'suspended');
  for (const change of [{ claimedAt: 'new' }, { session: 'different' }, { runtime: 'claude' }]) assert.equal(health(claim, { ...record, ...change }).state, 'unknown');
  assert.equal(identityState(processIdentity(process.pid)), 'alive');
  assert.equal(identityState({ pid: process.pid, started: 'recycled' }), 'gone');
  assert.equal(identityState(null), 'unknown');
});

test('quota evidence has explicit timestamps; bounded attempts survive restarts and never infer quota from concurrent exits', () => {
  const f = classifyFailure({ message: 'quota exceeded', reset_at: '2026-09-25T19:00:00+02:00' });
  assert.equal(f.resetAt, '2026-09-25T17:00:00.000Z');
  const decision = retryDecision({ ...record, failure: f }, { attempts: 1 });
  assert.equal(decision.retryAt, '2026-09-25T17:00:30.000Z');
  assert.equal(classifyFailure('all workers exited').kind, 'transient');
  assert.equal(classifyFailure('quota resets Friday at 7').resetAt, null);
  assert.equal(classifyFailure('authentication failed').kind, 'configuration');
  assert.equal(retryDecision(record, { attempts: 3 }).blocked, 'retry budget exhausted');
  assert.equal(retryDecision({ ...record, failure: { kind: 'configuration' } }).blocked, 'configuration');
  assert.equal(Date.parse(retryDecision(record, { attempts: 2 }).retryAt) - Date.parse(old), 1800000);
  assert.ok(!JSON.stringify(classifyFailure('quota token=SECRET')).includes('SECRET'));
});

test('old attempt completion cannot replace the current attempt; launches exclude concurrent processes', async () => temporary(async state => {
  const first = await beginAttempt(state, claim, {});
  const second = await beginAttempt(state, claim, {});
  await saveAttempt(state, { ...first, endedAt: old });
  assert.equal((await currentAttempt(state, claim)).attempt, second.attempt);
  await withWorkerLock(state, claim.issue, async () => {
    await assert.rejects(withWorkerLock(state, claim.issue, () => assert.fail('duplicate')), /already in progress/);
  });
  await withWorkerLock(state, claim.issue, async () => {});
}));

test('watchdog recovery deadline and notification dedup survive restart and stop/loop flags', async () => temporary(async state => {
  await atomicJson(join(state, 'claims', 'JAU-999.json'), claim);
  await atomicJson(join(state, 'linear-loop.json'), { enabled: true });
  const attempt = await beginAttempt(state, claim, { ...record, wrapper: null, child: null, childExited: true });
  const now = Date.now();
  const first = await workerWake(state, now);
  assert.equal(first.wake, 'worker-recovery-due');
  assert.equal(await workerWake(state, now + 1), null);
  assert.equal((await workerWake(state, now + 300001)).wake, 'worker-recovery-due');
  await atomicJson(join(state, 'claims', 'JAU-999.stop'), { stop: true });
  assert.equal(await workerWake(state, now + 700000), null);
  await rm(join(state, 'claims', 'JAU-999.stop'));
  await atomicJson(join(state, 'linear-loop.json'), { enabled: false });
  assert.equal(await workerWake(state, now + 700000), null);
  assert.equal((await workerReports(state))[0].attempt, attempt.attempt);
}));

test('recovery rechecks approval, PR, direct prerequisites, identity and stop under the launch lock', async () => temporary(async state => {
  await atomicJson(join(state, 'linear-loop.json'), { enabled: true });
  const interrupted = { ...record, child: null, wrapper: null };
  const args = { state, claim, record: interrupted,
    agent: async command => ({ show: { state: { type: 'started' } }, verdict: { verdict: 'approved' }, independent: { independent: true }, claims: [claim] })[command],
    prState: async () => 'OPEN' };
  assert.equal((await recoveryPreflight(args)).attempts, 1);
  await assert.rejects(recoveryPreflight({ ...args, prState: async () => 'MERGED' }), /merged/);
  await assert.rejects(recoveryPreflight({ ...args, agent: async c => c === 'verdict' ? { verdict: 'feedback' } : args.agent(c) }), /approval/);
  await assert.rejects(recoveryPreflight({ ...args, agent: async c => c === 'show' ? { inverseRelations: { nodes: [{ type: 'blocks', issue: { state: { type: 'backlog' } } }] } } : args.agent(c) }), /prerequisite/);
  await assert.rejects(recoveryPreflight({ ...args, agent: async c => c === 'claims' ? [{ ...claim, updatedAt: 'new' }] : args.agent(c) }), /claim changed/);
  await atomicJson(join(state, 'claims', 'JAU-999.stop'), {});
  await assert.rejects(recoveryPreflight(args), /stop requested/);
}));

for (const runtime of ['codex', 'claude']) test(`${runtime}: offline crash, durable watchdog wake and one exact-session recovery`, { timeout: 20000 }, async () => temporary(async dir => {
  await mkdir(join(dir, 'scripts')); await mkdir(join(dir, 'bin'));
  for (const name of ['linear_routing.mjs', 'linear_skills.mjs', 'linear_codex.mjs', 'linear_workers.mjs', 'linear_telemetry.mjs', 'linear_wakes.mjs', 'linear_claude.mjs', 'linear_waits.mjs']) await copyFile(new URL('../scripts/' + name, import.meta.url), join(dir, 'scripts', name));
  await copyFile(process.execPath, join(dir, 'bin/codex-fixture'));
  const held = { ...claim, runtime, session: runtime === 'claude' ? 'exact' : null };
  await atomicJson(join(dir, '.dev-state/claims/JAU-999.json'), held);
  await atomicJson(join(dir, '.dev-state/linear-loop.json'), { enabled: true });
  await writeFile(join(dir, 'scripts/linear_agent.mjs'), `
    import {readFileSync,realpathSync} from 'node:fs'; export const entryPath=p=>realpathSync(p);
    const c=process.argv[2];
    if(c==='claims') console.log('['+readFileSync('.dev-state/claims/JAU-999.json')+']');
    if(c==='show') console.log('{"state":{"type":"started"}}');
    if(c==='independent') console.log('{"independent":true}');
    if(c==='verdict') console.log('{"verdict":"approved"}');
  `);
  await writeFile(join(dir, 'scripts/linear_watch.mjs'), `export const livePid=p=>{try{process.kill(p,0);return Boolean(p);}catch{return false;}};`);
  await writeFile(join(dir, 'bin/gh'), '#!/bin/sh\nprintf \'[{"state":"OPEN"}]\'\n'); await chmod(join(dir, 'bin/gh'), 0o755);
  for (const name of ['claude', 'codex']) {
    await writeFile(join(dir, 'bin', name), `#!/usr/bin/env node
      const fs=require('node:fs'),p=process.env.FIXTURE_ROOT+'/calls.jsonl',a=process.argv.slice(2);
      if(a[0]==='queue')process.exit(0);
      const before=fs.existsSync(p);fs.appendFileSync(p,JSON.stringify(a)+'\\n');
      console.log(JSON.stringify(${runtime === 'codex' ? "{type:'thread.started',thread_id:'exact'}" : "{type:'system',subtype:'init',claude_code_version:'2.1.276',session_id:'exact'}"}));
      process.stdin.resume();process.stdin.on('end',()=>{
        if(!before) {console.log(JSON.stringify({type:'turn.failed',error:{message:'transient crash'}}));process.exitCode=1;}
        else {
          console.log(JSON.stringify(${runtime === 'codex' ? "{type:'turn.started'}" : "{type:'assistant',message:{id:'msg-observed',model:'observed-model',usage:{input_tokens:4,output_tokens:1}}}"}));
          const final=${runtime === 'codex' ? "{type:'turn.completed',usage:{input_tokens:8,cached_input_tokens:0,output_tokens:3}}" : "{type:'result',session_id:'exact',total_cost_usd:0.02,usage:{input_tokens:8,cache_read_input_tokens:0,output_tokens:3}}"};
          console.log(JSON.stringify(final));console.log(JSON.stringify(final));
        }
      });
    `); await chmod(join(dir, 'bin', name), 0o755);
  }
  await exec('git', ['init', '-q'], { cwd: dir }); await exec('git', ['checkout', '-q', '-b', 'agent/JAU-999'], { cwd: dir });
  await writeFile(join(dir, 'owner.mjs'), `
    import {execFile} from 'node:child_process';import {promisify} from 'node:util';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
    import {currentAttempt,saveAttempt,workerWake,readJson} from './scripts/linear_workers.mjs';
    const exec=promisify(execFile),state=process.cwd()+'/.dev-state',claim=await readJson(state+'/claims/JAU-999.json');
    const call=async(...args)=>JSON.parse((await exec(process.env.REAL_NODE,['scripts/linear_${runtime}.mjs',...args])).stdout);
    const wait=async fn=>{for(let n=0;n<150;n++){if(await fn())return;await new Promise(r=>setTimeout(r,30));}throw Error('timeout');};
    await call('worker','JAU-999','--cwd',process.cwd(),'--model','fixture-model');
    await wait(async()=>Boolean((await currentAttempt(state,claim))?.endedAt));
    let r=await currentAttempt(state,claim);assert.equal(r.code,1);assert.equal(r.session,'exact');
    r.endedAt=new Date(Date.now()-120000).toISOString();await saveAttempt(state,r);
    assert.equal((await workerWake(state)).wake,'worker-recovery-due');
    await call('recover','JAU-999');
    await wait(async()=>{const latest=await currentAttempt(state,claim);return latest.attempt!==r.attempt && latest.endedAt;});
    const calls=(await readFile('calls.jsonl','utf8')).trim().split('\\n').map(JSON.parse);
    assert.equal(calls.length,2);assert.ok(calls[1].includes('exact'));
    assert.ok(calls[1].includes('${runtime === 'codex' ? 'resume' : '--resume'}'));assert.ok(calls[1].includes('fixture-model'));
    assert.equal((await readJson(state+'/workers/JAU-999/'+(await import('./scripts/linear_workers.mjs')).hash(claim.claimedAt)+'/schedule.json')).attempts,1);
    const {telemetryReport}=await import('./scripts/linear_telemetry.mjs');
    const report=await telemetryReport(state,claim.issue);
    assert.equal(report.counts.attempts,2);assert.equal(report.counts.recoveries,1);
    assert.equal(report.knownUsageSubtotal.inputTokens.value,8);
    assert.equal(report.knownUsageSubtotal.inputTokens.complete,false);
    assert.equal(report.knownUsageSubtotal.costUsd.value,${runtime === 'codex' ? 'null' : '0.02'});
    const latest=(await currentAttempt(state,claim));
    assert.equal(latest.telemetry.requested.model,'fixture-model');
    assert.equal(latest.telemetry.requested.sources.model,'recovery');
    assert.deepEqual(latest.telemetry.models,${runtime === 'codex' ? '[]' : "['observed-model']"});
    await assert.rejects(call('recover','JAU-999'), /not confirmed interrupted/);
    console.log('recovered');
  `);
  const result = await exec(join(dir, 'bin/codex-fixture'), ['owner.mjs'], { cwd: dir, timeout: 15000, env: { ...process.env, CODEX_THREAD_ID: 'owner', REAL_NODE: process.execPath, FIXTURE_ROOT: dir, PATH: join(dir, 'bin') + ':' + process.env.PATH } });
  assert.match(result.stdout, /recovered/);
}));

test('cleanup protects unpublished work and verifies JAU-50 closure before removal', async () => temporary(async dir => {
  const root = join(dir, 'repo'), state = join(root, '.dev-state'), cwd = join(dir, 'worktree');
  await mkdir(root); await mkdir(cwd);
  await atomicJson(join(state, 'claims', 'JAU-999.json'), claim);
  await atomicJson(join(state, 'claims', 'JAU-999.stop'), { reason: 'keep until released' });
  const store = closureStore({ stateDir: state, readIssue: async () => ({ identifier: 'JAU-999', state: { type: 'completed' } }) });
  let dirty = '', head = 'head', removals = 0;
  const run = async (cmd, args) => {
    if (args[0] === 'worktree') return `worktree ${cwd}\nbranch refs/heads/agent/JAU-999\n\n`;
    if (args[0] === 'rev-parse') return head;
    if (args[0] === 'merge-base') return '';
    if (args[0] === 'status') return dirty;
    assert.fail(args.join(' '));
  };
  const args = { root, state, claim, record: { ...record, wrapper: null, child: null },
    pr: { state: 'MERGED', headRefOid: 'head', headRefName: 'agent/JAU-999', mergeCommit: { oid: 'squash' } }, run,
    remove: async () => { removals++; }, release: hook => store.release('JAU-999', undefined, hook) };
  await assert.rejects(cleanupWorktree(args), /no closure inventory/);
  assert.equal(removals, 0);
  await store.save('JAU-999', { items: [] });
  head = 'unpushed'; await assert.rejects(cleanupWorktree(args), /local commits/); head = 'head';
  for (const entry of [' M file\0', '?? new.txt\0', '!! ignored.txt\0']) {
    dirty = entry; await assert.rejects(cleanupWorktree(args), /local changes/);
  }
  dirty = '?? plan.md\0'; await writeFile(join(cwd, 'plan.md'), 'unpublished');
  await assert.rejects(cleanupWorktree(args), /plan differs/);
  const receiptPath = join(lifecyclePaths(state, claim).dir, 'publication.json');
  await atomicJson(receiptPath, { claimedAt: claim.claimedAt, document: 'doc', hash: hash('published') });
  await assert.rejects(cleanupWorktree(args), /plan differs/);
  await writeFile(join(cwd, 'plan.md'), 'published');
  await assert.rejects(cleanupWorktree({ ...args, remove: async () => { throw Error('git removal refused'); } }), /removal refused/);
  assert.equal(await readFile(join(cwd, 'plan.md'), 'utf8'), 'published');
  assert.ok(await readJson(join(state, 'claims', 'JAU-999.json')));
  assert.ok(await readJson(join(state, 'claims', 'JAU-999.stop')));
  assert.equal((await cleanupWorktree(args)).released, true);
  assert.equal(removals, 1);
  assert.equal(await readJson(join(state, 'claims', 'JAU-999.json')), null);
  assert.equal((await readJson(join(state, 'closures', 'JAU-999.release.json'))).mode, 'closure');
  assert.equal(await readFile(join(lifecyclePaths(state, claim).dir, 'archive/plan.md'), 'utf8'), 'published');
}));

test('a live child outlives its wrapper: no recovery or cleanup is authorized', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},10000)'], { stdio: 'ignore' });
  try {
    const r = { ...record, wrapper: { pid: process.pid, started: 'reused' }, child: processIdentity(child.pid), childExited: false, heartbeatAt: old };
    assert.equal(workerHealth(claim, r).state, 'suspect');
  } finally { child.kill(); await new Promise(resolve => child.once('close', resolve)); }
});

test('real git squash cleanup preserves an extra local commit and removes only the verified PR head', async () => temporary(async dir => {
  const root = join(dir, 'repo'), cwd = join(dir, 'wt'), state = join(root, '.dev-state');
  await mkdir(root);
  const run = async (cmd, args, where = root) => (await exec(cmd, args, { cwd: where })).stdout;
  await run('git', ['init', '-q', '-b', 'main']);
  await run('git', ['config', 'user.email', 'fixture@example.invalid']);
  await run('git', ['config', 'user.name', 'Fixture']);
  await writeFile(join(root, 'file'), 'base'); await run('git', ['add', 'file']); await run('git', ['commit', '-qm', 'base']);
  await run('git', ['worktree', 'add', '-qb', 'agent/JAU-999', cwd]);
  await writeFile(join(cwd, 'file'), 'feature'); await run('git', ['commit', '-qam', 'feature'], cwd);
  const head = (await run('git', ['rev-parse', 'HEAD'], cwd)).trim();
  await run('git', ['merge', '--squash', 'agent/JAU-999']); await run('git', ['commit', '-qm', 'squash']);
  const merged = (await run('git', ['rev-parse', 'HEAD'])).trim();
  await run('git', ['update-ref', 'refs/remotes/origin/main', merged]);
  await atomicJson(join(state, 'claims/JAU-999.json'), claim);
  const store = closureStore({ stateDir: state, readIssue: async () => ({ identifier: claim.issue, state: { type: 'completed' } }) });
  await store.save(claim.issue, { items: [] });
  const args = { root, state, claim, record: { ...record, wrapper: null, child: null }, run,
    pr: { state: 'MERGED', headRefName: 'agent/JAU-999', headRefOid: head, mergeCommit: { oid: merged } },
    remove: path => run('git', ['worktree', 'remove', path]), release: hook => store.release(claim.issue, undefined, hook) };
  await writeFile(join(cwd, 'file'), 'unpublished extra'); await run('git', ['commit', '-qam', 'extra'], cwd);
  await assert.rejects(cleanupWorktree(args), /local commits/);
  await run('git', ['reset', '--hard', head], cwd);
  assert.equal((await cleanupWorktree(args)).released, true);
  await assert.rejects(readFile(join(cwd, 'file')), /ENOENT/);
}));

test('runtime cooldowns isolate providers and persist the retry ceiling', async () => temporary(async state => {
  await atomicJson(join(state, 'linear-loop.json'), { enabled: true });
  const other = { ...claim, issue: 'JAU-998', runtime: 'claude' };
  const failure = { kind: 'quota', resetAt: new Date(Date.now()+3600000).toISOString() };
  await atomicJson(join(state, 'claims/JAU-998.json'), other);
  await beginAttempt(state, other, { ...record, wrapper: null, child: null, failure });
  const args = { state, claim, record: { ...record, wrapper: null, child: null }, prState: async () => 'OPEN',
    agent: async c => ({ show: { state: { type: 'started' } }, verdict: { verdict: 'approved' }, independent: { independent: true }, claims: [claim] })[c] };
  assert.equal((await recoveryPreflight(args)).attempts, 1, 'Claude quota does not delay Codex');
  await atomicJson(join(state, 'claims/JAU-998.json'), { ...other, runtime: 'codex' });
  await beginAttempt(state, { ...other, runtime: 'codex' }, { ...record, wrapper: null, child: null, failure });
  await assert.rejects(recoveryPreflight(args), /runtime quota/);
  await rm(join(state, 'claims/JAU-998.json'));
  await atomicJson(lifecyclePaths(state, claim).schedule, { claimedAt: claim.claimedAt, attempts: 3 });
  await assert.rejects(recoveryPreflight(args), /budget exhausted/);
}));

test('explicit Claude reset dates respect their timezone and reject ambiguous DST', () => {
  const now = Date.parse('2026-09-21T12:00:00Z');
  assert.equal(classifyFailure("You've hit your limit · resets Sep 25 at 7pm (Europe/Paris)", now).resetAt, '2026-09-25T17:00:00.000Z');
  assert.equal(classifyFailure("usage limit resets 11:50pm (Europe/Paris)", now).resetAt, '2026-09-21T21:50:00.000Z');
  assert.equal(classifyFailure('quota resets Oct 25 at 2:30am (Europe/Paris)', now).resetAt, null);
  assert.equal(classifyFailure('quota resets Feb 30 at 7pm (Europe/Paris)', now).resetAt, null);
});

test('forward phase progress clears an exhausted prior-phase budget even before watchdog reconciliation', async () => temporary(async state => {
  await atomicJson(join(state, 'linear-loop.json'), { enabled: true });
  await atomicJson(lifecyclePaths(state, claim).schedule, { claimedAt: claim.claimedAt, attempts: 3, progressPhase: 'planning' });
  const decision = await recoveryPreflight({ state, claim, record: { ...record, child: null, wrapper: null }, prState: async () => 'OPEN',
    agent: async c => ({ show: { state: { type: 'started' } }, verdict: { verdict: 'approved' }, independent: { independent: true }, claims: [claim] })[c] });
  assert.equal(decision.attempts, 1);
}));

test('closure mutation during removal preserves replacement claim and its stop flag', async () => temporary(async state => {
  await atomicJson(join(state, 'claims/JAU-999.json'), claim);
  await atomicJson(join(state, 'claims/JAU-999.stop'), {});
  const store = closureStore({ stateDir: state, readIssue: async () => ({ identifier: claim.issue, state: { type: 'completed' } }) });
  await store.save(claim.issue, { items: [] });
  await assert.rejects(store.release(claim.issue, undefined, async () => {
    await atomicJson(join(state, 'claims/JAU-999.json'), { ...claim, claimedAt: 'replacement' });
  }), /changed during removal/);
  assert.equal((await readJson(join(state, 'claims/JAU-999.json'))).claimedAt, 'replacement');
  assert.deepEqual(await readJson(join(state, 'claims/JAU-999.stop')), {});
}));


test('release retries restoration/removal without dropping supervision or closure evidence', async () => temporary(async state => {
  const held = { ...claim, phase: 'awaiting-approval', parkedFrom: 'Backlog' };
  await atomicJson(join(state, 'claims', 'JAU-999.json'), held);
  await atomicJson(join(state, 'claims', 'JAU-999.stop'), { reason: 'keep until released' });
  const issue = { identifier: held.issue, state: { name: 'Waiting for human', type: 'unstarted' } };
  let moves = 0, removed = 0, offline = true;
  const store = closureStore({ stateDir: state, readIssue: async () => issue,
    moveState: async () => {
      if (offline) throw new Error('offline');
      moves++; issue.state = { name: 'Backlog', type: 'backlog' }; return { moved: true };
    } });
  await store.save(held.issue, { items: [] });
  const remove = async () => { removed++; throw new Error('removal failed'); };
  await assert.rejects(store.release(held.issue, undefined, remove), /offline/);
  assert.equal(removed, 0);
  offline = false;
  await assert.rejects(store.release(held.issue, undefined, remove), /removal failed/);
  assert.equal(moves, 1);
  assert.deepEqual(await readJson(join(state, 'claims', 'JAU-999.json')), held);
  assert.equal((await store.read(held.issue)).current, true);
  assert.ok(await readJson(join(state, 'claims', 'JAU-999.stop')));
  await store.release(held.issue, undefined, async () => { removed++; });
  assert.equal(moves, 1); assert.equal(removed, 2);
  assert.equal(await readJson(join(state, 'claims', 'JAU-999.json')), null);
}));


test('an incompletely published worker lock stays busy without being stolen', async () => temporary(async state => {
  const path = join(state, 'workers', `${claim.issue}.lock`);
  await mkdir(join(state, 'workers'));
  for (const bytes of ['', '{"pid":']) {
    await writeFile(path, bytes);
    await assert.rejects(withWorkerLock(state, claim.issue, () => assert.fail('uncertain lock stolen')), /already in progress or uncertain/);
    assert.equal(await readFile(path, 'utf8'), bytes);
    await assert.rejects(readFile(`${path}.reap`), { code: 'ENOENT' });
  }
  await writeFile(path, JSON.stringify(processIdentity(process.pid)));
  await assert.rejects(withWorkerLock(state, claim.issue, () => assert.fail('live lock stolen')), /already in progress/);
  await rm(path);
  let entered = false;
  await withWorkerLock(state, claim.issue, async () => { entered = true; });
  assert.equal(entered, true);
}));

// JAU-38 accounting stays local and retains all claim cycles after release.
const { observeTelemetry, attemptTelemetry, telemetryReport, phaseHistory, settingSources, telemetryArchivePath } = await import('../scripts/linear_telemetry.mjs');
const { writeClaim } = await import('../scripts/linear_agent.mjs');

test('Codex telemetry reconciles repeated terminal snapshots, counts turns and preserves missing versus zero', async () => temporary(async state => {
  const r = await beginAttempt(state, claim, { launchMode: 'start', model: 'requested', effort: 'high', prompt: 'SECRET', childExited: true, code: 0 });
  observeTelemetry(r, { type: 'turn.started' });
  const end = { type: 'turn.completed', usage: { input_tokens: 5, cached_input_tokens: 0, output_tokens: 2 } };
  observeTelemetry(r, end); observeTelemetry(r, end);
  observeTelemetry(r, { type: 'turn.started' }); observeTelemetry(r, end);
  observeTelemetry(r, { type: 'item.completed', item: { text: 'SECRET', usage: { input_tokens: 9999 } } });
  let report = attemptTelemetry(r);
  assert.equal(report.usage.inputTokens.value, 10);
  assert.equal(report.usage.cachedInputTokens.value, 0);
  assert.equal(report.usage.costUsd.value, null);
  assert.equal(report.observed.models.kind, 'unavailable');
  assert.equal(report.requested.model, 'requested');
  assert.equal(report.observed.effort.kind, 'unavailable');
  assert.ok(!JSON.stringify(report).includes('SECRET'));
  r.cancelled = 'owner-closed'; report = attemptTelemetry(r);
  assert.equal(report.usage.inputTokens.value, 10);
  assert.equal(report.usage.inputTokens.complete, false);
}));

test('Claude final invocation usage supersedes message snapshots and zero cost is measured', async () => temporary(async state => {
  const r = await beginAttempt(state, { ...claim, runtime: 'claude' }, { model: 'requested', childExited: true, code: 0 });
  const message = { type: 'assistant', message: { id: 'msg-1', model: 'actually-used', usage: { input_tokens: 3, output_tokens: 1 }, content: 'SECRET' } };
  observeTelemetry(r, message); observeTelemetry(r, message);
  let report = attemptTelemetry(r);
  assert.equal(report.usage.inputTokens.value, 3);
  assert.equal(report.usage.inputTokens.complete, false);
  assert.deepEqual(report.observed.models.value, ['actually-used']);
  observeTelemetry(r, { type: 'result', total_cost_usd: 0, usage: { input_tokens: 7, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 2 } });
  report = attemptTelemetry(r);
  assert.equal(report.usage.inputTokens.value, 7);
  assert.equal(report.reportedCost.value, 0);
  assert.equal(report.reportedCost.kind, 'estimated');
  observeTelemetry(r, { type: 'result', total_cost_usd: -1, usage: { input_tokens: '7', output_tokens: Infinity } });
  report = attemptTelemetry(r);
  assert.equal(report.usage.costUsd.value, null);
  assert.equal(report.usage.inputTokens.value, null);
}));

test('setting provenance follows each runtime and records recovery without claiming effective settings', () => {
  const env = { JAUNT_CODEX_MODEL: 'a', JAUNT_CLAUDE_EFFORT: 'high' };
  assert.equal(settingSources('codex', null, {}, env).model, 'runtime environment');
  assert.equal(settingSources('claude', null, {}, env).model, 'runtime default (not observed)');
  assert.equal(settingSources('codex', { model: 'b' }, { model: 'c' }, env).model, 'explicit option');
  assert.equal(settingSources('codex', { model: 'b' }, {}, env).model, 'saved setting');
  assert.equal(settingSources('codex', { model: null }, {}, env, 'recovery').model, 'recovery');
  assert.equal(settingSources('codex', null, { rationale: 'chosen for review' }, env).rationale, 'chosen for review');
});

test('phase history is atomic with claims, survives repeated registration and marks legacy gaps', async () => temporary(async state => {
  const first = { ...claim, phase: 'planning', updatedAt: old };
  await writeClaim(first, { stateDir: state });
  await writeClaim({ ...first, updatedAt: new Date().toISOString(), session: 'real-session' }, { stateDir: state });
  const saved = await readJson(join(state, 'claims', `${claim.issue}.json`));
  assert.equal(saved.telemetryHistory.transitions.length, 1);
  assert.equal(saved.telemetryHistory.complete, true);
  const legacy = phaseHistory({ ...first, phase: 'implementing' }, { ...first, telemetryHistory: undefined });
  assert.equal(legacy.complete, false);
  assert.deepEqual(legacy.transitions.map(p => p.phase), ['planning', 'implementing']);
}));

test('report survives release, multi-phase work, late attempt finalization and reopening without double counting', async () => temporary(async state => {
  const start = '2026-09-22T00:00:00.000Z', middle = '2026-09-22T00:01:00.000Z', end = '2026-09-22T00:02:00.000Z';
  const c = { ...claim, claimedAt: start, updatedAt: start, phase: 'planning' };
  await writeClaim(c, { stateDir: state });
  const r = await beginAttempt(state, c, { launchMode: 'start', model: 'm' });
  r.startedAt = start;
  await writeClaim({ ...c, phase: 'implementing', updatedAt: middle }, { stateDir: state });
  const store = closureStore({ stateDir: state, readIssue: async () => ({ identifier: c.issue, state: { type: 'completed', name: 'Done' } }) });
  await store.save(c.issue, { items: [] });
  await store.release(c.issue);
  observeTelemetry(r, { type: 'turn.completed', usage: { input_tokens: 11, output_tokens: 2 } });
  await saveAttempt(state, { ...r, endedAt: end, childExited: true, code: 0 });
  // A read must enumerate the attempt, never count pointer/schedule duplicates.
  let result = await telemetryReport(state, c.issue, end);
  assert.equal(result.counts.attempts, 1);
  assert.equal(result.generations[0].release.state, 'completed');
  assert.equal(result.generations[0].phases.length, 2);
  assert.ok(result.generations[0].phases.every(p => p.attempts.includes(r.attempt)));
  assert.equal(result.generations[0].attempts[0].phaseAllocation.kind, 'unavailable');
  assert.equal(result.knownUsageSubtotal.inputTokens.value, 11);
  assert.equal(result.knownUsageSubtotal.costUsd.value, null);
  const newer = { ...c, claimedAt: end, updatedAt: end }; delete newer.telemetryHistory;
  await writeClaim(newer, { stateDir: state });
  const resumed = await beginAttempt(state, newer, { launchMode: 'recovery', resume: true });
  await saveAttempt(state, { ...resumed, endedAt: end, code: 1, failure: { kind: 'quota' } });
  result = await telemetryReport(state, c.issue);
  assert.equal(result.generations.length, 2);
  assert.equal(result.counts.recoveries, 1);
  assert.equal(result.counts.attempts, 2);
  assert.equal(result.knownUsageSubtotal.inputTokens.value, 11);
  assert.equal(result.knownUsageSubtotal.inputTokens.complete, false);
  assert.equal(result.generations[0].active, false);
  assert.equal(result.generations[1].active, true);
}));

test('release refuses an unwritable archive and report fails on corruption instead of inventing zero', async () => temporary(async state => {
  const c = { ...claim, phase: 'planning', updatedAt: old };
  await writeClaim(c, { stateDir: state });
  const store = closureStore({ stateDir: state, readIssue: async () => ({ identifier: c.issue, state: { type: 'backlog', name: 'Backlog' } }) });
  const archive = telemetryArchivePath(state, c);
  await mkdir(archive, { recursive: true }); // rename cannot replace a directory
  await assert.rejects(store.release(c.issue, 'unstarted'), /EISDIR/);
  assert.ok(await readJson(join(state, 'claims', `${c.issue}.json`)));
  await rm(archive, { recursive: true });
  await writeFile(archive, '{bad json');
  await assert.rejects(telemetryReport(state, c.issue), SyntaxError);
  await assert.rejects(telemetryReport(state, '../escape'), /identifier/);
}));

test('usage is allocated only when the complete attempt interval fits one observed phase', async () => temporary(async state => {
  const start = '2026-09-22T00:00:00.000Z', end = '2026-09-22T00:02:00.000Z';
  const c = { ...claim, claimedAt: start, updatedAt: start, phase: 'implementing' };
  await writeClaim(c, { stateDir: state });
  const r = await beginAttempt(state, c, { launchMode: 'resume' });
  r.startedAt = '2026-09-22T00:00:01.000Z';
  observeTelemetry(r, { type: 'turn.started' });
  observeTelemetry(r, { type: 'turn.completed', usage: { input_tokens: 2, output_tokens: 1 } });
  await saveAttempt(state, { ...r, endedAt: '2026-09-22T00:01:00.000Z', childExited: true, code: 0 });
  const report = await telemetryReport(state, c.issue, end);
  assert.equal(report.counts.resumes, 1);
  const phase = report.generations[0].phases[0];
  assert.equal(report.generations[0].attempts[0].phaseAllocation.phase, 'implementing');
  assert.equal(phase.knownUsageSubtotal.inputTokens.value, 2);
  assert.deepEqual(phase.unallocatedAttempts, []);
}));

test('Claude resumed session estimates are differenced, older invocation estimates are summed, unknown scope stays unavailable', async () => {
  for (const [version, expected] of [['2.1.278', 12], ['2.1.276', 22], [null, 10]]) await temporary(async state => {
    for (let i = 0; i < 2; i++) {
      const r = await beginAttempt(state, { ...claim, runtime: 'claude' }, { launchMode: i ? 'resume' : 'start', resume: Boolean(i) });
      r.startedAt = `2026-09-22T00:0${i * 2}:00Z`;
      if (version) observeTelemetry(r, { type: 'system', subtype: 'init', claude_code_version: version });
      observeTelemetry(r, { type: 'result', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: i ? 12 : 10 });
      await saveAttempt(state, { ...r, code: 0, childExited: true, endedAt: `2026-09-22T00:0${i * 2 + 1}:00Z` });
    }
    const report = await telemetryReport(state, claim.issue);
    assert.equal(report.knownUsageSubtotal.costUsd.value, expected);
    assert.equal(report.knownUsageSubtotal.costUsd.kind, 'estimated');
    assert.equal(report.knownUsageSubtotal.costUsd.complete, Boolean(version));
    assert.equal(report.generations[0].attempts[1].reportedCost.value, 12);
  });
});

test('Claude crash zeros do not erase partial input; output placeholders and subagent tokens are excluded', async () => temporary(async state => {
  const r = await beginAttempt(state, { ...claim, runtime: 'claude' }, { launchMode: 'start' });
  observeTelemetry(r, { type: 'assistant', message: { id: 'msg-1', usage: { input_tokens: 5, output_tokens: 999 } } });
  observeTelemetry(r, { type: 'assistant', parent_tool_use_id: 'tool-1', message: { id: 'msg-child', usage: { input_tokens: 200 } } });
  observeTelemetry(r, { type: 'result', subtype: 'error_during_execution', usage: { input_tokens: 0, output_tokens: 0 }, total_cost_usd: 0 });
  await saveAttempt(state, { ...r, childExited: true, code: 1 });
  const report = await telemetryReport(state, claim.issue);
  assert.equal(report.knownUsageSubtotal.inputTokens.value, 5);
  assert.equal(report.knownUsageSubtotal.outputTokens.value, null);
  assert.equal(report.knownUsageSubtotal.costUsd.value, null);
  assert.equal(report.knownUsageSubtotal.inputTokens.complete, false);
}));

test('Claude session cost without a normal consecutive baseline is not attributed to a resumed attempt', async () => {
  for (const problem of ['missing', 'failed', 'decreasing', 'overlap']) await temporary(async state => {
    if (problem !== 'missing') {
      const first = await beginAttempt(state, { ...claim, runtime: 'claude' }, { launchMode: 'start' });
      first.startedAt = '2026-09-22T00:00:00Z';
      observeTelemetry(first, { type: 'system', subtype: 'init', claude_code_version: '2.1.278' });
      observeTelemetry(first, { type: 'result', usage: { input_tokens: 2 }, total_cost_usd: 10 });
      await saveAttempt(state, { ...first, childExited: true, code: problem === 'failed' ? 1 : 0, endedAt: '2026-09-22T00:02:00Z' });
    }
    const second = await beginAttempt(state, { ...claim, runtime: 'claude' }, { launchMode: 'recovery', resume: true });
    second.startedAt = problem === 'overlap' ? '2026-09-22T00:01:00Z' : '2026-09-22T00:03:00Z';
    observeTelemetry(second, { type: 'system', subtype: 'init', claude_code_version: '2.1.278' });
    observeTelemetry(second, { type: 'result', usage: { input_tokens: 2 }, total_cost_usd: problem === 'decreasing' ? 9 : 12 });
    await saveAttempt(state, { ...second, childExited: true, code: 0 });
    const report = await telemetryReport(state, claim.issue);
    const last = report.generations[0].attempts.at(-1);
    assert.equal(last.usage.costUsd.kind, 'unavailable', problem);
    assert.equal(last.reportedCost.kind, 'estimated');
  });
});

test('legacy transition phases sharing a timestamp do not double-allocate usage', async () => temporary(async state => {
  const at = '2026-09-22T00:00:00.000Z';
  const c = { ...claim, phase: 'planning', updatedAt: at };
  await atomicJson(join(state, 'claims', `${c.issue}.json`), c);
  await writeClaim({ ...c, phase: 'implementing' }, { stateDir: state });
  const r = await beginAttempt(state, { ...c, phase: 'implementing' }, { launchMode: 'start' });
  r.startedAt = '2026-09-22T00:00:01.000Z';
  observeTelemetry(r, { type: 'turn.started' });
  observeTelemetry(r, { type: 'turn.completed', usage: { input_tokens: 4, output_tokens: 2 } });
  await saveAttempt(state, { ...r, childExited: true, code: 0, endedAt: '2026-09-22T00:01:00.000Z' });
  const report = await telemetryReport(state, c.issue, '2026-09-22T00:02:00.000Z');
  const phases = report.generations[0].phases;
  assert.equal(phases[0].at, phases[1].at);
  assert.equal(phases[0].knownUsageSubtotal.inputTokens.value, null);
  assert.equal(phases[1].knownUsageSubtotal.inputTokens.value, 4);
}));
