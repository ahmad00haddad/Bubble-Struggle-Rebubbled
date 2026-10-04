import type { SimEvent } from '../types/state';

/**
 * End-of-match awards ("who ruined it"). Pure bookkeeping over the event stream the clients
 * already receive, so it decides nothing in the game: no score, no lives, just names on a card.
 */
export const AWARD_KINDS = ['firstOut', 'magnet', 'blamed', 'bulldozer', 'hero', 'troll', 'closer', 'sniper', 'victim'] as const;
export type AwardKind = (typeof AWARD_KINDS)[number];

export interface Award {
  kind: AwardKind;
  slot: number;
  /** The number behind it (deaths, blames, pops...). */
  n: number;
}

export interface Blame {
  /** Who died, who got the blame, and how. */
  p: number;
  b: number;
  c: string;
}

type Counter = Record<number, number>;
const inc = (c: Counter, slot: number, by = 1) => (c[slot] = (c[slot] ?? 0) + by);

export class AwardTally {
  private deaths: Counter = {};
  private blamed: Counter = {};
  private shoves: Counter = {};
  private flares: Counter = {};
  private chaosBy: Counter = {};
  private chaosTo: Counter = {};
  private pops: Counter = {};
  private closes: Counter = {};
  private firstDeath = -1;
  private lastPopBy = -1;
  /** Every blamed death, oldest first. */
  readonly blames: Blame[] = [];
  /** The last death of the match (for the blame card). */
  lastDeath: { p: number; c?: string; b?: number } | null = null;

  add(e: SimEvent): void {
    switch (e.k) {
      case 'die':
        inc(this.deaths, e.p);
        if (this.firstDeath < 0) this.firstDeath = e.p;
        this.lastDeath = { p: e.p, c: e.c, b: e.b };
        if (e.b !== undefined) {
          inc(this.blamed, e.b);
          this.blames.push({ p: e.p, b: e.b, c: e.c ?? 'orb' });
        }
        break;
      case 'shove':
        inc(this.shoves, e.p);
        break;
      case 'pickup':
        if (e.type === 'flare') inc(this.flares, e.p);
        break;
      case 'chaos':
        if (e.by >= 0 && e.to >= 0 && e.t !== 'end' && e.t !== 'fizzle') {
          inc(this.chaosBy, e.by);
          inc(this.chaosTo, e.to);
        }
        break;
      case 'pop':
        if (e.by >= 0) {
          inc(this.pops, e.by);
          this.lastPopBy = e.by;
        }
        break;
      case 'clear':
        if (this.lastPopBy >= 0) inc(this.closes, this.lastPopBy);
        break;
    }
  }

  /**
   * One award per Lancer at most, the funniest (most toxic) ones first. Needs 2+ players:
   * awards for a solo run would only ever name you.
   */
  awards(slots: readonly number[]): Award[] {
    if (slots.length < 2) return [];
    const taken = new Set<number>();
    const out: Award[] = [];
    const top = (c: Counter, min = 1): { slot: number; n: number } | null => {
      let best: { slot: number; n: number } | null = null;
      let tie = false;
      for (const s of slots) {
        const n = c[s] ?? 0;
        if (n < min) continue;
        if (!best || n > best.n) {
          best = { slot: s, n };
          tie = false;
        } else if (n === best.n) tie = true;
      }
      return best && !tie ? best : null;
    };
    const give = (kind: AwardKind, w: { slot: number; n: number } | null) => {
      if (w && !taken.has(w.slot)) {
        taken.add(w.slot);
        out.push({ kind, slot: w.slot, n: w.n });
      }
    };
    give('blamed', top(this.blamed));
    give('magnet', top(this.deaths, 2));
    give('bulldozer', top(this.shoves, 3));
    give('troll', top(this.chaosBy));
    give('hero', top(this.flares));
    if (this.firstDeath >= 0 && slots.includes(this.firstDeath)) give('firstOut', { slot: this.firstDeath, n: 1 });
    give('victim', top(this.chaosTo, 2));
    give('closer', top(this.closes));
    give('sniper', top(this.pops));
    return out;
  }
}
