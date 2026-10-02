import { SPECIAL } from '../../constants/game';
import type { SpecialDef } from './index';

/**
 * Hardshell: the first hit does not split it. It turns enraged (faster, same bounce
 * shape as a fast orb) and the second hit splits it normally. Children are ordinary.
 * Any shooter counts, so two harpoons landing in the same tick pop it at once.
 */
export const hardshell: SpecialDef = {
  kind: 'hardshell',
  onHit(host, b) {
    if (b.rage) return 'pop';
    b.rage = true;
    // Scaling velocity by the speed factor keeps the arc shape (gravity scales with its square).
    b.vx *= SPECIAL.hardshell.rageMul;
    b.vy *= SPECIAL.hardshell.rageMul;
    host.emit('enrage', b);
    return 'absorb';
  },
};
