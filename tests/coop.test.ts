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
const coopOrb = (need?: number): BubbleSpawn => ({ size: 2, x: 300, y: 200, velocityX: 0, special: 'coop', ...(need ? { need } : {}) });
const mk = (n: number, bubbles: BubbleSpawn[] = [coopOrb()], extra: Partial<LevelConfig> = {}, seed = 1) =>
  new GameSimulation({ levels: [testLevel({ bubbles, ...extra })], activeSlots: seats(n), seed });

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
const orb = (s: GameSimulation) => s.bubbles[0];

describe('Coop with 1 player (solo fallback)', () => {
  it('becomes an ordinary orb: no special state, one hit splits it, nothing counted', () => {
    const s = mk(1);
    expect(orb(s).sp).toBeUndefined();
    expect(orb(s).n).toBeUndefined();
    shootAt(s, 0, orb(s).id);
    run(s, 2);
    expect(s.bubbles).toHaveLength(2);
    expect(s.coopStats.spawned).toBe(0);
  });
});

describe.each([2, 3, 4])('Coop with %i players', (n) => {
  it('stays a coop orb needing min(need, players) different Lancers', () => {
    const s = mk(n, [coopOrb(4)]);
    expect(orb(s).sp).toBe('coop');
    expect(orb(s).n).toBe(Math.min(4, n));
    expect(s.coopStats.spawned).toBe(1);
  });

  it('a hit from one Lancer arms it and does not split', () => {
    const s = mk(n);
    const id = orb(s).id;
    shootAt(s, 0, id);
    const ev = run(s, 2);
    expect(s.bubbles).toHaveLength(1);
    expect(orb(s).sa).toBeGreaterThan(0);
    expect(orb(s).hm).toBe(1);
    expect(sp(ev, 'coopHit')).toHaveLength(1);
  });

  it('the same Lancer hitting again is denied and does not count', () => {
    const s = mk(n);
    const id = orb(s).id;
    shootAt(s, 0, id);
    run(s, 12); // clear the harpoon cooldown
    shootAt(s, 0, id);
    const ev = run(s, 2);
    expect(s.bubbles).toHaveLength(1);
    expect(sp(ev, 'deny')).toHaveLength(1);
    expect(sp(ev, 'coopDone')).toHaveLength(0);
    expect(s.coopStats.repeatHits).toBe(1);
    expect(s.coopStats.hits).toBe(1);
  });

  it('a different Lancer inside the window finishes a two-Lancer target', () => {
    const s = mk(n);
    const id = orb(s).id;
    shootAt(s, 0, id);
    run(s, 10);
    shootAt(s, 1, id);
    const ev = run(s, 2);
    expect(sp(ev, 'coopDone')).toHaveLength(1);
    expect(s.bubbles).toHaveLength(2); // split into two children
    expect(s.coopStats).toMatchObject({ spawned: 1, completed: 1, failed: 0, hits: 2, participants: 2 });
  });

  it('two harpoons from two Lancers on the same tick complete it', () => {
    const s = mk(n);
    const id = orb(s).id;
    shootAt(s, 0, id);
    shootAt(s, 1, id);
    const ev = run(s, 2);
    expect(sp(ev, 'coopDone')).toHaveLength(1);
    expect(s.bubbles).toHaveLength(2);
  });

  it('two harpoons from the SAME Lancer on one tick do not complete it', () => {
    const s = mk(n);
    const id = orb(s).id;
    shootAt(s, 0, id);
    shootAt(s, 0, id);
    const ev = run(s, 2);
    expect(sp(ev, 'coopDone')).toHaveLength(0);
    expect(s.bubbles).toHaveLength(1);
  });

  it('a late hit after the window has closed starts over instead of finishing', () => {
    const s = mk(n);
    const id = orb(s).id;
    shootAt(s, 0, id);
    const ev = run(s, Math.ceil(SPECIAL.coop.window * TICK_RATE) + 3);
    expect(sp(ev, 'coopFail')).toHaveLength(1);
    expect(orb(s).hm).toBe(0);
    shootAt(s, 1, id);
    const ev2 = run(s, 2);
    expect(sp(ev2, 'coopDone')).toHaveLength(0);
    expect(orb(s).hm).toBe(2); // Lancer 1 opened a fresh window
    expect(s.bubbles).toHaveLength(1);
  });
});

describe('Coop failure behaviour', () => {
  it("'rage' makes the orb faster when the window runs out, 'reset' does not", () => {
    const failure = SPECIAL.coop as { failure: 'rage' | 'reset' };
    const original = failure.failure;
    try {
      for (const mode of ['rage', 'reset'] as const) {
        failure.failure = mode;
        const s = mk(2);
        shootAt(s, 0, orb(s).id);
        run(s, Math.ceil(SPECIAL.coop.window * TICK_RATE) + 3);
        expect(s.coopStats.failed).toBe(1);
        expect(orb(s).rage === true).toBe(mode === 'rage');
        expect(orb(s).sp).toBe('coop'); // still a coop target either way
      }
    } finally {
      failure.failure = original;
    }
  });

  it('counts time spent with a window open', () => {
    const s = mk(2);
    shootAt(s, 0, orb(s).id);
    run(s, 15);
    expect(s.coopStats.armedTicks).toBeGreaterThanOrEqual(12);
    expect(s.coopStats.armedTicks).toBeLessThanOrEqual(16);
  });
});

describe('Coop need of 3 or 4', () => {
  it('needs three different Lancers with three players', () => {
    const s = mk(3, [coopOrb(3)]);
    const id = orb(s).id;
    shootAt(s, 0, id);
    run(s, 8);
    shootAt(s, 1, id);
    run(s, 2);
    expect(s.bubbles).toHaveLength(1); // two of three: still armed
    shootAt(s, 2, id);
    const ev = run(s, 2);
    expect(sp(ev, 'coopDone')).toHaveLength(1);
    expect(s.coopStats.participants).toBe(3);
  });
});

describe('Coop when the team shrinks', () => {
  it('a knocked-out Lancer lowers the requirement to who is left', () => {
    const s = mk(3, [coopOrb(3)]);
    const id = orb(s).id;
    s.players[2].life = 'out';
    shootAt(s, 0, id);
    run(s, 8);
    shootAt(s, 1, id);
    const ev = run(s, 2);
    expect(sp(ev, 'coopDone')).toHaveLength(1);
  });

  it('with one Lancer left a single hit pops it (never unbeatable)', () => {
    const s = mk(2);
    s.players[1].life = 'out';
    shootAt(s, 0, orb(s).id);
    const ev = run(s, 2);
    expect(sp(ev, 'coopDone')).toHaveLength(1);
    expect(s.bubbles).toHaveLength(2);
  });

  it('a partner leaving the match mid-window lets the remaining Lancer finish', () => {
    const s = mk(2);
    shootAt(s, 0, orb(s).id);
    run(s, 8);
    s.setActive(1, false);
    run(s, 10);
    shootAt(s, 0, orb(s).id);
    const ev = run(s, 2);
    expect(sp(ev, 'coopDone')).toHaveLength(1);
  });

  it('a Lancer who dies (and will respawn) mid-window keeps their hit counted', () => {
    const s = mk(2);
    const id = orb(s).id;
    shootAt(s, 1, id);
    run(s, 4);
    s.players[1].life = 'dead';
    s.players[1].respawnTimer = 0.5;
    run(s, 6);
    shootAt(s, 0, id);
    const ev = run(s, 2);
    expect(sp(ev, 'coopDone')).toHaveLength(1);
  });
});

describe('Coop determinism and networking', () => {
  const script = (seed: number) => {
    const s = mk(3, [coopOrb(), { size: 2, x: 600, y: 150, special: 'coop', need: 3 }, { size: 1, x: 700, y: 150 }], {}, seed);
    const events: SimEvent[] = [];
    for (let t = 0; t < 240; t++) {
      if (t % 17 === 0 && s.bubbles.length) shootAt(s, t % 3, s.bubbles[t % s.bubbles.length].id);
      s.step();
      events.push(...s.drainEvents());
    }
    return JSON.stringify({ b: s.bubbles, p: s.players.map((p) => [p.score, p.lives]), st: s.coopStats, events });
  };

  it('same seed and inputs give identical results', () => {
    expect(script(5)).toBe(script(5));
  });

  it('coop does not consume the drop RNG stream', () => {
    const withCoop = mk(2, [coopOrb()], { powerUps: { dropChance: 1, pool: { shield: 1 }, placed: [] } }, 9);
    const plain = mk(2, [{ size: 2, x: 300, y: 200, velocityX: 0 }], { powerUps: { dropChance: 1, pool: { shield: 1 }, placed: [] } }, 9);
    expect(withCoop.rng.next()).toBe(plain.rng.next());
  });

  it('snapshot rows carry the kind, window, shooters mask and Lancers needed', () => {
    const m = new Match({ levels: [testLevel({ bubbles: [coopOrb(2)] })], activeSlots: [true, true], seed: 3 });
    for (let i = 0; i < 100; i++) m.advance();
    shootAt(m.sim, 1, m.sim.bubbles[0].id);
    m.advance();
    m.advance();
    const snap = decodeSnapshot(JSON.parse(JSON.stringify(encodeSnapshot(m, m.drainEvents()))));
    expect(snap.bubbles[0]).toMatchObject({ sp: 'coop', n: 2, hm: 2 });
    expect(snap.bubbles[0].sa).toBeGreaterThan(0);
    expect(snap.events.some((e) => e.k === 'sp' && e.t === 'coopHit')).toBe(true);
  });

  it('a level reload restarts the target but keeps the match counters', () => {
    const s = mk(2);
    shootAt(s, 0, orb(s).id);
    run(s, 2);
    s.loadLevel(0);
    expect(orb(s).hm).toBe(0);
    expect(orb(s).sa).toBe(0);
    expect(s.coopStats.hits).toBe(1);
    expect(s.coopStats.spawned).toBe(2);
  });
});

describe('Coop level validation', () => {
  const lvl = (b: BubbleSpawn) => testLevel({ bubbles: [b] });
  it('accepts coop with need 2..4 and rejects need elsewhere', () => {
    expect(validateLevel(lvl(coopOrb(3)))).toEqual([]);
    expect(validateLevel(lvl({ size: 2, x: 300, y: 200, special: 'coop', need: 5 })).length).toBeGreaterThan(0);
    expect(validateLevel(lvl({ size: 2, x: 300, y: 200, need: 2 })).length).toBeGreaterThan(0);
  });
});
