/* Wimo · service worker
   Gör att Wimo kan installeras som app på datorn och mobilen.
   Hämtar alltid senaste versionen från nätet först; cachen används bara när nätet saknas,
   så en uppladdad ny version syns direkt. Firebase och andra adresser rörs inte. */
const CACHE = "wimo-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
    e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
        .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
    const req = e.request;
    if (req.method !== "GET") return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;
    e.respondWith(
        fetch(req).then((svar) => {
            if (svar && svar.ok && svar.type === "basic") {
                const kopia = svar.clone();
                caches.open(CACHE).then((c) => c.put(req, kopia)).catch(() => { });
            }
            return svar;
        }).catch(() => caches.match(req, { ignoreSearch: req.mode === "navigate" })
            .then((t) => t || (req.mode === "navigate" ? caches.match("./", { ignoreSearch: true }) : undefined))
            .then((t) => t || new Response("Wimo är offline och sidan finns inte sparad än.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })))
    );
});
