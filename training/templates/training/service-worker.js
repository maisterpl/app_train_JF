// No personal HTML/API responses are cached. Workout data lives in IndexedDB.
const CACHE = 'sila-kolarza-shell-{{ asset_version }}';
const SHELL = '/static/training/offline.html';
const ASSETS = [SHELL, '/static/training/style.css', '/static/training/workout.js', '/static/training/pwa.js', '/static/training/icon.svg', '/manifest.webmanifest'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS.map(url => new Request(url, {cache: 'reload'})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('sila-kolarza-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate' && (url.pathname === '/' || /^\/workouts\/[0-9a-f-]{36}\/$/i.test(url.pathname))) {
    event.respondWith(fetch(event.request).catch(() => caches.match(SHELL)));
    return;
  }
  if (ASSETS.includes(url.pathname)) {
    event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      if (response.ok) { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, copy)); }
      return response;
    })));
  }
});
