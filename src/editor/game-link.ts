// The game's side of shared levels (docs/SPEC-editor.md §4, §6): a '#level=…' hash starts the
// level as the one-level pack LINK_PACK; '&edit' marks a playtest from the editor.

import type { LevelFile } from '../game/level';
import { setLinkPack } from '../packs';
import { decodeLevel, LINK_PREFIX, linkData, LinkError } from './link';

export const LINK_PACK = 'link';

export const isLinkLevel = (id: string): boolean => id.startsWith('link:');

/** The link of the current level (to the editor), set by openLinkFromHash. */
let current: { data: string; edit: boolean } | null = null;

export type LinkResult = { ok: true; file: LevelFile } | { ok: false; error: string } | null;

/** Reads a '#level=…' hash and registers its level as LINK_PACK; null if the hash is no level link. */
export async function openLinkFromHash(hash: string): Promise<LinkResult> {
  const data = linkData(hash);
  if (data === null) return null;
  try {
    const file = await decodeLevel(data);
    setLinkPack(file);
    current = { data, edit: /&edit\b/.test(hash) };
    return { ok: true, file };
  } catch (e) {
    return { ok: false, error: e instanceof LinkError ? e.message : 'Der Level-Link ist beschädigt.' };
  }
}

/** Menu button for a link level: back to the editor (playtest) or open it there (shared link). */
export function editorButton(): [string, () => void] | null {
  const link = current;
  if (!link) return null;
  return link.edit
    ? ['Zurück zum Editor', () => location.assign('./editor.html')]
    : ['Im Editor öffnen', () => location.assign(`./editor.html${LINK_PREFIX}${link.data}`)];
}
