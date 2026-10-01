import { describe, expect, it } from 'vitest';
import {
  LEVELS,
  Match,
  ROOM_CODE_ALPHABET,
  decodeSnapshot,
  encodeSnapshot,
  generateRoomCode,
  normalizeRoomCode,
  parseClientMessage,
  sanitizeNickname,
  validateLevel,
} from '@orb/shared';

describe('room codes', () => {
  it('generates valid 6-char codes from the unambiguous alphabet', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const c = generateRoomCode();
      expect(c).toMatch(/^[A-Z2-9]{6}$/);
      for (const ch of c) expect(ROOM_CODE_ALPHABET).toContain(ch);
      expect(normalizeRoomCode(c)).toBe(c);
      seen.add(c);
    }
    expect(seen.size).toBeGreaterThan(1990);
  });

  it('is case-insensitive and tolerant of spaces/dashes', () => {
    expect(normalizeRoomCode(' abc-234 ')).toBe('ABC234');
    expect(normalizeRoomCode('abc 234')).toBe('ABC234');
  });

  it('rejects invalid codes', () => {
    for (const bad of ['', 'ABC12', 'ABCDEFG', 'ABCD0O', 'ABC12I', '<script>', 42, null]) {
      expect(normalizeRoomCode(bad)).toBeNull();
    }
  });
});

describe('nicknames', () => {
  it('sanitizes and limits length', () => {
    expect(sanitizeNickname('  Ada  Lovelace!!! the great ')).toBe('Ada Lovelace');
    expect(sanitizeNickname('<img src=x>')).toBe('img srcx');
    expect(sanitizeNickname('')).toBe('Lancer');
    expect(sanitizeNickname(undefined, 'P2')).toBe('P2');
  });
});

describe('client message parsing', () => {
  it('accepts valid messages', () => {
    expect(parseClientMessage('{"t":"in","s":5,"b":3}')).toEqual({ t: 'in', s: 5, b: 3 });
    expect(parseClientMessage('{"t":"ready","v":true}')).toEqual({ t: 'ready', v: true });
    expect(parseClientMessage('{"t":"pause"}')).toEqual({ t: 'pause' });
    expect(parseClientMessage('{"t":"ping","c":12.5}')).toEqual({ t: 'ping', c: 12.5 });
  });

  it('rejects malformed or cheating messages', () => {
    const bad = [
      'nope',
      '[]',
      '{"t":"in","s":0,"b":1}',
      '{"t":"in","s":1,"b":8}',
      '{"t":"in","s":1.5,"b":1}',
      '{"t":"in","s":"1","b":1}',
      '{"t":"score","v":99999}',
      '{"t":"pop","id":3}',
      '{"t":"ready","v":"yes"}',
      'x'.repeat(5000),
      42,
    ];
    for (const b of bad) expect(parseClientMessage(b)).toBeNull();
  });
});

describe('snapshot codec', () => {
  it('round-trips the authoritative state compactly', () => {
    const m = new Match({ levels: LEVELS, activeSlots: [true, true], seed: 7 });
    for (let i = 0; i < 150; i++) m.advance();
    const msg = encodeSnapshot(m, m.drainEvents());
    const json = JSON.stringify(msg);
    expect(json.length).toBeLessThan(1200);
    const snap = decodeSnapshot(JSON.parse(json));
    expect(snap.tick).toBe(m.tick);
    expect(snap.phase).toBe(m.phase);
    expect(snap.players).toHaveLength(2);
    expect(snap.players[0].x).toBeCloseTo(m.sim.players[0].x, 1);
    expect(snap.bubbles.map((b) => b.id)).toEqual(m.sim.bubbles.map((b) => b.id));
    expect(snap.bubbles[0].y).toBeCloseTo(m.sim.bubbles[0].y, 1);
  });
});

describe('levels', () => {
  it('ships at least 10 valid levels with rising difficulty', () => {
    expect(LEVELS.length).toBeGreaterThanOrEqual(15);
    for (const l of LEVELS) expect(validateLevel(l)).toEqual([]);
    const ids = new Set(LEVELS.map((l) => l.id));
    expect(ids.size).toBe(LEVELS.length);
    for (let i = 1; i < LEVELS.length; i++) {
      expect(LEVELS[i].difficulty.rating).toBeGreaterThanOrEqual(LEVELS[i - 1].difficulty.rating);
    }
  });

  it('validator catches broken levels', () => {
    const broken = { ...LEVELS[0], bubbles: [], platforms: [{ x: 0, y: 470, w: 50, h: 16 }] };
    expect(validateLevel(broken).length).toBeGreaterThanOrEqual(2);
  });
});
