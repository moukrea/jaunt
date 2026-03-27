import { chromium } from 'playwright';
import { execSync } from 'child_process';

const BASE = 'http://localhost:5173';

// Get fresh profile URL from the host log
const PROFILE_URL = execSync("grep -o 'http://localhost:5173/#[^ ]*' /tmp/jaunt-host.log | tail -1", { encoding: 'utf-8' }).trim();

if (!PROFILE_URL) {
  console.error('No profile URL found in /tmp/jaunt-host.log');
  process.exit(1);
}

console.log('Profile URL:', PROFILE_URL.substring(0, 80) + '...');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  // ─── Phase 1: Connect via profile URL ───
  console.log('\n=== Phase 1: Connect via profile URL ===');
  const page1 = await context.newPage();
  const logs1 = [];

  page1.on('console', msg => {
    const text = `[P1][${msg.type()}] ${msg.text()}`;
    logs1.push(text);
    if (msg.text().includes('[jaunt]')) console.log(text);
  });
  page1.on('pageerror', err => {
    const text = `[P1][ERROR] ${err.message}`;
    logs1.push(text);
    console.log(text);
  });

  await page1.goto(PROFILE_URL, { waitUntil: 'networkidle' });

  // Wait for connection
  console.log('Waiting for connection to complete...');
  let connected = false;
  for (let i = 0; i < 30; i++) {
    await page1.waitForTimeout(1000);
    const bodyText = await page1.textContent('body');
    if (bodyText?.includes('Sessions') || bodyText?.includes('New Session')) {
      connected = true;
      console.log('Connected! Reached session list at ' + (i + 1) + 's');
      break;
    }
    if (i % 5 === 4) console.log(`  Still waiting... (${i + 1}s)`);
  }

  if (!connected) {
    console.log('FAILED to connect within 30s');
    console.log('\nAll Phase 1 logs:');
    for (const l of logs1) console.log(l);
    await browser.close();
    process.exit(1);
  }

  // Check what was saved to IndexedDB
  const savedConn = await page1.evaluate(async () => {
    return new Promise((resolve) => {
      const req = indexedDB.open('keyval-store');
      req.onsuccess = () => {
        const db = req.result;
        try {
          const tx = db.transaction('keyval', 'readonly');
          const store = tx.objectStore('keyval');
          const getReq = store.get('jaunt:connection');
          getReq.onsuccess = () => resolve(getReq.result || null);
          getReq.onerror = () => resolve({ error: 'get failed' });
        } catch (e) {
          resolve({ error: e.message });
        }
      };
      req.onerror = () => resolve({ error: 'open failed' });
    });
  });

  console.log('\nSaved connection in IndexedDB:', savedConn ? 'YES' : 'NO');
  if (savedConn && !savedConn.error) {
    console.log('  hostName:', savedConn.hostName);
    console.log('  hostLibp2pPeerId:', savedConn.hostLibp2pPeerId?.substring(0, 20) + '...');
    console.log('  hostAddrs count:', savedConn.hostAddrs?.length);
    console.log('  libp2pSeed length:', savedConn.libp2pSeed?.length);
    console.log('  sessionId:', savedConn.sessionId ? savedConn.sessionId.substring(0, 16) + '...' : 'MISSING');
    console.log('  connectedAt:', new Date(savedConn.connectedAt).toISOString());
  } else {
    console.log('  ERROR: No saved connection!', JSON.stringify(savedConn));
    console.log('\nAll Phase 1 logs:');
    for (const l of logs1) console.log(l);
    await browser.close();
    process.exit(1);
  }

  // Close page1 (simulates closing the tab)
  await page1.close();
  console.log('\nPhase 1 complete. Page closed.\n');

  // ─── Phase 2: Open base URL - should auto-reconnect ───
  console.log('=== Phase 2: Open base URL (no fragment) ===');
  const page2 = await context.newPage();
  const logs2 = [];

  page2.on('console', msg => {
    const text = `[P2][${msg.type()}] ${msg.text()}`;
    logs2.push(text);
    if (msg.text().includes('[jaunt]')) console.log(text);
  });
  page2.on('pageerror', err => {
    const text = `[P2][ERROR] ${err.message}`;
    logs2.push(text);
    console.log(text);
  });

  await page2.goto(BASE, { waitUntil: 'networkidle' });

  // Check if IndexedDB still has the saved connection
  const savedConn2 = await page2.evaluate(async () => {
    return new Promise((resolve) => {
      const req = indexedDB.open('keyval-store');
      req.onsuccess = () => {
        const db = req.result;
        try {
          const tx = db.transaction('keyval', 'readonly');
          const store = tx.objectStore('keyval');
          const getReq = store.get('jaunt:connection');
          getReq.onsuccess = () => resolve(getReq.result || null);
          getReq.onerror = () => resolve(null);
        } catch (e) {
          resolve({ error: e.message });
        }
      };
      req.onerror = () => resolve(null);
    });
  });
  console.log('\nIndexedDB still has saved connection:', savedConn2 ? 'YES' : 'NO');

  // Wait for reconnect attempt
  console.log('Waiting for reconnect...');
  let reconnected = false;
  for (let i = 0; i < 30; i++) {
    await page2.waitForTimeout(1000);
    const bodyText = await page2.textContent('body');
    if (bodyText?.includes('Sessions') || bodyText?.includes('New Session')) {
      reconnected = true;
      console.log('RECONNECTED! Reached session list at ' + (i + 1) + 's');
      break;
    }
    // Check if we're stuck on pairing screen
    if (bodyText?.includes('Enter the PIN') && i > 10) {
      console.log('STUCK on pairing screen after ' + (i + 1) + 's');
      break;
    }
    if (i % 5 === 4) console.log(`  Still waiting... (${i + 1}s)`);
  }

  if (!reconnected) {
    const bodyText = await page2.textContent('body');
    console.log('\nFAILED to reconnect. Page shows:');
    console.log(bodyText?.substring(0, 300));
  }

  // Check IndexedDB after reconnect attempt
  const savedConn3 = await page2.evaluate(async () => {
    return new Promise((resolve) => {
      const req = indexedDB.open('keyval-store');
      req.onsuccess = () => {
        const db = req.result;
        try {
          const tx = db.transaction('keyval', 'readonly');
          const store = tx.objectStore('keyval');
          const getReq = store.get('jaunt:connection');
          getReq.onsuccess = () => resolve(getReq.result || null);
          getReq.onerror = () => resolve(null);
        } catch (e) {
          resolve({ error: e.message });
        }
      };
      req.onerror = () => resolve(null);
    });
  });
  console.log('\nIndexedDB after reconnect attempt:', savedConn3 ? 'STILL EXISTS' : 'CLEARED');

  console.log('\n=== All Phase 2 console logs ===');
  for (const l of logs2) console.log(l);

  await page2.close();
  await context.close();
  await browser.close();

  console.log('\n=== RESULT ===');
  console.log(reconnected ? 'PASS: Auto-reconnect works' : 'FAIL: Auto-reconnect broken');
  process.exit(reconnected ? 0 : 1);
}

main().catch(e => {
  console.error('Test crashed:', e);
  process.exit(1);
});
