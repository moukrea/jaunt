#!/usr/bin/env node
// E2E test: connect to host, list sessions, attach to one, verify PTY output
import { spawn } from 'child_process';
import { chromium } from 'playwright';

const ROOT = '/home/emeric/code/jaunt';
const HOST_BIN = `${ROOT}/target/release/jaunt-host`;
const WEB_DIR = `${ROOT}/web`;

const hostLines = [];
const browserLogs = [];
const startTime = Date.now();

function log(tag, msg) {
  const ts = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[${ts}s] [${tag}] ${msg}`);
}

// --- Start host ---
log('test', 'Starting jaunt-host...');
const host = spawn(HOST_BIN, ['serve'], { stdio: ['pipe', 'pipe', 'pipe'] });
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

// --- Start vite ---
// Use the already-running vite dev server (npm run dev) on port 5173.
// If not running, start one.
const VITE_PORT = 5173;
let vite = null;
try {
  await fetch(`http://localhost:${VITE_PORT}/`);
  log('test', `Using existing vite dev server on port ${VITE_PORT}`);
} catch {
  log('test', 'No dev server found, starting vite...');
  vite = spawn('npx', ['vite', '--port', String(VITE_PORT)], { cwd: WEB_DIR, stdio: ['pipe', 'pipe', 'pipe'] });
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
  if (text.includes('[jaunt]') || text.includes('[cairn]')) {
    log('browser', text.substring(0, 250));
  }
});
page.on('pageerror', err => log('browser:ERR', err.message.substring(0, 200)));

await page.goto(localUrl);
log('test', 'Page loaded');

// Wait for session list
await page.waitForTimeout(5000);

const bodyText = await page.evaluate(() => document.body?.innerText || '');
log('test', `Body: ${bodyText.substring(0, 200).replace(/\n/g, ' | ')}`);

// Find session links
const sessionLinks = await page.$$('[class*="session"], [data-session], a[href*="session"], button');
log('test', `Buttons/links found: ${sessionLinks.length}`);

// Look for clickable session IDs (both full 16-char and truncated 8-char hex)
const clickable = await page.evaluate(() => {
  const els = document.querySelectorAll('*');
  const results = [];
  for (const el of els) {
    const text = el.textContent?.trim() || '';
    if (/^[0-9a-f]{8,16}$/.test(text)) {
      results.push({ tag: el.tagName, text, clickable: true });
    }
  }
  return results;
});
log('test', `Session IDs found: ${JSON.stringify(clickable.slice(0, 5))}`);

// Also try finding session rows by the session name pattern
const sessionRow = await page.$('text=testlive') || await page.$('text=/[0-9a-f]{8}/');
log('test', `Session row match: ${!!sessionRow}`);

// Click the first session (or its parent)
if (clickable.length > 0 || sessionRow) {
  const sessionId = clickable.length > 0 ? clickable[0].text : 'testlive';
  log('test', `Clicking session: ${sessionId}`);

  // Click the session row
  if (sessionRow) {
    await sessionRow.click();
  } else {
    await page.evaluate((id) => {
      const els = document.querySelectorAll('*');
      for (const el of els) {
        if (el.textContent?.trim() === id) {
          const target = el.closest('button, a, [role="button"], div[class*="cursor"]') || el;
          target.click();
          return;
        }
      }
    }, sessionId);
  }

  await page.waitForTimeout(5000);

  // Check what happened
  const bodyAfter = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || '');
  log('test', `After click: ${bodyAfter.replace(/\n/g, ' | ').substring(0, 300)}`);

  // Check for terminal/canvas
  const hasCanvas = await page.evaluate(() => !!document.querySelector('canvas'));
  const hasTerminal = await page.evaluate(() => !!document.querySelector('.xterm'));
  log('test', `Canvas: ${hasCanvas}, .xterm: ${hasTerminal}`);

  // Check browser logs for PTY
  const ptyReceived = browserLogs.filter(l => l.includes('PTY data received'));
  const dispatched = browserLogs.filter(l => l.includes('dispatchIncoming'));
  const protocolErrors = browserLogs.filter(l => l.includes('Protocol handler error'));
  log('test', `PTY received: ${ptyReceived.length}, dispatched: ${dispatched.length}, protocol errors: ${protocolErrors.length}`);

  for (const l of protocolErrors.slice(0, 3)) log('test', `  ERR: ${l.substring(0, 250)}`);
  for (const l of ptyReceived.slice(0, 3)) log('test', `  PTY: ${l}`);

  // Check host attach logs
  const attachLogs = hostLines.filter(l => l.includes('Attach') || l.includes('scrollback') || l.includes('forwarder'));
  for (const l of attachLogs) log('host-attach', l);

  // Try keyboard input if terminal is present
  if (hasCanvas || hasTerminal) {
    log('test', 'Terminal found! Sending keystrokes...');
    await page.keyboard.type('echo hello-jaunt', { delay: 30 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(3000);

    const inputLogs = hostLines.filter(l => l.includes('PTY') && l.includes('send'));
    log('test', `Host PTY input logs: ${inputLogs.length}`);
  }
} else {
  log('test', 'No sessions to click!');
}

// Summary
console.log('\n' + '='.repeat(60));
console.log('  RESULTS');
console.log('='.repeat(60));
const ptyCount = browserLogs.filter(l => l.includes('PTY data received')).length;
const errCount = browserLogs.filter(l => l.includes('Protocol handler error')).length;
const dispatchCount = browserLogs.filter(l => l.includes('dispatchIncoming')).length;
console.log(`  PTY data chunks received by browser: ${ptyCount}`);
console.log(`  dispatchIncoming calls: ${dispatchCount}`);
console.log(`  Protocol handler errors: ${errCount}`);
console.log(`  Host attach-related lines: ${hostLines.filter(l => l.includes('Attach') || l.includes('scrollback') || l.includes('forwarder')).length}`);

if (ptyCount > 0) {
  console.log('\n  STATUS: PTY DATA FLOWING!');
} else if (errCount > 0) {
  console.log('\n  STATUS: PROTOCOL ERRORS — likely encryption/framing mismatch');
} else if (dispatchCount > 0) {
  console.log('\n  STATUS: Messages dispatched but not tagged as PTY');
} else {
  console.log('\n  STATUS: No PTY data reached the browser');
}

await browser.close();
host.kill('SIGTERM');
if (vite) vite.kill('SIGTERM');
await new Promise(r => setTimeout(r, 1000));
process.exit(ptyCount > 0 ? 0 : 1);
