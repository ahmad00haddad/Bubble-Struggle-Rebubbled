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
  /** Spawn x for slot 0 and slot 1. */
  playerSpawnPoints: [number, number];
  platforms: Rect[];
  bubbles: BubbleSpawn[];
  powerUps: LevelPowerUps;
  difficulty: { rating: number; bubbleSpeed: number };
  theme: LevelTheme;
}
