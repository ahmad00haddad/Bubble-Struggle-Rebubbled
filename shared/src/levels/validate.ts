import { BUBBLE_SIZES, PLAYER, POWERUP_TYPES, WORLD } from '../constants/game';
import { circleRectOverlap } from '../sim/physics';
import type { LevelConfig } from '../types/level';

/** Returns a list of human-readable problems; empty means the level is valid. */
export function validateLevel(l: LevelConfig): string[] {
  const errs: string[] = [];
  const where = `level "${l.id}"`;
  if (!l.id || !l.name) errs.push(`${where}: id and name are required`);
  if (!(l.timeLimit > 0)) errs.push(`${where}: timeLimit must be > 0`);
  if (l.bubbles.length === 0) errs.push(`${where}: needs at least one bubble`);
  if (!(l.difficulty.bubbleSpeed > 0)) errs.push(`${where}: bubbleSpeed must be > 0`);
  l.playerSpawnPoints.forEach((x, i) => {
    if (x < PLAYER.width / 2 || x > WORLD.width - PLAYER.width / 2) errs.push(`${where}: spawn ${i} out of bounds`);
  });
  const ceilingForPlayers = WORLD.height - PLAYER.height - 16;
  l.platforms.forEach((p, i) => {
    if (p.w <= 0 || p.h <= 0) errs.push(`${where}: platform ${i} has no size`);
    if (p.x < 0 || p.x + p.w > WORLD.width || p.y < 0) errs.push(`${where}: platform ${i} out of bounds`);
    if (p.y + p.h > ceilingForPlayers) errs.push(`${where}: platform ${i} too low (players must walk under it)`);
  });
  l.bubbles.forEach((b, i) => {
    const r = BUBBLE_SIZES[b.size]?.radius;
    if (r === undefined) {
      errs.push(`${where}: bubble ${i} has invalid size ${b.size}`);
      return;
    }
    if (b.x - r < 0 || b.x + r > WORLD.width || b.y - r < 0 || b.y + r > WORLD.height) errs.push(`${where}: bubble ${i} out of bounds`);
    if (l.platforms.some((p) => circleRectOverlap(b.x, b.y, r, p))) errs.push(`${where}: bubble ${i} overlaps a platform`);
  });
  const { dropChance, pool, placed } = l.powerUps;
  if (dropChance < 0 || dropChance > 1) errs.push(`${where}: dropChance must be in [0,1]`);
  for (const k of Object.keys(pool)) {
    if (!(POWERUP_TYPES as readonly string[]).includes(k)) errs.push(`${where}: unknown power-up "${k}"`);
  }
  placed.forEach((p, i) => {
    if (!POWERUP_TYPES.includes(p.type)) errs.push(`${where}: placed power-up ${i} has unknown type`);
  });
  return errs;
}
