import { describe, expect, it } from 'vitest';
import {
  BUBBLE_SIZES,
  INPUT,
  PLAYER,
  TICK_DT,
  WORLD,
  advanceBubble,
  advanceHarpoon,
  circleRectOverlap,
  movePlayerX,
  type BubbleState,
} from '@orb/shared';

const bubble = (over: Partial<BubbleState> = {}): BubbleState => ({ id: 1, size: 2, x: 480, y: 200, vx: 100, vy: 0, ...over });

describe('orb physics', () => {
  it('bounces off the floor to a consistent arcade height', () => {
    const b = bubble({ vx: 0 });
    const r = BUBBLE_SIZES[2].radius;
    const apexes: number[] = [];
    let prevVy = b.vy;
    for (let i = 0; i < 30 * 12; i++) {
      advanceBubble(b, TICK_DT, [], 1);
      if (prevVy < 0 && b.vy >= 0) apexes.push(b.y);
      prevVy = b.vy;
      expect(b.y + r).toBeLessThanOrEqual(WORLD.height + 1e-6);
    }
    expect(apexes.length).toBeGreaterThan(3);
    const expected = WORLD.height - r - BUBBLE_SIZES[2].bounceHeight;
    for (const a of apexes) expect(Math.abs(a - expected)).toBeLessThan(6);
  });

  it('keeps the same bounce shape when sped up (difficulty multiplier)', () => {
    const a = bubble({ vx: 0 });
    const b = bubble({ vx: 0 });
    let minA = Infinity;
    let minB = Infinity;
    for (let i = 0; i < 30 * 10; i++) {
      advanceBubble(a, TICK_DT, [], 1);
      advanceBubble(b, TICK_DT, [], 1.5);
      if (i > 60) {
        minA = Math.min(minA, a.y);
        minB = Math.min(minB, b.y);
      }
    }
    expect(Math.abs(minA - minB)).toBeLessThan(8);
  });

  it('reflects off both walls', () => {
    const b = bubble({ x: 40, vx: -300 });
    advanceBubble(b, TICK_DT * 3, [], 1);
    expect(b.vx).toBeGreaterThan(0);
    expect(b.x - BUBBLE_SIZES[2].radius).toBeGreaterThanOrEqual(0);
    const c = bubble({ x: WORLD.width - 40, vx: 300 });
    advanceBubble(c, TICK_DT * 3, [], 1);
    expect(c.vx).toBeLessThan(0);
  });

  it('lands on top of a platform and bounces up', () => {
    const plat = { x: 400, y: 300, w: 160, h: 16 };
    const b = bubble({ x: 480, y: 240, vx: 0, vy: 200 });
    advanceBubble(b, TICK_DT * 6, [plat], 1);
    expect(b.vy).toBeLessThan(0);
    expect(b.y + BUBBLE_SIZES[2].radius).toBeLessThanOrEqual(plat.y + 0.01);
  });

  it('bounces down off the underside of a platform', () => {
    const plat = { x: 400, y: 200, w: 160, h: 16 };
    const b = bubble({ x: 480, y: 260, vx: 0, vy: -400 });
    advanceBubble(b, TICK_DT * 4, [plat], 1);
    expect(b.vy).toBeGreaterThan(0);
    expect(b.y - BUBBLE_SIZES[2].radius).toBeGreaterThanOrEqual(plat.y + plat.h - 0.01);
  });

  it('bounces sideways off a platform edge', () => {
    const plat = { x: 400, y: 200, w: 160, h: 60 };
    const b = bubble({ x: 365, y: 230, vx: 300, vy: 0 });
    advanceBubble(b, TICK_DT, [plat], 0.0001);
    expect(b.vx).toBeLessThan(0);
  });
});

describe('player movement', () => {
  it('moves by speed and clamps to the arena', () => {
    expect(movePlayerX(100, INPUT.RIGHT, 1)).toBeCloseTo(100 + PLAYER.speed * TICK_DT);
    expect(movePlayerX(100, INPUT.LEFT | INPUT.RIGHT, 1)).toBe(100);
    expect(movePlayerX(5, INPUT.LEFT, 1)).toBe(PLAYER.width / 2);
    expect(movePlayerX(WORLD.width, INPUT.RIGHT, 1)).toBe(WORLD.width - PLAYER.width / 2);
  });
});

describe('harpoon', () => {
  it('stops at the ceiling', () => {
    expect(advanceHarpoon(100, 10, TICK_DT, [])).toBeNull();
  });
  it('stops under a platform it hits', () => {
    const plat = { x: 80, y: 200, w: 60, h: 16 };
    expect(advanceHarpoon(100, 230, TICK_DT, [plat])).toBeNull();
    expect(advanceHarpoon(300, 230, TICK_DT, [plat])).not.toBeNull();
  });
});

describe('circleRectOverlap', () => {
  it('detects overlap and separation', () => {
    const r = { x: 0, y: 0, w: 10, h: 10 };
    expect(circleRectOverlap(15, 5, 6, r)).toBe(true);
    expect(circleRectOverlap(17, 5, 6, r)).toBe(false);
    expect(circleRectOverlap(14, 14, 5, r)).toBe(false);
  });
});
