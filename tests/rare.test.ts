import { describe, expect, it } from 'vitest';
import {
  BUBBLE_SIZES,
  GameSimulation,
  HARPOON,
  INPUT,
  Match,
  POWERUP,
  POWERUP_TYPES,
  PLAYER,
  RARE,
  TICK_RATE,
  decodeSnapshot,
  encodeSnapshot,
  speedMulOf,
  type BubbleSpawn,
  type PowerUpType,
  type SimEvent,
} from '@orb/shared';
import { testLevel } from './helpers';

const seats = (n: number) => Array.from({ length: 4 }, (_, i) => i < n);
const far: BubbleSpawn[] = [{ size: 3, x: 900, y: 100, velocityX: 0 }];
const mk = (n: number, bubbles: BubbleSpawn[] = far, extra: Record<string, unknown> = {}, seed = 1) =>
  new GameSimulation({ levels: [testLevel({ bubbles, timeLimit: 300, noPromote: true, ...extra })], activeSlots: seats(n), seed });

function take(s: GameSimulation, user: number, type: PowerUpType): SimEvent[] {
  s.powerups.push({ id: 700 + s.tick, type, x: s.players[user].x, y: 470, life: 5, grounded: true });
  s.step();
  return s.drainEvents();
}
function run(s: GameSimulation, ticks: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    s.step();
    out.push(...s.drainEvents());
  }
  return out;
}
const gift = (ev: SimEvent[], t: string) => ev.filter((e) => e.k === 'gift' && e.t === t);
function shootAt(s: GameSimulation, owner: number, id: number, dx = 0): void {
  const b = s.bubbles.find((x) => x.id === id)!;
  s.harpoons.push({ id: 9000 + s.harpoons.length + s.tick * 10, owner, x: b.x + dx, tipY: Math.min(b.y + BUBBLE_SIZES[b.size].radius + 8, 436) });
}

describe('rare crates: setup', () => {
  it('every new crate type exists and is appended after the old ones (snapshot format)', () => {
    expect(POWERUP_TYPES.slice(0, 7)).toEqual(['shield', 'extraLife', 'extraTime', 'doubleHarpoon', 'speedBoost', 'anchor', 'chaos']);
    expect(POWERUP_TYPES).toHaveLength(22);
  });

  it('they join every level drop pool, including solo, but team crates need a team', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 400; seed++) {
      const s = new GameSimulation({
        levels: [testLevel({ bubbles: [{ size: 0, x: 200, y: 300, velocityX: 0 }], powerUps: { dropChance: 1, pool: { shield: 1 }, placed: [] } })],
        activeSlots: [true],
        seed,
      });
      s.harpoons.push({ id: 1, owner: 0, x: 200, tipY: 330 });
      s.step();
      for (const u of s.powerups) seen.add(u.type);
    }
    for (const t of ['wide', 'decoy', 'shrink', 'freeze', 'boomerang']) expect(seen.has(t)).toBe(true);
    for (const t of ['baton', 'flare', 'chaos']) expect(seen.has(t)).toBe(false);
  });

  it('they are rare next to the classic crates', () => {
    let rare = 0;
    let all = 0;
    for (let seed = 1; seed <= 600; seed++) {
      const s = new GameSimulation({
        levels: [testLevel({ bubbles: [{ size: 0, x: 200, y: 300, velocityX: 0 }], powerUps: { dropChance: 1, pool: { shield: 3, extraTime: 2, doubleHarpoon: 3, speedBoost: 3, extraLife: 1 }, placed: [] } })],
        activeSlots: [true],
        seed,
      });
      s.harpoons.push({ id: 1, owner: 0, x: 200, tipY: 330 });
      s.step();
      for (const u of s.powerups) {
        all++;
        if (!['shield', 'extraTime', 'doubleHarpoon', 'speedBoost', 'extraLife'].includes(u.type)) rare++;
      }
    }
    expect(rare / all).toBeGreaterThan(0.2);
    expect(rare / all).toBeLessThan(0.45);
  });

  it('the finale (noAnchor) never drops boomerang or piñata', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 300; seed++) {
      const s = new GameSimulation({
        levels: [testLevel({ noAnchor: true, bubbles: [{ size: 0, x: 200, y: 300, velocityX: 0 }], powerUps: { dropChance: 1, pool: {}, placed: [] } })],
        activeSlots: [true],
        seed,
      });
      s.harpoons.push({ id: 1, owner: 0, x: 200, tipY: 330 });
      s.step();
      for (const u of s.powerups) seen.add(u.type);
    }
    expect(seen.has('boomerang') || seen.has('pinata') || seen.has('anchor')).toBe(false);
  });
});

describe.each([1, 2, 4])('Shrink Time with %i player(s)', (n) => {
  it('cuts the clock and doubles your pops for a while', () => {
    const s = mk(n);
    const before = s.timeLeftTicks;
    expect(gift(take(s, 0, 'shrink'), 'shrink')).toHaveLength(1);
    expect(before - s.timeLeftTicks).toBeGreaterThanOrEqual(RARE.shrinkSeconds * TICK_RATE);
    expect(s.players[0].sx).toBeGreaterThan(RARE.seconds.sx - 0.2);
    const o = s.bubbles[0];
    s.bubbles.push({ id: 800, size: 0, x: 300, y: 300, vx: 0, vy: 0 });
    void o;
    shootAt(s, 0, 800);
    run(s, 2);
    expect(s.players[0].score).toBe(POWERUP.size * 0 + 50 + BUBBLE_SIZES[0].points * 2);
  });

  it('never leaves less than a few seconds', () => {
    const s = mk(n);
    s.timeLeftTicks = 10 * TICK_RATE;
    take(s, 0, 'shrink');
    expect(s.timeLeftTicks).toBeGreaterThanOrEqual(RARE.shrinkMinLeft * TICK_RATE - 2);
    s.timeLeftTicks = 3 * TICK_RATE;
    take(s, 0, 'shrink');
    expect(s.timeLeftTicks).toBeGreaterThanOrEqual(3 * TICK_RATE - 2);
  });
});

describe('Heavy Boots and Hot Potato', () => {
  it('Boots: 40% slower but shielded, then back to normal', () => {
    const s = mk(2);
    take(s, 0, 'boots');
    expect(s.players[0].boots).toBeGreaterThan(RARE.seconds.boots - 0.2);
    expect(s.players[0].shield).toBeGreaterThan(10);
    expect(speedMulOf(s.players[0])).toBeCloseTo(RARE.bootsMul, 5);
    s.players[0].x = 300;
    s.setInput(0, INPUT.RIGHT, 1);
    for (let i = 0; i < 10; i++) s.step();
    expect(s.players[0].x - 300).toBeCloseTo(PLAYER.speed * RARE.bootsMul * (10 / TICK_RATE), 0);
    run(s, Math.ceil(RARE.seconds.boots * TICK_RATE));
    expect(s.players[0].boots).toBe(0);
    expect(speedMulOf(s.players[0])).toBe(1);
  });

  it('Potato: faster, but no shooting until it wears off', () => {
    const s = mk(2);
    take(s, 0, 'potato');
    expect(speedMulOf(s.players[0])).toBeCloseTo(POWERUP.speedMultiplier, 5);
    s.players[0].x = 300;
    s.setInput(0, INPUT.SHOOT, 1);
    expect(run(s, 3).some((e) => e.k === 'shoot')).toBe(false);
    run(s, Math.ceil(RARE.seconds.potato * TICK_RATE));
    s.setInput(0, 0, 2);
    s.setInput(0, INPUT.SHOOT, 3);
    expect(run(s, 2).some((e) => e.k === 'shoot')).toBe(true);
  });

  it('both and speed boost stack as a product', () => {
    expect(speedMulOf({ speed: 1, potato: 1, boots: 1 })).toBeCloseTo(POWERUP.speedMultiplier * RARE.bootsMul, 5);
    expect(speedMulOf({ speed: 0, potato: 0, boots: 0 })).toBe(1);
  });
});

describe('Wide Tether', () => {
  it('shots are three times wider for 8 s and hit orbs beside the line', () => {
    const s = mk(2, [{ size: 1, x: 300, y: 250, velocityX: 0 }, ...far]);
    take(s, 0, 'wide');
    s.players[0].x = 300 + 14; // 14 px off: a normal tether would miss a medium orb at x=300 only by its radius edge
    s.players[0].x = 300 + BUBBLE_SIZES[1].radius + 6;
    s.setInput(0, INPUT.SHOOT, 1);
    s.step();
    const h = s.harpoons.find((x) => x.owner === 0)!;
    expect(h.wide).toBe(true);
    const ev = run(s, TICK_RATE);
    expect(ev.filter((e) => e.k === 'pop').length).toBeGreaterThan(0);
  });

  it('a normal shot from the same spot misses', () => {
    const s = mk(2, [{ size: 1, x: 300, y: 250, velocityX: 0 }, ...far]);
    s.players[0].x = 300 + BUBBLE_SIZES[1].radius + 6;
    s.setInput(0, INPUT.SHOOT, 1);
    expect(run(s, TICK_RATE).filter((e) => e.k === 'pop')).toHaveLength(0);
  });

  it('expires', () => {
    const s = mk(2);
    take(s, 0, 'wide');
    run(s, Math.ceil(RARE.seconds.wide * TICK_RATE) + 2);
    expect(s.players[0].wide).toBe(0);
  });

  it('width constant is what the physics uses', () => {
    expect(HARPOON.width * RARE.wideMul).toBe(18);
  });
});

describe('Piñata Crate', () => {
  it('breaks the nearest plain small or medium orb into pickups instead of children', () => {
    const s = mk(2, [{ size: 1, x: 300, y: 200, velocityX: 0 }, ...far]);
    const before = s.powerups.length;
    const ev = take(s, 0, 'pinata');
    expect(gift(ev, 'pinata')).toHaveLength(1);
    expect(s.bubbles.every((b) => b.size !== 1)).toBe(true);
    expect(s.bubbles).toHaveLength(1); // only the far huge orb remains: no children
    const dropped = s.powerups.filter((u) => u.type !== 'pinata');
    expect(dropped.length).toBeGreaterThanOrEqual(2);
    expect(dropped.length).toBeLessThanOrEqual(RARE.pinataMax + before);
    expect(dropped.every((u) => !['decoy', 'chaos', 'pinata'].includes(u.type))).toBe(true);
    expect(ev.some((e) => e.k === 'pop')).toBe(true);
  });

  it('never breaks big orbs or special orbs; with nothing eligible it gives one pickup', () => {
    const s = mk(1, [{ size: 2, x: 300, y: 200, velocityX: 0 }, { size: 1, x: 600, y: 200, velocityX: 0, special: 'hardshell' }]);
    const orbs = s.bubbles.length;
    take(s, 0, 'pinata');
    expect(s.bubbles).toHaveLength(orbs);
    expect(s.powerups.filter((u) => u.type !== 'pinata').length).toBe(1);
  });
});

describe('Gamble Chest', () => {
  it('gives a life most of the time, otherwise a nearby orb grows one size', () => {
    let lives = 0;
    let curses = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const s = mk(1, [{ size: 1, x: 300, y: 200, velocityX: 0 }], {}, seed);
      const ev = take(s, 0, 'chest');
      if (gift(ev, 'chestLife').length) {
        lives++;
        expect(s.players[0].lives).toBe(PLAYER.startLives + 1);
      } else {
        curses++;
        expect(gift(ev, 'chestCurse')).toHaveLength(1);
        expect(s.bubbles.some((b) => b.size === 2)).toBe(true);
      }
    }
    expect(lives / 200).toBeGreaterThan(0.5);
    expect(lives / 200).toBeLessThan(0.72);
    expect(curses).toBeGreaterThan(30);
  });

  it('with no orb that can grow it is always a life', () => {
    const s = mk(1, [{ size: 3, x: 300, y: 200, velocityX: 0 }]);
    expect(gift(take(s, 0, 'chest'), 'chestLife')).toHaveLength(1);
  });

  it('is deterministic per seed', () => {
    const roll = (seed: number) => gift(take(mk(1, [{ size: 1, x: 300, y: 200, velocityX: 0 }], {}, seed), 0, 'chest'), 'chestLife').length;
    expect(roll(9)).toBe(roll(9));
  });
});

describe('Decoy Crate', () => {
  it('drops a bomb under you that can be outrun', () => {
    const s = mk(1);
    s.players[0].x = 300;
    const ev = take(s, 0, 'decoy');
    expect(gift(ev, 'decoy')).toHaveLength(1);
    expect(s.bombs).toHaveLength(1);
    expect(s.bombs[0].r).toBe(RARE.decoy.radius);
    // Runs right at full speed for the whole fuse: safe.
    s.setInput(0, INPUT.RIGHT, 1);
    const hurt = run(s, Math.ceil((RARE.decoy.fuse + 0.5) * TICK_RATE));
    expect(hurt.some((e) => e.k === 'boom')).toBe(true);
    expect(s.players[0].life).toBe('alive');
    expect(s.players[0].lives).toBe(PLAYER.startLives);
  });

  it('hurts if you stand still', () => {
    const s = mk(1);
    s.players[0].x = 300;
    take(s, 0, 'decoy');
    run(s, Math.ceil((RARE.decoy.fuse + 0.5) * TICK_RATE));
    expect(s.players[0].lives).toBeLessThan(PLAYER.startLives);
  });

  it('works on levels with no bomb hazard and with one', () => {
    const s = mk(2, far, { bombs: { every: 99, fuse: 3, radius: 80, firstAt: 90 } });
    s.players[0].x = 300;
    take(s, 0, 'decoy');
    expect(s.bombs.some((b) => b.r === RARE.decoy.radius)).toBe(true);
  });
});

describe('Slow Orbs', () => {
  it('orbs drop to 60% speed for 5 s, new children included, then recover exactly', () => {
    const s = mk(2, [{ size: 2, x: 300, y: 200, velocityX: 60 }, ...far]);
    const b = s.bubbles[0];
    const vx = b.vx;
    take(s, 0, 'slow');
    expect(s.slowT).toBeGreaterThan(RARE.seconds.slow - 0.2);
    expect(Math.abs(s.bubbles[0].vx)).toBeCloseTo(Math.abs(vx) * RARE.slowMul, 3);
    shootAt(s, 0, b.id);
    s.step();
    const kids = s.bubbles.filter((o) => o.size === 1);
    expect(kids.length).toBe(2);
    expect(Math.abs(kids[0].vx)).toBeCloseTo(BUBBLE_SIZES[1].speedX * 1.03 * RARE.slowMul, 1);
    const ev = run(s, Math.ceil(RARE.seconds.slow * TICK_RATE) + 2);
    expect(gift(ev, 'slowEnd')).toHaveLength(1);
    expect(s.slowT).toBe(0);
    const kid = s.bubbles.find((o) => o.id === kids[0].id)!;
    expect(Math.abs(kid.vx)).toBeCloseTo(BUBBLE_SIZES[1].speedX * 1.03, 1);
  });

  it('picking another while it runs only refreshes the timer', () => {
    const s = mk(1, [{ size: 2, x: 300, y: 200, velocityX: 60 }]);
    take(s, 0, 'slow');
    const vx = s.bubbles[0].vx;
    run(s, 30);
    take(s, 0, 'slow');
    expect(Math.abs(s.bubbles[0].vx)).toBeCloseTo(Math.abs(vx), 0);
    expect(s.slowT).toBeGreaterThan(RARE.seconds.slow - 0.2);
  });

  it('rides the snapshot', () => {
    const m = new Match({ levels: [testLevel({ bubbles: far, timeLimit: 300 })], activeSlots: [true, true], seed: 1 });
    for (let i = 0; i < 100; i++) m.advance();
    expect(encodeSnapshot(m, []).sl).toBeUndefined();
    take(m.sim, 0, 'slow');
    const snap = decodeSnapshot(JSON.parse(JSON.stringify(encodeSnapshot(m, []))));
    expect(snap.slow).toBeGreaterThan(4);
  });
});

describe('Freeze Orb', () => {
  it('freezes the nearest orb in place for 5 s, harmless to Lancers, then it thaws', () => {
    const s = mk(2, [{ size: 1, x: 300, y: 200, velocityX: 80 }, ...far]);
    const b = s.bubbles[0];
    take(s, 0, 'freeze');
    expect(b.fz).toBeGreaterThan(RARE.seconds.freeze - 0.2);
    const x = b.x;
    const y = b.y;
    run(s, 30);
    expect(b.x).toBe(x);
    expect(b.y).toBe(y);
    // Harmless: park a Lancer inside it.
    s.players[1].x = x;
    b.y = 440;
    run(s, 3);
    expect(s.players[1].life).toBe('alive');
    const ev = run(s, Math.ceil(RARE.seconds.freeze * TICK_RATE));
    expect(gift(ev, 'thaw')).toHaveLength(1);
    expect(b.fz).toBeUndefined();
  });

  it('a frozen orb can still be popped', () => {
    const s = mk(1, [{ size: 1, x: 300, y: 200, velocityX: 0 }, ...far]);
    take(s, 0, 'freeze');
    shootAt(s, 0, s.bubbles[0].id);
    expect(run(s, 2).some((e) => e.k === 'pop')).toBe(true);
  });

  it('survives the snapshot codec', () => {
    const m = new Match({ levels: [testLevel({ bubbles: [{ size: 1, x: 300, y: 200, velocityX: 0 }], timeLimit: 300 })], activeSlots: [true, true], seed: 1 });
    for (let i = 0; i < 100; i++) m.advance();
    take(m.sim, 0, 'freeze');
    const snap = decodeSnapshot(JSON.parse(JSON.stringify(encodeSnapshot(m, []))));
    expect(snap.bubbles.some((b) => b.frozen)).toBe(true);
  });
});

describe('Magnet Core', () => {
  it('small and medium orbs turn toward the Lancer for 4 s; big orbs ignore it', () => {
    const s = mk(2, [{ size: 1, x: 700, y: 200, velocityX: 80 }, { size: 3, x: 800, y: 100, velocityX: 50 }]);
    s.players[0].x = 100;
    s.players[0].input = 0;
    take(s, 0, 'magnet');
    run(s, 16);
    const small = s.bubbles.find((b) => b.size === 1)!;
    const huge = s.bubbles.find((b) => b.size === 3)!;
    expect(small.vx).toBeLessThan(0);
    expect(huge.vx).toBeGreaterThan(0);
    run(s, Math.ceil(RARE.seconds.magnet * TICK_RATE));
    expect(s.players[0].mag).toBe(0);
  });
});

describe('Double or Nothing', () => {
  it('pays double on a clean clear', () => {
    const s = mk(1, [{ size: 0, x: 300, y: 300, velocityX: 0 }]);
    take(s, 0, 'double');
    expect(s.players[0].don).toBe(1);
    shootAt(s, 0, s.bubbles[0].id);
    const ev = run(s, 3);
    const clear = ev.find((e) => e.k === 'clear') as Extract<SimEvent, { k: 'clear' }>;
    const secs = Math.floor(s.timeLeftTicks / TICK_RATE);
    expect(clear.bonus[0]).toBe(2 * (1000 + secs * 10 + 500));
    expect(gift(ev, 'donWin')).toHaveLength(1);
  });

  it('costs score if you are hit afterwards, and then pays normally', () => {
    const s = mk(1, [{ size: 0, x: 300, y: 300, velocityX: 0 }, ...far]);
    s.players[0].score = 2000;
    take(s, 0, 'double');
    s.bubbles.push({ id: 801, size: 1, x: s.players[0].x, y: 455, vx: 0, vy: 0 });
    const ev = run(s, 3);
    expect(gift(ev, 'donLose')).toHaveLength(1);
    expect(s.players[0].don).toBe(2);
    expect(s.players[0].score).toBeLessThanOrEqual(2050 - RARE.doubleLoss);
  });

  it('resets on a new level', () => {
    const s = mk(1);
    take(s, 0, 'double');
    s.loadLevel(0);
    expect(s.players[0].don).toBe(0);
  });
});

describe('Boomerang', () => {
  it('pierces: one shot can pop several orbs on the way up and on the way back, up to its hit limit', () => {
    const s = mk(1, [{ size: 2, x: 300, y: 200, velocityX: 0 }, ...far]);
    s.players[0].boom = 10;
    s.players[0].x = 300;
    s.setInput(0, INPUT.SHOOT, 1);
    s.step();
    expect(s.harpoons[0].bm).toBe(0);
    expect(s.harpoons[0].bh).toBe(RARE.boomerangHits);
    expect(s.players[0].boom).toBe(0);
    const ev = run(s, 3 * TICK_RATE);
    const pops = ev.filter((e) => e.k === 'pop').length;
    expect(pops).toBeGreaterThanOrEqual(2);
    expect(pops).toBeLessThanOrEqual(RARE.boomerangHits);
    expect(s.harpoons.filter((x) => x.owner === 0)).toHaveLength(0);
  });

  it('turns at the ceiling and returns to the floor if nothing is hit', () => {
    const s = mk(1);
    s.players[0].boom = 10;
    s.players[0].x = 300;
    s.setInput(0, INPUT.SHOOT, 1);
    run(s, 25);
    expect(s.harpoons[0].bm).toBe(1);
    run(s, 40);
    expect(s.harpoons).toHaveLength(0);
  });

  it('is plain on a noAnchor level and keeps the charge', () => {
    const s = mk(1, far, { noAnchor: true });
    s.players[0].boom = 10;
    s.players[0].x = 300;
    s.setInput(0, INPUT.SHOOT, 1);
    run(s, 30);
    expect(s.harpoons).toHaveLength(0);
    expect(s.players[0].boom).toBeGreaterThan(0);
  });

  it('a hit shot is a boomerang flag on the wire', () => {
    const m = new Match({ levels: [testLevel({ bubbles: far, timeLimit: 300 })], activeSlots: [true, true], seed: 1 });
    for (let i = 0; i < 100; i++) m.advance();
    m.sim.players[0].boom = 5;
    m.sim.players[0].x = 300;
    m.sim.setInput(0, INPUT.SHOOT, 1);
    m.advance();
    m.advance();
    const snap = decodeSnapshot(JSON.parse(JSON.stringify(encodeSnapshot(m, []))));
    expect(snap.harpoons.some((h) => h.bm === 0)).toBe(true);
  });
});

describe('Baton Crate (teamwork)', () => {
  it('shields you, and the first teammate to pop an orb inside 3 s shares it', () => {
    const s = mk(2, [{ size: 0, x: 300, y: 300, velocityX: 0 }, ...far]);
    take(s, 0, 'baton');
    expect(s.players[0].shield).toBeGreaterThan(10);
    expect(s.baton).not.toBeNull();
    shootAt(s, 1, s.bubbles[0].id);
    const ev = run(s, 2);
    expect(gift(ev, 'batonGive')).toHaveLength(1);
    expect(s.players[1].shield).toBeGreaterThan(10);
    expect(s.baton).toBeNull();
  });

  it('your own pops do not use it up, and it expires', () => {
    const s = mk(2, [{ size: 0, x: 300, y: 300, velocityX: 0 }, ...far]);
    take(s, 0, 'baton');
    shootAt(s, 0, s.bubbles[0].id);
    run(s, 2);
    expect(s.baton).not.toBeNull();
    run(s, Math.ceil(RARE.batonSeconds * TICK_RATE) + 2);
    expect(s.baton).toBeNull();
    expect(s.players[1].shield).toBe(0);
  });

  it('never drops in solo; only joins pools with a team', () => {
    const solo = mk(1);
    take(solo, 0, 'baton');
    expect(solo.baton).toBeNull();
  });
});

describe('Rescue Flare (teamwork)', () => {
  it('brings a respawning teammate back right away, and a knocked-out one with a life', () => {
    const s = mk(3);
    s.players[1].life = 'dead';
    s.players[1].respawnTimer = 2;
    s.players[2].life = 'out';
    s.players[2].lives = 0;
    s.players[0].x = 400;
    const ev1 = take(s, 0, 'flare');
    expect(gift(ev1, 'flare')[0]).toMatchObject({ to: 1 });
    expect(s.players[1].life).toBe('alive');
    expect(s.players[1].x).toBeCloseTo(400, 0);
    expect(s.players[1].invuln).toBeGreaterThan(1);
    take(s, 0, 'flare');
    expect(s.players[2].life).toBe('alive');
    expect(s.players[2].lives).toBe(1);
  });

  it('fizzles harmlessly when nobody is down', () => {
    const s = mk(2);
    const ev = take(s, 0, 'flare');
    expect(gift(ev, 'flareFizzle')).toHaveLength(1);
    expect(s.players[1].life).toBe('alive');
  });

  it('only joins the drop pool while a teammate is down', () => {
    const drops = (down: boolean) => {
      const seen = new Set<string>();
      for (let seed = 1; seed <= 300; seed++) {
        const s = new GameSimulation({
          levels: [testLevel({ noPromote: true, bubbles: [{ size: 0, x: 200, y: 300, velocityX: 0 }, ...far], powerUps: { dropChance: 1, pool: {}, placed: [] } })],
          activeSlots: seats(2),
          seed,
        });
        if (down) {
          s.players[1].life = 'dead';
          s.players[1].respawnTimer = 99;
        }
        s.harpoons.push({ id: 1, owner: 0, x: 200, tipY: 330 });
        s.step();
        for (const u of s.powerups) seen.add(u.type);
      }
      return seen.has('flare');
    };
    expect(drops(false)).toBe(false);
    expect(drops(true)).toBe(true);
  });
});

describe('rare crates: network and determinism', () => {
  it('timers ride the player row only while they run', () => {
    const m = new Match({ levels: [testLevel({ bubbles: far, timeLimit: 300 })], activeSlots: [true, true], seed: 1 });
    for (let i = 0; i < 100; i++) m.advance();
    expect(encodeSnapshot(m, []).p[0]).toHaveLength(16);
    take(m.sim, 0, 'boots');
    take(m.sim, 1, 'wide');
    const msg = encodeSnapshot(m, []);
    expect(msg.p[0]).toHaveLength(23);
    const snap = decodeSnapshot(JSON.parse(JSON.stringify(msg)));
    expect(snap.players[0].boots).toBeGreaterThan(7);
    expect(snap.players[1].wide).toBeGreaterThan(7);
    expect(snap.players[0].wide).toBe(0);
  });

  it('a decoy bomb carries its radius on the wire', () => {
    const m = new Match({ levels: [testLevel({ bubbles: far, timeLimit: 300 })], activeSlots: [true, true], seed: 1 });
    for (let i = 0; i < 100; i++) m.advance();
    take(m.sim, 0, 'decoy');
    const snap = decodeSnapshot(JSON.parse(JSON.stringify(encodeSnapshot(m, []))));
    expect(snap.bombs[0].r).toBe(RARE.decoy.radius);
  });

  it('is deterministic with every crate in play', () => {
    const play = () => {
      const s = mk(3, [{ size: 2, x: 300, y: 150 }, { size: 1, x: 700, y: 150, velocityX: -100 }, { size: 1, x: 500, y: 150, velocityX: 60 }], {}, 21);
      const log: unknown[] = [];
      const types: PowerUpType[] = ['shrink', 'boots', 'potato', 'wide', 'pinata', 'chest', 'slow', 'freeze', 'magnet', 'double', 'baton', 'boomerang'];
      for (let i = 0; i < 600; i++) {
        if (i % 40 === 0) s.powerups.push({ id: 1000 + i, type: types[(i / 40) % types.length], x: s.players[i % 3].x, y: 470, life: 5, grounded: true });
        s.setInput(i % 3, ((i >> 4) % 2 ? INPUT.LEFT : INPUT.RIGHT) | (i % 7 === 0 ? INPUT.SHOOT : 0), i + 1);
        s.step();
        log.push(s.drainEvents());
      }
      return JSON.stringify([s.bubbles, s.players.map((p) => [p.x, p.score, p.shield]), log]);
    };
    expect(play()).toBe(play());
  });
});
