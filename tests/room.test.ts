import { beforeEach, describe, expect, it } from 'vitest';
import { CLOSE_CODES, MATCH, ROOM, TICK_MS, TICK_RATE, decodeSnapshot, type ServerMessage, type SnapMessage } from '@orb/shared';
import { RoomCore, type Conn, type RoomHost, type RoomMeta } from '../worker/src/rooms/RoomCore';
import { testLevel } from './helpers';

class FakeConn implements Conn {
  sent: ServerMessage[] = [];
  raw: string[] = [];
  closed: { code?: number; reason?: string } | null = null;
  send(data: string) {
    this.raw.push(data);
    if (data.startsWith('{')) this.sent.push(JSON.parse(data));
  }
  close(code?: number, reason?: string) {
    this.closed = { code, reason };
  }
  last<T extends ServerMessage['t']>(t: T): Extract<ServerMessage, { t: T }> | undefined {
    for (let i = this.sent.length - 1; i >= 0; i--) if (this.sent[i].t === t) return this.sent[i] as never;
    return undefined;
  }
  lastSnap() {
    const m = this.last('snap');
    return m ? decodeSnapshot(m as SnapMessage) : undefined;
  }
}

class FakeHost implements RoomHost {
  t = 1_000_000;
  loop = false;
  meta: RoomMeta | null = null;
  alarmAt: number | null = null;
  now = () => this.t;
  random = () => 0.5;
  startLoop = () => void (this.loop = true);
  stopLoop = () => void (this.loop = false);
  persist = (m: RoomMeta | null) => void (this.meta = m ? structuredClone(m) : null);
  setAlarm = (at: number | null) => void (this.alarmAt = at);
  log = () => {};
}

const levels = [
  testLevel({ id: 'l1', bubbles: [{ size: 3, x: 800, y: 100, velocityX: 0 }] }),
  testLevel({ id: 'l2' }),
];

function ticks(room: RoomCore, host: FakeHost, n: number) {
  for (let i = 0; i < n; i++) {
    host.t += TICK_MS;
    if (host.loop) room.tick();
  }
}

function send(room: RoomCore, c: FakeConn, msg: object) {
  room.onMessage(c, JSON.stringify(msg));
}

describe('RoomCore', () => {
  let host: FakeHost;
  let room: RoomCore;
  let a: FakeConn;
  let b: FakeConn;

  beforeEach(() => {
    host = new FakeHost();
    room = new RoomCore(host, null, levels);
    a = new FakeConn();
    b = new FakeConn();
  });

  const startMatch = () => {
    room.init('ABC234');
    room.join(a, 'Ada', null);
    room.join(b, 'Bo', null);
    send(room, a, { t: 'ready', v: true });
    send(room, b, { t: 'ready', v: true });
  };

  it('rejects joins to rooms that were never created', () => {
    const r = room.join(a, 'x', null);
    expect(r).toEqual({ ok: false, code: 'ROOM_NOT_FOUND' });
    expect(a.closed?.code).toBe(CLOSE_CODES.ROOM_NOT_FOUND);
  });

  it('init is collision-checked', () => {
    expect(room.init('ABC234')).toBe('ok');
    expect(room.init('ABC234')).toBe('exists');
    expect(host.meta?.code).toBe('ABC234');
  });

  it('seats up to four players and rejects a fifth with ROOM_FULL', () => {
    room.init('ABC234');
    expect(room.join(a, 'Ada', null)).toMatchObject({ ok: true, slot: 0 });
    expect(a.last('room')?.phase).toBe('WAITING_FOR_PLAYER');
    expect(room.join(b, 'Bo<b>', null)).toMatchObject({ ok: true, slot: 1 });
    expect(a.last('room')?.phase).toBe('PLAYER_JOINED');
    expect(a.last('room')?.seats[1]?.name).toBe('Bob');
    expect(room.join(new FakeConn(), 'Cy', null)).toMatchObject({ ok: true, slot: 2 });
    expect(room.join(new FakeConn(), 'Di', null)).toMatchObject({ ok: true, slot: 3 });
    const e = new FakeConn();
    expect(room.join(e, 'Ed', null)).toEqual({ ok: false, code: 'ROOM_FULL' });
    expect(e.last('error')?.code).toBe('ROOM_FULL');
    expect(e.closed?.code).toBe(CLOSE_CODES.ROOM_FULL);
    expect(room.status()).toMatchObject({ exists: true, players: 4, full: true });
  });

  it('four players: match starts only when all seated players are ready', () => {
    room.init('ABC234');
    const cs = [a, b, new FakeConn(), new FakeConn()];
    cs.forEach((c, i) => room.join(c, `P${i}`, null));
    cs.slice(0, 3).forEach((c) => send(room, c, { t: 'ready', v: true }));
    expect(room.match).toBeNull();
    send(room, cs[3], { t: 'ready', v: true });
    expect(room.match!.sim.players.filter((p) => p.active)).toHaveLength(4);
    ticks(room, host, MATCH.countdownSeconds * TICK_RATE + 1);
    send(room, cs[3], { t: 'in', s: 1, b: 1 });
    ticks(room, host, 10);
    expect(cs[0].lastSnap()!.players).toHaveLength(4);
    expect(new Set(cs.map((c) => c.lastSnap()!.tick)).size).toBe(1);
    const xs = room.match!.sim.players.map((p) => Math.round(p.x));
    expect(new Set(xs).size).toBe(4); // distinct spawns
  });

  it('both ready → countdown → playing, with level + snapshots to both', () => {
    startMatch();
    expect(host.loop).toBe(true);
    expect(a.last('level')?.cfg.id).toBe('l1');
    expect(b.last('level')?.cfg.id).toBe('l1');
    expect(a.last('room')?.phase).toBe('COUNTDOWN');
    ticks(room, host, MATCH.countdownSeconds * TICK_RATE + 2);
    expect(a.last('room')?.phase).toBe('PLAYING');
    expect(a.lastSnap()?.phase).toBe('playing');
    expect(b.lastSnap()?.tick).toBe(a.lastSnap()?.tick);
  });

  it('applies inputs authoritatively and broadcasts positions to both players', () => {
    startMatch();
    ticks(room, host, MATCH.countdownSeconds * TICK_RATE + 1);
    const x0 = a.lastSnap()!.players[0].x;
    const y0 = a.lastSnap()!.players[1].x;
    send(room, a, { t: 'in', s: 1, b: 2 }); // right
    send(room, b, { t: 'in', s: 1, b: 1 }); // left
    ticks(room, host, 20);
    const snapB = b.lastSnap()!;
    expect(snapB.players[0].x).toBeGreaterThan(x0 + 50);
    expect(snapB.players[1].x).toBeLessThan(y0 - 50);
    expect(snapB.players[0].lastSeq).toBe(1);
  });

  it('drops duplicate / replayed input sequence numbers', () => {
    startMatch();
    ticks(room, host, MATCH.countdownSeconds * TICK_RATE + 1);
    send(room, a, { t: 'in', s: 5, b: 2 });
    send(room, a, { t: 'in', s: 5, b: 1 });
    send(room, a, { t: 'in', s: 3, b: 1 });
    ticks(room, host, 4);
    expect(room.match!.sim.players[0].input).toBe(2);
  });

  it('ignores client attempts to send results instead of inputs', () => {
    startMatch();
    ticks(room, host, MATCH.countdownSeconds * TICK_RATE + 1);
    room.onMessage(a, JSON.stringify({ t: 'score', v: 1e9 }));
    room.onMessage(a, JSON.stringify({ t: 'pop', id: 1 }));
    room.onMessage(a, 'garbage');
    ticks(room, host, 2);
    expect(room.match!.sim.players[0].score).toBe(0);
    expect(room.match!.sim.bubbles).toHaveLength(1);
  });

  it('disconnect pauses the match, shows grace, and reconnect with token resumes', () => {
    startMatch();
    ticks(room, host, MATCH.countdownSeconds * TICK_RATE + 1);
    const tokenB = (b.sent.find((m) => m.t === 'welcome') as Extract<ServerMessage, { t: 'welcome' }>).token;
    room.onClose(b);
    const info = a.last('room')!;
    expect(info.phase).toBe('PAUSED');
    expect(info.pause).toEqual({ by: 1, reason: 'disconnect' });
    expect(info.seats[1]?.connected).toBe(false);
    expect(info.grace?.slot).toBe(1);
    // resume is refused while the partner is missing
    send(room, a, { t: 'resume' });
    expect(room.match!.phase).toBe('paused');

    const b2 = new FakeConn();
    expect(room.join(b2, 'ignored', tokenB)).toMatchObject({ ok: true, slot: 1 });
    expect(b2.last('level')).toBeDefined();
    expect(b2.lastSnap()).toBeDefined();
    expect(room.match!.phase).toBe('countdown');
    expect(a.last('room')?.seats[1]?.connected).toBe(true);
    expect(a.last('room')?.seats[1]?.name).toBe('Bo');
  });

  it('a partner who dropped during level-complete pauses the next level instead of being left exposed', () => {
    startMatch();
    ticks(room, host, MATCH.countdownSeconds * TICK_RATE + 1);
    room.match!.sim.bubbles = []; // clear the level
    ticks(room, host, 2);
    expect(room.match!.phase).toBe('levelComplete');
    room.onClose(b);
    expect(room.match!.phase).toBe('levelComplete'); // nothing to pause yet
    ticks(room, host, MATCH.levelCompleteSeconds * TICK_RATE + 2);
    expect(room.match!.phase).toBe('paused');
    expect(room.match!.pauseReason).toBe('disconnect');
    expect(a.last('room')?.phase).toBe('PAUSED');
  });

  it('a newer tab with the same token replaces the old socket', () => {
    room.init('ABC234');
    room.join(a, 'Ada', null);
    const token = (a.sent[0] as Extract<ServerMessage, { t: 'welcome' }>).token;
    const a2 = new FakeConn();
    room.join(a2, 'Ada', token);
    expect(a.closed?.code).toBe(CLOSE_CODES.REPLACED);
    expect(room.status().players).toBe(1);
  });

  it('continue solo drops the missing partner and resumes', () => {
    startMatch();
    ticks(room, host, MATCH.countdownSeconds * TICK_RATE + 1);
    room.onClose(b);
    send(room, a, { t: 'solo' });
    expect(room.match!.sim.players[1].active).toBe(false);
    expect(room.match!.phase).toBe('countdown');
    ticks(room, host, MATCH.countdownSeconds * TICK_RATE + 1);
    expect(room.match!.phase).toBe('playing');
  });

  it('grace expiry frees the seat and auto-continues solo', () => {
    startMatch();
    ticks(room, host, MATCH.countdownSeconds * TICK_RATE + 1);
    room.onClose(b);
    host.t += ROOM.disconnectGraceSeconds * 1000 + 10;
    room.tick();
    expect(room.seats[1]).toBeNull();
    expect(room.match!.sim.players[1].active).toBe(false);
    expect(room.match!.phase).toBe('countdown');
    // a new partner can now take the free seat and drop in
    const c = new FakeConn();
    expect(room.join(c, 'Cy', null)).toMatchObject({ ok: true, slot: 1 });
    expect(room.match!.sim.players[1].active).toBe(true);
    expect(room.match!.sim.players[1].score).toBe(0);
  });

  it('return to lobby ends the match', () => {
    startMatch();
    send(room, a, { t: 'lobby' });
    expect(room.match).toBeNull();
    expect(host.loop).toBe(false);
    expect(b.last('room')?.phase).toBe('PLAYER_JOINED');
  });

  it('leave frees the seat and notifies the partner', () => {
    room.init('ABC234');
    room.join(a, 'Ada', null);
    room.join(b, 'Bo', null);
    send(room, b, { t: 'leave' });
    expect(b.closed?.code).toBe(CLOSE_CODES.LEFT);
    expect(a.last('room')?.phase).toBe('WAITING_FOR_PLAYER');
    expect(a.last('room')?.seats[1]).toBeNull();
  });

  it('rematch after game over starts a new match when both vote', () => {
    startMatch();
    ticks(room, host, MATCH.countdownSeconds * TICK_RATE + 1);
    for (const p of room.match!.sim.players) {
      p.lives = 1;
      p.x = 800;
    }
    ticks(room, host, 60);
    expect(room.match!.phase).toBe('gameOver');
    expect(a.last('room')?.phase).toBe('GAME_OVER');
    // results stay in memory (no hibernation) while players decide
    expect(host.loop).toBe(true);
    send(room, a, { t: 'rematch' });
    expect(b.last('room')?.seats[0]?.rematch).toBe(true);
    expect(room.match!.phase).toBe('gameOver'); // one vote is not enough
    send(room, b, { t: 'rematch' });
    expect(room.match!.phase).toBe('countdown');
    expect(room.match!.sim.players[0].lives).toBe(3);
    expect(host.loop).toBe(true);
  });

  it('stops the loop after the results hold period so the room can hibernate', () => {
    startMatch();
    ticks(room, host, MATCH.countdownSeconds * TICK_RATE + 1);
    for (const p of room.match!.sim.players) {
      p.lives = 1;
      p.x = 800;
    }
    ticks(room, host, 60);
    expect(room.match!.phase).toBe('gameOver');
    const sent = a.sent.length;
    ticks(room, host, 30);
    expect(a.sent.length).toBe(sent); // nothing is broadcast on the results screen
    ticks(room, host, ROOM.terminalHoldSeconds * TICK_RATE + 5);
    expect(host.loop).toBe(false);
  });

  it('regression: stale persisted ready flags never start a match after hibernation', () => {
    startMatch(); // both were ready in the lobby → persisted
    const tokens = [a, b].map((c) => (c.sent.find((m) => m.t === 'welcome') as Extract<ServerMessage, { t: 'welcome' }>).token);
    // Durable Object hibernates and wakes with only the stored record.
    const woke = new RoomCore(host, host.meta, levels);
    expect(woke.seats.filter(Boolean).every((s) => !s!.ready)).toBe(true);
    woke.restore(a, 0, tokens[0]);
    woke.restore(b, 1, tokens[1]);
    woke.onMessage(a, JSON.stringify({ t: 'rematch' }));
    expect(woke.match).toBeNull(); // only one player asked
    woke.onMessage(b, JSON.stringify({ t: 'rematch' }));
    expect(woke.match).not.toBeNull();
  });

  it('pause by a player freezes both; either can resume', () => {
    startMatch();
    ticks(room, host, MATCH.countdownSeconds * TICK_RATE + 1);
    send(room, a, { t: 'pause' });
    expect(b.last('room')?.phase).toBe('PAUSED');
    expect(b.last('room')?.pause).toEqual({ by: 0, reason: 'player' });
    send(room, b, { t: 'resume' });
    expect(a.last('room')?.phase).toBe('COUNTDOWN');
  });

  it('rate-limits floods and kicks abusive sockets', () => {
    room.init('ABC234');
    room.join(a, 'Ada', null);
    for (let i = 0; i < ROOM.kickMessagesPerSecond + 5; i++) room.onMessage(a, '{"t":"ready","v":false}');
    expect(a.closed?.code).toBe(CLOSE_CODES.RATE_LIMIT);
  });

  it('expires unjoined and empty rooms, leaving a tombstone', () => {
    room.init('ABC234');
    host.t += ROOM.unjoinedRoomTtlSeconds * 1000 + 1;
    room.alarm();
    expect(room.status()).toMatchObject({ exists: false, expired: true });
    const c = new FakeConn();
    expect(room.join(c, 'x', null)).toEqual({ ok: false, code: 'ROOM_EXPIRED' });
    host.t += ROOM.tombstoneTtlSeconds * 1000 + 1;
    room.alarm();
    expect(host.meta).toBeNull();
    // code can be reused after the tombstone is gone
    expect(room.init('ABC234')).toBe('ok');
  });

  it('empty room is cleaned up after everyone disconnects', () => {
    room.init('ABC234');
    room.join(a, 'Ada', null);
    room.onClose(a);
    expect(host.alarmAt).not.toBeNull();
    host.t += ROOM.emptyRoomTtlSeconds * 1000 + 1;
    room.alarm();
    host.t += ROOM.emptyRoomTtlSeconds * 1000 + 1;
    room.alarm();
    expect(room.status().expired).toBe(true);
  });

  it('survives hibernation: rebuilds seats from persisted meta', () => {
    room.init('ABC234');
    room.join(a, 'Ada', null);
    const token = (a.sent[0] as Extract<ServerMessage, { t: 'welcome' }>).token;
    const revived = new RoomCore(host, host.meta, levels);
    expect(revived.restore(a, 0, token)).toBe(true);
    expect(revived.restore(a, 0, 'forged')).toBe(false);
    expect(revived.status()).toMatchObject({ exists: true, players: 1 });
  });

  it('multiple rooms are fully independent', () => {
    const h2 = new FakeHost();
    const room2 = new RoomCore(h2, null, levels);
    room.init('AAAAAA');
    room2.init('BBBBBB');
    startMatchOn(room, a, b);
    const c = new FakeConn();
    room2.join(c, 'Cy', null);
    expect(room2.status()).toMatchObject({ players: 1, inMatch: false });
    expect(room.status()).toMatchObject({ players: 2, inMatch: true });
  });
});

function startMatchOn(room: RoomCore, a: FakeConn, b: FakeConn) {
  room.join(a, 'Ada', null);
  room.join(b, 'Bo', null);
  send(room, a, { t: 'ready', v: true });
  send(room, b, { t: 'ready', v: true });
}
