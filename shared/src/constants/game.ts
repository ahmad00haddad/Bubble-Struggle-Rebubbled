/**
 * Every gameplay tunable lives here. Server and client import the same values,
 * so prediction and authoritative simulation can never drift by configuration.
 */

export const GAME_NAME = 'ORB LANCERS';

/** Shown on the main menu. Bump it with every change that gets deployed (see CLAUDE.md). */
export const GAME_VERSION = '1.7';

/** Fixed simulation rate (server and solo). */
export const TICK_RATE = 30;
export const TICK_DT = 1 / TICK_RATE;
export const TICK_MS = 1000 / TICK_RATE;

/** Snapshot cadence, in ticks. 1 = 30 Hz while things move (about 10-20 KB/s per client at 4 players). */
export const SNAPSHOT_EVERY_TICKS = 1;
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

/** Anchor harpoon: a rare pickup. The next shot sticks to the ceiling and keeps popping what touches it. */
export const ANCHOR = {
  /** Seconds the pickup stays loaded before it is lost. */
  chargeSeconds: 15,
  /** Seconds the tether stays stuck once it reaches the ceiling. */
  stickSeconds: 4,
  /** Seconds between pops by one stuck tether (stops it deleting a crowd in one tick). */
  hitCooldown: 0.35,
} as const;

/**
 * Rare crates. Each one is a choice: take it when it helps, skip it when it would hurt.
 * Weights below are added to every level's own drop pool (and to Gift Crates, doubled).
 */
export const RARE = {
  /** Seconds each timed effect lasts. `sx` is the double-score window of Shrink Time. */
  seconds: { wide: 8, boots: 8, potato: 6, magnet: 4, slow: 5, freeze: 5, sx: 10 },
  /** Wide Tether: tether width factor. */
  wideMul: 3,
  /** Heavy Boots: movement factor (they also give a shield). Slow Orbs: orb speed factor. */
  bootsMul: 0.6,
  slowMul: 0.6,
  /** Shrink Time: seconds cut from the clock, and the least it will ever leave. */
  shrinkSeconds: 8,
  shrinkMinLeft: 5,
  /** Decoy Crate: it looks like a Shield; picking it drops a bomb with this fuse (s) and radius (px). */
  decoy: { fuse: 1.5, radius: 70 },
  /** Gamble Chest: chance of an extra life, otherwise a nearby orb grows one size. */
  chestLife: 0.6,
  /** Double or Nothing: score lost if you are hit after taking it. */
  doubleLoss: 500,
  /** Baton Crate: seconds a teammate has to pop an orb and share the shield. */
  batonSeconds: 3,
  /** Magnet Core pulls every this many ticks (discrete nudges, no continuous force). */
  magnetEvery: 8,
  /** Boomerang: seconds the pickup stays loaded. */
  boomerangCharge: 15,
  /** Boomerang pierces: it ends after this many hits (up or down), or when it is back at the floor. */
  boomerangHits: 3,
  /** Piñata Crate: most pickups an orb breaks into. */
  pinataMax: 3,
  /** Added to every level's drop pool (all levels, solo included). */
  drops: { wide: 1, shrink: 0.5, boots: 0.5, potato: 0.5, pinata: 0.5, chest: 0.5, decoy: 1, slow: 0.5, freeze: 0.5, magnet: 0.5, double: 0.5, boomerang: 0.5 },
  /** Teamwork crates: Baton always joins the pool in multiplayer, Flare only while a teammate is down. */
  mpDrops: { baton: 1 },
  flareWeight: 3,
  /** What a Piñata gives (no pranks, no Decoy). */
  goodPool: { shield: 3, doubleHarpoon: 3, speedBoost: 3, extraTime: 2, extraLife: 1, anchor: 1, wide: 2, magnet: 1, slow: 1 },
} as const;

/** What a rare crate reports to clients (sound, floating words). */
export type GiftEventType =
  | 'shrink'
  | 'boots'
  | 'potato'
  | 'wide'
  | 'pinata'
  | 'chestLife'
  | 'chestCurse'
  | 'decoy'
  | 'slow'
  | 'slowEnd'
  | 'freeze'
  | 'thaw'
  | 'magnet'
  | 'double'
  | 'donWin'
  | 'donLose'
  | 'baton'
  | 'batonGive'
  | 'flare'
  | 'flareFizzle'
  | 'boomerang';

export const SCORING = {
  pickup: 50,
  levelClear: 1000,
  timeBonusPerSecond: 10,
  survivalBonus: 500,
} as const;

/** Order is part of the snapshot format: append only. */
export const POWERUP_TYPES = [
  'shield',
  'extraLife',
  'extraTime',
  'doubleHarpoon',
  'speedBoost',
  'anchor',
  'chaos',
  'shrink',
  'boots',
  'potato',
  'wide',
  'pinata',
  'chest',
  'decoy',
  'slow',
  'freeze',
  'magnet',
  'double',
  'baton',
  'flare',
  'boomerang',
] as const;
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

/** Level hazards (all optional per level). */
export const HAZARDS = {
  /** Fast orbs move and bounce this much faster than normal ones. */
  fastOrbMultiplier: 1.5,
  /** Visual height of floor spike strips (players touching them get hurt). */
  spikeHeight: 14,
  /** Bombs fall at this speed (px/s) until they land. */
  bombFallSpeed: 210,
  bombSize: 22,
  /** Toggling platforms warn (blink) this many seconds before vanishing. */
  platformWarnSeconds: 1,
} as const;

/** Special bubbles. Kind order is part of the snapshot format: append only, never reorder. */
export const SPECIAL_KINDS = ['hardshell', 'ghost', 'twin', 'sync', 'pincer', 'heavy', 'sequence', 'quad', 'coop', 'link', 'priority'] as const;
export type SpecialKind = (typeof SPECIAL_KINDS)[number];

/** Discrete things a special reports to clients (FX, audio, balance counters). */
export const SPECIAL_EVENTS = [
  'enrage',
  'warn',
  'fade',
  'solid',
  'fuseStart',
  'fuseSave',
  'fuseFail',
  'miss',
  'syncArm',
  'syncDone',
  'syncFail',
  'pincerArm',
  'pincerDone',
  'pincerFail',
  'heavyHit',
  'heavyDone',
  'heavyFail',
  'seqStep',
  'seqReset',
  'seqDone',
  /** A hit that made no progress (same shooter / same side again). */
  'deny',
  /** Coop target: a Lancer's hit counted / enough different Lancers hit it / the window ran out. */
  'coopHit',
  'coopDone',
  'coopFail',
  /** Link: first orb popped (the partner is on the clock) / partner popped by a different Lancer / the window ran out. */
  'linkStart',
  'linkDone',
  'linkFail',
  /** Priority: popped before the deadline (team gains time) / the deadline passed. */
  'priorityDone',
  'priorityFail',
] as const;
export type SpecialEventType = (typeof SPECIAL_EVENTS)[number];

/** Seconds a Coop orb waits for the other Lancers, by how many it needs. */
export const coopWindow = (need: number): number => (need >= 3 ? SPECIAL.coop.windowBig : SPECIAL.coop.window);

export const SPECIAL = {
  /** Mixed into the match seed so specials never consume the power-up / bomb RNG stream. */
  seedSalt: 0x5bd1e995,
  hardshell: {
    /** Speed multiplier after the first hit (same physics shape as a fast orb). */
    rageMul: 1.25,
  },
  ghost: {
    /** Seconds fully solid, then seconds of blinking warning (still hittable), then seconds intangible. */
    solid: 3,
    warn: 0.8,
    ghostly: 1.5,
  },
  twin: {
    /** Seconds to pop the partner after the first twin falls. Solo gets longer. */
    fuseSeconds: 5,
    fuseSecondsSolo: 7,
  },
  sync: {
    /** Seconds between the two hits. With one living Lancer the same player may land both. */
    window: 1.2,
    windowSolo: 2,
  },
  pincer: {
    /** Seconds between a left-side and a right-side hit (sides are relative to the orb). */
    window: 1.5,
    windowSolo: 4,
    /** Multiplayer: a hit must land at least this many px off the orb's centre line to count as a side. */
    deadband: 6,
  },
  quad: {
    /** Quad-lock: needs four different shooters within this many seconds of the first hit. */
    window: 3,
  },
  coop: {
    /** Seconds, from the first hit, for the other Lancers to land theirs. */
    window: 2,
    /** Window when 3 or more Lancers are needed (more people to line up). */
    windowBig: 2.5,
    /** Lancers needed when a level does not say (BubbleSpawn.need), and the fewest players a coop orb needs to stay coop. */
    defaultNeed: 2,
    minPlayers: 2,
    /** When the window runs out: 'reset' forgets the hits, 'rage' also makes the orb faster. */
    failure: 'rage' as 'reset' | 'rage',
  },
  link: {
    /** Seconds the partner stays on the clock after its twin pops. A different Lancer must finish it. */
    window: 4,
    minPlayers: 2,
  },
  priority: {
    /** Seconds from level start to pop it before it regrows and enrages. */
    window: 9,
    /** Seconds added to the clock when the team pops it in time. */
    rewardSeconds: 6,
    minPlayers: 2,
  },
  /** Extra special orbs added in multiplayer (ScaleProfile.specialShare), by relative odds. Heavy needs 3+ players. */
  promote: { hardshell: 3, sync: 2, pincer: 1, ghost: 1, heavy: 1 },
  /** Never promote more than this many orbs on one level. */
  promoteMax: 3,
  heavy: {
    /** Seconds, counted from the first hit, to gather the required distinct shooters. */
    window: 2.5,
    /** Never fewer than this many distinct shooters while two or more Lancers can still play. */
    minShooters: 2,
  },
} as const;

/** Rare, telegraphed events that fall out of the sky. Kind order is part of the snapshot format: append only. */
export const SKY_KINDS = ['gift', 'comet', 'wobble', 'hail'] as const;
export type SkyKind = (typeof SKY_KINDS)[number];

export const SKY = {
  /** Mixed into the match seed so the director never consumes any other RNG stream. */
  seedSalt: 0x1b873593,
  /** Earliest an event may start, spacing between planned slots, and random spread on top. Seconds. */
  firstAfter: 8,
  /** Bigger teams clear faster, so their first slot comes sooner (index = players - 1). */
  firstAfterScale: [1, 0.85, 0.7, 0.55],
  gap: 14,
  jitter: 10,
  /** No event is planned in the last quarter of the clock. */
  clockGuard: 0.75,
  /** Chance a planned slot actually happens, and the bonus per extra Lancer. */
  slotChance: 0.6,
  playerBonus: 0.15,
  /** Warning shown before the effect lands. Seconds. */
  warn: { gift: 1.5, comet: 1.5, wobble: 2, hail: 1.5 },
  /** Gravity Wobble: how long, and the orb gravity factor while it lasts. */
  wobbleSeconds: 6,
  wobbleGravity: 0.7,
  /** Hail: orbs dropped, minimum spacing between lanes (px). */
  hailCount: 3,
  hailGap: 180,
  /** Gift Crate contents. Anchor is dropped from the pool on noAnchor levels. */
  giftPool: { shield: 3, doubleHarpoon: 3, speedBoost: 3, extraTime: 2, extraLife: 1, anchor: 1 },
  /** Relative odds of each event when a level does not set its own pool. */
  defaultPool: { gift: 4, comet: 3, wobble: 2, hail: 3 },
} as const;

/**
 * Heat governor: measures rapid popping and, while the team runs hot, makes newly split
 * orbs slightly faster for a few seconds. It never touches players. The trigger level
 * differs per player count (ScaleProfile.heatThreshold).
 */
export const HEAT = {
  /** Heat decays with this time constant (s); one pop adds 1 heat. */
  decaySeconds: 3,
  /** Hot ends when heat falls below this share of the threshold (hysteresis). */
  coolRatio: 0.6,
  /** Speed factor and duration for children spawned while hot. */
  boostMul: 1.12,
  boostSeconds: 4,
} as const;

/**
 * Chaos: a rare multiplayer-only pickup. Whoever grabs it fires one short, playful effect at a
 * teammate the server picks. Kind order is part of the snapshot format (stored as index + 1).
 */
export const CHAOS_KINDS = ['jam', 'flip', 'slow', 'tether', 'swap'] as const;
export type ChaosKind = (typeof CHAOS_KINDS)[number];

export const CHAOS = {
  seedSalt: 0x27d4eb2f,
  /** Effect length in seconds. Swap is instant. */
  seconds: { jam: 1.2, flip: 0.8, slow: 2.5, tether: 3 },
  /** Slow: movement factor. */
  slowMul: 0.6,
  /** Tether: the linked Lancers cannot get further apart than this (px). */
  tetherRange: 280,
  /** Seconds a target is immune after an effect ends (and right after a swap). */
  immunity: 6,
  /** Invulnerability both Lancers get after a swap. */
  swapGrace: 0.8,
  /** No effect if an orb is closer than this (px, from the target's body) to a Lancer it would hit. */
  dangerRadius: 150,
  /** Relative odds when an effect fires. */
  weights: { jam: 3, flip: 2, slow: 3, tether: 2, swap: 1 },
  /** Weight of the chaos pickup in drop pools and gift crates (multiplied by ScaleProfile.chaosRate). */
  dropWeight: 1,
} as const;

export const MATCH = {
  countdownSeconds: 3,
  levelCompleteSeconds: 3.5,
  timeUpSeconds: 2.5,
  /** Auto-resume a manual pause after this long (anti-griefing). */
  maxPauseSeconds: 300,
} as const;

export const ROOM = {
  maxPlayers: 4,
  /** Online matches need at least this many seated, ready players. */
  minPlayersToStart: 2,
  codeLength: 6,
  disconnectGraceSeconds: 60,
  emptyRoomTtlSeconds: 120,
  unjoinedRoomTtlSeconds: 15 * 60,
  maxRoomLifetimeSeconds: 3 * 3600,
  tombstoneTtlSeconds: 24 * 3600,
  /** Large enough for a WebRTC session description sent through the room (LAN mode). */
  maxMessageBytes: 4096,
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
  /** Remote players and orbs are drawn this far in the past; with 30 Hz snapshots 70 ms still spans two of them. */
  interpDelayMs: 70,
  pingIntervalMs: 3000,
  reconnectDelaysMs: [500, 1000, 2000, 3000, 5000, 8000, 8000, 8000],
  /** Prediction error beyond this snaps instead of smoothing. */
  snapDistance: 60,
} as const;

/** Input bitmask. */
export const INPUT = { LEFT: 1, RIGHT: 2, SHOOT: 4, MASK: 7 } as const;
