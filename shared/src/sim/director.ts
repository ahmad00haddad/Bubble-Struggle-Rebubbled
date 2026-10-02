import { SKY, TICK_RATE, type SkyKind } from '../constants/game';
import type { LevelConfig } from '../types/level';
import type { Rng } from './rng';
import type { ScaleProfile } from './scaling';

/**
 * The Surprise Director plans rare sky events when a level loads. The plan is a pure
 * function of (level, player count, special RNG stream), so a retried level replays the
 * same surprises and server and solo agree. The simulation executes the plan.
 */

export interface SkyPlanEntry {
  /** Level tick at which the warning starts. */
  at: number;
  kind: SkyKind;
}

/** Default slots for levels that do not choose: more later, but never zero from level 1. */
export function defaultSkyBudget(rating: number): number {
  return rating <= 3 ? 1 : rating <= 10 ? 2 : 3;
}

export function planSky(level: LevelConfig, scale: ScaleProfile, rng: Rng): SkyPlanEntry[] {
  const cfg = level.sky;
  if (!cfg) return [];
  const chance = Math.min(0.95, (cfg.chance ?? SKY.slotChance) * (1 + SKY.playerBonus * (scale.players - 1)));
  const pool = { ...(cfg.pool ?? SKY.defaultPool) };
  const first = SKY.firstAfter * (SKY.firstAfterScale[scale.players - 1] ?? 1);
  const limit = level.timeLimit * scale.timeMul * SKY.clockGuard;
  const plan: SkyPlanEntry[] = [];
  for (let i = 0; i < cfg.budget; i++) {
    const roll = rng.next();
    const spread = rng.next();
    const kind = rng.weighted(pool);
    if (roll >= chance || !kind) continue;
    const seconds = first + i * SKY.gap + spread * SKY.jitter;
    if (seconds < limit) plan.push({ at: Math.round(seconds * TICK_RATE), kind });
  }
  return plan.sort((a, b) => a.at - b.at);
}
