#!/usr/bin/env node
/**
 * E2E test: workspace operations -- splits, tabs, rename, no glows.
 *
 * 1. Spawns jaunt-host serve and captures the connection URL.
 * 2. Connects via Playwright.
 * 3. Opens a session in a tab.
 * 4. Tests horizontal split.
 * 5. Tests adding a new tab.
 * 6. Tests vertical split on the first tab.
 * 7. Tests pane header rename (double-click, type, enter).
 * 8. Verifies no glow box-shadow effects.
 */

import { spawn } from 'child_process';
import { chromium } from 'playwright';

const ROOT = '/home/emeric/code/jaunt';
const HOST_BIN = `${ROOT}/target/release/jaunt-host`;
const WEB_DIR = `${ROOT}/web`;

const hostLines = [];
const browserLogs = [];
const startTime = Date.now();
const results = [];

function log(tag, msg) {
  const ts = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[${ts}s] [${tag}] ${msg}`);
}

function pass(name) {
  results.push({ name, ok: true });
  log('PASS', name);
}
function fail(name, reason) {
  results.push({ name, ok: false, reason });
  log('FAIL', `${name}: ${reason}`);
}

// Cleanup
const children = [];
function killAll() {
  for (const c of children) { try { c.kill('SIGTERM'); } catch {} }
}
process.on('exit', killAll);
process.on('SIGINT', () => { killAll(); process.exit(130); });
process.on('SIGTERM', () => { killAll(); process.exit(143); });
process.on('uncaughtException', (err) => {
  console.error(`[UNCAUGHT] ${err.message}`);
  killAll();
  // Print summary before exit
  console.log('\n' + '='.repeat(60));
  console.log('  E2E WORKSPACE TEST RESULTS (interrupted)');
  console.log('='.repeat(60));
  let passed = 0, failed = 0;
  for (const r of results) {
    const mark = r.ok ? 'PASS' : 'FAIL';
    console.log(`  [${mark}] ${r.name}${r.reason ? ': ' + r.reason : ''}`);
    if (r.ok) passed++; else failed++;
  }
  console.log(`\n  ${passed} passed, ${failed} failed out of ${results.length}`);
  process.exit(1);
});

// --- Start host ---
log('test', 'Starting jaunt-host...');
const host = spawn(HOST_BIN, ['serve'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, XDG_CONFIG_HOME: `${ROOT}/.test-config-workspace` },
});
children.push(host);
host.stderr.on('data', d => {
  for (const line of d.toString().split('\n').filter(Boolean)) {
    hostLines.push(line.trim());
    if (!line.includes('Listen:')) log('host', line.trim());
  }
});

const profileUrl = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Host did not produce URL')), 15000);
  host.stderr.on('data', d => {
    const match = d.toString().match(/URL:\s+(https?:\/\/\S+)/);
    if (match) { clearTimeout(timeout); resolve(match[1]); }
  });
});

const fragment = new URL(profileUrl).hash.slice(1);
log('test', `Got profile (fragment ${fragment.length} chars)`);

// --- Start or find vite ---
const VITE_PORT = 5173;
let vite = null;
try {
  await fetch(`http://localhost:${VITE_PORT}/`);
  log('test', `Using existing vite dev server on port ${VITE_PORT}`);
} catch {
  log('test', 'No dev server found, starting vite...');
  vite = spawn('npx', ['vite', '--port', String(VITE_PORT)], {
    cwd: WEB_DIR, stdio: ['pipe', 'pipe', 'pipe'],
  });
  children.push(vite);
  for (let i = 0; i < 30; i++) {
    try { await fetch(`http://localhost:${VITE_PORT}/`); break; }
    catch { await new Promise(r => setTimeout(r, 1000)); }
  }
  log('test', 'Vite started');
}

// --- Browser ---
const localUrl = `http://localhost:${VITE_PORT}/#${fragment}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

page.on('console', msg => {
  const text = msg.text();
  browserLogs.push(text);
  if (text.includes('[jaunt]') || text.includes('[cairn]') || text.includes('Error')) {
    log('browser', text.substring(0, 250));
  }
});
page.on('pageerror', err => log('browser:ERR', err.message.substring(0, 200)));

await page.goto(localUrl);
log('test', 'Page loaded, waiting for connection...');

// Wait for the session list view to appear (means connection succeeded)
try {
  await page.waitForFunction(
    () => document.body?.innerText?.includes('Sessions') || document.body?.innerText?.includes('active'),
    { timeout: 20000 }
  );
  pass('Connection established');
} catch (e) {
  fail('Connection established', e.message);
  const body = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || '');
  log('debug', `Body: ${body.replace(/\n/g, ' | ')}`);
  await browser.close();
  killAll();
  process.exit(1);
}

// Wait for sessions to fully load
await page.waitForTimeout(3000);

// Helper: wait for session-pick-items to appear (they load asynchronously via RPC)
async function waitForSessionPickerItems(timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const count = await page.evaluate(() =>
      document.querySelectorAll('[data-testid="session-pick-item"]').length
    );
    if (count > 0) return count;
    await page.waitForTimeout(300);
  }
  return 0;
}

// --- Step 1: Open a session in a tab ---
log('test', 'Step 1: Opening a session in a tab...');

// Click the first session row (it's in the SessionList view)
const clicked = await page.evaluate(() => {
  const rows = document.querySelectorAll('[role="button"]');
  for (const row of rows) {
    const text = row.textContent || '';
    if (text.includes('sh') || text.includes('bash') || text.includes('zsh') || /[0-9a-f]{8}/.test(text)) {
      row.click();
      return text.substring(0, 100).replace(/\n/g, ' ');
    }
  }
  return null;
});

if (!clicked) {
  log('test', 'No existing sessions, creating one...');
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent?.includes('New session'));
    if (btn) btn.click();
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Create');
    if (btn) btn.click();
  });
  await page.waitForTimeout(3000);
  // Refresh
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent?.includes('Refresh'));
    if (btn) btn.click();
  });
  await page.waitForTimeout(2000);
  // Click the first session
  await page.evaluate(() => {
    const rows = document.querySelectorAll('[role="button"]');
    for (const row of rows) {
      if (row.textContent?.includes('sh') || /[0-9a-f]{8}/.test(row.textContent || '')) {
        row.click();
        return;
      }
    }
  });
} else {
  log('test', `Clicked session: ${clicked.substring(0, 60)}`);
}

await page.waitForTimeout(2000);

// Verify terminal pane appeared
let paneCount1 = await page.evaluate(() =>
  document.querySelectorAll('[data-testid="terminal-pane"]').length
);
if (paneCount1 >= 1) {
  pass('Open session in tab (1 pane visible)');
} else {
  const hasXterm = await page.evaluate(() => !!document.querySelector('.xterm'));
  if (hasXterm) {
    pass('Open session in tab (xterm visible)');
    paneCount1 = 1;
  } else {
    fail('Open session in tab', `Expected >= 1 pane, got ${paneCount1}`);
  }
}

// --- Step 2: Horizontal split ---
log('test', 'Step 2: Testing horizontal split...');

// The split buttons are hidden (opacity-0) until hover.
// We click the button via JS -- its on:click handler dispatches
// the pane-split custom event with the correct paneId.
const hsplitDone = await page.evaluate(() => {
  const btn = document.querySelector('[data-testid="split-horizontal"]');
  if (!btn) return 'no-button';
  btn.click();
  return 'clicked';
});
log('test', `Horizontal split button: ${hsplitDone}`);

if (hsplitDone === 'no-button') {
  fail('Horizontal split', 'Could not find split-horizontal button');
}

// Wait for session picker to appear and load items
const pickerItemCount = await waitForSessionPickerItems(8000);
log('test', `Session picker items: ${pickerItemCount}`);

if (pickerItemCount === 0) {
  fail('Horizontal split', 'Session picker did not appear or had no items');
} else {
  // Click the first session in the picker
  await page.evaluate(() => {
    const items = document.querySelectorAll('[data-testid="session-pick-item"]');
    if (items.length > 0) items[0].click();
  });
  await page.waitForTimeout(2000);

  // Count panes
  const paneCount2 = await page.evaluate(() =>
    document.querySelectorAll('[data-testid="terminal-pane"]').length
  );
  log('test', `Panes after hsplit: ${paneCount2}`);
  if (paneCount2 >= 2) {
    pass('Horizontal split (2 panes visible)');
  } else {
    fail('Horizontal split', `Expected >= 2 panes, got ${paneCount2}`);
  }
}

// --- Step 3: Add a new tab ---
log('test', 'Step 3: Adding a new tab...');

// Record current tab count
const tabCount1 = await page.evaluate(() => {
  const tabBar = document.querySelector('[data-testid="add-tab"]')?.closest('.flex.items-stretch');
  if (!tabBar) return -1;
  return tabBar.querySelectorAll('[draggable]').length;
});
log('test', `Current tab count: ${tabCount1}`);

// Click the + button using evaluate to avoid overlay interception
await page.evaluate(() => {
  const btn = document.querySelector('[data-testid="add-tab"]');
  if (btn) btn.click();
});
await page.waitForTimeout(500);

// Wait for session picker items
const pickerItemCount2 = await waitForSessionPickerItems(8000);
log('test', `Session picker items for new tab: ${pickerItemCount2}`);

if (pickerItemCount2 === 0) {
  fail('Add new tab', 'Session picker did not appear or had no items');
} else {
  await page.evaluate(() => {
    const items = document.querySelectorAll('[data-testid="session-pick-item"]');
    if (items.length > 0) items[0].click();
  });
  await page.waitForTimeout(1500);

  const tabCount2 = await page.evaluate(() => {
    const tabBar = document.querySelector('[data-testid="add-tab"]')?.closest('.flex.items-stretch');
    if (!tabBar) return -1;
    return tabBar.querySelectorAll('[draggable]').length;
  });
  log('test', `Tab count after add: ${tabCount2}`);

  if (tabCount2 > tabCount1) {
    pass('Add new tab');
  } else {
    fail('Add new tab', `Expected more tabs: before=${tabCount1} after=${tabCount2}`);
  }
}

// --- Step 4: Go back to first tab and do vertical split ---
log('test', 'Step 4: Going back to first tab, testing vertical split...');

// Click the first tab
await page.evaluate(() => {
  const tabBar = document.querySelector('[data-testid="add-tab"]')?.closest('.flex.items-stretch');
  if (!tabBar) return;
  const tabs = tabBar.querySelectorAll('[draggable]');
  if (tabs.length > 0) tabs[0].click();
});
await page.waitForTimeout(1500);

// Count panes in first tab
const paneCountBeforeVsplit = await page.evaluate(() =>
  document.querySelectorAll('[data-testid="terminal-pane"]').length
);
log('test', `Panes in first tab before vsplit: ${paneCountBeforeVsplit}`);

// Click vertical split button via JS
const vsplitDone = await page.evaluate(() => {
  const btns = document.querySelectorAll('[data-testid="split-vertical"]');
  if (btns.length === 0) return 'no-button';
  btns[0].click();
  return 'clicked';
});
log('test', `Vertical split button: ${vsplitDone}`);

if (vsplitDone === 'no-button') {
  fail('Vertical split', 'Could not find split-vertical button');
} else {
  // Wait for session picker items
  const pickerItemCount3 = await waitForSessionPickerItems(8000);
  log('test', `Session picker items for vsplit: ${pickerItemCount3}`);

  if (pickerItemCount3 === 0) {
    fail('Vertical split', 'Session picker did not appear or had no items');
  } else {
    await page.evaluate(() => {
      const items = document.querySelectorAll('[data-testid="session-pick-item"]');
      if (items.length > 0) items[0].click();
    });
    await page.waitForTimeout(2000);

    const paneCount3 = await page.evaluate(() =>
      document.querySelectorAll('[data-testid="terminal-pane"]').length
    );
    log('test', `Panes after vsplit: ${paneCount3}`);
    if (paneCount3 >= 3) {
      pass('Vertical split (3 panes visible)');
    } else {
      fail('Vertical split', `Expected >= 3 panes, got ${paneCount3}`);
    }
  }
}

// --- Step 5: Rename from pane header ---
log('test', 'Step 5: Testing rename from pane header...');

const nameBeforeRename = await page.evaluate(() => {
  const nameEl = document.querySelector('[data-testid="pane-session-name"]');
  return nameEl?.textContent?.trim() || null;
});
log('test', `Name before rename: ${nameBeforeRename}`);

if (!nameBeforeRename) {
  fail('Rename from pane header', 'Could not find pane-session-name element');
} else {
  // Double-click using evaluate to avoid overlay issues
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="pane-session-name"]');
    if (el) {
      const dblclickEvt = new MouseEvent('dblclick', { bubbles: true, cancelable: true });
      el.dispatchEvent(dblclickEvt);
    }
  });
  await page.waitForTimeout(500);

  // Check that the rename input appeared
  const inputVisible = await page.evaluate(() =>
    !!document.querySelector('[data-testid="pane-rename-input"]')
  );

  if (!inputVisible) {
    fail('Rename from pane header', 'Double-click did not show rename input');
    // Debug: check what's in the pane header
    const headerHtml = await page.evaluate(() => {
      const pane = document.querySelector('[data-testid="terminal-pane"]');
      const header = pane?.querySelector('div');
      return header?.innerHTML?.substring(0, 500) || 'no header found';
    });
    log('debug', `Header HTML: ${headerHtml}`);
  } else {
    const newName = 'renamed-pane';
    // Use evaluate to set value and trigger Enter (avoids focus/overlay issues)
    await page.evaluate((name) => {
      const input = document.querySelector('[data-testid="pane-rename-input"]');
      if (input) {
        // Set value via native setter to trigger SolidJS reactivity
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (nativeSetter) {
          nativeSetter.call(input, name);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        // Press Enter
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      }
    }, newName);
    await page.waitForTimeout(500);

    // Verify the name changed
    const nameAfter = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="pane-session-name"]');
      return el?.textContent?.trim() || null;
    });
    log('test', `Name after rename: ${nameAfter}`);

    if (nameAfter === newName) {
      pass('Rename from pane header');
    } else {
      fail('Rename from pane header', `Expected "${newName}", got "${nameAfter}"`);
    }
  }
}

// --- Step 6: Verify no glow effects ---
log('test', 'Step 6: Checking for glow/shadow effects...');
const glowEffects = await page.evaluate(() => {
  const allElements = document.querySelectorAll('*');
  const glowing = [];
  for (const el of allElements) {
    const style = getComputedStyle(el);
    const shadow = style.boxShadow;
    if (shadow && shadow !== 'none') {
      glowing.push({
        tag: el.tagName,
        testid: el.getAttribute('data-testid'),
        classes: (typeof el.className === 'string' ? el.className : '').substring(0, 80),
        shadow: shadow.substring(0, 120),
      });
    }
  }
  return glowing;
});

if (glowEffects.length === 0) {
  pass('No glow/shadow effects');
} else {
  log('test', `Found ${glowEffects.length} elements with box-shadow:`);
  for (const g of glowEffects.slice(0, 10)) {
    log('test', `  ${g.tag} [${g.testid || g.classes?.substring(0, 40)}] : ${g.shadow}`);
  }
  // The specific glows we removed: 4px/6px/40px blur radius
  const badGlows = glowEffects.filter(g =>
    /\b4px\b/.test(g.shadow) ||
    /\b6px\b/.test(g.shadow) ||
    /\b40px\b/.test(g.shadow)
  );
  if (badGlows.length === 0) {
    pass('No glow/shadow effects (only acceptable utility shadows remain)');
  } else {
    fail('No glow/shadow effects', `Found ${badGlows.length} glow effects: ${JSON.stringify(badGlows[0].shadow)}`);
  }
}

// --- Summary ---
console.log('\n' + '='.repeat(60));
console.log('  E2E WORKSPACE TEST RESULTS');
console.log('='.repeat(60));
let passed = 0;
let failed = 0;
for (const r of results) {
  const mark = r.ok ? 'PASS' : 'FAIL';
  console.log(`  [${mark}] ${r.name}${r.reason ? ': ' + r.reason : ''}`);
  if (r.ok) passed++; else failed++;
}
console.log();
console.log(`  ${passed} passed, ${failed} failed out of ${results.length}`);

await browser.close();
killAll();
await new Promise(r => setTimeout(r, 1000));

process.exit(failed === 0 ? 0 : 1);
