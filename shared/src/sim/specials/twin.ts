import { SPECIAL, type BubbleSize } from '../../constants/game';
import type { SpecialDef } from './index';

/**
 * Twin Fuse: two linked orbs (`lk` holds the partner id; the simulation links the two
 * spawns of one `group`). Popping one starts a fuse (`sa` seconds) on the other. Pop the
 * partner in time and nothing else happens. If the fuse runs out, the partner regrows one
 * size (max huge) and becomes an ordinary orb. Children of a popped twin are ordinary.
 */
export const twin: SpecialDef = {
  kind: 'twin',
  init(_host, b) {
    b.sa = 0;
  },
  onTick(host, b, dt) {
    const left = b.sa ?? 0;
    if (left <= 0) return;
    if (left - dt > 0) {
      b.sa = left - dt;
      return;
    }
    // Fuse expired: partial regeneration, link and special behaviour end here.
    if (b.size < 3) b.size = (b.size + 1) as BubbleSize;
    host.emit('fuseFail', b);
    delete b.sp;
    delete b.sa;
    delete b.lk;
  },
  onPop(host, b) {
    if ((b.sa ?? 0) > 0) {
      // This orb was the one on the fuse: the pair is done in time.
      host.emit('fuseSave', b);
      return;
    }
    const partner = b.lk === undefined ? undefined : host.bubbleById(b.lk);
    if (!partner || partner.sp !== 'twin') return;
    partner.sa = host.scale.players === 1 ? SPECIAL.twin.fuseSecondsSolo : SPECIAL.twin.fuseSeconds;
    host.emit('fuseStart', partner);
  },
};
