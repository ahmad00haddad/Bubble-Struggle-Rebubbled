import type { SpecialEventType } from '../../constants/game';
import type { BubbleState } from '../../types/state';
import type { SpecialHost } from './index';

/**
 * Shared state machine for specials that need several hits inside a time window
 * (Sync, Pincer, Heavy). `sa` is the time left (0 = idle) and `hm` a bitmask of the
 * hits gathered so far. Keeping this in one place keeps the three rules identical in
 * everything except what counts as "a different hit".
 */

export const bit = (n: number): number => 1 << n;

export function popcount(mask: number): number {
  let c = 0;
  for (let m = mask; m; m &= m - 1) c++;
  return c;
}

export function isArmed(b: BubbleState): boolean {
  return (b.sa ?? 0) > 0;
}

export function arm(b: BubbleState, seconds: number, mask: number): void {
  b.sa = seconds;
  b.hm = mask;
}

export function disarm(b: BubbleState): void {
  b.sa = 0;
  b.hm = 0;
}

/** Count the window down; when it runs out, forget the hits and report `failEvent`. */
export function tickArmed(host: SpecialHost, b: BubbleState, dt: number, failEvent: SpecialEventType): void {
  const left = b.sa ?? 0;
  if (left <= 0) return;
  if (left - dt > 0) {
    b.sa = left - dt;
    return;
  }
  disarm(b);
  host.emit(failEvent, b);
}
