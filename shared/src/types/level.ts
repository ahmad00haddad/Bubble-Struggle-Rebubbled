import type { BubbleSize, PowerUpType, SkyKind, SpecialKind } from '../constants/game';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BubbleSpawn {
  size: BubbleSize;
  x: number;
  y: number;
  /** Defaults to +size speed (moving right). Scaled by difficulty.bubbleSpeed. */
  velocityX?: number;
  /** Defaults to 0 (orb starts at its apex). Scaled by difficulty.bubbleSpeed. */
  velocityY?: number;
  /** Fast orb: moves/bounces HAZARDS.fastOrbMultiplier faster. Children stay fast. */
  fast?: boolean;
  /** Special bubble kind (see SPECIAL_KINDS). Ordinary orb when absent. */
  special?: SpecialKind;
  /** Twin Fuse: the two spawns sharing a group number are partners. Sequence: all spawns of a group form one set. */
  group?: number;
  /** Sequence: place in the order, 1-based and contiguous within the group. */
  order?: number;
  /** Coop: different Lancers needed (2..4, capped at the team size). Defaults to SPECIAL.coop.defaultNeed. */
  need?: number;
  /** Ghost: seconds into its cycle at level start. Drawn from the special RNG when omitted. */
  phase?: number;
}

/** A platform. With `cycle` it appears/disappears on a timer (a "door"). */
export interface PlatformConfig extends Rect {
  cycle?: { on: number; off: number; offset?: number };
}

/** Floor spike strip: hurts any Lancer standing in [x, x + w]. */
export interface SpikeStrip {
  x: number;
  w: number;
}

/** Bombs drop from the ceiling every `every` s, land, and explode after `fuse` s. */
export interface BombConfig {
  every: number;
  fuse: number;
  radius: number;
  firstAt?: number;
}

export interface PlacedPowerUp {
  type: PowerUpType;
  x: number;
  y: number;
  /** Seconds after the level starts. */
  delay: number;
}

export interface LevelPowerUps {
  /** Chance (0..1) that popping an orb drops a power-up. */
  dropChance: number;
  /** Relative weights for random drops. */
  pool: Partial<Record<PowerUpType, number>>;
  placed: PlacedPowerUp[];
}

export interface LevelTheme {
  /** Sky gradient top / bottom (hex RGB numbers). */
  sky: [number, number];
  /** Platform & UI accent. */
  accent: number;
  /** Base hue for orbs (hex RGB). */
  orb: number;
}

/** Surprise Director settings. A level without `sky` has no sky events. */
export interface SkyConfig {
  /** Slots planned for this level (each happens with probability `chance`). */
  budget: number;
  /** Per-slot chance; defaults to SKY.slotChance. */
  chance?: number;
  /** Relative odds by event; defaults to SKY.defaultPool. */
  pool?: Partial<Record<SkyKind, number>>;
}

export interface LevelConfig {
  id: string;
  name: string;
  /** Seconds. */
  timeLimit: number;
  /** Spawn x for slots 0 and 1. Slots 2 and 3 are derived (see spawnX). */
  playerSpawnPoints: [number, number];
  platforms: PlatformConfig[];
  spikes?: SpikeStrip[];
  bombs?: BombConfig;
  bubbles: BubbleSpawn[];
  powerUps: LevelPowerUps;
  difficulty: { rating: number; bubbleSpeed: number };
  /** Do not add multiplayer bonus specials to this level's ordinary orbs. */
  noPromote?: boolean;
  /** Rare sky events (Gift Crate, Comet, Gravity Wobble, Hail). */
  sky?: SkyConfig;
  /** Anchor harpoons behave like normal shots here and the pickup never appears (boss levels). */
  noAnchor?: boolean;
  theme: LevelTheme;
}
