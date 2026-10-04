import type { BubbleSize, LevelConfig, NetSky, NetStage, LifeState, MatchPhase, PowerUpType, SpecialKind, TickedEvent } from '@orb/shared';

export interface ViewPlayer {
  slot: number;
  x: number;
  life: LifeState;
  lives: number;
  score: number;
  invuln: boolean;
  active: boolean;
  shield: number;
  speed: number;
  dbl: number;
  /** Seconds the Anchor pickup stays loaded. */
  anchor: number;
  /** Chaos effect (0 none, else CHAOS_KINDS index + 1), seconds left, tether partner slot (-1 none). */
  fx: number;
  fxT: number;
  fxP: number;
  /** Rare-crate timers (seconds) and Double or Nothing state. */
  wide: number;
  boots: number;
  potato: number;
  mag: number;
  boom: number;
  sx: number;
  don: number;
  /** Relics owned (bitmask over RELIC_KINDS). */
  rel: number;
  facing: -1 | 1;
}

export interface ViewState {
  phase: MatchPhase;
  phaseTicks: number;
  timeLeftTicks: number;
  levelIndex: number;
  players: ViewPlayer[];
  levelTicks: number;
  bubbles: { id: number; size: BubbleSize; x: number; y: number; fast?: boolean; rage?: boolean; hot?: boolean; frozen?: boolean; sp?: SpecialKind; sa?: number; lk?: number; hm?: number; n?: number }[];
  bombs: { id: number; x: number; y: number; fuse: number; r?: number }[];
  harpoons: { id: number; owner: number; x: number; tipY: number; anchor?: boolean; ttl?: number; wide?: boolean; bm?: 0 | 1 }[];
  /** The sky event in progress, if any. */
  sky?: NetSky;
  /** The stage event in progress (Split Wall or Mirror), if any. */
  stage?: NetStage;
  /** Heat as a share of the governor threshold. */
  heat: number;
  /** Baton Crate window, if any. */
  baton?: { owner: number; t: number };
  /** Seconds of Slow Orbs left. */
  slow: number;
  powerups: { id: number; type: PowerUpType; x: number; y: number; life: number }[];
}

/**
 * What the GameScene renders from. Solo and online modes implement the same
 * interface, so rendering/UI code never branches on networking details.
 */
export interface GameSource {
  readonly mode: 'solo' | 'online';
  readonly localSlot: number;
  readonly level: LevelConfig | null;
  readonly levelCount: number;
  /** Solo practice on one chosen level. */
  readonly practice?: boolean;
  names(): string[];
  /** Advance local clocks/prediction and feed the current input bits. */
  update(dtMs: number, inputBits: number): void;
  view(): ViewState | null;
  /** Gameplay events that are due for presentation (sound, particles, shake). */
  drainEvents(): TickedEvent[];
  requestPause(): void;
  requestResume(): void;
  requestRematch(): void;
  destroy(): void;
}
