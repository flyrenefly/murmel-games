// "Als Lösung speichern" (docs/SPEC-loesbarkeit.md): an admin sends a won run to the server, where the
// nightly run replays it with every level check. Players never see the button.
import type { Recording } from './game/session';

type Fetch = typeof fetch;

/** Sends the recording of a win; returns the text to show (never throws). */
export async function loesungSpeichern(rec: Recording, fetchFn: Fetch = (...a) => fetch(...a)): Promise<string> {
  if (rec.result !== 'sieg') return 'Nur gewonnene Läufe sind Lösungen.';
  let res: Response;
  try {
    res = await fetchFn('/api/admin/loesungen', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rec),
    });
  } catch {
    return 'Der Server ist gerade nicht erreichbar. Die Lösung wurde nicht gespeichert.';
  }
  if (res.status === 201) return 'Lösung gespeichert – sie wird jede Nacht nachgespielt.';
  if (res.status === 200) return 'Diese Lösung ist schon gespeichert.';
  if (res.status === 401 || res.status === 403) return 'Nur angemeldete Admins können Lösungen speichern.';
  let msg = '';
  try {
    msg = String(((await res.json()) as { error?: unknown }).error ?? '');
  } catch {
    // no JSON: the static copy without API
  }
  return res.status === 400 && msg ? `Nicht gespeichert: ${msg}` : 'Der Server ist gerade nicht erreichbar. Die Lösung wurde nicht gespeichert.';
}
