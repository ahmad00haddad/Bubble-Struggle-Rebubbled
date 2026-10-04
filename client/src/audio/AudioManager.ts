import { getSettings } from '../config/settings';

export type SoundKey =
  | 'shoot'
  | 'hit'
  | 'split'
  | 'destroy'
  | 'damage'
  | 'shieldBreak'
  | 'death'
  | 'pickup'
  | 'levelComplete'
  | 'victory'
  | 'gameOver'
  | 'boom'
  | 'click'
  | 'tick'
  | 'go'
  | 'enrage'
  | 'warn'
  | 'sky'
  | 'heat'
  | 'chaos'
  | 'swap'
  | 'deny'
  | 'sync'
  | 'seq'
  | 'combo'
  | 'fuse'
  | 'anchor';

type Recipe = (ctx: AudioContext, out: AudioNode, t: number, opt: { pitch: number }) => void;

/**
 * Modular audio. Every sound has a key. By default each key plays an original
 * synthesized placeholder (Web Audio, no files). To replace a sound with a real
 * asset call `audio.load('pop', '/audio/pop.ogg')` — loaded buffers take
 * priority over the synth recipe for that key.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<SoundKey, AudioBuffer>();
  private lastPlayed = new Map<SoundKey, number>();

  /** Must be called from a user gesture at least once (browser autoplay rules). */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.applyVolume();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** A stream of everything the game plays (for clip recording), or null before audio is unlocked. */
  stream(): MediaStream | null {
    if (!this.ctx || !this.master || typeof this.ctx.createMediaStreamDestination !== 'function') return null;
    if (!this.tap) {
      this.tap = this.ctx.createMediaStreamDestination();
      this.master.connect(this.tap);
    }
    return this.tap.stream;
  }
  private tap: MediaStreamAudioDestinationNode | null = null;

  applyVolume(): void {
    if (!this.master) return;
    const s = getSettings();
    this.master.gain.value = s.muted ? 0 : s.volume * 0.6;
  }

  async load(key: SoundKey, url: string): Promise<void> {
    this.unlock();
    if (!this.ctx) return;
    const data = await (await fetch(url)).arrayBuffer();
    this.buffers.set(key, await this.ctx.decodeAudioData(data));
  }

  play(key: SoundKey, opt: { pitch?: number } = {}): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state !== 'running') return;
    // Avoid stacking identical sounds in the same frame (e.g. multi-pops).
    const now = performance.now();
    if (now - (this.lastPlayed.get(key) ?? 0) < 25) return;
    this.lastPlayed.set(key, now);

    const buf = this.buffers.get(key);
    if (buf) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = opt.pitch ?? 1;
      src.connect(this.master);
      src.start();
      return;
    }
    RECIPES[key](ctx, this.master, ctx.currentTime + 0.005, { pitch: opt.pitch ?? 1 });
  }
}

// ---------------------------------------------------------------------------
// Synth helpers + recipes (all original)
// ---------------------------------------------------------------------------

function tone(ctx: AudioContext, out: AudioNode, t: number, type: OscillatorType, f0: number, f1: number, dur: number, vol: number): void {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
}

let noiseBuf: AudioBuffer | null = null;
function noise(ctx: AudioContext, out: AudioNode, t: number, dur: number, vol: number, freq: number): void {
  if (!noiseBuf || noiseBuf.sampleRate !== ctx.sampleRate) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = 1.2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(out);
  src.start(t);
  src.stop(t + dur + 0.02);
}

function arp(ctx: AudioContext, out: AudioNode, t: number, notes: number[], step: number, type: OscillatorType, vol: number): void {
  notes.forEach((n, i) => tone(ctx, out, t + i * step, type, n, n * 1.01, step * 1.6, vol));
}

const RECIPES: Record<SoundKey, Recipe> = {
  shoot: (c, o, t) => {
    tone(c, o, t, 'square', 380, 1250, 0.09, 0.12);
    noise(c, o, t, 0.06, 0.08, 3200);
  },
  hit: (c, o, t, { pitch }) => tone(c, o, t, 'triangle', 900 * pitch, 500 * pitch, 0.08, 0.2),
  split: (c, o, t, { pitch }) => {
    tone(c, o, t, 'sine', 520 * pitch, 260 * pitch, 0.14, 0.28);
    noise(c, o, t, 0.1, 0.12, 1800 * pitch);
  },
  destroy: (c, o, t, { pitch }) => {
    tone(c, o, t, 'sine', 1100 * pitch, 1700 * pitch, 0.1, 0.22);
    tone(c, o, t + 0.04, 'triangle', 1600 * pitch, 2400 * pitch, 0.08, 0.12);
  },
  damage: (c, o, t) => {
    tone(c, o, t, 'sawtooth', 300, 70, 0.35, 0.22);
    noise(c, o, t, 0.25, 0.2, 600);
  },
  shieldBreak: (c, o, t) => {
    noise(c, o, t, 0.3, 0.25, 4000);
    tone(c, o, t, 'triangle', 1400, 400, 0.25, 0.15);
  },
  death: (c, o, t) => arp(c, o, t, [523, 392, 330, 196], 0.09, 'square', 0.12),
  pickup: (c, o, t) => arp(c, o, t, [660, 880, 1320], 0.05, 'square', 0.1),
  levelComplete: (c, o, t) => arp(c, o, t, [523, 659, 784, 1047, 784, 1047], 0.09, 'square', 0.11),
  victory: (c, o, t) => {
    arp(c, o, t, [523, 659, 784, 1047], 0.12, 'square', 0.11);
    arp(c, o, t + 0.5, [880, 1047, 1319, 1568], 0.1, 'triangle', 0.12);
  },
  gameOver: (c, o, t) => arp(c, o, t, [392, 349, 311, 262, 196], 0.16, 'triangle', 0.16),
  boom: (c, o, t) => {
    noise(c, o, t, 0.6, 0.45, 300);
    tone(c, o, t, 'sawtooth', 160, 40, 0.5, 0.25);
  },
  click: (c, o, t) => tone(c, o, t, 'square', 1200, 900, 0.04, 0.08),
  tick: (c, o, t) => tone(c, o, t, 'square', 660, 660, 0.12, 0.12),
  go: (c, o, t) => tone(c, o, t, 'square', 1320, 1320, 0.3, 0.13),
  enrage: (c, o, t) => {
    tone(c, o, t, 'sawtooth', 180, 520, 0.22, 0.2);
    noise(c, o, t, 0.15, 0.15, 1400);
  },
  warn: (c, o, t) => {
    tone(c, o, t, 'square', 880, 880, 0.09, 0.1);
    tone(c, o, t + 0.14, 'square', 880, 880, 0.09, 0.1);
  },
  sky: (c, o, t) => arp(c, o, t, [440, 660, 880], 0.07, 'triangle', 0.13),
  heat: (c, o, t) => {
    tone(c, o, t, 'sawtooth', 140, 70, 0.4, 0.18);
    noise(c, o, t, 0.3, 0.12, 900);
  },
  chaos: (c, o, t) => {
    tone(c, o, t, 'square', 700, 180, 0.28, 0.16);
    tone(c, o, t + 0.05, 'triangle', 180, 900, 0.28, 0.14);
  },
  swap: (c, o, t) => arp(c, o, t, [900, 450, 900, 450], 0.06, 'square', 0.1),
  deny: (c, o, t) => tone(c, o, t, 'square', 240, 110, 0.14, 0.12),
  sync: (c, o, t) => tone(c, o, t, 'triangle', 700, 940, 0.12, 0.2),
  seq: (c, o, t, { pitch }) => tone(c, o, t, 'triangle', 760 * pitch, 980 * pitch, 0.1, 0.2),
  combo: (c, o, t) => arp(c, o, t, [784, 988, 1175, 1568], 0.06, 'square', 0.11),
  fuse: (c, o, t) => tone(c, o, t, 'sawtooth', 520, 300, 0.22, 0.14),
  anchor: (c, o, t) => {
    noise(c, o, t, 0.2, 0.22, 700);
    tone(c, o, t, 'square', 220, 900, 0.12, 0.16);
  },
};

export const audio = new AudioManager();
