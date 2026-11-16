// The page's side of the conversion: size check, worker with time limit (docs/SPEC-enigma-upload.md).
import { MAX_FILE, UploadError } from './datei';
import type { Ergebnis } from './umwandeln';
import { sprache, woerterbuch } from '../i18n';
import EN from '../i18n/en/enigma-upload';

const t = woerterbuch(EN);

/** Hard time limit of a conversion; the worker is terminated after it. */
export const ZEITGRENZE_MS = 10_000;

export interface WorkerLike {
  postMessage(m: unknown): void;
  terminate(): void;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
}

const neuerWorker = (): WorkerLike => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

/** Converts an Enigma file in a worker; rejects with UploadError (reason for the person). */
export async function wandleImWorker(file: { name: string; size: number; text(): Promise<string> }, make: () => WorkerLike = neuerWorker, ms = ZEITGRENZE_MS): Promise<Ergebnis> {
  if (file.size > MAX_FILE) throw new UploadError(t('Die Datei ist {kb} KB groß; erlaubt sind höchstens {max} KB.', { kb: Math.ceil(file.size / 1024), max: MAX_FILE / 1024 }));
  const text = await file.text();
  return new Promise<Ergebnis>((resolve, reject) => {
    const w = make();
    const done = (fn: () => void) => {
      clearTimeout(timer);
      w.terminate();
      fn();
    };
    const timer = setTimeout(() => done(() => reject(new UploadError(t('Die Umwandlung wurde abgebrochen (Zeitgrenze {s} s).', { s: ms / 1000 })))), ms);
    w.onmessage = (e) => {
      const d = e.data as ({ ok: true } & Ergebnis) | { ok: false; error: string };
      done(() => (d.ok ? resolve({ level: d.level, hinweise: d.hinweise, herkunft: d.herkunft }) : reject(new UploadError(d.error))));
    };
    w.onerror = (e) => {
      e.preventDefault?.();
      done(() => reject(new UploadError(t('Die Umwandlung wurde abgebrochen (zu viel Speicher oder ein Fehler im Browser).'))));
    };
    // the worker has no localStorage: it gets the page's language for its messages and the document texts
    w.postMessage({ name: file.name, text, sprache: sprache() });
  });
}
