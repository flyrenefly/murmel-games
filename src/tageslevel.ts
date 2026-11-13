// Tageslevel und Wochenaufgabe im Spiel (docs/SPEC-tageslevel.md): which levels are today's and this
// week's, sending a won run to their rankings, the texts. Offline or without the API there are no tasks;
// the level itself plays like any other.
import type { Pruefung } from './bestenliste';
import type { Recording } from './game/session';

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
const netz: Fetch = (...a) => fetch(...a);

export type Art = 'tag' | 'woche';

/** A task as GET /api/tageslevel sends it; `zeit` in physics steps. */
export interface Aufgabe {
  art: Art;
  zeitraum: string;
  level: string;
  pack: string;
  index: number;
  titel: string;
  seed: number;
  bis: string;
  anzahl: number;
  top: { platz: number; name: string | null; zeit: number }[];
  ich: { platz: number; zeit: number } | null;
}

const istAufgabe = (a: unknown, art: Art): a is Aufgabe => {
  const x = a as Aufgabe;
  return !!x && x.art === art && typeof x.zeitraum === 'string' && typeof x.level === 'string' && typeof x.pack === 'string' && Number.isInteger(x.index) && typeof x.titel === 'string' && Number.isInteger(x.seed) && Number.isInteger(x.anzahl) && Array.isArray(x.top);
};

export async function aufgabenLaden(fetchFn: Fetch = netz): Promise<Partial<Record<Art, Aufgabe>> | null> {
  try {
    const res = await fetchFn('/api/tageslevel', { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    const out: Partial<Record<Art, Aufgabe>> = {};
    for (const art of ['tag', 'woche'] as const) if (istAufgabe(data[art], art)) out[art] = data[art];
    return out;
  } catch {
    return null; // offline or the static copy without API
  }
}

/** Sends a won run of the task; the id of the check (fetched like the leaderboard's) or a message. */
export async function einreichenAufgabe(rec: Recording, a: Aufgabe, version: string, fetchFn: Fetch = netz): Promise<{ id: string } | { fehler: string }> {
  try {
    const res = await fetchFn('/api/tageslevel/lauf', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...rec, art: a.art, zeitraum: a.zeitraum, version }),
    });
    const data = (await res.json().catch(() => null)) as { id?: unknown; error?: unknown } | null;
    if (res.status === 202 && typeof data?.id === 'string') return { id: data.id };
    return { fehler: typeof data?.error === 'string' && res.status !== 404 ? data.error : 'Tagesrangliste gerade nicht erreichbar.' };
  } catch {
    return { fehler: 'Tagesrangliste gerade nicht erreichbar.' };
  }
}

const NAME: Record<Art, string> = { tag: 'Tageslevel', woche: 'Wochenaufgabe' };

/** The line in the level list. */
export function listenZeile(a: Aufgabe, packTitel: string, zeit: (steps: number) => string): { titel: string; info: string } {
  const stand = a.ich ? `Platz ${a.ich.platz} von ${a.anzahl} · ${zeit(a.ich.zeit)}` : a.anzahl ? `${a.anzahl} ${a.anzahl === 1 ? 'Zeit' : 'Zeiten'}` : 'noch keine Zeiten';
  return { titel: `${a.art === 'tag' ? 'Heute' : 'Diese Woche'} · ${a.titel}`, info: `${packTitel} · ${stand}` };
}

/** On the start card: "Tageslevel 13.11." or "Wochenaufgabe KW 46". */
export function titelZeile(a: Aufgabe): string {
  if (a.art === 'woche') return `Wochenaufgabe KW ${Number(a.zeitraum.slice(-2))}`;
  const [, m, d] = a.zeitraum.split('-');
  return `Tageslevel ${Number(d)}.${Number(m)}.`;
}

/** The line in the win message. */
export function ergebnisZeile(p: Pruefung, art: Art, zeit: (steps: number) => string): string {
  const name = NAME[art];
  if (p.status === 'wartet') return `${name}: wird geprüft …`;
  if (p.status === 'abgelehnt') return `${name}: ${p.grund}`;
  const platz = p.platz ? `Platz ${p.platz} von ${p.von}` : `${p.von} Zeiten`;
  return p.neu ? `${name}: ${platz}` : `${name}: ${platz} (deine Bestzeit ${zeit(p.zeit)})`;
}
