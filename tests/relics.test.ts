import { describe, expect, it } from 'vitest';
import {
  BUBBLE_SIZES,
  GameSimulation,
  INPUT,
  Match,
  PINCH,
  PLAYER,
  RELIC,
  RELIC_KINDS,
  TICK_RATE,
  decodeSnapshot,
  encodeSnapshot,
  type BubbleSpawn,
  type PowerUpType,
  type RelicKind,
  type SimEvent,
} from '@orb/shared';
import { testLevel } from './helpers';

const seats = (n: number) => Array.from({ length: 4 }, (_, i) => i < n);
const far: BubbleSpawn[] = [{ size: 3, x: 900, y: 100, velocityX: 0 }];
const mk = (n: number, bubbles: BubbleSpawn[] = far, seed = 1) =>
  new GameSimulation({
    levels: [testLevel({ bubbles, timeLimit: 300, noPromote: true }), testLevel({ id: 'l2', bubbles, timeLimit: 300, noPromote: true })],
    activeSlots: seats(n),
    seed,
  });
const bit = (k: RelicKind) => 1 << RELIC_KINDS.indexOf(k);
const give = (s: GameSimulation, slot: number, ...ks: RelicKind[]) => {
  for (const k of ks) s.players[slot].rel |= bit(k);
};
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
function shootAt(s: GameSimulation, owner: number, id: number): void {
  const b = s.bubbles.find((x) => x.id === id)!;
  s.harpoons.push({ id: 9000 + s.harpoons.length + s.tick * 10, owner, x: b.x, tipY: Math.min(b.y + BUBBLE_SIZES[b.size].radius + 8, 436) });
}
const relicEv = (ev: SimEvent[], t: string) => ev.filter((e) => e.k === 'relic' && e.t === t);

describe('Unknown Relic crate', () => {
  it('gives the picker a relic they lack, only them, and it survives the next level', () => {
    const s = mk(2);
    const ev = take(s, 0, 'relic');
    expect(relicEv(ev, 'get')).toHaveLength(1);
    expect(s.players[0].rel).not.toBe(0);
    expect(s.players[1].rel).toBe(0);
    const before = s.players[0].rel;
    s.loadLevel(1);
    expect(s.players[0].rel).toBe(before);
  });

  it('never repeats a relic, stops at the cap, and pays points when full', () => {
    const s = mk(2);
    for (let i = 0; i < RELIC.maxPerPlayer; i++) take(s, 0, 'relic');
    let n = 0;
    for (let m = s.players[0].rel; m; m &= m - 1) n++;
    expect(n).toBe(RELIC.maxPerPlayer);
    const score = s.players[0].score;
    const ev = take(s, 0, 'relic');
    expect(relicEv(ev, 'full')).toHaveLength(1);
    expect(s.players[0].score).toBeGreaterThan(score);
  });

  it('is deterministic for a seed', () => {
    const pick = (seed: number) => {
      const s = mk(2, far, seed);
      take(s, 0, 'relic');
      return s.players[0].rel;
    };
    expect(pick(5)).toBe(pick(5));
    expect(new Set([1, 2, 3, 4, 5, 6, 7, 8].map(pick)).size).toBeGreaterThan(1);
  });

  it('a new match starts with no relics', () => {
    const s = mk(2);
    take(s, 0, 'relic');
    expect(mk(2).players[0].rel).toBe(0);
  });
});

describe('earning a relic crate through teamwork', () => {
  const coopLevel = (n: number, seed: number) =>
    new GameSimulation({
      levels: [testLevel({ bubbles: [{ size: 2, x: 300, y: 200, velocityX: 0, special: 'coop' }, ...far], timeLimit: 300, noPromote: true })],
      activeSlots: seats(n),
      seed,
    });
  const finishCoop = (s: GameSimulation) => {
    const id = s.bubbles[0].id;
    shootAt(s, 0, id);
    run(s, 8);
    shootAt(s, 1, id);
    run(s, 2);
  };

  it('a finished coop target can drop a crate, never more than one per level', () => {
    let drops = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const s = coopLevel(2, seed);
      finishCoop(s);
      const crates = s.powerups.filter((u) => u.type === 'relic').length;
      expect(crates).toBeLessThanOrEqual(1);
      drops += crates;
    }
    expect(drops).toBeGreaterThan(10);
    expect(drops).toBeLessThan(40);
  });

  it('solo never earns one', () => {
    const solo = new GameSimulation({ levels: [testLevel({ bubbles: [{ size: 2, x: 300, y: 200, velocityX: 0 }], timeLimit: 300 })], activeSlots: seats(1), seed: 1 });
    const id = solo.bubbles[0].id;
    shootAt(solo, 0, id);
    run(solo, 3);
    expect(solo.powerups.some((u) => u.type === 'relic')).toBe(false);
  });

  it('after a crate drops, the next one waits for the gap in cleared levels', () => {
    let found: GameSimulation | null = null;
    for (let seed = 1; seed <= 40 && !found; seed++) {
      const s = coopLevel(2, seed);
      finishCoop(s);
      if (s.powerups.some((u) => u.type === 'relic')) found = s;
    }
    expect(found).not.toBeNull();
    const s = found as unknown as { levelsSinceRelic: number };
    expect(s.levelsSinceRelic).toBe(0);
  });
});

describe('Pinch', () => {
  const big = (): BubbleSpawn[] => [{ size: 2, x: 400, y: 200, velocityX: 0 }];

  it('two different Lancers on the same orb inside the window: it vanishes with no children', () => {
    const s = mk(2, big());
    const id = s.bubbles[0].id;
    shootAt(s, 0, id);
    shootAt(s, 1, id);
    const ev = run(s, 3);
    expect(ev.filter((e) => e.k === 'pinch')).toHaveLength(1);
    expect(s.bubbles).toHaveLength(0);
    expect(s.coopStats.pinches).toBe(1);
    expect(s.players[0].score).toBeGreaterThanOrEqual(PINCH.bonus);
    expect(s.players[1].score).toBeGreaterThanOrEqual(PINCH.bonus);
  });

  it('the same Lancer twice is an ordinary pop', () => {
    const s = mk(2, big());
    shootAt(s, 0, s.bubbles[0].id);
    run(s, 1);
    expect(s.bubbles).toHaveLength(2);
  });

  it('a late second hit is an ordinary pop', () => {
    const s = mk(2, big());
    shootAt(s, 0, s.bubbles[0].id);
    run(s, PINCH.ticks + 3);
    shootAt(s, 1, s.bubbles[0].id);
    const ev = run(s, 2);
    expect(ev.filter((e) => e.k === 'pinch')).toHaveLength(0);
    expect(s.bubbles.length).toBeGreaterThan(0);
  });

  it('a small orb is never pinched', () => {
    const s = mk(2, [{ size: 1, x: 400, y: 200, velocityX: 0 }]);
    shootAt(s, 0, s.bubbles[0].id);
    shootAt(s, 1, s.bubbles[0].id);
    expect(run(s, 3).filter((e) => e.k === 'pinch')).toHaveLength(0);
  });

  it('a pinch counts as teamwork for relic crates', () => {
    let drops = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const s = mk(2, big(), seed);
      shootAt(s, 0, s.bubbles[0].id);
      shootAt(s, 1, s.bubbles[0].id);
      run(s, 3);
      drops += s.powerups.filter((u) => u.type === 'relic').length;
    }
    expect(drops).toBeGreaterThan(5);
  });
});

describe('relic effects', () => {
  it('Magnet Hand pulls nearby crates toward you', () => {
    const s = mk(2);
    give(s, 0, 'magnet');
    s.powerups.push({ id: 1, type: 'shield', x: s.players[0].x + 90, y: 100, life: 9, grounded: false });
    const x0 = s.powerups[0].x;
    run(s, 10);
    expect(s.powerups[0].x).toBeLessThan(x0);
    const plain = mk(2);
    plain.powerups.push({ id: 1, type: 'shield', x: plain.players[0].x + 90, y: 100, life: 9, grounded: false });
    run(plain, 10);
    expect(plain.powerups[0].x).toBe(x0);
  });

  it('Quick Draw: the first tether after a respawn ignores the cooldown and starts higher, once', () => {
    const s = mk(2);
    give(s, 0, 'quickdraw');
    s.players[0].cooldown = 5;
    s.setInput(0, INPUT.SHOOT, 1);
    run(s, 1);
    const h = s.harpoons.find((x) => x.owner === 0)!;
    expect(h).toBeDefined();
    expect(h.tipY).toBeLessThan(480 - PLAYER.height - RELIC.quickdraw.head + 1);
    expect(s.players[0].qd).toBe(false);
    s.harpoons = [];
    s.players[0].cooldown = 5;
    s.setInput(0, 0, 2);
    s.setInput(0, INPUT.SHOOT, 3);
    run(s, 1);
    expect(s.harpoons.filter((x) => x.owner === 0)).toHaveLength(0);
  });

  it('Anchor Master lengthens the anchor charge', () => {
    const s = mk(2);
    give(s, 0, 'anchor');
    take(s, 0, 'anchor');
    expect(s.players[0].anc).toBeGreaterThan(20);
    take(s, 1, 'anchor');
    expect(s.players[1].anc).toBeLessThan(16);
  });

  it('Dash: double-tap moves you and protects you, with a cooldown; no relic, no dash', () => {
    const s = mk(2);
    give(s, 0, 'dash');
    const x0 = s.players[0].x;
    s.setInput(0, INPUT.RIGHT, 1);
    run(s, 1);
    s.setInput(0, 0, 2);
    run(s, 1);
    s.setInput(0, INPUT.RIGHT, 3);
    const ev = run(s, 1);
    expect(relicEv(ev, 'dash')).toHaveLength(1);
    expect(s.players[0].x - x0).toBeGreaterThan(RELIC.dash.distance);
    expect(s.players[0].invuln).toBeGreaterThan(0.1);
    const x1 = s.players[0].x;
    s.setInput(0, 0, 4);
    run(s, 1);
    s.setInput(0, INPUT.RIGHT, 5);
    run(s, 1);
    s.setInput(0, 0, 6);
    run(s, 1);
    s.setInput(0, INPUT.RIGHT, 7);
    expect(relicEv(run(s, 1), 'dash')).toHaveLength(0);
    expect(s.players[0].x - x1).toBeLessThan(RELIC.dash.distance / 2);
    const plain = mk(2);
    plain.setInput(1, INPUT.LEFT, 1);
    run(plain, 1);
    plain.setInput(1, 0, 2);
    run(plain, 1);
    plain.setInput(1, INPUT.LEFT, 3);
    expect(relicEv(run(plain, 1), 'dash')).toHaveLength(0);
  });

  it('a slow double-tap is not a dash', () => {
    const s = mk(2);
    give(s, 0, 'dash');
    s.setInput(0, INPUT.RIGHT, 1);
    run(s, 1);
    s.setInput(0, 0, 2);
    run(s, RELIC.dash.tapTicks + 3);
    s.setInput(0, INPUT.RIGHT, 3);
    expect(relicEv(run(s, 1), 'dash')).toHaveLength(0);
  });

  it('Guardian slows orbs near it, not far ones', () => {
    const s = mk(2, [
      { size: 1, x: 190, y: 380, velocityX: 120 },
      { size: 1, x: 700, y: 380, velocityX: 120 },
    ]);
    give(s, 0, 'guardian');
    s.players[0].invuln = 99;
    s.players[1].invuln = 99;
    const a0 = s.bubbles[0].x;
    const b0 = s.bubbles[1].x;
    run(s, 6);
    const da = s.bubbles[0].x - a0;
    const db = s.bubbles[1].x - b0;
    expect(da).toBeGreaterThan(0);
    expect(da).toBeLessThan(db * 0.95);
  });

  it('Relay: after a teammate pops an orb you may have a second tether for a moment', () => {
    const s = mk(2, [{ size: 0, x: 300, y: 300, velocityX: 0 }, ...far]);
    give(s, 1, 'relay');
    shootAt(s, 0, s.bubbles[0].id);
    run(s, 2);
    expect(s.players[1].relayT).toBeGreaterThan(0);
    s.players[1].cooldown = 0;
    s.setInput(1, INPUT.SHOOT, 1);
    run(s, 1);
    s.setInput(1, 0, 2);
    s.players[1].cooldown = 0;
    s.setInput(1, INPUT.SHOOT, 3);
    run(s, 1);
    expect(s.harpoons.filter((h) => h.owner === 1).length).toBe(2);
    expect(s.players[0].relayT).toBe(0);
  });

  it('Coordinator: windows on targets you start are 50% longer', () => {
    const level: BubbleSpawn[] = [{ size: 2, x: 300, y: 200, velocityX: 0, special: 'coop' }, ...far];
    const s = mk(2, level);
    give(s, 0, 'coordinator');
    shootAt(s, 0, s.bubbles[0].id);
    run(s, 1);
    const plain = mk(2, level);
    shootAt(plain, 0, plain.bubbles[0].id);
    run(plain, 1);
    expect(s.bubbles[0].sa!).toBeGreaterThan(plain.bubbles[0].sa! * 1.4);
  });

  it('Lifeline: a fallen teammate gives you a burst of speed and their beacon lasts longer', () => {
    const s = mk(2, [{ size: 1, x: 760, y: 440, velocityX: 0 }, ...far]);
    give(s, 0, 'lifeline');
    s.players[1].lives = 1;
    const ev = run(s, 2);
    expect(relicEv(ev, 'lifeline')).toHaveLength(1);
    expect(s.players[0].speed).toBeGreaterThan(1);
    const flare = s.powerups.find((u) => u.type === 'flare');
    expect(flare!.life).toBeGreaterThan(15);
  });

  it('Team Player: a nearby teammate gets a short copy of your Shield; a far one does not', () => {
    const s = mk(2);
    give(s, 0, 'teamplayer');
    s.players[1].x = s.players[0].x + 60;
    take(s, 0, 'shield');
    expect(s.players[1].shield).toBeGreaterThan(0);
    expect(s.players[1].shield).toBeLessThanOrEqual(RELIC.teamplayer.shield);
    const away = mk(2);
    give(away, 0, 'teamplayer');
    away.players[1].x = away.players[0].x + 400;
    take(away, 0, 'shield');
    expect(away.players[1].shield).toBe(0);
  });

  it('Second Wind: once per level a faster respawn with extra protection', () => {
    const s = mk(2, [{ size: 1, x: 200, y: 440, velocityX: 0 }, ...far]);
    give(s, 0, 'secondwind');
    s.players[0].lives = 3;
    const ev = run(s, 2);
    expect(relicEv(ev, 'wake')).toHaveLength(1);
    expect(s.players[0].respawnTimer).toBeLessThan(1.5);
    run(s, Math.ceil(1.1 * TICK_RATE));
    expect(s.players[0].life).toBe('alive');
    expect(s.players[0].invuln).toBeGreaterThan(2.5);
  });
});

describe('relics on the wire', () => {
  it('the bitmask rides in the snapshot', () => {
    const m = new Match({ levels: [testLevel({ bubbles: far, timeLimit: 300 })], activeSlots: [true, true], seed: 2 });
    for (let i = 0; i < 100; i++) m.advance();
    give(m.sim, 1, 'dash', 'guardian');
    const snap = decodeSnapshot(JSON.parse(JSON.stringify(encodeSnapshot(m, []))));
    expect(snap.players[1].rel).toBe(bit('dash') | bit('guardian'));
    expect(snap.players[0].rel).toBe(0);
  });
});
