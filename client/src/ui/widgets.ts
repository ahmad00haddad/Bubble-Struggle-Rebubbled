import Phaser from 'phaser';
import { BUBBLE_SIZES, GAME_NAME, type BubbleSize } from '@orb/shared';
import { VIEW } from '../config/clientConfig';
import { ensureOrbTexture, TEX_SCALE } from '../assets/textures';
import { COLORS, TEXT } from './theme';

/** Rounded translucent panel. */
export function panel(scene: Phaser.Scene, x: number, y: number, w: number, h: number, alpha = 0.92): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics({ x, y });
  g.fillStyle(0x000000, 0.4);
  g.fillRoundedRect(-w / 2 + 4, -h / 2 + 6, w, h, 18);
  g.fillStyle(COLORS.panel, alpha);
  g.fillRoundedRect(-w / 2, -h / 2, w, h, 18);
  g.lineStyle(3, COLORS.panelEdge, 1);
  g.strokeRoundedRect(-w / 2, -h / 2, w, h, 18);
  g.lineStyle(1, 0xffffff, 0.08);
  g.strokeRoundedRect(-w / 2 + 6, -h / 2 + 6, w - 12, h - 12, 14);
  return g;
}

/** Animated menu backdrop: gradient sky, star dust and lazily bouncing orbs. */
export function menuBackdrop(scene: Phaser.Scene): void {
  const g = scene.add.graphics();
  g.fillGradientStyle(0x0b1030, 0x0b1030, 0x2a1a5e, 0x3b2a7a, 1);
  g.fillRect(0, 0, VIEW.width, VIEW.height);
  for (let i = 0; i < 70; i++) {
    const s = scene.add.circle(Math.random() * VIEW.width, Math.random() * VIEW.height * 0.8, Math.random() * 1.6 + 0.4, 0xffffff, Math.random() * 0.6 + 0.2);
    scene.tweens.add({ targets: s, alpha: 0.1, duration: 800 + Math.random() * 2000, yoyo: true, repeat: -1, delay: Math.random() * 2000 });
  }
  // floor grid
  const grid = scene.add.graphics();
  grid.lineStyle(1, 0x7d7bff, 0.25);
  for (let i = 0; i <= 24; i++) {
    const x = (i / 24) * VIEW.width;
    grid.lineBetween(VIEW.width / 2 + (x - VIEW.width / 2) * 0.35, 470, x * 1.6 - VIEW.width * 0.3, VIEW.height);
  }
  for (let j = 0; j < 6; j++) grid.lineBetween(0, 470 + j * j * 4.2, VIEW.width, 470 + j * j * 4.2);

  const colors = [0xff7a59, 0x47e5bc, 0x7d7bff, 0xffc145, 0xf72585];
  for (let i = 0; i < 6; i++) {
    const size = (i % 4) as BubbleSize;
    const key = ensureOrbTexture(scene, size, colors[i % colors.length]);
    const r = BUBBLE_SIZES[size].radius;
    const img = scene.add.image(80 + Math.random() * (VIEW.width - 160), 470 - r, key).setScale(1 / TEX_SCALE).setAlpha(0.85);
    const peak = 470 - r - BUBBLE_SIZES[size].bounceHeight * 0.9;
    scene.tweens.add({ targets: img, y: peak, duration: 700 + size * 160, ease: 'Sine.easeOut', yoyo: true, repeat: -1, delay: Math.random() * 800 });
    scene.tweens.add({ targets: img, x: Math.random() < 0.5 ? r + 20 : VIEW.width - r - 20, duration: 9000 + Math.random() * 5000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }
}

export function titleText(scene: Phaser.Scene, y: number, size = 46): Phaser.GameObjects.Container {
  const c = scene.add.container(VIEW.width / 2, y);
  const shadow = scene.add.text(4, 6, GAME_NAME, TEXT.title(size)).setOrigin(0.5).setColor('#1a0f3d');
  const main = scene.add.text(0, 0, GAME_NAME, TEXT.title(size)).setOrigin(0.5);
  main.setTint(0xffe066, 0xffe066, 0xff7a59, 0xff5d8f);
  c.add([shadow, main]);
  scene.tweens.add({ targets: c, y: y - 6, duration: 1600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  return c;
}

export function heading(scene: Phaser.Scene, text: string, y = 70): Phaser.GameObjects.Text {
  return scene.add.text(VIEW.width / 2, y, text, TEXT.display(26, COLORS.accentCss)).setOrigin(0.5).setShadow(3, 4, '#1a0f3d', 0, false, true);
}

/** Simple scene fade transition. */
export function goTo(scene: Phaser.Scene, key: string, data?: object): void {
  scene.cameras.main.fadeOut(160, 7, 10, 31);
  scene.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => scene.scene.start(key, data));
}

/** HTML text input positioned over the canvas (Phaser DOM element). */
export function textInput(
  scene: Phaser.Scene,
  x: number,
  y: number,
  opts: { placeholder: string; value?: string; maxLength: number; width?: number; uppercase?: boolean },
): HTMLInputElement {
  const el = document.createElement('input');
  el.type = 'text';
  el.placeholder = opts.placeholder;
  el.value = opts.value ?? '';
  el.maxLength = opts.maxLength;
  el.autocomplete = 'off';
  el.spellcheck = false;
  el.setAttribute('autocapitalize', opts.uppercase ? 'characters' : 'off');
  Object.assign(el.style, {
    width: `${opts.width ?? 300}px`,
    padding: opts.uppercase ? '6px 16px' : '12px 16px',
    fontFamily: opts.uppercase ? '"Chakra Petch", sans-serif' : '"Press Start 2P", monospace',
    fontSize: opts.uppercase ? '24px' : '16px',
    fontWeight: '700',
    color: '#eef3ff',
    background: '#0b1030',
    border: '3px solid #5b6fd6',
    borderRadius: '12px',
    outline: 'none',
    textAlign: 'center',
    letterSpacing: opts.uppercase ? '4px' : '1px',
    textTransform: opts.uppercase ? 'uppercase' : 'none',
    boxSizing: 'border-box',
  } satisfies Partial<CSSStyleDeclaration>);
  el.addEventListener('focus', () => (el.style.borderColor = '#ffd166'));
  el.addEventListener('blur', () => (el.style.borderColor = '#5b6fd6'));
  // Positioned in game coordinates by mapping onto the canvas' on-screen rect,
  // so it stays aligned under any scale mode, embed or resize.
  const width = opts.width ?? 300;
  const place = () => {
    const r = scene.game.canvas.getBoundingClientRect();
    const k = r.width / VIEW.width;
    Object.assign(el.style, {
      position: 'fixed',
      left: `${r.left + x * k}px`,
      top: `${r.top + y * k}px`,
      width: `${width}px`,
      transform: `translate(-50%, -50%) scale(${k})`,
      transformOrigin: 'center center',
      zIndex: '10',
    } satisfies Partial<CSSStyleDeclaration>);
  };
  document.body.appendChild(el);
  place();
  window.addEventListener('resize', place);
  scene.scale.on(Phaser.Scale.Events.RESIZE, place);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    window.removeEventListener('resize', place);
    scene.scale.off(Phaser.Scale.Events.RESIZE, place);
    el.remove();
  });
  return el;
}
