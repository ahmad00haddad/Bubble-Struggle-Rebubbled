import { HARPOON, RARE, SKY, TICK_DT, activePlatforms, advanceBubble, orbSpeedMul, scaleProfile, type LevelConfig, type Snapshot } from '@orb/shared';
import type { ViewState } from './types';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Furthest we extrapolate past the newest snapshot (packet loss / jitter). */
const MAX_EXTRAPOLATE_TICKS = 4;

/**
 * Build a render state for render tick `rt` from the snapshot pair (a, b).
 *  - players / harpoons / power-ups: linear interpolation a → b
 *  - orbs: deterministic sub-tick simulation from `a` using the shared
 *    physics, so floor bounces stay crisp (linear interpolation would cut
 *    the corner of every bounce).
 */
export function buildView(a: Snapshot, b: Snapshot | null, rt: number, level: LevelConfig | null): ViewState {
  const span = b ? b.tick - a.tick : 1;
  const alpha = b ? Math.min(1, Math.max(0, (rt - a.tick) / span)) : 0;
  const dtTicks = Math.max(0, Math.min(rt - a.tick, b ? span : MAX_EXTRAPOLATE_TICKS));
  const moving = a.phase === 'playing';
  const levelTicks = a.levelTicks + (moving ? dtTicks : 0);
  const platforms = level ? activePlatforms(level, levelTicks) : [];
  // The server scales orb speed by the player count it had at level load; the active count is the best client-side match.
  const gravMul = a.sky?.kind === 'wobble' && a.sky.phase === 'active' ? SKY.wobbleGravity : 1;
  const slowMul = a.slow > 0 ? RARE.slowMul : 1;
  const scaleSpeed = scaleProfile(a.players.filter((p) => p.active).length).speedMul;

  return {
    phase: a.phase,
    phaseTicks: a.phaseTicks,
    timeLeftTicks: a.timeLeftTicks,
    levelIndex: a.levelIndex,
    sky: a.sky,
    heat: a.heat,
    slow: a.slow,
    levelTicks,
    players: a.players.map((p) => {
      const q = b?.players[p.slot];
      const x = q && q.life === p.life ? lerp(p.x, q.x, alpha) : p.x;
      return { ...p, x };
    }),
    bubbles: a.bubbles.map((o) => {
      const extra = { rage: o.rage, hot: o.hot, frozen: o.frozen, sp: o.sp, sa: o.sa, lk: o.lk, hm: o.hm, n: o.n };
      if (!moving || dtTicks <= 0 || !level || o.frozen) return { id: o.id, size: o.size, x: o.x, y: o.y, fast: o.fast, ...extra };
      const c = { ...o };
      advanceBubble(c, dtTicks * TICK_DT, platforms, orbSpeedMul(level, o.fast, scaleSpeed, o.rage, o.hot, slowMul), gravMul);
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
