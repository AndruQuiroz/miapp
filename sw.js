/* sw.js — Mi App: funciona sin señal.
   · Shell (mismo origen): red primero, si no hay señal sale del caché.
   · CDN (Chart.js en cdnjs, Google Fonts): caché primero.
   · NUNCA toca la nube (script.google.com / googleusercontent.com) ni métodos distintos de GET.
   Rutas relativas: la app vive en una subcarpeta (https://usuario.github.io/miapp/). */
const CACHE_VERSION = 'miapp-v2.0.0';
const SHELL = [
  './',
  'index.html',
  'core.js',
  'quick.js',
  'app.js',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png'
];
const CDN = /^https:\/\/(cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)\//;
const NUBE = /(^|\.)(script\.google\.com|googleusercontent\.com)$/;

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_VERSION)
      .then(c => Promise.all(SHELL.map(u => c.add(new Request(u, {cache: 'reload'})).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', e => {
  if(e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET') return;                 // POST de sync/capture: directo a la red
  let url;
  try { url = new URL(req.url); } catch(_) { return; }
  if(NUBE.test(url.hostname)) return;              // la nube nunca pasa por el caché
  if(url.origin === self.location.origin){
    e.respondWith(networkFirst(req));
  } else if(CDN.test(req.url)){
    e.respondWith(cacheFirst(req));
  }
});

async function networkFirst(req){
  const cache = await caches.open(CACHE_VERSION);
  try {
    const res = await fetch(req);
    if(res && res.ok) cache.put(req, res.clone());
    return res;
  } catch(err) {
    const hit = await cache.match(req, {ignoreSearch: true});
    if(hit) return hit;
    if(req.mode === 'navigate'){
      const shell = await cache.match('index.html') || await cache.match('./');
      if(shell) return shell;
    }
    throw err;
  }
}

async function cacheFirst(req){
  const cache = await caches.open(CACHE_VERSION);
  const hit = await cache.match(req);
  if(hit) return hit;
  const res = await fetch(req);
  if(res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
  return res;
}
