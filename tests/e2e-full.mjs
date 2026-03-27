#!/usr/bin/env node
/**
 * Comprehensive E2E test suite for the Jaunt web app.
 *
 * Tests every user-facing feature:
 *   - Connection & session management
 *   - Tabs (open, switch, close, rename)
 *   - Split panes (horizontal, vertical, nested, close, focus)
 *   - Terminal interaction (PTY attach, RPC)
 *   - Pane header (rename, shell badge)
 *   - Session picker (open, search, create, close)
 *   - File browser (navigate, browse, preview)
 *   - Settings & disconnect
 *   - Bottom navigation
 *
 * Infrastructure:
 *   1. Spawns ./target/release/jaunt-host serve
 *   2. Uses vite dev server on port 5173
 *   3. Opens a headless Chromium via Playwright
 */

import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const WEB_DIR = resolve(ROOT, 'web');
const HOST_BIN = resolve(ROOT, 'target/release/jaunt-host');

// ── Test result tracking ────────────────────────────────────────────────────

const results = [];

function record(name, status, detail = '') {
  results.push({ name, status, detail });
  const icon = status === 'PASS' ? '[PASS]' : status === 'SKIP' ? '[SKIP]' : '[FAIL]';
  const msg = detail ? ` -- ${detail}` : '';
  console.log(`  ${icon} ${name}${msg}`);
}

async function runTest(name, fn) {
  try {
    await fn();
    if (!results.find(r => r.name === name)) {
      record(name, 'PASS');
    }
  } catch (err) {
    if (!results.find(r => r.name === name)) {
      record(name, 'FAIL', err.message);
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function lineReader(stream, label, onLine) {
  let buf = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buf += chunk;
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (line.trim()) {
        console.log(`[${label}] ${line}`);
        onLine(line);
      }
    }
  });
}

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

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Navigate to a specific view using the bottom nav.
 *  If in terminal view (nav hidden), close all tabs first. */
async function navigateTo(page, view) {
  const nav = page.locator('nav');
  if (await nav.count() === 0 || !(await nav.isVisible().catch(() => false))) {
    // Close all tabs to exit terminal view
    let closeBtn = page.locator('button[title="Close tab"]');
    let attempts = 0;
    while (await closeBtn.count() > 0 && attempts < 10) {
      await closeBtn.first().click();
      await sleep(300);
      closeBtn = page.locator('button[title="Close tab"]');
      attempts++;
    }
    await sleep(800);
  }

  const btn = page.locator(`nav button:has-text("${view}")`);
  if (await btn.count() > 0) {
    await btn.click();
    await sleep(800);
  }
}

/** Navigate to Sessions view and wait for the list to fully load.
 *  Works even if there are 0 sessions (shows empty state or "N active"). */
async function ensureSessionListView(page) {
  await navigateTo(page, 'Sessions');
  const heading = page.locator('h2:has-text("Sessions")');
  await heading.waitFor({ timeout: 8000 });
  // Wait for loading to finish -- either "N active" or "No sessions running"
  await page.waitForFunction(
    () => {
      const text = document.body.textContent || '';
      return text.includes('active') || text.includes('No sessions running');
    },
    { timeout: 10000 }
  );
  await sleep(300);
}

/** Create a session via the session list inline form. Returns true on success. */
async function createSessionInList(page, sessionName) {
  await ensureSessionListView(page);

  // Make sure no inline create form is already open
  const existingInput = page.locator('input[placeholder="Name (optional)"]');
  if (await existingInput.count() > 0) {
    const cancelBtn = page.locator('button:has-text("Cancel")');
    if (await cancelBtn.count() > 0) {
      await cancelBtn.click();
      await sleep(500);
    }
  }

  // Click "New session" to open inline form
  const newBtn = page.locator('button:has-text("New session")').first();
  await newBtn.click();
  await sleep(500);

  // Wait for the input to appear
  const nameInput = page.locator('input[placeholder="Name (optional)"]').first();
  await nameInput.waitFor({ timeout: 8000 });
  await nameInput.fill(sessionName);
  await nameInput.press('Enter');

  // Wait for the session name to appear. The create RPC + automatic refresh
  // can take several seconds. If it doesn't appear, try clicking Refresh.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.waitForFunction(
        (name) => {
          const rows = document.querySelectorAll('[role="button"]');
          for (const row of rows) {
            if (row.textContent && row.textContent.includes(name)) return true;
          }
          return false;
        },
        sessionName,
        { timeout: 6000 }
      );
      return true;
    } catch (_) {
      // RPC might have succeeded but list didn't refresh -- click Refresh
      const refreshBtn = page.locator('button:has-text("Refresh")');
      if (await refreshBtn.count() > 0) {
        await refreshBtn.click();
        await sleep(2000);
      }
    }
  }
  throw new Error(`Session "${sessionName}" never appeared in list`);
}

/** Open a session from the picker overlay. Includes retry for cairn RPC failures.
 *  The caller must have already triggered the picker (e.g. clicked add-tab or split).
 *  Returns true if a session was opened. */
async function openSessionFromPicker(page, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const picker = page.locator('[data-testid="session-pick-item"]');
    try {
      await picker.first().waitFor({ timeout: 6000 });
      await picker.first().click();
      await sleep(2000);
      return true;
    } catch (_) {
      if (attempt < retries) {
        console.log(`    [retry] Session picker load failed, retrying (${attempt + 1}/${retries})...`);
        // Dismiss the picker (ESC) and re-open it
        await page.keyboard.press('Escape');
        await sleep(1500);
        // Re-trigger the picker -- find whatever trigger button exists
        const addBtn = page.locator('[data-testid="add-tab"]');
        if (await addBtn.count() > 0) {
          await addBtn.click();
          await sleep(500);
        } else {
          // We're in a split flow -- click the split button again
          await page.evaluate(() => {
            const btns = document.querySelectorAll('[data-testid="split-horizontal"], [data-testid="split-vertical"]');
            if (btns.length > 0) btns[btns.length - 1].click();
          });
          await sleep(500);
        }
      }
    }
  }
  throw new Error('Session picker items never loaded after retries');
}

/** Close all open tabs, returning to session/terminal empty state */
async function closeAllTabs(page) {
  let closeBtn = page.locator('button[title="Close tab"]');
  let attempts = 0;
  while (await closeBtn.count() > 0 && attempts < 10) {
    await closeBtn.first().click();
    await sleep(300);
    closeBtn = page.locator('button[title="Close tab"]');
    attempts++;
  }
  await sleep(500);
}

/** Wait for directory entries to appear in the file browser */
async function waitForFileEntries(page, timeoutMs = 12000) {
  await page.waitForFunction(
    () => {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        const svg = btn.querySelector('svg');
        if (svg && svg.innerHTML && (svg.innerHTML.includes('M2 6a2') || svg.innerHTML.includes('M14 2H6'))) {
          return true;
        }
      }
      return false;
    },
    { timeout: timeoutMs }
  );
}

// ── Tracked processes ───────────────────────────────────────────────────────

const children = [];

function killAll() {
  for (const child of children) {
    try { child.kill('SIGTERM'); } catch (_) {}
    setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} }, 2000);
  }
}

process.on('exit', killAll);
process.on('SIGINT', () => { killAll(); process.exit(130); });
process.on('SIGTERM', () => { killAll(); process.exit(143); });
process.on('uncaughtException', (err) => {
  console.error('[test] Uncaught exception:', err);
  killAll();
  process.exit(1);
});

// Global timeout -- kill everything after 120s to prevent hangs
setTimeout(() => {
  console.error('\n[test] GLOBAL TIMEOUT (120s) -- aborting');
  printSummary();
  killAll();
  process.exit(1);
}, 120_000);

function printSummary() {
  console.log();
  console.log('='.repeat(72));
  console.log('  TEST RESULTS SUMMARY');
  console.log('='.repeat(72));
  console.log();

  let passed = 0, failed = 0, skipped = 0;
  for (const r of results) {
    const icon = r.status === 'PASS' ? '[PASS]' : r.status === 'SKIP' ? '[SKIP]' : '[FAIL]';
    const msg = r.detail ? ` -- ${r.detail}` : '';
    console.log(`  ${icon} ${r.name}${msg}`);
    if (r.status === 'PASS') passed++;
    else if (r.status === 'SKIP') skipped++;
    else failed++;
  }

  console.log();
  console.log(`  Total: ${results.length}  Passed: ${passed}  Failed: ${failed}  Skipped: ${skipped}`);
  console.log();
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(72));
  console.log('  Jaunt E2E Full Test Suite');
  console.log('='.repeat(72));
  console.log();

  // ── Step 1: Start jaunt-host serve ──────────────────────────────────────

  console.log('[test] Starting jaunt-host serve...');
  const hostProc = spawn(HOST_BIN, ['serve'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      XDG_CONFIG_HOME: resolve(ROOT, '.test-config'),
    },
  });
  children.push(hostProc);

  const hostStderr = [];
  let profileUrl = null;

  lineReader(hostProc.stderr, 'host:err', (line) => {
    hostStderr.push(line);
    const urlMatch = line.match(/URL:\s+(https?:\/\/.+)/);
    if (urlMatch) profileUrl = urlMatch[1].trim();
  });
  lineReader(hostProc.stdout, 'host:out', () => {});

  hostProc.on('exit', (code, signal) => {
    console.log(`[test] jaunt-host exited: code=${code} signal=${signal}`);
  });

  try {
    await waitFor(() => profileUrl, 15_000, 'jaunt-host URL');
    console.log(`[test] Got profile URL: ${profileUrl.substring(0, 80)}...`);
  } catch (err) {
    console.error(`[test] FATAL: ${err.message}`);
    for (const line of hostStderr) console.error(`  ${line}`);
    killAll();
    process.exit(1);
  }

  const hashIdx = profileUrl.indexOf('#');
  if (hashIdx === -1) {
    console.error('[test] FATAL: URL has no fragment');
    killAll();
    process.exit(1);
  }
  const fragment = profileUrl.slice(hashIdx + 1);

  // ── Step 2: Ensure vite dev server is running ───────────────────────────

  let viteProc = null;
  let viteReady = false;

  try {
    const res = await fetch('http://localhost:5173/', { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      viteReady = true;
      console.log('[test] Vite dev server already running on port 5173');
    }
  } catch (_) {}

  if (!viteReady) {
    console.log('[test] Starting vite dev server...');
    viteProc = spawn('npx', ['vite', '--port', '5173', '--host', 'localhost'], {
      cwd: WEB_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    children.push(viteProc);

    lineReader(viteProc.stdout, 'vite:out', (line) => {
      if (line.includes('Local:') || line.includes('ready in') ||
          line.includes('localhost:5173') || line.includes('127.0.0.1:5173')) {
        viteReady = true;
      }
    });
    lineReader(viteProc.stderr, 'vite:err', () => {});

    try {
      await waitFor(() => viteReady, 30_000, 'vite dev server');
      console.log('[test] Vite dev server started');
    } catch (err) {
      console.error(`[test] FATAL: ${err.message}`);
      killAll();
      process.exit(1);
    }
  }

  // ── Step 3: Launch browser ──────────────────────────────────────────────

  const localUrl = `http://localhost:5173/#${fragment}`;
  console.log(`[test] Opening browser at: ${localUrl.substring(0, 80)}...`);

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--disable-gpu', '--no-sandbox'],
    });
  } catch (err) {
    console.error(`[test] FATAL: browser launch failed: ${err.message}`);
    killAll();
    process.exit(1);
  }

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  const consoleLogs = [];
  page.on('console', (msg) => {
    const text = msg.text();
    consoleLogs.push({ type: msg.type(), text, time: Date.now() });
    if (msg.type() === 'error') {
      console.log(`[browser:error] ${text}`);
    }
  });
  page.on('pageerror', (err) => {
    consoleLogs.push({ type: 'pageerror', text: err.message, time: Date.now() });
    console.log(`[browser:pageerror] ${err.message}`);
  });

  // ── Step 4: Navigate and wait for connection ────────────────────────────

  try {
    await page.goto(localUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });
  } catch (err) {
    console.error(`[test] FATAL: Page navigation failed: ${err.message}`);
    await browser.close();
    killAll();
    process.exit(1);
  }

  console.log('[test] Page loaded, waiting for cairn connection...');

  let connected = false;
  try {
    await waitFor(() => {
      return consoleLogs.some(l => l.text.includes('[jaunt] Connected via cairn transport'));
    }, 30_000, 'cairn connection');
    connected = true;
    console.log('[test] Cairn transport connected');
  } catch (_) {
    console.error('[test] WARNING: Connection did not establish within timeout');
  }

  await sleep(2000);

  // ── Step 5: Run tests ───────────────────────────────────────────────────

  console.log();
  console.log('-'.repeat(72));
  console.log('  Running test cases');
  console.log('-'.repeat(72));
  console.log();

  // ========================================================================
  // CONNECTION & SESSION LIST
  // ========================================================================

  // Test 1: Connect to host
  await runTest('1. Connect to host', async () => {
    if (!connected) throw new Error('Cairn transport never connected');
    const hasConnectedDot = await page.locator('.bg-sage.pulse').count();
    if (hasConnectedDot === 0) throw new Error('No green connection dot found');
  });

  // Test 2: Session list displays
  await runTest('2. Session list displays', async () => {
    await ensureSessionListView(page);
  });

  // Test 3: Create new session
  let createdSessionName = 'test-session-' + Date.now().toString(36).slice(-4);
  let createdSessionOk = false;
  await runTest('3. Create new session', async () => {
    await createSessionInList(page, createdSessionName);
    createdSessionOk = true;
  });

  // Test 4: Rename session from list
  let renamedSessionName = 'renamed-' + Date.now().toString(36).slice(-4);
  await runTest('4. Rename session from list', async () => {
    if (!createdSessionOk) throw new Error('Prerequisite failed: session not created');
    await ensureSessionListView(page);

    // Find the row containing createdSessionName and click its Rename button
    const renamed = await page.evaluate((name) => {
      const rows = document.querySelectorAll('[role="button"]');
      for (const row of rows) {
        if (row.textContent && row.textContent.includes(name)) {
          const renameBtn = row.querySelector('button[title="Rename session"]');
          if (!renameBtn) return 'rename_btn_not_found';
          renameBtn.click();
          return 'clicked';
        }
      }
      return 'row_not_found';
    }, createdSessionName);

    if (renamed !== 'clicked') throw new Error(`Rename: ${renamed}`);
    await sleep(500);

    // Type new name in the inline rename input
    const renameInput = page.locator('input[type="text"]').last();
    await renameInput.waitFor({ timeout: 5000 });
    await renameInput.fill(renamedSessionName);
    await renameInput.press('Enter');

    // Wait for the rename to take effect. The RPC might succeed but the list
    // might not auto-refresh due to transport flakiness. Try Refresh retries.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await page.waitForFunction(
          (name) => {
            const rows = document.querySelectorAll('[role="button"]');
            for (const row of rows) {
              if (row.textContent && row.textContent.includes(name)) return true;
            }
            return false;
          },
          renamedSessionName,
          { timeout: 5000 }
        );
        createdSessionName = renamedSessionName;
        return;
      } catch (_) {
        const refreshBtn = page.locator('button:has-text("Refresh")');
        if (await refreshBtn.count() > 0) {
          await refreshBtn.click();
          await sleep(2000);
        }
      }
    }
    throw new Error('Renamed session never appeared in list');
  });

  // Test 5: Kill session (kills the last session in the list)
  await runTest('5. Kill session', async () => {
    await ensureSessionListView(page);

    // Count sessions before kill
    const countBefore = await page.evaluate(() => {
      return document.querySelectorAll('[role="button"]').length;
    });
    if (countBefore === 0) throw new Error('No sessions to kill');

    // Click the Kill button on the LAST session row
    const killed = await page.evaluate(() => {
      const rows = document.querySelectorAll('[role="button"]');
      const lastRow = rows[rows.length - 1];
      const endBtn = lastRow.querySelector('button[title="Kill session"]');
      if (!endBtn) return 'end_btn_not_found';
      endBtn.click();
      return 'clicked';
    });

    if (killed !== 'clicked') throw new Error(`Kill: ${killed}`);

    // Wait for session count to decrease. Try Refresh if it doesn't.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await page.waitForFunction(
          (expected) => document.querySelectorAll('[role="button"]').length < expected,
          countBefore,
          { timeout: 5000 }
        );
        return; // success
      } catch (_) {
        const refreshBtn = page.locator('button:has-text("Refresh")');
        if (await refreshBtn.count() > 0) {
          await refreshBtn.click();
          await sleep(2000);
        }
      }
    }
    throw new Error('Session count did not decrease after kill');
  });

  // ========================================================================
  // TABS
  // ========================================================================

  // Test 6: Open session in tab
  await runTest('6. Open session in tab', async () => {
    await ensureSessionListView(page);

    const row = page.locator('[role="button"]').first();
    if (await row.count() === 0) throw new Error('No session rows to click');
    await row.click();
    await sleep(2000);

    const terminalPane = page.locator('[data-testid="terminal-pane"]');
    await terminalPane.first().waitFor({ timeout: 8000 });
  });

  // Test 7: Open second tab
  await runTest('7. Open second tab', async () => {
    // We need to be in terminal view with at least one tab open.
    if (await page.locator('[data-testid="terminal-pane"]').count() === 0) {
      await navigateTo(page, 'Sessions');
      await sleep(500);
      const row = page.locator('[role="button"]').first();
      if (await row.count() > 0) {
        await row.click();
        await sleep(2000);
      }
    }

    const addBtn = page.locator('[data-testid="add-tab"]');
    if (await addBtn.count() === 0) throw new Error('Add tab button not found -- not in terminal view');
    await addBtn.click();
    await sleep(500);

    await openSessionFromPicker(page);

    const terminalPanes = page.locator('[data-testid="terminal-pane"]');
    const paneCount = await terminalPanes.count();
    if (paneCount < 1) throw new Error('No terminal panes after opening second tab');
  });

  // Test 8: Switch tabs
  await runTest('8. Switch tabs', async () => {
    const tabCloseButtons = page.locator('button[title="Close tab"]');
    const tabCount = await tabCloseButtons.count();
    if (tabCount < 2) {
      record('8. Switch tabs', 'SKIP', `Need 2+ tabs, found ${tabCount}`);
      return;
    }

    // Click tab labels to switch between tabs
    const tabLabels = page.locator('span.font-mono.truncate.max-w-32');
    const labelCount = await tabLabels.count();
    if (labelCount >= 2) {
      await tabLabels.first().click();
      await sleep(300);
      await tabLabels.nth(1).click();
      await sleep(300);
    }

    // An active tab has bg-bg-0 and text-text-0 classes
    const activeIndicators = await page.evaluate(() => {
      const els = document.querySelectorAll('[class*="bg-bg-0"][class*="text-text-0"]');
      return els.length;
    });
    if (activeIndicators < 1) throw new Error('No active tab indicator found');
  });

  // Test 9: Close tab
  await runTest('9. Close tab', async () => {
    const countBefore = await page.locator('button[title="Close tab"]').count();
    if (countBefore === 0) throw new Error('No tabs to close');
    await page.locator('button[title="Close tab"]').first().click();
    await sleep(1000);
    const countAfter = await page.locator('button[title="Close tab"]').count();
    if (countAfter >= countBefore) throw new Error('Tab was not closed');
  });

  // Test 10: Rename tab
  await runTest('10. Rename tab', async () => {
    // Ensure at least one tab is open
    if (await page.locator('[data-testid="terminal-pane"]').count() === 0) {
      await navigateTo(page, 'Sessions');
      await sleep(500);
      const row = page.locator('[role="button"]').first();
      if (await row.count() > 0) {
        await row.click();
        await sleep(2000);
      } else {
        throw new Error('Cannot open a tab -- no sessions available');
      }
    }

    const tabLabel = page.locator('span.font-mono.truncate.max-w-32').first();
    await tabLabel.dblclick();
    await sleep(500);

    const renameInput = page.locator('input.font-mono.w-28').first();
    await renameInput.waitFor({ timeout: 5000 });

    const newTabName = 'my-tab';
    await renameInput.fill(newTabName);
    await renameInput.press('Enter');
    await sleep(1000);

    const updatedLabel = page.locator(`text=${newTabName}`);
    await updatedLabel.first().waitFor({ timeout: 5000 });
  });

  // Test 11: All tabs closed returns to sessions
  await runTest('11. All tabs closed returns to sessions', async () => {
    await closeAllTabs(page);
    await sleep(1000);

    const sessionsHeading = page.locator('h2:has-text("Sessions")');
    const noTerminals = page.locator('text=No open terminals');
    if (await sessionsHeading.count() === 0 && await noTerminals.count() === 0) {
      throw new Error('View did not return to sessions after closing all tabs');
    }
  });

  // ========================================================================
  // SPLIT PANES
  // ========================================================================

  // Setup: open a session tab for split tests
  await runTest('12-setup. Open session for split tests', async () => {
    await navigateTo(page, 'Sessions');
    await sleep(500);

    const sessionRow = page.locator('[role="button"]').first();
    if (await sessionRow.count() > 0) {
      await sessionRow.click();
    } else {
      throw new Error('No sessions available for split tests');
    }
    await sleep(2000);
    await page.locator('[data-testid="terminal-pane"]').first().waitFor({ timeout: 8000 });
  });

  // Test 12: Horizontal split
  await runTest('12. Horizontal split', async () => {
    const panesBefore = await page.locator('[data-testid="terminal-pane"]').count();

    const splitResult = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="split-horizontal"]');
      if (!btn) return 'not_found';
      btn.click();
      return 'clicked';
    });
    if (splitResult !== 'clicked') throw new Error(`Split button: ${splitResult}`);
    await sleep(1000);

    // Open a session from the picker (with retry for cairn RPC)
    await openSessionFromPicker(page);

    // Wait for the new pane
    await page.waitForFunction(
      (expected) => document.querySelectorAll('[data-testid="terminal-pane"]').length > expected,
      panesBefore,
      { timeout: 10000 }
    );
  });

  // Test 13: Vertical split
  await runTest('13. Vertical split', async () => {
    const panesBefore = await page.locator('[data-testid="terminal-pane"]').count();
    console.log(`    [debug] Panes before vsplit: ${panesBefore}`);

    const splitResult = await page.evaluate(() => {
      const btns = document.querySelectorAll('[data-testid="split-vertical"]');
      if (btns.length === 0) return 'not_found:' + btns.length;
      btns[btns.length - 1].click();
      return 'clicked:' + btns.length;
    });
    console.log(`    [debug] split-vertical result: ${splitResult}`);
    if (!splitResult.startsWith('clicked')) throw new Error(`Split-vertical: ${splitResult}`);
    await sleep(1000);

    // Open a session from the picker (with retry)
    await openSessionFromPicker(page);

    // Wait for the new pane
    await page.waitForFunction(
      (expected) => document.querySelectorAll('[data-testid="terminal-pane"]').length > expected,
      panesBefore,
      { timeout: 10000 }
    );
    const panesAfter = await page.locator('[data-testid="terminal-pane"]').count();
    console.log(`    [debug] Panes after vsplit: ${panesAfter}`);
  });

  // Test 14: Split after split (regression)
  await runTest('14. Split after split (regression)', async () => {
    const panesBefore = await page.locator('[data-testid="terminal-pane"]').count();

    const splitResult = await page.evaluate(() => {
      const btns = document.querySelectorAll('[data-testid="split-horizontal"]');
      if (btns.length === 0) return 'not_found';
      btns[btns.length - 1].click();
      return 'clicked';
    });
    if (splitResult !== 'clicked') throw new Error(`Split button: ${splitResult}`);
    await sleep(1000);

    await openSessionFromPicker(page);

    await page.waitForFunction(
      (expected) => document.querySelectorAll('[data-testid="terminal-pane"]').length > expected,
      panesBefore,
      { timeout: 10000 }
    );
  });

  // Test 15: Close pane
  await runTest('15. Close pane', async () => {
    const panesBefore = await page.locator('[data-testid="terminal-pane"]').count();
    if (panesBefore === 0) throw new Error('No panes to close');

    const closeResult = await page.evaluate(() => {
      const closeBtn = document.querySelector('[data-testid="terminal-pane"] button[title="Close pane"]');
      if (!closeBtn) return 'not_found';
      closeBtn.click();
      return 'clicked';
    });
    if (closeResult !== 'clicked') throw new Error(`Close pane: ${closeResult}`);
    await sleep(1000);

    const panesAfter = await page.locator('[data-testid="terminal-pane"]').count();
    if (panesAfter >= panesBefore) throw new Error(`Pane not closed: before=${panesBefore}, after=${panesAfter}`);
  });

  // Test 16: Pane focus
  await runTest('16. Pane focus', async () => {
    const panes = page.locator('[data-testid="terminal-pane"]');
    const paneCount = await panes.count();
    if (paneCount < 2) {
      record('16. Pane focus', 'SKIP', 'Need 2+ panes to test focus');
      return;
    }

    await panes.nth(1).click();
    await sleep(500);

    const focusedCount = await page.evaluate(() => {
      const panes = document.querySelectorAll('[data-testid="terminal-pane"]');
      let focused = 0;
      for (const pane of panes) {
        const header = pane.children[0];
        if (header && header.style && header.style.borderTop &&
            header.style.borderTop.includes('e8a245')) {
          focused++;
        }
      }
      return focused;
    });
    if (focusedCount < 1) throw new Error('No focused pane with amber border found');
  });

  // ========================================================================
  // TERMINAL INTERACTION
  // ========================================================================

  // Test 17: PTY attach
  await runTest('17. PTY attach', async () => {
    const hasAttach = hostStderr.some(l => l.includes('SessionAttach') || l.includes('PTY forwarding'));
    const hasPtyData = consoleLogs.some(l => l.text.includes('PTY data received'));
    const xtermExists = await page.locator('.xterm').count();
    if (!hasAttach && !hasPtyData && xtermExists === 0) {
      throw new Error('No evidence of PTY attach');
    }
  });

  // Test 18: RPC round-trip
  await runTest('18. RPC round-trip', async () => {
    const hasRpcResponse = consoleLogs.some(l => l.text.includes('Decoded response'));
    if (!hasRpcResponse) throw new Error('No RPC response decoded in browser console');
  });

  // ========================================================================
  // PANE HEADER
  // ========================================================================

  // Test 19: Rename from pane header
  await runTest('19. Rename from pane header', async () => {
    if (await page.locator('[data-testid="terminal-pane"]').count() === 0) {
      record('19. Rename from pane header', 'SKIP', 'No terminal panes open');
      return;
    }

    const nameSpan = page.locator('[data-testid="pane-session-name"]').first();
    if (await nameSpan.count() === 0) throw new Error('No pane session name element found');

    await nameSpan.dblclick();
    await sleep(500);

    const renameInput = page.locator('[data-testid="pane-rename-input"]');
    await renameInput.waitFor({ timeout: 5000 });

    const paneNewName = 'pane-renamed';
    await renameInput.fill(paneNewName);
    await renameInput.press('Enter');
    await sleep(2000);

    const updated = page.locator(`text=${paneNewName}`);
    await updated.first().waitFor({ timeout: 5000 });
  });

  // Test 20: Shell badge
  await runTest('20. Shell badge', async () => {
    if (await page.locator('[data-testid="terminal-pane"]').count() === 0) {
      record('20. Shell badge', 'SKIP', 'No terminal panes open');
      return;
    }

    const badge = await page.evaluate(() => {
      const panes = document.querySelectorAll('[data-testid="terminal-pane"]');
      for (const pane of panes) {
        const spans = pane.querySelectorAll('span');
        for (const span of spans) {
          const text = (span.textContent || '').trim().toLowerCase();
          if (['bash', 'zsh', 'sh', 'fish'].includes(text)) return text;
        }
      }
      return null;
    });
    if (!badge) throw new Error('No shell badge found in pane header');
  });

  // ========================================================================
  // SESSION PICKER
  // ========================================================================

  await closeAllTabs(page);

  // Test 21: Session picker opens
  await runTest('21. Session picker opens', async () => {
    await navigateTo(page, 'Terminal');
    await sleep(500);

    const addBtn = page.locator('[data-testid="add-tab"]');
    if (await addBtn.count() === 0) throw new Error('Add tab button not found');
    await addBtn.click();
    await sleep(1000);

    const picker = page.locator('[data-testid="session-pick-item"]');
    await picker.first().waitFor({ timeout: 10000 });
  });

  // Test 22: Session picker search
  await runTest('22. Session picker search', async () => {
    const searchInput = page.locator('input[placeholder="Search sessions..."]');
    await searchInput.waitFor({ timeout: 5000 });
    await searchInput.fill('zzz-nonexistent');
    await sleep(500);

    const noMatches = page.locator('text=No matches');
    await noMatches.waitFor({ timeout: 5000 });

    await searchInput.fill('');
    await sleep(500);
    const items = page.locator('[data-testid="session-pick-item"]');
    if (await items.count() === 0) throw new Error('No sessions after clearing search');
  });

  // Test 23: Session picker create
  await runTest('23. Session picker create', async () => {
    // Click "New session" in the picker bottom
    const newSessBtn = page.locator('button:has-text("New session")').last();
    await newSessBtn.click();
    await sleep(500);

    const nameInput = page.locator('input[placeholder="Name (optional)"]').last();
    await nameInput.waitFor({ timeout: 5000 });

    const pickerName = 'picker-sess-' + Date.now().toString(36).slice(-4);
    await nameInput.fill(pickerName);

    const createBtn = page.locator('button:has-text("Create")').last();
    await createBtn.click();
    await sleep(3000);

    const termPane = page.locator('[data-testid="terminal-pane"]');
    await termPane.first().waitFor({ timeout: 8000 });
  });

  // Test 24: Session picker close on ESC
  await runTest('24. Session picker close on ESC', async () => {
    const addBtn = page.locator('[data-testid="add-tab"]');
    if (await addBtn.count() === 0) throw new Error('Add tab button not found');
    await addBtn.click();
    await sleep(500);

    const searchInput = page.locator('input[placeholder="Search sessions..."]');
    await searchInput.waitFor({ timeout: 8000 });

    await page.keyboard.press('Escape');
    await sleep(500);

    const pickerVisible = await searchInput.isVisible().catch(() => false);
    if (pickerVisible) throw new Error('Session picker did not close on ESC');
  });

  // ========================================================================
  // FILE BROWSER
  // ========================================================================

  // Test 25: Navigate to files
  await runTest('25. Navigate to files', async () => {
    await navigateTo(page, 'Files');

    // Wait for the ".." button (directory listing loaded)
    const upBtn = page.locator('button:has-text("..")');
    await upBtn.waitFor({ timeout: 15000 });

    // Wait for at least one file/folder entry to appear
    await waitForFileEntries(page, 15000);
  });

  // Test 26: Browse directory
  await runTest('26. Browse directory', async () => {
    const initialPath = await page.evaluate(() => {
      const el = document.querySelector('.font-mono.text-text-2.truncate');
      return el ? el.textContent : null;
    });
    console.log(`    [debug] File browser initial path: ${initialPath}`);

    // Click a directory entry (identified by folder SVG icon with "M2 6a2" path)
    const clicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      for (const btn of buttons) {
        const svg = btn.querySelector('svg');
        if (!svg) continue;
        if (svg.innerHTML && svg.innerHTML.includes('M2 6a2')) {
          const name = btn.querySelector('span:nth-child(2)');
          btn.click();
          return 'clicked: ' + (name ? name.textContent : 'unknown');
        }
      }
      return 'no_dirs';
    });

    if (clicked === 'no_dirs') throw new Error('No directory entries found to click');
    console.log(`    [debug] Clicked: ${clicked}`);

    // Wait for path to change (new directory loaded)
    await page.waitForFunction(
      (oldPath) => {
        const el = document.querySelector('.font-mono.text-text-2.truncate');
        return el && el.textContent && el.textContent !== oldPath;
      },
      initialPath,
      { timeout: 10000 }
    );

    const newPath = await page.evaluate(() => {
      const el = document.querySelector('.font-mono.text-text-2.truncate');
      return el ? el.textContent : null;
    });
    console.log(`    [debug] File browser new path: ${newPath}`);
    if (!newPath) throw new Error('No breadcrumb path found after navigation');
  });

  // Test 27: File preview
  await runTest('27. File preview', async () => {
    // Go up to parent directory
    const upBtn = page.locator('button:has-text("..")');
    await upBtn.click();

    // Wait for directory entries to load
    await waitForFileEntries(page, 12000);

    // Try to click a file entry
    const fileClicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      for (const btn of buttons) {
        const svg = btn.querySelector('svg');
        if (!svg) continue;
        if (svg.innerHTML && svg.innerHTML.includes('M14 2H6')) {
          const name = btn.querySelector('span:nth-child(2)');
          btn.click();
          return 'clicked: ' + (name ? name.textContent : 'unknown');
        }
      }
      return 'no_files';
    });

    if (fileClicked === 'no_files') {
      // Try clicking into a directory and finding a file there
      const dirClicked = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        for (const btn of buttons) {
          const svg = btn.querySelector('svg');
          if (!svg) continue;
          if (svg.innerHTML && svg.innerHTML.includes('M2 6a2')) {
            btn.click();
            return 'clicked_dir';
          }
        }
        return 'none';
      });

      if (dirClicked === 'clicked_dir') {
        await waitForFileEntries(page, 12000);
        const fileClicked2 = await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          for (const btn of buttons) {
            const svg = btn.querySelector('svg');
            if (!svg) continue;
            if (svg.innerHTML && svg.innerHTML.includes('M14 2H6')) {
              btn.click();
              return 'clicked_file';
            }
          }
          return 'no_files';
        });
        if (fileClicked2 === 'no_files') throw new Error('No files found for preview');
      } else {
        throw new Error('No directories or files to browse');
      }
    }

    await sleep(2000);

    const backBtn = page.locator('button:has-text("Back")');
    await backBtn.waitFor({ timeout: 8000 });
    const preContent = page.locator('pre');
    if (await preContent.count() === 0) throw new Error('Preview content not found');
    await backBtn.click();
    await sleep(500);
  });

  // ========================================================================
  // NAVIGATION (before disconnect)
  // ========================================================================

  // Test 30: Bottom nav works
  await runTest('30. Bottom nav works', async () => {
    await navigateTo(page, 'Sessions');
    const sessionsBtn = page.locator('nav button:has-text("Sessions")');
    const terminalBtn = page.locator('nav button:has-text("Terminal")');
    const filesBtn = page.locator('nav button:has-text("Files")');
    const settingsBtn = page.locator('nav button:has-text("Settings")');

    await sessionsBtn.waitFor({ timeout: 5000 });
    if (await terminalBtn.count() === 0) throw new Error('Terminal nav not found');
    if (await filesBtn.count() === 0) throw new Error('Files nav not found');
    if (await settingsBtn.count() === 0) throw new Error('Settings nav not found');

    await sessionsBtn.click();
    await sleep(800);
    if (await page.locator('h2:has-text("Sessions")').count() === 0)
      throw new Error('Sessions view did not load');

    await filesBtn.click();
    await sleep(800);
    if (await page.locator('button:has-text("..")').count() === 0)
      throw new Error('Files view did not load');

    await settingsBtn.click();
    await sleep(800);
    if (await page.locator('h2:has-text("Settings")').count() === 0)
      throw new Error('Settings view did not load');
  });

  // Test 31: Terminal hides bottom nav
  await runTest('31. Terminal hides bottom nav', async () => {
    await navigateTo(page, 'Sessions');
    await sleep(500);

    const sessionRow = page.locator('[role="button"]').first();
    if (await sessionRow.count() > 0) {
      await sessionRow.click();
      await sleep(2000);
    } else {
      const termBtn = page.locator('nav button:has-text("Terminal")');
      await termBtn.click();
      await sleep(500);
      const addBtn = page.locator('[data-testid="add-tab"]');
      await addBtn.click();
      await sleep(500);
      await openSessionFromPicker(page);
    }

    const nav = page.locator('nav');
    const navVisible = await nav.isVisible().catch(() => false);
    if (navVisible) throw new Error('Bottom nav is still visible in terminal view');
  });

  // ========================================================================
  // SETTINGS & DISCONNECT (last tests since disconnect breaks connection)
  // ========================================================================

  // Test 28: Navigate to settings
  await runTest('28. Navigate to settings', async () => {
    await navigateTo(page, 'Settings');
    const heading = page.locator('h2:has-text("Settings")');
    await heading.waitFor({ timeout: 8000 });
    const networkSection = page.locator('text=Network Infrastructure');
    await networkSection.waitFor({ timeout: 5000 });
  });

  // Test 29: Disconnect (LAST test since it kills the connection)
  await runTest('29. Disconnect', async () => {
    await navigateTo(page, 'Settings');
    await sleep(500);

    const disconnectBtn = page.locator('button:has-text("Disconnect")');
    if (await disconnectBtn.count() === 0) throw new Error('Disconnect button not found');
    await disconnectBtn.click();
    await sleep(2000);

    const pairingInput = page.locator('input[placeholder="A1B2-C3D4"]');
    if (await pairingInput.count() === 0) throw new Error('Did not return to pairing screen');
  });

  // ── Summary ─────────────────────────────────────────────────────────────

  printSummary();

  // ── Cleanup ─────────────────────────────────────────────────────────────

  console.log('[test] Cleaning up...');
  await browser.close();
  killAll();
  await sleep(1000);

  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const exitCode = failed === 0 ? 0 : 1;
  console.log(`[test] Done (exit code ${exitCode})`);
  process.exit(exitCode);
}

main().catch((err) => {
  console.error('[test] Fatal error:', err);
  printSummary();
  killAll();
  process.exit(1);
});
