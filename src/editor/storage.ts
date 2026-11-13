// "Meine Levels": own levels in this browser (localStorage), the current one is saved on every
// change, so nothing is lost (no save button). Stored as LevelFile, the game's stable format.

import type { LevelFile } from '../game/level';
import { type EditorLevel, fromLevelFile, toLevelFile } from './model';

const KEY = 'murmel.editor.levels';
const CURRENT = 'murmel.editor.current';
const HISTORY = 'murmel.editor.history';

export interface Stored {
  id: string;
  updated: string;
  file: LevelFile;
}

function read<T>(storage: Storage | undefined, key: string, fallback: T): T {
  try {
    const v = storage?.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(storage: Storage | undefined, key: string, value: unknown): boolean {
  try {
    storage?.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false; // private mode or full
  }
}

const local = (): Storage | undefined => (typeof localStorage === 'undefined' ? undefined : localStorage);
const session = (): Storage | undefined => (typeof sessionStorage === 'undefined' ? undefined : sessionStorage);

export function listLevels(): Stored[] {
  const all = read<Record<string, Stored>>(local(), KEY, {});
  return Object.values(all)
    .filter((s) => s && typeof s.id === 'string' && s.file && Array.isArray(s.file.map))
    .sort((a, b) => b.updated.localeCompare(a.updated));
}

export function loadStored(id: string): EditorLevel | null {
  const s = read<Record<string, Stored>>(local(), KEY, {})[id];
  if (!s) return null;
  try {
    return fromLevelFile(s.file).level;
  } catch {
    return null;
  }
}

export function saveLevel(id: string, level: EditorLevel): boolean {
  const all = read<Record<string, Stored>>(local(), KEY, {});
  all[id] = { id, updated: new Date().toISOString(), file: toLevelFile(level, id) };
  return write(local(), KEY, all);
}

export function deleteLevel(id: string): void {
  const all = read<Record<string, Stored>>(local(), KEY, {});
  delete all[id];
  write(local(), KEY, all);
}

export const newId = (): string => `eigen:${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

export const currentId = (): string | null => read<string | null>(local(), CURRENT, null);
export const setCurrentId = (id: string): void => void write(local(), CURRENT, id);

/** Undo history of a level for this tab (survives the playtest, not closing the tab). */
export function loadHistory(id: string): { past: EditorLevel[]; future: EditorLevel[] } | null {
  const h = read<{ id: string; past: EditorLevel[]; future: EditorLevel[] } | null>(session(), HISTORY, null);
  return h && h.id === id ? h : null;
}

export function saveHistory(id: string, h: { past: EditorLevel[]; future: EditorLevel[] }): void {
  if (!write(session(), HISTORY, { id, ...h })) write(session(), HISTORY, { id, past: h.past.slice(-20), future: [] });
}
