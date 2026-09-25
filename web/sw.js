// precache:begin
const CACHE = 'jaunt-static-a1300b964fa7f537';
const STATIC = ["./","./assets/app-icon-192.png","./assets/app-icon-512.png","./assets/favicon.png","./assets/jaunt.png","./index.html","./js/activity.mjs","./js/app.mjs","./js/channels.mjs","./js/crypto.mjs","./js/desktop.mjs","./js/i18n.mjs","./js/icons.mjs","./js/link.mjs","./js/native.mjs","./js/push.mjs","./js/qr.mjs","./js/scrollback.mjs","./js/sha256.mjs","./js/touch-scroll.mjs","./js/transfers.mjs","./js/ui.mjs","./js/vault.mjs","./js/workspace.mjs","./locales/de.json","./locales/en.json","./locales/es.json","./locales/fr.json","./locales/it.json","./locales/pt.json","./manifest.webmanifest","./style.css","./vendor/fonts/JetBrainsMono-Bold.woff2","./vendor/fonts/JetBrainsMono-Regular.woff2","./vendor/fonts/SymbolsNerdFontMono-Regular.woff2","./vendor/jetbrains-mono.css","./vendor/jsqr.mjs","./vendor/lucide-all.mjs","./vendor/lucide.mjs","./vendor/meteor.mjs","./vendor/xterm.css","./vendor/xterm.mjs"];
// precache:end
const base = new URL('./', self.location.href);
const resources = new Set(STATIC.map(path => new URL(path, base).href));
self.addEventListener('install', event => event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);await cache.addAll(STATIC);await self.skipWaiting();
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const name of await caches.keys()) if (name.startsWith('jaunt-static-') && name !== CACHE) await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match(new URL('./index.html', base)))); return;
  }
  if (resources.has(url.href)) event.respondWith(caches.match(request).then(response => response || fetch(request)));
});
self.addEventListener('message', event => { if (event.data?.type === 'activate-update') self.skipWaiting(); });
self.addEventListener('push', event => {
  let p = {}; try { p = event.data?.json() || {}; } catch {}
  event.waitUntil(self.registration.showNotification(String(p.title || 'jaunt').slice(0, 100), {
    body: String(p.body || 'Your machine needs your attention.').slice(0, 400),
    icon: new URL('./assets/jaunt.png', base).href, badge: new URL('./assets/jaunt.png', base).href,
    tag: String(p.tag || 'jaunt'), data: {host: String(p.host || ''), session: String(p.session || '')}
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const {host, session} = event.notification.data || {};
  const url = new URL('./', base); url.hash = new URLSearchParams({host: host || '', session: session || ''}).toString();
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({type: 'window', includeUncontrolled: true});
    const existing = list.find(c => new URL(c.url).origin === base.origin && new URL(c.url).pathname.startsWith(base.pathname));
    if (existing) { await existing.focus(); existing.postMessage({type: 'open-session', host, session}); }
    else await self.clients.openWindow(url.href);
  })());
});
