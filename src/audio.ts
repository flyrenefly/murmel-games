// Sound effects: Enigma's samples (public/sounds/, converted to PCM WAV by
// tools/convert-sounds.mjs), mapped to game events as in Enigma's
// data/sound-defaults.lua. Played through Web Audio for low latency.

const SAMPLES = ['st-stone', 'st-oxydopen', 'st-oxydopened', 'shatter', 'menuok', 'menumove'] as const;
type Sample = (typeof SAMPLES)[number];

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly buffers = new Map<Sample, AudioBuffer>();
  private lastStone = 0;
  muted = false;

  /** Must be called from a user gesture (browser autoplay rules). */
  unlock(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(this.ctx.destination);
      void this.load(this.ctx);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private async load(ctx: AudioContext): Promise<void> {
    const base = `${import.meta.env.BASE_URL}sounds/`;
    await Promise.all(
      SAMPLES.map(async (name) => {
        try {
          const res = await fetch(`${base}${name}.wav`);
          this.buffers.set(name, await ctx.decodeAudioData(await res.arrayBuffer()));
        } catch {
          /* a missing sound must never stop the game */
        }
      }),
    );
  }

  private play(name: Sample, volume = 1, delay = 0): void {
    const buf = this.buffers.get(name);
    if (!this.ctx || !this.master || !buf || this.muted) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = volume;
    src.connect(g).connect(this.master);
    src.start(this.ctx.currentTime + delay);
  }

  /** Marble bounces off a stone (Enigma: max(0.25, v/8), at most 1). */
  stone(speed: number): void {
    const now = performance.now();
    if (now - this.lastStone < 40) return; // corner hits come in pairs
    this.lastStone = now;
    this.play('st-stone', Math.min(1, Math.max(0.25, speed / 8)));
  }

  /** A single Oxyd stone opens. */
  open(): void {
    this.play('st-oxydopen');
  }

  /** A pair opens: Enigma plays both sounds together. */
  solved(): void {
    this.play('st-oxydopen');
    this.play('st-oxydopened');
  }

  /** Enigma has no sound for closing Oxyd stones. */
  close(): void {}

  /** Marble falls into the abyss: shatter sound when the fall animation ends. */
  fall(delaySeconds: number): void {
    this.play('shatter', 0.8, delaySeconds);
  }

  win(): void {
    this.play('menuok');
  }

  menu(): void {
    this.play('menumove', 0.6);
  }
}
