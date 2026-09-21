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
    if (!['thread', 'owner-pid', 'cwd', 'message', 'model', 'effort', 'sandbox'].includes(key)) throw new Error(`unknown option --${key}`);
    options[key] = value;
  }
  return { options, positional };
}
export function workerEnvironment(env, root = ROOT) {
  // A worker is a new root session, never the orchestrator's child identity.
  return { ...Object.fromEntries(Object.entries(env).filter(([k]) =>
    !/^CLAUDE(CODE|_CODE_)/.test(k) && !/^CODEX_(THREAD_ID|SESSION_ID)$/.test(k))), JAUNT_LINEAR_ROOT: root };
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
function owner(options) {
  const thread = options.thread || process.env.CODEX_THREAD_ID;
  if (!thread) throw new Error('CODEX_THREAD_ID or --thread is required');
  let pid = options['owner-pid'] ? Number(options['owner-pid']) : process.ppid;
  for (let i = 0; i < 32 && pid > 1; i++) {
    const info = processInfo(pid);
    if (!info) break;
    if (/^codex(?:$|[-.])/.test(info.name)) return { thread, pid, started: info.started };
    if (options['owner-pid']) break;
    pid = info.ppid;
  }
  throw new Error('no live Codex CLI owner found; run from its session (never use an app-server daemon PID)');
}
function ownerAlive(o) {
  const info = processInfo(o.pid);
  return info?.started === o.started && /^codex(?:$|[-.])/.test(info.name);
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
  const path = join(ADAPTER, `${name}.json`);
  await write(path, { ...record, name, startedAt: stamp(), endedAt: null, pid: null });
  const log = await open(join(ADAPTER, `${name}.log`), 'a', 0o600);
  try {
    const child = spawn(process.execPath, [SELF, '_run', name], {
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
async function worker(id, options, resume) {
  ticket(id);
  return locked(id, async () => {
    const path = join(ADAPTER, `${id}.json`), previous = await read(path);
    if (previous && !previous.endedAt && livePid(previous.pid)) throw new Error(`${id} is still working; use the stop flag or wait`);
    const claims = await agent('claims');
    const held = claims.find(c => c.issue === id);
    if (!held || held.runtime !== 'codex') throw new Error(`${id} needs a Codex claim; legacy claims belong to Claude`);
    const session = held.session || previous?.session;
    if (resume && !session) throw new Error(`${id} has no saved Codex session to resume`);
    if (!resume && session) throw new Error(`${id} already has a session; use resume`);
    if (!options.cwd && !previous?.cwd) throw new Error('--cwd is required for a new worker');
    const cwd = await realpath(options.cwd || previous.cwd);
    const branch = (await run('git', ['branch', '--show-current'], { cwd })).trim();
    if (!branch.includes(id)) throw new Error('worker branch must contain its ticket identifier');
    const o = owner(options);
    return launch(id, {
      role: 'worker', issue: id, cwd, session: resume ? session : null, owner: o,
      model: options.model || previous?.model || process.env.JAUNT_CODEX_MODEL || null,
      effort: options.effort || previous?.effort || process.env.JAUNT_CODEX_EFFORT || null,
      sandbox: options.sandbox || previous?.sandbox || process.env.JAUNT_CODEX_SANDBOX || 'danger-full-access',
      prompt: options.message || `Invoke $linear-worker for ${id}. Read the ticket and the current claim, then continue its phase.`,
    });
  });
}
// Dependency injection makes lifecycle and wake-up tests use no Linear/model calls.
export async function supervise(child, { alive, enabled, onLine = () => {}, interval = 1000, processGroup = false, killGrace = 5000 }) {
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
  let chain = Promise.resolve();
  lines.on('line', line => { chain = chain.then(() => onLine(line)).catch(e => { lineError = e; terminate(); }); });
  const timer = setInterval(async () => {
    try {
      if (!alive()) cancelled = 'owner-closed';
      else if (enabled && !(await enabled())) cancelled = 'loop-off';
    } catch { cancelled = 'state-unreadable'; }
    if (cancelled) terminate();
  }, interval);
  try {
    const code = await new Promise((res, rej) => { child.once('error', rej); child.once('close', res); });
    await chain;
    if (lineError) throw lineError;
    return { code, cancelled };
  } finally { clearInterval(timer); clearTimeout(escalation); lines.close(); }
}
async function execute(name) {
  if (!['watcher', 'watchdog'].includes(name)) ticket(name);
  const path = join(ADAPTER, `${name}.json`);
  let record = await read(path);
  if (!record || !ownerAlive(record.owner)) throw new Error('owner is gone');
  record.pid = process.pid;
  await write(path, record);
  let notifying = false;
  try {
    let child, output = '';
    if (record.role === 'worker') {
      const command = workerArgs({ ...record });
      child = spawn('codex', command.args, { cwd: record.cwd, env: workerEnvironment(process.env), detached: true, stdio: ['pipe', 'pipe', 'inherit'] });
      child.stdin.on('error', () => {});
      child.stdin.end(command.prompt);
    } else {
      const flags = record.role === 'watchdog' ? ['--watchdog', '--grace', '600'] : ['--interval', '30', '--max-minutes', '30'];
      child = spawn(process.execPath, [join(ROOT, 'scripts/linear_watch.mjs'), ...flags], { detached: true, stdio: ['ignore', 'pipe', 'inherit'] });
    }
    const result = await supervise(child, {
      alive: () => ownerAlive(record.owner),
      processGroup: true,
      // loop-off leaves in-flight workers alone, matching the Claude loop.
      enabled: record.role === 'worker' ? null : async () => (await read(join(STATE, 'linear-loop.json')))?.enabled === true,
      onLine: async line => {
        if (record.role !== 'worker') { output += `${line}\n`; return; }
        console.log(line);
        let event; try { event = JSON.parse(line); } catch { return; }
        if (event.type === 'thread.started' && event.thread_id) {
          record.session = event.thread_id;
          await write(path, record); // recover even if worker dies before its first claim
        }
        if (event.type === 'turn.failed') record.failure = event.error || 'turn failed';
      },
    });
    record = { ...record, ...result, endedAt: stamp() };
    await write(path, record);
    if (result.cancelled) return;
    const event = record.role === 'worker'
      ? { wake: 'worker-finished', issue: record.issue, session: record.session, code: result.code, failure: record.failure }
      : JSON.parse(output);
    if (!['loop-off', 'watchdog-superseded'].includes(event.wake)) {
      notifying = true;
      await notify(record.owner, event, join(ADAPTER, `${name}-event.json`));
    }
  } catch (error) {
    // A queued wake may already have resumed this worker/re-armed this role.
    // An old delivery failure must not overwrite the new process's record.
    if ((await read(path))?.pid === process.pid) await write(path, { ...record, endedAt: stamp(), error: error.message });
    if (!notifying) await notify(record.owner, { wake: 'adapter-failed', role: record.role, issue: record.issue, error: error.message }, join(ADAPTER, `${name}-event.json`)).catch(() => {});
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
async function main() {
  const { positional: [command, id], options } = parseArgs(process.argv.slice(2));
  if (command === 'arm') return arm(options);
  if (command === 'worker' || command === 'resume') return worker(id, options, command === 'resume');
  if (command === '_run') return execute(id);
  if (command === 'status') return status();
  if (command === 'install') return install();
  if (command === 'owner') return owner(options);
  return { usage: 'jaunt-linear-codex install|owner|arm|status|worker <ID> --cwd <worktree>|resume <ID> [--message text] [--model model] [--effort effort]' };
}
if (process.argv[1] && import.meta.url === pathToFileURL(entryPath(process.argv[1])).href) {
  main().then(result => { if (result) console.log(JSON.stringify(result, null, 2)); }).catch(e => { console.error(e.message); process.exitCode = 1; });
}
