// Vorladen (docs/LASTTEST.md, „Erstbesuch verkleinern“): the service worker precaches only the
// graphics set of the active style. The page tells it which one (Cache Storage, like the language in
// src/i18n.ts) and asks it to load another set when the player switches style.
import { SW_CACHE } from './i18n';
import { classicSet, type StyleId } from './render/styles';
import type { Grafiksatz } from './vorladen-listen';

/** Remembers the set for the next service worker install (sw-template.js reads 'grafiksatz'). */
export async function satzMerken(satz: Grafiksatz): Promise<void> {
  try {
    if (typeof caches === 'undefined') return;
    const c = await caches.open(SW_CACHE);
    await c.put('grafiksatz', new Response(satz, { headers: { 'Content-Type': 'text/plain' } }));
  } catch {
    /* no Cache Storage: the service worker takes the default set */
  }
}

/**
 * Asks the active service worker whether a set is complete in its cache; with `laden` it fetches what
 * is missing first. true: complete, false: not complete (offline), null: unknown (no service worker,
 * an older one without this message, or no answer in time).
 */
export async function satzFragen(satz: Grafiksatz, laden: boolean, ms = laden ? 120_000 : 1500): Promise<boolean | null> {
  try {
    const sw = (await navigator.serviceWorker?.getRegistration())?.active;
    if (!sw) return null;
    return await new Promise<boolean | null>((resolve) => {
      const kanal = new MessageChannel();
      const uhr = setTimeout(() => resolve(null), ms);
      kanal.port1.onmessage = (e) => {
        clearTimeout(uhr);
        const fertig = (e.data as { fertig?: unknown } | null)?.fertig;
        resolve(typeof fertig === 'boolean' ? fertig : null);
      };
      sw.postMessage({ murmel: 'grafiksatz', satz, laden }, [kanal.port2]);
    });
  } catch {
    return null;
  }
}

export interface StilWahl {
  stil: StyleId;
  /** Styles passed over because their set is not cached and the browser is offline. */
  uebersprungen: StyleId[];
  /** The set to fetch in the background for the chosen style (not cached yet, online). */
  nachladen: Grafiksatz | null;
}

/**
 * The next style after `aktuell` in `order`. A classic style whose set is known to be missing
 * (`bereit[set] === false`) is skipped while offline; online it is chosen and its set fetched.
 */
export function stilWahl(order: readonly StyleId[], aktuell: StyleId, bereit: Partial<Record<Grafiksatz, boolean | null>>, online: boolean): StilWahl {
  const uebersprungen: StyleId[] = [];
  const start = order.indexOf(aktuell);
  for (let i = 1; i <= order.length; i++) {
    const stil = order[(start + i) % order.length];
    const satz = classicSet(stil);
    const fehlt = satz !== null && bereit[satz] === false;
    if (fehlt && !online) {
      if (stil !== aktuell) uebersprungen.push(stil);
      continue;
    }
    return { stil, uebersprungen, nachladen: fehlt ? satz : null };
  }
  return { stil: aktuell, uebersprungen, nachladen: null };
}
