import { describe, expect, it } from 'vitest';
import {
  BUBBLE_SIZES,
  GameSimulation,
  INPUT,
  LEVELS,
  MATCH,
  Match,
  PLAYER,
  POWERUP,
  SCORING,
  TICK_RATE,
  WORLD,
  type PowerUpType,
  type SimEvent,
} from '@orb/shared';
import { placed, testLevel } from './helpers';

function sim(levelOver = {}, active = [true, false], seed = 1) {
  return new GameSimulation({ levels: [testLevel(levelOver)], activeSlots: active, seed });
}

function run(s: GameSimulation, ticks: number, until?: (e: SimEvent[]) => boolean): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    s.step();
    const e = s.drainEvents();
    all.push(...e);
    if (until?.(e)) break;
  }
  return all;
}

describe('shooting and splitting', () => {
  it('splits a large orb into two medium orbs moving apart, and scores', () => {
    const s = sim({ bubbles: [{ size: 2, x: 200, y: 200, velocityX: 0 }] });
    s.setInput(0, INPUT.SHOOT, 1);
    const ev = run(s, 30, (e) => e.some((x) => x.k === 'pop'));
    expect(ev.some((e) => e.k === 'shoot')).toBe(true);
    const pop = ev.find((e) => e.k === 'pop');
    expect(pop).toMatchObject({ k: 'pop', s: 2, by: 0, pts: BUBBLE_SIZES[2].points });
    expect(s.bubbles).toHaveLength(2);
    expect(s.bubbles.every((b) => b.size === 1)).toBe(true);
    expect(Math.sign(s.bubbles[0].vx)).toBe(-Math.sign(s.bubbles[1].vx));
    expect(s.bubbles.every((b) => b.vy < 0)).toBe(true);
    expect(s.players[0].score).toBe(BUBBLE_SIZES[2].points);
    expect(s.harpoons).toHaveLength(0);
  });

  it('destroys the smallest orb and clears the level with bonuses', () => {
    const s = sim({ bubbles: [{ size: 0, x: 200, y: 300, velocityX: 0 }] });
    s.setInput(0, INPUT.SHOOT, 1);
    const ev = run(s, 30, () => s.status !== 'running');
    expect(s.bubbles).toHaveLength(0);
    expect(s.status).toBe('cleared');
    const clear = ev.find((e) => e.k === 'clear') as Extract<SimEvent, { k: 'clear' }>;
    const secs = Math.floor(s.timeLeftTicks / TICK_RATE);
    const expectedBonus = SCORING.levelClear + secs * SCORING.timeBonusPerSecond + SCORING.survivalBonus;
    expect(clear.bonus[0]).toBe(expectedBonus);
    expect(s.players[0].score).toBe(BUBBLE_SIZES[0].points + expectedBonus);
  });

  it('fires only on the rising edge and respects max harpoons', () => {
    const s = sim({ bubbles: [{ size: 3, x: 900, y: 100, velocityX: 0 }] });
    s.setInput(0, INPUT.SHOOT, 1);
    run(s, 1);
    s.setInput(0, INPUT.SHOOT, 2); // still held: no new shot
    run(s, 8);
    expect(s.harpoons).toHaveLength(1);
    s.setInput(0, 0, 3);
    s.setInput(0, INPUT.SHOOT, 4); // new press while one is in flight
    run(s, 1);
    expect(s.harpoons).toHaveLength(1);
  });

  it('allows two harpoons with Double Harpoon', () => {
    const s = sim({ bubbles: [{ size: 3, x: 900, y: 100, velocityX: 0 }] });
    s.players[0].dbl = 10;
    s.setInput(0, INPUT.SHOOT, 1);
    run(s, 7);
    s.setInput(0, 0, 2);
    s.setInput(0, INPUT.SHOOT, 3);
    run(s, 1);
    expect(s.harpoons).toHaveLength(2);
  });

  it('server ignores bits outside the input mask', () => {
    const s = sim();
    s.setInput(0, 0xff, 1);
    expect(s.players[0].input).toBe(INPUT.MASK);
  });
});

describe('damage, lives, respawn', () => {
  const overlapping = () => sim({ bubbles: [{ size: 2, x: 200, y: WORLD.height - BUBBLE_SIZES[2].radius - 2, velocityX: 0 }] });

  it('loses a life, waits, then respawns with invulnerability', () => {
    const s = overlapping();
    const ev = run(s, 1);
    expect(ev.map((e) => e.k)).toEqual(expect.arrayContaining(['hurt', 'die']));
    expect(s.players[0].lives).toBe(PLAYER.startLives - 1);
    expect(s.players[0].life).toBe('dead');
    s.bubbles = [];
    s.status = 'running';
    s.bubbles.push({ id: 999, size: 0, x: 900, y: 50, vx: 0, vy: 0 });
    const ev2 = run(s, PLAYER.respawnDelay * TICK_RATE + 2);
    expect(ev2.some((e) => e.k === 'respawn')).toBe(true);
    expect(s.players[0].life).toBe('alive');
    expect(s.players[0].invuln).toBeGreaterThan(0);
  });

  it('a shield absorbs one hit', () => {
    const s = overlapping();
    s.players[0].shield = 5;
    const ev = run(s, 1);
    expect(ev).toContainEqual({ k: 'hurt', p: 0, shield: true });
    expect(s.players[0].lives).toBe(PLAYER.startLives);
    expect(s.players[0].shield).toBe(0);
    expect(s.players[0].invuln).toBeGreaterThan(0);
  });

  it('game over when every active player is out', () => {
    const s = overlapping();
    s.players[0].lives = 1;
    run(s, 1);
    expect(s.players[0].life).toBe('out');
    expect(s.status).toBe('gameover');
  });

  it('co-op: one player out does not end the game', () => {
    const s = sim({ bubbles: [{ size: 2, x: 200, y: WORLD.height - 32, velocityX: 0 }] }, [true, true]);
    s.players[0].lives = 1;
    run(s, 1);
    expect(s.players[0].life).toBe('out');
    expect(s.players[1].life).toBe('alive');
    expect(s.status).toBe('running');
  });
});

describe('power-ups', () => {
  const cases: [PowerUpType, (s: GameSimulation, before: number) => void][] = [
    ['shield', (s) => expect(s.players[0].shield).toBeGreaterThan(0)],
    ['extraLife', (s) => expect(s.players[0].lives).toBe(PLAYER.startLives + 1)],
    ['extraTime', (s, before) => expect(s.timeLeftTicks).toBeGreaterThan(before + (POWERUP.extraTimeSeconds - 1) * TICK_RATE)],
    ['doubleHarpoon', (s) => expect(s.players[0].dbl).toBeGreaterThan(0)],
    ['speedBoost', (s) => expect(s.players[0].speed).toBeGreaterThan(0)],
  ];
  for (const [type, check] of cases) {
    it(`grants ${type} on pickup (server-side only)`, () => {
      const s = sim({ bubbles: [{ size: 0, x: 900, y: 60, velocityX: 0 }], powerUps: placed(type, 200, 300) });
      const before = s.timeLeftTicks;
      const ev = run(s, 60, (e) => e.some((x) => x.k === 'pickup'));
      expect(ev.some((e) => e.k === 'drop')).toBe(true);
      expect(ev).toContainEqual(expect.objectContaining({ k: 'pickup', p: 0, type }));
      check(s, before);
      expect(s.powerups).toHaveLength(0);
    });
  }

  it('speed boost makes the player faster', () => {
    const a = sim();
    const b = sim();
    b.players[0].speed = 5;
    a.setInput(0, INPUT.RIGHT, 1);
    b.setInput(0, INPUT.RIGHT, 1);
    run(a, 10);
    run(b, 10);
    expect(b.players[0].x - 200).toBeCloseTo((a.players[0].x - 200) * POWERUP.speedMultiplier, 3);
  });

  it('uncollected power-ups expire', () => {
    const s = sim({ bubbles: [{ size: 0, x: 900, y: 60, velocityX: 0 }], powerUps: placed('shield', 600, 300) });
    run(s, Math.ceil(POWERUP.lifetime * TICK_RATE) + 2);
    expect(s.powerups).toHaveLength(0);
    expect(s.players[0].shield).toBe(0);
  });

  it('random drops come from the seeded RNG (reproducible)', () => {
    const mk = () => {
      const s = sim({ bubbles: [{ size: 3, x: 200, y: 200, velocityX: 0 }], powerUps: { dropChance: 1, pool: { speedBoost: 1 }, placed: [] } });
      s.setInput(0, INPUT.SHOOT, 1);
      return run(s, 40).filter((e) => e.k === 'drop');
    };
    const a = mk();
    expect(a.length).toBeGreaterThan(0);
    expect(mk()).toEqual(a);
  });
});

describe('determinism', () => {
  it('same seed + same inputs → identical worlds', () => {
    const make = () => new Match({ levels: LEVELS, activeSlots: [true, true], seed: 1234 });
    const a = make();
    const b = make();
    for (let t = 0; t < 30 * 40; t++) {
      if (t % 17 === 0) {
        const bits = (t / 17) % 4 === 0 ? INPUT.LEFT | INPUT.SHOOT : (t / 17) % 4 === 1 ? INPUT.RIGHT : (t / 17) % 4 === 2 ? INPUT.SHOOT : 0;
        a.sim.setInput(0, bits, t + 1);
        b.sim.setInput(0, bits, t + 1);
        a.sim.setInput(1, bits ^ INPUT.SHOOT, t + 1);
        b.sim.setInput(1, bits ^ INPUT.SHOOT, t + 1);
      }
      a.advance();
      b.advance();
    }
    expect(JSON.stringify(a.sim.bubbles)).toEqual(JSON.stringify(b.sim.bubbles));
    expect(JSON.stringify(a.sim.players)).toEqual(JSON.stringify(b.sim.players));
    expect(a.drainEvents()).toEqual(b.drainEvents());
  });
});

describe('Match flow', () => {
  const twoLevels = [
    testLevel({ id: 'a', bubbles: [{ size: 0, x: 200, y: 300, velocityX: 0 }] }),
    testLevel({ id: 'b', bubbles: [{ size: 0, x: 200, y: 300, velocityX: 0 }] }),
  ];

  it('countdown → playing → levelComplete → next level → victory', () => {
    const m = new Match({ levels: twoLevels, activeSlots: [true, false], seed: 1 });
    expect(m.phase).toBe('countdown');
    for (let i = 0; i < MATCH.countdownSeconds * TICK_RATE; i++) m.advance();
    expect(m.phase).toBe('playing');
    m.sim.setInput(0, INPUT.SHOOT, 1);
    for (let i = 0; i < 40 && m.phase === 'playing'; i++) m.advance();
    expect(m.phase).toBe('levelComplete');
    const v = m.levelVersion;
    for (let i = 0; i < MATCH.levelCompleteSeconds * TICK_RATE; i++) m.advance();
    expect(m.phase).toBe('countdown');
    expect(m.sim.levelIndex).toBe(1);
    expect(m.levelVersion).toBe(v + 1);
    for (let i = 0; i < MATCH.countdownSeconds * TICK_RATE; i++) m.advance();
    m.sim.setInput(0, 0, 2);
    m.sim.setInput(0, INPUT.SHOOT, 3);
    for (let i = 0; i < 40 && m.phase === 'playing'; i++) m.advance();
    expect(m.phase).toBe('victory');
    expect(m.isTerminal).toBe(true);
  });

  it('time up costs a life and restarts the level', () => {
    const m = new Match({ levels: [testLevel({ timeLimit: 0.5, bubbles: [{ size: 3, x: 800, y: 100, velocityX: 0 }] })], activeSlots: [true, false], seed: 1 });
    for (let i = 0; i < MATCH.countdownSeconds * TICK_RATE + 20; i++) m.advance();
    expect(m.phase).toBe('timeUp');
    expect(m.sim.players[0].lives).toBe(PLAYER.startLives - 1);
    for (let i = 0; i < MATCH.timeUpSeconds * TICK_RATE; i++) m.advance();
    expect(m.phase).toBe('countdown');
    expect(m.sim.timeLeftTicks).toBe(15);
  });

  it('time up with last life → game over', () => {
    const m = new Match({ levels: [testLevel({ timeLimit: 0.5, bubbles: [{ size: 3, x: 800, y: 100, velocityX: 0 }] })], activeSlots: [true, false], seed: 1 });
    m.sim.players[0].lives = 1;
    for (let i = 0; i < MATCH.countdownSeconds * TICK_RATE + 20; i++) m.advance();
    expect(m.phase).toBe('gameOver');
  });

  it('pause freezes the world and resume goes through a countdown', () => {
    const m = new Match({ levels: LEVELS, activeSlots: [true, true], seed: 1 });
    for (let i = 0; i < MATCH.countdownSeconds * TICK_RATE + 5; i++) m.advance();
    expect(m.pause('player', 0)).toBe(true);
    const before = JSON.stringify(m.sim.bubbles);
    for (let i = 0; i < 30; i++) m.advance();
    expect(JSON.stringify(m.sim.bubbles)).toBe(before);
    m.resume();
    expect(m.phase).toBe('countdown');
  });
});
