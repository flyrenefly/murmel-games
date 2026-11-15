// Forum helpers without DOM: text with links, the bug-report link from the game, page routes.
import { gebietsschema, woerterbuch } from './i18n';
import EN from './i18n/en/forum';

const t = woerterbuch(EN);

/** A piece of a post: plain text or a web address (shown as a link with rel="nofollow ugc noopener"). */
export type Teil = { text: string } | { link: string };

const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi;

/**
 * Splits plain text into text and http(s) links. Trailing punctuation stays text ("siehe https://x.de.").
 * Nothing here produces HTML: the page puts text into textContent and links into an <a> it builds.
 */
export function textTeile(text: string): Teil[] {
  const out: Teil[] = [];
  let at = 0;
  for (const m of text.matchAll(URL_RE)) {
    let url = m[0];
    const tail = /[.,;:!?)\]]+$/.exec(url);
    if (tail) url = url.slice(0, -tail[0].length);
    // keep a closing bracket that belongs to the address, e.g. Wikipedia links "…_(Spiel)"
    if (tail && tail[0].startsWith(')') && url.includes('(')) url += ')';
    const start = m.index ?? 0;
    if (start > at) out.push({ text: text.slice(at, start) });
    if (isSafeUrl(url)) out.push({ link: url });
    else out.push({ text: url });
    at = start + url.length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

function isSafeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.length > 0;
  } catch {
    return false;
  }
}

export type Kategorie = 'fehler' | 'verbesserung' | 'frage' | 'level';
export type Status = 'offen' | 'geplant' | 'erledigt';
export const KATEGORIEN: Readonly<Record<Kategorie, string>> = { fehler: t('Fehler'), verbesserung: t('Verbesserung'), frage: t('Frage'), level: t('Level') };
export const STATUS: Readonly<Record<Status, string>> = { offen: t('Offen'), geplant: t('Geplant'), erledigt: t('Erledigt') };

/** "Fehler melden" in the game: a new bug topic with level and game version filled in. */
export function fehlerLink(level: string, version: string): string {
  const q = new URLSearchParams({ kategorie: 'fehler', level, version });
  return `forum.html#neu?${q.toString()}`;
}

export type Route =
  | { seite: 'liste' }
  | { seite: 'thema'; id: number }
  | { seite: 'neu'; kategorie: Kategorie; level: string; version: string }
  | { seite: 'meldungen' };

/** Page route from location.hash: #thema/12, #neu?kategorie=…, #meldungen, else the list. */
export function route(hash: string): Route {
  const raw = hash.replace(/^#/, '');
  const [path, query = ''] = raw.split('?', 2);
  const thema = /^thema\/(\d{1,12})$/.exec(path);
  if (thema) return { seite: 'thema', id: Number(thema[1]) };
  if (path === 'meldungen') return { seite: 'meldungen' };
  if (path === 'neu') {
    const q = new URLSearchParams(query);
    const k = q.get('kategorie') ?? '';
    return {
      seite: 'neu',
      kategorie: k in KATEGORIEN ? (k as Kategorie) : 'fehler',
      level: (q.get('level') ?? '').slice(0, 120),
      version: (q.get('version') ?? '').slice(0, 40),
    };
  }
  return { seite: 'liste' };
}

/** "vor 5 Minuten", "gestern", "3. Nov." – relative for the last days, else a date. */
export function wann(iso: string, now: Date): string {
  const d = new Date(iso);
  const s = Math.round((now.getTime() - d.getTime()) / 1000);
  if (s < 60) return t('gerade eben');
  if (s < 3600) return t('vor {n} Min.', { n: Math.floor(s / 60) });
  if (s < 86_400) return t('vor {n} Std.', { n: Math.floor(s / 3600) });
  if (s < 2 * 86_400) return t('gestern');
  if (s < 7 * 86_400) return t('vor {n} Tagen', { n: Math.floor(s / 86_400) });
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(gebietsschema(), { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}
