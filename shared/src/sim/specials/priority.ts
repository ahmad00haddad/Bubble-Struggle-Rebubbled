import { SPECIAL, type BubbleSize } from '../../constants/game';
import { countCoop } from './coopStats';
import type { SpecialDef } from './index';

/**
 * Priority: an orb the team should decide to deal with. It starts a countdown (`sa`) when the
 * level loads. Pop it in time and the team gains `rewardSeconds` on the clock; let it run out
 * and it regrows one size and enrages. It can be popped by anyone, so the question is who is
 * closest and who can keep working elsewhere. It never hurts more than any other orb.
 * Multiplayer only (solo gets an ordinary orb).
 */
export const priority: SpecialDef = {
  kind: 'priority',
  init(host, b) {
    if (host.scale.players < SPECIAL.priority.minPlayers) {
      delete b.sp;
      return;
    }
    b.sa = SPECIAL.priority.window;
    countCoop(host.coopStats, 'priority', 'spawned');
  },
  onTick(host, b, dt) {
    const left = b.sa ?? 0;
    if (left <= 0) return;
    host.coopStats.armedTicks++;
    if (left - dt > 0) {
      b.sa = left - dt;
      return;
    }
    // Deadline missed: it comes back bigger and angrier, and stops being a priority.
    if (b.size < 3) b.size = (b.size + 1) as BubbleSize;
    b.rage = true;
    countCoop(host.coopStats, 'priority', 'failed');
    host.emit('priorityFail', b);
    delete b.sp;
    delete b.sa;
  },
  onPop(host, b) {
    if ((b.sa ?? 0) <= 0) return;
    host.coopStats.hits++;
    host.coopStats.participants++;
    countCoop(host.coopStats, 'priority', 'completed');
    host.addTime(SPECIAL.priority.rewardSeconds);
    host.emit('priorityDone', b);
  },
};
