import Phaser from 'phaser';
import { HAZARDS, Rng, WORLD, type LevelConfig } from '@orb/shared';
import { shade } from '../assets/textures';
import { VIEW } from '../config/clientConfig';

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Static level visuals: sky, procedural skyline, platforms, floor. Rebuilt per level. */
export class ArenaView {
  private layer: Phaser.GameObjects.Container;
  private twinkles: Phaser.Tweens.Tween[] = [];

  constructor(private scene: Phaser.Scene) {
    this.layer = scene.add.container(0, 0).setDepth(0);
  }

  build(level: LevelConfig): void {
    this.layer.removeAll(true);
    this.twinkles.forEach((t) => t.remove());
    this.twinkles = [];
    const s = this.scene;
    const { sky, accent } = level.theme;
    const top = VIEW.arenaY;
    const bottom = VIEW.arenaBottom;
    const rng = new Rng(hash(level.id));

    const g = s.add.graphics();
    g.fillGradientStyle(sky[0], sky[0], sky[1], sky[1], 1);
    g.fillRect(0, top, WORLD.width, WORLD.height);
    this.layer.add(g);

    // stars
    for (let i = 0; i < 45; i++) {
      const star = s.add.circle(rng.next() * WORLD.width, top + rng.next() * WORLD.height * 0.6, rng.next() * 1.4 + 0.4, 0xffffff, 0.6);
      this.layer.add(star);
      this.twinkles.push(s.tweens.add({ targets: star, alpha: 0.1, duration: 700 + rng.next() * 1800, yoyo: true, repeat: -1 }));
    }
    // big moon/planet
    const moonX = 120 + rng.next() * 720;
    const moon = s.add.circle(moonX, top + 70 + rng.next() * 40, 34 + rng.next() * 18, shade(sky[1], 0.35), 0.35);
    this.layer.add(moon);

    // two parallax-ish skyline layers (procedural, original)
    const sil = s.add.graphics();
    const layers = [
      { color: shade(sky[1], -0.25), base: bottom - 40, hMin: 40, hMax: 150, wMin: 30, wMax: 80 },
      { color: shade(sky[1], -0.45), base: bottom, hMin: 30, hMax: 100, wMin: 40, wMax: 110 },
    ];
    for (const L of layers) {
      sil.fillStyle(L.color, 1);
      let x = -20;
      while (x < WORLD.width + 20) {
        const w = L.wMin + rng.next() * (L.wMax - L.wMin);
        const h = L.hMin + rng.next() * (L.hMax - L.hMin);
        if (rng.next() < 0.5) sil.fillRoundedRect(x, L.base - h, w, h + 40, { tl: w / 2, tr: w / 2, bl: 0, br: 0 });
        else sil.fillRect(x, L.base - h, w, h + 40);
        if (rng.next() < 0.4) {
          sil.fillStyle(shade(accent, -0.2), 0.35);
          for (let wy = L.base - h + 10; wy < L.base - 10; wy += 16) sil.fillRect(x + w / 2 - 3, wy, 6, 6);
          sil.fillStyle(L.color, 1);
        }
        x += w + rng.next() * 18;
      }
    }
    sil.fillStyle(0x000000, 0.18);
    sil.fillRect(0, top, WORLD.width, WORLD.height);
    this.layer.add(sil);

    // subtle grid glow near the floor
    const grid = s.add.graphics();
    grid.lineStyle(1, accent, 0.12);
    for (let x = 0; x <= WORLD.width; x += 48) grid.lineBetween(x, bottom - 120, x, bottom);
    for (let y = bottom - 120; y <= bottom; y += 24) grid.lineBetween(0, y, WORLD.width, y);
    this.layer.add(grid);

    // static platforms (timed ones are drawn per frame by WorldLayers)
    const pg = s.add.graphics();
    for (const p of level.platforms.filter((q) => !q.cycle)) {
      const x = p.x;
      const y = top + p.y;
      pg.fillStyle(0x000000, 0.3);
      pg.fillRoundedRect(x + 3, y + 5, p.w, p.h, 5);
      pg.fillStyle(shade(accent, -0.55), 1);
      pg.fillRoundedRect(x, y, p.w, p.h, 5);
      pg.fillStyle(accent, 1);
      pg.fillRoundedRect(x, y, p.w, Math.min(6, p.h), { tl: 5, tr: 5, bl: 0, br: 0 });
      pg.fillStyle(0xffffff, 0.35);
      pg.fillRect(x + 4, y + 1, p.w - 8, 1.5);
      pg.fillStyle(shade(accent, -0.25), 1);
      for (let sx = x + 10; sx < x + p.w - 6; sx += 22) pg.fillCircle(sx, y + p.h - 4.5, 2);
    }
    this.layer.add(pg);

    // floor
    const f = s.add.graphics();
    f.fillStyle(0x0a0e26, 1);
    f.fillRect(0, bottom, WORLD.width, VIEW.height - bottom);
    f.fillStyle(accent, 1);
    f.fillRect(0, bottom, WORLD.width, 4);
    f.fillStyle(shade(accent, -0.6), 1);
    for (let x = -20; x < WORLD.width; x += 28) f.fillTriangle(x, VIEW.height, x + 14, bottom + 4, x + 28, VIEW.height);
    f.fillStyle(0x000000, 0.35);
    f.fillRect(0, bottom + 4, WORLD.width, VIEW.height - bottom);
    this.layer.add(f);

    // floor spikes
    const sg = s.add.graphics();
    for (const sp of level.spikes ?? []) {
      sg.fillStyle(0xff3355, 0.18);
      sg.fillRect(sp.x, bottom - HAZARDS.spikeHeight - 6, sp.w, HAZARDS.spikeHeight + 6);
      const n = Math.max(1, Math.round(sp.w / 12));
      const w = sp.w / n;
      for (let i = 0; i < n; i++) {
        const x0 = sp.x + i * w;
        sg.fillStyle(0xd9d9e8, 1);
        sg.fillTriangle(x0, bottom, x0 + w, bottom, x0 + w / 2, bottom - HAZARDS.spikeHeight);
        sg.fillStyle(0xff3355, 1);
        sg.fillTriangle(x0 + w * 0.35, bottom - HAZARDS.spikeHeight * 0.55, x0 + w * 0.65, bottom - HAZARDS.spikeHeight * 0.55, x0 + w / 2, bottom - HAZARDS.spikeHeight);
      }
    }
    this.layer.add(sg);

    // frame
    const fr = s.add.graphics();
    fr.lineStyle(3, shade(accent, -0.3), 0.9);
    fr.strokeRect(1.5, top, WORLD.width - 3, WORLD.height);
    this.layer.add(fr);
  }
}
