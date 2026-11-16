// Types for the parts of levels.mjs that TypeScript code uses (vite.config.ts, src/levelzahl.test.ts).
export const ROOT: string;
export function loadLevels(root?: string): { pack: string; file: { id: string; [k: string]: unknown }; ref: boolean }[];
export function levelAnzahl(root?: string): number;
export function levelHash(file: unknown): string;
