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
//   node scripts/linear_watch.mjs --interval 30
//
// It no longer exits on a timer (JAU-62): a periodic `interval-elapsed` exit was
// a model turn with nothing to do, plus the gap before that turn re-armed it.
// `--max-minutes N` keeps the old bounded run for tests and legacy launchers.
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
import { attributionWindows, filterSelf } from './linear_attribution.mjs';
import { wakeStore } from './linear_wakes.mjs';
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
// When the current Linear rate-limit cut began, across watcher restarts: the
// owner hears about one cut once, not once per re-arm.
const RATE_LIMIT_FILE = join(STATE_DIR, 'linear-rate-limit.json');
const AGENT = join(ROOT, 'scripts', 'linear_agent.mjs');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const has = (name) => args.includes(`--${name}`);
const INTERVAL_SECONDS = Number(flag('interval', 30));
const INTERVAL = INTERVAL_SECONDS * 1000;
// 0, the default, means no periodic exit at all.
const MAX_MINUTES = Number(flag('max-minutes', 0));
const MAX_MS = MAX_MINUTES > 0 ? MAX_MINUTES * 60_000 : Infinity;
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
// A transient failure (5xx, 429, network) is Linear being briefly unavailable,
// not a broken loop: a 503 on one poll used to cost an `activity-failed` wake
// and an `activity-recovered` wake 30 s later (23/09). Transient errors are
// reported only once they persist for this many polls, and a watcher whose
// polls keep failing transiently gives up after the longer budget below.
export const TRANSIENT_STREAK = 3;
const MAX_TRANSIENT_FAILURES = 20;
// How long a fresh wake waits for its siblings: a worker exit seen by the
// adapter and a Linear change 5 s later leave in one batch (JAU-61, 05:27:18
// and 05:27:23). Never longer than a poll, so fast test watchers stay fast.
const SETTLE_MS = Math.min(5000, INTERVAL);

// Linear's complexity budget (2 M points/h, sliding window). Below this share
// remaining, the watcher stops the costly activity sync and polls less often;
// on a 429 it waits for the announced reset instead of failing (JAU-62).
export const LOW_BUDGET_SHARE = 0.25;
const LOW_BUDGET_SLOWDOWN = 4;
// A cut longer than the watchdog's grace is worth telling the owner once.
const RATE_LIMIT_REPORT_MS = GRACE_SECONDS * 1000;
const MAX_RATE_LIMIT_WAIT_MS = 60 * 60_000;

export const lowBudget = (rateLimit) =>
  Boolean(rateLimit?.limit) && rateLimit.remaining / rateLimit.limit < LOW_BUDGET_SHARE;

// When a 429 says the budget returns, or null for any other error. Without an
// announced reset, wait five minutes: never a tight retry against a cut API.
export function rateLimitedUntil(message, now = Date.now()) {
  const text = String(message ?? '');
  if (!/graphql 429\b/.test(text)) return null;
  const announced = Date.parse(text.match(/graphql 429 \(reset ([^)]+)\)/)?.[1] ?? '');
  const until = Number.isFinite(announced) && announced > now ? announced : now + 5 * 60_000;
  return Math.min(until, now + MAX_RATE_LIMIT_WAIT_MS);
}

export const transientError = (message) =>
  /graphql (429|5\d\d)\b|fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|network/i.test(String(message ?? ''));

// Which per-ticket activity errors are worth a wake. A non-transient error
// (deleted ticket, corrupt ledger, permission) is reported at once; a transient
// one only after TRANSIENT_STREAK consecutive polls. `streaks` is carried by
// the caller across polls. Transient messages are normalised so a 503 whose
// body changes between polls is not reported as a new failure each time.
export function reportableErrors(errors, streaks) {
  const seen = new Set();
  const reported = [];
  for (const e of errors) {
    const transient = transientError(e.error);
    const key = `${e.issue ?? ''}:${transient ? 'transient' : e.error}`;
    seen.add(key);
    const streak = (streaks.get(key) || 0) + 1;
    streaks.set(key, streak);
    if (!transient) reported.push(e);
    else if (streak >= TRANSIENT_STREAK) {
      reported.push({ ...e, error: `transient: ${String(e.error).match(/graphql \d{3}|[A-Z]{4,}|fetch failed|socket hang up|network/i)?.[0] ?? 'unavailable'}` });
    }
  }
  for (const key of streaks.keys()) if (!seen.has(key)) streaks.delete(key);
  return reported;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function runAgent(command, ...args) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [AGENT, command, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
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

// Route before exiting: suppressing notification after exit would silently
// remove the watcher. Empty polls drain replies deferred while a worker ran.
export async function routeWake(event, invoke = async event => {
  if (!process.env.JAUNT_LINEAR_ROUTING_OWNER) return { event: event.events?.length || event.wake !== 'board-changed' ? event : null, outcomes: [] };
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(ROOT, 'scripts/linear_codex.mjs'), 'route', '--event', JSON.stringify(event)],
      { stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.resume();
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) return reject(Error('routing subprocess failed'));
      try { resolve(JSON.parse(out)); } catch { reject(Error('invalid routing response')); }
    });
  });
}) {
  try {
    const result = await invoke(event);
    if (!result || !Object.hasOwn(result, 'event') || !Array.isArray(result.outcomes)) throw Error('invalid routing response');
    return result.event;
  } catch (error) {
    // Preserve the original batch, even when the router itself failed. An empty
    // batch still needs escalation: it might contain a deferred reply on disk.
    return { ...event, routingError: error.message };
  }
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

// The agent's own Linear writes — comments, plans, activity labels, relations,
// created tickets, states it parked — move the pulse like anybody else's, and
// each one used to cost a model turn that found nothing (JAU-15). The author is
// read back only for tickets that moved; a failed read keeps every event.
export async function withoutSelfWrites(events, previous, wakes, read = windows => runAgent('attribute', JSON.stringify(windows))) {
  const windows = attributionWindows(events, previous);
  if (!Object.keys(windows).length) return events;
  let verdicts;
  try {
    ({ verdicts } = await read(windows));
  } catch (error) {
    console.error(`attribution failed, waking anyway: ${error.message}`);
    return events;
  }
  const kept = filterSelf(events, verdicts);
  if (kept.suppressed) await wakes.note('self-authored', kept.suppressed);
  return kept.events;
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
  let transientFailures = 0;
  const streaks = new Map();
  const wakes = wakeStore(STATE_DIR);

  // The only way a deposited wake reaches the model: this process exiting with
  // it. Marked delivered first; a delivery that is then lost is re-offered by
  // the outbox after its redelivery delay.
  let limitedSince = (await readJson(RATE_LIMIT_FILE))?.since ?? null;
  let budget = null;

  // Sleeps in short steps so a wake deposited by the watchdog or the adapter
  // leaves within seconds rather than after the next Linear poll, and keeps the
  // heartbeat fresh through a long rate-limit wait. True when a wake is due.
  const pause = async (ms) => {
    const until = Date.now() + ms;
    let beat = Date.now();
    while (Date.now() < until) {
      await sleep(Math.min(1000, until - Date.now()));
      if (await wakes.due({ settleMs: SETTLE_MS })) return true;
      if (Date.now() - beat >= 15_000) {
        beat = Date.now();
        record.lastPollAt = new Date().toISOString();
        await writeJson(WATCH_FILE, record);
      }
    }
    return false;
  };

  const deliver = async () => {
    const batch = await wakes.next({ settleMs: SETTLE_MS });
    if (!batch) return null;
    await wakes.delivered(batch.wakeId);
    await report(WATCH_FILE, record, batch);
    return true;
  };

  for (;;) {
    if (Date.now() - startedMs > MAX_MS) {
      // Only with an explicit `--max-minutes`: the legacy bounded run.
      return report(WATCH_FILE, record, { wake: 'interval-elapsed', events: [] });
    }
    // A human switching the loop off outranks anything waiting in the outbox.
    enabled = await loopEnabled(enabled);
    if (!enabled) return report(WATCH_FILE, record, { wake: 'loop-off', events: [] });
    if (await deliver()) return;

    const waitMs = record.rateLimitedUntil ? Math.max(0, Date.parse(record.rateLimitedUntil) - Date.now())
      : lowBudget(budget) ? INTERVAL * LOW_BUDGET_SLOWDOWN : INTERVAL;
    if (await pause(waitMs)) continue;

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
    let rawErrors;
    const saving = lowBudget(budget);
    try {
      // The activity sync is what costs (~3 600 points per ticket read): only
      // tickets that moved, and none while the budget is low.
      const activity = saving ? { errors: previous?.activityErrors || [] } : await runAgent('sync-activity', '--incremental');
      if (saving) await wakes.note('low-budget-sync');
      const waits = await runAgent('wait', 'reconcile');
      if (waits.events?.length) return report(WATCH_FILE, record, { wake: 'external-wait', events: waits.events, errors: waits.errors });
      current = await runAgent('pulse');
      rawErrors = [...(activity.errors || []), ...(waits.errors || [])];
      budget = current.rateLimit || activity.rateLimit || budget;
      delete current.rateLimit;
      // Per-ticket 429s mean the whole budget is gone, not one ticket.
      const limited = rawErrors.map(e => rateLimitedUntil(e.error)).find(Boolean);
      if (limited) throw new Error(`graphql 429 (reset ${new Date(limited).toISOString()}): activity sync rate-limited`);
    } catch (error) {
      const until = rateLimitedUntil(error.message);
      if (until) {
        // Not a failure of the loop: Linear said when to come back. Wait for it,
        // visibly, and tell the owner once if the cut outlasts the grace.
        if (!limitedSince) {
          limitedSince = Date.now();
          await writeJson(RATE_LIMIT_FILE, { since: limitedSince });
        }
        record.rateLimitedUntil = new Date(until).toISOString();
        await writeJson(WATCH_FILE, record);
        console.error(`rate-limited by Linear until ${record.rateLimitedUntil}`);
        await wakes.note('rate-limited-poll');
        if (until - limitedSince >= RATE_LIMIT_REPORT_MS) {
          await wakes.deposit([{ key: `rate-limited:${limitedSince}`, wake: 'linear-rate-limited', since: new Date(limitedSince).toISOString(), until: record.rateLimitedUntil, events: [] }]);
        }
        continue;
      }
      // A transient API failure is not an event, but an expired token is not
      // transient. Giving up after a few tries is what turns a silent 30-minute
      // spin into a `watcher-failed` somebody can read. A 503 or 429 gets a
      // longer budget: one bad poll is not a broken loop.
      if (transientError(error.message)) transientFailures += 1;
      else failures += 1;
      console.error(`poll failed (${failures}/${MAX_CONSECUTIVE_FAILURES}, transient ${transientFailures}/${MAX_TRANSIENT_FAILURES}): ${error.message}`);
      if (failures >= MAX_CONSECUTIVE_FAILURES || transientFailures >= MAX_TRANSIENT_FAILURES) {
        throw new Error(`${failures + transientFailures} consecutive polls failed: ${error.message}`);
      }
      continue;
    }
    failures = 0;
    transientFailures = 0;
    if (limitedSince) {
      limitedSince = null;
      await writeJson(RATE_LIMIT_FILE, { since: null });
    }
    if (record.rateLimitedUntil || budget) {
      delete record.rateLimitedUntil;
      record.rateLimit = budget;
      await writeJson(WATCH_FILE, record);
    }
    current.activityErrors = reportableErrors(rawErrors, streaks);
    if (rawErrors.length > current.activityErrors.length) await wakes.note('transient-activity');

    const activityChanged = JSON.stringify(previous?.activityErrors || []) !== JSON.stringify(current.activityErrors);
    if (!previous && !activityChanged) {
      previous = current;
      await writeJson(PULSE_FILE, previous);
      continue;
    }
    const moved = previous ? diff(previous, current) : [];
    const events = await withoutSelfWrites(moved, previous, wakes);
    if (activityChanged) events.push({ type: current.activityErrors.length ? 'activity-failed' : 'activity-recovered', errors: current.activityErrors });
    const unresolved = await routeWake({ wake: 'board-changed', at: current.at, events });
    // The baseline advances past the agent's own writes too, or they would be
    // attributed again on every poll.
    if (moved.length > 0 || events.length > 0 || unresolved) await writeJson(PULSE_FILE, current);
    if (unresolved) await wakes.deposit([unresolved]);
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
  const wakes = wakeStore(STATE_DIR);
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
    if (workerEvent) {
      const unresolved = workerEvent.wake === 'worker-recovery-due' ? await routeWake(workerEvent) : workerEvent;
      // Handed to the outbox, which the watcher delivers: exiting here too was
      // the second wake for a worker exit the adapter had already reported, and
      // left the loop unguarded until the next pass relaunched the watchdog.
      if (unresolved) await wakes.deposit([unresolved]);
    }
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
