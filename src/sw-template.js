// Murmel service worker: plays offline (installable PWA). Generated into dist/sw.js by the
// offline plugin in vite.config.ts, which fills in VERSION and PRECACHE.
// - App shell, graphics, sounds: precached on install, served from the cache.
// - Pages (navigation): network first, cache when offline – new releases show up at once.
// - Level packs (levels/enigma/*.json): from the cache, refreshed in the background
//   (stale-while-revalidate); a pack is offline once it has been opened.
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const SHELL = `murmel-shell-${VERSION}`;
const LEVELS = 'murmel-levels';

const url = (p) => new URL(p, self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      // cache: 'reload' – past the HTTP cache, so a new release never stores an old file
      .then((c) => c.addAll(PRECACHE.map((p) => new Request(url(p), { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('murmel-shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    // Network first; offline the cached page (or the game page for unknown paths)
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(SHELL).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(async () => (await caches.match(req, { ignoreSearch: true, ignoreVary: true })) ?? (await caches.match(url('./'), { ignoreVary: true })) ?? Response.error()),
    );
    return;
  }
  if (/\/levels\/.*\.json$/.test(new URL(req.url).pathname)) {
    event.respondWith(
      caches.open(LEVELS).then(async (c) => {
        const cached = await c.match(req, { ignoreSearch: true, ignoreVary: true });
        const fresh = fetch(req)
          .then((res) => {
            if (res.ok) c.put(req, res.clone());
            return res;
          })
          .catch(() => cached ?? Response.error());
        if (cached) {
          event.waitUntil(fresh.catch(() => {}));
          return cached;
        }
        return fresh;
      }),
    );
    return;
  }
  event.respondWith(caches.match(req, { ignoreSearch: true, ignoreVary: true }).then((hit) => hit ?? fetch(req)));
});
