// Murmel service worker: plays offline (installable PWA). Generated into dist/sw.js by the
// offline plugin in vite.config.ts, which fills in VERSION, PRECACHE and SAETZE.
// - App shell, sounds: precached on install, served from the cache.
// - Classic graphics: only the set of the active style is precached (the page names it, src/vorladen.ts);
//   another set is fetched when the page asks for it (style switch), into the same versioned cache.
// - Pages (navigation): network first, cache when offline – new releases show up at once.
// - Level packs (levels/enigma/*.json): from the cache, refreshed in the background
//   (stale-while-revalidate); a pack is offline once it has been opened.
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const SAETZE = __SAETZE__;
const SHELL = `murmel-shell-${VERSION}`;
const LEVELS = 'murmel-levels';

const url = (p) => new URL(p, self.registration.scope).href;
// cache: 'reload' – past the HTTP cache, so a new release never stores an old file
const frisch = (p) => new Request(url(p), { cache: 'reload' });

/** The graphics set the page chose (src/vorladen.ts puts it into murmel-einstellungen); else "Klassisch". */
async function gewaehlterSatz() {
  try {
    const hit = await (await caches.open('murmel-einstellungen')).match(url('./grafiksatz'));
    const s = hit ? (await hit.text()).trim() : '';
    if (Object.hasOwn(SAETZE, s)) return s;
  } catch {
    /* no cache: the default set */
  }
  return 'gfx32';
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([caches.open(SHELL), gewaehlterSatz()])
      .then(([c, satz]) => c.addAll([...PRECACHE, ...SAETZE[satz]].map(frisch)))
      .then(() => self.skipWaiting()),
  );
});

/** Is the set complete in this version's cache? With `laden`, fetch what is missing first. */
async function satzSichern(satz, laden) {
  const c = await caches.open(SHELL);
  const da = new Set((await c.keys()).map((r) => r.url));
  const fehlt = SAETZE[satz].filter((p) => !da.has(url(p)));
  if (!fehlt.length) return true;
  if (!laden) return false;
  // one by one: offline or cut off, what arrived stays and the next try fetches only the rest
  const ok = await Promise.all(
    fehlt.map((p) =>
      fetch(frisch(p))
        .then((res) => res.ok && c.put(url(p), res).then(() => true))
        .catch(() => false),
    ),
  );
  return ok.every(Boolean);
}

// The page asks for a graphics set (style switch, start): { murmel: 'grafiksatz', satz, laden } with a
// MessagePort for the answer { fertig }.
self.addEventListener('message', (event) => {
  const d = event.data;
  if (!d || d.murmel !== 'grafiksatz' || !Object.hasOwn(SAETZE, d.satz)) return;
  const antwort = event.ports[0];
  event.waitUntil(
    satzSichern(d.satz, d.laden === true)
      .catch(() => false)
      .then((fertig) => antwort?.postMessage({ fertig })),
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

/**
 * The language the page chose (docs/SPEC-englisch.md): src/i18n.ts puts "de" or "en" into the cache
 * murmel-einstellungen; without it the browser's language (de* → German, else English).
 */
async function sprache() {
  try {
    const hit = await (await caches.open('murmel-einstellungen')).match(url('./sprache'));
    const s = hit ? (await hit.text()).trim() : '';
    if (s === 'de' || s === 'en') return s;
  } catch {
    /* no cache: the browser decides */
  }
  return /^de/i.test(self.navigator.language || 'de') ? 'de' : 'en';
}

// Erinnerung an das Tageslevel (docs/SPEC-webpush.md): the server sends { titel, text, url } at
// Berlin midnight, and the English text as { en: { titel, text } }. A newer reminder replaces an
// older one (same tag).
self.addEventListener('push', (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    /* not JSON: the default text */
  }
  const ziel = new URL(typeof d.url === 'string' ? d.url : './#tageslevel', self.registration.scope);
  event.waitUntil(
    sprache().then((lang) => {
      const t = lang === 'en' && d.en && typeof d.en === 'object' ? d.en : d;
      return self.registration.showNotification(typeof t.titel === 'string' ? t.titel : 'Murmel', {
        body: typeof t.text === 'string' ? t.text : lang === 'en' ? 'New daily level' : 'Neues Tageslevel',
        tag: 'murmel-tageslevel',
        lang,
        data: { url: ziel.origin === self.location.origin ? ziel.href : url('./#tageslevel') },
      });
    }),
  );
});

// A click opens today's level: in a window of the game if one is open, otherwise in a new one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const ziel = event.notification.data?.url ?? url('./#tageslevel');
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (list) => {
      const start = new URL(url('./')).pathname;
      const spiel = list.find((c) => [start, `${start}index.html`, `${start}en/`, `${start}en/index.html`].includes(new URL(c.url).pathname));
      if (spiel) {
        await spiel.focus();
        spiel.postMessage({ murmel: 'tageslevel' });
        return;
      }
      await self.clients.openWindow(ziel);
    }),
  );
});
