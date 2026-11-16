// Sharing a level in the link: murmel.games/#level=1.<base64url(deflate-raw(JSON))>.
// Links are foreign input: decoding is strict, keeps only what the editor can make, never Lua.

import { type LevelFile, parseLevel } from '../game/level';
import { LICENSE, MAX_H, MAX_W } from './model';
import { BY_KIND, type PaletteEntry } from './palette';
import { einsetzen, type Werte, woerterbuch } from '../i18n';
import EN from '../i18n/en/editor';

const t = woerterbuch(EN);

export const LINK_PREFIX = '#level=';
const VERSION = '1.';
/** Above this length (of the whole hash) the link still works, but some messengers cut it. */
export const LINK_SOFT_LIMIT = 2000;
/** Longest data part we make or accept. */
export const LINK_HARD_LIMIT = 16000;
/** Most bytes a link may unpack to (protects against deflate bombs). */
export const MAX_UNPACKED = 512 * 1024;
const MAX_OBJECTS = 2400;
const MAX_ACTORS = 40;
const MAX_TEXT = 80;
/** Length of the Vorlage/Herkunft (basedOn, shown as „Vorlage: …“); the server checks the same (server/src/spielerlevels.ts). */
export const MAX_BASED_ON = 80;

/** The credit as one line: control characters out, spaces collapsed, trimmed, at most MAX_BASED_ON characters ('' removes it). */
export function basedOnText(v: unknown): string {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const clean = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return [...clean].slice(0, MAX_BASED_ON).join('').trim();
}

/** Connection attributes every object may carry; others only as a property of its palette entry. */
const ATTRS = new Set(['name', 'target', 'action', 'interval']);
const CELL_KEYS = new Set(['floor', 'stone', 'symbol', 'flavor', 'start', 'force']);
/** Pearls that may be the main ball of a meditation level (no black marble). */
export const MAIN_PEARLS = new Set(['ac_pearl_white', 'ac_pearl_black']);

/** Documents (it_document) per level and characters per text (user decision 15.11.2026); server/src/spielerlevels.ts checks the same. */
export const MAX_DOCS = 10;
export const MAX_DOC_TEXT = 300;

/**
 * A document text as plain text: control characters (C0, DEL, C1), invisible and direction-changing
 * characters become spaces, spaces are collapsed, at most MAX_DOC_TEXT characters. The game shows it
 * with textContent, never as HTML, so a link stays text.
 */
export function docText(v: unknown): string {
  if (typeof v !== 'string') return '';
  const clean = v
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return [...clean].slice(0, MAX_DOC_TEXT).join('').trim();
}

/**
 * A reason for the person. `message` stays German (the server's checker, tools/lib/check-worker.mjs, and
 * the server's error translation rely on it); `text` is the same in the page's language.
 */
export class LinkError extends Error {
  readonly de: keyof typeof EN & string;
  readonly werte?: Werte;

  // no parameter properties: tools load this file with Node type stripping
  constructor(de: keyof typeof EN & string, werte?: Werte) {
    super(einsetzen(de, werte));
    this.de = de;
    this.werte = werte;
  }

  /** The message in the page's language. */
  get text(): string {
    return t(this.de, this.werte);
  }
}

// ---------- base64url ----------
function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new LinkError('Der Link enthält ungültige Zeichen.');
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    throw new LinkError('Der Link ist beschädigt.');
  }
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// ---------- deflate ----------
async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream, limit = Infinity): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  void writer.write(bytes as Uint8Array<ArrayBuffer>).catch(() => {});
  void writer.close().catch(() => {});
  const reader = stream.readable.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      void reader.cancel().catch(() => {});
      throw new LinkError('Das Level im Link ist zu groß.');
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** The compact form in the link: a LevelFile without id and licence. */
function linkJson(file: LevelFile): string {
  const { title, author, basedOn, map, legend, start, objects, actors, mainPearl } = file;
  // basedOn (the credit of a converted Enigma level) and mainPearl travel along; without them the link stays as before
  return JSON.stringify({ title, author, basedOn, map, legend, start, objects, actors, mainPearl });
}

/** Data part of the link (without '#level='). */
export async function encodeLevel(file: LevelFile): Promise<string> {
  const packed = await pipe(new TextEncoder().encode(linkJson(file)), new CompressionStream('deflate-raw'));
  return VERSION + toBase64Url(packed);
}

/** How a link of this length behaves. */
export function linkLength(data: string): 'ok' | 'lang' | 'zu-lang' {
  if (data.length > LINK_HARD_LIMIT) return 'zu-lang';
  return LINK_PREFIX.length + data.length > LINK_SOFT_LIMIT ? 'lang' : 'ok';
}

/** FNV-1a of the data: the id of a link level (never collides with pack levels). */
export function linkId(data: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    h ^= data.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `link:${(h >>> 0).toString(16).padStart(8, '0')}`;
}

/** Reads the data part of a link; throws LinkError with a message for the player. */
export async function decodeLevel(data: string): Promise<LevelFile> {
  if (!data.startsWith(VERSION)) throw new LinkError('Dieser Level-Link stammt aus einer anderen Version oder ist beschädigt.');
  if (data.length > LINK_HARD_LIMIT) throw new LinkError('Der Link ist zu lang.');
  const packed = fromBase64Url(data.slice(VERSION.length));
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(await pipe(packed, new DecompressionStream('deflate-raw'), MAX_UNPACKED));
  } catch (e) {
    if (e instanceof LinkError) throw e;
    throw new LinkError('Der Link ist beschädigt (nicht entpackbar).');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new LinkError('Der Link ist beschädigt (kein Level).');
  }
  return sanitizeLevel(raw, linkId(data));
}

/** Data part from a location hash ('#level=…' plus optional '&edit'), or null. */
export function linkData(hash: string): string | null {
  if (!hash.startsWith(LINK_PREFIX)) return null;
  return hash.slice(LINK_PREFIX.length).split('&')[0];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max = MAX_TEXT): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max) : '');
const coord = (v: unknown, max: number): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v >= max) throw new LinkError('Das Level enthält ungültige Positionen.');
  return v;
};

/** Connection attributes, and the entry's properties with one of their allowed values (others are dropped). */
function attrs(v: unknown, e: PaletteEntry): Record<string, string> | undefined {
  if (!isObj(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(v)) {
    if (typeof x !== 'string') continue;
    if (ATTRS.has(k)) out[k] = text(x, 40);
    else if (k === 'text' && e.text) {
      const t = docText(x);
      if (t) out.text = t;
    }
    else if (e.props?.some((p) => p.key === k && p.options.some(([value]) => value === x))) out[k] = x;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Untrusted JSON (link or imported file) as a LevelFile with only what the editor can make:
 * known fields, palette kinds, known attributes, bounded sizes, no Lua. Throws LinkError.
 */
export function sanitizeLevel(raw: unknown, id: string): LevelFile {
  if (!isObj(raw)) throw new LinkError('Das ist kein Murmel-Level.');
  const map = raw.map;
  if (!Array.isArray(map) || map.length === 0 || map.length > MAX_H || !map.every((r) => typeof r === 'string' && r.length > 0 && r.length <= MAX_W))
    throw new LinkError('Die Karte fehlt oder ist größer als {w}×{h}.', { w: MAX_W, h: MAX_H });
  const width = Math.max(...(map as string[]).map((r) => r.length));
  const height = map.length;
  const legend: LevelFile['legend'] = {};
  if (raw.legend !== undefined) {
    if (!isObj(raw.legend)) throw new LinkError('Die Legende des Levels ist ungültig.');
    for (const [ch, d] of Object.entries(raw.legend)) {
      if ([...ch].length !== 1 || !isObj(d)) throw new LinkError('Die Legende des Levels ist ungültig.');
      for (const k of Object.keys(d)) if (!CELL_KEYS.has(k)) throw new LinkError('Unbekannte Angabe „{angabe}“ im Level.', { angabe: text(k, 20) });
      const floor = d.floor === undefined ? undefined : text(d.floor);
      const stone = d.stone === undefined ? undefined : text(d.stone);
      if (floor !== undefined && BY_KIND.get(floor)?.layer !== 'floor') throw new LinkError('Der Boden „{art}“ ist im Editor nicht erlaubt.', { art: floor });
      if (stone !== undefined && stone !== 'st_oxyd' && !BY_KIND.get(stone)?.wall) throw new LinkError('Der Stein „{art}“ ist im Editor nicht erlaubt.', { art: stone });
      legend[ch] = { ...(floor ? { floor } : {}), ...(stone ? { stone } : {}) };
      // a slope's force comes from its kind, never from the file
      const force = floor ? BY_KIND.get(floor)?.force : undefined;
      if (force) legend[ch].force = [force[0], force[1]];
      if (stone === 'st_oxyd') {
        const symbol = text(d.symbol, 1);
        if (!/^[A-Z?]$/.test(symbol)) throw new LinkError('Ein Oxyd-Stein hat keine gültige Farbe.');
        legend[ch].symbol = symbol;
        legend[ch].flavor = /^[a-d]$/.test(text(d.flavor, 1)) ? text(d.flavor, 1) : 'b';
      }
      if (d.start === true) legend[ch].start = true;
    }
  }
  const objects = Array.isArray(raw.objects) ? raw.objects : raw.objects === undefined ? [] : null;
  const actors = Array.isArray(raw.actors) ? raw.actors : raw.actors === undefined ? [] : null;
  if (!objects || !actors || objects.length > MAX_OBJECTS || actors.length > MAX_ACTORS) throw new LinkError('Das Level enthält zu viele oder ungültige Objekte.');
  if (objects.filter((o) => isObj(o) && o.k === 'it_document').length > MAX_DOCS) throw new LinkError('Ein Level darf höchstens {max} Dokumente enthalten.', { max: MAX_DOCS });
  const file: LevelFile = {
    id,
    title: text(raw.title) || 'Ohne Titel',
    author: text(raw.author),
    license: LICENSE,
    map: map as string[],
    legend,
    objects: objects.map((o) => {
      if (!isObj(o)) throw new LinkError('Das Level enthält ungültige Objekte.');
      const k = text(o.k, 40);
      const e = BY_KIND.get(k);
      if (!e || (e.layer !== 'stone' && e.layer !== 'item') || e.wall) throw new LinkError('Das Objekt „{art}“ ist im Editor nicht erlaubt.', { art: k });
      const x = coord(o.x, width);
      const y = coord(o.y, height);
      if (!Number.isInteger(x) || !Number.isInteger(y)) throw new LinkError('Das Level enthält ungültige Positionen.');
      const a = attrs(o.a, e);
      return a ? { x, y, k, a } : { x, y, k };
    }),
    actors: actors.map((o) => {
      if (!isObj(o)) throw new LinkError('Das Level enthält ungültige Gegner.');
      const k = text(o.k, 40);
      if (BY_KIND.get(k)?.layer !== 'actor') throw new LinkError('Der Gegner „{art}“ ist im Editor nicht erlaubt.', { art: k });
      return { k, x: coord(o.x, width), y: coord(o.y, height) };
    }),
  };
  if (raw.basedOn !== undefined) {
    const b = typeof raw.basedOn === 'string' ? raw.basedOn.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s{2,}/g, ' ').trim() : null;
    if (b === null || [...b].length > MAX_BASED_ON) throw new LinkError('Die Angabe „Vorlage“ darf höchstens {max} Zeichen haben.', { max: MAX_BASED_ON });
    if (b) file.basedOn = b;
  }
  if (raw.start !== undefined) {
    if (!isObj(raw.start)) throw new LinkError('Der Startpunkt ist ungültig.');
    file.start = { x: coord(raw.start.x, width), y: coord(raw.start.y, height) };
  }
  if (raw.mainPearl !== undefined) {
    const k = isObj(raw.mainPearl) ? text(raw.mainPearl.k, 40) : '';
    if (!MAIN_PEARLS.has(k)) throw new LinkError('Die Start-Perle des Levels ist ungültig.');
    if (!file.start) throw new LinkError('Die Start-Perle braucht einen Startpunkt.');
    file.mainPearl = { k };
  }
  try {
    parseLevel(file, () => 0.5);
  } catch (e) {
    throw new LinkError('Das Level lässt sich nicht laden: {grund}', { grund: e instanceof Error ? e.message.replace(/^[^:]*: /, '') : String(e) });
  }
  return file;
}
