#!/usr/bin/env node
// Codex's session-bound adapter. No model runs while the board is quiet.
// Persistent workers use exec JSONL; watcher exits wake the owner through queue.
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, rename, open, rm, realpath, symlink } from 'node:fs/promises';
import { dirname, join, resolve, basename } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { livePid } from './linear_watch.mjs';
import { entryPath } from './linear_agent.mjs';
import { atomicJson, processIdentity, withWorkerLock, beginAttempt, currentAttempt, saveAttempt, lifecyclePaths, workerHealth, classifyFailure, recoveryPreflight, runtimeOf } from './linear_workers.mjs';

const SELF = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SELF), '..');
const STATE = join(ROOT, '.dev-state');
const ADAPTER = join(STATE, 'codex');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const stamp = () => new Date().toISOString();

async function read(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
async function write(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(tmp, path);
}
export function parseArgs(args) {
  const options = {}, positional = [];
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) { positional.push(args[i]); continue; }
    const key = args[i].slice(2), value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`--${key} requires a value`);
    if (!['thread', 'owner-pid', 'cwd', 'message', 'model', 'effort', 'sandbox', 'runtime'].includes(key)) throw new Error(`unknown option --${key}`);
    options[key] = value;
  }
  return { options, positional };
}
export function workerEnvironment(env, root = ROOT) {
  // A worker is a new root session, never the orchestrator's child identity.
  return { ...Object.fromEntries(Object.entries(env).filter(([k]) =>
    !/^CLAUDE(CODE|_CODE_|_SESSION_ID$)/.test(k) && !/^CODEX_(THREAD_ID|SESSION_ID)$/.test(k))), JAUNT_LINEAR_ROOT: root };
}
export function workerArgs({ session, model, effort, sandbox = 'danger-full-access', prompt, root = ROOT }) {
  if (!['read-only', 'workspace-write', 'danger-full-access'].includes(sandbox)) throw new Error(`unknown sandbox "${sandbox}"`);
  const args = ['exec'];
  if (session) args.push('resume', session);
  args.push('--json', '-c', 'approval_policy="never"', '-c', `sandbox_mode=${JSON.stringify(sandbox)}`);
  // Same unattended permissions as the Claude loop, explicitly configurable.
  if (model) args.push('--model', model);
  if (effort) args.push('-c', `model_reasoning_effort=${JSON.stringify(effort)}`);
  args.push('-');
  return { args, prompt: `${prompt}\nRead and follow ${join(root, '.agents/skills/linear-worker/SKILL.md')}.\nUse the canonical jaunt-linear launcher. First register your actual CODEX_THREAD_ID on the existing claim with --runtime codex, preserving its phase. Never invent a session ID.` };
}
function processInfo(pid) {
  try {
    const line = execFileSync('ps', ['-p', String(pid), '-o', 'ppid=', '-o', 'comm=', '-o', 'lstart='], { encoding: 'utf8' }).trim();
    const match = line.match(/^(\d+)\s+(\S+)\s+(.+)$/);
    const args = execFileSync('ps', ['-p', String(pid), '-o', 'args='], { encoding: 'utf8' }).trim();
    if (/(?:^|\s)(?:app-server|exec-server|remote-control)(?:\s|$)/.test(args)) return null;
    return match && { ppid: Number(match[1]), name: basename(match[2]), started: match[3] };
  } catch { return null; }
}
function owner(options, runtime = 'codex') {
  const thread = options.thread || process.env.CODEX_THREAD_ID || process.env.CLAUDE_SESSION_ID;
  if (!thread && runtime === 'codex') throw new Error('CODEX_THREAD_ID or --thread is required');
  let pid = options['owner-pid'] ? Number(options['owner-pid']) : process.ppid;
  for (let i = 0; i < 32 && pid > 1; i++) {
    const info = processInfo(pid);
    if (!info) break;
    if (/^codex(?:$|[-.])/.test(info.name)) return { thread, pid, started: info.started, runtime: 'codex' };
    if (runtime === 'claude' && /^claude(?:$|[-.])/.test(info.name)) return { thread, pid, started: info.started, runtime: 'claude' };
    if (options['owner-pid']) break;
    pid = info.ppid;
  }
  throw new Error('no live Codex CLI owner found; run from its session (never use an app-server daemon PID)');
}
function ownerAlive(o) {
  const info = processInfo(o.pid);
  return info?.started === o.started && (o.runtime === 'claude' ? /^claude(?:$|[-.])/ : /^codex(?:$|[-.])/).test(info.name);
}
async function run(command, args, options = {}) {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? accept(out) : reject(new Error(err.trim() || `${command} exited ${code}`)));
  });
}
async function agent(...args) {
  return JSON.parse(await run(process.execPath, [join(ROOT, 'scripts/linear_agent.mjs'), ...args]));
}
export async function notify(o, event, eventPath, { alive = ownerAlive, deliver = run } = {}) {
  await write(eventPath, { ...event, delivered: false, at: stamp() });
  if (!alive(o)) return;
  // Claude's background task completion is its wake mechanism, not Codex queue.
  if (o.runtime === 'claude') { console.log(JSON.stringify(event)); return; }
  try {
    await deliver('codex', ['queue', '--thread', o.thread, '--message',
      `Local Linear loop event (not a human approval). Read ${eventPath}, then invoke $linear-orchestrator. Reconcile the shared flag before acting; re-arm with jaunt-linear-codex arm.`,
    ], { timeout: 60_000 });
    await write(eventPath, { ...event, delivered: true, at: stamp() });
  } catch (error) {
    await write(eventPath, { ...event, delivered: false, error: error.message, at: stamp() });
    throw error;
  }
}
// Exclusive launch, including the gap before the detached process writes its PID.
async function locked(name, action) {
  await mkdir(ADAPTER, { recursive: true });
  const path = join(ADAPTER, `${name}.lock`);
  let fd;
  try { fd = await open(path, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const old = await read(path);
    if (!old || livePid(old.pid)) throw new Error(`${name} launch already in progress`);
    await rm(path);
    return locked(name, action);
  }
  try { await fd.writeFile(JSON.stringify({ pid: process.pid })); return await action(); }
  finally { await fd.close(); await rm(path, { force: true }); }
}
async function launch(name, record) {
  const dir = record.runtime === 'claude' ? join(STATE, 'claude') : ADAPTER;
  const path = join(dir, `${name}.json`);
  await write(path, { ...record, name, startedAt: stamp(), endedAt: null, pid: null });
  const log = await open(join(dir, `${name}.log`), 'a', 0o600);
  try {
    const child = spawn(process.execPath, [SELF, '_run', name, ...(record.runtime === 'claude' ? ['--runtime', 'claude'] : [])], {
      cwd: ROOT, detached: true, stdio: ['ignore', log.fd, log.fd],
    });
    await new Promise((res, rej) => { child.once('spawn', res); child.once('error', rej); });
    child.unref();
    // Child is the only writer after this initial record.
    for (let n = 0; n < 100; n++) {
      const ready = await read(path);
      if (ready.pid) return ready;
      if (!livePid(child.pid)) throw new Error(`${name} failed to start; see ${name}.log`);
      await sleep(50);
    }
    throw new Error(`${name} startup timed out; inspect ${name}.log`);
  } finally { await log.close(); }
}
async function arm(options) {
  const o = owner(options);
  await run('codex', ['queue', '--help']); // Fail before enabling anything on unsupported CLIs.
  return locked('arm', async () => {
    const health = await agent('watcher');
    if (!health.enabled) throw new Error('loop is off; use jaunt-linear loop-on first');
    // Preflight both roles before starting either: refuse a partial takeover.
    for (const role of ['watcher', 'watchdog']) {
      const r = await read(join(ADAPTER, `${role}.json`));
      const active = r && !r.endedAt && livePid(r.pid);
      if (active && (r.owner.thread !== o.thread || !ownerAlive(r.owner))) throw new Error(`${role} belongs to another session; stop that loop before takeover`);
      if (!active && health[role].alive) throw new Error(`${role} already belongs to another runtime; stop it before takeover`);
    }
    const started = [];
    for (const role of ['watcher', 'watchdog']) {
      const record = await read(join(ADAPTER, `${role}.json`));
      if (record && !record.endedAt && livePid(record.pid)) {
        if (record.owner.thread !== o.thread || !ownerAlive(record.owner)) throw new Error(`${role} belongs to another session; stop that loop before takeover`);
        started.push(record); continue;
      }
      if (health[role].alive) throw new Error(`${role} already belongs to another runtime; stop it before takeover`);
      started.push(await launch(role, { role, owner: o }));
    }
    // Don't claim readiness until the existing shared pulse confirms it.
    for (let n = 0; n < 100; n++) {
      const h = await agent('watcher');
      if (h.watcher.alive && h.watchdog.alive) return { ...h, owner: o, adapter: started };
      await sleep(50);
    }
    throw new Error('watcher did not become healthy; inspect jaunt-linear-codex status');
  });
}
function ticket(id) {
  if (!/^[A-Z][A-Z0-9]*-\d+$/.test(id || '')) throw new Error('a ticket identifier is required');
  return id;
}
export function workerSettings(runtime, previous, options, env, recover = false) {
  if (runtime === 'claude' && options.sandbox && options.sandbox !== 'danger-full-access') throw new Error('Claude launcher does not implement Codex sandbox modes');
  if (recover) return { model: previous.model, effort: previous.effort, sandbox: previous.sandbox };
  const prefix = runtime === 'claude' ? 'JAUNT_CLAUDE' : 'JAUNT_CODEX';
  return {
    model: options.model || previous?.model || env[`${prefix}_MODEL`] || null,
    effort: options.effort || previous?.effort || env[`${prefix}_EFFORT`] || null,
    sandbox: runtime === 'claude' ? 'danger-full-access' : options.sandbox || previous?.sandbox || env.JAUNT_CODEX_SANDBOX || 'danger-full-access',
  };
}
export function claudeArgs(record) {
  if (!record.session) throw new Error('Claude requires its recorded session ID');
  const args = ['-p', record.resume ? '--resume' : '--session-id', record.session,
    '--output-format', 'stream-json', '--verbose', '--permission-mode', 'bypassPermissions'];
  if (record.model) args.push('--model', record.model);
  if (record.effort) args.push('--effort', record.effort);
  args.push(record.prompt);
  return { args };
}
async function worker(id, options, resume, runtime = 'codex', recover = false) {
  ticket(id);
  if (!['codex', 'claude'].includes(runtime)) throw new Error('invalid runtime');
  return withWorkerLock(STATE, id, async () => {
    const dir = runtime === 'claude' ? join(STATE, 'claude') : ADAPTER;
    const previous = await read(join(dir, `${id}.json`));
    const held = (await agent('claims')).find(c => c.issue === id);
    if (!held || runtimeOf(held) !== runtime) throw new Error(`${id} needs a ${runtime} claim`);
    const evidence = await currentAttempt(STATE, held);
    if (evidence) {
      const health = workerHealth(held, evidence);
      if (['running', 'suspect', 'unknown'].includes(health.state)) throw new Error(`${id}: ${health.reason}`);
    } else if (previous && !previous.endedAt && livePid(previous.pid)) {
      throw new Error(`${id} is still working; use the stop flag or wait`);
    }
    const prior = recover ? evidence : previous?.claimedAt === held.claimedAt ? previous : null;
    const session = held.session || evidence?.session;
    if (recover && !session && evidence?.spawnFailed && !evidence.session) resume = false;
    if (resume && !session) throw new Error(`${id} has no saved ${runtime} session to resume`);
    if (!resume && session && runtime === 'codex') throw new Error(`${id} already has a session; use resume`);
    if (!options.cwd && !prior?.cwd) throw new Error('--cwd is required for a new worker');
    const cwd = await realpath(options.cwd || prior.cwd);
    const branch = (await run('git', ['branch', '--show-current'], { cwd })).trim();
    if (!branch.includes(id)) throw new Error('worker branch must contain its ticket identifier');
    const o = owner(options, runtime);
    let decision;
    if (recover) {
      decision = await recoveryPreflight({ state: STATE, claim: held, record: evidence, agent,
        prState: async () => {
          const prs = JSON.parse(await run('gh', ['pr', 'list', '--head', branch, '--state', 'all', '--json', 'state'], { cwd }));
          return prs.some(p => p.state === 'MERGED') ? 'MERGED' : 'OPEN';
        } });
      if (options.model || options.effort || options.sandbox) throw new Error('recovery preserves saved settings');
      if (evidence.cwd !== cwd) throw new Error('recovery worktree changed');
    }
    const record = await beginAttempt(STATE, held, {
      role: 'worker', cwd, session: resume || runtime === 'claude' ? session : null, owner: o, resume,
      ...workerSettings(runtime, prior, options, process.env, recover),
      prompt: options.message || `Invoke the linear-worker skill for ${id}. Read latest comments, stop flag, approval and PR state before continuing the current phase. Recovery is not approval.`,
    });
    if (decision) await atomicJson(lifecyclePaths(STATE, held).schedule, { ...decision, claimedAt: held.claimedAt, attempt: record.attempt });
    return launch(id, record);
  });
}
// Dependency injection makes lifecycle and wake-up tests use no Linear/model calls.
export async function supervise(child, { alive, enabled, onLine = () => {}, onTick = () => {}, onStart = () => {}, interval = 1000, processGroup = false, killGrace = 5000 }) {
  let cancelled = null, lineError = null;
  let escalation;
  const signal = sig => {
    try { if (processGroup) process.kill(-child.pid, sig); else child.kill(sig); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  const terminate = () => {
    if (escalation) return;
    signal('SIGTERM');
    escalation = setTimeout(() => signal('SIGKILL'), killGrace);
  };
  const lines = createInterface({ input: child.stdout });
  let chain = Promise.resolve().then(onStart).catch(e => { lineError = e; terminate(); });
  lines.on('line', line => { chain = chain.then(() => onLine(line)).catch(e => { lineError = e; terminate(); }); });
  const timer = setInterval(async () => {
    try {
      await onTick();
      if (!alive()) cancelled = 'owner-closed';
      else if (enabled && !(await enabled())) cancelled = 'loop-off';
    } catch { cancelled = 'state-unreadable'; }
    if (cancelled) terminate();
  }, interval);
  try {
    const code = await new Promise((res, rej) => { child.once('error', rej); child.once('close', res); });
    await chain;
    if (lineError) throw lineError;
    return { code, signal: child.signalCode, cancelled };
  } finally { clearInterval(timer); clearTimeout(escalation); lines.close(); }
}
async function execute(name, runtime = 'codex') {
  if (!['watcher', 'watchdog'].includes(name)) ticket(name);
  const dir = runtime === 'claude' ? join(STATE, 'claude') : ADAPTER;
  const path = join(dir, `${name}.json`);
  let record = await read(path);
  if (!record || !ownerAlive(record.owner)) throw new Error('owner is gone');
  record.pid = process.pid;
  record.wrapper = processIdentity(process.pid);
  record.eventPath = record.role === 'worker'
    ? join(lifecyclePaths(STATE, record).dir, `${record.attempt}-event.json`)
    : join(dir, `${name}-event.json`);
  let persistence = Promise.resolve();
  const persist = () => (persistence = persistence.then(async () => {
    record.heartbeatAt = stamp();
    if (record.role === 'worker') await saveAttempt(STATE, record);
    if ((await read(path))?.attempt === record.attempt) await write(path, record);
  }));
  await persist();
  let notifying = false;
  try {
    let child, output = '';
    if (record.role === 'worker') {
      const command = runtime === 'claude' ? claudeArgs(record) : workerArgs({ ...record });
      child = spawn(runtime, command.args, { cwd: record.cwd, env: workerEnvironment(process.env), detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', data => { stderr = (stderr + data).slice(-8192); record.stderrFailure = classifyFailure(stderr); });
      child.stdin.on('error', () => {});
      child.stdin.end(command.prompt || '');
    } else {
      const flags = record.role === 'watchdog' ? ['--watchdog', '--grace', '600'] : ['--interval', '30', '--max-minutes', '30'];
      child = spawn(process.execPath, [join(ROOT, 'scripts/linear_watch.mjs'), ...flags], { detached: true, stdio: ['ignore', 'pipe', 'inherit'] });
    }
    if (record.role === 'worker') {
      record.child = processIdentity(child.pid);
      // Persist before model output; supervise installs spawn-error handlers below.
      child.once('error', () => {});
    }
    let lastBeat = 0;
    const result = await supervise(child, {
      onStart: persist,
      onTick: async () => { if (Date.now() - lastBeat > 15000) { lastBeat = Date.now(); await persist(); } },
      alive: () => ownerAlive(record.owner),
      processGroup: true,
      // loop-off leaves in-flight workers alone, matching the Claude loop.
      enabled: record.role === 'worker' ? null : async () => (await read(join(STATE, 'linear-loop.json')))?.enabled === true,
      onLine: async line => {
        if (record.role !== 'worker') { output += `${line}\n`; return; }
        record.lastOutputAt = stamp();
        let event; try { event = JSON.parse(line); } catch {
          const failure = classifyFailure(line.slice(-8192));
          if (failure.kind !== 'transient') record.failure = failure;
          await persist(); return;
        }
        if (event.type === 'thread.started' && event.thread_id) {
          if (record.session && record.session !== event.thread_id) throw new Error('Codex emitted a different session');
          record.session = event.thread_id;
          await persist(); // recover even if worker dies before its first claim
        }
        if (event.type === 'turn.failed' || event.type === 'error' || event.is_error) record.failure = classifyFailure(event.error || event);
        if (runtime === 'claude' && event.session_id && event.session_id !== record.session) throw new Error('Claude emitted a different session');
        await persist();
      },
    });
    record = { ...record, ...result, childExited: true, endedAt: stamp() };
    if (record.role === 'worker' && result.code !== 0 && !record.failure) record.failure = record.stderrFailure || classifyFailure('process exited');
    delete record.stderrFailure;
    await persist();
    if (result.cancelled) return;
    const event = record.role === 'worker'
      ? { wake: 'worker-finished', issue: record.issue, session: record.session, code: result.code, failure: record.failure }
      : JSON.parse(output);
    if (!['loop-off', 'watchdog-superseded'].includes(event.wake)) {
      notifying = true;
      await notify(record.owner, event, record.eventPath);
    }
  } catch (error) {
    // A queued wake may already have resumed this worker/re-armed this role.
    // An old delivery failure must not overwrite the new process's record.
    if ((await read(path))?.pid === process.pid) {
      record = { ...record, endedAt: stamp(), ...(notifying ? {} : { failure: record.failure || classifyFailure(error.message) }), spawnFailed: !record.child && Boolean(error.syscall?.startsWith('spawn')) };
      await persist();
    }
    if (!notifying) await notify(record.owner, { wake: 'adapter-failed', role: record.role, issue: record.issue, error: classifyFailure(error.message).kind }, record.eventPath).catch(() => {});
    throw error;
  }
}
async function status() {
  const { readdir } = await import('node:fs/promises');
  const files = await readdir(ADAPTER).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
  const records = [];
  for (const file of files.filter(f => f.endsWith('.json'))) {
    const r = await read(join(ADAPTER, file));
    records.push({ file, ...r, ...(r?.pid ? { alive: !r.endedAt && livePid(r.pid), ownerAlive: ownerAlive(r.owner) } : {}) });
  }
  return { ...(await agent('watcher')), adapter: records };
}
async function install() {
  const bin = join(homedir(), '.local/bin');
  const skills = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'skills');
  await mkdir(bin, { recursive: true }); await mkdir(skills, { recursive: true });
  const links = [
    [join(ROOT, 'scripts/linear_agent.mjs'), join(bin, 'jaunt-linear')],
    [SELF, join(bin, 'jaunt-linear-codex')],
    ...['linear-loop', 'linear-orchestrator', 'linear-worker'].map(n => [join(ROOT, '.agents/skills', n), join(skills, n)]),
  ];
  // Refuse to overwrite another checkout or a user's own skill.
  for (const [source, target] of links) {
    try { if (await realpath(target) !== await realpath(source)) throw new Error(`existing installation differs: ${target}`); }
    catch (e) { if (e.code !== 'ENOENT') throw e; await symlink(source, target); }
  }
  return { installed: links.map(([, target]) => target) };
}
export async function main(runtime = 'codex') {
  const { positional: [command, id], options } = parseArgs(process.argv.slice(2));
  if (command === 'arm') { if (runtime !== 'codex') throw new Error('Claude uses the background watcher from its loop skill'); return arm(options); }
  if (command === 'worker' || command === 'resume' || command === 'recover') {
    const chosen = options.runtime || runtime;
    if (command === 'recover') return withWorkerLock(STATE, `RUNTIME-${chosen === 'codex' ? 1 : 2}`, () => worker(id, options, true, chosen, true));
    return worker(id, options, command === 'resume', chosen);
  }
  if (command === '_run') return execute(id, options.runtime || runtime);
  if (command === 'status') return status();
  if (command === 'install') return install();
  if (command === 'owner') return owner(options, runtime);
  return { usage: 'jaunt-linear-codex install|owner|arm|status|worker <ID> --cwd <worktree>|resume <ID>|recover <ID> [--message text] [--model model] [--effort effort]' };
}
if (process.argv[1] && import.meta.url === pathToFileURL(entryPath(process.argv[1])).href) {
  main().then(result => { if (result) console.log(JSON.stringify(result, null, 2)); }).catch(e => { console.error(e.message); process.exitCode = 1; });
}
