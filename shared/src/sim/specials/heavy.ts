import { SPECIAL } from '../../constants/game';
import { arm, bit, disarm, isArmed, popcount, tickArmed } from './armed';
import type { BubbleState } from '../../types/state';
import type { HitResult, SpecialDef, SpecialHost } from './index';

/** Distinct shooters needed: ceil(players / 2), never below the minimum while a team can still play. */
function needed(host: SpecialHost): number {
  const live = host.activePlayers();
  if (live < 2) return 1;
  const want = Math.max(SPECIAL.heavy.minShooters, Math.ceil(host.scale.players / 2));
  return Math.min(want, live);
}

/**
 * Heavy: multiplayer only. Needs hits from several different Lancers within a window that
 * starts at the first hit. Solo never meets it: the level load turns it into an ordinary
 * orb. If partners fall or leave mid-level the requirement shrinks to who is left.
 */
/** Shared hit logic for Heavy and Quad-lock: gather `need` different shooters inside the window. */
function gather(host: SpecialHost, b: BubbleState, owner: number, need: number, window: number): HitResult {
  if (need <= 1) {
    host.emit('heavyDone', b);
    return 'pop';
  }
  if (!isArmed(b)) {
    arm(b, window, bit(owner));
    host.emit('heavyHit', b);
    return 'absorb';
  }
  if (((b.hm ?? 0) & bit(owner)) !== 0) {
    host.emit('deny', b);
    return 'absorb';
  }
  b.hm = (b.hm ?? 0) | bit(owner);
  if (popcount(b.hm) >= need) {
    host.emit('heavyDone', b);
    disarm(b);
    return 'pop';
  }
  host.emit('heavyHit', b);
  return 'absorb';
}

export const heavy: SpecialDef = {
  kind: 'heavy',
  init(host, b) {
    if (host.scale.players < 2) {
      delete b.sp;
      return;
    }
    b.sa = 0;
    b.hm = 0;
  },
  onTick(host, b, dt) {
    tickArmed(host, b, dt, 'heavyFail');
  },
  onHit(host, b, hit): HitResult {
    return gather(host, b, hit.owner, needed(host), SPECIAL.heavy.window * host.windowMul(hit.owner));
  },
};

/**
 * Quad-lock: the four-player finale orb. Needs four different shooters inside the window.
 * With fewer than four players the level load turns it into Heavy (2-3 players) or an
 * ordinary orb (solo). If Lancers fall mid-level the requirement shrinks to who is left.
 */
export const quad: SpecialDef = {
  kind: 'quad',
  init(host, b) {
    if (host.scale.quad) {
      b.sa = 0;
      b.hm = 0;
    } else if (host.scale.players >= 2) {
      b.sp = 'heavy';
      b.sa = 0;
      b.hm = 0;
    } else delete b.sp;
  },
  onTick(host, b, dt) {
    tickArmed(host, b, dt, 'heavyFail');
  },
  onHit(host, b, hit): HitResult {
    const live = host.activePlayers();
    return gather(host, b, hit.owner, live < 2 ? 1 : Math.min(4, live), SPECIAL.quad.window * host.windowMul(hit.owner));
  },
};
