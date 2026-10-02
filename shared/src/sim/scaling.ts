/**
 * Player-count scaling. One pure lookup, read by the simulation whenever a level
 * loads (so a mid-level drop-in never rescales a running level).
 *
 * Difficulty comes from mechanics, not from bubble HP. Only the numeric knobs
 * (`speedMul`, `timeMul`, `dropMul`) are consumed today. The rest are published
 * here so later phases (special bubbles, chaos, Quad-lock) read one source of truth.
 */
export interface ScaleProfile {
  /** Seats actually playing (clamped to 1..4). */
  players: number;
  /** Multiplies orb speed on top of the level's own bubbleSpeed. */
  speedMul: number;
  /** Multiplies the level time limit. */
  timeMul: number;
  /** Multiplies the level's power-up drop chance. */
  dropMul: number;
  /** Target share of bubbles that are special (0 = solo-safe specials only). */
  specialShare: number;
  /** Chaos items allowed (never in solo; the host can still switch them off). */
  chaos: boolean;
  /** Relative chaos spawn rate (1 = base). */
  chaosRate: number;
  /** Four-player-only mechanics allowed. */
  quad: boolean;
  /** Heat level (pops, decaying over HEAT.decaySeconds) at which the governor kicks in. */
  heatThreshold: number;
}

const PROFILES: readonly ScaleProfile[] = [
  { players: 1, speedMul: 1.0, timeMul: 1.0, dropMul: 1.0, specialShare: 0, chaos: false, chaosRate: 0, quad: false, heatThreshold: 9 },
  { players: 2, speedMul: 1.03, timeMul: 1.0, dropMul: 0.9, specialShare: 0.15, chaos: true, chaosRate: 1, quad: false, heatThreshold: 7 },
  { players: 3, speedMul: 1.06, timeMul: 0.95, dropMul: 0.8, specialShare: 0.25, chaos: true, chaosRate: 1, quad: false, heatThreshold: 6 },
  { players: 4, speedMul: 1.09, timeMul: 0.9, dropMul: 0.7, specialShare: 0.35, chaos: true, chaosRate: 1.25, quad: true, heatThreshold: 5 },
];

export function scaleProfile(players: number): ScaleProfile {
  const n = Math.min(Math.max(Math.round(players) || 1, 1), PROFILES.length);
  return PROFILES[n - 1];
}
