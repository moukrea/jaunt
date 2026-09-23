import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, copyFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadPolicy, validatePolicy, bannedModel, claudeSettings, claudeEnvironment, observedBanned, checkSetup } from '../scripts/linear_models.mjs';
import { workerSettings, claudeArgs } from '../scripts/linear_codex.mjs';
import { atomicJson } from '../scripts/linear_workers.mjs';
const exec = promisify(execFile);
const policy = loadPolicy();
const clone = () => JSON.parse(JSON.stringify(policy));

test('the shipped policy pins Opus 5.5, bans Opus 5 and Fable 5.1, and keeps Sonnet out of automatic choices', () => {
  const pairs = [policy.claude.default, policy.claude.subagent, ...Object.values(policy.claude.roles), ...Object.values(policy.claude.categories)];
  assert.ok(pairs.every(p => p.model === 'claude-opus-5-5'));
  assert.equal(policy.claude.default.effort, 'medium');
  for (const banned of ['claude-opus-5', 'claude-fable-5-1', 'fable', 'Claude-Opus-5[1m]', 'claude-opus-5-20260101', 'us.anthropic.claude-opus-5-v1:0', 'claude-fable-5-1-20260801'])
    assert.ok(bannedModel(banned, policy), banned);
  for (const allowed of ['claude-opus-5-5', 'claude-opus-5-5[1m]', 'claude-sonnet-5', 'claude-haiku-4-5-20251001', 'claude-fable-5-2'])
    assert.equal(bannedModel(allowed, policy), null, allowed);
});

test('a policy edit that reintroduces a banned model, an alias, max or a missing category is refused', () => {
  const edit = (fn, re) => { const p = clone(); fn(p.claude); assert.throws(() => validatePolicy(p), re); };
  edit(c => { c.categories.D.model = 'claude-fable-5-1'; }, /banned/);
  edit(c => { c.default.model = 'opus'; }, /not pinned/);
  edit(c => { c.subagent.model = 'claude-opus-5'; }, /banned/);
  edit(c => { c.roles.classifier.effort = 'max'; }, /effort must be/);
  edit(c => { delete c.categories.B; }, /exactly A, B, C, D/);
  edit(c => { c.banned.push('Claude-Opus-5'); }, /lowercase/);
  const swapped = clone(); swapped.claude.categories.A = { model: 'claude-sonnet-5', effort: 'low' };
  assert.doesNotThrow(() => validatePolicy(swapped), 'readjusting is a one-line edit');
});

test('every launch source is checked: option, saved record, environment, recovery and routed resume', () => {
  assert.deepEqual(claudeSettings({}), { model: 'claude-opus-5-5', effort: 'medium' });
  const env = { JAUNT_CLAUDE_MODEL: 'claude-fable-5-1' };
  assert.throws(() => workerSettings('claude', null, {}, env), /banned/);
  assert.throws(() => workerSettings('claude', null, { model: 'claude-opus-5' }, {}), /banned/);
  assert.throws(() => workerSettings('claude', { model: 'claude-opus-5' }, {}, {}), /banned/);
  assert.throws(() => workerSettings('claude', { model: 'claude-fable-5-1', effort: 'high' }, {}, {}, true), /banned/);
  assert.throws(() => workerSettings('claude', null, { model: 'opus' }, {}), /not pinned/);
  assert.throws(() => workerSettings('claude', null, { effort: 'ultra' }, {}), /invalid effort/);
  assert.deepEqual(workerSettings('claude', { model: null, effort: null }, {}, {}, true), { model: 'claude-opus-5-5', effort: 'medium', sandbox: 'danger-full-access' });
  assert.equal(workerSettings('claude', { model: 'claude-opus-5-5', effort: 'medium' }, {}, {}, true).effort, 'medium');
  assert.equal(workerSettings('claude', { model: 'claude-opus-5' }, { model: 'claude-opus-5-5' }, {}).model, 'claude-opus-5-5', 'a manual resume can replace a banned saved model');
  assert.throws(() => claudeArgs({ session: 's', model: 'claude-opus-5', effort: 'high', prompt: 'p' }), /banned/);
  assert.equal(workerSettings('codex', null, {}, env).model, null, 'Codex keeps its own configuration');
});

test('the worker environment pins subagents and refuses banned Anthropic overrides', () => {
  const env = claudeEnvironment({ PATH: '/bin', ANTHROPIC_MODEL: 'claude-opus-5', ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-5' });
  assert.equal(env.ANTHROPIC_MODEL, undefined);
  assert.equal(env.CLAUDE_CODE_SUBAGENT_MODEL, 'claude-opus-5-5');
  assert.equal(env.ANTHROPIC_DEFAULT_SONNET_MODEL, 'claude-sonnet-5');
  assert.throws(() => claudeEnvironment({ ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-5' }), /banned/);
  assert.throws(() => claudeEnvironment({ ANTHROPIC_SMALL_FAST_MODEL: 'claude-fable-5-1' }), /banned/);
});

test('a banned model seen in the stream is caught, subagents and result usage included', () => {
  assert.equal(observedBanned({ type: 'assistant', message: { model: 'claude-opus-5-5' } }), null);
  assert.equal(observedBanned({ type: 'assistant', parent_tool_use_id: 't', message: { model: 'claude-fable-5-1' } }), 'claude-fable-5-1');
  assert.equal(observedBanned({ type: 'result', modelUsage: { 'claude-opus-5-5': {}, 'claude-opus-5': {} } }), 'claude-opus-5');
});

test('models check reports the orchestrator alias, banned settings and inert per-model entries', () => {
  const r = checkSetup({ settings: { model: 'opus', modelSettings: { 'claude-opus-5': {} } }, env: { ANTHROPIC_MODEL: 'claude-fable-5-1' } });
  assert.equal(r.ok, false);
  assert.deepEqual(r.findings.map(f => [f.level, f.where]), [['warning', 'settings.model'], ['info', 'settings.modelSettings.claude-opus-5'], ['error', 'env.ANTHROPIC_MODEL']]);
  assert.equal(checkSetup({ settings: { model: 'claude-opus-5-5' } }).ok, true);
});

test('claude: the real adapter launches an explicit pair and stops a worker whose stream shows a banned model (offline)', { timeout: 20000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jaunt-models-'));
  try {
    await mkdir(join(dir, 'scripts')); await mkdir(join(dir, 'bin'));
    for (const name of ['linear_routing.mjs', 'linear_skills.mjs', 'linear_codex.mjs', 'linear_workers.mjs', 'linear_telemetry.mjs', 'linear_wakes.mjs', 'linear_claude.mjs', 'linear_waits.mjs', 'linear_models.mjs', 'linear_model_policy.json']) await copyFile(new URL('../scripts/' + name, import.meta.url), join(dir, 'scripts', name));
    await copyFile(process.execPath, join(dir, 'bin/codex-fixture'));
    await atomicJson(join(dir, '.dev-state/claims/JAU-999.json'), { issue: 'JAU-999', claimedAt: '2026-09-23T00:00:00Z', runtime: 'claude', session: 'exact', phase: 'implementing' });
    await writeFile(join(dir, 'scripts/linear_agent.mjs'), `
      import {readFileSync,realpathSync} from 'node:fs'; export const entryPath=p=>realpathSync(p);
      if(process.argv[2]==='claims') console.log('['+readFileSync('.dev-state/claims/JAU-999.json')+']');
    `);
    await writeFile(join(dir, 'scripts/linear_watch.mjs'), `export const livePid=p=>{try{process.kill(p,0);return Boolean(p);}catch{return false;}};`);
    await writeFile(join(dir, 'bin/claude'), `#!/usr/bin/env node
      const fs=require('node:fs');
      fs.writeFileSync(process.env.FIXTURE_ROOT+'/call.json',JSON.stringify({args:process.argv.slice(2),sub:process.env.CLAUDE_CODE_SUBAGENT_MODEL,model:process.env.ANTHROPIC_MODEL??null}));
      console.log(JSON.stringify({type:'system',subtype:'init',session_id:'exact'}));
      console.log(JSON.stringify({type:'assistant',session_id:'exact',parent_tool_use_id:'t1',message:{id:'m1',model:'claude-opus-5'}}));
      setTimeout(()=>{},10000);
    `); await chmod(join(dir, 'bin/claude'), 0o755);
    await exec('git', ['init', '-q'], { cwd: dir }); await exec('git', ['checkout', '-q', '-b', 'agent/JAU-999'], { cwd: dir });
    await writeFile(join(dir, 'owner.mjs'), `
      import {execFile} from 'node:child_process';import {promisify} from 'node:util';
      import {currentAttempt,readJson} from './scripts/linear_workers.mjs';
      const exec=promisify(execFile),state=process.cwd()+'/.dev-state',claim=await readJson(state+'/claims/JAU-999.json');
      await exec(process.env.REAL_NODE,['scripts/linear_claude.mjs','worker','JAU-999','--cwd',process.cwd(),'--effort','medium']);
      for(let n=0;n<200;n++){const r=await currentAttempt(state,claim);if(r?.endedAt){console.log(JSON.stringify(r));process.exit(0);}await new Promise(r=>setTimeout(r,30));}
      throw Error('timeout');
    `);
    const { stdout } = await exec(join(dir, 'bin/codex-fixture'), ['owner.mjs'], { cwd: dir, timeout: 15000, env: { ...process.env, CODEX_THREAD_ID: 'owner', REAL_NODE: process.execPath, FIXTURE_ROOT: dir, ANTHROPIC_MODEL: 'claude-opus-5', PATH: join(dir, 'bin') + ':' + process.env.PATH } });
    const attempt = JSON.parse(stdout.trim().split('\n').at(-1));
    const call = JSON.parse(await readFile(join(dir, 'call.json'), 'utf8'));
    assert.equal(call.args[call.args.indexOf('--model') + 1], 'claude-opus-5-5');
    assert.equal(call.args[call.args.indexOf('--effort') + 1], 'medium');
    assert.equal(call.sub, 'claude-opus-5-5');
    assert.equal(call.model, null);
    assert.equal(attempt.failure.kind, 'configuration', 'no automatic retry of a banned model');
    assert.equal(attempt.bannedModel, 'claude-opus-5', 'caught on a subagent message, which telemetry does not count');
    assert.equal(attempt.telemetry.requested.sources.model, 'jaunt model policy');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// Per-phase routing (JAU-35 acceptance cases): the classifier states facts,
// the rule and the policy choose the pair.
const facts = (over = {}) => ({ category: 'B', short: false, criticalInvariant: false, openArchitecture: false, crossSystemDiagnosis: false,
  subtleLogic: false, competingHypotheses: false, hardValidation: false, xhighJustification: '', missingInformation: '', reasons: 'r', ...over });
test('the routing rule covers mechanical, subtle, inter-component, critical and exceptional work separately', async () => {
  const { decide } = await import('../scripts/linear_models.mjs');
  const pick = over => { const d = decide(facts(over)); return `${d.category}/${d.effort}`; };
  assert.equal(pick({ category: 'A', short: true }), 'A/low', 'short mechanical');
  assert.equal(pick({ category: 'A' }), 'A/medium', 'voluminous mechanical');
  assert.equal(pick({ category: 'A', subtleLogic: true }), 'B/medium', 'A excludes difficulty triggers');
  assert.equal(pick({ subtleLogic: true }), 'B/medium', 'one local difficulty stays medium on Opus 5.5');
  assert.equal(pick({ subtleLogic: true, competingHypotheses: true }), 'B/high', 'subtle logic with competing hypotheses');
  assert.equal(pick({ category: 'C' }), 'C/medium', 'inter-component with explicit contracts');
  assert.equal(pick({ category: 'B', criticalInvariant: true }), 'C/high', 'critical invariant: C and high minimum');
  assert.equal(pick({ category: 'D' }), 'D/high', 'D alone never reaches xhigh');
  assert.equal(pick({ category: 'D', subtleLogic: true, hardValidation: true }), 'D/high', 'xhigh needs a stated justification');
  assert.equal(pick({ category: 'C', subtleLogic: true, hardValidation: true, xhighJustification: 'high already failed for depth' }), 'C/xhigh');
  assert.equal(pick({ category: 'B', xhighJustification: 'asked for care' }), 'B/medium', 'justification without two difficulties is ignored');
  assert.ok(decide(facts()).model === 'claude-opus-5-5');
  assert.throws(() => decide(facts({ category: 'E' })), /no valid category/);
  assert.throws(() => decide({ category: 'A' }), /fact short is missing/);
});

test('the classifier runs as a short read-only session and its failures stay visible', async () => {
  const { classify } = await import('../scripts/linear_codex.mjs');
  const { EventEmitter } = await import('node:events');
  const { PassThrough } = await import('node:stream');
  const fake = (stdout, code = 0) => (cmd, args, opts) => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    let input = ''; child.stdin = new PassThrough(); child.stdin.on('data', d => { input += d; });
    child.stdin.on('finish', () => { fake.last = { cmd, args, opts, input }; child.stdout.end(stdout); child.stderr.end(); setImmediate(() => child.emit('close', code)); });
    return child;
  };
  const ok = JSON.stringify({ is_error: false, structured_output: facts({ category: 'C', openArchitecture: true }), total_cost_usd: 0.2,
    modelUsage: { 'claude-opus-5-5': {} }, usage: { input_tokens: 2, output_tokens: 9 }, num_turns: 2 });
  const r = await classify('plan', 'ticket body', '/tmp', { spawnImpl: fake(ok), env: { ANTHROPIC_MODEL: 'x', PATH: '/bin' } });
  const { args, opts, input } = fake.last;
  for (const flag of ['--strict-mcp-config', '--no-session-persistence', '--json-schema']) assert.ok(args.includes(flag), flag);
  assert.equal(args[args.indexOf('--tools') + 1], 'Read,Grep,Glob');
  assert.equal(args[args.indexOf('--model') + 1], 'claude-opus-5-5');
  assert.equal(args[args.indexOf('--effort') + 1], 'low', 'the classifier keeps its own pair');
  assert.equal(opts.env.CLAUDE_CODE_SUBAGENT_MODEL, 'claude-opus-5-5');
  assert.equal(opts.env.ANTHROPIC_MODEL, undefined);
  assert.match(input, /PLANNING phase/); assert.match(input, /ticket body/);
  assert.deepEqual([r.decision.category, r.decision.effort], ['C', 'high']);
  assert.equal(r.classifier.costUsd.value, 0.2);
  const failed = await classify('plan', 'x', '/tmp', { spawnImpl: fake('', 1) });
  assert.match(failed.failed, /classifier exited 1/);
  const refused = await classify('plan', 'x', '/tmp', { spawnImpl: fake(JSON.stringify({ is_error: true, result: 'budget exceeded', modelUsage: {} })) });
  assert.equal(refused.failed, 'budget exceeded');
  await assert.rejects(classify('plan', 'x', '/tmp', { spawnImpl: fake(JSON.stringify({ structured_output: facts(), modelUsage: { 'claude-fable-5-1': {} } })) }), /banned/);
  const { settingSources } = await import('../scripts/linear_telemetry.mjs');
  assert.equal(settingSources('claude', null, {}, {}, null, r).model, 'plan classifier (C)');
  assert.equal(settingSources('claude', null, {}, {}, null, failed).effort, 'jaunt model policy (classifier failed)');
  assert.equal(settingSources('claude', null, { model: 'claude-opus-5-5' }, {}, null, r).model, 'explicit option');
});

test('claude: plan classifier, refused planner resume after approval, fresh implementation session (offline)', { timeout: 30000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jaunt-phases-'));
  try {
    await mkdir(join(dir, 'scripts')); await mkdir(join(dir, 'bin'));
    for (const name of ['linear_routing.mjs', 'linear_skills.mjs', 'linear_codex.mjs', 'linear_workers.mjs', 'linear_telemetry.mjs', 'linear_wakes.mjs', 'linear_claude.mjs', 'linear_waits.mjs', 'linear_models.mjs', 'linear_model_policy.json']) await copyFile(new URL('../scripts/' + name, import.meta.url), join(dir, 'scripts', name));
    await copyFile(process.execPath, join(dir, 'bin/codex-fixture'));
    await atomicJson(join(dir, '.dev-state/claims/JAU-999.json'), { issue: 'JAU-999', claimedAt: '2026-09-23T00:00:00Z', runtime: 'claude', session: 'planner', phase: 'planning' });
    await writeFile(join(dir, 'verdict.json'), '{"verdict":"pending"}');
    await writeFile(join(dir, 'scripts/linear_agent.mjs'), `
      import {readFileSync,writeFileSync,realpathSync} from 'node:fs'; export const entryPath=p=>realpathSync(p);
      const [c,id,...a]=process.argv.slice(2), path='.dev-state/claims/JAU-999.json', held=JSON.parse(readFileSync(path));
      const out=v=>console.log(JSON.stringify(v));
      if(c==='claims') out([held]);
      if(c==='show') out({identifier:'JAU-999',title:'Fixture',description:'Do the thing',comments:{nodes:[]}});
      if(c==='verdict') console.log(readFileSync('verdict.json','utf8'));
      if(c==='stop-requested') out({stop:false});
      if(c==='plan-read') out({url:'https://linear.example/plan',content:'Approved plan: rename one symbol.'});
      if(c==='claim'){ held.phase=a[0]; held.session=a[a.indexOf('--session')+1]; writeFileSync(path,JSON.stringify(held)); out(held); }
    `);
    await writeFile(join(dir, 'scripts/linear_watch.mjs'), `export const livePid=p=>{try{process.kill(p,0);return Boolean(p);}catch{return false;}};`);
    await writeFile(join(dir, 'bin/claude'), `#!/usr/bin/env node
      const fs=require('node:fs'),a=process.argv.slice(2);let input='';
      process.stdin.on('data',d=>{input+=d;}).on('end',()=>{
        fs.appendFileSync(process.env.FIXTURE_ROOT+'/calls.jsonl',JSON.stringify({a,classifier:a.includes('--json-schema'),input:input.slice(0,200)})+'\\n');
        if(a.includes('--json-schema')){
          const impl=/IMPLEMENTATION/.test(input);
          const f={category:impl?'A':'C',short:impl,criticalInvariant:false,openArchitecture:!impl,crossSystemDiagnosis:false,subtleLogic:false,competingHypotheses:false,hardValidation:false,xhighJustification:'',missingInformation:'',reasons:impl?'one rename':'open choice'};
          console.log(JSON.stringify({is_error:false,structured_output:f,total_cost_usd:0.05,modelUsage:{'claude-opus-5-5':{}},usage:{input_tokens:3,output_tokens:4}}));return;
        }
        const s=a[a.indexOf(a.includes('--resume')?'--resume':'--session-id')+1];
        console.log(JSON.stringify({type:'system',subtype:'init',session_id:s}));
        console.log(JSON.stringify({type:'result',session_id:s,total_cost_usd:0.01,usage:{input_tokens:1,output_tokens:1}}));
      });
    `); await chmod(join(dir, 'bin/claude'), 0o755);
    await exec('git', ['init', '-q'], { cwd: dir }); await exec('git', ['checkout', '-q', '-b', 'agent/JAU-999'], { cwd: dir });
    await writeFile(join(dir, 'owner.mjs'), `
      import {execFile} from 'node:child_process';import {promisify} from 'node:util';import assert from 'node:assert/strict';
      import {readFileSync,writeFileSync} from 'node:fs';
      import {currentAttempt,readJson} from './scripts/linear_workers.mjs';
      const exec=promisify(execFile),state=process.cwd()+'/.dev-state';
      const call=(...a)=>exec(process.env.REAL_NODE,['scripts/linear_claude.mjs',...a]);
      const claim=()=>readJson(state+'/claims/JAU-999.json');
      const ended=async()=>{for(let n=0;n<300;n++){const r=await currentAttempt(state,await claim());if(r?.endedAt)return r;await new Promise(r=>setTimeout(r,30));}throw Error('timeout');};
      await call('worker','JAU-999','--cwd',process.cwd());
      const plan=await ended();
      assert.deepEqual([plan.model,plan.effort,plan.session],['claude-opus-5-5','high','planner']);
      assert.equal(plan.routing.phase,'plan');assert.equal(plan.telemetry.requested.sources.model,'plan classifier (C)');
      writeFileSync('verdict.json','{"verdict":"approved"}');
      const c=await claim();c.phase='awaiting-approval';writeFileSync(state+'/claims/JAU-999.json',JSON.stringify(c));
      await assert.rejects(call('resume','JAU-999','--message','go'),/plan approved; start the implementation session/);
      await call('implement','JAU-999');
      const impl=await ended();
      const now=await claim();
      assert.notEqual(now.session,'planner');assert.equal(impl.session,now.session);assert.equal(now.phase,'awaiting-approval');
      assert.deepEqual([impl.launchMode,impl.model,impl.effort,impl.routing.phase],['implement','claude-opus-5-5','low','implementation']);
      assert.equal(impl.telemetry.requested.sources.model,'implementation classifier (A)');
      await assert.rejects(call('implement','JAU-999'),/already has an implementation session/);
      const calls=readFileSync('calls.jsonl','utf8').trim().split('\\n').map(JSON.parse);
      assert.deepEqual(calls.map(x=>x.classifier),[true,false,true,false]);
      assert.match(calls[2].input,/IMPLEMENTATION/);
      const w=calls[3].a;assert.equal(w[w.indexOf('--session-id')+1],now.session);assert.ok(!w.includes('--resume'));
      assert.match(w.at(-1),/plan-read JAU-999/);
      console.log('phases routed');
    `);
    const { stdout } = await exec(join(dir, 'bin/codex-fixture'), ['owner.mjs'], { cwd: dir, timeout: 25000, env: { ...process.env, CODEX_THREAD_ID: 'owner', REAL_NODE: process.execPath, FIXTURE_ROOT: dir, PATH: join(dir, 'bin') + ':' + process.env.PATH } });
    assert.match(stdout, /phases routed/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('unparseable classifier output is a visible failed classification, not a crash', async () => {
  const { parseClassifier } = await import('../scripts/linear_models.mjs');
  assert.deepEqual(parseClassifier('{"type":"system"}\n{"type":"turn.completed"}'), { failed: 'unparseable classifier output' });
});
