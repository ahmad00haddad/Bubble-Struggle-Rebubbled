import { describe, expect, it } from 'vitest';
import { HARPOON, PLAYER, WORLD, type NetHarpoon } from '@orb/shared';
import { OwnShots } from '../client/src/game/ownShots';

const floorTip = WORLD.height - PLAYER.height;
const real = (id: number, owner: number, tipY: number, extra: Partial<NetHarpoon> = {}): NetHarpoon => ({ id, owner, x: 300, tipY, ...extra });

describe('OwnShots (instant own tether, cosmetic only)', () => {
  it('starts a tether the moment you press and lifts it at tether speed', () => {
    const s = new OwnShots(1);
    s.press(300, 1000, true, 1, 0);
    expect(s.guesses).toBe(1);
    const [v] = s.visible([], 0, 1100);
    expect(v.owner).toBe(1);
    expect(v.x).toBe(300);
    expect(v.tipY).toBeCloseTo(floorTip - HARPOON.speed * 0.1, 3);
  });

  it('the real tether replaces the guess, with no duplicate', () => {
    const s = new OwnShots(1);
    s.press(300, 1000, true, 1, 0);
    const snap = [real(7, 1, 380)];
    s.onSnapshot(snap);
    expect(s.guesses).toBe(0);
    const out = s.visible(snap, 1090, 1130);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(7);
    expect(out[0].tipY).toBeCloseTo(380 - HARPOON.speed * 0.04, 3); // advanced by the time since the snapshot arrived
  });

  it('a refused shot (jam, cooldown, dead) leaves no ghost for long', () => {
    const s = new OwnShots(0);
    s.press(200, 1000, true, 1, 0);
    expect(s.visible([], 0, 1300)).toHaveLength(1);
    expect(s.visible([], 0, 1700)).toHaveLength(0);
  });

  it('does not guess when the client knows it cannot fire, or is at its limit, or presses too fast', () => {
    const s = new OwnShots(0);
    s.press(200, 1000, false, 1, 0);
    expect(s.guesses).toBe(0);
    s.press(200, 1000, true, 1, 1); // already one live tether, limit one
    expect(s.guesses).toBe(0);
    s.press(200, 1000, true, 2, 0);
    s.press(200, 1050, true, 2, 0); // inside the cooldown
    expect(s.guesses).toBe(1);
    s.press(200, 1200, true, 2, 0);
    expect(s.guesses).toBe(2);
  });

  it('only draws its own owner and leaves other players to the delayed view', () => {
    const s = new OwnShots(2);
    const out = s.visible([real(1, 0, 300), real(2, 2, 300), real(3, 3, 300)], 0, 0);
    expect(out.map((o) => o.owner)).toEqual([2]);
  });

  it('anchors and boomerangs are drawn as received, not advanced', () => {
    const s = new OwnShots(0);
    const out = s.visible([real(1, 0, 0, { anchor: true, ttl: 3 }), real(2, 0, 200, { bm: 1 })], 0, 500);
    expect(out[0].tipY).toBe(0);
    expect(out[1].tipY).toBe(200);
  });

  it('a new match clears every guess', () => {
    const s = new OwnShots(0);
    s.press(200, 1000, true, 1, 0);
    s.reset();
    expect(s.guesses).toBe(0);
  });
});
