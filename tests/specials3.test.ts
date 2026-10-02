import { describe, expect, it } from 'vitest';
import {
  BUBBLE_SIZES,
  GameSimulation,
  Match,
  SPECIAL,
  TICK_RATE,
  decodeSnapshot,
  encodeSnapshot,
  validateLevel,
  type BubbleSpawn,
  type LevelConfig,
  type SimEvent,
} from '@orb/shared';
import { testLevel } from './helpers';

const seats = (n: number) => Array.from({ length: 4 }, (_, i) => i < n);
const mk = (n: number, bubbles: BubbleSpawn[], extra: Partial<LevelConfig> = {}, seed = 1) =>
  new GameSimulation({ levels: [testLevel({ bubbles, ...extra })], activeSlots: seats(n), seed });
const still = (b: Partial<BubbleSpawn> & Pick<BubbleSpawn, 'size' | 'x' | 'y'>): BubbleSpawn => ({ velocityX: 0, ...b });

/** Put a harpoon under an orb (optionally `dx` px off its centre line) so it connects next tick. */
function shootAt(s: GameSimulation, owner: number, id: number, dx = 0): void {
  const b = s.bubbles.find((x) => x.id === id)!;
  s.harpoons.push({ id: 9000 + s.harpoons.length + s.tick * 10, owner, x: b.x + dx, tipY: Math.min(b.y + BUBBLE_SIZES[b.size].radius + 8, 436) });
}

function run(s: GameSimulation, ticks: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    s.step();
    out.push(...s.drainEvents());
  }
  return out;
}

const sp = (ev: SimEvent[], t: string) => ev.filter((e) => e.k === 'sp' && e.t === t).length;
const pops = (ev: SimEvent[]) => ev.filter((e) => e.k === 'pop').length;
const second = (n: number) => (n > 1 ? 1 : 0);

describe.each([1, 2, 3, 4])('Sync with %i player(s)', (n) => {
  const make = () => mk(n, [still({ size: 2, x: 300, y: 200, special: 'sync' })]);
  const window = n === 1 ? SPECIAL.sync.windowSolo : SPECIAL.sync.window;

  it('first hit arms the orb instead of splitting it', () => {
    const s = make();
    shootAt(s, 0, s.bubbles[0].id);
    const ev = run(s, 2);
    expect(sp(ev, 'syncArm')).toBe(1);
    expect(pops(ev)).toBe(0);
    expect(s.bubbles).toHaveLength(1);
    expect(s.bubbles[0].sa!).toBeGreaterThan(window - 0.2);
    expect(s.harpoons).toHaveLength(0);
  });

  it(n === 1 ? 'solo: the same player may land both hits' : 'a different player inside the window splits it', () => {
    const s = make();
    shootAt(s, 0, s.bubbles[0].id);
    run(s, 2);
    shootAt(s, second(n), s.bubbles[0].id);
    const ev = run(s, 2);
    expect(sp(ev, 'syncDone')).toBe(1);
    expect(pops(ev)).toBe(1);
    expect(s.bubbles.every((b) => b.size === 1 && b.sp === undefined)).toBe(true);
    expect(s.players[second(n)].score).toBe(BUBBLE_SIZES[2].points);
  });

  it('lands with 150 ms of latency between the two shots', () => {
    const s = make();
    shootAt(s, 0, s.bubbles[0].id);
    run(s, 2);
    run(s, 5);
    shootAt(s, second(n), s.bubbles[0].id);
    expect(pops(run(s, 2))).toBe(1);
  });

  it('two harpoons from different shooters in the same tick split it at once', () => {
    const s = make();
    const id = s.bubbles[0].id;
    shootAt(s, 0, id);
    shootAt(s, second(n), id);
    const ev = run(s, 2);
    expect(sp(ev, 'syncDone')).toBe(1);
    expect(pops(ev)).toBe(1);
  });

  it('the window expires: hits are forgotten and the orb needs two fresh hits', () => {
    const s = make();
    shootAt(s, 0, s.bubbles[0].id);
    run(s, 2);
    const ev = run(s, Math.ceil(window * TICK_RATE) + 2);
    expect(sp(ev, 'syncFail')).toBe(1);
    expect(s.bubbles[0].sa).toBe(0);
    shootAt(s, second(n), s.bubbles[0].id);
    const ev2 = run(s, 2);
    expect(pops(ev2)).toBe(0);
    expect(sp(ev2, 'syncArm')).toBe(1);
  });

  it('does not expire early', () => {
    const s = make();
    shootAt(s, 0, s.bubbles[0].id);
    run(s, 2);
    expect(sp(run(s, Math.floor((window - 0.4) * TICK_RATE)), 'syncFail')).toBe(0);
  });
});

describe('Sync multiplayer rules', () => {
  it('the same shooter twice is wasted, not a pop (2+ players)', () => {
    const s = mk(2, [still({ size: 2, x: 300, y: 200, special: 'sync' })]);
    shootAt(s, 0, s.bubbles[0].id);
    run(s, 2);
    shootAt(s, 0, s.bubbles[0].id);
    const ev = run(s, 2);
    expect(sp(ev, 'deny')).toBe(1);
    expect(pops(ev)).toBe(0);
    expect(s.harpoons).toHaveLength(0);
  });

  it('if every partner is knocked out, the last Lancer can finish it alone', () => {
    const s = mk(3, [still({ size: 2, x: 300, y: 200, special: 'sync' })]);
    s.players[1].life = 'out';
    s.players[2].life = 'out';
    shootAt(s, 0, s.bubbles[0].id);
    run(s, 2);
    shootAt(s, 0, s.bubbles[0].id);
    expect(pops(run(s, 2))).toBe(1);
  });
});

describe.each([1, 2, 3, 4])('Pincer with %i player(s)', (n) => {
  const make = () => mk(n, [still({ size: 2, x: 400, y: 200, special: 'pincer' })]);
  const window = n === 1 ? SPECIAL.pincer.windowSolo : SPECIAL.pincer.window;
  const edge = 14;

  it('opposite sides split it, whoever shoots', () => {
    const s = make();
    shootAt(s, 0, s.bubbles[0].id, -edge);
    const arm = run(s, 2);
    expect(sp(arm, 'pincerArm')).toBe(1);
    expect(s.bubbles).toHaveLength(1);
    run(s, 5); // 150 ms
    shootAt(s, second(n), s.bubbles[0].id, edge);
    const ev = run(s, 2);
    expect(sp(ev, 'pincerDone')).toBe(1);
    expect(pops(ev)).toBe(1);
    expect(s.bubbles.every((b) => b.sp === undefined)).toBe(true);
  });

  it('the same side twice makes no progress', () => {
    const s = make();
    shootAt(s, 0, s.bubbles[0].id, edge);
    run(s, 2);
    shootAt(s, second(n), s.bubbles[0].id, edge);
    const ev = run(s, 2);
    expect(sp(ev, 'deny')).toBe(1);
    expect(pops(ev)).toBe(0);
  });

  it('the window expires', () => {
    const s = make();
    shootAt(s, 0, s.bubbles[0].id, -edge);
    run(s, 2);
    const ev = run(s, Math.ceil(window * TICK_RATE) + 2);
    expect(sp(ev, 'pincerFail')).toBe(1);
    shootAt(s, 0, s.bubbles[0].id, edge);
    expect(pops(run(s, 2))).toBe(0);
  });

  it('opposite hits still pair up when they land in the same tick', () => {
    const s = make();
    shootAt(s, 0, s.bubbles[0].id, -edge);
    shootAt(s, second(n), s.bubbles[0].id, edge);
    expect(pops(run(s, 2))).toBe(1);
  });
});

describe('Pincer solo simplification', () => {
  it('multiplayer ignores a centre-line hit; solo accepts a small off-centre hit', () => {
    const mp = mk(2, [still({ size: 2, x: 400, y: 200, special: 'pincer' })]);
    shootAt(mp, 0, mp.bubbles[0].id, 2);
    expect(sp(run(mp, 2), 'deny')).toBe(1);
    const solo = mk(1, [still({ size: 2, x: 400, y: 200, special: 'pincer' })]);
    shootAt(solo, 0, solo.bubbles[0].id, 2);
    expect(sp(run(solo, 2), 'pincerArm')).toBe(1);
  });
});

describe.each([1, 2, 3, 4])('Heavy with %i player(s)', (n) => {
  const make = () => mk(n, [still({ size: 2, x: 300, y: 200, special: 'heavy' })]);

  if (n === 1) {
    it('solo: the level load turns it into an ordinary orb', () => {
      const s = make();
      expect(s.bubbles[0].sp).toBeUndefined();
      shootAt(s, 0, s.bubbles[0].id);
      expect(pops(run(s, 2))).toBe(1);
    });
    return;
  }

  const need = Math.max(2, Math.ceil(n / 2));
  it(`needs ${need} different shooters`, () => {
    const s = make();
    expect(s.bubbles[0].sp).toBe('heavy');
    const id = s.bubbles[0].id;
    for (let k = 0; k < need - 1; k++) {
      shootAt(s, k, id);
      expect(pops(run(s, 2))).toBe(0);
    }
    shootAt(s, need - 1, id);
    const ev = run(s, 2);
    expect(sp(ev, 'heavyDone')).toBe(1);
    expect(pops(ev)).toBe(1);
  });

  it('the same shooter again adds nothing', () => {
    const s = make();
    const id = s.bubbles[0].id;
    shootAt(s, 0, id);
    run(s, 2);
    shootAt(s, 0, id);
    const ev = run(s, 2);
    expect(sp(ev, 'deny')).toBe(1);
    expect(pops(ev)).toBe(0);
  });

  it('the window expires and the hits are forgotten', () => {
    const s = make();
    shootAt(s, 0, s.bubbles[0].id);
    run(s, 2);
    const ev = run(s, Math.ceil(SPECIAL.heavy.window * TICK_RATE) + 2);
    expect(sp(ev, 'heavyFail')).toBe(1);
    expect(s.bubbles[0].hm).toBe(0);
  });

  it('shrinks to whoever is left if partners are knocked out', () => {
    const s = make();
    for (let k = 1; k < n; k++) s.players[k].life = 'out';
    shootAt(s, 0, s.bubbles[0].id);
    expect(pops(run(s, 2))).toBe(1);
  });
});

describe('Heavy is multiplayer only', () => {
  it('a partner leaving mid-level does not turn a live heavy orb solo, but the next level load does', () => {
    const s = mk(2, [still({ size: 2, x: 300, y: 200, special: 'heavy' })]);
    s.setActive(1, false);
    expect(s.bubbles[0].sp).toBe('heavy');
    shootAt(s, 0, s.bubbles[0].id);
    expect(pops(run(s, 2))).toBe(1); // only one Lancer left: requirement shrinks, never a softlock
    s.loadLevel(0);
    expect(s.bubbles[0].sp).toBeUndefined();
  });
});

describe.each([1, 2, 3, 4])('Sequence with %i player(s)', (n) => {
  const set = (): BubbleSpawn[] => [
    still({ size: 0, x: 200, y: 250, special: 'sequence', group: 1, order: 1 }),
    still({ size: 0, x: 480, y: 250, special: 'sequence', group: 1, order: 2 }),
    still({ size: 0, x: 760, y: 250, special: 'sequence', group: 1, order: 3 }),
  ];
  const make = () => mk(n, set());
  const idOf = (s: GameSimulation, order: number) => s.bubbles.find((b) => b.n === order)!.id;

  it('correct order lights each orb and pops the whole set on the last', () => {
    const s = make();
    const ids = [1, 2, 3].map((o) => idOf(s, o));
    shootAt(s, 0, ids[0]);
    expect(sp(run(s, 2), 'seqStep')).toBe(1);
    expect(s.bubbles).toHaveLength(3);
    shootAt(s, second(n), ids[1]);
    run(s, 2);
    expect(s.bubbles).toHaveLength(3);
    shootAt(s, n > 2 ? 2 : 0, ids[2]);
    const ev = run(s, 2);
    expect(sp(ev, 'seqDone')).toBe(1);
    expect(pops(ev)).toBe(3);
    expect(s.bubbles).toHaveLength(0);
    const owner = n > 2 ? 2 : 0;
    const popEvents = ev.filter((e) => e.k === 'pop');
    expect(popEvents.every((e) => e.k === 'pop' && e.by === owner)).toBe(true);
    expect(popEvents.reduce((sum, e) => sum + (e.k === 'pop' ? e.pts : 0), 0)).toBe(3 * BUBBLE_SIZES[0].points);
  });

  it('a wrong hit resets progress', () => {
    const s = make();
    const ids = [1, 2, 3].map((o) => idOf(s, o));
    shootAt(s, 0, ids[0]);
    run(s, 2);
    expect(s.bubbles.find((b) => b.id === ids[0])!.sa).toBe(1);
    shootAt(s, 0, ids[2]); // skips number 2
    const ev = run(s, 2);
    expect(sp(ev, 'seqReset')).toBe(1);
    expect(s.bubbles.every((b) => b.sa === 0)).toBe(true);
    expect(s.bubbles).toHaveLength(3);
  });

  it('harpoons fly through a lit orb instead of being wasted', () => {
    const s = make();
    const first = idOf(s, 1);
    shootAt(s, 0, first);
    run(s, 2);
    shootAt(s, 0, first);
    const ev = run(s, 3);
    expect(sp(ev, 'seqReset') + sp(ev, 'deny') + pops(ev)).toBe(0);
    expect(s.harpoons).toHaveLength(1);
  });

  it('a lit orb still hurts a Lancer', () => {
    const s = mk(n, [still({ size: 0, x: 200, y: 440, special: 'sequence', group: 1, order: 1 }), still({ size: 0, x: 600, y: 250, special: 'sequence', group: 1, order: 2 })], { playerSpawnPoints: [200, 760] });
    s.bubbles[0].sa = 1;
    run(s, 4);
    expect(s.players[0].life).not.toBe('alive');
  });
});

describe('Sequence with larger members', () => {
  it('medium members split into ordinary children when the set completes', () => {
    const s = mk(2, [
      still({ size: 1, x: 200, y: 250, special: 'sequence', group: 1, order: 1 }),
      still({ size: 1, x: 700, y: 250, special: 'sequence', group: 1, order: 2 }),
    ]);
    shootAt(s, 0, s.bubbles.find((b) => b.n === 1)!.id);
    run(s, 2);
    shootAt(s, 1, s.bubbles.find((b) => b.n === 2)!.id);
    run(s, 2);
    expect(s.bubbles).toHaveLength(4);
    expect(s.bubbles.every((b) => b.size === 0 && b.sp === undefined && b.n === undefined)).toBe(true);
  });
});

describe('codec, determinism and level data', () => {
  it('an armed sync orb survives the snapshot codec', () => {
    const m = new Match({ levels: [testLevel({ bubbles: [still({ size: 2, x: 300, y: 200, special: 'sync' })] })], activeSlots: [true, true], seed: 3 });
    for (let i = 0; i < 100; i++) m.advance();
    shootAt(m.sim, 1, m.sim.bubbles[0].id);
    m.advance();
    m.advance();
    const snap = decodeSnapshot(JSON.parse(JSON.stringify(encodeSnapshot(m, m.drainEvents()))));
    expect(snap.bubbles[0]).toMatchObject({ sp: 'sync', hm: 2 });
    expect(snap.bubbles[0].sa!).toBeGreaterThan(0);
  });

  it('a sequence set survives the snapshot codec', () => {
    const s = mk(2, [
      still({ size: 0, x: 200, y: 250, special: 'sequence', group: 4, order: 1 }),
      still({ size: 0, x: 600, y: 250, special: 'sequence', group: 4, order: 2 }),
    ]);
    const m = new Match({ levels: s.levels, activeSlots: [true, true], seed: 1 });
    const snap = decodeSnapshot(JSON.parse(JSON.stringify(encodeSnapshot(m, []))));
    expect(snap.bubbles.map((b) => [b.sp, b.lk, b.n])).toEqual([
      ['sequence', 4, 1],
      ['sequence', 4, 2],
    ]);
  });

  it('is deterministic with every Phase 3 special active', () => {
    const level = testLevel({
      bubbles: [
        { size: 2, x: 200, y: 100, special: 'sync' },
        { size: 2, x: 400, y: 100, special: 'pincer' },
        { size: 2, x: 600, y: 100, special: 'heavy' },
        { size: 0, x: 150, y: 250, special: 'sequence', group: 1, order: 1 },
        { size: 0, x: 800, y: 250, special: 'sequence', group: 1, order: 2 },
      ],
    });
    const play = () => {
      const s = new GameSimulation({ levels: [level], activeSlots: seats(4), seed: 7 });
      const log: unknown[] = [];
      for (let i = 0; i < 500; i++) {
        s.setInput(i % 4, (i >> 3) % 2 ? 1 : 2 | (i % 5 === 0 ? 4 : 0), i + 1);
        s.step();
        log.push(s.drainEvents());
      }
      return JSON.stringify([s.bubbles, log]);
    };
    expect(play()).toBe(play());
  });

  it('validator checks sequence data', () => {
    const base = testLevel({ bubbles: [{ size: 2, x: 300, y: 200 }] });
    const bad = (b: BubbleSpawn[]) => validateLevel({ ...base, bubbles: b }).length;
    const seq = (order: number | undefined, group: number | null = 1, size: 0 | 1 | 2 = 0, x = 300): BubbleSpawn => ({ size, x, y: 250, special: 'sequence', ...(group === null ? {} : { group }), order });
    expect(bad([seq(1, 1, 0, 200), seq(2, 1, 0, 400)])).toBe(0);
    expect(bad([seq(1)])).toBeGreaterThan(0); // one member
    expect(bad([seq(1, 1, 0, 200), seq(3, 1, 0, 400)])).toBeGreaterThan(0); // gap
    expect(bad([seq(1, 1, 0, 200), seq(1, 1, 0, 400)])).toBeGreaterThan(0); // repeat
    expect(bad([seq(undefined, 1, 0, 200), seq(2, 1, 0, 400)])).toBeGreaterThan(0); // no order
    expect(bad([seq(1, null, 0, 200), seq(2, 1, 0, 400)])).toBeGreaterThan(0); // no group
    expect(bad([seq(1, 1, 2, 200), seq(2, 1, 0, 400)])).toBeGreaterThan(0); // too big
    expect(bad([{ size: 2, x: 300, y: 200, special: 'sync', order: 1 }])).toBeGreaterThan(0);
  });
});
