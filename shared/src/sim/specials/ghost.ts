import { SPECIAL } from '../../constants/game';
import type { SpecialDef } from './index';

const { solid, warn, ghostly } = SPECIAL.ghost;
const CYCLE = solid + warn + ghostly;

type Stage = 'solid' | 'warn' | 'ghostly';

/** `sa` is the position in the cycle: solid, then a hittable warning blink, then intangible. */
function stageAt(sa: number): Stage {
  return sa < solid ? 'solid' : sa < solid + warn ? 'warn' : 'ghostly';
}

/**
 * Ghost: periodically intangible. While intangible, harpoons pass through it and it
 * cannot hurt a Lancer either, so the blink is a readable breather, never a trap.
 * Physics are untouched; only hit tests consult the stage. Children are ordinary.
 */
export const ghost: SpecialDef = {
  kind: 'ghost',
  init(host, b, spawn) {
    b.sa = spawn.phase !== undefined ? spawn.phase % CYCLE : host.rng.next() * CYCLE;
  },
  intangible(b) {
    return stageAt(b.sa ?? 0) === 'ghostly';
  },
  onTick(host, b, dt) {
    const before = stageAt(b.sa ?? 0);
    let sa = (b.sa ?? 0) + dt;
    if (sa >= CYCLE) sa -= CYCLE;
    b.sa = sa;
    const after = stageAt(sa);
    if (after === before) return;
    host.emit(after === 'warn' ? 'warn' : after === 'ghostly' ? 'fade' : 'solid', b);
  },
};

export const GHOST_CYCLE_SECONDS = CYCLE;
export { stageAt as ghostStage };
