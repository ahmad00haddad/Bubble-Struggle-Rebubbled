import { describe, expect, it } from 'vitest';
import { GameSimulation, LEVELS, validateLevel, type SpecialKind } from '@orb/shared';

const COOP: SpecialKind[] = ['coop', 'link', 'priority'];
const kindsOf = (i: number) => [...new Set(LEVELS[i].bubbles.map((b) => b.special).filter((k): k is SpecialKind => !!k && COOP.includes(k)))];
const seats = (n: number) => Array.from({ length: 4 }, (_, i) => i < n);
const load = (i: number, n: number) => {
  const s = new GameSimulation({ levels: LEVELS, activeSlots: seats(n), seed: 11 });
  s.loadLevel(i);
  return s;
};

describe('cooperative levels 11-25', () => {
  it('all levels stay valid', () => {
    for (const l of LEVELS) expect(validateLevel(l)).toEqual([]);
  });

  it('levels 1-11 have no cooperative targets; one new kind arrives each on 12, 13 and 14', () => {
    for (let i = 0; i < 11; i++) expect(kindsOf(i)).toEqual([]);
    expect(kindsOf(11)).toEqual(['coop']);
    expect(kindsOf(12)).toEqual(['link']);
    expect(kindsOf(13)).toEqual(['priority']);
  });

  it('every level from 12 on has at least one cooperative target; the finale uses all three kinds', () => {
    for (let i = 11; i < LEVELS.length; i++) expect(kindsOf(i).length).toBeGreaterThan(0);
    expect(kindsOf(LEVELS.length - 1).sort()).toEqual([...COOP].sort());
  });

  it.each(Array.from({ length: 14 }, (_, k) => k + 11))('level %i: solo gets no cooperative state', (i) => {
    const s = load(i, 1);
    expect(s.bubbles.filter((b) => b.sp && COOP.includes(b.sp))).toHaveLength(0);
    expect(s.coopStats.spawned).toBe(0);
  });

  it.each([2, 3, 4])('with %i players every cooperative level spawns its targets', (n) => {
    for (let i = 11; i < LEVELS.length; i++) {
      const s = load(i, n);
      expect(s.coopStats.spawned, LEVELS[i].id).toBeGreaterThan(0);
    }
  });

  it('level setup is deterministic for the same seed', () => {
    const a = JSON.stringify(load(23, 4).bubbles);
    expect(JSON.stringify(load(23, 4).bubbles)).toBe(a);
  });
});

describe('random level order', () => {
  it('shuffleLevels is a deterministic permutation and honours "first"', async () => {
    const { shuffleLevels } = await import('@orb/shared');
    const a = shuffleLevels(LEVELS, 5);
    expect(a.map((l) => l.id)).toEqual(shuffleLevels(LEVELS, 5).map((l) => l.id));
    expect([...a].map((l) => l.id).sort()).toEqual(LEVELS.map((l) => l.id).sort());
    expect(shuffleLevels(LEVELS, 6).map((l) => l.id)).not.toEqual(a.map((l) => l.id));
    expect(shuffleLevels(LEVELS, 5, 11)[0].id).toBe(LEVELS[11].id);
  });

  it('a shuffled Match plays every level once, in an order that differs between seeds', async () => {
    const { Match } = await import('@orb/shared');
    const order = (seed: number) => new Match({ levels: LEVELS, activeSlots: [true, true], seed, shuffle: true }).sim.levels.map((l) => l.id);
    expect(order(1)).toEqual(order(1));
    expect(order(1)).not.toEqual(order(2));
    expect(order(1)).toHaveLength(LEVELS.length);
    expect(new Match({ levels: LEVELS, activeSlots: [true], seed: 1 }).sim.levels).toBe(LEVELS); // default: by difficulty
  });
});
