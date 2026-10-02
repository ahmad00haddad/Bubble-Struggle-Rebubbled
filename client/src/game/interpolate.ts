import { HARPOON, RARE, SKY, TICK_DT, activePlatforms, advanceBubble, orbSpeedMul, scaleProfile, type LevelConfig, type Snapshot } from '@orb/shared';
import type { ViewState } from './types';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Furthest we extrapolate past the newest snapshot (packet loss / jitter). */
const MAX_EXTRAPOLATE_TICKS = 4;
/** Orbs are predictable, so they may run a little further ahead of the last snapshot. */
export const MAX_ORB_EXTRAPOLATE_TICKS = 6;

/** Orbs drawn from the newest snapshot, advanced by `ticks` of shared physics (no interpolation delay). */
export interface OrbFeed {
  snap: Snapshot;
  ticks: number;
}

/**
 * Build a render state for render tick `rt` from the snapshot pair (a, b).
 *  - players / harpoons / power-ups: linear interpolation a → b
 *  - orbs: deterministic sub-tick simulation using the shared physics, so floor bounces stay
 *    crisp. With `orbs` they start from the newest snapshot instead of the delayed pair: orb
 *    paths are fully predictable, so they need no interpolation delay.
 */
export function buildView(a: Snapshot, b: Snapshot | null, rt: number, level: LevelConfig | null, orbs?: OrbFeed): ViewState {
  const span = b ? b.tick - a.tick : 1;
  const alpha = b ? Math.min(1, Math.max(0, (rt - a.tick) / span)) : 0;
  const dtTicks = Math.max(0, Math.min(rt - a.tick, b ? span : MAX_EXTRAPOLATE_TICKS));
  const os = orbs?.snap ?? a;
  const od = orbs ? orbs.ticks : dtTicks;
  const moving = os.phase === 'playing';
  const levelTicks = os.levelTicks + (moving ? od : 0);
  const platforms = level ? activePlatforms(level, levelTicks) : [];
  // The server scales orb speed by the player count it had at level load; the active count is the best client-side match.
  const gravMul = os.sky?.kind === 'wobble' && os.sky.phase === 'active' ? SKY.wobbleGravity : 1;
  const slowMul = os.slow > 0 ? RARE.slowMul : 1;
  const scaleSpeed = scaleProfile(os.players.filter((p) => p.active).length).speedMul;

  return {
    phase: a.phase,
    phaseTicks: a.phaseTicks,
    timeLeftTicks: a.timeLeftTicks,
    levelIndex: a.levelIndex,
    sky: os.sky,
    heat: os.heat,
    slow: os.slow,
    levelTicks,
    players: a.players.map((p) => {
      const q = b?.players[p.slot];
      const x = q && q.life === p.life ? lerp(p.x, q.x, alpha) : p.x;
      return { ...p, x };
    }),
    bubbles: os.bubbles.map((o) => {
      const extra = { rage: o.rage, hot: o.hot, frozen: o.frozen, sp: o.sp, sa: o.sa, lk: o.lk, hm: o.hm, n: o.n };
      if (!moving || od <= 0 || !level || o.frozen) return { id: o.id, size: o.size, x: o.x, y: o.y, fast: o.fast, ...extra };
      const c = { ...o };
      advanceBubble(c, od * TICK_DT, platforms, orbSpeedMul(level, o.fast, scaleSpeed, o.rage, o.hot, slowMul), gravMul);
      return { id: c.id, size: c.size, x: c.x, y: c.y, fast: o.fast, ...extra };
    }),
    harpoons: a.harpoons.map((h) => {
      const q = b?.harpoons.find((x) => x.id === h.id);
      const tipY = q ? lerp(h.tipY, q.tipY, alpha) : moving ? Math.max(0, h.tipY - HARPOON.speed * dtTicks * TICK_DT) : h.tipY;
      return { ...h, tipY };
    }),
    bombs: a.bombs.map((k) => {
      const q = b?.bombs.find((x) => x.id === k.id);
      return { ...k, y: q ? lerp(k.y, q.y, alpha) : k.y };
    }),
    powerups: a.powerups.map((u) => {
      const q = b?.powerups.find((x) => x.id === u.id);
      return { ...u, y: q ? lerp(u.y, q.y, alpha) : u.y };
    }),
  };
}
