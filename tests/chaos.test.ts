import { describe, expect, it } from 'vitest';
import {
  CHAOS,
  CHAOS_KINDS,
  GameSimulation,
  INPUT,
  Match,
  PLAYER,
  TICK_MS,
  TICK_RATE,
  decodeSnapshot,
  encodeSnapshot,
  movePlayerFx,
  moveFxOf,
  parseClientMessage,
  type BubbleSpawn,
  type ChaosKind,
  type ServerMessage,
  type SimEvent,
} from '@orb/shared';
import { RoomCore, type Conn, type RoomHost, type RoomMeta } from '../worker/src/rooms/RoomCore';
import { testLevel } from './helpers';

const seats = (n: number) => Array.from({ length: 4 }, (_, i) => i < n);
const far: BubbleSpawn[] = [{ size: 3, x: 900, y: 100, velocityX: 0 }];
const mk = (n: number, opts: { chaos?: boolean; bubbles?: BubbleSpawn[]; seed?: number } = {}) =>
  new GameSimulation({ levels: [testLevel({ bubbles: opts.bubbles ?? far, timeLimit: 300 })], activeSlots: seats(n), seed: opts.seed ?? 1, chaos: opts.chaos });
const idx = (k: ChaosKind) => CHAOS_KINDS.indexOf(k) + 1;

/** Make the next chaos roll pick `kind` (the weighted draw is the first RNG call). */
function force(s: GameSimulation, kind: ChaosKind): void {
  const total = Object.values(CHAOS.weights).reduce((a, b) => a + b, 0);
  let before = 0;
  for (const k of CHAOS_KINDS) {
    if (k === kind) break;
    before += CHAOS.weights[k];
  }
  const rng = (s as unknown as { chaosRng: { next: () => number } }).chaosRng;
  const real = rng.next.bind(rng);
  let first = true;
  rng.next = () => {
    if (first) {
      first = false;
      return (before + CHAOS.weights[kind] / 2) / total;
    }
    return real();
  };
}

function grab(s: GameSimulation, user: number): SimEvent[] {
  s.powerups.push({ id: 500 + s.tick, type: 'chaos', x: s.players[user].x, y: 470, life: 5, grounded: true });
  s.step();
  return s.drainEvents();
}
const chaosEv = (ev: SimEvent[]) => ev.filter((e): e is Extract<SimEvent, { k: 'chaos' }> => e.k === 'chaos' && e.t !== 'end');

describe('chaos: rules', () => {
  it('never happens in solo: the pickup fizzles and nothing changes', () => {
    const s = mk(1);
    const ev = chaosEv(grab(s, 0));
    expect(ev).toEqual([{ k: 'chaos', t: 'fizzle', by: 0, to: -1 }]);
    expect(s.players[0].fx).toBe(0);
    expect(s.chaosOn()).toBe(false);
  });

  it('the chaos pickup never appears in solo drop pools or gift crates', () => {
    const lvl = testLevel({ bubbles: [{ size: 0, x: 200, y: 300, velocityX: 0 }], powerUps: { dropChance: 1, pool: { shield: 1 }, placed: [] } });
    for (let seed = 1; seed <= 30; seed++) {
      const s = new GameSimulation({ levels: [lvl], activeSlots: [true], seed });
      s.harpoons.push({ id: 1, owner: 0, x: 200, tipY: 330 });
      s.step();
      expect(s.powerups.every((u) => u.type !== 'chaos')).toBe(true);
    }
  });

  it('the host switch turns chaos off completely', () => {
    const s = mk(3, { chaos: false });
    expect(s.chaosOn()).toBe(false);
    expect(chaosEv(grab(s, 0))[0].t).toBe('fizzle');
  });

  it('with the room switch on, multiplayer chaos is live', () => {
    for (const n of [2, 3, 4]) expect(mk(n).chaosOn()).toBe(true);
  });

  it('fizzles (harmlessly) if the only teammates are knocked out', () => {
    const s = mk(2);
    s.players[1].life = 'out';
    expect(chaosEv(grab(s, 0))[0].t).toBe('fizzle');
  });

  it('never targets a Lancer under respawn invulnerability', () => {
    const s = mk(2);
    s.players[1].invuln = 1;
    force(s, 'jam');
    expect(chaosEv(grab(s, 0))[0].t).toBe('fizzle');
    expect(s.players[1].fx).toBe(0);
  });

  it('never targets a Lancer with an orb right on top of them', () => {
    const s = mk(2, { bubbles: [{ size: 1, x: 760, y: 400, velocityX: 0 }] });
    s.players[1].x = 760;
    force(s, 'slow');
    expect(chaosEv(grab(s, 0))[0].t).toBe('fizzle');
  });

  it('at most one effect per target, and 6 s immunity once it ends', () => {
    const s = mk(2);
    force(s, 'jam');
    expect(chaosEv(grab(s, 0))[0]).toMatchObject({ t: 'jam', by: 0, to: 1 });
    expect(s.players[1].fx).toBe(idx('jam'));
    force(s, 'flip');
    expect(chaosEv(grab(s, 0))[0].t).toBe('fizzle'); // already affected
    for (let i = 0; i < (CHAOS.seconds.jam + 0.2) * TICK_RATE; i++) s.step();
    expect(s.players[1].fx).toBe(0);
    expect(s.players[1].fxImm).toBeGreaterThan(CHAOS.immunity - 0.5);
    force(s, 'flip');
    expect(chaosEv(grab(s, 0))[0].t).toBe('fizzle'); // immune
    for (let i = 0; i < (CHAOS.immunity + 0.3) * TICK_RATE; i++) s.step();
    expect(s.players[1].fxImm).toBe(0);
    force(s, 'flip');
    expect(chaosEv(grab(s, 0))[0]).toMatchObject({ t: 'flip', to: 1 });
  });

  it('the server picks the target, deterministically', () => {
    const run = (seed: number) => {
      const s = mk(4, { seed });
      const out: unknown[] = [];
      for (let i = 0; i < 12; i++) {
        out.push(chaosEv(grab(s, i % 4)));
        for (let t = 0; t < 8 * TICK_RATE; t++) s.step();
      }
      return JSON.stringify(out);
    };
    expect(run(3)).toBe(run(3));
    expect(run(3)).not.toBe(run(4));
  });

  it('chaos randomness uses its own stream', () => {
    const a = mk(2, { seed: 7 });
    const b = mk(2, { seed: 7 });
    grab(a, 0);
    expect(a.rng.next()).toBe(b.rng.next());
  });

  it('damage ends an effect', () => {
    const s = mk(2);
    force(s, 'slow');
    grab(s, 0);
    s.bubbles.push({ id: 900, size: 1, x: s.players[1].x, y: 455, vx: 0, vy: 0 });
    for (let i = 0; i < 3; i++) s.step();
    expect(s.players[1].fx).toBe(0);
  });
});

describe('chaos: effects', () => {
  it('Jam: the shot is lost for 1.2 s, then shooting works again', () => {
    const s = mk(2);
    force(s, 'jam');
    grab(s, 0);
    s.players[1].x = 300;
    s.setInput(1, INPUT.SHOOT, 1);
    expect(s.drainEvents().some((e) => e.k === 'shoot')).toBe(false);
    s.step();
    expect(s.drainEvents().some((e) => e.k === 'shoot')).toBe(false);
    expect(s.harpoons.filter((h) => h.owner === 1)).toHaveLength(0);
    for (let i = 0; i < 1.4 * TICK_RATE; i++) s.step();
    s.setInput(1, 0, 2);
    s.setInput(1, INPUT.SHOOT, 3);
    s.step();
    expect(s.drainEvents().some((e) => e.k === 'shoot')).toBe(true);
  });

  it('Flip: left and right are reversed for 0.8 s only', () => {
    const s = mk(2);
    force(s, 'flip');
    grab(s, 0);
    const x0 = s.players[1].x;
    s.setInput(1, INPUT.RIGHT, 1);
    for (let i = 0; i < 6; i++) s.step();
    expect(s.players[1].x).toBeLessThan(x0);
    for (let i = 0; i < CHAOS.seconds.flip * TICK_RATE; i++) s.step();
    const x1 = s.players[1].x;
    for (let i = 0; i < 6; i++) s.step();
    expect(s.players[1].x).toBeGreaterThan(x1);
  });

  it('Slow: 40% slower for 2.5 s', () => {
    const s = mk(2);
    force(s, 'slow');
    grab(s, 0);
    s.players[1].x = 300;
    s.setInput(1, INPUT.RIGHT, 1);
    for (let i = 0; i < 10; i++) s.step();
    const slowed = s.players[1].x - 300;
    const expected = PLAYER.speed * CHAOS.slowMul * (10 / TICK_RATE);
    expect(slowed).toBeCloseTo(expected, 0);
    for (let i = 0; i < CHAOS.seconds.slow * TICK_RATE; i++) s.step();
    expect(s.players[1].fx).toBe(0);
  });

  it('Tether: both Lancers stay within range, then it lets go', () => {
    const s = mk(2);
    s.players[0].x = 100;
    s.players[1].x = 300;
    force(s, 'tether');
    expect(chaosEv(grab(s, 0))[0]).toMatchObject({ t: 'tether', by: 0, to: 1 });
    expect(s.players[0].fx).toBe(idx('tether'));
    expect(s.players[1].fxP).toBe(0);
    s.setInput(1, INPUT.RIGHT, 1);
    for (let i = 0; i < 2 * TICK_RATE; i++) {
      s.step();
      expect(Math.abs(s.players[1].x - s.players[0].x)).toBeLessThanOrEqual(CHAOS.tetherRange + 1e-6);
    }
    expect(s.players[1].x).toBeCloseTo(100 + CHAOS.tetherRange, 0);
    for (let i = 0; i < CHAOS.seconds.tether * TICK_RATE; i++) s.step();
    expect(s.players[0].fx + s.players[1].fx).toBe(0);
    s.step();
    s.setInput(1, INPUT.RIGHT, 2);
    for (let i = 0; i < 30; i++) s.step();
    expect(s.players[1].x - s.players[0].x).toBeGreaterThan(CHAOS.tetherRange);
  });

  it('Tether ends if the partner is hurt, and a stretched pair can only close the gap', () => {
    const fx = moveFxOf(idx('tether'), 100);
    expect(movePlayerFx(500, INPUT.RIGHT, 1, fx)).toBe(500);
    expect(movePlayerFx(500, INPUT.LEFT, 1, fx)).toBeLessThan(500);
    const s = mk(2);
    s.players[0].x = 100;
    s.players[1].x = 300;
    force(s, 'tether');
    grab(s, 0);
    s.bubbles.push({ id: 901, size: 1, x: s.players[0].x, y: 455, vx: 0, vy: 0 });
    for (let i = 0; i < 4; i++) s.step();
    expect(s.players[1].fx).toBe(0);
    expect(s.players[1].fxP).toBe(-1);
  });

  it('Swap: positions trade, both get a short grace, the target gets immunity', () => {
    const s = mk(2);
    s.players[0].x = 150;
    s.players[1].x = 650;
    force(s, 'swap');
    const ev = chaosEv(grab(s, 0));
    expect(ev[0]).toMatchObject({ t: 'swap', by: 0, to: 1 });
    expect(s.players[0].x).toBe(650);
    expect(s.players[1].x).toBe(150);
    expect(s.players[0].invuln).toBeGreaterThan(CHAOS.swapGrace - 0.2);
    expect(s.players[1].invuln).toBeGreaterThan(CHAOS.swapGrace - 0.2);
    expect(s.players[1].fxImm).toBeGreaterThan(CHAOS.immunity - 0.5);
    expect(s.players[1].fx).toBe(0);
  });

  it('Swap fizzles if either position is next to an orb', () => {
    const s = mk(2, { bubbles: [{ size: 1, x: 150, y: 400, velocityX: 0 }] });
    s.players[0].x = 150;
    s.players[1].x = 650;
    force(s, 'swap');
    expect(chaosEv(grab(s, 0))[0].t).toBe('fizzle');
    expect(s.players[0].x).toBe(150);
  });

  it('a level reload clears effects', () => {
    const s = mk(2);
    force(s, 'slow');
    grab(s, 0);
    s.loadLevel(0);
    expect(s.players.every((p) => p.fx === 0 && p.fxImm === 0 && p.fxP === -1)).toBe(true);
  });
});

describe('chaos: network', () => {
  it('effects ride the snapshot (kind, time, partner)', () => {
    const m = new Match({ levels: [testLevel({ bubbles: far, timeLimit: 300 })], activeSlots: [true, true], seed: 1 });
    for (let i = 0; i < 100; i++) m.advance();
    m.sim.players[0].x = 100;
    m.sim.players[1].x = 300;
    force(m.sim, 'tether');
    grab(m.sim, 0);
    const snap = decodeSnapshot(JSON.parse(JSON.stringify(encodeSnapshot(m, []))));
    expect(snap.players[1]).toMatchObject({ fx: idx('tether'), fxP: 0 });
    expect(snap.players[1].fxT).toBeGreaterThan(2);
    expect(snap.players[0]).toMatchObject({ fx: idx('tether'), fxP: 1 });
  });

  it('client prediction applies the same effect as the server', () => {
    const fx = moveFxOf(idx('flip'), null);
    expect(movePlayerFx(400, INPUT.RIGHT, 1, fx)).toBeLessThan(400);
    expect(movePlayerFx(400, INPUT.LEFT, 1, fx)).toBeGreaterThan(400);
    expect(movePlayerFx(400, INPUT.RIGHT, 1, undefined)).toBeGreaterThan(400);
    expect(movePlayerFx(400, INPUT.RIGHT, 1, moveFxOf(idx('slow'), null))).toBeCloseTo(400 + PLAYER.speed * CHAOS.slowMul * (1 / TICK_RATE), 5);
  });

  it('the chaos message parses, strictly', () => {
    expect(parseClientMessage('{"t":"chaos","v":false}')).toEqual({ t: 'chaos', v: false });
    expect(parseClientMessage('{"t":"chaos","v":"no"}')).toBeNull();
    expect(parseClientMessage('{"t":"chaos"}')).toBeNull();
  });
});

class FakeConn implements Conn {
  sent: ServerMessage[] = [];
  send(data: string) {
    if (data.startsWith('{')) this.sent.push(JSON.parse(data));
  }
  close() {}
  room() {
    for (let i = this.sent.length - 1; i >= 0; i--) if (this.sent[i].t === 'room') return this.sent[i] as Extract<ServerMessage, { t: 'room' }>;
    return undefined;
  }
}
class FakeHost implements RoomHost {
  t = 1_000_000;
  loop = false;
  meta: RoomMeta | null = null;
  now = () => this.t;
  random = () => 0.5;
  startLoop = () => void (this.loop = true);
  stopLoop = () => void (this.loop = false);
  persist = (m: RoomMeta | null) => void (this.meta = m ? structuredClone(m) : null);
  setAlarm = () => {};
  log = () => {};
}

describe('chaos: host setting', () => {
  const setup = () => {
    const host = new FakeHost();
    const room = new RoomCore(host, null, [testLevel({ bubbles: far })]);
    room.init('ABC234');
    const a = new FakeConn();
    const b = new FakeConn();
    room.join(a, 'Ada', null);
    room.join(b, 'Bo', null);
    return { host, room, a, b };
  };
  const send = (room: RoomCore, c: FakeConn, msg: object) => room.onMessage(c, JSON.stringify(msg));

  it('is on by default and the room tells everyone who the host is', () => {
    const { a, b } = setup();
    expect(a.room()).toMatchObject({ chaos: true, host: 0 });
    expect(b.room()).toMatchObject({ chaos: true, host: 0 });
  });

  it('only the host can switch it, and everyone sees the change', () => {
    const { room, host, a, b } = setup();
    send(room, b, { t: 'chaos', v: false });
    expect(a.room()!.chaos).toBe(true);
    send(room, a, { t: 'chaos', v: false });
    expect(a.room()!.chaos).toBe(false);
    expect(b.room()!.chaos).toBe(false);
    expect(host.meta!.chaos).toBe(false);
  });

  it('a match starts with the host choice, and it cannot change mid-match', () => {
    const { room, a, b } = setup();
    send(room, a, { t: 'chaos', v: false });
    send(room, a, { t: 'ready', v: true });
    send(room, b, { t: 'ready', v: true });
    expect(room.match!.sim.chaosEnabled).toBe(false);
    send(room, a, { t: 'chaos', v: true });
    expect(room.roomInfo().chaos).toBe(false);
  });

  it('default match has chaos on', () => {
    const { room, a, b } = setup();
    send(room, a, { t: 'ready', v: true });
    send(room, b, { t: 'ready', v: true });
    expect(room.match!.sim.chaosEnabled).toBe(true);
    expect(room.match!.sim.chaosOn()).toBe(true);
    void TICK_MS;
  });

  it('the host is the lowest seated slot if the creator leaves', () => {
    const { room, a, b } = setup();
    send(room, a, { t: 'leave' });
    expect(room.roomInfo().host).toBe(1);
    send(room, b, { t: 'chaos', v: false });
    expect(room.roomInfo().chaos).toBe(false);
  });
});
