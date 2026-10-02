import { describe, expect, it } from 'vitest';
import {
  BUBBLE_SIZES,
  GameSimulation,
  HEAT,
  Match,
  TICK_RATE,
  decodeSnapshot,
  encodeSnapshot,
  orbSpeedMul,
  scaleProfile,
  type BubbleSpawn,
  type SimEvent,
} from '@orb/shared';
import { measure } from './balance/harness';
import { testLevel } from './helpers';

const seats = (n: number) => Array.from({ length: 4 }, (_, i) => i < n);
const crowd = (count: number): BubbleSpawn[] =>
  Array.from({ length: count }, (_, i) => ({ size: 1 as const, x: 60 + i * 55, y: 120 + (i % 3) * 20, velocityX: 0 }));
const mk = (n: number, bubbles: BubbleSpawn[], seed = 1) =>
  new GameSimulation({ levels: [testLevel({ bubbles, timeLimit: 300 })], activeSlots: seats(n), seed });

/** Pop `k` orbs straight away by placing harpoons (one per tick keeps it simple and deterministic). */
function popOrbs(s: GameSimulation, k: number): SimEvent[] {
  const out: SimEvent[] = [];
  let id = 8000;
  for (let i = 0; i < k; i++) {
    const b = s.bubbles.find((o) => o.size === 1 || o.size === 0);
    if (!b) break;
    s.harpoons.push({ id: id++, owner: i % 4, x: b.x, tipY: Math.min(b.y + BUBBLE_SIZES[b.size].radius + 8, 436) });
    s.step();
    out.push(...s.drainEvents());
  }
  return out;
}

describe('heat governor', () => {
  it('thresholds fall as players are added', () => {
    const t = [1, 2, 3, 4].map((n) => scaleProfile(n).heatThreshold);
    expect(t).toEqual([...t].sort((a, b) => b - a));
    expect(new Set(t).size).toBe(4);
  });

  it('each pop adds one heat and heat decays with its time constant', () => {
    const s = mk(2, crowd(12));
    popOrbs(s, 3);
    expect(s.heat).toBeGreaterThan(2.5);
    expect(s.heat).toBeLessThanOrEqual(3);
    const h0 = s.heat;
    for (let i = 0; i < HEAT.decaySeconds * TICK_RATE; i++) s.step();
    expect(s.heat).toBeCloseTo(h0 / Math.E, 1);
  });

  it.each([1, 2, 3, 4])('with %i player(s): trips only when popping fast enough, then cools', (n) => {
    const thr = scaleProfile(n).heatThreshold;
    const s = mk(n, crowd(14));
    const ev = popOrbs(s, Math.ceil(thr) + 1);
    expect(ev.some((e) => e.k === 'heat' && e.on)).toBe(true);
    expect(s.hot).toBe(true);
    // Left alone it cools below the hysteresis level and switches off.
    const off: SimEvent[] = [];
    for (let i = 0; i < 30 * TICK_RATE && s.hot; i++) {
      s.step();
      off.push(...s.drainEvents());
    }
    expect(s.hot).toBe(false);
    expect(off.some((e) => e.k === 'heat' && !e.on)).toBe(true);
  });

  it('slow popping never trips it', () => {
    const s = mk(4, crowd(14));
    for (let i = 0; i < 6; i++) {
      popOrbs(s, 1);
      for (let t = 0; t < 4 * TICK_RATE; t++) s.step();
    }
    expect(s.hot).toBe(false);
  });

  it('children spawned while hot are faster, then return to normal speed', () => {
    const s = mk(4, [{ size: 2, x: 700, y: 150, velocityX: 0 }, ...crowd(10)]);
    popOrbs(s, 6);
    expect(s.hot).toBe(true);
    const big = s.bubbles.find((b) => b.size === 2)!;
    s.harpoons.push({ id: 7000, owner: 0, x: big.x, tipY: Math.min(big.y + 38, 436) });
    s.step();
    const kids = s.bubbles.filter((b) => b.size === 1 && b.hot);
    expect(kids.length).toBeGreaterThanOrEqual(2);
    const speed = Math.abs(kids[0].vx);
    const base = BUBBLE_SIZES[1].speedX * scaleProfile(4).speedMul * 1; // level speed 1
    expect(speed).toBeCloseTo(base * HEAT.boostMul, 1);
    for (let i = 0; i < HEAT.boostSeconds * TICK_RATE + 3; i++) s.step();
    const still = s.bubbles.find((b) => b.id === kids[0].id);
    expect(still?.hot).toBeUndefined();
    expect(Math.abs(still!.vx)).toBeCloseTo(base, 1);
  });

  it('ordinary orbs do not carry heat fields when cold', () => {
    const s = mk(2, crowd(4));
    for (let i = 0; i < 100; i++) s.step();
    expect(s.bubbles.every((b) => b.hot === undefined && b.ht === undefined)).toBe(true);
    expect(s.hot).toBe(false);
  });

  it('never hurts a Lancer: no life is lost to heat alone', () => {
    const s = mk(4, crowd(14));
    popOrbs(s, 10);
    expect(s.players.every((p) => p.lives === 3)).toBe(true);
  });

  it('a level reload resets heat', () => {
    const s = mk(4, crowd(14));
    popOrbs(s, 8);
    s.loadLevel(0);
    expect(s.heat).toBe(0);
    expect(s.hot).toBe(false);
  });

  it('boost speed shows up in the shared physics multiplier', () => {
    expect(orbSpeedMul(testLevel(), false, 1, false, true)).toBeCloseTo(HEAT.boostMul, 5);
  });

  it('heat rides the snapshot as a percentage of the threshold and the hot flag on orbs', () => {
    const m = new Match({ levels: [testLevel({ bubbles: crowd(14), timeLimit: 300 })], activeSlots: seats(4), seed: 1 });
    for (let i = 0; i < 100; i++) m.advance();
    expect(encodeSnapshot(m, []).hl).toBeUndefined();
    popOrbs(m.sim, 7);
    const msg = encodeSnapshot(m, []);
    expect(msg.hl).toBeGreaterThan(100);
    const snap = decodeSnapshot(JSON.parse(JSON.stringify(msg)));
    expect(snap.heat).toBeGreaterThan(1);
    m.sim.bubbles[0].hot = true;
    const snap2 = decodeSnapshot(JSON.parse(JSON.stringify(encodeSnapshot(m, []))));
    expect(snap2.bubbles[0].hot).toBe(true);
  });

  it('is deterministic', () => {
    const run = () => {
      const s = mk(3, crowd(14), 5);
      popOrbs(s, 9);
      for (let i = 0; i < 200; i++) s.step();
      return JSON.stringify([s.bubbles, s.heat, s.hot]);
    };
    expect(run()).toBe(run());
  });

  it('the harness reports a heat peak, higher for bigger teams', () => {
    const solo = measure(testLevel({ bubbles: crowd(14), timeLimit: 120 }), 1, 4).heatPeak!;
    const quad = measure(testLevel({ bubbles: crowd(14), timeLimit: 120 }), 4, 4).heatPeak!;
    expect(quad).toBeGreaterThan(solo);
  });
});
