import { NET, TICK_MS, movePlayerFx, type MoveFx, type NetPlayer } from '@orb/shared';

interface InputRecord {
  seq: number;
  bits: number;
  /** Client prediction tick at which these bits took effect. */
  tick: number;
}

/**
 * Client-side prediction + reconciliation for the local Lancer's horizontal
 * movement only. Inputs are sent on change (not every frame); each snapshot
 * tells us the last input the server applied (`lastSeq`) and how many server
 * ticks it has simulated since (`ticksSince`). We restart from the server's
 * position at that moment and replay our own later ticks with the same shared
 * movement function the server uses.
 */
export class Prediction {
  x = 0;
  private hasX = false;
  private seq = 0;
  private bits = 0;
  private tick = 0;
  private acc = 0;
  private history: InputRecord[] = [];
  /** Visual-only error offset that decays, so corrections never pop. */
  private smooth = 0;

  reset(): void {
    this.seq = 0;
    this.bits = 0;
    this.history = [];
    this.hasX = false;
    this.smooth = 0;
  }

  get displayX(): number {
    return this.x + this.smooth;
  }

  /** Returns the new sequence number if the input changed (caller sends it). */
  setBits(bits: number): number | null {
    if (bits === this.bits) return null;
    this.bits = bits;
    this.seq++;
    this.history.push({ seq: this.seq, bits, tick: this.tick });
    if (this.history.length > 256) this.history.shift();
    return this.seq;
  }

  /**
   * @param running server world is advancing (phase 'playing')
   * @param canMove local Lancer is alive
   */
  update(dtMs: number, running: boolean, canMove: boolean, speedMul: number, fx?: MoveFx): void {
    this.acc += dtMs;
    let steps = 0;
    while (this.acc >= TICK_MS && steps < 8) {
      this.acc -= TICK_MS;
      steps++;
      if (!running) continue;
      if (canMove && this.hasX) this.x = movePlayerFx(this.x, this.bitsAt(this.tick), speedMul, fx);
      this.tick++;
    }
    if (steps === 8) this.acc = 0;
    this.smooth *= Math.exp(-dtMs / 90);
    if (Math.abs(this.smooth) < 0.05) this.smooth = 0;
  }

  reconcile(sp: NetPlayer, running: boolean, speedMul: number, fx?: MoveFx): void {
    if (!this.hasX || !running || sp.life !== 'alive' || !sp.active) {
      this.x = sp.x;
      this.hasX = true;
      this.smooth = 0;
      return;
    }
    const ack = sp.lastSeq;
    const entry = this.history.find((h) => h.seq === ack);
    let base: number;
    if (entry) {
      base = entry.tick + sp.ticksSince;
    } else {
      // No acknowledged input on record (fresh connection): align on the first
      // pending input if any, otherwise the server position is current.
      const pending = this.history.find((h) => h.seq > ack);
      base = pending ? pending.tick : this.tick;
    }
    base = Math.min(base, this.tick);

    let nx = sp.x;
    for (let t = base; t < this.tick; t++) nx = movePlayerFx(nx, this.bitsAt(t), speedMul, fx);

    const err = this.x + this.smooth - nx;
    this.smooth = Math.abs(err) > NET.snapDistance ? 0 : err;
    this.x = nx;
    this.history = this.history.filter((h) => h.seq >= ack);
  }

  private bitsAt(t: number): number {
    let b = 0;
    for (const h of this.history) {
      if (h.tick <= t) b = h.bits;
      else break;
    }
    return b;
  }
}
