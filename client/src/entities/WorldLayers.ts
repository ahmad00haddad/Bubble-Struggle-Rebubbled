import Phaser from 'phaser';
import { BUBBLE_SIZES, HAZARDS, POWERUP, WORLD, platformActive, platformVanishIn, type LevelConfig } from '@orb/shared';
import { ensureOrbTexture, TEXTURES, TEX_SCALE } from '../assets/textures';
import { FAST_ORB_COLOR, PLAYER_COLORS, VIEW } from '../config/clientConfig';
import type { ViewState } from '../game/types';

/** Orbs, tethers and power-ups. Keyed by entity id; sprites are reused frame to frame. */
export class WorldLayers {
  private orbs = new Map<number, Phaser.GameObjects.Image>();
  private tips = new Map<number, Phaser.GameObjects.Image>();
  private pups = new Map<number, Phaser.GameObjects.Image>();
  private tether: Phaser.GameObjects.Graphics;
  private hazards: Phaser.GameObjects.Graphics;
  orbColor = 0xff7a59;
  level: LevelConfig | null = null;

  constructor(private scene: Phaser.Scene) {
    this.tether = scene.add.graphics().setDepth(10);
    this.hazards = scene.add.graphics().setDepth(9);
  }

  clear(): void {
    for (const m of [this.orbs, this.tips, this.pups]) {
      m.forEach((o) => o.destroy());
      m.clear();
    }
    this.tether.clear();
    this.hazards.clear();
  }

  update(v: ViewState, timeMs: number): void {
    const top = VIEW.arenaY;
    this.drawHazards(v, timeMs);

    // --- orbs
    const seen = new Set<number>();
    for (const b of v.bubbles) {
      seen.add(b.id);
      let img = this.orbs.get(b.id);
      if (!img) {
        img = this.scene.add.image(0, 0, ensureOrbTexture(this.scene, b.size, b.fast ? FAST_ORB_COLOR : this.orbColor)).setDepth(15);
        this.orbs.set(b.id, img);
      }
      const r = BUBBLE_SIZES[b.size].radius;
      const nearFloor = WORLD.height - (b.y + r);
      const squash = nearFloor < 5 ? 0.9 + nearFloor * 0.02 : 1;
      img.setPosition(b.x, top + b.y + (1 - squash) * r);
      const pulse = b.fast ? 1 + Math.sin(timeMs / 70) * 0.04 : 1;
      img.setScale((1 / TEX_SCALE) * (2 - squash) * pulse, (1 / TEX_SCALE) * squash * pulse);
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

  /** Timed platforms and bombs (redrawn every frame). */
  private drawHazards(v: ViewState, timeMs: number): void {
    const g = this.hazards;
    g.clear();
    const top = VIEW.arenaY;
    const level = this.level;
    if (level) {
      const accent = level.theme.accent;
      for (const p of level.platforms) {
        if (!p.cycle) continue;
        const y = top + p.y;
        if (!platformActive(p, v.levelTicks)) {
          g.lineStyle(2, accent, 0.25);
          g.strokeRoundedRect(p.x, y, p.w, p.h, 5);
          continue;
        }
        const warn = platformVanishIn(p, v.levelTicks) < HAZARDS.platformWarnSeconds;
        const a = warn && Math.floor(timeMs / 90) % 2 ? 0.35 : 1;
        g.fillStyle(0x000000, 0.3 * a);
        g.fillRoundedRect(p.x + 3, y + 5, p.w, p.h, 5);
        g.fillStyle(accent, 0.55 * a);
        g.fillRoundedRect(p.x, y, p.w, p.h, 5);
        g.lineStyle(2, 0xffffff, 0.8 * a);
        g.strokeRoundedRect(p.x, y, p.w, p.h, 5);
        for (let sx = p.x + 8; sx < p.x + p.w - 8; sx += 16) {
          g.fillStyle(0xffffff, 0.6 * a);
          g.fillRect(sx, y + p.h / 2 - 1, 8, 2);
        }
      }
    }
    for (const k of v.bombs) {
      const r = HAZARDS.bombSize / 2;
      const y = top + k.y;
      const urgent = k.fuse < 1;
      const blink = Math.floor(timeMs / (urgent ? 60 : 160)) % 2 === 0;
      g.fillStyle(0x000000, 0.35);
      g.fillEllipse(k.x, top + WORLD.height - 2, r * 2, 6);
      g.fillStyle(0x1b1d2e, 1);
      g.fillCircle(k.x, y, r);
      g.lineStyle(2, blink ? 0xff3355 : 0x55597a, 1);
      g.strokeCircle(k.x, y, r);
      g.fillStyle(0xffffff, 0.35);
      g.fillCircle(k.x - r * 0.35, y - r * 0.35, r * 0.25);
      g.lineStyle(2, 0xd6b36a, 1);
      g.lineBetween(k.x, y - r, k.x + 4, y - r - 7);
      g.fillStyle(blink ? 0xffe066 : 0xff7a00, 1);
      g.fillCircle(k.x + 4, y - r - 8, 3);
      g.lineStyle(1, 0xff3355, 0.25 + (urgent ? 0.3 : 0));
      g.strokeCircle(k.x, y, (this.level?.bombs?.radius ?? 80));
    }
  }
}
