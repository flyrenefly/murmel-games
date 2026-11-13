// Accounts in the game: talks to /api/konto (server/src/konten.ts). Everything is optional – without
// an account, or offline, the game plays as before; account calls then report "nicht erreichbar".

export interface Konto {
  email: string;
  rolle: 'player' | 'admin';
  /** Von einem Admin gesperrt: anmelden und löschen geht, schreiben (z. B. im Forum) nicht. */
  gesperrt?: boolean;
  erstellt: string;
  passkeys: { id: string; name: string; erstellt: string; zuletzt: string | null }[];
}

export type KontoStand = { angemeldet: false; mail?: boolean } | { angemeldet: true; mail?: boolean; konto: Konto };

/** Result of an account call: data, or a message that can be shown as it is. */
export type Ergebnis<T> = { ok: true; daten: T } | { ok: false; fehler: string; status: number };

export const OFFLINE = 'Das Konto ist gerade nicht erreichbar. Spielen geht trotzdem – auch ohne Konto.';

/** The one-time token from a mail link (https://murmel.games/#anmelden=…), or null. */
export function loginTokenFromHash(hash: string): string | null {
  const m = /^#anmelden=([A-Za-z0-9_-]{20,100})$/.exec(hash);
  return m ? m[1] : null;
}

type Fetch = typeof fetch;

/** Account API client; base and fetch are replaceable for tests. */
export class KontoApi {
  private readonly base: string;
  private readonly fetchFn: Fetch;

  constructor(base = '/api/konto', fetchFn: Fetch = (...a) => fetch(...a)) {
    this.base = base;
    this.fetchFn = fetchFn;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<Ergebnis<T>> {
    let res: Response;
    try {
      res = await this.fetchFn(this.base + path, {
        method,
        credentials: 'same-origin',
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      return { ok: false, fehler: OFFLINE, status: 0 };
    }
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      /* no JSON (e.g. the static emergency copy without API) */
    }
    if (res.ok && data !== null) return { ok: true, daten: data as T };
    const msg = (data as { error?: unknown } | null)?.error;
    // 404/HTML: no API behind this address (IONOS emergency copy, local preview)
    if (typeof msg !== 'string' || res.status === 404) return { ok: false, fehler: OFFLINE, status: res.status };
    return { ok: false, fehler: msg, status: res.status };
  }

  stand() {
    return this.call<KontoStand>('GET', '');
  }
  linkSchicken(email: string) {
    return this.call<{ ok: true }>('POST', '/mail', { email });
  }
  linkEinloesen(token: string) {
    return this.call<KontoStand>('POST', '/mail/einloesen', { token });
  }
  passkeyStart() {
    return this.call<{ vorgang: string; optionen: unknown }>('POST', '/passkey/registrieren', {});
  }
  passkeyAbschliessen(vorgang: string, antwort: unknown) {
    return this.call<KontoStand>('POST', '/passkey/registrieren/abschliessen', { vorgang, antwort });
  }
  anmeldenStart() {
    return this.call<{ vorgang: string; optionen: unknown }>('POST', '/passkey/anmelden', {});
  }
  anmeldenAbschliessen(vorgang: string, antwort: unknown) {
    return this.call<KontoStand>('POST', '/passkey/anmelden/abschliessen', { vorgang, antwort });
  }
  passkeyEntfernen(id: string) {
    return this.call<KontoStand>('DELETE', `/passkey/${encodeURIComponent(id)}`);
  }
  abmelden(alle = false) {
    return this.call<KontoStand>('POST', '/abmelden', { alle });
  }
  loeschen() {
    return this.call<KontoStand>('DELETE', '');
  }
}

/** Message for a failed or cancelled passkey prompt of the browser. */
export function passkeyFehler(err: unknown): string {
  const name = (err as { name?: string } | null)?.name;
  if (name === 'NotAllowedError' || name === 'AbortError') return 'Abgebrochen. Du kannst es jederzeit noch einmal versuchen.';
  if (name === 'InvalidStateError') return 'Auf diesem Gerät gibt es schon einen Passkey für Murmel.';
  return 'Der Passkey hat gerade nicht geklappt. Du kannst dich weiter per Mail-Link anmelden.';
}

export const passkeysMoeglich = (): boolean => typeof window !== 'undefined' && 'PublicKeyCredential' in window;
