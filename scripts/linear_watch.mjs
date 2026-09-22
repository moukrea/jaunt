#!/usr/bin/env node
// The watcher: the only part of the loop that runs continuously, and the only
// part that never calls a model.
//
// It polls Linear, stays silent while the board is still, and EXITS as soon as
// something moves. That exit is the wake-up: a Bash tool call started with
// run_in_background re-invokes the session when its command terminates, so the
// orchestrator is woken by the watcher dying rather than by a schedule.
//
// The consequence, and the whole point: nothing is spent while nothing happens.
// A cron tick is a model turn even when there is no work; this is not.
//
//   node scripts/linear_watch.mjs --interval 30 --max-minutes 30
//
// The wake-up carries no payload — the harness hands the session the output
// FILE and it reads it. So what is printed on exit stays short and structured.
//
// The same file runs a second, much dumber process:
//
//   node scripts/linear_watch.mjs --watchdog --grace 600
//
// The watchdog never talks to Linear and never calls a model. It reads the
// watcher's pulse and exits when the loop has gone blind — which turns the
// mechanism above against the failure it used to hide. See `watchdog()`.

import { skillStore } from './linear_skills.mjs';
import { workerWake } from './linear_workers.mjs';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Same shape as the agent's: resolving may fail on an argv[1] that no longer
// exists, and the raw path is then the best answer available.
const entryPath = (argv1) => {
  try {
    return realpathSync(argv1);
  } catch {
    return argv1;
  }
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATE_DIR = join(ROOT, '.dev-state');
const PULSE_FILE = join(STATE_DIR, 'linear-pulse.json');
const LOOP_FILE = join(STATE_DIR, 'linear-loop.json');
// The pulse records what the BOARD last looked like; these two record whether
// anybody is still looking. Keeping them apart matters: the pulse is only
// rewritten on a wake, so its mtime is the date of the last event and never a
// sign of life (JAU-52).
export const WATCH_FILE = join(STATE_DIR, 'linear-watch.json');
export const WATCHDOG_FILE = join(STATE_DIR, 'linear-watchdog.json');
const AGENT = join(ROOT, 'scripts', 'linear_agent.mjs');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const has = (name) => args.includes(`--${name}`);
const INTERVAL_SECONDS = Number(flag('interval', 30));
const INTERVAL = INTERVAL_SECONDS * 1000;
const MAX_MINUTES = Number(flag('max-minutes', 30));
const MAX_MS = MAX_MINUTES * 60_000;
const GRACE_SECONDS = Number(flag('grace', 600));
// How long the watchdog sleeps between two readings of the pulse. Short, because
// it costs a file read and no network; the grace period is what decides when it
// acts. Same `--interval` flag as the watcher, with its own default, so the two
// roles are configured the same way.
const WATCHDOG_INTERVAL_SECONDS = Number(flag('interval', 15));
// A broken API is not a quiet board. Without this the watcher retried for the
// whole `--max-minutes` and then exited `interval-elapsed`, reporting calm on a
// board it had never managed to read (JAU-52).
const MAX_CONSECUTIVE_FAILURES = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function runAgent(command) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [AGENT, command], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(err.trim() || `linear_agent ${command} exited ${code}`));
      try {
        resolve(JSON.parse(out));
      } catch {
        reject(new Error(`unparseable output from ${command}`));
      }
    });
  });
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

// Written through a rename so a reader never catches a half-written pulse: the
// watchdog reads this file every few seconds and decides the loop is dead from
// it, which is not a decision to hand to a torn read.
async function writeJson(path, value) {
  await mkdir(STATE_DIR, { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2));
  await rename(tmp, path);
}

async function readPrevious() {
  return readJson(PULSE_FILE);
}

// A missing flag file means the loop was never switched on, which is an answer.
// A file that fails to parse is not: `loop-off` rewrites it, and reading it
// mid-write must not be mistaken for a human stopping the loop.
async function loopEnabled(lastKnown) {
  try {
    return JSON.parse(await readFile(LOOP_FILE, 'utf8')).enabled === true;
  } catch (error) {
    return error.code === 'ENOENT' ? false : lastKnown;
  }
}

// --- liveness ---------------------------------------------------------------
// Whether anybody is actually watching. This used to be answered by
// `pgrep -f linear_watch.mjs`, which matches the shell running the check — its
// own command line contains the pattern — so it answered "yes, it is running"
// from a machine where nothing was. Widening the pattern does not help: any
// form typed into a shell is a form that shell then matches. So the question is
// settled from a record the watcher writes itself, and never from process names.

// `EPERM` means a process exists and is not ours to signal, which is still
// alive. Only `ESRCH` is an answer of "nothing there".
export const livePid = (pid) => {
  if (!Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};

export function watcherHealth(record, { now, pidAlive }) {
  if (!record) return { alive: false, reason: 'never started' };
  const common = { pid: record.pid, startedAt: record.startedAt, lastPollAt: record.lastPollAt };
  if (record.endedAt) {
    return { alive: false, reason: `exited: ${record.wake ?? 'unknown'}`, ...common, endedAt: record.endedAt };
  }
  if (!pidAlive(record.pid)) return { alive: false, reason: 'process gone', ...common };
  const ageSeconds = Math.round((now - Date.parse(record.lastPollAt ?? record.startedAt)) / 1000);
  // Also the answer to a recycled pid: the process at that number is alive, but
  // it is not the one that wrote this, and it is not updating the record.
  const limit = Math.max(30, (record.intervalSeconds ?? 30) * 2.5);
  if (ageSeconds > limit) return { alive: false, reason: 'heartbeat stale', ageSeconds, ...common };
  return { alive: true, reason: 'polling', ageSeconds, ...common };
}

// The watchdog's decision, kept pure so the interesting part is testable without
// waiting ten minutes for a real one.
//
// `unhealthySince` is carried by the caller across ticks: the watchdog fires on
// a CONTINUOUS absence, so a watcher that comes back resets the clock. That is
// what makes an ordinary orchestration pass — which legitimately runs with no
// watcher while it works — silent rather than a false alarm.
export function shouldFire({ enabled, health, unhealthySince, now, graceSeconds }) {
  if (!enabled) return { fire: true, wake: 'loop-off' };
  if (health.alive) return { fire: false, unhealthySince: null };
  const since = unhealthySince ?? now;
  const forSeconds = Math.round((now - since) / 1000);
  if (forSeconds >= graceSeconds) {
    return { fire: true, wake: 'watcher-lost', forSeconds, why: health.reason };
  }
  return { fire: false, unhealthySince: since, forSeconds };
}

// Two watchdogs must not both be counting. The newer one wins and the older
// steps aside, decided on the start date rather than on pid equality: each tick
// rewrites the file with its own pid, so comparing pids would have the two
// chasing each other for ever, each seeing the other and neither yielding.
export function superseded(mine, onDisk) {
  if (!onDisk || onDisk.pid === mine.pid) return false;
  if (onDisk.startedAt !== mine.startedAt) return onDisk.startedAt > mine.startedAt;
  return onDisk.pid > mine.pid;
}

// What changed, in the terms the orchestrator acts on. Ticket-level and small:
// this is read by a model, so it names events rather than dumping state.
export function diff(previous, current) {
  const events = [];
  const before = previous?.tickets ?? {};
  const after = current.tickets;

  for (const [id, now] of Object.entries(after)) {
    const was = before[id];
    if (!was) {
      events.push({ type: 'ticket-created', ticket: id });
      continue;
    }
    if (was.c !== now.c) events.push({ type: 'comment', ticket: id });
    if (was.s !== now.s) events.push({ type: 'state-changed', ticket: id, from: was.s, to: now.s });
    // `was.cu === undefined` is a pulse written before this field existed, not a
    // comment that changed: comparing against it would report the whole board as
    // touched on the first poll after an upgrade.
    const commentTouched = was.cu !== undefined && was.cu !== now.cu;
    // The newest comment was touched without a new one arriving: someone reacted
    // to it, or edited it. From the pulse those two are indistinguishable, so the
    // event is named for what is certain rather than for the likely cause — but
    // it is how a 👍 reaches the loop at all (JAU-36). Re-read the ticket.
    if (was.c === now.c && commentTouched) {
      events.push({ type: 'comment-updated', ticket: id });
    }
    // An updatedAt bump with no comment and no state change is an edit to the
    // ticket itself — which sends it back through the analysis pass. Reacting to
    // a comment bumps the issue too (measured), so without the last clause every
    // 👍 also ordered a full re-prioritisation of a ticket nobody had edited.
    if (was.u !== now.u && was.c === now.c && was.s === now.s && !commentTouched) {
      events.push({ type: 'ticket-edited', ticket: id });
    }
  }
  for (const id of Object.keys(before)) {
    if (!after[id]) events.push({ type: 'ticket-gone', ticket: id });
  }
  return events;
}

// Every exit goes through here, so the record on disk can never say "polling"
// about a process that has stopped. That is the state the old watcher left
// behind on every single exit, and it is indistinguishable from a crash.
async function report(file, record, payload) {
  await writeJson(file, { ...record, endedAt: new Date().toISOString(), wake: payload.wake });
  console.log(JSON.stringify(payload, null, 2));
}

async function main() {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const record = {
    role: 'watcher',
    pid: process.pid,
    startedAt,
    lastPollAt: startedAt,
    intervalSeconds: INTERVAL_SECONDS,
    maxMinutes: MAX_MINUTES,
    endedAt: null,
    wake: null,
  };
  // Written before the first poll, not after: a watcher that dies during its
  // baseline call would otherwise leave no trace that it ever existed.
  await writeJson(WATCH_FILE, record);

  let enabled = true;
  let previous = await readPrevious();
  enabled = await loopEnabled(enabled);
  if (!enabled) return report(WATCH_FILE, record, { wake: 'loop-off', events: [] });
  let failures = 0;

  for (;;) {
    if (Date.now() - startedMs > MAX_MS) {
      // A periodic exit with nothing to report: it lets the orchestrator
      // reconcile its own state (claims, flags, finished workers) even during a
      // long quiet stretch, and keeps the watcher process from ageing forever.
      return report(WATCH_FILE, record, { wake: 'interval-elapsed', events: [] });
    }

    await sleep(INTERVAL);

    // Checked here rather than left to `pkill -f linear_watch.mjs`, which the
    // skill used to prescribe: that pattern would also kill the watcher of any
    // other checkout on the machine, and `loop-off` is the switch that means it.
    enabled = await loopEnabled(enabled);
    if (!enabled) return report(WATCH_FILE, record, { wake: 'loop-off', events: [] });

    record.lastPollAt = new Date().toISOString();
    await writeJson(WATCH_FILE, record);

    const changedSkills = await skillStore(ROOT).wake();
    if (changedSkills) return report(WATCH_FILE, record, changedSkills);

    let current;
    try {
      const activity = await runAgent('sync-activity');
      current = await runAgent('pulse');
      current.activityErrors = activity.errors || [];
    } catch (error) {
      // A transient API failure is not an event, but an expired token is not
      // transient. Giving up after a few tries is what turns a silent 30-minute
      // spin into a `watcher-failed` somebody can read.
      failures += 1;
      console.error(`poll failed (${failures}/${MAX_CONSECUTIVE_FAILURES}): ${error.message}`);
      if (failures >= MAX_CONSECUTIVE_FAILURES) {
        throw new Error(`${failures} consecutive polls failed: ${error.message}`);
      }
      continue;
    }
    failures = 0;

    const activityChanged = JSON.stringify(previous?.activityErrors || []) !== JSON.stringify(current.activityErrors);
    if (!previous && !activityChanged) {
      previous = current;
      await writeJson(PULSE_FILE, previous);
      continue;
    }
    const events = previous ? diff(previous, current) : [];
    if (activityChanged) events.push({ type: current.activityErrors.length ? 'activity-failed' : 'activity-recovered', errors: current.activityErrors });
    if (events.length > 0) {
      await writeJson(PULSE_FILE, current);
      return report(WATCH_FILE, record, { wake: 'board-changed', at: current.at, events });
    }
    previous = current;
  }
}

// The relauncher cannot be the watcher — it is dead by the time anyone needs it
// relaunched — and it cannot be a shell loop that never returns, because a
// process that never terminates never wakes the session. So it is a second
// background task whose whole job is to stay silent, and whose EXIT is the alarm.
//
// It survives the ordinary wake-ups: `board-changed` kills the watcher and
// leaves this one counting. It therefore only needs relaunching after it has
// fired, where the watcher needs it on every single pass — which is exactly the
// obligation that was missed for 1 h 40.
async function watchdog() {
  const startedAt = new Date().toISOString();
  const record = {
    role: 'watchdog',
    pid: process.pid,
    startedAt,
    lastPollAt: startedAt,
    intervalSeconds: WATCHDOG_INTERVAL_SECONDS,
    graceSeconds: GRACE_SECONDS,
    endedAt: null,
    wake: null,
  };
  await writeJson(WATCHDOG_FILE, record);

  const pidAlive = livePid;
  let enabled = true;
  let unhealthySince = null;

  for (;;) {
    await sleep(WATCHDOG_INTERVAL_SECONDS * 1000);

    if (superseded(record, await readJson(WATCHDOG_FILE))) {
      // Deliberately not writing `endedAt` here: the file now belongs to the
      // newer watchdog, and stamping this one's exit onto it would report the
      // live process as finished.
      console.log(JSON.stringify({ wake: 'watchdog-superseded', pid: process.pid }, null, 2));
      return;
    }

    record.lastPollAt = new Date().toISOString();
    await writeJson(WATCHDOG_FILE, record);

    enabled = await loopEnabled(enabled);
    const workerEvent = enabled ? await workerWake(STATE_DIR) : null;
    if (workerEvent) return report(WATCHDOG_FILE, record, workerEvent);
    const health = watcherHealth(await readJson(WATCH_FILE), { now: Date.now(), pidAlive });
    const decision = shouldFire({
      enabled,
      health,
      unhealthySince,
      now: Date.now(),
      graceSeconds: GRACE_SECONDS,
    });

    if (decision.fire) {
      return report(WATCHDOG_FILE, record, {
        wake: decision.wake,
        watcher: health,
        blindForSeconds: decision.forSeconds,
        events: [],
      });
    }
    unhealthySince = decision.unhealthySince;
  }
}

// Guarded like the agent's own entry point, so a test can import `diff` above:
// without it, importing this file starts a polling watcher inside the test
// runner and never returns. `argv[1]` is resolved through its symlinks first,
// for the same reason it is there.
if (process.argv[1] && import.meta.url === pathToFileURL(entryPath(process.argv[1])).href) {
  const role = has('watchdog') ? watchdog : main;
  const file = has('watchdog') ? WATCHDOG_FILE : WATCH_FILE;
  role().catch(async (error) => {
    const payload = { wake: 'watcher-failed', error: error.message };
    // Best effort: the failure is already being reported on stdout, and a state
    // directory that cannot be written is not a reason to swallow it.
    await writeJson(file, {
      pid: process.pid,
      endedAt: new Date().toISOString(),
      wake: payload.wake,
      error: error.message,
    }).catch(() => {});
    console.log(JSON.stringify(payload, null, 2));
    process.exit(1);
  });
}
