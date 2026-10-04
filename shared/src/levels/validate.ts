import { BUBBLE_SIZES, PLAYER, POWERUP_TYPES, SKY_KINDS, SPECIAL_KINDS, WORLD } from '../constants/game';
import { circleRectOverlap } from '../sim/physics';
import { onSpikes, spawnX } from '../sim/hazards';
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
  const groups = new Map<string, number>();
  const orders = new Map<number, number[]>();
  l.bubbles.forEach((b, i) => {
    if (b.special !== undefined && !(SPECIAL_KINDS as readonly string[]).includes(b.special)) errs.push(`${where}: bubble ${i} has unknown special "${b.special}"`);
    if (b.group !== undefined) {
      if (b.special !== 'twin' && b.special !== 'sequence' && b.special !== 'link') errs.push(`${where}: bubble ${i} has a group but is not a twin, link or sequence orb`);
      else groups.set(`${b.special}:${b.group}`, (groups.get(`${b.special}:${b.group}`) ?? 0) + 1);
    }
    if ((b.special === 'twin' || b.special === 'sequence' || b.special === 'link') && b.group === undefined) errs.push(`${where}: ${b.special} bubble ${i} needs a group`);
    if (b.order !== undefined && b.special !== 'sequence') errs.push(`${where}: bubble ${i} has an order but is not a sequence orb`);
    if (b.special === 'sequence') {
      if (!(Number.isInteger(b.order) && (b.order as number) >= 1)) errs.push(`${where}: sequence bubble ${i} needs an integer order >= 1`);
      else if (b.group !== undefined) orders.set(b.group, [...(orders.get(b.group) ?? []), b.order as number]);
      if (b.size > 1) errs.push(`${where}: sequence bubble ${i} must be small or medium`);
    }
    if (b.need !== undefined && !(b.special === 'coop' && Number.isInteger(b.need) && b.need >= 2 && b.need <= 4)) errs.push(`${where}: bubble ${i} need is only for coop orbs and must be an integer 2..4`);
    if (b.phase !== undefined && !(b.phase >= 0 && b.special === 'ghost')) errs.push(`${where}: bubble ${i} phase is only for ghosts and must be >= 0`);
  });
  for (const [key, n] of groups) {
    if ((key.startsWith('twin:') || key.startsWith('link:')) && n !== 2) errs.push(`${where}: ${key} must have exactly 2 bubbles (has ${n})`);
    if (key.startsWith('sequence:') && (n < 2 || n > 5)) errs.push(`${where}: ${key} needs 2 to 5 bubbles (has ${n})`);
  }
  for (const [g, os] of orders) {
    const sorted = [...os].sort((a, c) => a - c);
    if (sorted.some((v, i) => v !== i + 1)) errs.push(`${where}: sequence group ${g} orders must be 1..${os.length} without gaps or repeats`);
  }
  l.platforms.forEach((p, i) => {
    if (p.cycle && !(p.cycle.on > 0 && p.cycle.off > 0)) errs.push(`${where}: platform ${i} cycle needs on > 0 and off > 0`);
  });
  (l.spikes ?? []).forEach((sp, i) => {
    if (sp.w <= 0 || sp.x < 0 || sp.x + sp.w > WORLD.width) errs.push(`${where}: spike strip ${i} out of bounds`);
  });
  for (let slot = 0; slot < 4; slot++) {
    if (onSpikes(l, spawnX(l, slot))) errs.push(`${where}: spawn for slot ${slot} is on spikes`);
  }
  (l.ice ?? []).forEach((ic, i) => {
    if (ic.w <= 0 || ic.x < 0 || ic.x + ic.w > WORLD.width) errs.push(`${where}: ice patch ${i} out of bounds`);
  });
  for (const k of ['wall', 'mirror'] as const) {
    const n = l.stage?.[k];
    if (n !== undefined && !(Number.isInteger(n) && n >= 0 && n <= 3)) errs.push(`${where}: stage.${k} must be an integer 0..3`);
  }
  if (l.bombs && !(l.bombs.every > 0 && l.bombs.fuse > 0 && l.bombs.radius > 0)) errs.push(`${where}: bombs need every, fuse, radius > 0`);
  if (l.sky) {
    if (!(Number.isInteger(l.sky.budget) && l.sky.budget >= 0 && l.sky.budget <= 6)) errs.push(`${where}: sky.budget must be an integer 0..6`);
    if (l.sky.chance !== undefined && !(l.sky.chance >= 0 && l.sky.chance <= 1)) errs.push(`${where}: sky.chance must be in [0,1]`);
    for (const k of Object.keys(l.sky.pool ?? {})) {
      if (!(SKY_KINDS as readonly string[]).includes(k)) errs.push(`${where}: unknown sky event "${k}"`);
    }
  }
  const { dropChance, pool, placed } = l.powerUps;
  if (dropChance < 0 || dropChance > 1) errs.push(`${where}: dropChance must be in [0,1]`);
  for (const k of Object.keys(pool)) {
    if (!(POWERUP_TYPES as readonly string[]).includes(k)) errs.push(`${where}: unknown power-up "${k}"`);
  }
  placed.forEach((p, i) => {
    if (!POWERUP_TYPES.includes(p.type)) errs.push(`${where}: placed power-up ${i} has unknown type`);
    if (l.noAnchor && p.type === 'anchor') errs.push(`${where}: placed power-up ${i} is an anchor on a noAnchor level`);
  });
  if (l.noAnchor && (pool.anchor ?? 0) > 0) errs.push(`${where}: anchor in the drop pool on a noAnchor level`);
  return errs;
}
