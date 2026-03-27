import { chromium } from 'playwright';

const FRAG = 'eyJwYWlyaW5nIjp7IlFyIjp7InFyX2RhdGEiOlsxNjYsMCw4OCwzNCwxOCwzMiwxNTUsMTM2LDE4NCw0NiwxNDksNCwxNjcsMTA2LDQyLDIxLDEzOCwyMjUsODIsMTY0LDE1OCw5NSwxNDQsMTUsMTUyLDIxOCwxNzgsMjAwLDEzOCwxMzAsMjI2LDc2LDE4MSwyNDYsMjE4LDIxMSw4OSwxOTYsMSw4MCwxNzgsMjUzLDY5LDE3MCwxNywyMzksMjMzLDcxLDE3MywxODIsNjQsODMsMTQ4LDU3LDEyMCwxMzUsMiw4MCwxNzgsMjUzLDY5LDE3MCwxNywyMzksMjMzLDcxLDE3MywxODIsNjQsODMsMTQ4LDU3LDEyMCwxMzUsMywxMzIsMTMwLDEwNSwxMDksMTE3LDEwOCwxMTYsMTA1LDk3LDEwMCwxMDAsMTE0LDEyMCwzMCw0NywxMDUsMTEyLDUyLDQ3LDQ5LDU3LDUwLDQ2LDQ5LDU0LDU2LDQ2LDUxLDUwLDQ2LDQ5LDQ3LDExNiw5OSwxMTIsNDcsNTEsNTIsNTUsNTcsNTUsNDcsMTE5LDExNSwxMzAsMTA1LDEwOSwxMTcsMTA4LDExNiwxMDUsOTcsMTAwLDEwMCwxMTQsMTIwLDMwLDQ3LDEwNSwxMTIsNTIsNDcsNDksNTcsNTAsNDYsNDksNTQsNTYsNDYsNTYsNDgsNDYsNDksNDcsMTE2LDk5LDExMiw0Nyw1MSw1Miw1NSw1Nyw1NSw0NywxMTksMTE1LDEzMCwxMDUsMTA5LDExNywxMDgsMTE2LDEwNSw5NywxMDAsMTAwLDExNCwxMjAsMjcsNDcsMTA1LDExMiw1Miw0Nyw0OSw1Nyw1MCw0Niw0OSw1NCw1Niw0Niw1MSw1MCw0Niw0OSw0NywxMTYsOTksMTEyLDQ3LDUxLDU1LDUwLDUxLDUxLDEzMCwxMDUsMTA5LDExNywxMDgsMTE2LDEwNSw5NywxMDAsMTAwLDExNCwxMjAsMjcsNDcsMTA1LDExMiw1Miw0Nyw0OSw1Nyw1MCw0Niw0OSw1NCw1Niw0Niw1Niw0OCw0Niw0OSw0NywxMTYsOTksMTEyLDQ3LDUxLDU1LDUwLDUxLDUxLDQsMjYsMTA1LDE5OCwyNTMsMTYwLDUsMjYsMTA1LDE5OCwyNTQsMjA0XX19LCJ3c19hZGRycyI6WyIvaXA0LzEyNy4wLjAuMS90Y3AvMzQ3OTcvd3MiLCIvaXA0LzE5Mi4xNjguMzIuMS90Y3AvMzQ3OTcvd3MiLCIvaXA0LzE5Mi4xNjguODAuMS90Y3AvMzQ3OTcvd3MiLCIvaXA0LzE5Mi4xNjguNDguMS90Y3AvMzQ3OTcvd3MiLCIvaXA0LzE5Mi4xNjguMTYuMS90Y3AvMzQ3OTcvd3MiLCIvaXA0LzE5Mi4xNjguNjQuMS90Y3AvMzQ3OTcvd3MiLCIvaXA0LzE5Mi4xNjguMS4xMTkvdGNwLzM0Nzk3L3dzIiwiL2lwNC8xOTIuMTY4Ljk2LjEvdGNwLzM0Nzk3L3dzIiwiL2lwNC8xOTIuMTY4LjExMi4xL3RjcC8zNDc5Ny93cyIsIi9pcDQvMTkyLjE2OC4xMjguMS90Y3AvMzQ3OTcvd3MiLCIvaXA0LzE5Mi4xNjguMTQ0LjEvdGNwLzM0Nzk3L3dzIl0sImxpYnAycF9wZWVyX2lkIjoiMTJEM0tvb1dKWnMxNWQxMnFqOVljTU5BbzRhY25oS2FtOGhZeVdQOTREZ1ZEcHJNS1JuTCIsImhvc3RfbmFtZSI6ImZlZG9yYSJ9';
const BASE = 'http://localhost:5173';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  // Page 1: Connect via URL fragment
  console.log('[1] Connecting via URL fragment...');
  const page1 = await context.newPage();
  page1.on('console', m => {
    if (m.text().includes('[jaunt]')) console.log('  [p1]', m.text().substring(0, 150));
  });
  await page1.goto(BASE + '/#' + FRAG);
  
  // Wait for session list to load
  const connected = await page1.waitForFunction(() => {
    return document.body?.innerText?.includes('Sessions') || document.body?.innerText?.includes('active');
  }, { timeout: 20000 }).catch(() => false);
  
  if (!connected) {
    console.log('[FAIL] Initial connection failed');
    const text = await page1.evaluate(() => document.body?.innerText?.substring(0, 300));
    console.log('  Body:', text);
    await browser.close();
    process.exit(1);
  }
  console.log('[1] Connected! Sessions visible.');
  
  // Wait for IndexedDB save
  await page1.waitForTimeout(2000);
  
  // Check if connection was saved
  const saved = await page1.evaluate(async () => {
    const { get } = await import('/node_modules/.vite/deps/idb-keyval.js?v=dummy');
    // Actually, just check via the app's store
    return null; // Can't easily import from the app
  }).catch(() => null);
  
  // Page 2: Open bare URL (no fragment) — should auto-reconnect
  console.log('[2] Opening bare URL (no fragment)...');
  const page2 = await context.newPage(); // Same context = same IndexedDB
  page2.on('console', m => {
    if (m.text().includes('[jaunt]')) console.log('  [p2]', m.text().substring(0, 150));
  });
  await page2.goto(BASE + '/');
  
  // Wait up to 15s for sessions to appear (auto-reconnect)
  const reconnected = await page2.waitForFunction(() => {
    return document.body?.innerText?.includes('Sessions') || 
           document.body?.innerText?.includes('active') ||
           document.body?.innerText?.includes('Reconnecting');
  }, { timeout: 15000 }).catch(() => false);
  
  await page2.waitForTimeout(5000); // Give time for RPC
  
  const bodyText = await page2.evaluate(() => document.body?.innerText?.substring(0, 400));
  console.log('[2] Body text:', bodyText?.replace(/\n/g, ' | ')?.substring(0, 200));
  
  const hasSessionList = bodyText?.includes('Sessions') || bodyText?.includes('active');
  const hasPairing = bodyText?.includes('PIN') || bodyText?.includes('pairing') || bodyText?.includes('Connect');
  
  if (hasSessionList && !hasPairing) {
    console.log('[PASS] Auto-reconnect worked! Sessions visible without pairing.');
  } else if (bodyText?.includes('Reconnecting')) {
    console.log('[PARTIAL] Reconnecting shown but sessions not loaded yet');
  } else {
    console.log('[FAIL] Auto-reconnect did not work. Pairing screen shown.');
  }
  
  await browser.close();
  process.exit(hasSessionList ? 0 : 1);
}
main();
