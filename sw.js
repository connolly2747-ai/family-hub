// Minimal service worker: network-first for the app shell (so updates arrive immediately),
// cache fallback so the shell still opens offline. Data requests are never cached.
const CACHE = "family-hub-shell-v5";
const SHELL = ["/", "/index.html", "/styles.css", "/js/app.js", "/js/api.js", "/js/config.js", "/js/categories.js", "/js/dates.js", "/js/sw-register.js", "/manifest.webmanifest", "/icons/icon-192.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return; // Supabase + CDN go straight to network
  e.respondWith(fetch(e.request).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; }).catch(() => caches.match(e.request).then((r) => r || caches.match("/index.html"))));
});

// ---- Web Push: lock-screen alerts and the app-icon badge ----
self.addEventListener("push", (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { title: "Family Hub", body: e.data ? e.data.text() : "" }; }
  e.waitUntil((async () => {
    await self.registration.showNotification(d.title || "Family Hub", { body: d.body || "", icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", tag: d.id || undefined, data: { target: d.target || "home" } });
    try { if (self.navigator && self.navigator.setAppBadge && typeof d.unread === "number") await self.navigator.setAppBadge(d.unread); } catch {}
  })());
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.target) || "home";
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) { if ("focus" in w) { w.postMessage({ type: "go", target }); return w.focus(); } }
    return self.clients.openWindow("/?go=" + encodeURIComponent(target));
  })());
});
