/**
 * Herkunft (docs/SPEC-herkunft.md): from which site a visitor came. On the first page view of a browser
 * tab session the page sends only the host name of a foreign referrer – no path, no query, no id – to
 * POST /api/herkunft. A marker in sessionStorage (gone when the tab closes) keeps further pages and
 * reloads from counting again. Nothing is sent without a foreign referrer, without sessionStorage, or
 * when the statistics are off (switch, Do Not Track, Global Privacy Control, development).
 */
import { browserEnv, statsAllowed } from './stats';

export interface HerkunftEnv {
  referrer: string;
  /** The page's own host name. */
  hostname: string;
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

/** Counts the origin once per tab session. */
export function herkunftMelden(env: HerkunftEnv): void {
  try {
    if (env.gemeldet() || !env.merken() || !env.erlaubt()) return;
    const domain = fremdeDomain(env.referrer, env.hostname);
    if (domain) env.senden('/api/herkunft', JSON.stringify({ domain }));
  } catch {
    // statistics never disturb the page
  }
}

/** The browser's version: document.referrer, sessionStorage and sendBeacon. */
export function browserHerkunft(): HerkunftEnv {
  return {
    referrer: document.referrer,
    hostname: location.hostname,
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
