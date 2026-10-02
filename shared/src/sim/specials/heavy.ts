import { SPECIAL } from '../../constants/game';
import { arm, bit, disarm, isArmed, popcount, tickArmed } from './armed';
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
    const need = needed(host);
    if (need <= 1) {
      host.emit('heavyDone', b);
      return 'pop';
    }
    if (!isArmed(b)) {
      arm(b, SPECIAL.heavy.window, bit(hit.owner));
      host.emit('heavyHit', b);
      return 'absorb';
    }
    if (((b.hm ?? 0) & bit(hit.owner)) !== 0) {
      host.emit('deny', b);
      return 'absorb';
    }
    b.hm = (b.hm ?? 0) | bit(hit.owner);
    if (popcount(b.hm) >= need) {
      host.emit('heavyDone', b);
      disarm(b);
      return 'pop';
    }
    host.emit('heavyHit', b);
    return 'absorb';
  },
};
