/**
 * Anonymous play statistics (server: POST /api/event). Only "a level was started" and "a level was
 * solved", with the level id: no cookie, no stored id. The browser sends it in the background
 * (sendBeacon); offline, on the old webspace or in development it silently goes nowhere. The player can
 * switch all statistics off under „Fortschritt“ (also the Auswertung, docs/SPEC-auswertung.md).
 */
export type StatType = 'start' | 'solve';

interface Env {
  hostname: string;
  doNotTrack?: string | null;
  globalPrivacyControl?: boolean;
  /** The switch „Anonyme Statistik senden“ is off. */
  statistikAus?: boolean;
  sendBeacon?: (url: string, data: Blob) => boolean;
}

/** Whether this browser may report: not in development, not when the player asks not to be tracked or switched it off. */
export function statsAllowed(env: Env): boolean {
  if (env.hostname === 'localhost' || env.hostname === '127.0.0.1' || env.hostname === '') return false;
  return env.doNotTrack !== '1' && env.globalPrivacyControl !== true && env.statistikAus !== true;
}

const AUS_KEY = 'murmel.statistikAus';

/** The switch „Anonyme Statistik senden“ (a setting like style or steering; tolerant of blocked storage). */
export function statistikAus(): boolean {
  try {
    return localStorage.getItem(AUS_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setStatistikAus(aus: boolean): void {
  try {
    if (aus) localStorage.setItem(AUS_KEY, 'true');
    else localStorage.removeItem(AUS_KEY);
  } catch {
    // not stored: on again after a reload
  }
}

export function browserEnv(): Env {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return {
    hostname: location.hostname,
    doNotTrack: nav.doNotTrack,
    globalPrivacyControl: nav.globalPrivacyControl,
    statistikAus: statistikAus(),
    sendBeacon: nav.sendBeacon?.bind(nav),
  };
}

export function reportEvent(type: StatType, level: string, env: Env = browserEnv()): void {
  // levels from links (src/editor) are no shared levels to count
  if (!statsAllowed(env) || !env.sendBeacon || level.startsWith('link:')) return;
  try {
    env.sendBeacon('/api/event', new Blob([JSON.stringify({ type, level })], { type: 'application/json' }));
  } catch {
    // statistics never disturb the game
  }
}
