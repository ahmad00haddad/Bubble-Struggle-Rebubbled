import { SPECIAL } from '../../constants/game';
import { arm, bit, disarm, isArmed, tickArmed } from './armed';
import { countCoop } from './coopStats';
import type { SpecialDef } from './index';

/**
 * Link: two orbs joined by a line (`lk` = partner id; the simulation links the two spawns of
 * one `group`). Whoever pops the first one starts a window on the other, and the OTHER orb
 * must then be popped by a different Lancer: "you take that one, I'll take this one".
 *  - the Lancer who popped the first orb cannot finish the second (hit is denied), so the
 *    right move after the first pop is to leave the partner for a teammate;
 *  - if the window runs out the partner is enraged (faster) and the link ends;
 *  - multiplayer only: solo turns both into ordinary orbs, and with one Lancer left the same
 *    Lancer may finish it, so it can never become unbeatable.
 * `sa` = window left on the partner (0 = idle), `hm` = the Lancer who popped the first orb.
 */
export const link: SpecialDef = {
  kind: 'link',
  init(host, b) {
    if (host.scale.players < SPECIAL.link.minPlayers) {
      delete b.sp;
      return;
    }
    b.sa = 0;
    b.hm = 0;
  },
  onTick(host, b, dt) {
    if (!isArmed(b)) return;
    host.coopStats.armedTicks++;
    tickArmed(host, b, dt, 'linkFail');
    if (!isArmed(b)) {
      countCoop(host.coopStats, 'link', 'failed');
      b.rage = true;
      delete b.sp;
      delete b.lk;
    }
  },
  onHit(host, b, hit) {
    if (!isArmed(b)) return 'pop';
    if (host.activePlayers() >= 2 && ((b.hm ?? 0) & bit(hit.owner)) !== 0) {
      host.coopStats.repeatHits++;
      host.emit('deny', b);
      return 'absorb';
    }
    host.coopStats.hits++;
    host.coopStats.participants += 2;
    countCoop(host.coopStats, 'link', 'completed');
    host.emit('linkDone', b);
    disarm(b);
    return 'pop';
  },
  onPop(host, b, by) {
    if (isArmed(b)) return; // the partner on the clock: finishing it is handled in onHit
    const partner = b.lk === undefined ? undefined : host.bubbleById(b.lk);
    if (!partner || partner.sp !== 'link' || isArmed(partner)) return;
    arm(partner, SPECIAL.link.window * host.windowMul(by), bit(by));
    host.coopStats.hits++;
    host.emit('linkStart', partner);
  },
};
