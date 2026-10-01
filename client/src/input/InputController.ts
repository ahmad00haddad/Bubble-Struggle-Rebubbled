import { CONTROLS, INPUT, type ControlScheme } from '@orb/shared';

/**
 * Converts keyboard + touch state into the shared input bitmask.
 *
 * Bindings come from shared/constants/controls.ts. Each device drives exactly
 * one Lancer, so all configured schemes control the local player.
 * Touch buttons (or any future source: gamepad, on-screen pad) just call
 * setVirtual().
 */
export class InputController {
  private down = new Set<string>();
  private virtual = { left: false, right: false, shoot: false };
  private pausePressed = false;
  private readonly schemes: ControlScheme[];
  private readonly gameCodes: Set<string>;

  constructor(private target: Window = window) {
    this.schemes = [CONTROLS.player1, CONTROLS.player2];
    this.gameCodes = new Set([...this.schemes.flatMap((s) => [...s.left, ...s.right, ...s.shoot]), ...CONTROLS.pause]);
    target.addEventListener('keydown', this.onDown);
    target.addEventListener('keyup', this.onUp);
    target.addEventListener('blur', this.onBlur);
  }

  destroy(): void {
    this.target.removeEventListener('keydown', this.onDown);
    this.target.removeEventListener('keyup', this.onUp);
    this.target.removeEventListener('blur', this.onBlur);
  }

  setVirtual(button: 'left' | 'right' | 'shoot', pressed: boolean): void {
    this.virtual[button] = pressed;
  }

  bits(): number {
    const any = (pick: (s: ControlScheme) => readonly string[]) => this.schemes.some((s) => pick(s).some((c) => this.down.has(c)));
    let b = 0;
    if (any((s) => s.left) || this.virtual.left) b |= INPUT.LEFT;
    if (any((s) => s.right) || this.virtual.right) b |= INPUT.RIGHT;
    if (any((s) => s.shoot) || this.virtual.shoot) b |= INPUT.SHOOT;
    return b;
  }

  /** True once per press of a pause key. */
  consumePause(): boolean {
    const p = this.pausePressed;
    this.pausePressed = false;
    return p;
  }

  private isTyping(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  private onDown = (e: KeyboardEvent) => {
    if (this.isTyping(e)) return;
    if (this.gameCodes.has(e.code)) e.preventDefault(); // stop page scrolling when embedded
    if (CONTROLS.pause.includes(e.code) && !e.repeat) this.pausePressed = true;
    this.down.add(e.code);
  };

  private onUp = (e: KeyboardEvent) => {
    this.down.delete(e.code);
  };

  private onBlur = () => {
    this.down.clear();
    this.virtual = { left: false, right: false, shoot: false };
  };
}
