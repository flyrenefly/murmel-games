// Spielstart per Adresse (docs/SPEC-levelseiten.md): "#start=<paket-id>/<level-id>" aus den
// Levelseiten startet genau dieses Level. Das Level wird per ID gesucht, nicht per Nummer, damit
// Links stimmen, wenn ein Paket später mehr Levels bekommt.

export interface StartLink {
  pack: string;
  id: string;
}

/** Liest den Hash; null, wenn er kein Startlink ist. */
export function startFromHash(hash: string): StartLink | null {
  const m = /^#start=([^/&?#]+)\/([^&?#]+)$/.exec(hash);
  if (!m) return null;
  try {
    const pack = decodeURIComponent(m[1]);
    const id = decodeURIComponent(m[2]);
    if (!/^[a-z0-9_]{1,40}$/.test(pack) || !id || id.length > 200) return null;
    return { pack, id };
  } catch {
    return null;
  }
}

/** Index des Levels mit dieser ID in der Liste des Pakets, sonst -1. */
export function indexOfLevel(levels: readonly { id: string }[], id: string): number {
  return levels.findIndex((l) => l.id === id);
}
