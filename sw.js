// Basit servis çalışanı: önce ağdan al (her zaman güncel kod), internet yoksa son bilinen sayfayı göster.
// Android'de "Paylaş → SC İhtiyaç" ve ana ekrana yükleme için gerekli.
const CACHE = "sc-v1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); return res; })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match("./", { ignoreSearch: true })))
  );
});
