import { POWERUP, moveFxFromPlayers, type TickedEvent } from '@orb/shared';
import type { NetSession } from '../networking/NetSession';
import { buildView } from './interpolate';
import type { GameSource, ViewState } from './types';

/**
 * Online play: renders the authoritative server state. Remote entities are
 * interpolated ~100 ms in the past; the local Lancer is predicted and
 * reconciled. Nothing here decides game outcomes.
 */
export class NetSource implements GameSource {
  readonly mode = 'online' as const;
  private rt = 0;

  constructor(readonly session: NetSession) {}

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
      me && me.speed > 0 ? POWERUP.speedMultiplier : 1,
      latest ? moveFxFromPlayers(latest.players, s.slot) : undefined,
    );
    this.rt = s.buffer.renderTick(performance.now());
  }

  view(): ViewState | null {
    const s = this.session;
    const f = s.buffer.frame(this.rt);
    if (!f) return null;
    const v = buildView(f.a, f.b, this.rt, s.level);
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
    return v;
  }

  drainEvents(): TickedEvent[] {
    return this.session.buffer.takeEvents(this.rt);
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
