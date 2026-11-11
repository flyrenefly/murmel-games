// Small synthesized sound effects (Web Audio): no audio files to download.

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;

  /** Must be called from a user gesture (browser autoplay rules). */
  unlock(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 1, slideTo?: number, delay = 0): void {
    if (!this.ctx || !this.master || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  open(symbol: string): void {
    const n = symbol.charCodeAt(0) - 65;
    const scale = [0, 2, 4, 7, 9, 12, 14, 16];
    this.tone(440 * Math.pow(2, scale[n % scale.length] / 12), 0.35, 'triangle', 0.6);
  }

  solved(): void {
    [523.25, 659.25, 783.99].forEach((f, i) => this.tone(f, 0.45, 'triangle', 0.45, undefined, i * 0.07));
  }

  mismatch(): void {
    this.tone(180, 0.25, 'square', 0.18, 140);
  }

  close(): void {
    this.tone(260, 0.12, 'sine', 0.2, 200);
  }

  wall(speed: number): void {
    if (speed < 1.2) return;
    this.tone(120 + Math.random() * 30, 0.06, 'sine', Math.min(speed / 10, 0.7));
  }

  fall(): void {
    this.tone(520, 0.6, 'sine', 0.5, 70);
  }

  win(): void {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, 0.6, 'triangle', 0.5, undefined, i * 0.12));
  }
}
