// Forum helpers without DOM: text with links, the bug-report link from the game, page routes.

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

export const KATEGORIEN = { fehler: 'Fehler', verbesserung: 'Verbesserung', frage: 'Frage', level: 'Level' } as const;
export const STATUS = { offen: 'Offen', geplant: 'Geplant', erledigt: 'Erledigt' } as const;
export type Kategorie = keyof typeof KATEGORIEN;
export type Status = keyof typeof STATUS;

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
  const t = new Date(iso);
  const s = Math.round((now.getTime() - t.getTime()) / 1000);
  if (s < 60) return 'gerade eben';
  if (s < 3600) return `vor ${Math.floor(s / 60)} Min.`;
  if (s < 86_400) return `vor ${Math.floor(s / 3600)} Std.`;
  if (s < 2 * 86_400) return 'gestern';
  if (s < 7 * 86_400) return `vor ${Math.floor(s / 86_400)} Tagen`;
  const sameYear = t.getFullYear() === now.getFullYear();
  return t.toLocaleDateString('de-DE', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}
