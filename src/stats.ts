/**
 * Anonymous play statistics (server: POST /api/event). Only "a level was started" and "a level was
 * solved", with the level id: no cookie, no stored id. The browser sends it in the background
 * (sendBeacon); offline, on the old webspace or in development it silently goes nowhere.
 */
export type StatType = 'start' | 'solve';

interface Env {
  hostname: string;
  doNotTrack?: string | null;
  globalPrivacyControl?: boolean;
  sendBeacon?: (url: string, data: Blob) => boolean;
}

/** Whether this browser may report: not in development, not when the player asks not to be tracked. */
export function statsAllowed(env: Env): boolean {
  if (env.hostname === 'localhost' || env.hostname === '127.0.0.1' || env.hostname === '') return false;
  return env.doNotTrack !== '1' && env.globalPrivacyControl !== true;
}

function browserEnv(): Env {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return {
    hostname: location.hostname,
    doNotTrack: nav.doNotTrack,
    globalPrivacyControl: nav.globalPrivacyControl,
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
