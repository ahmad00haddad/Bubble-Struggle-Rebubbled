import Phaser from 'phaser';
import { BUBBLE_SIZES, POWERUP, WORLD } from '@orb/shared';
import { ensureOrbTexture, TEXTURES, TEX_SCALE } from '../assets/textures';
import { PLAYER_COLORS, VIEW } from '../config/clientConfig';
import type { ViewState } from '../game/types';

/** Orbs, tethers and power-ups. Keyed by entity id; sprites are reused frame to frame. */
export class WorldLayers {
  private orbs = new Map<number, Phaser.GameObjects.Image>();
  private tips = new Map<number, Phaser.GameObjects.Image>();
  private pups = new Map<number, Phaser.GameObjects.Image>();
  private tether: Phaser.GameObjects.Graphics;
  orbColor = 0xff7a59;

  constructor(private scene: Phaser.Scene) {
    this.tether = scene.add.graphics().setDepth(10);
  }

  clear(): void {
    for (const m of [this.orbs, this.tips, this.pups]) {
      m.forEach((o) => o.destroy());
      m.clear();
    }
    this.tether.clear();
  }

  update(v: ViewState, timeMs: number): void {
    const top = VIEW.arenaY;

    // --- orbs
    const seen = new Set<number>();
    for (const b of v.bubbles) {
      seen.add(b.id);
      let img = this.orbs.get(b.id);
      if (!img) {
        img = this.scene.add.image(0, 0, ensureOrbTexture(this.scene, b.size, this.orbColor)).setDepth(15);
        this.orbs.set(b.id, img);
      }
      const r = BUBBLE_SIZES[b.size].radius;
      const nearFloor = WORLD.height - (b.y + r);
      const squash = nearFloor < 5 ? 0.9 + nearFloor * 0.02 : 1;
      img.setPosition(b.x, top + b.y + (1 - squash) * r);
      img.setScale((1 / TEX_SCALE) * (2 - squash), (1 / TEX_SCALE) * squash);
    }
    for (const [id, img] of this.orbs) if (!seen.has(id)) (img.destroy(), this.orbs.delete(id));

    // --- tethers
    const g = this.tether;
    g.clear();
    const seenH = new Set<number>();
    for (const h of v.harpoons) {
      seenH.add(h.id);
      const color = PLAYER_COLORS[h.owner] ?? 0xffffff;
      const tipY = top + h.tipY;
      const floor = VIEW.arenaBottom;
      g.lineStyle(7, color, 0.22);
      g.lineBetween(h.x, floor, h.x, tipY + 6);
      g.lineStyle(2.5, 0xffffff, 0.95);
      g.beginPath();
      g.moveTo(h.x, floor);
      let up = true;
      for (let y = floor; y > tipY + 8; y -= 7) {
        g.lineTo(h.x + (up ? 2.5 : -2.5), y - 3.5);
        up = !up;
      }
      g.lineTo(h.x, tipY + 8);
      g.strokePath();
      g.lineStyle(1.5, color, 1);
      g.lineBetween(h.x, floor, h.x, tipY + 8);
      let tip = this.tips.get(h.id);
      if (!tip) {
        tip = this.scene.add.image(0, 0, TEXTURES.tip(h.owner)).setOrigin(0.5, 0).setScale(1 / TEX_SCALE).setDepth(11);
        this.tips.set(h.id, tip);
      }
      tip.setPosition(h.x, tipY);
    }
    for (const [id, img] of this.tips) if (!seenH.has(id)) (img.destroy(), this.tips.delete(id));

    // --- power-ups
    const seenU = new Set<number>();
    for (const u of v.powerups) {
      seenU.add(u.id);
      let img = this.pups.get(u.id);
      if (!img) {
        img = this.scene.add.image(0, 0, TEXTURES.powerUp(u.type)).setScale(1 / TEX_SCALE).setDepth(12);
        this.pups.set(u.id, img);
        this.scene.tweens.add({ targets: img, scale: { from: 0, to: 1 / TEX_SCALE }, duration: 220, ease: 'Back.easeOut' });
      }
      img.setPosition(u.x, top + u.y + Math.sin(timeMs / 180 + u.id) * 1.5);
      img.setVisible(u.life > POWERUP.blinkAt || Math.floor(timeMs / 110) % 2 === 0);
    }
    for (const [id, img] of this.pups) if (!seenU.has(id)) (img.destroy(), this.pups.delete(id));
  }
}
