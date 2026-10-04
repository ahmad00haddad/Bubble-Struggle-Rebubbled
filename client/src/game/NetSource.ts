import { INPUT, moveFxFromPlayers, speedMulOf, CHAOS_KINDS, type TickedEvent } from '@orb/shared';
import type { NetSession } from '../networking/NetSession';
import { MAX_ORB_EXTRAPOLATE_TICKS, buildView } from './interpolate';
import { OwnShots, advanceShot } from './ownShots';
import type { GameSource, ViewState } from './types';

/**
 * Online play: renders the authoritative server state. Remote entities are
 * interpolated ~100 ms in the past; the local Lancer is predicted and
 * reconciled. Nothing here decides game outcomes.
 */
export class NetSource implements GameSource {
  readonly mode = 'online' as const;
  private rt = 0;
  private prevBits = 0;
  private lastSnapTick = -1;
  private readonly shots: OwnShots;

  constructor(readonly session: NetSession) {
    this.shots = new OwnShots(session.slot);
  }

  get localSlot(): number {
    return this.session.slot;
  }
  get level() {
    return this.session.level;
  }
  get levelCount(): number {
    return this.session.levelCount;
  }

  names(): string[] {
    return (this.session.room?.seats ?? []).map((s, i) => s?.name ?? `Player ${i + 1}`);
  }

  update(dtMs: number, bits: number): void {
    const s = this.session;
    s.sendInput(bits);
    const latest = s.buffer.latest;
    const me = latest?.players[s.slot];
    s.prediction.update(
      dtMs,
      latest?.phase === 'playing',
      !!me && me.active && me.life === 'alive',
      me ? speedMulOf(me) : 1,
      latest ? moveFxFromPlayers(latest.players, s.slot, latest.stage) : undefined,
    );
    this.rt = s.buffer.renderTick(performance.now());

    // New snapshot: let real tethers of ours replace their guesses. A restarted tick counter means a new match.
    if (latest && latest.tick !== this.lastSnapTick) {
      if (latest.tick < this.lastSnapTick - 30) this.shots.reset();
      this.lastSnapTick = latest.tick;
      this.shots.onSnapshot(latest.harpoons);
    }
    // Fire press: start our own tether right away (cosmetic; the server still decides).
    if (bits & INPUT.SHOOT && !(this.prevBits & INPUT.SHOOT) && latest && me) {
      const jammed = me.fx > 0 && CHAOS_KINDS[me.fx - 1] === 'jam';
      const canFire = latest.phase === 'playing' && me.active && me.life === 'alive' && !jammed && me.potato <= 0;
      const max = me.dbl > 0 ? 2 : 1;
      const live = latest.harpoons.filter((h) => h.owner === s.slot && h.ttl === undefined).length;
      this.shots.press(s.prediction.displayX, performance.now(), canFire, max, live);
    }
    this.prevBits = bits;
  }

  view(): ViewState | null {
    const s = this.session;
    const f = s.buffer.frame(this.rt);
    if (!f) return null;
    // Orbs follow fixed physics, so they are drawn from the newest snapshot (about one trip behind the
    // server) instead of the delayed pair other players are interpolated from.
    const newest = s.buffer.latest;
    const nowMs = performance.now();
    const orbs = newest ? { snap: newest, ticks: Math.min(MAX_ORB_EXTRAPOLATE_TICKS, Math.max(0, s.buffer.serverTick(nowMs) - newest.tick)) } : undefined;
    const v = buildView(f.a, f.b, this.rt, s.level, orbs);
    v.levelIndex += s.levelOffset;
    const me = v.players[s.slot];
    if (me && me.active && me.life === 'alive') me.x = s.prediction.displayX;
    // HUD values (lives/score/timer) from the newest snapshot feel snappier.
    const latest = s.buffer.latest;
    if (latest) {
      v.timeLeftTicks = latest.timeLeftTicks;
      for (const p of v.players) {
        const lp = latest.players[p.slot];
        if (lp) {
          p.score = lp.score;
          p.lives = lp.lives;
        }
      }
    }
    if (latest) {
      // Tethers go with the orbs: everyone's from the newest snapshot, ours with an instant guess on top.
      const elapsed = Math.max(0, nowMs - s.buffer.latestAt) / 1000;
      const others = latest.harpoons.filter((h) => h.owner !== s.slot).map((h) => advanceShot(h, elapsed));
      v.harpoons = [...others, ...this.shots.visible(latest.harpoons, s.buffer.latestAt, nowMs)];
    }
    return v;
  }

  drainEvents(): TickedEvent[] {
    // Events go with the orbs they describe (pops, splits), so they play as soon as they arrive.
    return this.session.buffer.takeEvents(Infinity);
  }

  requestPause(): void {
    this.session.pause();
  }
  requestResume(): void {
    this.session.resume();
  }
  requestRematch(): void {
    this.session.rematch();
  }
  destroy(): void {}
}
