// Erinnerung an das Tageslevel per Web Push (docs/SPEC-webpush.md): whether this browser can get
// reminders, subscribing and unsubscribing, the texts. No account needed: one subscription per browser.
// The permission is asked only after the player switches a reminder on, never on load.

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
const netz: Fetch = (...a) => fetch(...a);

/** What the player chose; both false = no reminder. */
export interface Wahl {
  tag: boolean;
  woche: boolean;
}
export const AUS: Wahl = { tag: false, woche: false };

/**
 * - `bereit`: the browser can subscribe
 * - `ios-browser`: iPhone/iPad in Safari: only the Home Screen app gets push (hint instead of switches)
 * - `nein`: no push in this browser (the row is not shown)
 */
export type Moeglich = 'bereit' | 'ios-browser' | 'nein';

export interface Umgebung {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  /** navigator.standalone (Safari) or display-mode standalone/fullscreen. */
  standalone: boolean;
  serviceWorker: boolean;
  pushManager: boolean;
  notification: boolean;
}

export function istIOS(u: Pick<Umgebung, 'userAgent' | 'platform' | 'maxTouchPoints'>): boolean {
  // iPadOS reports itself as a Mac; touch points give it away
  return /iPhone|iPad|iPod/.test(u.userAgent) || (u.platform === 'MacIntel' && u.maxTouchPoints > 1);
}

export function moeglich(u: Umgebung): Moeglich {
  if (u.serviceWorker && u.pushManager && u.notification) return 'bereit';
  if (istIOS(u) && !u.standalone) return 'ios-browser';
  return 'nein';
}

export function umgebung(): Umgebung {
  const nav = navigator as Navigator & { standalone?: boolean };
  return {
    userAgent: nav.userAgent,
    platform: nav.platform,
    maxTouchPoints: nav.maxTouchPoints ?? 0,
    standalone: nav.standalone === true || matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches,
    serviceWorker: 'serviceWorker' in nav,
    pushManager: typeof PushManager !== 'undefined',
    notification: typeof Notification !== 'undefined',
  };
}

/** The server's public key, or null when reminders are off there (or offline). */
export async function schluesselLaden(fetchFn: Fetch = netz): Promise<string | null> {
  try {
    const res = await fetchFn('/api/push', { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as { schluessel?: unknown };
    return typeof data.schluessel === 'string' && /^[\w-]{80,100}$/.test(data.schluessel) ? data.schluessel : null;
  } catch {
    return null;
  }
}

export function schluesselBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64url.length % 4)) % 4);
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function gleicherSchluessel(a: ArrayBuffer | null, schluessel: string): boolean {
  if (!a) return true; // browsers without options: keep it
  const b = schluesselBytes(schluessel);
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

/** Sends the subscription and choice to the server; true when it took it. */
export async function aboSenden(sub: PushSubscriptionJSON, wahl: Wahl, fetchFn: Fetch = netz): Promise<boolean> {
  try {
    const res = await fetchFn('/api/push/abo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint, keys: sub.keys, tag: wahl.tag, woche: wahl.woche }),
    });
    return res.status === 204;
  } catch {
    return false;
  }
}

export async function aboLoeschen(endpoint: string, fetchFn: Fetch = netz): Promise<void> {
  try {
    await fetchFn('/api/push/abo', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint }) });
  } catch {
    /* offline: the push service answers 410 once the browser dropped it */
  }
}

export type Ergebnis = 'ok' | 'verweigert' | 'fehler';

interface Teile {
  /** Notification.requestPermission – must be the first call in the click handler (Safari). */
  erlaubnis: () => Promise<NotificationPermission>;
  registrierung: () => Promise<ServiceWorkerRegistration | undefined>;
  fetchFn?: Fetch;
}

/**
 * Applies a new choice: asks for the permission if needed, subscribes and tells the server; with
 * nothing chosen it unsubscribes. Call it straight from the click (permission prompt).
 */
export async function wahlAnwenden(wahl: Wahl, schluessel: string, t: Teile): Promise<Ergebnis> {
  if (!wahl.tag && !wahl.woche) {
    const reg = await t.registrierung().catch(() => undefined);
    const sub = await reg?.pushManager.getSubscription().catch(() => null);
    if (sub) {
      await aboLoeschen(sub.endpoint, t.fetchFn);
      await sub.unsubscribe().catch(() => false);
    }
    return 'ok';
  }
  const erlaubt = await t.erlaubnis().catch(() => 'denied' as const);
  if (erlaubt !== 'granted') return 'verweigert';
  try {
    const reg = await t.registrierung();
    if (!reg) return 'fehler';
    let sub = await reg.pushManager.getSubscription();
    // the server has new keys: the old subscription would never get a message
    if (sub && !gleicherSchluessel(sub.options?.applicationServerKey ?? null, schluessel)) {
      await sub.unsubscribe().catch(() => false);
      sub = null;
    }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: schluesselBytes(schluessel) });
    return (await aboSenden(sub.toJSON(), wahl, t.fetchFn)) ? 'ok' : 'fehler';
  } catch {
    return 'fehler';
  }
}

/** The state in the list row. */
export function standText(w: Wahl): string {
  if (w.tag && w.woche) return 'Täglich und Wochenaufgabe';
  if (w.tag) return 'Täglich';
  if (w.woche) return 'Wochenaufgabe';
  return 'Aus';
}

export const IOS_HINWEIS = 'Auf iPhone und iPad gibt es Erinnerungen nur, wenn Murmel auf dem Home-Bildschirm liegt: im Teilen-Menü „Zum Home-Bildschirm“ wählen und Murmel von dort öffnen.';
export const VERWEIGERT_HINWEIS = 'Mitteilungen sind für Murmel blockiert. Du kannst sie in den Website-Einstellungen des Browsers wieder erlauben.';
