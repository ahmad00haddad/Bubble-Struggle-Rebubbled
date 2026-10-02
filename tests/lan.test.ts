import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INPUT, MATCH, ROOM, TICK_MS, TICK_RATE, parseClientMessage, decodeSnapshot, type ServerMessage, type SnapMessage } from '@orb/shared';
import { LanHost } from '../client/src/lan/LanHost';
import { LoopLink, RtcGuestLink } from '../client/src/lan/links';
import { RoomCore, type Conn, type RoomHost, type RoomMeta } from '../worker/src/rooms/RoomCore';
import { testLevel } from './helpers';

/** Just enough of RTCDataChannel for the code under test. */
class FakeChannel {
  readyState: 'connecting' | 'open' | 'closed' = 'open';
  sent: string[] = [];
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.readyState = 'closed';
    this.onclose?.();
  }
  /** Something arrives from the other side. */
  receive(d: unknown) {
    this.onmessage?.({ data: d });
  }
  json(): ServerMessage[] {
    return this.sent.filter((s) => s.startsWith('{')).map((s) => JSON.parse(s));
  }
}
const asDc = (c: FakeChannel) => c as unknown as RTCDataChannel;

describe('LAN signaling relay (online room)', () => {
  class Wire implements Conn {
    got: ServerMessage[] = [];
    send(d: string) {
      if (d.startsWith('{')) this.got.push(JSON.parse(d));
    }
    close() {}
  }
  class H implements RoomHost {
    t = 1_000_000;
    now = () => this.t;
    random = () => 0.5;
    startLoop = () => {};
    stopLoop = () => {};
    persist = (_m: RoomMeta | null) => {};
    setAlarm = () => {};
    log = () => {};
  }

  it('passes an rtc message to the target seat, stamped with the sender', () => {
    const room = new RoomCore(new H(), null, [testLevel()]);
    room.init('ABC234');
    const a = new Wire();
    const b = new Wire();
    room.join(a, 'Ada', null);
    room.join(b, 'Bo', null);
    room.onMessage(a, JSON.stringify({ t: 'rtc', to: 1, d: '{"k":"offer"}' }));
    expect(b.got.find((m) => m.t === 'rtc')).toEqual({ t: 'rtc', from: 0, d: '{"k":"offer"}' });
    expect(a.got.some((m) => m.t === 'rtc')).toBe(false);
  });

  it('ignores messages to yourself, to empty seats and to dead sockets', () => {
    const room = new RoomCore(new H(), null, [testLevel()]);
    room.init('ABC234');
    const a = new Wire();
    room.join(a, 'Ada', null);
    room.onMessage(a, JSON.stringify({ t: 'rtc', to: 0, d: 'x' }));
    room.onMessage(a, JSON.stringify({ t: 'rtc', to: 3, d: 'x' }));
    expect(a.got.some((m) => m.t === 'rtc')).toBe(false);
  });

  it('is strictly validated and fits a full session description', () => {
    expect(parseClientMessage(JSON.stringify({ t: 'rtc', to: 1, d: 'x'.repeat(3000) }))).not.toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'rtc', to: 4, d: 'x' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'rtc', to: -1, d: 'x' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'rtc', to: 1, d: '' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'rtc', to: 1, d: 5 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'rtc', to: 1, d: 'x'.repeat(3700) }))).toBeNull();
    expect(ROOM.maxMessageBytes).toBeGreaterThanOrEqual(4096);
  });
});

describe('LanHost (the match runs in the host tab)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date', 'performance', 'queueMicrotask'] });
  });
  afterEach(() => vi.useRealTimers());

  function start() {
    const lan = new LanHost('ABC234');
    lan.expected = 1;
    const hostFrames: ServerMessage[] = [];
    const link = new LoopLink(lan, 'Host');
    link.onMessage = (m) => hostFrames.push(m);
    link.connect();
    const dc = new FakeChannel();
    return { lan, link, dc, hostFrames };
  }

  it('seats the host and a guest, then starts when everyone is ready', async () => {
    const { lan, link, dc, hostFrames } = start();
    await vi.advanceTimersByTimeAsync(5);
    expect(hostFrames.find((m) => m.t === 'welcome')).toMatchObject({ slot: 0 });

    expect(lan.attachPeer(asDc(dc), 'Friend')).toBe(true);
    expect(dc.json().find((m) => m.t === 'welcome')).toMatchObject({ slot: 1, code: 'ABC234' });

    // The host only readies once every guest is in (the coordinator does this via onAllJoined).
    let all = false;
    lan.onAllJoined = () => (all = true);
    dc.receive(JSON.stringify({ t: 'ready', v: true }));
    link.send({ t: 'ready', v: true });
    expect(lan.core.match).not.toBeNull();
    await vi.advanceTimersByTimeAsync(MATCH.countdownSeconds * 1000 + 200);
    expect(lan.core.match!.phase).toBe('playing');
    expect(all).toBe(false); // attachPeer already counted its guest before we set the callback
  });

  it('fires onAllJoined once every expected guest has joined', () => {
    const { lan } = start();
    let fired = 0;
    lan.onAllJoined = () => fired++;
    lan.attachPeer(asDc(new FakeChannel()), 'One');
    expect(fired).toBe(1);
  });

  it('streams snapshots to the guest and applies the guest inputs', async () => {
    const { lan, link, dc } = start();
    lan.attachPeer(asDc(dc), 'Friend');
    dc.receive(JSON.stringify({ t: 'ready', v: true }));
    link.send({ t: 'ready', v: true });
    await vi.advanceTimersByTimeAsync(MATCH.countdownSeconds * 1000 + 300);
    const x0 = lan.core.match!.sim.players[1].x;
    dc.receive(JSON.stringify({ t: 'in', s: 1, b: INPUT.RIGHT }));
    await vi.advanceTimersByTimeAsync(500);
    expect(lan.core.match!.sim.players[1].x).toBeGreaterThan(x0 + 20);
    const snaps = dc.json().filter((m) => m.t === 'snap') as SnapMessage[];
    expect(snaps.length).toBeGreaterThan(10);
    const last = decodeSnapshot(snaps[snaps.length - 1]);
    expect(last.phase).toBe('playing');
    expect(last.players).toHaveLength(4);
    // 30 Hz: about one snapshot per tick while live.
    const live = snaps.filter((s) => s.ph === 1).length;
    expect(live).toBeGreaterThan(0.6 * TICK_RATE * 0.5);
  });

  it('answers ping with pong so the guest can show its ping', async () => {
    const { lan, dc } = start();
    lan.attachPeer(asDc(dc), 'Friend');
    dc.receive('ping');
    expect(dc.sent).toContain('pong');
  });

  it('closing the host closes every friend and stops the loop', async () => {
    const { lan, link, dc } = start();
    lan.attachPeer(asDc(dc), 'Friend');
    dc.receive(JSON.stringify({ t: 'ready', v: true }));
    link.send({ t: 'ready', v: true });
    await vi.advanceTimersByTimeAsync(1000);
    link.close();
    expect(dc.readyState).toBe('closed');
    const before = dc.sent.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(dc.sent.length).toBe(before);
  });

  it('a guest disconnecting is handled like any dropped player', async () => {
    const { lan, link, dc } = start();
    lan.attachPeer(asDc(dc), 'Friend');
    dc.receive(JSON.stringify({ t: 'ready', v: true }));
    link.send({ t: 'ready', v: true });
    await vi.advanceTimersByTimeAsync(MATCH.countdownSeconds * 1000 + 300);
    dc.close();
    expect(lan.core.seats[1]?.conn).toBeNull();
    expect(lan.core.match).not.toBeNull();
  });

  it('a fifth seat is refused through the same admission rules as online', () => {
    const lan = new LanHost('ABC234');
    lan.attachLocal(() => {}, 'Host');
    for (let i = 0; i < 3; i++) expect(lan.attachPeer(asDc(new FakeChannel()), `P${i}`)).toBe(true);
    const extra = new FakeChannel();
    expect(lan.attachPeer(asDc(extra), 'Extra')).toBe(false);
    expect(extra.json().some((m) => m.t === 'error' && m.code === 'ROOM_FULL')).toBe(true);
  });
});

describe('RtcGuestLink (the friend side)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date', 'performance'] });
  });
  afterEach(() => vi.useRealTimers());

  it('says hello when the channel opens, parses frames, measures ping, reports a drop', async () => {
    const dc = new FakeChannel();
    const link = new RtcGuestLink(asDc(dc), 'Friend');
    const got: ServerMessage[] = [];
    const states: string[] = [];
    link.onMessage = (m) => got.push(m);
    link.onStatus = (s) => states.push(s);
    link.connect();
    expect(JSON.parse(dc.sent[0])).toEqual({ t: 'hello', name: 'Friend' });
    expect(dc.sent).toContain('ping');
    await vi.advanceTimersByTimeAsync(7);
    dc.receive('pong');
    expect(link.rttMs).toBeGreaterThanOrEqual(0);
    dc.receive(JSON.stringify({ t: 'welcome', slot: 1, token: 't', code: 'ABC234' }));
    expect(got[0]).toMatchObject({ t: 'welcome', slot: 1 });
    link.send({ t: 'ready', v: true });
    expect(JSON.parse(dc.sent[dc.sent.length - 1])).toEqual({ t: 'ready', v: true });
    dc.close();
    expect(states).toEqual(['open', 'closed']);
    expect(link.isFatal).toBe(true);
  });

  it('keeps its tick rate: the host loop uses the same fixed step as the server', () => {
    expect(TICK_MS).toBeCloseTo(1000 / 30, 5);
  });
});
