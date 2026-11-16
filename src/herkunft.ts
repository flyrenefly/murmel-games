/**
 * Herkunft (docs/SPEC-herkunft.md): from which site a visitor came. On the first page view of a browser
 * tab session the page sends only the host name of a foreign referrer – no path, no query, no id – and
 * the campaign mark of its own address (`?von=google`, from our ads and posts) to POST /api/herkunft. A
 * marker in sessionStorage (gone when the tab closes) keeps further pages and reloads from counting
 * again. Nothing is sent without a foreign referrer or a campaign, without sessionStorage, or when the
 * statistics are off (switch, Do Not Track, Global Privacy Control, development). The campaign mark is
 * always removed from the address bar, so it is not shared or bookmarked.
 */
import { browserEnv, statsAllowed } from './stats';

export interface HerkunftEnv {
  referrer: string;
  /** The page's own host name. */
  hostname: string;
  /** The page's address (location.href). */
  adresse: string;
  /** history.replaceState with a path, query and hash. */
  adresseErsetzen(url: string): void;
  erlaubt(): boolean;
  /** This tab session already counted (or decided not to). */
  gemeldet(): boolean;
  /** Marks the session; false when the browser cannot store it. */
  merken(): boolean;
  /** sendBeacon: true when the browser took the request. */
  senden(url: string, body: string): boolean;
}

const OWN = 'murmel.games';
const KEY = 'murmel.herkunft';
const VON = /^[a-z0-9-]{1,32}$/;

/** The campaign of an address (`?von=`, lower case, null when invalid) and, when the address has the
 * parameter at all, the address without it (path, query, hash); otherwise ohneVon is null. */
export function kampagne(adresse: string): { von: string | null; ohneVon: string | null } {
  let url: URL;
  try {
    url = new URL(adresse);
  } catch {
    return { von: null, ohneVon: null };
  }
  if (!url.searchParams.has('von')) return { von: null, ohneVon: null };
  const v = (url.searchParams.get('von') ?? '').toLowerCase();
  url.searchParams.delete('von');
  return { von: VON.test(v) ? v : null, ohneVon: url.pathname + url.search + url.hash };
}

/** The referrer's host name when it is a foreign web page, else null. */
export function fremdeDomain(referrer: string, hostname: string): string | null {
  let url: URL;
  try {
    url = new URL(referrer);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host === hostname.toLowerCase() || host === 'localhost' || host === OWN || host.endsWith(`.${OWN}`)) return null;
  return host;
}

/** Counts the origin once per tab session; removes the campaign mark from the address bar. */
export function herkunftMelden(env: HerkunftEnv): void {
  try {
    const { von, ohneVon } = kampagne(env.adresse);
    if (ohneVon !== null) env.adresseErsetzen(ohneVon);
    if (env.gemeldet() || !env.merken() || !env.erlaubt()) return;
    const domain = fremdeDomain(env.referrer, env.hostname);
    if (domain || von) env.senden('/api/herkunft', JSON.stringify({ ...(domain ? { domain } : {}), ...(von ? { von } : {}) }));
  } catch {
    // statistics never disturb the page
  }
}

/** The browser's version: document.referrer, sessionStorage and sendBeacon. */
export function browserHerkunft(): HerkunftEnv {
  return {
    referrer: document.referrer,
    hostname: location.hostname,
    adresse: location.href,
    adresseErsetzen: (url) => history.replaceState(history.state, '', url),
    erlaubt: () => statsAllowed(browserEnv()),
    gemeldet: () => {
      try {
        return sessionStorage.getItem(KEY) === '1';
      } catch {
        return true;
      }
    },
    merken: () => {
      try {
        sessionStorage.setItem(KEY, '1');
        return true;
      } catch {
        return false;
      }
    },
    senden: (url, body) => navigator.sendBeacon?.(url, new Blob([body], { type: 'application/json' })) ?? false,
  };
}
