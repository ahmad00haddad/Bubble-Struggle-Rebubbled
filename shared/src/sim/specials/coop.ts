import { SPECIAL, coopWindow } from '../../constants/game';
import { arm, bit, disarm, isArmed, popcount, tickArmed } from './armed';
import { countCoop } from './coopStats';
import type { SpecialDef } from './index';

/**
 * Coop: a bubble that needs hits from `n` DIFFERENT Lancers inside a window that opens at the
 * first hit (`BubbleState.n` = Lancers needed, set from `BubbleSpawn.need`).
 *  - the same Lancer hitting again changes nothing ('deny'), so popping it alone is never right;
 *  - when the window runs out the hits are forgotten; with `SPECIAL.coop.failure === 'rage'`
 *    the orb also speeds up, so a bad hand-off costs something visible but not a life;
 *  - multiplayer only: with fewer Lancers than `minPlayers` at level load it becomes an
 *    ordinary orb. If the team shrinks mid-level the requirement shrinks with it, down to a
 *    single hit when one Lancer is left, so it can never become unbeatable.
 */
export const coop: SpecialDef = {
  kind: 'coop',
  init(host, b, spawn) {
    if (host.scale.players < SPECIAL.coop.minPlayers) {
      delete b.sp;
      return;
    }
    const want = Math.min(4, Math.max(2, Math.round(spawn.need ?? SPECIAL.coop.defaultNeed)));
    b.n = Math.min(want, host.scale.players);
    b.sa = 0;
    b.hm = 0;
    countCoop(host.coopStats, 'coop', 'spawned');
  },
  onTick(host, b, dt) {
    if (!isArmed(b)) return;
    host.coopStats.armedTicks++;
    tickArmed(host, b, dt, 'coopFail');
    if (!isArmed(b)) {
      countCoop(host.coopStats, 'coop', 'failed');
      if (SPECIAL.coop.failure === 'rage') b.rage = true;
    }
  },
  onHit(host, b, hit) {
    const stats = host.coopStats;
    const need = Math.min(b.n ?? SPECIAL.coop.defaultNeed, host.activePlayers());
    if (need < 2) {
      countCoop(stats, 'coop', 'completed');
      stats.participants++;
      host.emit('coopDone', b);
      return 'pop';
    }
    if (!isArmed(b)) {
      arm(b, coopWindow(need) * host.windowMul(hit.owner), bit(hit.owner));
      stats.hits++;
      host.emit('coopHit', b);
      return 'absorb';
    }
    if (((b.hm ?? 0) & bit(hit.owner)) !== 0) {
      stats.repeatHits++;
      host.emit('deny', b);
      return 'absorb';
    }
    b.hm = (b.hm ?? 0) | bit(hit.owner);
    stats.hits++;
    const have = popcount(b.hm);
    if (have >= need) {
      countCoop(stats, 'coop', 'completed');
      stats.participants += have;
      host.emit('coopDone', b);
      disarm(b);
      return 'pop';
    }
    host.emit('coopHit', b);
    return 'absorb';
  },
};
