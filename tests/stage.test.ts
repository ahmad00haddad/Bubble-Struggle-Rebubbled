import { describe, expect, it } from 'vitest';
import {
  GameSimulation,
  ICE,
  INPUT,
  LEVELS,
  Match,
  RELIC_KINDS,
  Rng,
  STAGE,
  TICK_RATE,
  decodeSnapshot,
  encodeSnapshot,
  moveFxFromPlayers,
  planStage,
  validateLevel,
  wallBounds,
  type BubbleSpawn,
  type LevelConfig,
  type RelicKind,
  type SimEvent,
} from '@orb/shared';
import { testLevel } from './helpers';

const seats = (n: number) => Array.from({ length: 4 }, (_, i) => i < n);
const orbs = (n: number): BubbleSpawn[] => Array.from({ length: n }, (_, i) => ({ size: 3 as const, x: 120 + i * 90, y: 60, velocityX: 0 }));
const mk = (n: number, extra: Partial<LevelConfig> = {}, bubbles: BubbleSpawn[] = orbs(5), seed = 1) =>
  new GameSimulation({ levels: [testLevel({ bubbles, timeLimit: 300, noPromote: true, ...extra })], activeSlots: seats(n), seed });
function run(s: GameSimulation, ticks: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    s.step();
    out.push(...s.drainEvents());
  }
  return out;
}
const stageEv = (ev: SimEvent[], t: string) => ev.filter((e) => e.k === 'stage' && e.t === t);
const have = (s: GameSimulation, slot: number, k: RelicKind) => {
  s.players[slot].rel |= 1 << RELIC_KINDS.indexOf(k);
};
/** Keep the fight quiet: orbs high and still, Lancers protected. */
const calm = (s: GameSimulation) => {
  for (const p of s.players) p.invuln = 999;
};

describe('planStage', () => {
  const level = testLevel({ stage: { wall: 2, mirror: 1 }, timeLimit: 100 });
  it('is deterministic, inside the window, spaced out, and empty without a stage config', () => {
    const a = planStage(level, 100, new Rng(5));
    expect(a).toEqual(planStage(level, 100, new Rng(5)));
    expect(a).toHaveLength(3);
    for (let i = 0; i < a.length; i++) {
      expect(a[i].at).toBeGreaterThanOrEqual(STAGE.firstAfter);
      if (i > 0) expect(a[i].at - a[i - 1].at).toBeGreaterThanOrEqual(STAGE.minGap - 1e-9);
    }
    expect(planStage(testLevel(), 100, new Rng(5))).toEqual([]);
  });
});

describe('ice', () => {
  const iceLevel = { ice: [{ x: 0, w: 960 }] };
  const slide = (s: GameSimulation) => {
    s.setInput(0, INPUT.RIGHT, 1);
    run(s, 30);
    s.setInput(0, 0, 2);
    const x = s.players[0].x;
    run(s, 15);
    return s.players[0].x - x;
  };

  it('you keep sliding after you let go; off ice you stop at once', () => {
    const on = mk(2, iceLevel);
    calm(on);
    on.players[0].x = 100;
    expect(slide(on)).toBeGreaterThan(25);
    const off = mk(2);
    calm(off);
    off.players[0].x = 100;
    expect(slide(off)).toBe(0);
  });

  it('Light Feet slides far less', () => {
    const plain = mk(2, iceLevel);
    calm(plain);
    plain.players[0].x = 100;
    const d1 = slide(plain);
    const light = mk(2, iceLevel);
    calm(light);
    have(light, 0, 'lightfeet');
    light.players[0].x = 100;
    const d2 = slide(light);
    expect(d2).toBeLessThan(d1 * 0.5);
  });

  it('speeds up and slows down gradually, and stops at the wall of the arena', () => {
    const s = mk(2, iceLevel);
    calm(s);
    s.players[0].x = 100;
    s.setInput(0, INPUT.RIGHT, 1);
    run(s, 2);
    const early = s.players[0].x - 100;
    run(s, 40);
    expect(s.players[0].x - 100).toBeGreaterThan(early * 4);
    s.setInput(0, INPUT.LEFT, 2);
    run(s, 300);
    expect(s.players[0].x).toBeGreaterThanOrEqual(17);
  });

  it('is limited to its patch', () => {
    const s = mk(2, { ice: [{ x: 0, w: 200 }] });
    calm(s);
    s.players[0].x = 100;
    s.setInput(0, INPUT.RIGHT, 1);
    run(s, 60);
    s.setInput(0, 0, 2);
    const x = s.players[0].x;
    run(s, 15);
    expect(s.players[0].x).toBe(x); // already off the patch: no slide
  });

  it('is deterministic', () => {
    const go = () => {
      const s = mk(2, iceLevel);
      calm(s);
      s.setInput(0, INPUT.RIGHT, 1);
      run(s, 20);
      s.setInput(0, INPUT.LEFT, 2);
      run(s, 20);
      return s.players[0].x;
    };
    expect(go()).toBe(go());
  });
});

describe('Split Wall', () => {
  /** Plan the wall for right now so a test does not wait. */
  const ready = (s: GameSimulation) => {
    (s as unknown as { stagePlan: { kind: string; at: number }[] }).stagePlan = [{ kind: 'wall', at: 0 }];
  };

  it('never rises in solo, with too few orbs, or with the Lancers together', () => {
    const solo = mk(1, { stage: { wall: 1 } });
    calm(solo);
    ready(solo);
    expect(stageEv(run(solo, 60), 'wallWarn')).toHaveLength(0);

    const few = mk(2, { stage: { wall: 1 } }, orbs(2));
    calm(few);
    few.players[0].x = 200;
    few.players[1].x = 760;
    ready(few);
    expect(stageEv(run(few, 60), 'wallWarn')).toHaveLength(0);

    const together = mk(2, { stage: { wall: 1 } });
    calm(together);
    together.players[0].x = 400;
    together.players[1].x = 450;
    ready(together);
    expect(stageEv(run(together, 60), 'wallWarn')).toHaveLength(0);
  });

  it('warns, rises between the Lancers, blocks crossing, then drops', () => {
    const s = mk(2, { stage: { wall: 1 } });
    calm(s);
    s.players[0].x = 200;
    s.players[1].x = 760;
    ready(s);
    const ev = run(s, 2);
    expect(stageEv(ev, 'wallWarn')).toHaveLength(1);
    const x = s.stage!.x;
    expect(x).toBeGreaterThan(200);
    expect(x).toBeLessThan(760);
    expect(s.stage!.phase).toBe('warn');
    run(s, Math.ceil(STAGE.warn * TICK_RATE));
    expect(s.stage!.phase).toBe('active');
    s.setInput(0, INPUT.RIGHT, 1);
    s.setInput(1, INPUT.LEFT, 1);
    run(s, 8 * TICK_RATE / 2);
    expect(s.players[0].x).toBeLessThan(x);
    expect(s.players[1].x).toBeGreaterThan(x);
    const after = run(s, Math.ceil(STAGE.wall.seconds * TICK_RATE));
    expect(stageEv(after, 'wallEnd')).toHaveLength(1);
    expect(s.stage).toBeNull();
    run(s, 40);
    expect(s.players[0].x).toBeGreaterThan(x); // free to cross again
  });

  it('pushes a Lancer standing in the wall out to their side', () => {
    const s = mk(2, { stage: { wall: 1 } });
    calm(s);
    s.players[0].x = 200;
    s.players[1].x = 760;
    ready(s);
    run(s, 2);
    const x = s.stage!.x;
    s.players[0].x = x - 3;
    run(s, Math.ceil(STAGE.warn * TICK_RATE));
    expect(s.players[0].x).toBeLessThan(x - STAGE.wall.thickness / 2);
  });

  it('wall bounds are shared with client prediction', () => {
    const left = wallBounds(480, 300);
    const right = wallBounds(480, 600);
    expect(left.hi!).toBeLessThan(480);
    expect(right.lo!).toBeGreaterThan(480);
    const m = new Match({ levels: [testLevel({ bubbles: orbs(5), timeLimit: 300, stage: { wall: 1 } })], activeSlots: [true, true], seed: 2 });
    for (let i = 0; i < 100; i++) m.advance();
    const sim = m.sim;
    for (const p of sim.players) p.invuln = 999;
    sim.players[0].x = 200;
    sim.players[1].x = 760;
    (sim as unknown as { stagePlan: { kind: string; at: number }[] }).stagePlan = [{ kind: 'wall', at: 0 }];
    for (let i = 0; i < 60; i++) m.advance();
    const snap = decodeSnapshot(JSON.parse(JSON.stringify(encodeSnapshot(m, []))));
    expect(snap.stage).toMatchObject({ kind: 'wall', phase: 'active' });
    const fx = moveFxFromPlayers(snap.players, 0, snap.stage);
    expect(fx.hi!).toBeLessThan(snap.stage!.x);
    expect(moveFxFromPlayers(snap.players, 1, snap.stage).lo!).toBeGreaterThan(snap.stage!.x);
  });
});

describe('Mirror', () => {
  const start = (s: GameSimulation) => {
    (s as unknown as { stagePlan: { kind: string; at: number }[] }).stagePlan = [{ kind: 'mirror', at: 0 }];
  };

  it('reverses everyone for a few seconds, then ends', () => {
    const s = mk(2, { stage: { mirror: 1 } });
    calm(s);
    start(s);
    const ev = run(s, Math.ceil((STAGE.warn + 0.2) * TICK_RATE));
    expect(stageEv(ev, 'mirrorWarn')).toHaveLength(1);
    expect(stageEv(ev, 'mirrorStart')).toHaveLength(1);
    expect(s.players.filter((p) => p.active).every((p) => p.fx > 0)).toBe(true);
    const x = s.players[0].x;
    s.setInput(0, INPUT.RIGHT, 1);
    run(s, 10);
    expect(s.players[0].x).toBeLessThan(x); // right goes left
    run(s, Math.ceil(STAGE.mirror.seconds * TICK_RATE) + 5);
    expect(s.players.every((p) => p.fx === 0)).toBe(true);
  });

  it('Steady Hand halves how long it lasts', () => {
    const s = mk(2, { stage: { mirror: 1 } });
    calm(s);
    have(s, 0, 'steadyhand');
    start(s);
    run(s, Math.ceil((STAGE.warn + 0.2) * TICK_RATE));
    expect(s.players[0].fxT).toBeLessThan(STAGE.mirror.seconds * 0.6);
    expect(s.players[1].fxT).toBeGreaterThan(STAGE.mirror.seconds * 0.8);
  });
});

describe('stage data', () => {
  it('shipped levels stay valid, and the teaching arc introduces the events one by one', () => {
    for (const l of LEVELS) expect(validateLevel(l)).toEqual([]);
    expect(LEVELS[0].stage).toBeUndefined();
    expect(LEVELS[0].ice).toBeUndefined();
    expect(LEVELS[1].stage?.wall).toBe(1); // Twin Tides: the first wall
    expect(LEVELS[2].ice?.length).toBeGreaterThan(0); // Ledge Garden: the first ice
    expect(LEVELS[3].stage?.mirror).toBe(1); // Quickstep: the first mirror
  });

  it('validation rejects bad ice and stage numbers', () => {
    expect(validateLevel(testLevel({ ice: [{ x: 900, w: 100 }] })).length).toBeGreaterThan(0);
    expect(validateLevel(testLevel({ stage: { wall: 9 } })).length).toBeGreaterThan(0);
    expect(validateLevel(testLevel({ ice: [{ x: 100, w: 100 }], stage: { wall: 1, mirror: 1 } }))).toEqual([]);
  });

  it('ICE constants make a Light Feet Lancer easier to control than a normal one', () => {
    expect(ICE.lightFeet.accel).toBeGreaterThan(ICE.accel);
    expect(ICE.lightFeet.friction).toBeGreaterThan(ICE.friction);
  });
});
