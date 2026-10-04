import { BUBBLE_SIZES, CHAOS, CHAOS_KINDS, HARPOON, RARE, INPUT, PHYSICS, PLAYER, POWERUP, STAGE, TICK_DT, WORLD, bounceVelocity } from '../constants/game';
import type { Rect } from '../types/level';
import type { BubbleState, PowerUpState } from '../types/state';

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export function circleRectOverlap(cx: number, cy: number, r: number, rect: Rect): boolean {
  const px = clamp(cx, rect.x, rect.x + rect.w);
  const py = clamp(cy, rect.y, rect.y + rect.h);
  const dx = cx - px;
  const dy = cy - py;
  return dx * dx + dy * dy < r * r;
}

/** Horizontal player movement. Shared by server simulation and client prediction. */
export function movePlayerX(x: number, input: number, speedMul: number, dt = TICK_DT): number {
  const dir = (input & INPUT.RIGHT ? 1 : 0) - (input & INPUT.LEFT ? 1 : 0);
  if (dir === 0) return x;
  const half = PLAYER.width / 2;
  return clamp(x + dir * PLAYER.speed * speedMul * dt, half, WORLD.width - half);
}

/** What a chaos effect does to movement. Shared by the simulation and client prediction. */
export interface MoveFx {
  flip?: boolean;
  slow?: boolean;
  /** Tether partner's x, when tethered. */
  tetherX?: number | null;
  /** Split Wall: the furthest this Lancer may go left and right. */
  lo?: number;
  hi?: number;
}

/** Wall bounds for a Lancer at x (left of the wall it stays left, right of it stays right). */
export function wallBounds(wallX: number, x: number): MoveFx {
  const edge = STAGE.wall.thickness / 2 + PLAYER.width / 2;
  return x < wallX ? { lo: PLAYER.width / 2, hi: wallX - edge } : { lo: wallX + edge, hi: WORLD.width - PLAYER.width / 2 };
}

/** Movement effect for a chaos effect index (0 = none) and the tether partner's x. */
export function moveFxOf(fx: number, partnerX: number | null): MoveFx {
  const kind = fx > 0 ? CHAOS_KINDS[fx - 1] : null;
  return { flip: kind === 'flip', slow: kind === 'slow', tetherX: kind === 'tether' ? partnerX : null };
}

/** movePlayerX plus chaos effects: reversed keys, slowed legs, a tether to a teammate. */
export function movePlayerFx(x: number, input: number, speedMul: number, fx: MoveFx | undefined, dt = TICK_DT): number {
  if (!fx || (!fx.flip && !fx.slow && fx.tetherX == null && fx.lo === undefined)) return movePlayerX(x, input, speedMul, dt);
  let bits = input;
  if (fx.flip) bits = (input & ~(INPUT.LEFT | INPUT.RIGHT)) | (input & INPUT.LEFT ? INPUT.RIGHT : 0) | (input & INPUT.RIGHT ? INPUT.LEFT : 0);
  let nx = movePlayerX(x, bits, fx.slow ? speedMul * CHAOS.slowMul : speedMul, dt);
  if (fx.lo !== undefined) nx = clamp(nx, fx.lo, fx.hi ?? WORLD.width);
  if (fx.tetherX == null) return nx;
  const range = CHAOS.tetherRange;
  if (Math.abs(x - fx.tetherX) > range) return Math.abs(nx - fx.tetherX) < Math.abs(x - fx.tetherX) ? nx : x; // already stretched: only moves toward the partner
  return clamp(nx, fx.tetherX - range, fx.tetherX + range);
}

/** Everything that changes how fast a Lancer runs, in one place (simulation and client prediction). */
export function speedMulOf(p: { speed: number; potato: number; boots: number }): number {
  return (p.speed > 0 || p.potato > 0 ? POWERUP.speedMultiplier : 1) * (p.boots > 0 ? RARE.bootsMul : 1);
}

export function playerHitbox(x: number): Rect {
  return {
    x: x - PLAYER.hitboxWidth / 2,
    y: WORLD.height - PLAYER.hitboxHeight,
    w: PLAYER.hitboxWidth,
    h: PLAYER.hitboxHeight,
  };
}

export function harpoonRect(x: number, tipY: number, width: number = HARPOON.width): Rect {
  return { x: x - width / 2, y: tipY, w: width, h: WORLD.height - tipY };
}

function collideBubblePlatform(b: BubbleState, p: Rect, speedMul: number): void {
  const r = BUBBLE_SIZES[b.size].radius;
  const cx = clamp(b.x, p.x, p.x + p.w);
  const cy = clamp(b.y, p.y, p.y + p.h);
  const dx = b.x - cx;
  const dy = b.y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return;

  let nx: number;
  let ny: number;
  if (d2 === 0) {
    // Center inside the platform (only after extreme speeds): exit through the
    // face of least penetration.
    const pens = [b.x - p.x, p.x + p.w - b.x, b.y - p.y, p.y + p.h - b.y];
    const m = Math.min(...pens);
    nx = m === pens[0] ? -1 : m === pens[1] ? 1 : 0;
    ny = nx !== 0 ? 0 : m === pens[2] ? -1 : 1;
    if (nx < 0) b.x = p.x - r;
    else if (nx > 0) b.x = p.x + p.w + r;
    else if (ny < 0) b.y = p.y - r;
    else b.y = p.y + p.h + r;
  } else {
    const d = Math.sqrt(d2);
    nx = dx / d;
    ny = dy / d;
    b.x = cx + nx * r;
    b.y = cy + ny * r;
  }

  if (Math.abs(ny) >= Math.abs(nx)) {
    if (ny < 0) {
      // Landed on top: consistent arcade bounce height above this surface.
      if (b.vy > 0) b.vy = -bounceVelocity(b.size, speedMul);
    } else if (b.vy < 0) {
      b.vy = -b.vy;
    }
  } else if (nx * b.vx < 0) {
    b.vx = -b.vx;
  }
}

function integrateBubble(b: BubbleState, dt: number, platforms: readonly Rect[], speedMul: number, gravMul: number): void {
  const r = BUBBLE_SIZES[b.size].radius;
  b.vy += PHYSICS.gravity * speedMul * speedMul * gravMul * dt;
  b.x += b.vx * dt;
  b.y += b.vy * dt;

  if (b.x - r < 0) {
    b.x = r;
    b.vx = Math.abs(b.vx);
  } else if (b.x + r > WORLD.width) {
    b.x = WORLD.width - r;
    b.vx = -Math.abs(b.vx);
  }
  if (b.y + r >= WORLD.height) {
    b.y = WORLD.height - r;
    b.vy = -bounceVelocity(b.size, speedMul);
  } else if (b.y - r < 0) {
    b.y = r;
    b.vy = Math.abs(b.vy);
  }
  for (const p of platforms) collideBubblePlatform(b, p, speedMul);
}

/**
 * Advance an orb by `dt` seconds (any dt; the client uses fractional ticks for
 * rendering). Internally substeps at a fixed maximum step for consistency.
 */
export function advanceBubble(b: BubbleState, dt: number, platforms: readonly Rect[], speedMul: number, gravMul = 1): void {
  const maxStep = TICK_DT / PHYSICS.substeps;
  let remaining = dt;
  while (remaining > 1e-9) {
    const step = Math.min(maxStep, remaining);
    integrateBubble(b, step, platforms, speedMul, gravMul);
    remaining -= step;
  }
}

/** Advance a falling power-up; lands on the floor or on top of a platform. */
export function advancePowerUp(u: PowerUpState, dt: number, platforms: readonly Rect[]): void {
  if (u.grounded) return;
  const half = POWERUP.size / 2;
  const oldBottom = u.y + half;
  let newBottom = oldBottom + POWERUP.fallSpeed * dt;
  for (const p of platforms) {
    if (u.x >= p.x && u.x <= p.x + p.w && oldBottom <= p.y && newBottom >= p.y) {
      newBottom = p.y;
      u.grounded = true;
    }
  }
  if (newBottom >= WORLD.height) {
    newBottom = WORLD.height;
    u.grounded = true;
  }
  u.y = newBottom - half;
}

/**
 * Advance a harpoon tip. Returns the new tip y, or null when the tether hits the
 * ceiling or the underside of a platform.
 */
export function advanceHarpoon(x: number, tipY: number, dt: number, platforms: readonly Rect[], width: number = HARPOON.width): number | null {
  const newTip = tipY - HARPOON.speed * dt;
  const hw = width / 2;
  for (const p of platforms) {
    if (x + hw <= p.x || x - hw >= p.x + p.w) continue;
    const bottom = p.y + p.h;
    if (tipY >= bottom && newTip < bottom) return null;
    if (tipY > p.y && tipY < bottom) return null;
  }
  return newTip <= 0 ? null : newTip;
}

/**
 * Where an anchor harpoon sticks when its tether stops: the ceiling (0), or the underside of
 * the platform it ran into. Call with the tip position from before the blocked move.
 */
export function anchorStickY(x: number, tipY: number, platforms: readonly Rect[], width: number = HARPOON.width): number {
  const hw = width / 2;
  let y = 0;
  for (const p of platforms) {
    if (x + hw <= p.x || x - hw >= p.x + p.w) continue;
    const bottom = p.y + p.h;
    if (bottom <= tipY + 1e-6 && bottom > y) y = bottom;
  }
  return y;
}
