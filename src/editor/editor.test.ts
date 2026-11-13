import { describe, expect, it } from 'vitest';
import shim from '../lua/enigma.lua?raw';
import l01 from '../levels/01.json';
import { LuaLevel } from '../lua/runtime';
import { probeLevel } from '../game/check';
import { parseLevel } from '../game/level';
import { objectClass } from '../game/objects';
import { enemyKind } from '../game/actors';
import floors from '../game/floors.generated.json';
import type { StartLua } from '../game/session';
import { History } from './history';
import { decodeLevel, encodeLevel, LINK_HARD_LIMIT, linkData, linkId, linkLength, LinkError, sanitizeLevel } from './link';
import { cellOf, clone, type EditorLevel, erase, fromLevelFile, newLevel, nextOxydColor, paint, resize, sourceAt, toLevelFile } from './model';
import { BY_KIND, PALETTE, searchPalette } from './palette';
import { canShare, check } from './rules';

const startLua: StartLua = async (code, host) => LuaLevel.create(code, host, shim, await import('fengari'));
const P = (k: string) => BY_KIND.get(k)!;
const IMAGES = new Set(Object.keys(import.meta.glob('/public/enigma/gfx32/*.png')).map((f) => f.replace(/^.*\/|\.png$/g, '')));
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
/** deflate-raw like the link, for hand-made broken links. */
async function deflateRaw(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A small playable level: switch opens a door, a rotor, a hammer. */
function sample(): EditorLevel {
  const l = newLevel();
  l.title = 'Probe';
  l.author = 'Test';
  paint(l, 5, 5, P('st_switch'));
  paint(l, 8, 5, P('st_door_d'));
  sourceAt(l, 5, 5)!.attrs.target = 'tuer1';
  paint(l, 3, 8, P('it_hammer'));
  paint(l, 14, 3, P('ac_rotor'));
  paint(l, 12, 9, P('fl_ice'));
  return l;
}

describe('palette', () => {
  it('offers only what the game supports, with existing images', () => {
    for (const e of PALETTE) {
      expect(IMAGES.has(e.image), `${e.kind}: ${e.image}.png`).toBe(true);
      if (e.layer === 'floor') expect(e.kind in floors, e.kind).toBe(true);
      if (e.layer === 'stone' && e.wall) expect(objectClass(e.kind), e.kind).toBeNull();
      if ((e.layer === 'stone' && !e.wall) || e.layer === 'item') expect(objectClass(e.kind), e.kind).not.toBeNull();
      if (e.layer === 'actor') expect(enemyKind(e.kind), e.kind).not.toBeNull();
    }
    expect(new Set(PALETTE.map((e) => e.kind)).size).toBe(PALETTE.length);
  });

  it('searches by name, kind and group', () => {
    expect(searchPalette('tür').map((e) => e.kind)).toContain('st_door_d');
    expect(searchPalette('fl_ice').map((e) => e.kind)).toEqual(['fl_ice']);
    expect(searchPalette('Gegner').every((e) => e.layer === 'actor')).toBe(true);
    expect(searchPalette('  ')).toBe(PALETTE);
  });
});

describe('model', () => {
  it('a new level is 20×13, loads in the game and passes the checks once titled', () => {
    const l = newLevel();
    expect([l.width, l.height]).toEqual([20, 13]);
    expect(canShare(check(l))).toBe(false); // no title
    l.title = 'Neu';
    expect(check(l).filter((p) => p.level === 'fehler')).toEqual([]);
    const lv = parseLevel(toLevelFile(l));
    expect(lv.signals).toHaveLength(2);
  });

  it('round trip LevelFile ↔ editor keeps everything', () => {
    const l = sample();
    const back = fromLevelFile(toLevelFile(l));
    expect(back.dropped).toEqual([]);
    expect(back.level).toEqual(l);
  });

  it('places Oxyd stones in pairs automatically', () => {
    const l = newLevel();
    expect(nextOxydColor(l)).toBe('B');
    paint(l, 4, 4, P('st_oxyd'));
    expect(cellOf(l, 4, 4)!.sa!.symbol).toBe('B');
    expect(nextOxydColor(l)).toBe('B');
    paint(l, 6, 4, P('st_oxyd'));
    expect(cellOf(l, 6, 4)!.sa!.symbol).toBe('B');
    expect(nextOxydColor(l)).toBe('C');
    paint(l, 7, 4, P('st_oxyd'), { oxydColor: '?' });
    expect(cellOf(l, 7, 4)!.sa!.symbol).toBe('?');
  });

  it('names doors, erases, keeps one marble and resizes', () => {
    const l = sample();
    paint(l, 9, 6, P('st_door_b'));
    expect(cellOf(l, 9, 6)!.sa!.name).toBe('tuer2');
    paint(l, 2, 6, P('start'));
    expect(l.start).toEqual({ x: 2, y: 6 });
    expect(erase(l, 2, 6)).toBe(true);
    expect(l.start).toBeNull();
    expect(erase(l, 14, 3)).toBe(true);
    expect(l.actors).toEqual([]);
    expect(erase(l, 14, 3)).toBe(false);
    const big = resize(l, 30, 20);
    expect([big.width, big.height, big.cells.length]).toEqual([30, 20, 600]);
    const small = resize(sample(), 7, 7);
    expect(small.actors).toEqual([]);
    expect(small.start).toBeNull(); // the marble was at 10,6
    expect(resize(l, 1, 999)).toMatchObject({ width: 5, height: 40 });
  });

  it('an editor level runs in the game (load probe)', async () => {
    const r = await probeLevel(toLevelFile(sample(), 'probe'), startLua, 2);
    expect(r.status).toBe('ok');
  });

  it('drops kinds the editor does not offer when importing', () => {
    const f = toLevelFile(sample());
    f.objects!.push({ x: 1, y: 1, k: 'it_wormhole', a: { dest: '1,1' } });
    expect(fromLevelFile(f).dropped).toEqual(['it_wormhole']);
  });
});

describe('link', () => {
  it('round trip', async () => {
    const f = toLevelFile(sample());
    const data = await encodeLevel(f);
    expect(data.startsWith('1.')).toBe(true);
    expect(linkLength(data)).toBe('ok');
    const back = await decodeLevel(data);
    expect(back.id).toBe(linkId(data));
    expect(back.license).toBe('CC-BY-SA-4.0');
    expect(f.license).toBe('CC-BY-SA-4.0');
    expect(fromLevelFile(back).level).toEqual(sample());
  });

  it('keeps a typical level short', async () => {
    const data = await encodeLevel(toLevelFile(sample()));
    expect(data.length).toBeLessThan(400);
  });

  it('reports the length limits', () => {
    expect(linkLength('1.' + 'a'.repeat(1000))).toBe('ok');
    expect(linkLength('1.' + 'a'.repeat(3000))).toBe('lang');
    expect(linkLength('1.' + 'a'.repeat(LINK_HARD_LIMIT))).toBe('zu-lang');
  });

  it('reads the hash', () => {
    expect(linkData('#level=1.abc&edit')).toBe('1.abc');
    expect(linkData('#konto')).toBeNull();
  });

  it('rejects broken links with a message', async () => {
    const bad = async (d: string) => expect(decodeLevel(d)).rejects.toBeInstanceOf(LinkError);
    await bad('');
    await bad('2.abc');
    await bad('1.ab$c');
    await bad('1.' + 'A'.repeat(LINK_HARD_LIMIT + 1));
    await bad('1.' + b64url(new Uint8Array([1, 2, 3, 4, 5]))); // not deflate
    await bad('1.' + b64url(await deflateRaw('kein json')));
    await bad('1.' + b64url(await deflateRaw('[1,2]')));
    await bad('1.' + b64url(await deflateRaw(JSON.stringify({ map: [] }))));
    // a deflate bomb: 2 MB of spaces
    await bad('1.' + b64url(await deflateRaw(' '.repeat(2 * 1024 * 1024))));
  });

  it('drops Lua and texts and refuses foreign kinds', async () => {
    const f = toLevelFile(sample());
    const withLua = { ...f, lua: { code: 'os.exit()', kinds: {}, named: [] }, texts: { a: '<b>x</b>' }, world: { GlobalForce: '9,9' } };
    const clean = sanitizeLevel(withLua, 'x');
    expect(clean).not.toHaveProperty('lua');
    expect(clean).not.toHaveProperty('texts');
    expect(clean).not.toHaveProperty('world');
    expect(() => sanitizeLevel({ ...f, objects: [{ x: 1, y: 1, k: 'it_wormhole' }] }, 'x')).toThrow(LinkError);
    expect(() => sanitizeLevel({ ...f, objects: [{ x: 99, y: 1, k: 'it_hammer' }] }, 'x')).toThrow(LinkError);
    expect(() => sanitizeLevel({ ...f, legend: { '.': { floor: 'fl_gray', lua: 'x' } } }, 'x')).toThrow(LinkError);
    expect(() => sanitizeLevel({ ...f, map: Array(41).fill('#') }, 'x')).toThrow(LinkError);
    // a level the game refuses (only one Oxyd stone)
    const one = toLevelFile(sample());
    one.legend = Object.fromEntries(Object.entries(one.legend!).map(([k, d]) => [k, d.stone === 'st_oxyd' ? { floor: 'fl_gray' } : d]));
    one.map[2] = one.map[2].slice(0, 2) + 'A' + one.map[2].slice(3);
    expect(() => sanitizeLevel(one, 'x')).toThrow(/nicht laden/);
    // attributes: only the known ones survive
    const g = toLevelFile(sample());
    g.objects![0].a = { target: 'tuer1', onclick: 'x', $state: '1' };
    expect(sanitizeLevel(g, 'x').objects![0].a).toEqual({ target: 'tuer1' });
  });

  it('a level file from disk passes the same checks', () => {
    expect(sanitizeLevel(l01, 'x').map).toEqual(l01.map);
  });
});

describe('rules', () => {
  const texts = (l: EditorLevel) => check(l).map((p) => `${p.level}: ${p.text}`);

  it('needs a marble that does not start on a stone or the abyss', () => {
    const l = sample();
    l.start = null;
    expect(texts(l)).toContain('fehler: Die Murmel fehlt: setze genau eine Murmel (Spezial → Murmel).');
    const m = sample();
    paint(m, 10, 6, P('fl_abyss'));
    expect(texts(m)).toContain('fehler: Die Murmel startet auf Abgrund oder Wasser.');
  });

  it('needs at least two Oxyd stones in pairs', () => {
    const l = sample();
    erase(l, 2, 2);
    expect(texts(l)).toContain('fehler: Es braucht mindestens zwei Oxyd-Steine.');
    expect(texts(l)).toContain('fehler: Oxyd-Farbe A hat keinen Partner (1×).');
    const q = sample();
    paint(q, 4, 4, P('st_oxyd'), { oxydColor: '?' });
    expect(texts(q)).toContain('fehler: Die Zahl der Zufallsfarben-Steine ist ungerade (1).');
    paint(q, 4, 6, P('st_oxyd'), { oxydColor: '?' });
    expect(canShare(check(q))).toBe(true);
  });

  it('finds Oxyd stones walled in, and those only over the abyss', () => {
    const l = sample();
    for (const [x, y] of [[3, 1], [3, 2], [3, 3], [2, 3], [1, 3]]) paint(l, x, y, P('st_granite'));
    expect(texts(l)).toContain('fehler: Ein Oxyd-Stein ist von der Murmel aus nicht erreichbar.');
    const d = sample(); // doors and boxes do not count as walls
    for (const [x, y] of [[3, 1], [3, 2], [3, 3], [2, 3]]) paint(d, x, y, P('st_granite'));
    paint(d, 1, 3, P('st_box_wood'));
    expect(canShare(check(d))).toBe(true);
    const a = sample();
    for (const [x, y] of [[3, 1], [3, 2], [3, 3], [2, 3], [1, 3]]) paint(a, x, y, P('fl_abyss'));
    expect(canShare(check(a))).toBe(true);
    expect(texts(a)).toContain('hinweis: Manche Oxyd-Steine sind nur über Abgrund oder Wasser erreichbar.');
  });

  it('checks connections and the border', () => {
    const l = sample();
    sourceAt(l, 5, 5)!.attrs.target = 'weg';
    expect(texts(l)).toContain('fehler: Schalter zeigt auf „weg“, das es nicht gibt.');
    sourceAt(l, 5, 5)!.attrs.target = '';
    expect(texts(l)).toContain('hinweis: Schalter ohne Ziel.');
    erase(l, 0, 6);
    expect(texts(l)).toContain('hinweis: Der Rand ist offen: die Murmel kann aus dem Level rollen.');
    expect(canShare(check(l))).toBe(true);
  });

  it('a sample level has no problems', () => {
    expect(check(sample())).toEqual([]);
  });
});

describe('history', () => {
  it('undoes and redoes', () => {
    const h = new History<string>();
    expect(h.undo('a')).toBeNull();
    h.record('a'); // a → b
    h.record('b'); // b → c
    expect(h.undo('c')).toBe('b');
    expect(h.undo('b')).toBe('a');
    expect(h.canUndo).toBe(false);
    expect(h.redo('a')).toBe('b');
    expect(h.redo('b')).toBe('c');
    expect(h.redo('c')).toBeNull();
  });

  it('a new change drops the redo steps', () => {
    const h = new History<string>();
    h.record('a');
    h.undo('b');
    expect(h.canRedo).toBe(true);
    h.record('a');
    expect(h.canRedo).toBe(false);
  });

  it('keeps at most `limit` steps and survives JSON', () => {
    const h = new History<number>(3);
    for (let i = 0; i < 10; i++) h.record(i);
    const k = History.from<number>(JSON.parse(JSON.stringify(h)), 3);
    expect(k.undo(10)).toBe(9);
    expect(k.undo(9)).toBe(8);
    expect(k.undo(8)).toBe(7);
    expect(k.undo(7)).toBeNull();
  });

  it('works with editor snapshots', () => {
    const h = new History<EditorLevel>();
    let l = sample();
    h.record(clone(l));
    paint(l, 1, 1, P('st_death'));
    l = h.undo(l)!;
    expect(cellOf(l, 1, 1)!.s).toBeUndefined();
    l = h.redo(l)!;
    expect(cellOf(l, 1, 1)!.s).toBe('st_death');
  });
});
