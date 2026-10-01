import type { BubbleSize, PowerUpType } from '../constants/game';

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
  theme: LevelTheme;
}
