/* FatihHoca | UltraMat — Öğrenci Takip · servis çalışanı (sürüm 0.12)
 * İnternet varken her dosya her zaman sunucudan TAZE alınır (güncellemeler hemen gelir);
 * internet yokken son alınan kopya açılır. Kayıtlar (Google'a giden istekler) buraya hiç uğramaz.
 * 0.12: odev-formu.js de aynı yolla saklanır (bir kez açılan Ödev Takip Formu internetsiz de açılır). */
const ONBELLEK = "fhTakip-sayfa-v8";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(adlar => Promise.all(adlar.filter(a => a !== ONBELLEK).map(a => caches.delete(a)))).then(() => self.clients.claim())));
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
