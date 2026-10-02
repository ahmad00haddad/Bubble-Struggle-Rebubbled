import { describe, expect, it } from 'vitest';
import {
  GameSimulation,
  LEVELS,
  Match,
  Rng,
  SKY,
  TICK_RATE,
  decodeSnapshot,
  encodeSnapshot,
  planSky,
  scaleProfile,
  validateLevel,
  type LevelConfig,
  type SimEvent,
} from '@orb/shared';
import { testLevel } from './helpers';

const seats = (n: number) => Array.from({ length: 4 }, (_, i) => i < n);
const farOrb = [{ size: 3 as const, x: 900, y: 100, velocityX: 0 }];
/** A level with exactly one guaranteed event of `kind`, starting early. */
function eventLevel(kind: keyof typeof SKY.warn, extra: Partial<LevelConfig> = {}): LevelConfig {
  return testLevel({ bubbles: farOrb, timeLimit: 120, sky: { budget: 1, chance: 1, pool: { [kind]: 1 } }, ...extra });
}
const mk = (n: number, level: LevelConfig, seed = 1) => new GameSimulation({ levels: [level], activeSlots: seats(n), seed });

function runUntil(s: GameSimulation, pred: (e: SimEvent) => boolean, max = 60 * TICK_RATE): { tick: number; events: SimEvent[] } {
  const events: SimEvent[] = [];
  for (let i = 1; i <= max; i++) {
    s.step();
    const ev = s.drainEvents();
    events.push(...ev);
    if (ev.some(pred)) return { tick: i, events };
  }
  return { tick: -1, events };
}

describe.each([1, 2, 3, 4])('sky events with %i player(s)', (n) => {
  it('Gift Crate: warns for 1.5 s, then drops one pickup inside the arena', () => {
    const s = mk(n, eventLevel('gift'));
    const warn = runUntil(s, (e) => e.k === 'sky' && e.t === 'warn');
    expect(warn.tick).toBeGreaterThan(0);
    expect(s.sky?.phase).toBe('warn');
    const before = s.powerups.length;
    const land = runUntil(s, (e) => e.k === 'sky' && e.t === 'start');
    expect(land.tick / TICK_RATE).toBeGreaterThanOrEqual(SKY.warn.gift - 0.1);
    expect(s.powerups.length).toBe(before + 1);
    const crate = s.powerups[s.powerups.length - 1];
    expect(crate.x).toBeGreaterThanOrEqual(12);
    expect(crate.x).toBeLessThanOrEqual(948);
    expect(s.sky).toBeNull();
  });

  it('Comet: warns, then one fast orb crosses from a side', () => {
    const s = mk(n, eventLevel('comet'));
    runUntil(s, (e) => e.k === 'sky' && e.t === 'warn');
    const orbs = s.bubbles.length;
    const land = runUntil(s, (e) => e.k === 'sky' && e.t === 'start');
    expect(land.tick / TICK_RATE).toBeGreaterThanOrEqual(SKY.warn.comet - 0.1);
    expect(s.bubbles.length).toBe(orbs + 1);
    const comet = s.bubbles[s.bubbles.length - 1];
    expect(comet.fast).toBe(true);
    expect(comet.size).toBe(1);
    expect([24, 936]).toContain(comet.x);
  });

  it('Hail: warns, then drops three small orbs in well-spaced lanes', () => {
    const s = mk(n, eventLevel('hail'));
    runUntil(s, (e) => e.k === 'sky' && e.t === 'warn');
    const lanes = [...s.sky!.lanes];
    expect(lanes).toHaveLength(SKY.hailCount);
    for (let i = 1; i < lanes.length; i++) expect(lanes[i] - lanes[i - 1]).toBeGreaterThanOrEqual(SKY.hailGap);
    const orbs = s.bubbles.length;
    const land = runUntil(s, (e) => e.k === 'sky' && e.t === 'start');
    expect(land.tick / TICK_RATE).toBeGreaterThanOrEqual(SKY.warn.hail - 0.1);
    expect(s.bubbles.length).toBe(orbs + SKY.hailCount);
    expect(s.bubbles.slice(-SKY.hailCount).every((b) => b.size === 0)).toBe(true);
  });

  it('Gravity Wobble: lighter orb gravity for 6 s, then back to normal', () => {
    const s = mk(n, eventLevel('wobble'));
    expect(s.gravMul).toBe(1);
    runUntil(s, (e) => e.k === 'sky' && e.t === 'start');
    expect(s.gravMul).toBe(SKY.wobbleGravity);
    expect(s.sky?.phase).toBe('active');
    const end = runUntil(s, (e) => e.k === 'sky' && e.t === 'end');
    expect(end.tick / TICK_RATE).toBeGreaterThanOrEqual(SKY.wobbleSeconds - 0.1);
    expect(s.gravMul).toBe(1);
    expect(s.sky).toBeNull();
  });
});

describe('sky events: rules', () => {
  it('never more than one event at a time, even with a crowded plan', () => {
    const s = mk(2, testLevel({ bubbles: farOrb, timeLimit: 600, sky: { budget: 6, chance: 1, pool: { wobble: 1, gift: 1, hail: 1, comet: 1 } } }));
    let live = 0;
    let maxLive = 0;
    let starts = 0;
    for (let i = 0; i < 600 * TICK_RATE && s.status === 'running'; i++) {
      s.step();
      for (const e of s.drainEvents()) {
        if (e.k === 'sky' && e.t === 'warn') live++;
        if (e.k === 'sky' && e.t === 'start') starts++;
        if (e.k === 'sky' && e.t === 'end') live--;
        if (e.k === 'sky' && e.t === 'start' && e.kind !== 'wobble') live--; // one-shots end at landing (their 'end' follows immediately)
        maxLive = Math.max(maxLive, live);
      }
      expect(s.sky === null || s.sky.t > 0).toBe(true);
    }
    expect(starts).toBeGreaterThanOrEqual(3);
    expect(maxLive).toBeLessThanOrEqual(1);
  });

  it('plans nothing in the last quarter of the clock', () => {
    const lvl = testLevel({ timeLimit: 20, sky: { budget: 6, chance: 1 } });
    const plan = planSky(lvl, scaleProfile(1), new Rng(5));
    for (const p of plan) expect(p.at / TICK_RATE).toBeLessThan(20 * SKY.clockGuard);
  });

  it('is rare: a minority of slots happen on a default level', () => {
    const lvl = LEVELS[0];
    let planned = 0;
    for (let seed = 1; seed <= 300; seed++) planned += planSky(lvl, scaleProfile(1), new Rng(seed)).length;
    const perLevel = planned / 300;
    expect(perLevel).toBeGreaterThan(0.2);
    expect(perLevel).toBeLessThan(1.1);
  });

  it('level 1 gets events sometimes (surprises from the first level)', () => {
    const hit = Array.from({ length: 60 }, (_, i) => planSky(LEVELS[0], scaleProfile(1), new Rng(i * 31 + 1)).length).filter((n) => n > 0);
    expect(hit.length).toBeGreaterThan(5);
  });

  it('more players make events a little more frequent', () => {
    const rate = (n: number) => {
      let t = 0;
      for (let seed = 1; seed <= 400; seed++) t += planSky(LEVELS[5], scaleProfile(n), new Rng(seed)).length;
      return t / 400;
    };
    expect(rate(4)).toBeGreaterThan(rate(1));
  });

  it('levels without a sky config have no events', () => {
    const s = mk(2, testLevel({ bubbles: farOrb }));
    for (let i = 0; i < 40 * TICK_RATE; i++) s.step();
    expect(s.sky).toBeNull();
    expect(s.drainEvents().filter((e) => e.k === 'sky')).toHaveLength(0);
  });

  it('the plan is deterministic, uses its own RNG stream, and replays on retry', () => {
    const lvl = eventLevel('gift');
    const plan = (seed: number) => JSON.stringify(planSky(lvl, scaleProfile(2), new Rng(seed)));
    expect(plan(9)).toBe(plan(9));
    const a = mk(2, lvl, 3);
    const b = mk(2, testLevel({ bubbles: farOrb, timeLimit: 120 }), 3);
    expect(a.rng.next()).toBe(b.rng.next()); // drops/bombs stream untouched
    const first = runUntil(a, (e) => e.k === 'sky' && e.t === 'warn').tick;
    a.loadLevel(0);
    expect(runUntil(a, (e) => e.k === 'sky' && e.t === 'warn').tick).toBe(first);
  });

  it('a reload clears a running event', () => {
    const s = mk(2, eventLevel('wobble'));
    runUntil(s, (e) => e.k === 'sky' && e.t === 'start');
    s.loadLevel(0);
    expect(s.sky).toBeNull();
    expect(s.gravMul).toBe(1);
  });

  it('Gift Crate never holds an anchor on noAnchor levels', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = mk(2, eventLevel('gift', { noAnchor: true }), seed);
      runUntil(s, (e) => e.k === 'sky' && e.t === 'start');
      expect(s.powerups.every((u) => u.type !== 'anchor')).toBe(true);
    }
  });

  it('an event is never an unavoidable hit: orbs spawn at the ceiling after a warning', () => {
    const s = mk(2, eventLevel('hail'));
    runUntil(s, (e) => e.k === 'sky' && e.t === 'start');
    for (const b of s.bubbles.slice(-SKY.hailCount)) expect(b.y).toBeLessThan(120);
  });
});

describe('sky events: codec, validation, shipped levels', () => {
  it('the active event survives the snapshot codec', () => {
    const m = new Match({ levels: [eventLevel('hail')], activeSlots: [true, true], seed: 1 });
    for (let i = 0; i < 1500 && !m.sim.sky; i++) m.advance();
    expect(m.sim.sky).not.toBeNull();
    const snap = decodeSnapshot(JSON.parse(JSON.stringify(encodeSnapshot(m, []))));
    expect(snap.sky).toMatchObject({ kind: 'hail', phase: 'warn' });
    expect(snap.sky!.lanes).toHaveLength(SKY.hailCount);
  });

  it('a snapshot without an event omits it', () => {
    const m = new Match({ levels: [testLevel({ bubbles: farOrb })], activeSlots: [true, true], seed: 1 });
    expect(encodeSnapshot(m, []).s).toBeUndefined();
  });

  it('validates sky config', () => {
    const base = testLevel();
    expect(validateLevel({ ...base, sky: { budget: 2 } })).toEqual([]);
    expect(validateLevel({ ...base, sky: { budget: -1 } })).not.toEqual([]);
    expect(validateLevel({ ...base, sky: { budget: 1, chance: 2 } })).not.toEqual([]);
    expect(validateLevel({ ...base, sky: { budget: 1, pool: { meteor: 1 } as never } })).not.toEqual([]);
  });

  it('every shipped level has a director plan config', () => {
    expect(LEVELS.every((l) => l.sky && l.sky.budget >= 1)).toBe(true);
    for (const l of LEVELS) expect(validateLevel(l)).toEqual([]);
  });
});
