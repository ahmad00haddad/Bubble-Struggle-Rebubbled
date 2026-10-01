import { NET, TICK_MS, type Snapshot, type TickedEvent } from '@orb/shared';

/**
 * Holds recent server snapshots and estimates the server clock so remote
 * entities can be rendered `interpDelayMs` in the past, always between two
 * real snapshots (smooth even when packets arrive unevenly).
 */
export class SnapshotBuffer {
  private snaps: Snapshot[] = [];
  private offset: number | null = null;
  private events: TickedEvent[] = [];

  clear(): void {
    this.snaps = [];
    this.offset = null;
    this.events = [];
  }

  get latest(): Snapshot | undefined {
    return this.snaps[this.snaps.length - 1];
  }

  push(s: Snapshot, nowMs: number): void {
    const last = this.latest;
    if (last && s.tick <= last.tick) {
      // A new match restarts the tick counter: start over.
      if (s.tick < last.tick - 30) this.clear();
      else return;
    }
    this.snaps.push(s);
    if (this.snaps.length > 64) this.snaps.shift();
    this.events.push(...s.events);

    const sample = s.tick - nowMs / TICK_MS;
    if (this.offset === null || Math.abs(sample - this.offset) > 30) this.offset = sample;
    else if (sample > this.offset) this.offset += (sample - this.offset) * 0.5; // packet came early: trust it
    else this.offset += (sample - this.offset) * 0.03; // late packet: drift slowly
  }

  renderTick(nowMs: number): number {
    if (this.offset === null) return 0;
    return nowMs / TICK_MS + this.offset - NET.interpDelayMs / TICK_MS;
  }

  /** Snapshot pair surrounding the render tick. */
  frame(rt: number): { a: Snapshot; b: Snapshot | null } | null {
    const s = this.snaps;
    if (s.length === 0) return null;
    let i = s.length - 1;
    while (i > 0 && s[i].tick > rt) i--;
    return { a: s[i], b: s[i + 1] ?? null };
  }

  /** Events whose tick has been reached by the render clock. */
  takeEvents(rt: number): TickedEvent[] {
    if (this.events.length === 0) return [];
    const due: TickedEvent[] = [];
    const keep: TickedEvent[] = [];
    for (const e of this.events) (e.tick <= rt ? due : keep).push(e);
    this.events = keep;
    return due;
  }
}
