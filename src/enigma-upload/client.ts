// The page's side of the conversion: size check, worker with time limit (docs/SPEC-enigma-upload.md).
import { MAX_FILE, UploadError } from './datei';
import type { Ergebnis } from './umwandeln';

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
  if (file.size > MAX_FILE) throw new UploadError(`Die Datei ist ${Math.ceil(file.size / 1024)} KB groß; erlaubt sind höchstens ${MAX_FILE / 1024} KB.`);
  const text = await file.text();
  return new Promise<Ergebnis>((resolve, reject) => {
    const w = make();
    const done = (fn: () => void) => {
      clearTimeout(timer);
      w.terminate();
      fn();
    };
    const timer = setTimeout(() => done(() => reject(new UploadError(`Die Umwandlung wurde abgebrochen (Zeitgrenze ${ms / 1000} s).`))), ms);
    w.onmessage = (e) => {
      const d = e.data as ({ ok: true } & Ergebnis) | { ok: false; error: string };
      done(() => (d.ok ? resolve({ level: d.level, hinweise: d.hinweise, herkunft: d.herkunft }) : reject(new UploadError(d.error))));
    };
    w.onerror = (e) => {
      e.preventDefault?.();
      done(() => reject(new UploadError('Die Umwandlung wurde abgebrochen (zu viel Speicher oder ein Fehler im Browser).')));
    };
    w.postMessage({ name: file.name, text });
  });
}
