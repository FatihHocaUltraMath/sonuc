/* FatihHoca | UltraMat — Öğrenci Takip · servis çalışanı (sürüm 0.4)
 * İnternet varken her dosya her zaman sunucudan TAZE alınır (güncellemeler hemen gelir);
 * internet yokken son alınan kopya açılır. Kayıtlar (Google'a giden istekler) buraya hiç uğramaz. */
const ONBELLEK = "fhTakip-sayfa-v1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", e => {
  const istek = e.request;
  if (istek.method !== "GET" || new URL(istek.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(istek)
      .then(yanit => {
        if (yanit.ok) { const kopya = yanit.clone(); caches.open(ONBELLEK).then(c => c.put(istek, kopya)); }
        return yanit;
      })
      .catch(() => caches.match(istek).then(m => m || caches.match("./")))
  );
});
