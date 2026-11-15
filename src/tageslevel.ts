// Tageslevel und Wochenaufgabe im Spiel (docs/SPEC-tageslevel.md): which levels are today's and this
// week's, sending a won run to their rankings, the texts. Offline or without the API there are no tasks;
// the level itself plays like any other.
import type { Pruefung } from './bestenliste';
import type { Recording } from './game/session';
import { gebietsschema, sprachKopf, woerterbuch } from './i18n';
import EN from './i18n/en/dienste';

const t = woerterbuch(EN);

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
    const res = await fetchFn('/api/tageslevel', { credentials: 'same-origin', cache: 'no-store', headers: sprachKopf() });
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
      headers: { ...sprachKopf(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...rec, art: a.art, zeitraum: a.zeitraum, version }),
    });
    const data = (await res.json().catch(() => null)) as { id?: unknown; error?: unknown } | null;
    if (res.status === 202 && typeof data?.id === 'string') return { id: data.id };
    return { fehler: typeof data?.error === 'string' && res.status !== 404 ? data.error : t('Tagesrangliste gerade nicht erreichbar.') };
  } catch {
    return { fehler: t('Tagesrangliste gerade nicht erreichbar.') };
  }
}

const nameVon = (art: Art) => (art === 'tag' ? t('Tageslevel') : t('Wochenaufgabe'));

/** "1 Zeit" / "3 Zeiten" (times in a ranking). */
const zeiten = (n: number) => (n === 1 ? t('1 Zeit') : t('{n} Zeiten', { n }));

/** The line in the level list. */
export function listenZeile(a: Aufgabe, packTitel: string, zeit: (steps: number) => string): { titel: string; info: string } {
  const stand = a.ich ? `${t('Platz {platz} von {von}', { platz: a.ich.platz, von: a.anzahl })} · ${zeit(a.ich.zeit)}` : a.anzahl ? zeiten(a.anzahl) : t('noch keine Zeiten');
  return { titel: a.art === 'tag' ? t('Heute · {titel}', { titel: a.titel }) : t('Diese Woche · {titel}', { titel: a.titel }), info: `${packTitel} · ${stand}` };
}

/** On the start card: "Tageslevel 13.11." or "Wochenaufgabe KW 46". */
export function titelZeile(a: Aufgabe): string {
  if (a.art === 'woche') return t('Wochenaufgabe KW {kw}', { kw: Number(a.zeitraum.slice(-2)) });
  const [y, m, d] = a.zeitraum.split('-').map(Number);
  // de-DE: "13.11.", en-GB: "13/11"
  const datum = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(gebietsschema(), { day: 'numeric', month: 'numeric', timeZone: 'UTC' });
  return t('Tageslevel {datum}', { datum });
}

/** The line in the win message. */
export function ergebnisZeile(p: Pruefung, art: Art, zeit: (steps: number) => string): string {
  const name = nameVon(art);
  if (p.status === 'wartet') return t('{name}: wird geprüft …', { name });
  if (p.status === 'abgelehnt') return `${name}: ${p.grund}`;
  const platz = p.platz ? t('Platz {platz} von {von}', { platz: p.platz, von: p.von }) : zeiten(p.von);
  return p.neu ? `${name}: ${platz}` : t('{name}: {platz} (deine Bestzeit {zeit})', { name, platz, zeit: zeit(p.zeit) });
}
