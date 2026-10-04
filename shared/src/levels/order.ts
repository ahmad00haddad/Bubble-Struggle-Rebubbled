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

/**
 * Daily level: everyone who plays on the same (UTC) day gets the same level and the same seed, so
 * drops, specials and sky events match and scores can be compared. `day` is 'YYYY-MM-DD'.
 * Levels 1-5 are skipped: they teach the basics.
 */
export function dailyChallenge(day: string, levelCount: number): { level: number; seed: number } {
  let h = 0x811c9dc5;
  for (let i = 0; i < day.length; i++) h = Math.imul(h ^ day.charCodeAt(i), 0x01000193) >>> 0;
  const skip = Math.min(5, Math.max(0, levelCount - 1));
  const level = skip + (h % Math.max(1, levelCount - skip));
  return { level, seed: Math.imul(h ^ 0x9e3779b9, 0x85ebca6b) >>> 0 };
}

/** Today's date as 'YYYY-MM-DD' (UTC, so every country gets the same daily level at the same time). */
export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
