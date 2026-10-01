/**
 * Every gameplay tunable lives here. Server and client import the same values,
 * so prediction and authoritative simulation can never drift by configuration.
 */

export const GAME_NAME = 'ORB LANCERS';

/** Fixed simulation rate (server and solo). */
export const TICK_RATE = 30;
export const TICK_DT = 1 / TICK_RATE;
export const TICK_MS = 1000 / TICK_RATE;

/** Snapshot cadence, in ticks. 2 → 15 Hz while things move. */
export const SNAPSHOT_EVERY_TICKS = 2;
/** Cadence while the world is frozen (countdown / pause). 8 → ~4 Hz. */
export const IDLE_SNAPSHOT_EVERY_TICKS = 8;

/** Arena in simulation units (pixels). The floor is at y = height. */
export const WORLD = { width: 960, height: 480 } as const;

export const PHYSICS = {
  gravity: 520,
  /** Orb integration substeps per tick (prevents tunnelling through thin platforms). */
  substeps: 2,
  /** Upward velocity given to both children when an orb splits. */
  splitKickVy: 230,
} as const;

export type BubbleSize = 0 | 1 | 2 | 3;

/** Index = size. 0 = smallest. */
export const BUBBLE_SIZES: readonly {
  name: string;
  radius: number;
  /** Height (px) the orb reaches above whatever surface it bounces on. */
  bounceHeight: number;
  speedX: number;
  points: number;
}[] = [
  { name: 'small', radius: 10, bounceHeight: 115, speedX: 132, points: 200 },
  { name: 'medium', radius: 18, bounceHeight: 175, speedX: 120, points: 150 },
  { name: 'large', radius: 30, bounceHeight: 250, speedX: 108, points: 100 },
  { name: 'huge', radius: 46, bounceHeight: 325, speedX: 96, points: 50 },
];

export function bounceVelocity(size: BubbleSize, speedMul = 1): number {
  return Math.sqrt(2 * PHYSICS.gravity * BUBBLE_SIZES[size].bounceHeight) * speedMul;
}

export const PLAYER = {
  width: 34,
  height: 44,
  /** Forgiving hitbox (centered horizontally, aligned to feet). */
  hitboxWidth: 20,
  hitboxHeight: 34,
  speed: 215,
  startLives: 3,
  maxLives: 9,
  respawnDelay: 2,
  invulnAfterRespawn: 2.2,
  invulnAfterShieldBreak: 1.2,
  /** Lives given back to a knocked-out player when the team clears a level. */
  reviveLives: 1,
} as const;

export const HARPOON = {
  speed: 760,
  /** Collision width of the tether. */
  width: 6,
  cooldown: 0.18,
  baseMax: 1,
  doubleMax: 2,
} as const;

export const SCORING = {
  pickup: 50,
  levelClear: 1000,
  timeBonusPerSecond: 10,
  survivalBonus: 500,
} as const;

export const POWERUP_TYPES = ['shield', 'extraLife', 'extraTime', 'doubleHarpoon', 'speedBoost'] as const;
export type PowerUpType = (typeof POWERUP_TYPES)[number];

export const POWERUP = {
  size: 24,
  fallSpeed: 170,
  lifetime: 9,
  /** Start blinking when this many seconds remain. */
  blinkAt: 2.5,
  maxOnField: 3,
  durations: { shield: 20, doubleHarpoon: 15, speedBoost: 10 },
  extraTimeSeconds: 20,
  speedMultiplier: 1.45,
} as const;

export const MATCH = {
  countdownSeconds: 3,
  levelCompleteSeconds: 3.5,
  timeUpSeconds: 2.5,
  /** Auto-resume a manual pause after this long (anti-griefing). */
  maxPauseSeconds: 300,
} as const;

export const ROOM = {
  maxPlayers: 2,
  codeLength: 6,
  disconnectGraceSeconds: 60,
  emptyRoomTtlSeconds: 120,
  unjoinedRoomTtlSeconds: 15 * 60,
  maxRoomLifetimeSeconds: 3 * 3600,
  tombstoneTtlSeconds: 24 * 3600,
  maxMessageBytes: 1024,
  /** Sustained per-socket message budget; bursts above are dropped. */
  maxMessagesPerSecond: 40,
  /** Hard kill threshold within one second. */
  kickMessagesPerSecond: 120,
  maxQueuedInputs: 8,
  /**
   * After game over / victory the room stays in memory this long so results and
   * rematch votes survive; afterwards it may hibernate (and falls back to the lobby).
   */
  terminalHoldSeconds: 180,
} as const;

export const NET = {
  interpDelayMs: 100,
  pingIntervalMs: 3000,
  reconnectDelaysMs: [500, 1000, 2000, 3000, 5000, 8000, 8000, 8000],
  /** Prediction error beyond this snaps instead of smoothing. */
  snapDistance: 60,
} as const;

/** Input bitmask. */
export const INPUT = { LEFT: 1, RIGHT: 2, SHOOT: 4, MASK: 7 } as const;
