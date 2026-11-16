/// <reference lib="webworker" />
// The conversion in its own thread (docs/SPEC-enigma-upload.md): the page stops it after the time
// limit (client.ts), so a script that loops or eats memory only takes this worker down.
import shim from '../lua/enigma.lua?raw';
import type { Fengari } from '../lua/runtime';
import { ladefehler } from '../game/ladefehler';
import { UploadError } from './datei';
import { wandleUm } from './umwandeln';
import { setzeSpracheFuerTest, woerterbuch } from '../i18n';
import EN from '../i18n/en/enigma-upload';

const t = woerterbuch(EN);

self.onmessage = async (e: MessageEvent<{ name: string; text: string; sprache?: string }>) => {
  // the page's choice (localStorage is not available here); without one the worker's own detection applies
  if (e.data.sprache === 'de' || e.data.sprache === 'en') setzeSpracheFuerTest(e.data.sprache);
  try {
    const f = (await import('fengari-web')) as unknown as Fengari;
    const { level, hinweise, herkunft } = await wandleUm(e.data.name, e.data.text, f, shim);
    self.postMessage({ ok: true, level, hinweise, herkunft });
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof UploadError ? err.message : t('Die Umwandlung ist fehlgeschlagen: {grund}', { grund: ladefehler(err instanceof Error ? err.message : String(err)) }) });
  }
};
