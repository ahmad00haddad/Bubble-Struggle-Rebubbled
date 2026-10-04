import type { SpecialEventType, SpecialKind } from '../../constants/game';
import type { LevelConfig } from '../../types/level';
import type { BubbleState } from '../../types/state';
import type { Rng } from '../rng';
import type { ScaleProfile } from '../scaling';
import { coop } from './coop';
import type { CoopStats } from './coopStats';
import { ghost } from './ghost';
import { hardshell } from './hardshell';
import { heavy, quad } from './heavy';
import { link } from './link';
import { pincer } from './pincer';
import { priority } from './priority';
import { sequence } from './sequence';
import { sync } from './sync';
import { twin } from './twin';

/**
 * Special bubbles are small rule objects that plug into the orb lifecycle. The
 * simulation owns all state and calls these hooks; a special never touches players,
 * harpoons or the network. Ordinary orbs (no `sp`) never enter this module.
 *
 * To add a special: append its kind to SPECIAL_KINDS, write a SpecialDef, register it
 * below. Keep every hook deterministic: randomness only from `host.rng`.
 */

/** The slice of the simulation a special may use. */
export interface SpecialHost {
  /** Deterministic stream reserved for specials (never shared with drops or bombs). */
  readonly rng: Rng;
  /** Profile fixed at level load. */
  readonly scale: ScaleProfile;
  /** Lancers who can still take part right now (seated, not knocked out). Live value. */
  activePlayers(): number;
  /** Cooperative target counters (telemetry only). */
  readonly coopStats: CoopStats;
  /** Window factor for cooperative targets started by this Lancer (Coordinator relic). */
  windowMul(owner: number): number;
  /** Add seconds to the level clock (team reward). */
  addTime(seconds: number): void;
  /** Every orb currently in play. */
  orbs(): readonly BubbleState[];
  bubbleById(id: number): BubbleState | undefined;
  emit(type: SpecialEventType, b: BubbleState): void;
  /** Pop several orbs at once (normal split and scoring, credited to `owner`). */
  popGroup(ids: readonly number[], owner: number): void;
}

export interface SpecialHit {
  /** Slot of the Lancer whose harpoon connected. */
  owner: number;
  /** Harpoon x at the moment of impact. */
  x: number;
}

/** 'pop' splits the orb as usual. 'absorb' keeps it alive (the harpoon is still spent). */
export type HitResult = 'pop' | 'absorb';

export interface SpecialDef {
  kind: SpecialKind;
  /** Level load: set the starting state. Links between orbs are made by the simulation. */
  init?(host: SpecialHost, b: BubbleState, spawn: LevelConfig['bubbles'][number]): void;
  /** True while harpoons and Lancers pass through the orb. */
  intangible?(b: BubbleState): boolean;
  /** True while harpoons pass through but the orb still hurts Lancers. */
  harpoonPass?(b: BubbleState): boolean;
  /** A harpoon connected with a tangible orb. Default: 'pop'. */
  onHit?(host: SpecialHost, b: BubbleState, hit: SpecialHit): HitResult;
  /** Every simulation tick, after physics. */
  onTick?(host: SpecialHost, b: BubbleState, dt: number): void;
  /** Just before the orb is removed and split. */
  onPop?(host: SpecialHost, b: BubbleState, by: number): void;
}

export const SPECIAL_DEFS: Record<SpecialKind, SpecialDef> = { hardshell, ghost, twin, sync, pincer, heavy, sequence, quad, coop, link, priority };

export { countCoop, newCoopStats, type CoopKind, type CoopKindStats, type CoopStats } from './coopStats';

export function isIntangible(b: BubbleState): boolean {
  return b.sp ? (SPECIAL_DEFS[b.sp].intangible?.(b) ?? false) : false;
}

/** Should a harpoon fly through this orb? (Intangible orbs, plus orbs that ignore harpoons but still hurt.) */
export function passesHarpoon(b: BubbleState): boolean {
  if (!b.sp) return false;
  const def = SPECIAL_DEFS[b.sp];
  return (def.intangible?.(b) ?? false) || (def.harpoonPass?.(b) ?? false);
}
