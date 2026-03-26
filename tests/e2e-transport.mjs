#!/usr/bin/env node
/**
 * End-to-end test: Rust jaunt-host + browser client via cairn transport.
 *
 * 1. Spawns jaunt-host serve and captures the connection URL from stderr.
 * 2. Spawns the vite dev server (web directory) on port 5173.
 * 3. Opens the URL (rewritten to localhost:5173) in a headless Chromium browser.
 * 4. Collects all browser console messages and host stderr for 30 seconds.
 * 5. Reports what happened honestly.
 */

import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const WEB_DIR = resolve(ROOT, 'web');
const HOST_BIN = resolve(ROOT, 'target/release/jaunt-host');

const TIMEOUT_MS = 30_000;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Collect lines from a stream, calling `onLine` for each. */
function lineReader(stream, label, onLine) {
  let buf = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buf += chunk;
    const lines = buf.split('\n');
    buf = lines.pop(); // keep incomplete line in buffer
    for (const line of lines) {
      if (line.trim()) {
        console.log(`[${label}] ${line}`);
        onLine(line);
      }
    }
  });
}

/** Wait for a condition (predicate returning truthy) with a timeout. */
function waitFor(predicate, timeoutMs, description) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const val = predicate();
      if (val) return resolve(val);
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(`Timed out waiting for: ${description}`));
      }
      setTimeout(check, 200);
    };
    check();
  });
}

// ── Tracked processes ────────────────────────────────────────────────────────

const children = [];

function killAll() {
  for (const child of children) {
    try {
      child.kill('SIGTERM');
    } catch (_) {}
    // Force kill after 2 seconds
    setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (_) {}
    }, 2000);
  }
}

// Ensure cleanup on exit
process.on('exit', killAll);
process.on('SIGINT', () => { killAll(); process.exit(130); });
process.on('SIGTERM', () => { killAll(); process.exit(143); });
process.on('uncaughtException', (err) => {
  console.error('[test] Uncaught exception:', err);
  killAll();
  process.exit(1);
});

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(72));
  console.log('  Jaunt E2E Transport Test');
  console.log('='.repeat(72));
  console.log();

  // ── Step 1: Start jaunt-host serve ─────────────────────────────────────

  console.log('[test] Starting jaunt-host serve...');
  const hostProc = spawn(HOST_BIN, ['serve'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      // Use a unique config dir so we don't interfere with real config
      XDG_CONFIG_HOME: resolve(ROOT, '.test-config'),
    },
  });
  children.push(hostProc);

  const hostStderr = [];
  let profileUrl = null;

  lineReader(hostProc.stderr, 'host:err', (line) => {
    hostStderr.push(line);
    // Look for the URL line, e.g. "  URL:     https://moukrea.github.io/jaunt/#<base64>"
    const urlMatch = line.match(/URL:\s+(https?:\/\/.+)/);
    if (urlMatch) {
      profileUrl = urlMatch[1].trim();
    }
  });

  lineReader(hostProc.stdout, 'host:out', (line) => {
    // Host usually logs to stderr, but capture stdout too
  });

  hostProc.on('exit', (code, signal) => {
    console.log(`[test] jaunt-host exited: code=${code} signal=${signal}`);
  });

  // Wait for the host to emit the URL
  try {
    await waitFor(() => profileUrl, 15_000, 'jaunt-host URL');
    console.log(`[test] Got profile URL: ${profileUrl}`);
  } catch (err) {
    console.error(`[test] FAILED: ${err.message}`);
    console.error('[test] Host stderr so far:');
    for (const line of hostStderr) console.error(`  ${line}`);
    killAll();
    process.exit(1);
  }

  // Extract the fragment from the URL (everything after #)
  const hashIdx = profileUrl.indexOf('#');
  if (hashIdx === -1) {
    console.error('[test] FAILED: URL has no fragment');
    killAll();
    process.exit(1);
  }
  const fragment = profileUrl.slice(hashIdx + 1);
  console.log(`[test] Fragment length: ${fragment.length} chars`);

  // Decode the profile to show what the host sent
  try {
    const base64 = fragment.replace(/-/g, '+').replace(/_/g, '/');
    const pad = base64.length % 4;
    const padded = pad ? base64 + '='.repeat(4 - pad) : base64;
    const json = Buffer.from(padded, 'base64').toString('utf8');
    const profile = JSON.parse(json);
    console.log('[test] Profile decoded:');
    console.log(`  host_name: ${profile.host_name}`);
    console.log(`  libp2p_peer_id: ${profile.libp2p_peer_id || '(none)'}`);
    console.log(`  ws_addrs: ${JSON.stringify(profile.ws_addrs || [])}`);
    console.log(`  pairing type: ${Object.keys(profile.pairing)[0]}`);
    console.log(`  signal_server: ${profile.signal_server || '(none)'}`);
  } catch (err) {
    console.error(`[test] Could not decode profile: ${err.message}`);
  }

  // ── Step 2: Start vite dev server ──────────────────────────────────────

  console.log();
  console.log('[test] Starting vite dev server...');
  const viteProc = spawn('npx', ['vite', '--port', '5173', '--host', '127.0.0.1'], {
    cwd: WEB_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });
  children.push(viteProc);

  let viteReady = false;
  lineReader(viteProc.stdout, 'vite:out', (line) => {
    if (line.includes('Local:') || line.includes('ready in') || line.includes('localhost:5173') || line.includes('127.0.0.1:5173')) {
      viteReady = true;
    }
  });
  lineReader(viteProc.stderr, 'vite:err', (_line) => {});

  viteProc.on('exit', (code, signal) => {
    console.log(`[test] vite exited: code=${code} signal=${signal}`);
  });

  try {
    await waitFor(() => viteReady, 30_000, 'vite dev server ready');
    console.log('[test] Vite dev server is ready');
  } catch (err) {
    console.error(`[test] FAILED: ${err.message}`);
    killAll();
    process.exit(1);
  }

  // ── Step 3: Open browser and navigate ──────────────────────────────────

  const localUrl = `http://127.0.0.1:5173/#${fragment}`;
  console.log();
  console.log(`[test] Opening browser at: ${localUrl.substring(0, 80)}...`);

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (err) {
    console.error(`[test] FAILED to launch browser: ${err.message}`);
    killAll();
    process.exit(1);
  }

  const context = await browser.newContext();
  const page = await context.newPage();

  // ── Step 4: Collect browser console messages ───────────────────────────

  const consoleLogs = [];
  const consoleErrors = [];

  page.on('console', (msg) => {
    const type = msg.type();
    const text = msg.text();
    const entry = { type, text, time: Date.now() };

    if (type === 'error') {
      consoleErrors.push(entry);
      console.log(`[browser:error] ${text}`);
    } else if (type === 'warning') {
      console.log(`[browser:warn] ${text}`);
      consoleLogs.push(entry);
    } else {
      console.log(`[browser:${type}] ${text}`);
      consoleLogs.push(entry);
    }
  });

  page.on('pageerror', (err) => {
    const entry = { type: 'pageerror', text: err.message, time: Date.now() };
    consoleErrors.push(entry);
    console.log(`[browser:pageerror] ${err.message}`);
  });

  // Navigate
  try {
    await page.goto(localUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    console.log('[test] Page loaded');
  } catch (err) {
    console.error(`[test] Page navigation failed: ${err.message}`);
  }

  // ── Step 5: Wait and observe ───────────────────────────────────────────

  console.log();
  console.log(`[test] Waiting up to ${TIMEOUT_MS / 1000}s for connection flow...`);

  const startTime = Date.now();
  let connected = false;
  let rpcReceived = false;
  let transportStarted = false;
  let transportError = null;

  // Key console messages to watch for
  const KEY_MESSAGES = [
    { pattern: '[jaunt] Starting cairn transport...', flag: 'transportInit' },
    { pattern: '[jaunt] Transport started', flag: 'transportStarted' },
    { pattern: '[jaunt] Connecting to host:', flag: 'dialing' },
    { pattern: '[jaunt] Connected via cairn transport', flag: 'connected' },
    { pattern: '[jaunt] sendRpc: SessionList', flag: 'rpcSent' },
    { pattern: '[jaunt] RPC received:', flag: 'rpcReceived' },
    { pattern: '[jaunt] Decoded response:', flag: 'rpcDecoded' },
  ];

  const ERROR_PATTERNS = [
    '[cairn] drain send failed:',
    '[cairn] _drainOutbox error:',
    'pairing error:',
    'Connection failed',
  ];

  // Key host messages to watch for
  const HOST_KEY_MESSAGES = [
    'Auto-approved peer:',
    'RPC from',
    'Sent',
    'No session for peer',
    'Send failed:',
    'Pairing completed:',
  ];

  const flags = {};

  // Poll for key events
  try {
    await waitFor(() => {
      // Check browser logs
      for (const log of consoleLogs) {
        for (const km of KEY_MESSAGES) {
          if (log.text.includes(km.pattern)) {
            flags[km.flag] = true;
          }
        }
        for (const ep of ERROR_PATTERNS) {
          if (log.text.includes(ep) && !transportError) {
            transportError = log.text;
          }
        }
      }

      // Check browser errors
      for (const err of consoleErrors) {
        for (const ep of ERROR_PATTERNS) {
          if (err.text.includes(ep) && !transportError) {
            transportError = err.text;
          }
        }
      }

      connected = !!flags.connected;
      rpcReceived = !!flags.rpcReceived || !!flags.rpcDecoded;
      transportStarted = !!flags.transportStarted;

      // Success: RPC response received
      if (rpcReceived) return true;

      // Also stop if we see a terminal error
      if (transportError) return true;

      // Check elapsed time
      return Date.now() - startTime > TIMEOUT_MS;
    }, TIMEOUT_MS + 5000, 'test completion');
  } catch (_) {
    // Timeout is expected
  }

  // Give a small grace period for any final logs
  await new Promise((r) => setTimeout(r, 2000));

  // ── Step 6: Report results ─────────────────────────────────────────────

  console.log();
  console.log('='.repeat(72));
  console.log('  TEST RESULTS');
  console.log('='.repeat(72));
  console.log();

  // Browser console summary
  console.log('--- Browser Console Messages ---');
  const allBrowserLogs = [...consoleLogs, ...consoleErrors].sort((a, b) => a.time - b.time);
  if (allBrowserLogs.length === 0) {
    console.log('  (no console messages)');
  } else {
    for (const log of allBrowserLogs) {
      const elapsed = ((log.time - startTime) / 1000).toFixed(1);
      console.log(`  [+${elapsed}s] [${log.type}] ${log.text}`);
    }
  }

  // Host stderr summary (all lines)
  console.log();
  console.log('--- Host Stderr (all lines) ---');
  if (hostStderr.length === 0) {
    console.log('  (no host stderr output)');
  } else {
    for (const line of hostStderr) {
      // Highlight key diagnostic lines
      const isKey = HOST_KEY_MESSAGES.some((pat) => line.includes(pat))
        || line.toLowerCase().includes('error');
      console.log(`  ${isKey ? '>>> ' : '    '}${line}`);
    }
  }

  // Connection flow status
  console.log();
  console.log('--- Connection Flow ---');
  console.log(`  Transport initialized: ${flags.transportInit ? 'YES' : 'no'}`);
  console.log(`  Transport started:     ${flags.transportStarted ? 'YES' : 'no'}`);
  console.log(`  Dial attempted:        ${flags.dialing ? 'YES' : 'no'}`);
  console.log(`  Connected:             ${flags.connected ? 'YES' : 'no'}`);
  console.log(`  RPC sent:              ${flags.rpcSent ? 'YES' : 'no'}`);
  console.log(`  RPC response received: ${flags.rpcReceived ? 'YES' : 'no'}`);
  console.log(`  RPC decoded:           ${flags.rpcDecoded ? 'YES' : 'no'}`);

  if (transportError) {
    console.log();
    console.log(`  TRANSPORT ERROR: ${transportError}`);
  }

  // Final verdict
  console.log();
  if (rpcReceived) {
    console.log('RESULT: SUCCESS -- Full round-trip RPC completed!');
  } else if (connected) {
    console.log('RESULT: PARTIAL -- Connected but no RPC response received');
  } else if (transportStarted) {
    console.log('RESULT: PARTIAL -- Transport started but connection failed');
  } else if (flags.transportInit) {
    console.log('RESULT: PARTIAL -- Transport init started but did not complete');
  } else if (transportError) {
    console.log(`RESULT: FAILED -- ${transportError}`);
  } else {
    console.log('RESULT: FAILED -- No connection activity observed');
  }

  // ── Cleanup ────────────────────────────────────────────────────────────

  console.log();
  console.log('[test] Cleaning up...');
  await browser.close();
  killAll();

  // Give processes time to exit
  await new Promise((r) => setTimeout(r, 1000));

  const exitCode = rpcReceived ? 0 : 1;
  console.log(`[test] Done (exit code ${exitCode})`);
  process.exit(exitCode);
}

main().catch((err) => {
  console.error('[test] Fatal error:', err);
  killAll();
  process.exit(1);
});
