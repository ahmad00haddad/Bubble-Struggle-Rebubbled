import { HAZARDS, HEAT, PLAYER, SPECIAL, TICK_RATE, WORLD } from '../constants/game';
import type { LevelConfig, PlatformConfig, Rect } from '../types/level';

/**
 * Hazard helpers shared by the simulation (server/solo) and the renderer, so
 * both sides agree exactly on which platforms exist and how fast orbs move.
 */

/** Spawn x for any slot. Slots 2 and 3 stand just outside the two configured spawns. */
export function spawnX(level: LevelConfig, slot: number): number {
  const [a, b] = level.playerSpawnPoints;
  const half = PLAYER.width / 2;
  const clampX = (x: number) => Math.min(Math.max(x, half), WORLD.width - half);
  switch (slot) {
    case 0:
      return a;
    case 1:
      return b;
    case 2:
      return clampX(Math.min(a, b) - 80);
    case 3:
      return clampX(Math.max(a, b) + 80);
    default:
      return WORLD.width / 2;
  }
}

/** Is a (possibly timed) platform solid at this level tick? */
export function platformActive(p: PlatformConfig, levelTicks: number): boolean {
  if (!p.cycle) return true;
  const { on, off, offset = 0 } = p.cycle;
  const t = (levelTicks / TICK_RATE + offset) % (on + off);
  return t < on;
}

/** Seconds until a timed platform vanishes (Infinity if static or currently off). */
export function platformVanishIn(p: PlatformConfig, levelTicks: number): number {
  if (!p.cycle || !platformActive(p, levelTicks)) return Infinity;
  const { on, off, offset = 0 } = p.cycle;
  return on - ((levelTicks / TICK_RATE + offset) % (on + off));
}

export function activePlatforms(level: LevelConfig, levelTicks: number): Rect[] {
  return level.platforms.filter((p) => platformActive(p, levelTicks));
}

/** Speed multiplier for one orb (level difficulty × fast-orb bonus). */
export function orbSpeedMul(level: LevelConfig, fast: boolean | undefined, scaleSpeed = 1, rage = false, hot = false, slow = 1): number {
  return level.difficulty.bubbleSpeed * scaleSpeed * (fast ? HAZARDS.fastOrbMultiplier : 1) * (rage ? SPECIAL.hardshell.rageMul : 1) * (hot ? HEAT.boostMul : 1) * slow;
}

/** Does a Lancer at x stand on a spike strip? */
export function onSpikes(level: LevelConfig, x: number): boolean {
  const half = PLAYER.hitboxWidth / 2;
  return (level.spikes ?? []).some((s) => x + half > s.x && x - half < s.x + s.w);
}
