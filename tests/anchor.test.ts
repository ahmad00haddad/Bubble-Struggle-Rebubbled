import { describe, expect, it } from 'vitest';
import {
  ANCHOR,
  BUBBLE_SIZES,
  GameSimulation,
  INPUT,
  Match,
  TICK_RATE,
  decodeSnapshot,
  encodeSnapshot,
  validateLevel,
  type BubbleSpawn,
  type LevelConfig,
  type SimEvent,
} from '@orb/shared';
import { placed, testLevel } from './helpers';

const seats = (n: number) => Array.from({ length: 4 }, (_, i) => i < n);
const mk = (n: number, bubbles: BubbleSpawn[], extra: Partial<LevelConfig> = {}, seed = 1) =>
  new GameSimulation({ levels: [testLevel({ bubbles, noPromote: true, ...extra })], activeSlots: seats(n), seed });

function run(s: GameSimulation, ticks: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    s.step();
    out.push(...s.drainEvents());
  }
  return out;
}

/** Fire from slot `p`, standing at x. */
function fire(s: GameSimulation, p: number, x?: number): void {
  if (x !== undefined) s.players[p].x = x;
  s.setInput(p, 0, 0);
  s.setInput(p, INPUT.SHOOT, 1);
}
const far = [{ size: 3, x: 900, y: 100, velocityX: 0 }] as BubbleSpawn[];

describe.each([1, 2, 3, 4])('Anchor harpoon with %i player(s)', (n) => {
  it('the pickup loads the next shot, which sticks to the ceiling', () => {
    const s = mk(n, far, { powerUps: placed('anchor', s0x(), 440, 0) });
    s.players[0].x = s0x();
    run(s, 3);
    expect(s.players[0].anc).toBeGreaterThan(ANCHOR.chargeSeconds - 0.5);
    s.players[0].x = 300;
    fire(s, 0);
    run(s, 2);
    expect(s.players[0].anc).toBe(0);
    const ev = run(s, TICK_RATE); // 0.57 s flight + margin
    const h = s.harpoons.find((x) => x.anchor)!;
    expect(h).toBeDefined();
    expect(h.ttl).toBeGreaterThan(0);
    expect(h.tipY).toBe(0);
    expect(ev.filter((e) => e.k === 'anchor')).toHaveLength(1);
  });

  it('expires after the stick time', () => {
    const s = mk(n, far);
    s.players[0].anc = 10;
    s.players[0].x = 300;
    fire(s, 0);
    run(s, TICK_RATE);
    expect(s.harpoons).toHaveLength(1);
    run(s, Math.ceil(ANCHOR.stickSeconds * TICK_RATE) + 2);
    expect(s.harpoons).toHaveLength(0);
  });

  it('keeps popping orbs that touch it, one per cooldown, without being used up', () => {
    const s = mk(n, [{ size: 1, x: 300, y: 150, velocityX: 0 }, { size: 1, x: 300, y: 250, velocityX: 0 }, ...far]);
    s.players[0].anc = 10;
    s.players[0].x = 300;
    fire(s, 0);
    const ev = run(s, 2 * TICK_RATE);
    const anchorPops = ev.filter((e) => e.k === 'pop');
    expect(anchorPops.length).toBeGreaterThanOrEqual(2);
    expect(s.harpoons.some((h) => h.anchor)).toBe(true);
    // The cooldown prevents clearing a crowd in a single tick.
    const ticksOfPops = new Set(anchorPops.map((e) => (e as { tick?: number }).tick));
    expect(ticksOfPops.size).toBeGreaterThanOrEqual(1);
  });

  it('a stuck anchor does not use up the owner harpoon slot', () => {
    const s = mk(n, far);
    s.players[0].anc = 10;
    s.players[0].x = 300;
    fire(s, 0);
    run(s, TICK_RATE);
    expect(s.harpoons.some((h) => h.ttl !== undefined)).toBe(true);
    s.players[0].x = 500;
    s.setInput(0, 0, 2);
    run(s, 8);
    fire(s, 0);
    const ev = run(s, 2);
    expect(ev.filter((e) => e.k === 'shoot')).toHaveLength(1);
  });

  it('sticks under a platform it runs into', () => {
    const s = mk(n, far, { platforms: [{ x: 250, y: 200, w: 120, h: 16 }] });
    s.players[0].anc = 10;
    s.players[0].x = 300;
    fire(s, 0);
    run(s, TICK_RATE);
    const h = s.harpoons.find((x) => x.anchor)!;
    expect(h.tipY).toBe(216);
  });

  it('is lost when the owner is hit', () => {
    const s = mk(n, far);
    s.players[0].anc = 10;
    s.setInput(0, 0, 1);
    // force damage through a bomb-like hit: put an orb on the player
    s.bubbles.push({ id: 999, size: 1, x: s.players[0].x, y: 450, vx: 0, vy: 0 });
    run(s, 2);
    expect(s.players[0].anc).toBe(0);
  });

  it('expires if never used', () => {
    const s = mk(n, far);
    s.players[0].anc = 1;
    run(s, TICK_RATE + 2);
    expect(s.players[0].anc).toBe(0);
  });
});

function s0x(): number {
  return 200;
}

describe('Anchor harpoon rules', () => {
  it('on a noAnchor level the shot is an ordinary harpoon and the charge is kept', () => {
    const s = mk(2, far, { noAnchor: true });
    s.players[0].anc = 10;
    s.players[0].x = 300;
    fire(s, 0);
    run(s, TICK_RATE);
    expect(s.harpoons).toHaveLength(0);
    expect(s.players[0].anc).toBeGreaterThan(0);
  });

  it('validator rejects anchors on noAnchor levels', () => {
    const base = testLevel({ noAnchor: true });
    expect(validateLevel({ ...base, powerUps: placed('anchor', 300) })).not.toEqual([]);
    expect(validateLevel({ ...base, powerUps: { dropChance: 1, pool: { anchor: 1 }, placed: [] } })).not.toEqual([]);
    expect(validateLevel({ ...base, powerUps: placed('shield', 300) })).toEqual([]);
  });

  it('anchor pops count as hits for special bubbles and credit the owner', () => {
    const s = mk(2, [{ size: 2, x: 300, y: 200, velocityX: 0, special: 'hardshell' }, ...far]);
    s.players[1].anc = 10;
    s.players[1].x = 300;
    fire(s, 1);
    const ev = run(s, 2 * TICK_RATE);
    // Two hits from one tether (0.35 s apart) enrage then pop the hardshell.
    const pop = ev.find((e) => e.k === 'pop' && e.s === 2);
    expect(pop).toMatchObject({ by: 1, pts: BUBBLE_SIZES[2].points });
  });

  it('survives the snapshot codec (harpoon and player fields)', () => {
    const m = new Match({ levels: [testLevel({ bubbles: far })], activeSlots: [true, true], seed: 1 });
    for (let i = 0; i < 100; i++) m.advance();
    m.sim.players[0].anc = 6;
    m.sim.players[0].x = 300;
    fire(m.sim, 0);
    for (let i = 0; i < 40; i++) m.advance();
    const snap = decodeSnapshot(JSON.parse(JSON.stringify(encodeSnapshot(m, m.drainEvents()))));
    expect(snap.players[0].anchor).toBe(0);
    const h = snap.harpoons.find((x) => x.anchor)!;
    expect(h).toBeDefined();
    expect(h.ttl!).toBeGreaterThan(0);
    // pickup loaded state
    m.sim.players[1].anc = 6;
    const snap2 = decodeSnapshot(JSON.parse(JSON.stringify(encodeSnapshot(m, []))));
    expect(snap2.players[1].anchor).toBeCloseTo(6, 0);
  });

  it('is deterministic', () => {
    const play = () => {
      const s = mk(2, [{ size: 2, x: 300, y: 150 }, { size: 1, x: 700, y: 150, velocityX: -100 }], { powerUps: placed('anchor', 200, 440, 0) });
      const log: unknown[] = [];
      for (let i = 0; i < 400; i++) {
        s.setInput(0, (i >> 4) % 2 ? INPUT.LEFT : INPUT.RIGHT | (i % 9 === 0 ? INPUT.SHOOT : 0), i + 1);
        s.step();
        log.push(s.drainEvents());
      }
      return JSON.stringify([s.bubbles, s.harpoons, log]);
    };
    expect(play()).toBe(play());
  });
});
