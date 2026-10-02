import Phaser from 'phaser';
import { BUBBLE_SIZES, POWERUP, POWERUP_TYPES, type BubbleSize, type PowerUpType } from '@orb/shared';
import { PLAYER_COLORS } from '../config/clientConfig';

/**
 * All art is generated procedurally at boot so the project ships with zero
 * binary assets. Every texture has a stable key (see TEXTURES); to replace art,
 * load an image with the same key in BootScene.preload() — anything already
 * present in the texture manager is not regenerated.
 */
export const TEXTURES = {
  lancer: (slot: number, frame: number) => `lancer-${slot}-${frame}`,
  orb: (size: BubbleSize, color: number) => `orb-${size}-${color.toString(16)}`,
  powerUp: (type: PowerUpType) => `pu-${type}`,
  tip: (slot: number) => `tip-${slot}`,
  heart: 'heart',
  spark: 'spark',
  shard: 'shard',
  ring: 'ring',
} as const;

/** Lancer animation frames. */
export const LANCER_FRAMES = { idle: 0, walkA: 1, walkB: 2, hurt: 3 } as const;
const LANCER_W = 48;
const LANCER_H = 56;

const S = 2; // texture supersampling for crisp scaling

export function shade(color: number, f: number): number {
  const c = Phaser.Display.Color.IntegerToColor(color);
  const t = f < 0 ? 0 : 255;
  const p = Math.abs(f);
  return Phaser.Display.Color.GetColor(
    Math.round((t - c.red) * p + c.red),
    Math.round((t - c.green) * p + c.green),
    Math.round((t - c.blue) * p + c.blue),
  );
}

/** Orb hue shifts slightly per size so splits read clearly. */
export function orbColor(base: number, size: BubbleSize): number {
  const c = Phaser.Display.Color.IntegerToColor(base);
  const hsv = Phaser.Display.Color.RGBToHSV(c.red, c.green, c.blue);
  const h = (hsv.h + (3 - size) * 0.045) % 1;
  const rgb = Phaser.Display.Color.HSVToRGB(h, Math.min(1, hsv.s * (0.9 + size * 0.04)), Math.min(1, hsv.v + (3 - size) * 0.03)) as Phaser.Types.Display.ColorObject;
  return Phaser.Display.Color.GetColor(rgb.r, rgb.g, rgb.b);
}

function gen(scene: Phaser.Scene, key: string, w: number, h: number, draw: (g: Phaser.GameObjects.Graphics) => void): void {
  if (scene.textures.exists(key)) return;
  const g = scene.make.graphics({}, false);
  draw(g);
  g.generateTexture(key, w, h);
  g.destroy();
}

export function ensureOrbTexture(scene: Phaser.Scene, size: BubbleSize, base: number): string {
  const color = orbColor(base, size);
  const key = TEXTURES.orb(size, color);
  const r = BUBBLE_SIZES[size].radius * S;
  const pad = 2 * S;
  const d = r * 2 + pad * 2;
  gen(scene, key, d, d, (g) => {
    const cx = r + pad;
    const cy = r + pad;
    // soft outer glow
    g.fillStyle(color, 0.18);
    g.fillCircle(cx, cy, r + pad);
    // body with a fake radial gradient (dark rim → bright core)
    const steps = 10;
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      g.fillStyle(shade(color, -0.35 + t * 0.45), 1);
      g.fillCircle(cx - r * 0.12 * t, cy - r * 0.12 * t, r * (1 - t * 0.55));
    }
    // rim
    g.lineStyle(Math.max(2, r * 0.07), shade(color, -0.5), 0.9);
    g.strokeCircle(cx, cy, r - r * 0.035);
    // highlights (original "double-glint" look)
    g.fillStyle(0xffffff, 0.85);
    g.fillEllipse(cx - r * 0.36, cy - r * 0.42, r * 0.52, r * 0.3);
    g.fillStyle(0xffffff, 0.9);
    g.fillCircle(cx - r * 0.05, cy - r * 0.62, r * 0.08);
    g.fillStyle(0xffffff, 0.22);
    g.fillEllipse(cx + r * 0.22, cy + r * 0.58, r * 0.7, r * 0.18);
  });
  return key;
}

function drawLancer(g: Phaser.GameObjects.Graphics, color: number, frame: number): void {
  const k = S;
  const suit = color;
  const suitDark = shade(color, -0.35);
  const helmet = 0xeef3ff;
  const ink = 0x141a3a;
  const walk = frame === LANCER_FRAMES.walkA ? 1 : frame === LANCER_FRAMES.walkB ? -1 : 0;
  const hurt = frame === LANCER_FRAMES.hurt;

  // boots + legs
  g.fillStyle(suitDark, 1);
  g.fillRoundedRect((17 + walk * 3) * k, 42 * k, 6 * k, 9 * k, 2 * k);
  g.fillRoundedRect((25 - walk * 3) * k, 42 * k, 6 * k, 9 * k, 2 * k);
  g.fillStyle(ink, 1);
  g.fillRoundedRect((15 + walk * 3) * k, 50 * k, 9 * k, 5 * k, 2 * k);
  g.fillRoundedRect((24 - walk * 3) * k, 50 * k, 9 * k, 5 * k, 2 * k);

  // backpack tank
  g.fillStyle(0x5a6aa8, 1);
  g.fillRoundedRect(8 * k, 27 * k, 9 * k, 15 * k, 3 * k);
  g.fillStyle(0x8fa2e6, 1);
  g.fillRect(10 * k, 29 * k, 2 * k, 11 * k);

  // body
  g.fillStyle(suit, 1);
  g.fillRoundedRect(14 * k, 27 * k, 21 * k, 18 * k, 6 * k);
  g.fillStyle(shade(suit, 0.35), 1);
  g.fillRoundedRect(17 * k, 30 * k, 6 * k, 3 * k, 1.5 * k);
  // belt
  g.fillStyle(ink, 0.8);
  g.fillRect(14 * k, 39 * k, 21 * k, 2 * k);

  // tether launcher on the shoulder, pointing up
  g.fillStyle(0x2b335e, 1);
  g.fillRoundedRect(32 * k, 16 * k, 6 * k, 18 * k, 2 * k);
  g.fillStyle(shade(suit, 0.2), 1);
  g.fillRect(32 * k, 14 * k, 6 * k, 3 * k);

  // helmet
  g.fillStyle(helmet, 1);
  g.fillCircle(24 * k, 17 * k, 14 * k);
  g.lineStyle(2.5 * k, suit, 1);
  g.strokeCircle(24 * k, 17 * k, 13 * k);
  // visor
  g.fillStyle(ink, 1);
  g.fillRoundedRect(19 * k, 11 * k, 17 * k, 11 * k, 5 * k);
  if (hurt) {
    g.lineStyle(2 * k, 0xff4d6d, 1);
    g.lineBetween(22 * k, 13 * k, 26 * k, 19 * k);
    g.lineBetween(26 * k, 13 * k, 22 * k, 19 * k);
    g.lineBetween(29 * k, 13 * k, 33 * k, 19 * k);
    g.lineBetween(33 * k, 13 * k, 29 * k, 19 * k);
  } else {
    g.fillStyle(0x7ff3ff, 1);
    g.fillRoundedRect(24 * k, 14 * k, 3 * k, 5 * k, 1.5 * k);
    g.fillRoundedRect(30 * k, 14 * k, 3 * k, 5 * k, 1.5 * k);
    g.fillStyle(0xffffff, 0.35);
    g.fillRoundedRect(21 * k, 12 * k, 9 * k, 2 * k, 1 * k);
  }
  // antenna
  g.lineStyle(2 * k, ink, 1);
  g.lineBetween(17 * k, 6 * k, 14 * k, 1.5 * k);
  g.fillStyle(suit, 1);
  g.fillCircle(14 * k, 2.5 * k, 2.5 * k);
}

function drawPowerUp(g: Phaser.GameObjects.Graphics, type: PowerUpType): void {
  const k = S;
  const s = POWERUP.size;
  const colors: Record<PowerUpType, number> = {
    shield: 0x4cc9f0,
    extraLife: 0xff4d6d,
    extraTime: 0xffc145,
    doubleHarpoon: 0xb388ff,
    speedBoost: 0x5cf2a0,
    anchor: 0xff9f43,
    chaos: 0xd946ef,
    shrink: 0xff5d73,
    boots: 0x8d6e63,
    potato: 0xff9f1c,
    wide: 0x2ec4b6,
    pinata: 0xff70a6,
    chest: 0xe6b800,
    decoy: 0x45bde6,
    slow: 0x7aa2ff,
    freeze: 0x8fe3f2,
    magnet: 0xe63946,
    double: 0x9d4edd,
    baton: 0x06b58a,
    flare: 0xff6b35,
    boomerang: 0x5fc400,
  };
  const c = colors[type];
  g.fillStyle(shade(c, -0.45), 1);
  g.fillRoundedRect(0, 0, s * k, s * k, 7 * k);
  g.fillStyle(c, 1);
  g.fillRoundedRect(1.5 * k, 1.5 * k, (s - 3) * k, (s - 3) * k, 6 * k);
  g.fillStyle(0xffffff, 0.3);
  g.fillRoundedRect(3 * k, 3 * k, (s - 6) * k, 5 * k, 3 * k);
  const w = 0xffffff;
  const cx = (s / 2) * k;
  const cy = (s / 2 + 1) * k;
  g.fillStyle(w, 1);
  g.lineStyle(2.2 * k, w, 1);
  switch (type) {
    case 'shield':
    case 'decoy':
      g.fillPoints(
        [
          new Phaser.Math.Vector2(cx - 6 * k, cy - 6 * k),
          new Phaser.Math.Vector2(cx + 6 * k, cy - 6 * k),
          new Phaser.Math.Vector2(cx + 6 * k, cy),
          new Phaser.Math.Vector2(cx, cy + 7 * k),
          new Phaser.Math.Vector2(cx - 6 * k, cy),
        ],
        true,
      );
      if (type === 'decoy') {
        // Same shield, one hairline crack: a careful player can tell.
        g.lineStyle(1.4 * k, c, 1);
        g.lineBetween(cx - 1 * k, cy - 6 * k, cx + 2 * k, cy - 1 * k);
        g.lineBetween(cx + 2 * k, cy - 1 * k, cx - 1 * k, cy + 3 * k);
      }
      break;
    case 'extraLife':
      g.fillCircle(cx - 3.2 * k, cy - 2.5 * k, 3.8 * k);
      g.fillCircle(cx + 3.2 * k, cy - 2.5 * k, 3.8 * k);
      g.fillTriangle(cx - 7 * k, cy - 1 * k, cx + 7 * k, cy - 1 * k, cx, cy + 7 * k);
      break;
    case 'extraTime':
      g.strokeCircle(cx, cy, 6.5 * k);
      g.lineBetween(cx, cy, cx, cy - 4.5 * k);
      g.lineBetween(cx, cy, cx + 3.5 * k, cy + 1 * k);
      break;
    case 'doubleHarpoon':
      for (const dx of [-3.5, 3.5]) {
        g.lineBetween(cx + dx * k, cy + 7 * k, cx + dx * k, cy - 3 * k);
        g.fillTriangle(cx + (dx - 3) * k, cy - 2 * k, cx + (dx + 3) * k, cy - 2 * k, cx + dx * k, cy - 7.5 * k);
      }
      break;
    case 'speedBoost':
      g.fillPoints(
        [
          new Phaser.Math.Vector2(cx + 2 * k, cy - 8 * k),
          new Phaser.Math.Vector2(cx - 5 * k, cy + 1 * k),
          new Phaser.Math.Vector2(cx - 0.5 * k, cy + 1 * k),
          new Phaser.Math.Vector2(cx - 2 * k, cy + 8 * k),
          new Phaser.Math.Vector2(cx + 5 * k, cy - 1.5 * k),
          new Phaser.Math.Vector2(cx + 0.5 * k, cy - 1.5 * k),
        ],
        true,
      );
      break;
    case 'anchor':
      // A tether running up into a hook at the ceiling.
      g.lineBetween(cx, cy + 7 * k, cx, cy - 4 * k);
      g.lineBetween(cx - 5 * k, cy - 7 * k, cx + 5 * k, cy - 7 * k);
      g.fillTriangle(cx - 4 * k, cy - 3 * k, cx + 4 * k, cy - 3 * k, cx, cy - 8.5 * k);
      break;
    case 'shrink':
      g.fillTriangle(cx - 6 * k, cy - 7 * k, cx + 6 * k, cy - 7 * k, cx, cy);
      g.fillTriangle(cx - 6 * k, cy + 7 * k, cx + 6 * k, cy + 7 * k, cx, cy);
      break;
    case 'boots':
      g.fillRect(cx - 5 * k, cy - 8 * k, 6 * k, 11 * k);
      g.fillRoundedRect(cx - 5 * k, cy + 1 * k, 13 * k, 6 * k, 2 * k);
      break;
    case 'potato':
      g.fillEllipse(cx, cy, 15 * k, 11 * k);
      g.fillStyle(c, 1);
      g.fillCircle(cx - 3 * k, cy - 1 * k, 1.4 * k);
      g.fillCircle(cx + 3 * k, cy + 1 * k, 1.4 * k);
      break;
    case 'wide':
      g.lineBetween(cx - 6 * k, cy, cx + 6 * k, cy);
      g.fillTriangle(cx - 9 * k, cy, cx - 4 * k, cy - 4 * k, cx - 4 * k, cy + 4 * k);
      g.fillTriangle(cx + 9 * k, cy, cx + 4 * k, cy - 4 * k, cx + 4 * k, cy + 4 * k);
      g.lineBetween(cx, cy - 7 * k, cx, cy + 7 * k);
      break;
    case 'pinata':
      g.fillCircle(cx, cy, 4.5 * k);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        g.lineBetween(cx + Math.cos(a) * 6.5 * k, cy + Math.sin(a) * 6.5 * k, cx + Math.cos(a) * 9 * k, cy + Math.sin(a) * 9 * k);
      }
      break;
    case 'chest':
      g.fillRect(cx - 8 * k, cy - 3 * k, 16 * k, 10 * k);
      g.fillRoundedRect(cx - 8 * k, cy - 8 * k, 16 * k, 6 * k, { tl: 5 * k, tr: 5 * k, bl: 0, br: 0 });
      g.fillStyle(c, 1);
      g.fillRect(cx - 1.5 * k, cy - 1 * k, 3 * k, 4 * k);
      break;
    case 'slow':
      g.fillEllipse(cx - 1 * k, cy, 13 * k, 9 * k);
      g.fillCircle(cx + 7 * k, cy + 2 * k, 2.8 * k);
      g.lineBetween(cx - 5 * k, cy + 5 * k, cx + 3 * k, cy + 5 * k);
      break;
    case 'freeze':
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI;
        g.lineBetween(cx - Math.cos(a) * 8 * k, cy - Math.sin(a) * 8 * k, cx + Math.cos(a) * 8 * k, cy + Math.sin(a) * 8 * k);
      }
      break;
    case 'magnet':
      g.beginPath();
      g.arc(cx, cy, 5 * k, 0, Math.PI, false);
      g.strokePath();
      g.lineBetween(cx - 5 * k, cy, cx - 5 * k, cy - 7 * k);
      g.lineBetween(cx + 5 * k, cy, cx + 5 * k, cy - 7 * k);
      break;
    case 'double':
      g.strokeCircle(cx - 3.5 * k, cy, 5.5 * k);
      g.strokeCircle(cx + 3.5 * k, cy, 5.5 * k);
      break;
    case 'baton':
      g.lineStyle(3 * k, w, 1);
      g.lineBetween(cx - 6 * k, cy + 6 * k, cx + 6 * k, cy - 6 * k);
      g.fillCircle(cx - 6 * k, cy + 6 * k, 2.4 * k);
      g.fillCircle(cx + 6 * k, cy - 6 * k, 2.4 * k);
      break;
    case 'flare':
      g.fillTriangle(cx - 4 * k, cy + 2 * k, cx + 4 * k, cy + 2 * k, cx, cy - 8 * k);
      g.fillCircle(cx, cy + 6 * k, 2.2 * k);
      break;
    case 'boomerang':
      g.lineStyle(3 * k, w, 1);
      g.lineBetween(cx - 7 * k, cy - 5 * k, cx, cy + 5 * k);
      g.lineBetween(cx, cy + 5 * k, cx + 7 * k, cy - 5 * k);
      break;
    case 'chaos':
      // A lightning-tangled question mark: zig-zag bolt with a dot.
      g.lineBetween(cx - 5 * k, cy - 7 * k, cx + 1 * k, cy - 7 * k);
      g.lineBetween(cx + 1 * k, cy - 7 * k, cx - 3 * k, cy);
      g.lineBetween(cx - 3 * k, cy, cx + 4 * k, cy);
      g.lineBetween(cx + 4 * k, cy, cx - 1 * k, cy + 5 * k);
      g.fillCircle(cx - 1 * k, cy + 8 * k, 1.6 * k);
      break;
  }
}

export function generateTextures(scene: Phaser.Scene): void {
  PLAYER_COLORS.forEach((color, slot) => {
    for (const f of Object.values(LANCER_FRAMES)) {
      gen(scene, TEXTURES.lancer(slot, f), LANCER_W * S, LANCER_H * S, (g) => drawLancer(g, color, f));
    }
    gen(scene, TEXTURES.tip(slot), 14 * S, 16 * S, (g) => {
      g.fillStyle(0xffffff, 1);
      g.fillTriangle(0, 10 * S, 14 * S, 10 * S, 7 * S, 0);
      g.fillStyle(color, 1);
      g.fillRect(5 * S, 9 * S, 4 * S, 7 * S);
    });
  });
  for (const t of POWERUP_TYPES) gen(scene, TEXTURES.powerUp(t), POWERUP.size * S, POWERUP.size * S, (g) => drawPowerUp(g, t));
  gen(scene, TEXTURES.heart, 16 * S, 14 * S, (g) => {
    g.fillStyle(0xff4d6d, 1);
    g.fillCircle(4.5 * S, 4.5 * S, 4.5 * S);
    g.fillCircle(11.5 * S, 4.5 * S, 4.5 * S);
    g.fillTriangle(0, 6 * S, 16 * S, 6 * S, 8 * S, 14 * S);
    g.fillStyle(0xffffff, 0.6);
    g.fillCircle(4 * S, 3.5 * S, 1.6 * S);
  });
  gen(scene, TEXTURES.spark, 16, 16, (g) => {
    g.fillStyle(0xffffff, 0.35);
    g.fillCircle(8, 8, 8);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(8, 8, 4);
  });
  gen(scene, TEXTURES.shard, 8, 8, (g) => {
    g.fillStyle(0xffffff, 1);
    g.fillRect(0, 0, 8, 8);
  });
  gen(scene, TEXTURES.ring, 64, 64, (g) => {
    g.lineStyle(4, 0xffffff, 1);
    g.strokeCircle(32, 32, 29);
  });
}

/** Texture supersampling factor; sprites using generated art should setScale(1 / TEX_SCALE). */
export const TEX_SCALE = S;
