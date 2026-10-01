import type { BubbleSize, PowerUpType } from '../constants/game';

export type LifeState = 'alive' | 'dead' | 'out';

export interface PlayerState {
  slot: number;
  /** Participating in the match (false after "continue solo" drops a partner). */
  active: boolean;
  x: number;
  facing: -1 | 1;
  /** Current input bitmask (INPUT.*). */
  input: number;
  /** Shoot was pressed (rising edge) and not yet consumed. */
  shootLatch: boolean;
  lives: number;
  score: number;
  life: LifeState;
  respawnTimer: number;
  invuln: number;
  /** Power-up timers in seconds (0 = inactive). */
  shield: number;
  speed: number;
  dbl: number;
  cooldown: number;
  hitThisLevel: boolean;
  /** Reconciliation bookkeeping. */
  lastSeq: number;
  ticksSinceSeq: number;
}

export interface BubbleState {
  id: number;
  size: BubbleSize;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface HarpoonState {
  id: number;
  owner: number;
  x: number;
  tipY: number;
}

export interface PowerUpState {
  id: number;
  type: PowerUpType;
  x: number;
  /** Center y. */
  y: number;
  life: number;
  grounded: boolean;
}

export type SimStatus = 'running' | 'cleared' | 'timeup' | 'gameover';

export const MATCH_PHASES = ['countdown', 'playing', 'paused', 'levelComplete', 'timeUp', 'gameOver', 'victory'] as const;
export type MatchPhase = (typeof MATCH_PHASES)[number];

/** Gameplay events. Emitted by the simulation, forwarded to clients for FX/audio. */
export type SimEvent =
  | { k: 'shoot'; p: number; x: number }
  | { k: 'pop'; id: number; s: BubbleSize; x: number; y: number; by: number; pts: number }
  | { k: 'hurt'; p: number; shield: boolean }
  | { k: 'die'; p: number; out: boolean }
  | { k: 'respawn'; p: number }
  | { k: 'drop'; type: PowerUpType; x: number; y: number }
  | { k: 'pickup'; p: number; type: PowerUpType; x: number; y: number }
  | { k: 'clear'; bonus: number[] }
  | { k: 'timeup' }
  | { k: 'phase'; ph: MatchPhase };

export type TickedEvent = SimEvent & { tick: number };
