import { LEVELS, Match, TICK_MS, snapshotFromMatch, type Snapshot, type TickedEvent } from '@orb/shared';
import { buildView } from './interpolate';
import type { GameSource, ViewState } from './types';

/**
 * Solo play: runs the exact same shared Match/GameSimulation the server runs,
 * locally in the browser at a fixed 30 Hz, rendered with interpolation at the
 * display refresh rate. No network, no server cost.
 */
export class LocalSource implements GameSource {
  readonly mode = 'solo' as const;
  readonly localSlot = 0;
  readonly levelCount = LEVELS.length;
  private match: Match;
  private acc = 0;
  private prev: Snapshot;
  private curr: Snapshot;
  private events: TickedEvent[] = [];
  private seq = 0;
  private lastBits = 0;

  constructor(private nickname: string, startLevel = 0) {
    this.match = this.newMatch(startLevel);
    this.prev = this.curr = snapshotFromMatch(this.match);
  }

  private newMatch(startLevel: number): Match {
    const m = new Match({ levels: LEVELS, activeSlots: [true], seed: (Math.random() * 2 ** 32) >>> 0, startLevel });
    this.events.push(...m.drainEvents());
    return m;
  }

  get level() {
    return this.match.sim.level;
  }

  names(): string[] {
    return [this.nickname];
  }

  update(dtMs: number, bits: number): void {
    if (bits !== this.lastBits) {
      this.lastBits = bits;
      this.match.sim.setInput(0, bits, ++this.seq);
    }
    this.acc += Math.min(dtMs, 250);
    while (this.acc >= TICK_MS) {
      this.acc -= TICK_MS;
      this.prev = this.curr;
      this.match.advance();
      this.events.push(...this.match.drainEvents());
      this.curr = snapshotFromMatch(this.match);
    }
  }

  view(): ViewState {
    // Interpolate between the last two ticks; prev.tick + alpha.
    const v = buildView(this.prev, this.curr, this.prev.tick + this.acc / TICK_MS, this.match.sim.level);
    // UI fields should reflect the newest tick.
    v.phase = this.curr.phase;
    v.phaseTicks = this.curr.phaseTicks;
    v.timeLeftTicks = this.curr.timeLeftTicks;
    v.levelIndex = this.curr.levelIndex;
    return v;
  }

  drainEvents(): TickedEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  requestPause(): void {
    this.match.pause('player', 0);
    this.events.push(...this.match.drainEvents());
  }

  requestResume(): void {
    this.match.resume();
    this.events.push(...this.match.drainEvents());
  }

  requestRematch(): void {
    this.match = this.newMatch(0);
    this.prev = this.curr = snapshotFromMatch(this.match);
    this.acc = 0;
  }

  destroy(): void {}
}
