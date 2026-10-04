import { SPECIAL } from '../../constants/game';
import { arm, bit, disarm, isArmed, tickArmed } from './armed';
import type { SpecialDef } from './index';

/**
 * Sync: the first hit arms a window; a hit from a *different* Lancer inside it splits the
 * orb. The same Lancer hitting again is wasted ('deny'). When only one Lancer can still
 * play (solo, or partners knocked out or gone) the same Lancer may land both hits, with a
 * longer window, so a Sync orb can never become unbeatable.
 */
export const sync: SpecialDef = {
  kind: 'sync',
  init(_host, b) {
    b.sa = 0;
    b.hm = 0;
  },
  onTick(host, b, dt) {
    tickArmed(host, b, dt, 'syncFail');
  },
  onHit(host, b, hit) {
    const alone = host.activePlayers() < 2;
    if (!isArmed(b)) {
      arm(b, (alone ? SPECIAL.sync.windowSolo : SPECIAL.sync.window) * host.windowMul(hit.owner), bit(hit.owner));
      host.emit('syncArm', b);
      return 'absorb';
    }
    if (!alone && ((b.hm ?? 0) & bit(hit.owner)) !== 0) {
      host.emit('deny', b);
      return 'absorb';
    }
    host.emit('syncDone', b);
    disarm(b);
    return 'pop';
  },
};
