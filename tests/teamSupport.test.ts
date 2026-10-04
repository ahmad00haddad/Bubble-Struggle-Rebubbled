import { describe, expect, it } from 'vitest';
import {
  GameSimulation,
  Match,
  RARE,
  SPECIAL,
  TICK_RATE,
  coopWindow,
  decodeSnapshot,
  encodeSnapshot,
  type BubbleSpawn,
  type PowerUpType,
  type SimEvent,
} from '@orb/shared';
import { testLevel } from './helpers';

const seats = (n: number) => Array.from({ length: 4 }, (_, i) => i < n);
const far: BubbleSpawn[] = [{ size: 3, x: 480, y: 100, velocityX: 0 }];
const mk = (n: number, bubbles: BubbleSpawn[] = far, seed = 1) =>
  new GameSimulation({ levels: [testLevel({ bubbles, timeLimit: 300, noPromote: true })], activeSlots: seats(n), seed });

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


describe('Rescue beacon', () => {
  const knockOut = (n: number) => {
    const s = mk(n, [{ size: 1, x: 760, y: 440, velocityX: 0 }, { size: 3, x: 200, y: 100, velocityX: 0 }]);
    s.players[1].lives = 1;
    run(s, 2);
    return s;
  };

  it.each([2, 3, 4])('a Flare falls where a Lancer is knocked out while teammates stand (%i players)', (n) => {
    const s = knockOut(n);
    expect(s.players[1].life).toBe('out');
    const flare = s.powerups.find((u) => u.type === 'flare');
    expect(flare).toBeDefined();
    expect(Math.abs(flare!.x - s.players[1].x)).toBeLessThan(2);
    expect(s.coopStats.rescueOffered).toBe(1);
    expect(s.coopStats.rescued).toBe(0);
  });

  it('a teammate who picks it up brings them back and it is counted', () => {
    const s = knockOut(2);
    s.powerups = [];
    s.bubbles = s.bubbles.filter((b) => b.size === 3);
    s.players[0].x = s.players[1].x;
    take(s, 0, 'flare');
    expect(s.players[1].life).toBe('alive');
    expect(s.players[1].lives).toBe(1);
    expect(s.coopStats.rescued).toBe(1);
  });

  it('the beacon fades if nobody gets it, and the Lancer stays out', () => {
    const s = knockOut(2);
    s.players[0].x = 100;
    s.powerups = s.powerups.map((u) => ({ ...u, y: 470, grounded: true }));
    run(s, Math.ceil(10 * TICK_RATE));
    expect(s.powerups.some((u) => u.type === 'flare')).toBe(false);
    expect(s.players[1].life).toBe('out');
    expect(s.coopStats.rescued).toBe(0);
  });

  it('no beacon in solo or when the last standing Lancer is the one who falls', () => {
    const solo = mk(1, [{ size: 1, x: 200, y: 440, velocityX: 0 }]);
    solo.players[0].lives = 1;
    run(solo, 2);
    expect(solo.coopStats.rescueOffered).toBe(0);

    const s = mk(2, [{ size: 1, x: 760, y: 440, velocityX: 0 }]);
    s.players[0].life = 'out';
    s.players[1].lives = 1;
    run(s, 2);
    expect(s.players[1].life).toBe('out');
    expect(s.coopStats.rescueOffered).toBe(0);
  });

  it('a Lancer who still has lives respawns on their own and gets no beacon', () => {
    const s = mk(2, [{ size: 1, x: 760, y: 440, velocityX: 0 }, ...far]);
    run(s, 2);
    expect(s.players[1].life).toBe('dead');
    expect(s.coopStats.rescueOffered).toBe(0);
  });
});

describe('Baton window on the wire', () => {
  it('snapshots carry owner and time left while the baton is live, and nothing otherwise', () => {
    const m = new Match({ levels: [testLevel({ bubbles: far, timeLimit: 300 })], activeSlots: [true, true], seed: 2 });
    for (let i = 0; i < 100; i++) m.advance();
    expect(decodeSnapshot(JSON.parse(JSON.stringify(encodeSnapshot(m, [])))).baton).toBeUndefined();
    take(m.sim, 1, 'baton');
    const snap = decodeSnapshot(JSON.parse(JSON.stringify(encodeSnapshot(m, []))));
    expect(snap.baton?.owner).toBe(1);
    expect(snap.baton!.t).toBeGreaterThan(RARE.batonSeconds - 0.3);
    expect(snap.baton!.t).toBeLessThanOrEqual(RARE.batonSeconds);
  });
});

describe('Coop window by Lancers needed', () => {
  it('3 or more Lancers get the longer window', () => {
    expect(coopWindow(2)).toBe(SPECIAL.coop.window);
    expect(coopWindow(3)).toBe(SPECIAL.coop.windowBig);
    expect(coopWindow(4)).toBe(SPECIAL.coop.windowBig);
    expect(SPECIAL.coop.windowBig).toBeGreaterThan(SPECIAL.coop.window);
  });

  it('a need-3 orb arms with the long window', () => {
    const s = mk(3, [{ size: 2, x: 300, y: 200, velocityX: 0, special: 'coop', need: 3 }]);
    const b = s.bubbles[0];
    s.harpoons.push({ id: 1, owner: 0, x: b.x, tipY: b.y + 40 });
    run(s, 1);
    expect(b.sa).toBeGreaterThan(SPECIAL.coop.window);
    expect(b.sa).toBeLessThanOrEqual(SPECIAL.coop.windowBig);
  });
});

