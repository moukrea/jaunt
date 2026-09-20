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

import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
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
const AGENT = join(ROOT, 'scripts', 'linear_agent.mjs');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const INTERVAL = Number(flag('interval', 30)) * 1000;
const MAX_MS = Number(flag('max-minutes', 30)) * 60_000;

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

async function readPrevious() {
  try {
    return JSON.parse(await readFile(PULSE_FILE, 'utf8'));
  } catch {
    return null;
  }
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

async function main() {
  const startedAt = Date.now();
  let previous = await readPrevious();

  // First poll of a fresh state file establishes the baseline rather than
  // reporting every ticket as new — otherwise starting the watcher would always
  // wake the session immediately with a meaningless "everything changed".
  if (!previous) {
    previous = await runAgent('pulse');
    await mkdir(STATE_DIR, { recursive: true });
    await writeFile(PULSE_FILE, JSON.stringify(previous, null, 2));
  }

  for (;;) {
    if (Date.now() - startedAt > MAX_MS) {
      // A periodic exit with nothing to report: it lets the orchestrator
      // reconcile its own state (claims, flags, finished workers) even during a
      // long quiet stretch, and keeps the watcher process from ageing forever.
      console.log(JSON.stringify({ wake: 'interval-elapsed', events: [] }, null, 2));
      return;
    }

    await new Promise((r) => setTimeout(r, INTERVAL));

    let current;
    try {
      current = await runAgent('pulse');
    } catch (error) {
      // A transient API failure is not an event. Keep watching; only give up if
      // it is still broken on the next poll, since a watcher that dies silently
      // looks exactly like a quiet board.
      console.error(`poll failed: ${error.message}`);
      continue;
    }

    const events = diff(previous, current);
    if (events.length > 0) {
      await writeFile(PULSE_FILE, JSON.stringify(current, null, 2));
      console.log(JSON.stringify({ wake: 'board-changed', at: current.at, events }, null, 2));
      return;
    }
    previous = current;
  }
}

// Guarded like the agent's own entry point, so a test can import `diff` above:
// without it, importing this file starts a polling watcher inside the test
// runner and never returns. `argv[1]` is resolved through its symlinks first,
// for the same reason it is there.
if (process.argv[1] && import.meta.url === pathToFileURL(entryPath(process.argv[1])).href) {
  main().catch((error) => {
    console.log(JSON.stringify({ wake: 'watcher-failed', error: error.message }, null, 2));
    process.exit(1);
  });
}
