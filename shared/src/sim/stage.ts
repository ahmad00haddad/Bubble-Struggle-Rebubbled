import { STAGE } from '../constants/game';
import type { LevelConfig } from '../types/level';
import type { Rng } from './rng';

export interface StagePlanEntry {
  kind: 'wall' | 'mirror';
  /** Seconds into the level before which it will not start. */
  at: number;
}

/**
 * The stage events a level will try to run, with the earliest second each may start. Whether one actually
 * starts depends on the moment (a wall needs two Lancers apart and enough orbs). Same seed, same plan.
 */
export function planStage(level: LevelConfig, limitSeconds: number, rng: Rng): StagePlanEntry[] {
  const cfg = level.stage;
  if (!cfg) return [];
  const kinds: ('wall' | 'mirror')[] = [];
  for (let i = 0; i < Math.min(cfg.wall ?? 0, 3); i++) kinds.push('wall');
  for (let i = 0; i < Math.min(cfg.mirror ?? 0, 3); i++) kinds.push('mirror');
  const from = STAGE.firstAfter;
  const to = Math.max(from + 1, limitSeconds * STAGE.guard);
  const entries = kinds.map((kind) => ({ kind, at: from + rng.next() * (to - from) })).sort((a, b) => a.at - b.at);
  for (let i = 1; i < entries.length; i++) entries[i].at = Math.max(entries[i].at, entries[i - 1].at + STAGE.minGap);
  return entries;
}
