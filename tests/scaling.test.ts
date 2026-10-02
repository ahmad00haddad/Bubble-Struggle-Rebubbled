import { describe, expect, it } from 'vitest';
import { GameSimulation, INPUT, LEVELS, TICK_RATE, orbSpeedMul, scaleProfile } from '@orb/shared';
import { formatTable, measure, runLevel } from './balance/harness';
import { testLevel } from './helpers';

const seats = (n: number) => Array.from({ length: 4 }, (_, i) => i < n);
const make = (n: number, over = {}, seed = 1) => new GameSimulation({ levels: [testLevel(over)], activeSlots: seats(n), seed });

describe('ScaleProfile', () => {
  it('matches the agreed table for 1..4 players', () => {
    expect(scaleProfile(1)).toMatchObject({ speedMul: 1, timeMul: 1, dropMul: 1, specialShare: 0, chaos: false, quad: false });
    expect(scaleProfile(2)).toMatchObject({ speedMul: 1.03, timeMul: 1, dropMul: 0.9, specialShare: 0.15, chaos: true, quad: false });
    expect(scaleProfile(3)).toMatchObject({ speedMul: 1.06, timeMul: 0.95, dropMul: 0.8, specialShare: 0.25, chaos: true, quad: false });
    expect(scaleProfile(4)).toMatchObject({ speedMul: 1.09, timeMul: 0.9, dropMul: 0.7, specialShare: 0.35, chaos: true, quad: true });
    expect(scaleProfile(4).chaosRate).toBeGreaterThan(scaleProfile(2).chaosRate);
  });

  it('clamps odd inputs', () => {
    expect(scaleProfile(0).players).toBe(1);
    expect(scaleProfile(9).players).toBe(4);
    expect(scaleProfile(Number.NaN).players).toBe(1);
  });

  it('solo never enables chaos or four-player mechanics', () => {
    const p = scaleProfile(1);
    expect(p.chaos).toBe(false);
    expect(p.quad).toBe(false);
    expect(p.chaosRate).toBe(0);
  });

  it('only four players enable four-player mechanics', () => {
    expect([1, 2, 3, 4].map((n) => scaleProfile(n).quad)).toEqual([false, false, false, true]);
  });
});

describe('scaling in the simulation', () => {
  it('shortens the clock by player count', () => {
    const limits = [1, 2, 3, 4].map((n) => make(n).timeLeftTicks);
    expect(limits).toEqual([60, 60, 57, 54].map((s) => s * TICK_RATE));
  });

  it('speeds up new orbs by player count', () => {
    const vx = (n: number) => Math.abs(make(n, { bubbles: [{ size: 2, x: 200, y: 200 }] }).bubbles[0].vx);
    expect(vx(2) / vx(1)).toBeCloseTo(1.03, 5);
    expect(vx(4) / vx(1)).toBeCloseTo(1.09, 5);
  });

  it('speeds up orb physics through orbSpeedMul', () => {
    expect(orbSpeedMul(testLevel(), false, 1.09)).toBeCloseTo(1.09, 5);
    expect(orbSpeedMul(testLevel(), true, 1.09)).toBeCloseTo(1.09 * 1.5, 5);
  });

  it('lowers the power-up drop chance by player count', () => {
    // A roll of 0.8 beats solo's 1.0 chance but not four players' 0.7 chance.
    const drops = (n: number) => {
      const s = make(n, {
        bubbles: [{ size: 0, x: 200, y: 300, velocityX: 0 }],
        powerUps: { dropChance: 1, pool: { shield: 1 }, placed: [] },
      });
      (s.rng as unknown as { next: () => number }).next = () => 0.8;
      s.setInput(0, INPUT.SHOOT, 1);
      for (let i = 0; i < 40 && s.status === 'running'; i++) s.step();
      return s.drainEvents().filter((e) => e.k === 'drop').length;
    };
    expect(drops(1)).toBe(1);
    expect(drops(4)).toBe(0);
  });

  it('does not rescale a running level when a seat joins or leaves', () => {
    const s = make(2);
    const before = { scale: s.scale, left: s.timeLeftTicks };
    s.setActive(1, false);
    s.setActive(2, true);
    expect(s.scale).toBe(before.scale);
    expect(s.timeLeftTicks).toBe(before.left);
    s.loadLevel(0);
    expect(s.scale.players).toBe(2);
  });

  it('rescales on the next level load after a partner leaves', () => {
    const s = make(4);
    expect(s.scale.players).toBe(4);
    s.setActive(1, false);
    s.setActive(2, false);
    s.setActive(3, false);
    s.loadLevel(0);
    expect(s.scale.players).toBe(1);
    expect(s.timeLeftTicks).toBe(60 * TICK_RATE);
  });
});

describe('balance harness', () => {
  it('is deterministic', () => {
    const a = runLevel(LEVELS[3], 3, 42);
    const b = runLevel(LEVELS[3], 3, 42);
    expect(b).toEqual(a);
  });

  it('reports unmeasured counters as null, never as zero', () => {
    const r = runLevel(LEVELS[0], 1, 1);
    expect(r.specialsTriggered).toBeNull();
    expect(r.skyEvents).toBeTypeOf('number');
    expect(r.heatPeak).toBeTypeOf('number');
    expect(r.popped).toBeGreaterThan(0);
    expect(formatTable([measure(LEVELS[0], 1, 2)])).toContain('dawn-drift');
  });
});

describe('early levels', () => {
  it('keeps the levels 1-10 teaching order', () => {
    expect(LEVELS.slice(0, 10).map((l) => l.id)).toEqual([
      'dawn-drift',
      'twin-tides',
      'ledge-garden',
      'quickstep',
      'the-comb',
      'crossfire',
      'overhang',
      'hailstorm',
      'labyrinth',
      'final-bloom',
    ]);
  });

  it('level 1 already has more than one orb and a real clock', () => {
    expect(LEVELS[0].bubbles.length).toBeGreaterThanOrEqual(3);
    expect(LEVELS[0].timeLimit).toBeLessThanOrEqual(45);
  });

  it('four players cannot trivialize levels 1-10 (measured with the bots)', () => {
    for (let i = 0; i < 10; i++) {
      const solo = measure(LEVELS[i], 1, 6);
      const quad = measure(LEVELS[i], 4, 6);
      expect(quad.clearSecondsMedian, LEVELS[i].id).not.toBeNull();
      // Floors, not targets: a regression to the old trivial pacing would trip these.
      expect(quad.clearSecondsMedian!, `${LEVELS[i].id} 4P clear time`).toBeGreaterThanOrEqual(5);
      if (solo.clearSecondsMedian !== null) {
        expect(quad.clearSecondsMedian! / solo.clearSecondsMedian, `${LEVELS[i].id} 4P/solo ratio`).toBeGreaterThanOrEqual(0.2);
      }
    }
  });

  it('level 1 takes a solo bot clearly longer than the old single-orb layout did', () => {
    // Old level 1 (single large orb) measured about 11 s; the retune must stay well above that.
    expect(measure(LEVELS[0], 1, 6).clearSecondsMedian!).toBeGreaterThanOrEqual(15);
  });
});
