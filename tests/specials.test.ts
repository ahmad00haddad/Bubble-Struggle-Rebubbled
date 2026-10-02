import { describe, expect, it } from 'vitest';
import {
  BUBBLE_SIZES,
  GameSimulation,
  INPUT,
  LEVELS,
  Match,
  SPECIAL,
  SPECIAL_KINDS,
  TICK_DT,
  TICK_RATE,
  decodeSnapshot,
  encodeSnapshot,
  ghostStage,
  isIntangible,
  validateLevel,
  type BubbleSpawn,
  type LevelConfig,
  type SimEvent,
} from '@orb/shared';
import { DEMO_LEVELS } from './balance/demoLevels';
import { runLevel } from './balance/harness';
import { testLevel } from './helpers';

const seats = (n: number) => Array.from({ length: 4 }, (_, i) => i < n);
const mk = (n: number, bubbles: BubbleSpawn[], extra: Partial<LevelConfig> = {}, seed = 1) =>
  new GameSimulation({ levels: [testLevel({ bubbles, ...extra })], activeSlots: seats(n), seed });

const still = (b: Partial<BubbleSpawn> & Pick<BubbleSpawn, 'size' | 'x' | 'y'>): BubbleSpawn => ({ velocityX: 0, ...b });

/** Put a harpoon just under an orb so it connects on the next tick. */
function shootAt(s: GameSimulation, owner: number, id: number): void {
  const b = s.bubbles.find((x) => x.id === id)!;
  s.harpoons.push({ id: 9000 + s.harpoons.length, owner, x: b.x, tipY: Math.min(b.y + BUBBLE_SIZES[b.size].radius + 8, 436) });
}

function run(s: GameSimulation, ticks: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    s.step();
    out.push(...s.drainEvents());
  }
  return out;
}

const sp = (ev: SimEvent[], t: string) => ev.filter((e) => e.k === 'sp' && e.t === t);

describe.each([1, 2, 3, 4])('Hardshell with %i player(s)', (n) => {
  const make = () => mk(n, [still({ size: 2, x: 300, y: 200, special: 'hardshell' })]);

  it('first hit enrages instead of splitting', () => {
    const s = make();
    const b = s.bubbles[0];
    const vx = b.vx;
    shootAt(s, 0, b.id);
    const ev = run(s, 2);
    expect(s.bubbles).toHaveLength(1);
    expect(s.bubbles[0].id).toBe(b.id);
    expect(s.bubbles[0].rage).toBe(true);
    expect(Math.abs(s.bubbles[0].vx)).toBeCloseTo(Math.abs(vx || 1) * (vx ? SPECIAL.hardshell.rageMul : 0), 5);
    expect(ev.some((e) => e.k === 'pop')).toBe(false);
    expect(sp(ev, 'enrage')).toHaveLength(1);
    expect(s.harpoons).toHaveLength(0);
    expect(s.players[0].score).toBe(0);
  });

  it('second hit splits into ordinary children and scores', () => {
    const s = make();
    shootAt(s, 0, s.bubbles[0].id);
    run(s, 2);
    shootAt(s, n > 1 ? 1 : 0, s.bubbles[0].id);
    const ev = run(s, 2);
    expect(ev.filter((e) => e.k === 'pop')).toHaveLength(1);
    expect(s.bubbles).toHaveLength(2);
    for (const c of s.bubbles) {
      expect(c.size).toBe(1);
      expect(c.sp).toBeUndefined();
      expect(c.rage).toBeUndefined();
    }
    expect(s.players[n > 1 ? 1 : 0].score).toBe(BUBBLE_SIZES[2].points);
  });

  it('two harpoons landing in the same tick pop it (any shooters count)', () => {
    const s = make();
    const id = s.bubbles[0].id;
    shootAt(s, 0, id);
    shootAt(s, n > 1 ? 1 : 0, id);
    const ev = run(s, 2);
    expect(sp(ev, 'enrage')).toHaveLength(1);
    expect(ev.filter((e) => e.k === 'pop')).toHaveLength(1);
    expect(s.bubbles.every((b) => b.size === 1)).toBe(true);
  });
});

describe('Hardshell physics and state', () => {
  it('enraged orb keeps the same bounce height (same arc shape, just faster)', () => {
    const apex = (rage: boolean) => {
      const s = mk(1, [still({ size: 2, x: 300, y: 200, special: 'hardshell' })]);
      const b = s.bubbles[0];
      if (rage) {
        shootAt(s, 0, b.id);
        run(s, 2);
      }
      let minY = Infinity;
      let bounced = false;
      let last = b.y;
      for (let i = 0; i < 200; i++) {
        s.step();
        s.drainEvents();
        if (s.bubbles[0].y < last && s.bubbles[0].y > 200) bounced = true;
        if (bounced) minY = Math.min(minY, s.bubbles[0].y);
        last = s.bubbles[0].y;
      }
      return minY;
    };
    expect(Math.abs(apex(true) - apex(false))).toBeLessThan(12);
  });

  it('survives the snapshot codec', () => {
    const m = new Match({ levels: [testLevel({ bubbles: [still({ size: 2, x: 300, y: 200, special: 'hardshell' })] })], activeSlots: [true, true], seed: 3 });
    for (let i = 0; i < 100; i++) m.advance();
    shootAt(m.sim, 0, m.sim.bubbles[0].id);
    m.advance();
    m.advance();
    expect(m.sim.bubbles[0].rage).toBe(true);
    const snap = decodeSnapshot(JSON.parse(JSON.stringify(encodeSnapshot(m, m.drainEvents()))));
    expect(snap.bubbles[0]).toMatchObject({ sp: 'hardshell', rage: true });
  });
});

describe.each([1, 2, 3, 4])('Ghost with %i player(s)', (n) => {
  const solid = () => mk(n, [still({ size: 2, x: 300, y: 200, special: 'ghost', phase: 0 })]);
  const ghostly = () => mk(n, [still({ size: 2, x: 300, y: 200, special: 'ghost', phase: SPECIAL.ghost.solid + SPECIAL.ghost.warn + 0.1 })]);

  it('cycles solid, warn, intangible, solid on schedule', () => {
    const s = solid();
    const { solid: a, warn: w, ghostly: g } = SPECIAL.ghost;
    const ev: { tick: number; t: string }[] = [];
    for (let i = 1; i <= Math.ceil((a + w + g + 0.5) * TICK_RATE); i++) {
      s.step();
      for (const e of s.drainEvents()) if (e.k === 'sp') ev.push({ tick: i, t: e.t });
    }
    expect(ev.map((e) => e.t)).toEqual(['warn', 'fade', 'solid']);
    expect(ev[0].tick).toBeCloseTo(a * TICK_RATE, -0.5);
    expect(ev[1].tick).toBeCloseTo((a + w) * TICK_RATE, -0.5);
    expect(ev[2].tick).toBeCloseTo((a + w + g) * TICK_RATE, -0.5);
  });

  it('a solid ghost pops normally', () => {
    const s = solid();
    shootAt(s, 0, s.bubbles[0].id);
    const ev = run(s, 2);
    expect(ev.filter((e) => e.k === 'pop')).toHaveLength(1);
    expect(s.bubbles.every((b) => b.sp === undefined)).toBe(true);
  });

  it('still pops during the warning blink', () => {
    const s = mk(n, [still({ size: 2, x: 300, y: 200, special: 'ghost', phase: SPECIAL.ghost.solid + 0.1 })]);
    expect(ghostStage(s.bubbles[0].sa!)).toBe('warn');
    expect(isIntangible(s.bubbles[0])).toBe(false);
    shootAt(s, 0, s.bubbles[0].id);
    expect(run(s, 2).filter((e) => e.k === 'pop')).toHaveLength(1);
  });

  it('harpoons pass through an intangible ghost and report one miss', () => {
    const s = ghostly();
    expect(isIntangible(s.bubbles[0])).toBe(true);
    shootAt(s, 0, s.bubbles[0].id);
    const ev = run(s, 3);
    expect(ev.filter((e) => e.k === 'pop')).toHaveLength(0);
    expect(sp(ev, 'miss')).toHaveLength(1);
    expect(s.bubbles).toHaveLength(1);
    expect(s.harpoons).toHaveLength(1); // still flying
  });

  it('an intangible ghost cannot hurt a Lancer; a solid one can', () => {
    const near = (phase: number) => {
      const s = mk(n, [still({ size: 0, x: 200, y: 440, special: 'ghost', phase })], { playerSpawnPoints: [200, 760] });
      run(s, 4);
      return s.players[0].life;
    };
    expect(near(SPECIAL.ghost.solid + SPECIAL.ghost.warn + 0.4)).toBe('alive');
    expect(near(0)).not.toBe('alive');
  });
});

describe('Ghost randomness', () => {
  const rnd = (seed: number) => mk(2, [{ size: 2, x: 300, y: 200, special: 'ghost' }, { size: 2, x: 600, y: 200, special: 'ghost' }], {}, seed);

  it('draws its phase from the special RNG, deterministically', () => {
    const a = rnd(11);
    const b = rnd(11);
    const c = rnd(12);
    expect(a.bubbles.map((x) => x.sa)).toEqual(b.bubbles.map((x) => x.sa));
    expect(a.bubbles.map((x) => x.sa)).not.toEqual(c.bubbles.map((x) => x.sa));
  });

  it('never touches the drop/bomb RNG stream', () => {
    const plain = mk(2, [{ size: 2, x: 300, y: 200 }], {}, 11);
    const withGhost = rnd(11);
    expect(withGhost.rng.next()).toBe(plain.rng.next());
  });

  it('a retried level replays identical special state', () => {
    const s = rnd(5);
    const first = s.bubbles.map((x) => x.sa);
    run(s, 50);
    s.loadLevel(0);
    expect(s.bubbles.map((x) => x.sa)).toEqual(first);
  });
});

describe.each([1, 2, 3, 4])('Twin Fuse with %i player(s)', (n) => {
  const make = (extra: Partial<LevelConfig> = {}) =>
    mk(n, [still({ size: 1, x: 250, y: 200, special: 'twin', group: 1 }), still({ size: 1, x: 700, y: 200, special: 'twin', group: 1 })], extra);
  const window = n === 1 ? SPECIAL.twin.fuseSecondsSolo : SPECIAL.twin.fuseSeconds;

  it('links the pair', () => {
    const s = make();
    const [a, b] = s.bubbles;
    expect(a.lk).toBe(b.id);
    expect(b.lk).toBe(a.id);
  });

  it('popping one starts a fuse on the other (solo window is longer)', () => {
    const s = make();
    const [a, b] = s.bubbles;
    shootAt(s, 0, a.id);
    const ev = run(s, 2);
    expect(sp(ev, 'fuseStart')).toHaveLength(1);
    const partner = s.bubbles.find((x) => x.id === b.id)!;
    expect(partner.sa!).toBeGreaterThan(window - 2 * TICK_DT - 1e-9);
    expect(partner.sa!).toBeLessThanOrEqual(window);
  });

  it('popping the partner in time saves the pair, no regrowth', () => {
    const s = make();
    const [a, b] = s.bubbles;
    shootAt(s, 0, a.id);
    run(s, 2);
    // 150 ms of "latency" before the second shot lands.
    run(s, 5);
    shootAt(s, n > 1 ? 1 : 0, b.id);
    const ev = run(s, 2);
    expect(sp(ev, 'fuseSave')).toHaveLength(1);
    expect(sp(ev, 'fuseFail')).toHaveLength(0);
    expect(s.bubbles.every((x) => x.size === 0 && x.sp === undefined)).toBe(true);
  });

  it('both twins hit in the same tick count as saved', () => {
    const s = make();
    const [a, b] = s.bubbles;
    shootAt(s, 0, a.id);
    shootAt(s, n > 1 ? 1 : 0, b.id);
    const ev = run(s, 2);
    expect(sp(ev, 'fuseStart')).toHaveLength(1);
    expect(sp(ev, 'fuseSave')).toHaveLength(1);
    expect(s.bubbles.every((x) => x.size === 0)).toBe(true);
  });

  it('an expired fuse regrows the partner one size and unlinks it', () => {
    const s = make();
    const [a, b] = s.bubbles;
    shootAt(s, 0, a.id);
    run(s, 2);
    const ev = run(s, Math.ceil(window * TICK_RATE));
    expect(sp(ev, 'fuseFail')).toHaveLength(1);
    const partner = s.bubbles.find((x) => x.id === b.id)!;
    expect(partner.size).toBe(2);
    expect(partner.sp).toBeUndefined();
    expect(partner.lk).toBeUndefined();
    expect(partner.sa).toBeUndefined();
  });

  it('the fuse does not expire early', () => {
    const s = make();
    shootAt(s, 0, s.bubbles[0].id);
    run(s, 2);
    const ev = run(s, Math.floor((window - 0.5) * TICK_RATE));
    expect(sp(ev, 'fuseFail')).toHaveLength(0);
  });
});

describe('Twin Fuse edge cases', () => {
  it('a huge twin cannot regrow past huge', () => {
    const s = mk(2, [still({ size: 3, x: 250, y: 200, special: 'twin', group: 1 }), still({ size: 0, x: 700, y: 300, special: 'twin', group: 1 })]);
    const [a, b] = s.bubbles;
    shootAt(s, 0, b.id);
    run(s, 2);
    run(s, SPECIAL.twin.fuseSeconds * TICK_RATE + 5);
    expect(s.bubbles.find((x) => x.id === a.id)!.size).toBe(3);
  });

  it('a reloaded level starts with fresh, idle twins', () => {
    const s = mk(2, [still({ size: 1, x: 250, y: 200, special: 'twin', group: 1 }), still({ size: 1, x: 700, y: 200, special: 'twin', group: 1 })]);
    shootAt(s, 0, s.bubbles[0].id);
    run(s, 2);
    s.loadLevel(0);
    expect(s.bubbles.map((b) => b.sa)).toEqual([0, 0]);
    expect(s.bubbles[0].lk).toBe(s.bubbles[1].id);
  });
});

describe('ordinary orbs and determinism', () => {
  it('ordinary orbs never carry special fields', () => {
    const s = mk(2, [{ size: 3, x: 300, y: 150 }, { size: 2, x: 700, y: 150, velocityX: -108 }]);
    for (let i = 0; i < 400; i++) {
      s.setInput(i % 2, INPUT.SHOOT * ((i >> 3) & 1), i + 1);
      s.step();
      s.drainEvents();
      for (const b of s.bubbles) expect(Object.keys(b).some((k) => ['sp', 'sa', 'lk', 'rage'].includes(k))).toBe(false);
    }
  });

  it('shipped levels introduce one new mechanic at a time through levels 2-10', () => {
    const kinds = (i: number) => [...new Set(LEVELS[i].bubbles.flatMap((b) => (b.special ? [b.special] : [])))];
    expect(kinds(0)).toEqual([]);
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => kinds(i))).toEqual([['hardshell'], ['ghost'], ['twin'], ['sync'], ['pincer'], ['hardshell'], ['sequence'], ['heavy'], ['quad']]);
    expect(LEVELS[6].powerUps.placed.some((p) => p.type === 'anchor')).toBe(true);
    expect(LEVELS[9].noAnchor).toBe(true);
  });

  it('same seed and inputs give identical worlds with every special active', () => {
    const level: LevelConfig = testLevel({
      bubbles: [
        { size: 3, x: 150, y: 100, special: 'hardshell' },
        { size: 2, x: 400, y: 120, special: 'ghost' },
        { size: 2, x: 600, y: 120, special: 'twin', group: 4 },
        { size: 2, x: 800, y: 120, special: 'twin', group: 4 },
      ],
    });
    const play = () => {
      const s = new GameSimulation({ levels: [level], activeSlots: seats(3), seed: 99 });
      const log: unknown[] = [];
      for (let i = 0; i < 600; i++) {
        s.setInput(i % 3, ((i >> 4) & 1 ? INPUT.LEFT : INPUT.RIGHT) | (i % 7 === 0 ? INPUT.SHOOT : 0), i + 1);
        s.step();
        log.push(s.drainEvents());
      }
      return JSON.stringify([s.bubbles, log, s.players.map((p) => p.score)]);
    };
    expect(play()).toBe(play());
  });

  it('every special clears at every player count (bots), solo included', () => {
    for (const lvl of DEMO_LEVELS) {
      for (const n of [1, 2, 3, 4]) {
        let cleared = 0;
        for (let seed = 1; seed <= 4; seed++) if (runLevel(lvl, n, seed * 101).outcome === 'cleared') cleared++;
        expect(cleared, `${lvl.id} N=${n}`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe('codec and level data', () => {
  it('ordinary rows stay 7 numbers; special rows add kind, aux, link, mask, place', () => {
    const m = new Match({
      levels: [testLevel({ bubbles: [{ size: 2, x: 300, y: 200 }, { size: 1, x: 500, y: 200, special: 'twin', group: 1 }, { size: 1, x: 600, y: 200, special: 'twin', group: 1 }] })],
      activeSlots: [true, true],
      seed: 1,
    });
    const msg = encodeSnapshot(m, []);
    expect(msg.b[0]).toHaveLength(7);
    expect(msg.b[1]).toHaveLength(12);
    const snap = decodeSnapshot(JSON.parse(JSON.stringify(msg)));
    expect(snap.bubbles[0].sp).toBeUndefined();
    expect(snap.bubbles[1]).toMatchObject({ sp: 'twin', sa: 0, lk: m.sim.bubbles[2].id });
  });

  it('special level data survives JSON (the server sends it in the level message)', () => {
    const lvl = JSON.parse(JSON.stringify(DEMO_LEVELS[3]));
    expect(validateLevel(lvl)).toEqual([]);
  });

  it('validator rejects broken special data', () => {
    const base = testLevel({ bubbles: [{ size: 2, x: 300, y: 200 }] });
    const bad = (b: BubbleSpawn[]) => validateLevel({ ...base, bubbles: b });
    expect(bad([{ size: 2, x: 300, y: 200, special: 'nope' as never }]).length).toBeGreaterThan(0);
    expect(bad([{ size: 2, x: 300, y: 200, special: 'twin' }]).length).toBeGreaterThan(0);
    expect(bad([{ size: 2, x: 300, y: 200, special: 'twin', group: 1 }]).length).toBeGreaterThan(0);
    expect(bad([{ size: 2, x: 300, y: 200, group: 1 }]).length).toBeGreaterThan(0);
    expect(bad([{ size: 2, x: 300, y: 200, special: 'hardshell', phase: 1 }]).length).toBeGreaterThan(0);
    expect(SPECIAL_KINDS.slice(0, 3)).toEqual(['hardshell', 'ghost', 'twin']);
  });
});
