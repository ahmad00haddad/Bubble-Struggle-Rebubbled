import Phaser from 'phaser';
import { audio } from '../audio/AudioManager';
import { COLORS, TEXT } from './theme';

export interface ButtonOptions {
  width?: number;
  height?: number;
  primary?: boolean;
  fontSize?: number;
  /** Overrides the label font (the Arabic how-to pages need a font with Arabic letters). */
  fontFamily?: string;
}

/** Arcade-style button: hover/focus glow, press squash, click sound. */
export class Button extends Phaser.GameObjects.Container {
  private bg: Phaser.GameObjects.Graphics;
  private label: Phaser.GameObjects.Text;
  private focused = false;
  private enabled = true;
  readonly bw: number;
  readonly bh: number;
  private primary: boolean;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    text: string,
    private onClick: () => void,
    opt: ButtonOptions = {},
  ) {
    super(scene, x, y);
    this.bw = opt.width ?? 300;
    this.bh = opt.height ?? 52;
    this.primary = !!opt.primary;
    this.bg = scene.add.graphics();
    this.label = scene.add.text(0, 1, text, opt.fontFamily ? { ...TEXT.display(opt.fontSize ?? 15), fontFamily: opt.fontFamily, fontStyle: '700' } : TEXT.display(opt.fontSize ?? 15)).setOrigin(0.5);
    this.add([this.bg, this.label]);
    this.setSize(this.bw, this.bh);
    this.setInteractive({ useHandCursor: true });
    this.on('pointerover', () => this.setFocus(true));
    this.on('pointerout', () => this.setFocus(false));
    this.on('pointerdown', () => this.setScale(0.96));
    this.on('pointerup', () => {
      this.setScale(1);
      this.activate();
    });
    this.redraw();
    scene.add.existing(this);
  }

  setText(t: string): this {
    this.label.setText(t);
    return this;
  }

  setEnabled(v: boolean): this {
    this.enabled = v;
    this.setAlpha(v ? 1 : 0.45);
    return this;
  }

  setFocus(v: boolean): this {
    if (this.focused === v) return this;
    this.focused = v;
    this.redraw();
    if (v) this.scene.tweens.add({ targets: this, scale: 1.04, duration: 90, yoyo: true });
    return this;
  }

  activate(): void {
    if (!this.enabled) return;
    audio.unlock();
    audio.play('click');
    this.onClick();
  }

  private redraw(): void {
    const g = this.bg;
    const w = this.bw;
    const h = this.bh;
    g.clear();
    const fill = this.primary ? (this.focused ? COLORS.primaryHover : COLORS.primary) : this.focused ? COLORS.buttonHover : COLORS.button;
    g.fillStyle(0x000000, 0.35);
    g.fillRoundedRect(-w / 2 + 3, -h / 2 + 5, w, h, 12);
    g.fillStyle(fill, 1);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, 12);
    g.fillStyle(0xffffff, this.focused ? 0.22 : 0.12);
    g.fillRoundedRect(-w / 2 + 6, -h / 2 + 5, w - 12, h * 0.32, 8);
    g.lineStyle(2, this.focused ? COLORS.accent : this.primary ? 0xffc2ad : COLORS.buttonEdge, 1);
    g.strokeRoundedRect(-w / 2, -h / 2, w, h, 12);
  }
}

/**
 * Keyboard/gamepad-style navigation over a list of buttons:
 * Up/Down (or W/S) to move, Enter to activate. Mouse/touch still work.
 */
export class ButtonGroup {
  private index = -1;
  private keyHandler: (e: KeyboardEvent) => void;

  constructor(
    scene: Phaser.Scene,
    private buttons: Button[],
    opts: { onBack?: () => void; horizontal?: boolean } = {},
  ) {
    this.keyHandler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.tagName === 'INPUT') {
        if (e.code === 'Enter') {
          (t as HTMLInputElement).blur();
          this.focus(Math.max(0, this.index));
        }
        return;
      }
      const prev = opts.horizontal ? ['ArrowLeft', 'KeyA'] : ['ArrowUp', 'KeyW'];
      const next = opts.horizontal ? ['ArrowRight', 'KeyD'] : ['ArrowDown', 'KeyS'];
      if (prev.includes(e.code)) this.move(-1);
      else if (next.includes(e.code)) this.move(1);
      else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        if (this.index >= 0) this.buttons[this.index]?.activate();
      } else if (e.code === 'Escape' && opts.onBack) opts.onBack();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', this.keyHandler);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
    for (const [i, b] of buttons.entries()) b.on('pointerover', () => this.focus(i));
  }

  focus(i: number): void {
    this.index = i;
    this.buttons.forEach((b, j) => b.setFocus(j === i));
  }

  private move(d: number): void {
    const n = this.buttons.length;
    if (!n) return;
    let i = this.index;
    for (let k = 0; k < n; k++) {
      i = (i + d + n) % n;
      if (this.buttons[i].alpha > 0.5 && this.buttons[i].visible) break;
    }
    this.focus(i);
    audio.play('click', { pitch: 1.4 });
  }

  destroy(): void {
    window.removeEventListener('keydown', this.keyHandler);
  }
}
