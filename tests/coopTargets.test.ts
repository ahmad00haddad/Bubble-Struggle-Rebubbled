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
const windowTicks = (sec: number) => Math.ceil(sec * TICK_RATE) + 3;

const pair = (): BubbleSpawn[] => [
  { size: 1, x: 300, y: 200, velocityX: 0, special: 'link', group: 1 },
  { size: 1, x: 600, y: 200, velocityX: 0, special: 'link', group: 1 },
];
const linked = (s: GameSimulation) => s.bubbles.filter((b) => b.sp === 'link');
const armed = (s: GameSimulation) => linked(s).find((b) => (b.sa ?? 0) > 0);

describe('Link with 1 player (solo fallback)', () => {
  it('both orbs are ordinary, popping one starts nothing', () => {
    const s = mk(1, pair());
    expect(linked(s)).toHaveLength(0);
    shootAt(s, 0, s.bubbles[0].id);
    const ev = run(s, 2);
    expect(sp(ev, 'linkStart')).toHaveLength(0);
    expect(s.coopStats.byKind.link.spawned).toBe(0);
  });
});

describe.each([2, 3, 4])('Link with %i players', (n) => {
  it('is counted as one target and the two orbs reference each other', () => {
    const s = mk(n, pair());
    const [a, b] = linked(s);
    expect(a.lk).toBe(b.id);
    expect(b.lk).toBe(a.id);
    expect(s.coopStats.byKind.link.spawned).toBe(1);
  });

  it('popping one starts a window on the other', () => {
    const s = mk(n, pair());
    const first = linked(s)[0];
    shootAt(s, 0, first.id);
    const ev = run(s, 2);
    expect(sp(ev, 'linkStart')).toHaveLength(1);
    const partner = armed(s)!;
    expect(partner).toBeDefined();
    expect(partner.id).not.toBe(first.id);
    expect(partner.hm).toBe(1);
  });

  it('the Lancer who popped the first orb cannot finish the partner (denied)', () => {
    const s = mk(n, pair());
    shootAt(s, 0, linked(s)[0].id);
    run(s, 14);
    const partner = armed(s)!;
    shootAt(s, 0, partner.id);
    const ev = run(s, 2);
    expect(sp(ev, 'deny')).toHaveLength(1);
    expect(sp(ev, 'linkDone')).toHaveLength(0);
    expect(s.bubbles.some((b) => b.id === partner.id)).toBe(true);
    expect(s.coopStats.repeatHits).toBe(1);
  });

  it('a different Lancer finishes it in time', () => {
    const s = mk(n, pair());
    shootAt(s, 0, linked(s)[0].id);
    run(s, 14);
    const partner = armed(s)!;
    shootAt(s, 1, partner.id);
    const ev = run(s, 2);
    expect(sp(ev, 'linkDone')).toHaveLength(1);
    expect(s.bubbles.some((b) => b.id === partner.id)).toBe(false);
    expect(s.coopStats.byKind.link).toMatchObject({ spawned: 1, completed: 1, failed: 0 });
  });

  it('if the window runs out the partner is enraged and the link ends', () => {
    const s = mk(n, pair());
    shootAt(s, 0, linked(s)[0].id);
    const ev = run(s, windowTicks(SPECIAL.link.window));
    expect(sp(ev, 'linkFail')).toHaveLength(1);
    expect(linked(s)).toHaveLength(0);
    const rageOrbs = s.bubbles.filter((b) => b.rage);
    expect(rageOrbs).toHaveLength(1);
    expect(rageOrbs[0].size).toBe(1);
    expect(s.coopStats.byKind.link.failed).toBe(1);
  });
});

describe('Link when the team shrinks', () => {
  it('with one Lancer left the same Lancer may finish the partner', () => {
    const s = mk(2, pair());
    shootAt(s, 0, linked(s)[0].id);
    run(s, 14);
    s.players[1].life = 'out';
    shootAt(s, 0, armed(s)!.id);
    const ev = run(s, 2);
    expect(sp(ev, 'linkDone')).toHaveLength(1);
  });
});

describe('Priority', () => {
  const prio = (): BubbleSpawn[] => [{ size: 2, x: 300, y: 200, velocityX: 0, special: 'priority' }];

  it('solo gets an ordinary orb', () => {
    const s = mk(1, prio());
    expect(s.bubbles[0].sp).toBeUndefined();
    expect(s.coopStats.byKind.priority.spawned).toBe(0);
  });

  it.each([2, 3, 4])('with %i players it starts a countdown from level load', (n) => {
    const s = mk(n, prio());
    expect(s.bubbles[0].sp).toBe('priority');
    expect(s.bubbles[0].sa).toBe(SPECIAL.priority.window);
    run(s, 30);
    expect(s.bubbles[0].sa).toBeLessThan(SPECIAL.priority.window - 0.9);
    expect(s.coopStats.byKind.priority.spawned).toBe(1);
  });

  it('popping it in time (by anyone) adds time and reports it', () => {
    const s = mk(2, prio());
    run(s, 30);
    const before = s.timeLeftTicks;
    shootAt(s, 1, s.bubbles[0].id);
    const ev = run(s, 2);
    expect(sp(ev, 'priorityDone')).toHaveLength(1);
    expect(s.timeLeftTicks - before).toBeGreaterThanOrEqual(SPECIAL.priority.rewardSeconds * TICK_RATE - 3);
    expect(s.coopStats.byKind.priority.completed).toBe(1);
    expect(s.bubbles.every((b) => !b.sp)).toBe(true); // children are ordinary
  });

  it('letting it run out regrows it one size, enraged, and ends the priority', () => {
    const s = mk(2, prio());
    const ev = run(s, windowTicks(SPECIAL.priority.window));
    expect(sp(ev, 'priorityFail')).toHaveLength(1);
    expect(s.bubbles[0]).toMatchObject({ size: 3, rage: true });
    expect(s.bubbles[0].sp).toBeUndefined();
    expect(s.coopStats.byKind.priority.failed).toBe(1);
  });

  it('popping it late gives no reward', () => {
    const s = mk(2, prio());
    run(s, windowTicks(SPECIAL.priority.window));
    const before = s.timeLeftTicks;
    shootAt(s, 0, s.bubbles[0].id);
    const ev = run(s, 2);
    expect(sp(ev, 'priorityDone')).toHaveLength(0);
    expect(s.timeLeftTicks).toBeLessThanOrEqual(before);
  });
});

describe('Cooperative targets: determinism, snapshots, validation', () => {
  it('same seed and inputs give identical results with all three kinds in play', () => {
    const run1 = (seed: number) => {
      const s = mk(3, [...pair(), { size: 2, x: 450, y: 120, special: 'coop' }, { size: 2, x: 200, y: 100, special: 'priority' }], {}, seed);
      const events: SimEvent[] = [];
      for (let t = 0; t < 300; t++) {
        if (t % 13 === 0 && s.bubbles.length) shootAt(s, t % 3, s.bubbles[t % s.bubbles.length].id);
        s.step();
        events.push(...s.drainEvents());
      }
      return JSON.stringify({ b: s.bubbles, st: s.coopStats, t: s.timeLeftTicks, events });
    };
    expect(run1(7)).toBe(run1(7));
  });

  it('per-kind totals add up to the overall totals', () => {
    const s = mk(2, [...pair(), { size: 2, x: 450, y: 120, special: 'coop' }, { size: 2, x: 200, y: 100, special: 'priority' }]);
    shootAt(s, 0, linked(s)[0].id);
    run(s, windowTicks(SPECIAL.link.window));
    const k = s.coopStats.byKind;
    expect(s.coopStats.spawned).toBe(k.coop.spawned + k.link.spawned + k.priority.spawned);
    expect(s.coopStats.spawned).toBe(3);
    expect(s.coopStats.failed).toBe(k.coop.failed + k.link.failed + k.priority.failed);
  });

  it('snapshots carry link and priority state', () => {
    const m = new Match({ levels: [testLevel({ bubbles: [...pair(), { size: 2, x: 450, y: 120, velocityX: 0, special: 'priority' }] })], activeSlots: [true, true], seed: 3 });
    for (let i = 0; i < 100; i++) m.advance();
    shootAt(m.sim, 1, m.sim.bubbles.find((b) => b.sp === 'link')!.id);
    m.advance();
    m.advance();
    const snap = decodeSnapshot(JSON.parse(JSON.stringify(encodeSnapshot(m, m.drainEvents()))));
    expect(snap.bubbles.some((b) => b.sp === 'priority' && (b.sa ?? 0) > 0)).toBe(true);
    const partner = snap.bubbles.find((b) => b.sp === 'link');
    expect(partner).toMatchObject({ hm: 2 });
    expect(partner!.sa).toBeGreaterThan(0);
    expect(snap.events.some((e) => e.k === 'sp' && e.t === 'linkStart')).toBe(true);
  });

  it('validation: link needs a group of exactly two', () => {
    const ok = testLevel({ bubbles: pair() });
    expect(validateLevel(ok)).toEqual([]);
    const lone = testLevel({ bubbles: [pair()[0]] });
    expect(validateLevel(lone).length).toBeGreaterThan(0);
    const noGroup = testLevel({ bubbles: [{ size: 1, x: 300, y: 200, special: 'link' }] });
    expect(validateLevel(noGroup).length).toBeGreaterThan(0);
  });

  it('a twin pair and a link pair sharing a group number do not get mixed up', () => {
    const s = mk(2, [
      { size: 1, x: 150, y: 200, velocityX: 0, special: 'twin', group: 1 },
      { size: 1, x: 300, y: 200, velocityX: 0, special: 'link', group: 1 },
      { size: 1, x: 600, y: 200, velocityX: 0, special: 'twin', group: 1 },
      { size: 1, x: 750, y: 200, velocityX: 0, special: 'link', group: 1 },
    ]);
    const [t1, l1, t2, l2] = s.bubbles;
    expect([t1.lk, t2.lk]).toEqual([t2.id, t1.id]);
    expect([l1.lk, l2.lk]).toEqual([l2.id, l1.id]);
  });
});
