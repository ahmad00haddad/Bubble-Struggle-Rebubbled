import type { LevelConfig } from '../types/level';
import { Rng } from '../sim/rng';

/**
 * A random play order for one match (Fisher-Yates on its own seeded stream, so it never
 * touches the simulation's RNG). Same seed gives the same order on server and client.
 * `first` (an index into `levels`) is moved to the front, for "jump to level N" testing.
 */
export function shuffleLevels(levels: readonly LevelConfig[], seed: number, first?: number): LevelConfig[] {
  const rng = new Rng((seed ^ 0x2545f491) >>> 0);
  const out = [...levels];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  if (first !== undefined && first >= 0 && first < levels.length) {
    const at = out.indexOf(levels[first]);
    out.splice(at, 1);
    out.unshift(levels[first]);
  }
  return out;
}
