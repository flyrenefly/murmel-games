/// <reference lib="webworker" />
// The conversion in its own thread (docs/SPEC-enigma-upload.md): the page stops it after the time
// limit (client.ts), so a script that loops or eats memory only takes this worker down.
import shim from '../lua/enigma.lua?raw';
import type { Fengari } from '../lua/runtime';
import { UploadError } from './datei';
import { wandleUm } from './umwandeln';

self.onmessage = async (e: MessageEvent<{ name: string; text: string }>) => {
  try {
    const f = (await import('fengari-web')) as unknown as Fengari;
    const { level, hinweise, herkunft } = await wandleUm(e.data.name, e.data.text, f, shim);
    self.postMessage({ ok: true, level, hinweise, herkunft });
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof UploadError ? err.message : `Die Umwandlung ist fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}` });
  }
};
