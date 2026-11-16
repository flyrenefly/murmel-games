import type { FastifyInstance } from 'fastify';
import { FEHLER_EN, FEHLER_MUSTER_EN } from './fehler-en.ts';

/**
 * Language per request (docs/SPEC-englisch.md, „Server“): the game sets Accept-Language to its chosen
 * language on its own API calls. The first language decides: de* → German, anything else → English;
 * no header (or only `*`) → German, as before. Nothing is stored.
 */
export type Sprache = 'de' | 'en';

export function spracheAus(header: string | string[] | undefined): Sprache {
  const raw = Array.isArray(header) ? header[0] : header;
  const first = (raw ?? '').split(',')[0].split(';')[0].trim().toLowerCase();
  if (first === '' || first === '*') return 'de';
  return first === 'de' || first.startsWith('de-') ? 'de' : 'en';
}

export const spracheVon = (req: { headers: { 'accept-language'?: string | string[] } }): Sprache => spracheAus(req.headers['accept-language']);

/** The English text of a German error text; unknown texts (e.g. Fastify's own, already English) stay. */
export function fehlerAufEnglisch(de: string): string {
  const fixed = FEHLER_EN[de];
  if (fixed !== undefined) return fixed;
  for (const [pattern, build] of FEHLER_MUSTER_EN) {
    const m = pattern.exec(de);
    if (m) return build(m, fehlerAufEnglisch);
  }
  return de;
}

/**
 * Translates `error` (and `grund` of a rejected check, `status: 'abgelehnt'`) of JSON answers to English
 * requests. The answer keeps its form; only those texts change. Answers with such a text vary by language.
 */
export function fehlerUebersetzen(app: FastifyInstance): void {
  app.addHook('onSend', async (req, reply, payload) => {
    if (typeof payload !== 'string' || !/^\s*\{/.test(payload) || !/"(error|grund)"/.test(payload)) return payload;
    if (!String(reply.getHeader('content-type') ?? '').includes('json')) return payload;
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(payload);
    } catch {
      return payload;
    }
    const error = typeof body.error === 'string';
    const grund = body.status === 'abgelehnt' && typeof body.grund === 'string';
    if (!error && !grund) return payload;
    reply.header('Vary', varyWith(reply.getHeader('vary')));
    if (spracheVon(req) !== 'en') return payload;
    if (error) body.error = fehlerAufEnglisch(body.error as string);
    if (grund) body.grund = fehlerAufEnglisch(body.grund as string);
    return JSON.stringify(body);
  });
}

function varyWith(current: unknown): string {
  const list = String(current ?? '').split(',').map((v) => v.trim()).filter(Boolean);
  if (list.some((v) => v === '*' || v.toLowerCase() === 'accept-language')) return list.join(', ');
  return [...list, 'Accept-Language'].join(', ');
}
