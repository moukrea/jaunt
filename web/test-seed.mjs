import { chromium } from 'playwright';
import { execSync } from 'child_process';

const BASE = 'http://localhost:5173';
const PROFILE_URL = execSync("grep -o 'http://localhost:5173/#[^ ]*' /tmp/jaunt-host.log | tail -1", { encoding: 'utf-8' }).trim();

async function main() {
  // First, restart the host to get a fresh QR
  execSync('pkill -f "jaunt-host serve" || true');
  await new Promise(r => setTimeout(r, 1000));
  execSync('cd /home/emeric/code/jaunt && nohup ./target/release/jaunt-host serve > /tmp/jaunt-host.log 2>&1 &');
  await new Promise(r => setTimeout(r, 2000));
  const freshUrl = execSync("grep -o 'http://localhost:5173/#[^ ]*' /tmp/jaunt-host.log | tail -1", { encoding: 'utf-8' }).trim();
  console.log('Fresh URL:', freshUrl.substring(0, 80) + '...');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', msg => {
    if (msg.text().includes('[jaunt]') || msg.text().includes('[DIAG]')) {
      console.log(`[${msg.type()}] ${msg.text()}`);
    }
  });
  page.on('pageerror', err => console.log(`[ERROR] ${err.message}`));

  // Inject diagnostic before the page loads
  await page.addInitScript(() => {
    // Monkey-patch to diagnose the save issue
    const origSetItem = localStorage.setItem;
    window.__diagLogs = [];
  });

  await page.goto(freshUrl, { waitUntil: 'networkidle' });

  // Wait for connection
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(1000);
    const body = await page.textContent('body');
    if (body?.includes('Sessions')) {
      console.log('Connected at ' + (i + 1) + 's');
      break;
    }
  }

  // Now diagnose the libp2pPrivateKeySeed issue
  const diag = await page.evaluate(async () => {
    // Access the cairn module's exported getNode()
    // We need to use the app's internal state
    const results = {};

    // Check IndexedDB
    const checkIDB = () => new Promise((resolve) => {
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

    results.savedConnection = await checkIDB();

    // List all keys in IndexedDB
    const listKeys = () => new Promise((resolve) => {
      const req = indexedDB.open('keyval-store');
      req.onsuccess = () => {
        const db = req.result;
        try {
          const tx = db.transaction('keyval', 'readonly');
          const store = tx.objectStore('keyval');
          const keysReq = store.getAllKeys();
          keysReq.onsuccess = () => resolve(keysReq.result);
          keysReq.onerror = () => resolve([]);
        } catch (e) {
          resolve({ error: e.message });
        }
      };
      req.onerror = () => resolve([]);
    });

    results.allKeys = await listKeys();

    return results;
  });

  console.log('\nDiagnostics:');
  console.log('  All IndexedDB keys:', JSON.stringify(diag.allKeys));
  console.log('  Saved connection:', diag.savedConnection ? 'EXISTS' : 'MISSING');
  if (diag.savedConnection) {
    console.log('  Details:', JSON.stringify(diag.savedConnection, null, 2).substring(0, 300));
  }

  // Wait a bit more to see if save happens after a delay
  await page.waitForTimeout(3000);

  const diag2 = await page.evaluate(async () => {
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

  console.log('\nAfter 3s delay:');
  console.log('  Saved connection:', diag2 ? 'EXISTS' : 'STILL MISSING');

  await page.close();
  await context.close();
  await browser.close();
}

main().catch(e => {
  console.error('Test crashed:', e);
  process.exit(1);
});
