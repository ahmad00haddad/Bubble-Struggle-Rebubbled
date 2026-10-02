import { SPECIAL } from '../../constants/game';
import { arm, disarm, isArmed, tickArmed } from './armed';
import type { SpecialDef } from './index';

const LEFT = 1;
const RIGHT = 2;

/**
 * Pincer: needs a hit on its left side and a hit on its right side inside a window.
 * A harpoon only rises straight up from under the orb, so a "side" is the side of the orb's
 * centre line the harpoon crosses at impact. Multiplayer needs a clear margin off centre
 * (two Lancers aiming at opposite edges); a hit on the centre line makes no progress.
 * With one living Lancer the margin is dropped and the window is longer. Any shooter counts.
 */
export const pincer: SpecialDef = {
  kind: 'pincer',
  init(_host, b) {
    b.sa = 0;
    b.hm = 0;
  },
  onTick(host, b, dt) {
    tickArmed(host, b, dt, 'pincerFail');
  },
  onHit(host, b, hit) {
    const alone = host.activePlayers() < 2;
    const dx = hit.x - b.x;
    const margin = alone ? 0 : SPECIAL.pincer.deadband;
    const side = dx < -margin ? LEFT : dx > margin ? RIGHT : 0;
    if (side === 0) {
      host.emit('deny', b);
      return 'absorb';
    }
    if (!isArmed(b)) {
      arm(b, alone ? SPECIAL.pincer.windowSolo : SPECIAL.pincer.window, side);
      host.emit('pincerArm', b);
      return 'absorb';
    }
    if (((b.hm ?? 0) & side) !== 0) {
      host.emit('deny', b);
      return 'absorb';
    }
    host.emit('pincerDone', b);
    disarm(b);
    return 'pop';
  },
};
