/** Small deterministic PRNG (mulberry32). Same seed → same drops on any JS engine. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** Pick a key from a weight table. Returns undefined for an empty table. */
  weighted<K extends string>(table: Partial<Record<K, number>>): K | undefined {
    const entries = Object.entries(table) as [K, number][];
    const total = entries.reduce((a, [, w]) => a + Math.max(0, w), 0);
    if (total <= 0) return undefined;
    let r = this.next() * total;
    for (const [k, w] of entries) {
      r -= Math.max(0, w);
      if (r < 0) return k;
    }
    return entries[entries.length - 1][0];
  }
}
