// Minimal service worker: network-first for the app shell (so updates arrive immediately),
// cache fallback so the shell still opens offline. Data requests are never cached.
const CACHE = "family-hub-shell-v1";
const SHELL = ["/", "/index.html", "/styles.css", "/js/app.js", "/js/api.js", "/js/config.js", "/js/categories.js", "/js/dates.js", "/manifest.webmanifest", "/icons/icon-192.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // Supabase + CDN go straight to network
  e.respondWith(fetch(e.request).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; }).catch(() => caches.match(e.request).then((r) => r || caches.match("/index.html"))));
});
