import { describe, expect, it } from 'vitest';
import {
  AwardTally,
  EMOTES,
  EMOTE_GAP_MS,
  GameSimulation,
  INPUT,
  LEVELS,
  SHOVE,
  TICK_RATE,
  WORLD,
  dailyChallenge,
  parseClientMessage,
  utcDay,
  type BubbleSpawn,
  type ServerMessage,
  type SimEvent,
} from '@orb/shared';
import { RoomCore, type Conn, type RoomHost, type RoomMeta } from '../worker/src/rooms/RoomCore';
import { testLevel } from './helpers';

const seats = (n: number) => Array.from({ length: 4 }, (_, i) => i < n);
const far: BubbleSpawn[] = [{ size: 3, x: 900, y: 100, velocityX: 0 }];
const mk = (n: number, opts: { shove?: boolean; bubbles?: BubbleSpawn[] } = {}) =>
  new GameSimulation({ levels: [testLevel({ bubbles: opts.bubbles ?? far, timeLimit: 300 })], activeSlots: seats(n), seed: 7, shove: opts.shove });
const steps = (s: GameSimulation, n: number) => {
  const ev: SimEvent[] = [];
  for (let i = 0; i < n; i++) {
    s.step();
    ev.push(...s.drainEvents());
  }
  return ev;
};
/** Put an orb right on top of a Lancer, made by `maker` (or by nobody). */
const orbOn = (s: GameSimulation, slot: number, maker?: number) =>
  s.bubbles.push({ id: 999, size: 0, x: s.players[slot].x, y: WORLD.height - 20, vx: 0, vy: 0, ...(maker !== undefined ? { lh: maker } : {}) });

describe('shove', () => {
  const touching = (s: GameSimulation) => {
    s.players[0].x = 400;
    s.players[1].x = 400 + SHOVE.range - 4;
  };

  it('is off by default: walking into a teammate does not move them', () => {
    const s = mk(2);
    touching(s);
    const x1 = s.players[1].x;
    s.setInput(0, INPUT.RIGHT, 1);
    steps(s, 10);
    expect(s.players[1].x).toBe(x1);
  });

  it('when on, walking into a teammate pushes them the same way and reports it', () => {
    const s = mk(2, { shove: true });
    touching(s);
    const x1 = s.players[1].x;
    s.setInput(0, INPUT.RIGHT, 1);
    const ev = steps(s, 10);
    expect(s.players[1].x).toBeGreaterThan(x1);
    expect(ev.filter((e) => e.k === 'shove')).toEqual([{ k: 'shove', p: 0, to: 1 }]);
  });

  it('does not push someone behind you', () => {
    const s = mk(2, { shove: true });
    touching(s);
    const x1 = s.players[1].x;
    s.setInput(0, INPUT.LEFT, 1);
    steps(s, 10);
    expect(s.players[1].x).toBe(x1);
  });

  it('a death right after a shove is the pusher\'s fault; later it is not', () => {
    const s = mk(2, { shove: true });
    touching(s);
    s.players[1].invuln = 0;
    s.setInput(0, INPUT.RIGHT, 1);
    steps(s, 3);
    s.setInput(0, 0, 2);
    s.players[0].invuln = 5; // the orb touches the pusher too
    orbOn(s, 1);
    const die = steps(s, 1).find((e) => e.k === 'die');
    expect(die).toMatchObject({ k: 'die', p: 1, c: 'orb', b: 0 });

    const t = mk(2, { shove: true });
    touching(t);
    t.setInput(0, INPUT.RIGHT, 1);
    steps(t, 3);
    t.setInput(0, 0, 2);
    steps(t, Math.ceil((SHOVE.blameSeconds + 0.2) * TICK_RATE));
    t.players[1].invuln = 0;
    t.players[0].invuln = 5;
    orbOn(t, 1);
    const late = steps(t, 1).find((e) => e.k === 'die');
    expect(late).toMatchObject({ k: 'die', p: 1, c: 'orb' });
    expect(late && 'b' in late ? late.b : undefined).toBeUndefined();
  });
});

describe('death blame', () => {
  it('children of a pop remember who split them', () => {
    const s = mk(2, { bubbles: [{ size: 2, x: 200, y: 300, velocityX: 0 }] });
    s.players[0].x = 200;
    s.setInput(0, INPUT.SHOOT, 1);
    const ev = steps(s, 30);
    expect(ev.some((e) => e.k === 'pop' && e.by === 0)).toBe(true);
    expect(s.bubbles.length).toBe(2);
    expect(s.bubbles.every((b) => b.lh === 0)).toBe(true);
  });

  it('an orb a teammate split gets them the blame, your own does not', () => {
    const s = mk(2);
    s.players[1].invuln = 0;
    orbOn(s, 1, 0);
    expect(steps(s, 1).find((e) => e.k === 'die')).toMatchObject({ p: 1, c: 'orb', b: 0 });

    const t = mk(2);
    t.players[1].invuln = 0;
    orbOn(t, 1, 1);
    const own = steps(t, 1).find((e) => e.k === 'die');
    expect(own && 'b' in own ? own.b : undefined).toBeUndefined();
  });

  it('time-up deaths say so', () => {
    const s = mk(2);
    s.applyTimeUpPenalty();
    const ev = s.drainEvents().filter((e) => e.k === 'die');
    expect(ev.length).toBe(2);
    expect(ev.every((e) => e.k === 'die' && e.c === 'time')).toBe(true);
  });
});

describe('awards', () => {
  it('names the most blamed, the most dead and the first to die, one award each', () => {
    const t = new AwardTally();
    const ev: SimEvent[] = [
      { k: 'die', p: 1, out: false, c: 'orb', b: 0 },
      { k: 'die', p: 1, out: false, c: 'orb', b: 0 },
      { k: 'die', p: 2, out: false, c: 'spikes' },
      { k: 'die', p: 1, out: true, c: 'bomb' },
      { k: 'pop', id: 1, s: 0, x: 0, y: 0, by: 2, pts: 10 },
      { k: 'clear', bonus: [] },
    ];
    ev.forEach((e) => t.add(e));
    const a = t.awards([0, 1, 2]);
    expect(a).toContainEqual({ kind: 'blamed', slot: 0, n: 2 });
    expect(a).toContainEqual({ kind: 'magnet', slot: 1, n: 3 });
    // Lancer 1 died first but already has an award; Lancer 2 popped the last orb.
    expect(a).toContainEqual({ kind: 'closer', slot: 2, n: 1 });
    expect(new Set(a.map((x) => x.slot)).size).toBe(a.length);
    expect(t.lastDeath).toEqual({ p: 1, c: 'bomb', b: undefined });
    expect(t.blames.length).toBe(2);
  });

  it('ties win nothing, and solo runs get no awards', () => {
    const t = new AwardTally();
    t.add({ k: 'pop', id: 1, s: 0, x: 0, y: 0, by: 0, pts: 10 });
    t.add({ k: 'pop', id: 2, s: 0, x: 0, y: 0, by: 1, pts: 10 });
    expect(t.awards([0, 1]).find((a) => a.kind === 'sniper')).toBeUndefined();
    expect(t.awards([0])).toEqual([]);
  });

  it('counts chaos curses and rescue flares', () => {
    const t = new AwardTally();
    t.add({ k: 'chaos', t: 'flip', by: 0, to: 1 });
    t.add({ k: 'chaos', t: 'end', by: -1, to: 1 });
    t.add({ k: 'pickup', p: 1, type: 'flare', x: 0, y: 0 });
    const a = t.awards([0, 1]);
    expect(a).toContainEqual({ kind: 'troll', slot: 0, n: 1 });
    expect(a).toContainEqual({ kind: 'hero', slot: 1, n: 1 });
  });
});

describe('daily level', () => {
  it('is the same for the same day, skips the teaching levels, and has a seed', () => {
    const a = dailyChallenge('2026-10-04', LEVELS.length);
    expect(dailyChallenge('2026-10-04', LEVELS.length)).toEqual(a);
    expect(a.level).toBeGreaterThanOrEqual(5);
    expect(a.level).toBeLessThan(LEVELS.length);
    const days = Array.from({ length: 30 }, (_, i) => dailyChallenge(`2026-11-${String(i + 1).padStart(2, '0')}`, LEVELS.length).level);
    expect(new Set(days).size).toBeGreaterThan(5);
    expect(utcDay(new Date('2026-10-04T23:30:00Z'))).toBe('2026-10-04');
  });
});

class FakeConn implements Conn {
  sent: ServerMessage[] = [];
  send(data: string) {
    if (data.startsWith('{')) this.sent.push(JSON.parse(data));
  }
  close() {}
  last<T extends ServerMessage['t']>(t: T) {
    for (let i = this.sent.length - 1; i >= 0; i--) if (this.sent[i].t === t) return this.sent[i] as Extract<ServerMessage, { t: T }>;
    return undefined;
  }
}
class FakeHost implements RoomHost {
  t = 1_000_000;
  meta: RoomMeta | null = null;
  now = () => this.t;
  random = () => 0.5;
  startLoop = () => {};
  stopLoop = () => {};
  persist = (m: RoomMeta | null) => void (this.meta = m ? structuredClone(m) : null);
  setAlarm = () => {};
  log = () => {};
}

describe('room: shove switch and emotes', () => {
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

  it('messages parse strictly', () => {
    expect(parseClientMessage('{"t":"shove","v":true}')).toEqual({ t: 'shove', v: true });
    expect(parseClientMessage('{"t":"shove","v":1}')).toBeNull();
    expect(parseClientMessage('{"t":"emo","v":3}')).toEqual({ t: 'emo', v: 3 });
    expect(parseClientMessage(`{"t":"emo","v":${EMOTES.length}}`)).toBeNull();
    expect(parseClientMessage('{"t":"emo","v":-1}')).toBeNull();
  });

  it('shove is off by default, host only, and reaches the match', () => {
    const { room, a, b } = setup();
    expect(a.last('room')!.shove).toBe(false);
    send(room, b, { t: 'shove', v: true });
    expect(room.roomInfo().shove).toBe(false);
    send(room, a, { t: 'shove', v: true });
    expect(b.last('room')!.shove).toBe(true);
    send(room, a, { t: 'ready', v: true });
    send(room, b, { t: 'ready', v: true });
    expect(room.match!.sim.shoveEnabled).toBe(true);
  });

  it('emotes reach everyone, with a rate limit per player', () => {
    const { room, host, a, b } = setup();
    send(room, a, { t: 'emo', v: 2 });
    expect(b.last('emo')).toEqual({ t: 'emo', s: 0, v: 2 });
    b.sent = [];
    send(room, a, { t: 'emo', v: 1 });
    expect(b.last('emo')).toBeUndefined();
    host.t += EMOTE_GAP_MS;
    send(room, a, { t: 'emo', v: 1 });
    expect(b.last('emo')).toEqual({ t: 'emo', s: 0, v: 1 });
  });
});
