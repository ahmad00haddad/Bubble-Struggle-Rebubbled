import type { BubbleState } from '../../types/state';
import type { SpecialDef, SpecialHost } from './index';

function members(host: SpecialHost, b: BubbleState): BubbleState[] {
  return host.orbs().filter((o) => o.sp === 'sequence' && o.lk === b.lk);
}

/**
 * Sequence: a set of small numbered orbs (`lk` = group, `n` = place) to be hit 1, 2, 3...
 *  - a correct hit lights the orb (`sa` = 1); it stays in play, harpoons pass through it
 *    so shots are never wasted on a lit orb, and it still hurts like any orb;
 *  - hitting an unlit orb out of order resets the whole set to unlit ('seqReset');
 *  - when the last number is hit, the whole set pops at once, credited to that shooter.
 * Any Lancer may hit any number, so a team can split the order between them.
 */
export const sequence: SpecialDef = {
  kind: 'sequence',
  init(_host, b, spawn) {
    b.lk = spawn.group;
    b.n = spawn.order;
    b.sa = 0;
  },
  harpoonPass(b) {
    return (b.sa ?? 0) >= 1;
  },
  onHit(host, b, hit) {
    const set = members(host, b);
    const next = set.filter((o) => (o.sa ?? 0) < 1).reduce((lo, o) => Math.min(lo, o.n ?? 99), 99);
    if ((b.n ?? 0) !== next) {
      for (const o of set) o.sa = 0;
      host.emit('seqReset', b);
      return 'absorb';
    }
    b.sa = 1;
    host.emit('seqStep', b);
    if (set.every((o) => (o.sa ?? 0) >= 1)) {
      host.emit('seqDone', b);
      host.popGroup(
        set.map((o) => o.id),
        hit.owner,
      );
    }
    return 'absorb';
  },
};
