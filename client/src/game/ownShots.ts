import { HARPOON, PLAYER, WORLD, type NetHarpoon } from '@orb/shared';

/** What the renderer needs to draw one tether. */
export interface ShotView {
  id: number;
  owner: number;
  x: number;
  tipY: number;
  anchor?: boolean;
  ttl?: number;
  wide?: boolean;
  bm?: 0 | 1;
}

/** A predicted tether is dropped after this long: it has flown to the ceiling by then. */
const LIFETIME_MS = 620;
/** Presses closer together than this are ignored (the server has a 0.18 s cooldown). */
const MIN_GAP_MS = 180;

/**
 * Makes your own tether feel instant online. The server decides everything; this only draws.
 *  - When you press fire, a tether starts rising from your Lancer at once (cosmetic).
 *  - When the server's own tether for that shot shows up in a snapshot, the real one takes over.
 *  - Real tethers of yours are drawn from the newest snapshot (not the delayed one other players
 *    are drawn from), advanced by the time since it arrived.
 * If the server refuses a shot (cooldown, jam, dead), the guess disappears on its own.
 */
export class OwnShots {
  private pending: { x: number; t0: number }[] = [];
  private seen = new Set<number>();
  private lastPress = -Infinity;

  constructor(private slot: number) {}

  reset(): void {
    this.pending = [];
    this.seen.clear();
    this.lastPress = -Infinity;
  }

  /** Call on a fresh fire press. `canFire` is the client's guess: playing, alive, not jammed. */
  press(x: number, nowMs: number, canFire: boolean, max: number, liveReal: number): void {
    if (!canFire || nowMs - this.lastPress < MIN_GAP_MS) return;
    this.expire(nowMs);
    if (this.pending.length + liveReal >= max) return;
    this.lastPress = nowMs;
    this.pending.push({ x, t0: nowMs });
  }

  /** Feed every snapshot as it arrives so a real tether can replace its guess. */
  onSnapshot(harpoons: readonly NetHarpoon[]): void {
    const ids = new Set(harpoons.map((h) => h.id));
    for (const h of harpoons) {
      if (h.owner !== this.slot || this.seen.has(h.id)) continue;
      this.seen.add(h.id);
      this.pending.shift(); // the oldest guess is now real
    }
    for (const id of this.seen) if (!ids.has(id) && this.seen.size > 64) this.seen.delete(id);
  }

  /** Own tethers to draw: real ones from the newest snapshot, plus guesses not yet confirmed. */
  visible(latest: readonly NetHarpoon[], arrivedMs: number, nowMs: number): ShotView[] {
    this.expire(nowMs);
    const out: ShotView[] = [];
    const elapsed = Math.max(0, nowMs - arrivedMs) / 1000;
    for (const h of latest) {
      if (h.owner !== this.slot) continue;
      // Only a plain upward tether can be advanced safely; anchors and boomerangs are drawn as received.
      const flying = !h.anchor && h.bm === undefined;
      out.push({ ...h, tipY: flying ? Math.max(0, h.tipY - HARPOON.speed * elapsed) : h.tipY });
    }
    this.pending.forEach((p, i) => {
      out.push({ id: -1 - i, owner: this.slot, x: p.x, tipY: Math.max(0, WORLD.height - PLAYER.height - HARPOON.speed * ((nowMs - p.t0) / 1000)) });
    });
    return out;
  }

  /** Number of unconfirmed guesses (for tests and the client's own limit check). */
  get guesses(): number {
    return this.pending.length;
  }

  private expire(nowMs: number): void {
    this.pending = this.pending.filter((p) => nowMs - p.t0 < LIFETIME_MS);
  }
}
