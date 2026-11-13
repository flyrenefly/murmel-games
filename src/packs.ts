import type { LevelFile } from './game/level';
import { LEVELS } from './levels';

// Level packs: Murmel's own levels are bundled; imported Enigma packs are
// fetched only when opened (public/levels/enigma/, made by tools/import-enigma.mjs).

export interface PackInfo {
  id: string;
  title: string;
  count: number;
  /** Number of levels in the original pack (imported packs). */
  of?: number;
  source: 'murmel' | 'enigma';
}

const OWN: PackInfo = { id: 'murmel', title: 'Murmel', count: LEVELS.length, source: 'murmel' };
const base = `${import.meta.env.BASE_URL}levels/enigma/`;
const loaded = new Map<string, Promise<LevelFile[]>>([['murmel', Promise.resolve(LEVELS)]]);
let index: Promise<PackInfo[]> | null = null;

export function listPacks(): Promise<PackInfo[]> {
  index ??= fetch(`${base}index.json`)
    .then((r) => (r.ok ? r.json() : []))
    .then((list: { pack: string; title: string; count: number; of: number }[]) => [
      OWN,
      ...list.map((p): PackInfo => ({ id: p.pack, title: p.title, count: p.count, of: p.of, source: 'enigma' })),
    ])
    .catch(() => [OWN]);
  return index;
}

export function packLevels(id: string): Promise<LevelFile[]> {
  let p = loaded.get(id);
  if (!p) {
    p = fetch(`${base}${encodeURIComponent(id)}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`Paket ${id} nicht gefunden`);
        return r.json();
      })
      .then((j: { levels: LevelFile[] }) => j.levels);
    p.catch(() => loaded.delete(id));
    loaded.set(id, p);
  }
  return p;
}

export async function packTitle(id: string): Promise<string> {
  if (id === 'link') return 'Geteiltes Level';
  if (id === 'spieler') return 'Spieler-Levels';
  return (await listPacks()).find((p) => p.id === id)?.title ?? id;
}

/** A level from a link (src/editor/game-link.ts) as the one-level pack "link". */
export function setLinkPack(file: LevelFile): void {
  loaded.set('link', Promise.resolve([file]));
}

/** A level from the list "Spieler-Levels" (src/spielerlevels.ts) as the one-level pack "spieler". */
export function setPlayerPack(file: LevelFile): void {
  loaded.set('spieler', Promise.resolve([file]));
}
