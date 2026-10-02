import type { BubbleSize, ChaosKind, PowerUpType, SkyKind, SpecialEventType, SpecialKind } from '../constants/game';

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
  /** Seconds the Anchor pickup stays loaded (0 = none). The next shot becomes an anchor. */
  anc: number;
  /** Chaos effect on this Lancer: 0 = none, else CHAOS_KINDS index + 1. */
  fx: number;
  /** Seconds the effect has left. */
  fxT: number;
  /** Seconds of immunity to new effects (counts down while no effect is active). */
  fxImm: number;
  /** Tether: slot of the linked Lancer, else -1. */
  fxP: number;
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
  fast?: boolean;
  /** Spawned while the team ran hot: faster for a few seconds (HEAT.boostMul). */
  hot?: boolean;
  /** Server-only: seconds of heat boost left. */
  ht?: number;
  /** Hardshell after its first hit: moves faster (speed factor SPECIAL.hardshell.rageMul). */
  rage?: boolean;
  /** Special kind. Absent on ordinary orbs, which never touch the special code paths. */
  sp?: SpecialKind;
  /** Special aux timer in seconds (ghost: cycle position; twin / sync / pincer / heavy: time left, 0 = idle; sequence: 1 = already hit). */
  sa?: number;
  /** Twin: id of the partner orb. Sequence: group number. */
  lk?: number;
  /** Sync / Pincer / Heavy: bitmask of the hits so far (shooter slots, or sides for Pincer). */
  hm?: number;
  /** Sequence: this orb's place in the order (1-based). */
  n?: number;
}

export interface BombState {
  id: number;
  x: number;
  /** Center y. */
  y: number;
  fuse: number;
  grounded: boolean;
}

export interface HarpoonState {
  id: number;
  owner: number;
  x: number;
  tipY: number;
  /** Server-only: already reported passing through an intangible orb (one 'miss' per shot). */
  passed?: boolean;
  /** Anchor harpoon: sticks to the ceiling instead of vanishing. */
  anchor?: boolean;
  /** Anchor: seconds of sticking left. Defined only once stuck. */
  ttl?: number;
  /** Anchor: seconds until the tether may pop again. It keeps flying after a hit. */
  cd?: number;
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

/** The one sky event that may be on screen. 'warn' is the telegraph, 'active' is a lasting effect (wobble). */
export interface SkyState {
  kind: SkyKind;
  phase: 'warn' | 'active';
  /** Seconds left in the phase. */
  t: number;
  /** Gift: crate x. Comet: side (-1 enters from the right, 1 from the left). */
  a: number;
  /** Hail: the three lane x positions. */
  lanes: number[];
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
  | { k: 'boom'; x: number; y: number; r: number }
  | { k: 'sp'; t: SpecialEventType; id: number; x: number; y: number }
  | { k: 'anchor'; p: number; x: number; y: number }
  | { k: 'heat'; on: boolean }
  | { k: 'chaos'; t: ChaosKind | 'fizzle' | 'end'; by: number; to: number }
  | { k: 'sky'; t: 'warn' | 'start' | 'end'; kind: SkyKind; x?: number }
  | { k: 'phase'; ph: MatchPhase };

export type TickedEvent = SimEvent & { tick: number };
