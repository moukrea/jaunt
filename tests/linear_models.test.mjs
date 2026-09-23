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
      await exec(process.env.REAL_NODE,['scripts/linear_claude.mjs','worker','JAU-999','--cwd',process.cwd()]);
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
