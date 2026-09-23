import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claimIdentity } from '../scripts/linear_agent.mjs';
import { parseArgs, workerArgs, workerEnvironment, workerSettings, claudeArgs, supervise, notify } from '../scripts/linear_codex.mjs';

const pause = ms => new Promise(r => setTimeout(r, ms));

test('legacy Claude claims retain their identity and cannot become Codex transcripts', () => {
  assert.deepEqual(claimIdentity({ session: 'old' }, '', undefined), { runtime: 'claude', session: 'old' });
  assert.throws(() => claimIdentity({ session: 'old' }, 'new', 'codex'), /another runtime/);
  assert.throws(() => claimIdentity(null, null, 'typo'), /unknown runtime/);
  const codex = { session: 'thread', runtime: 'codex' };
  assert.deepEqual(claimIdentity(codex, '', undefined), codex);
  assert.throws(() => claimIdentity(codex, 'new', 'claude'), /another runtime/);
  assert.deepEqual(claimIdentity(null, undefined, 'codex'), { session: null, runtime: 'codex' });
});

test('a claimed runtime cannot change before a session is recorded', () => {
  for (const existing of [{ session: null }, { runtime: 'claude', session: null }]) {
    assert.throws(() => claimIdentity(existing, 'thread', 'codex'), /another runtime/);
    assert.deepEqual(claimIdentity(existing, undefined, undefined), { runtime: 'claude', session: null });
  }
  assert.throws(() => claimIdentity({ runtime: 'codex', session: null }, 'claude-id', 'claude'), /another runtime/);
  assert.deepEqual(claimIdentity({ runtime: 'codex', session: null }, 'actual-thread', 'codex'), { runtime: 'codex', session: 'actual-thread' });
});

test('worker resume keeps the exact thread, selected model, effort and prompt as data', () => {
  const command = workerArgs({ session: 'exact-id', model: 'chosen-model', effort: 'high', prompt: 'literal $(touch nope) `nope`', root: '/a path' });
  assert.deepEqual(command.args.slice(0, 3), ['exec', 'resume', 'exact-id']);
  assert.ok(!command.args.includes('--last'));
  assert.ok(!command.args.includes('--ephemeral'));
  assert.equal(command.args[command.args.indexOf('--model') + 1], 'chosen-model');
  assert.ok(command.args.includes('model_reasoning_effort="high"'));
  assert.ok(command.args.includes('sandbox_mode="danger-full-access"'));
  assert.ok(workerArgs({prompt:'restricted',sandbox:'workspace-write'}).args.includes('sandbox_mode="workspace-write"'));
  assert.throws(() => workerArgs({prompt:'bad',sandbox:'typo'}), /unknown sandbox/);
  assert.match(command.prompt, /literal \$\(touch nope\) `nope`/);
  assert.match(command.prompt, /\/a path\/\.agents\/skills\/linear-worker\/SKILL.md/);
  assert.ok(!workerArgs({ prompt: 'new' }).args.includes('--model'), 'default stays user-configured');
});

test('worker environment drops inherited identities but retains Codex installation/auth location', () => {
  const env = workerEnvironment({ PATH: '/bin', CODEX_HOME: '/custom', CODEX_THREAD_ID: 'parent', CODEX_SESSION_ID: 'parent', CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'parent', KEEP: 'yes' }, '/canonical');
  assert.deepEqual(env, { PATH: '/bin', CODEX_HOME: '/custom', KEEP: 'yes', JAUNT_LINEAR_ROOT: '/canonical' });
});

test('CLI parser rejects missing and unknown options without swallowing an identifier', () => {
  assert.deepEqual(parseArgs(['worker', 'JAU-3', '--cwd', '/a path']), { positional: ['worker', 'JAU-3'], options: { cwd: '/a path' } });
  assert.throws(() => parseArgs(['arm', '--thread']), /requires a value/);
  assert.throws(() => parseArgs(['arm', '--thread', '--cwd', '/tmp']), /requires a value/);
  assert.throws(() => parseArgs(['arm', '--typo', 'x']), /unknown option/);
});

test('supervisor drains split JSONL including a final line before worker completion', async () => {
  const lines = [];
  const child = spawn(process.execPath, ['-e', 'process.stdout.write(\'{"type":"thread.\'); setTimeout(()=>process.stdout.write(\'started","thread_id":"actual"}\\n{"type":"turn.completed"}\'),20)']);
  const result = await supervise(child, { alive: () => true, onLine: async line => { await pause(10); lines.push(JSON.parse(line)); }, interval: 10 });
  assert.equal(result.code, 0);
  assert.equal(result.cancelled, null);
  assert.equal(lines[0].thread_id, 'actual');
  assert.equal(lines[1].type, 'turn.completed');
});

test('closing the owner terminates the watcher, without waiting for the polling interval', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},10000)']);
  const result = await supervise(child, { alive: () => false, interval: 10 });
  assert.equal(result.cancelled, 'owner-closed');
  assert.equal(child.signalCode, 'SIGTERM');
});

test('loop-off terminates polling and malformed state does not keep it alive', async () => {
  for (const [enabled, expected] of [[async () => false, 'loop-off'], [async () => { throw Error('invalid JSON'); }, 'state-unreadable']]) {
    const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},10000)']);
    const result = await supervise(child, { alive: () => true, enabled, interval: 10 });
    assert.equal(result.cancelled, expected);
  }
});

test('worker with no loop guard finishes after loop-off and persists its transcript event', async () => {
  const child = spawn(process.execPath, ['-e', 'setTimeout(()=>console.log("finished"),30)']);
  const lines = [];
  const result = await supervise(child, { alive: () => true, onLine: line => lines.push(line), interval: 10 });
  assert.equal(result.code, 0);
  assert.deepEqual(lines, ['finished']);
});

test('spawn failure is surfaced instead of hanging supervision', async () => {
  const child = spawn('/no/such/jaunt-test-program');
  await assert.rejects(supervise(child, { alive: () => true, interval: 10 }), /ENOENT/);
});

test('failed persistence stops a worker rather than losing its resumable identity silently', async () => {
  const child = spawn(process.execPath, ['-e', 'console.log("thread"); setInterval(()=>{},10000)']);
  await assert.rejects(supervise(child, { alive: () => true, onLine: () => { throw Error('disk full'); }, interval: 10 }), /disk full/);
  assert.equal(child.signalCode, 'SIGTERM');
});

test('wake-up is durable before queue delivery and targets only its owner', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jaunt-codex-'));
  const path = join(dir, 'event.json');
  try {
    let calls = 0;
    await notify({ thread: 'owner-thread' }, { wake: 'board-changed', events: [{ ticket: 'JAU-1' }] }, path, {
      alive: () => true,
      deliver: async (cmd, args) => {
        calls++;
        assert.equal(JSON.parse(await readFile(path)).delivered, false);
        assert.equal(cmd, 'codex');
        assert.deepEqual(args.slice(0, 3), ['queue', '--thread', 'owner-thread']);
        assert.ok(args.at(-1).includes(path));
        // Instructions are re-read only when their fingerprint changed (JAU-62).
        assert.match(args.at(-1), /skills-read --if-stale/);
        assert.match(args.at(-1), /preserve the current owner and workers/);
      },
    });
    assert.equal(calls, 1);
    assert.equal(JSON.parse(await readFile(path)).delivered, true);
    // An outbox batch names itself: a replayed message is answered by
    // `wake take` before any instruction or board read, not by a mutable file.
    await notify({ thread: 'owner-thread' }, { wake: 'board-changed', wakeId: 'batch-1', events: [] }, path, {
      alive: () => true,
      deliver: async (cmd, args) => {
        calls++;
        assert.match(args.at(-1), /jaunt-linear wake take --id batch-1/);
        assert.match(args.at(-1), /alreadyHandled, stop now/);
      },
    });
    assert.equal(calls, 2);
  } finally { await rm(dir, { recursive: true }); }
});

test('queue refusal and absent owner preserve an undelivered wake without model fallback', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jaunt-codex-'));
  const path = join(dir, 'event.json');
  try {
    await assert.rejects(notify({}, { wake: 'watcher-lost' }, path, { alive: () => true, deliver: async () => { throw Error('queue refused'); } }), /queue refused/);
    assert.equal(JSON.parse(await readFile(path)).error, 'queue refused');
    await notify({}, { wake: 'board-changed' }, path, { alive: () => false, deliver: () => { assert.fail('closed owners must never be woken'); } });
    assert.equal(JSON.parse(await readFile(path)).delivered, false);
  } finally { await rm(dir, { recursive: true }); }
});

test('CLI adapter arms once, records a real worker ID, resumes it and stops polling (offline)', { timeout: 20000 }, async () => {
  const { copyFile, mkdir, writeFile, chmod } = await import('node:fs/promises');
  const { promisify } = await import('node:util');
  const { execFile } = await import('node:child_process');
  const exec = promisify(execFile);
  const dir = await mkdtemp(join(tmpdir(), 'jaunt-codex-cli-'));
  try {
    await mkdir(join(dir, 'scripts'));
    await mkdir(join(dir, 'bin'));
    await mkdir(join(dir, '.dev-state'));
    for (const name of ['linear_routing.mjs', 'linear_skills.mjs', 'linear_codex.mjs', 'linear_workers.mjs', 'linear_telemetry.mjs', 'linear_wakes.mjs', 'linear_models.mjs', 'linear_model_policy.json']) await copyFile(new URL('../scripts/' + name, import.meta.url), join(dir, 'scripts', name));
    await copyFile(process.execPath, join(dir, 'bin/codex-fixture'));
    await writeFile(join(dir, '.dev-state/linear-loop.json'), '{"enabled":true}');
    await writeFile(join(dir, 'scripts/linear_agent.mjs'), `
      import { readFileSync, realpathSync } from 'node:fs';
      export const entryPath = p => realpathSync(p);
      const cmd=process.argv[2];
      if(cmd==='claims') console.log(JSON.stringify([{issue:'JAU-999',runtime:'codex',session:null,claimedAt:'2026-09-21T00:00:00Z',phase:'planning'}]));
      if(cmd==='watcher') {
        const health = role => { try { const r=JSON.parse(readFileSync('.dev-state/'+role+'.json')); process.kill(r.pid,0); return {alive:!r.endedAt}; } catch { return {alive:false}; } };
        const watcher=health('watcher'),watchdog=health('watchdog');
        const enabled=JSON.parse(readFileSync('.dev-state/linear-loop.json')).enabled;
        console.log(JSON.stringify({enabled,watcher,watchdog,stalled:enabled&&!watcher.alive,unguarded:enabled&&!watchdog.alive}));
      }
    `);
    await writeFile(join(dir, 'scripts/linear_watch.mjs'), `
      import { writeFileSync } from 'node:fs';
      import { pathToFileURL } from 'node:url';
      export const livePid = p => { if(!Number.isInteger(p))return false; try {process.kill(p,0);return true;}catch{return false;} };
      if(import.meta.url===pathToFileURL(process.argv[1]).href) {
        const role=process.argv.includes('--watchdog')?'watchdog':'watcher';
        writeFileSync('.dev-state/'+role+'.json',JSON.stringify({pid:process.pid}));
        setInterval(()=>{},100);
      }
    `);
    await writeFile(join(dir, 'bin/codex'), `#!/usr/bin/env node
      const fs=require('node:fs');
      const args=process.argv.slice(2);
      if(args[0]==='queue') {
        if(!args.includes('--help'))fs.appendFileSync(process.env.FIXTURE_ROOT+'/queued.jsonl',JSON.stringify(args)+'\\n');
      } else {
        fs.appendFileSync(process.env.FIXTURE_ROOT+'/exec.jsonl',JSON.stringify(args)+'\\n');
        console.log(JSON.stringify({type:'thread.started',thread_id:'recorded-thread-id'}));
        process.stdin.resume();
        process.stdin.on('end',()=>console.log(JSON.stringify({type:'turn.completed'})));
      }
    `);
    await chmod(join(dir, 'bin/codex'), 0o755);
    await exec('git', ['init', '-q'], { cwd: dir });
    await exec('git', ['checkout', '-q', '-b', 'agent/JAU-999'], { cwd: dir });
    await writeFile(join(dir, 'owner.mjs'), `
      import { execFile } from 'node:child_process';
      import { promisify } from 'node:util';
      import { readFile,writeFile } from 'node:fs/promises';
      import assert from 'node:assert/strict';
      const exec=promisify(execFile),pause=ms=>new Promise(r=>setTimeout(r,ms));
      const call=async(...a)=>JSON.parse((await exec(process.env.REAL_NODE,['scripts/linear_codex.mjs',...a])).stdout);
      const read=async name=>JSON.parse(await readFile('.dev-state/codex/'+name+'.json'));
      const until=async fn=>{for(let n=0;n<150;n++){try{if(await fn())return;}catch{}await pause(40);}throw Error('fixture timed out');};
      const first=await call('arm');
      const second=await call('arm');
      assert.deepEqual(first.adapter.map(x=>x.pid),second.adapter.map(x=>x.pid));
      await call('worker','JAU-999','--cwd',process.cwd(),'--model','fixture-model','--effort','high');
      // The fixture watcher writes no shared pulse, so the adapter queues the
      // outbox batch itself; the message names the batch, and the owner's pass
      // takes it. A replay of the same message is answered, not reprocessed.
      await until(async()=>JSON.parse(await readFile((await read('JAU-999')).eventPath)).delivered);
      const event=JSON.parse(await readFile((await read('JAU-999')).eventPath));
      assert.equal(event.wake,'worker-finished');
      assert.match(JSON.parse((await readFile('queued.jsonl','utf8')).trim().split('\\n').at(-1)).at(-1),new RegExp('wake take --id '+event.wakeId));
      const {wakeStore}=await import('./scripts/linear_wakes.mjs');
      assert.equal((await wakeStore(process.cwd()+'/.dev-state').take(event.wakeId)).alreadyHandled,false);
      assert.equal((await wakeStore(process.cwd()+'/.dev-state').take(event.wakeId)).alreadyHandled,true);
      assert.equal((await read('JAU-999')).session,'recorded-thread-id');
      await call('resume','JAU-999','--message','literal $(not a shell command)');
      await until(async()=>JSON.parse((await readFile('exec.jsonl','utf8')).trim().split('\\n').at(-1))[1]==='resume' && (await read('JAU-999')).endedAt);
      const commands=(await readFile('exec.jsonl','utf8')).trim().split('\\n').map(JSON.parse);
      assert.deepEqual(commands[1].slice(0,3),['exec','resume','recorded-thread-id']);
      assert.equal(commands[1][commands[1].indexOf('--model')+1],'fixture-model');
      await writeFile('.dev-state/linear-loop.json','{"enabled":false}');
      await until(async()=>(await read('watcher')).endedAt && (await read('watchdog')).endedAt);
      assert.equal((await read('watcher')).cancelled,'loop-off');
      console.log('offline adapter lifecycle passed');
    `);
    const result = await exec(join(dir, 'bin/codex-fixture'), ['owner.mjs'], {
      cwd: dir, timeout: 15000,
      env: { ...process.env, CODEX_THREAD_ID: 'fixture-owner', REAL_NODE: process.execPath, FIXTURE_ROOT: dir, PATH: `${join(dir, 'bin')}:${process.env.PATH}` },
    });
    assert.match(result.stdout, /offline adapter lifecycle passed/);
  } finally {
    // The owner is gone even on failure; give its guards time to reap children.
    await pause(1200);
    await rm(dir, { recursive: true, force: true });
  }
});


test('runtime settings never leak Codex model defaults into Claude and recovery preserves explicit nulls', () => {
  const env = { JAUNT_CODEX_MODEL: 'codex-model', JAUNT_CODEX_EFFORT: 'high', JAUNT_CODEX_SANDBOX: 'read-only' };
  assert.deepEqual(workerSettings('claude', null, {}, env), { model: 'claude-opus-5-5', effort: 'medium', sandbox: 'danger-full-access' });
  const saved = { model: null, effort: null, sandbox: 'workspace-write' };
  assert.deepEqual(workerSettings('codex', saved, {}, env, true), saved);
  assert.equal(workerSettings('codex', null, {}, env).model, 'codex-model');
  assert.throws(() => workerSettings('claude', null, { sandbox: 'read-only' }, env), /does not implement/);
  assert.ok(claudeArgs({ session: 'exact', resume: true, model: 'claude-opus-5-5', effort: 'high', prompt: 'continue' }).args.includes('--effort'));
  assert.throws(() => claudeArgs({ session: 'exact', effort: 'high', prompt: 'continue' }), /explicit model and effort/);
});

for (const targetRuntime of ['codex', 'claude']) test(`automatic routing launches exact ${targetRuntime} session through real adapter locks (offline)`, { timeout: 25000 }, async () => {
  const { copyFile, mkdir, writeFile, chmod } = await import('node:fs/promises');
  const { promisify } = await import('node:util');
  const { execFile } = await import('node:child_process');
  const exec = promisify(execFile), dir = await mkdtemp(join(tmpdir(), 'jaunt-route-cli-'));
  try {
    await mkdir(join(dir, 'scripts')); await mkdir(join(dir, 'bin')); await mkdir(join(dir, '.dev-state/claims'), { recursive: true });
    for (const name of ['linear_routing.mjs', 'linear_codex.mjs', 'linear_workers.mjs', 'linear_telemetry.mjs', 'linear_wakes.mjs', 'linear_waits.mjs', 'linear_skills.mjs', 'linear_models.mjs', 'linear_model_policy.json']) await copyFile(new URL('../scripts/' + name, import.meta.url), join(dir, 'scripts', name));
    await copyFile(process.execPath, join(dir, 'bin/codex-fixture'));
    for (const skill of ['linear-loop', 'linear-orchestrator']) {
      await mkdir(join(dir, '.agents/skills', skill), { recursive: true });
      await writeFile(join(dir, '.agents/skills', skill, 'SKILL.md'), 'fixture instructions');
    }
    await writeFile(join(dir, '.dev-state/linear-loop.json'), '{"enabled":true}');
    await writeFile(join(dir, 'verdict.txt'), 'approved');
    await writeFile(join(dir, '.dev-state/claims/JAU-999.json'), JSON.stringify({ issue: 'JAU-999',
      ...(targetRuntime === 'codex' ? { runtime: 'codex', session: null } : { session: 'exact-claude' }),
      claimedAt: '2026-09-21T00:00:00Z', phase: 'planning' }));
    await writeFile(join(dir, 'scripts/linear_watch.mjs'), `export const livePid=p=>{try{process.kill(p,0);return Boolean(p);}catch{return false;}};`);
    await writeFile(join(dir, 'scripts/linear_agent.mjs'), `
      import { readFileSync,realpathSync } from 'node:fs';
      import {workerReports} from './linear_workers.mjs';
      export const entryPath=p=>realpathSync(p);
      const cmd=process.argv[2],state=process.cwd()+'/.dev-state';
      if(cmd==='claims') console.log('['+readFileSync(state+'/claims/JAU-999.json')+']');
      if(cmd==='workers') console.log(JSON.stringify(await workerReports(state)));
      if(cmd==='stop-requested') console.log('{"stop":false}');
      if(cmd==='verdict') { if(process.argv[4]!=='--peek') throw Error('approval mutation forbidden'); console.log(JSON.stringify({verdict:readFileSync('verdict.txt','utf8').trim()})); }
      if(cmd==='routing-thread') console.log(JSON.stringify({ identifier:'JAU-999',agentId:'agent',state:{type:'started'},comments:[
        {id:'reply',body:'approved',createdAt:'2026-09-22T10:00:00Z',user:{id:'human',email:'human@example.invalid'}}
      ]}));
    `);
    await writeFile(join(dir, 'bin/gh'), '#!/bin/sh\nprintf \'[{"state":"OPEN"}]\'\n'); await chmod(join(dir, 'bin/gh'), 0o755);
    for (const runtime of ['codex', 'claude']) {
      await writeFile(join(dir, 'bin', runtime), `#!/usr/bin/env node
        const fs=require('node:fs'),a=process.argv.slice(2),dir=process.env.FIXTURE_ROOT;
        if(a[0]==='queue') {fs.appendFileSync(dir+'/queues.jsonl',JSON.stringify(a)+'\\n');process.exit(0);}
        fs.appendFileSync(dir+'/calls.jsonl',JSON.stringify({runtime:'${runtime}',args:a})+'\\n');
        console.log(JSON.stringify(${runtime === 'codex' ? "{type:'thread.started',thread_id:'exact-codex'}" : "{type:'system',session_id:'exact-claude'}"}));
        process.stdin.resume();process.stdin.on('end',()=>console.log(JSON.stringify({type:'turn.completed'})));
      `); await chmod(join(dir, 'bin', runtime), 0o755);
    }
    await exec('git', ['init', '-q'], { cwd: dir }); await exec('git', ['checkout', '-q', '-b', 'agent/JAU-999'], { cwd: dir });
    await writeFile(join(dir, 'owner.mjs'), `
      import {execFile} from 'node:child_process';import {promisify} from 'node:util';import assert from 'node:assert/strict';
      import {readFile,writeFile} from 'node:fs/promises';import {skillStore} from './scripts/linear_skills.mjs';import {wakeStore} from './scripts/linear_wakes.mjs';
      const exec=promisify(execFile),pause=ms=>new Promise(r=>setTimeout(r,ms));
      const call=async(...a)=>JSON.parse((await exec(process.env.REAL_NODE,['scripts/linear_codex.mjs',...a])).stdout);
      const read=async p=>JSON.parse(await readFile(p));
      const path='.dev-state/${targetRuntime}/JAU-999.json';
      const until=async fn=>{for(let n=0;n<200;n++){try{if(await fn())return;}catch{}await pause(30);}throw Error('fixture timed out');};
      const skills=skillStore(process.cwd());await skills.bind('codex','fixture-owner');
      const snapshot=await skills.read('codex','fixture-owner');await skills.acknowledge('codex','fixture-owner',snapshot.fingerprint);
      await call('worker','JAU-999','--runtime','${targetRuntime}','--cwd',process.cwd());
      await until(async()=>Boolean((await read(path)).endedAt && (await read((await read(path)).eventPath)).delivered));
      // No watcher runs here, so the adapter queued the outbox batch itself;
      // the owner's pass takes it before the next one can leave.
      await wakeStore(process.cwd()+'/.dev-state').take();
      const original=await read(path),claim=await read('.dev-state/claims/JAU-999.json');
      claim.session=original.session;claim.phase='awaiting-approval';await writeFile('.dev-state/claims/JAU-999.json',JSON.stringify(claim));
      process.env.JAUNT_LINEAR_ROUTING_OWNER=JSON.stringify(original.owner);
      const e=JSON.stringify({wake:'board-changed',events:[{type:'comment',ticket:'JAU-999'}]});
      if('${targetRuntime}'==='claude'){
        // An approved Claude plan is implemented by a fresh session (JAU-37): the router hands it to the orchestrator.
        const held=await call('route','--event',e);assert.match(held.outcomes[0].reason,/plan approved; start the implementation session/);
        assert.equal((await readFile('calls.jsonl','utf8')).trim().split('\\n').length,1);
        await writeFile('verdict.txt','feedback');
      }
      const routed=await call('route','--event',e);assert.equal(routed.event,null);assert.equal(routed.outcomes[0].outcome,'handled');
      await until(async()=>(await read(path)).attempt!==original.attempt && (await read(path)).endedAt && (await read((await read(path)).eventPath)).delivered);
      const again=await call('route','--event',e);assert.equal(again.event,null);
      const calls=(await readFile('calls.jsonl','utf8')).trim().split('\\n').map(JSON.parse);assert.equal(calls.length,2);
      assert.equal(calls[1].runtime,'${targetRuntime}');
      assert.ok(calls[1].args.includes('${targetRuntime === 'codex' ? 'exact-codex' : 'exact-claude'}'));
      assert.ok(calls[1].args.includes('${targetRuntime === 'codex' ? 'resume' : '--resume'}'));
      const queues=(await readFile('queues.jsonl','utf8')).trim().split('\\n').map(JSON.parse);
      assert.equal(queues.length,2,'only the two worker completions wake the owner, never the routed comment');
      delete process.env.JAUNT_LINEAR_ROUTING_OWNER;
      assert.ok((await call('route','--event',e)).event.routingError);
      assert.equal((await readFile('calls.jsonl','utf8')).trim().split('\\n').length,2);
      console.log('offline direct routing passed');
    `);
    const result = await exec(join(dir, 'bin/codex-fixture'), ['owner.mjs'], { cwd: dir, timeout: 20000,
      env: { ...process.env, CODEX_THREAD_ID: 'fixture-owner', REAL_NODE: process.execPath, FIXTURE_ROOT: dir, PATH: `${join(dir, 'bin')}:${process.env.PATH}` } });
    assert.match(result.stdout, /offline direct routing passed/);
  } finally { await pause(1200); await rm(dir, { recursive: true, force: true }); }
});
