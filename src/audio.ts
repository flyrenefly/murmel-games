// Sound effects: Enigma's samples (public/sounds/, converted to PCM WAV by
// tools/convert-sounds.mjs), mapped to game events as in Enigma's
// data/sound-defaults.lua. Played through Web Audio for low latency.

const SAMPLES = [
  'st-stone',
  'st-oxydopen',
  'st-oxydopened',
  'shatter',
  'menuok',
  'menumove',
  'st-switch',
  'st-metal',
  'it-triggerdown',
  'it-triggerup',
  'pickup',
  'st-move',
  'quake',
  'explosion0',
  'swamped',
  'st-fakeoxyd',
  'explosion2',
  'boink',
  'st-mirrorturn',
  'st-laser',
  'explosion1',
  // obj:sound in level scripts (Acoustic Reminiscence)
  'st-thud',
  'st-coinslot',
  'drown',
  'st-magic',
  'boing',
  'switch',
] as const;
type Sample = (typeof SAMPLES)[number];

/**
 * Enigma's sound events (data/sound-defaults.lua soundtable_enigma) whose sample Murmel has, for
 * obj:sound(name) in level scripts: sample and volume. Events without a file are silent.
 */
const ENIGMA_EVENTS: Record<string, Sample | [Sample, number]> = {
  bomb_black: 'explosion1',
  bomb_white: 'explosion1',
  cloth: 'st-thud',
  coinsloton: 'st-coinslot',
  drown: 'drown',
  dynamite: 'explosion2',
  electric: 'st-stone',
  fakeoxyd: ['st-fakeoxyd', 0.3],
  fourswitch: 'st-switch',
  glass: 'st-metal',
  itemtransform: 'st-magic',
  jump: 'boink',
  landmine: 'explosion2',
  laseron: 'st-laser',
  menumove: 'menumove',
  menuok: 'menuok',
  metal: 'st-metal',
  mirrorturn: 'st-mirrorturn',
  movebig: 'st-move',
  moveslow: 'st-move',
  movesmall: 'st-move',
  oxydopen: 'st-oxydopen',
  oxydopened: 'st-oxydopened',
  pickup: 'pickup',
  puzzlerotate: 'st-move',
  quake: 'quake',
  rubberband: 'boing',
  shatter: 'shatter',
  shattersmall: 'shatter',
  shuffle: 'switch',
  stone: 'st-stone',
  stonedestroy: 'explosion0',
  stonepaint: 'st-magic',
  stonetransform: 'st-magic',
  swamp: 'swamped',
  switchon: 'st-switch',
  switchplayer: 'switch',
  triggerdown: 'it-triggerdown',
  triggerup: 'it-triggerup',
};

/** The sample of an Enigma sound event, or null when it is silent (empty, missing file, unknown). */
export function enigmaSample(name: string): { sample: Sample; volume: number } | null {
  const e = Object.hasOwn(ENIGMA_EVENTS, name) ? ENIGMA_EVENTS[name] : undefined;
  if (!e) return null;
  return typeof e === 'string' ? { sample: e, volume: 1 } : { sample: e[0], volume: e[1] };
}

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

  /** Enigma: st_switch turning (switchon), its collision sound is metal. */
  switchOn(): void {
    this.play('st-switch');
  }

  metal(speed: number): void {
    this.play('st-metal', Math.min(1, Math.max(0.25, speed / 8)));
  }

  trigger(down: boolean): void {
    this.play(down ? 'it-triggerdown' : 'it-triggerup');
  }

  /** Enigma stonedestroy (puzzle stones exploding). */
  explode(): void {
    this.play('explosion0', 0.7);
  }

  quake(): void {
    this.play('quake');
  }

  /** A bomb explodes (sound-defaults.lua: bomb_black/_white = enigma/explosion1). */
  bomb(): void {
    this.play('explosion1', 0.8);
  }

  /** A mirror turns (sound-defaults.lua: mirrorturn = enigma/st-mirrorturn). */
  mirror(): void {
    this.play('st-mirrorturn');
  }

  /** A laser beam appears (laseron = enigma/st-laser). */
  laser(): void {
    this.play('st-laser', 0.6);
  }

  /** A fake stone (st_fake_quake) is hit. */
  fakeOxyd(): void {
    this.play('st-fakeoxyd');
  }

  /** obj:sound(name, volume) in a level script: an Enigma sound event (silent if Murmel lacks it). */
  enigma(name: string, volume = 1): void {
    const e = enigmaSample(name);
    if (e) this.play(e.sample, Math.min(1, Math.max(0, e.volume * volume)));
  }

  /** The marble jumps (sound-defaults.lua: jump = enigma/boink). */
  jump(): void {
    this.play('boink', 0.8);
  }

  /** A landmine explodes (sound-defaults.lua: landmine = explosion2). */
  landmine(): void {
    this.play('explosion2', 0.8);
  }

  /** The marble sank in the swamp. */
  swamped(): void {
    this.play('swamped');
  }

  /** A stone is pushed one cell (Enigma: movesmall). */
  move(): void {
    this.play('st-move');
  }

  pickup(): void {
    this.play('pickup');
  }

  /** Marble shatters at once (door closed over it). */
  shatter(): void {
    this.play('shatter', 0.8);
  }

  win(): void {
    this.play('menuok');
  }

  menu(): void {
    this.play('menumove', 0.6);
  }
}
