// Rotation lock while playing on a touch device: lying down turns the phone, the picture must not
// turn with it. Android Chrome allows screen.orientation.lock() in fullscreen; iOS Safari has
// neither, there the player switches on the lock in Control Center (one quiet hint).

type Lockable = ScreenOrientation & { lock?: (o: string) => Promise<void>; unlock?: () => void };

let held = false;

/** Some embedded browsers never answer: after a while that counts as no. */
function within<T>(p: Promise<T>, ms = 2000): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}

/** Fullscreen and the current orientation locked; false where the browser does not allow it. Needs a tap. */
export async function lockRotation(): Promise<boolean> {
  const o = screen.orientation as Lockable | undefined;
  if (!o || typeof o.lock !== 'function') return false;
  if (held && document.fullscreenElement) return true;
  const root = document.documentElement;
  let enteredFullscreen = false;
  try {
    if (!document.fullscreenElement && typeof root.requestFullscreen === 'function') {
      enteredFullscreen = true;
      await within(root.requestFullscreen({ navigationUI: 'hide' }));
    }
    await within(o.lock(o.type));
    held = true;
    return true;
  } catch {
    // no lock: no fullscreen either, it would only cover the browser's own controls
    if (enteredFullscreen && document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
    return false;
  }
}

/** Leaving the game: the screen turns again and fullscreen ends. */
export function unlockRotation(): void {
  if (!held) return;
  held = false;
  try {
    (screen.orientation as Lockable | undefined)?.unlock?.();
  } catch {
    /* already unlocked */
  }
  if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
}

/** The hint where locking is not possible (iOS: Control Center, Android: quick settings). */
export function rotationHint(): string {
  // navigator.standalone exists only in Safari on iPhone and iPad
  return 'standalone' in navigator
    ? 'Für das Spielen im Liegen die Drehsperre im Kontrollzentrum einschalten.'
    : 'Für das Spielen im Liegen „Automatisch drehen“ in den Schnelleinstellungen ausschalten.';
}
