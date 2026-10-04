import Phaser from 'phaser';
import { BUBBLE_SIZES, CHAOS_KINDS, RARE, SKY, SPECIAL, WORLD, coopWindow, ghostStage, type SpecialKind } from '@orb/shared';
import { PLAYER_COLORS, VIEW } from '../config/clientConfig';
import type { ViewState } from '../game/types';
import { setLabel } from '../ui/text';
import { TEXT } from '../ui/theme';

/** Tint per special kind (orb body colour). Normal orbs keep the level's own colour. */
export const SPECIAL_COLOR: Record<SpecialKind, number> = {
  hardshell: 0x9aa7c7,
  ghost: 0xbfd8ff,
  twin: 0xffd166,
  sync: 0x4cc9f0,
  pincer: 0xff6bd6,
  heavy: 0x9b7653,
  sequence: 0x7ee081,
  quad: 0xb388ff,
  coop: 0x2ee6a6,
  link: 0xff9f1c,
  priority: 0xffe066,
};

export const RAGE_COLOR = 0xff3b30;

const popcount = (m: number) => {
  let c = 0;
  for (let x = m; x; x &= x - 1) c++;
  return c;
};

/**
 * Presentation for the gameplay systems that sit on top of plain orbs: special-orb rings and
 * timers, sky-event warnings, tethers between Lancers, heat glow. Pure drawing from ViewState;
 * it never decides anything.
 */
export class FxLayer {
  private g: Phaser.GameObjects.Graphics;
  private sky: Phaser.GameObjects.Graphics;
  private texts = new Map<string, Phaser.GameObjects.Text>();
  private skyText: Phaser.GameObjects.Text;
  private used = new Set<string>();

  constructor(private scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(17);
    this.sky = scene.add.graphics().setDepth(8);
    this.skyText = scene.add
      .text(VIEW.width / 2, VIEW.arenaY + 52, '', TEXT.display(13, '#ffe066'))
      .setOrigin(0.5)
      .setDepth(92)
      .setShadow(3, 3, '#000', 0, false, true);
  }

  clear(): void {
    this.g.clear();
    this.sky.clear();
    this.texts.forEach((t) => t.destroy());
    this.texts.clear();
    this.skyText.setText('');
  }

  private label(key: string, x: number, y: number, text: string, color: string, size: number): void {
    this.used.add(key);
    let t = this.texts.get(key);
    if (!t) {
      t = this.scene.add.text(0, 0, text, TEXT.display(size, color)).setOrigin(0.5).setDepth(18).setShadow(2, 2, '#000', 0, false, true);
      this.texts.set(key, t);
    }
    t.setPosition(x, y).setVisible(true);
    setLabel(t, text, color);
  }

  private arc(x: number, y: number, r: number, from: number, to: number, color: number, w: number, a = 1): void {
    this.g.lineStyle(w, color, a);
    this.g.beginPath();
    this.g.arc(x, y, r, from, to, false);
    this.g.strokePath();
  }

  update(v: ViewState, timeMs: number): void {
    const g = this.g;
    g.clear();
    this.used.clear();
    const top = VIEW.arenaY;
    const alive = v.players.filter((p) => p.active && p.life !== 'out').length;
    const pulse = 0.55 + 0.45 * Math.sin(timeMs / 130);
    const byId = new Map(v.bubbles.map((b) => [b.id, b]));
    // Next unlit number of each sequence set.
    const nextSeq = new Map<number, number>();
    for (const b of v.bubbles) if (b.sp === 'sequence' && (b.sa ?? 0) < 1) nextSeq.set(b.lk ?? 0, Math.min(nextSeq.get(b.lk ?? 0) ?? 99, b.n ?? 99));

    for (const b of v.bubbles) {
      const r = BUBBLE_SIZES[b.size].radius;
      const x = b.x;
      const y = top + b.y;
      if (b.frozen) {
        this.arc(x, y, r + 3, 0, Math.PI * 2, 0xdff9ff, 3, 0.9);
        this.arc(x, y, r - 3, 0, Math.PI * 2, 0xffffff, 1.5, 0.5);
      }
      if (b.hot) this.arc(x, y, r + 5, 0, Math.PI * 2, 0xff9f43, 2.5, 0.35 + 0.4 * pulse);
      switch (b.sp) {
        case 'hardshell':
          if (b.rage) {
            this.arc(x, y, r + 4, 0, Math.PI * 2, RAGE_COLOR, 3, 0.5 + 0.5 * pulse);
            this.label(`${b.id}:t`, x, y - r - 12, 'ENRAGED', '#ff6a5e', 7);
          } else {
            this.arc(x, y, r + 3, 0, Math.PI * 2, 0xe3e9f7, 3, 0.9);
            this.arc(x, y, r - 4, 0, Math.PI * 2, 0xe3e9f7, 1.5, 0.5);
          }
          break;
        case 'ghost': {
          const stage = ghostStage(b.sa ?? 0);
          if (stage === 'warn' && Math.floor(timeMs / 90) % 2 === 0) this.arc(x, y, r + 4, 0, Math.PI * 2, 0xffffff, 3, 0.9);
          else if (stage === 'ghostly') this.dashedRing(x, y, r + 3, 0xbfd8ff, timeMs);
          break;
        }
        case 'link': {
          const partner = b.lk !== undefined ? byId.get(b.lk) : undefined;
          if (partner && b.id < partner.id) {
            g.lineStyle(2, SPECIAL_COLOR.link, (partner.sa ?? 0) > 0 || (b.sa ?? 0) > 0 ? 0.95 : 0.55);
            g.lineBetween(x, y, partner.x, top + partner.y);
          }
          this.arc(x, y, r + 3, 0, Math.PI * 2, SPECIAL_COLOR.link, 2.5, 0.9);
          if ((b.sa ?? 0) > 0) {
            // This is the one on the clock: pulse hard and show the time left.
            this.arc(x, y, r + 11, 0, Math.PI * 2, SPECIAL_COLOR.link, 3, 0.3 + 0.5 * pulse);
            this.arc(x, y, r + 7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, (b.sa ?? 0) / SPECIAL.link.window), 0xffffff, 3, 0.95);
          }
          break;
        }
        case 'priority': {
          const left = b.sa ?? 0;
          const urgent = left > 0 && left < 4 && Math.floor(timeMs / 120) % 2 === 0;
          this.arc(x, y, r + 3, 0, Math.PI * 2, urgent ? 0xff5d5d : SPECIAL_COLOR.priority, 3.5, 0.95);
          this.arc(x, y, r + 10, 0, Math.PI * 2, SPECIAL_COLOR.priority, 2, 0.25 + 0.55 * pulse);
          if (left > 0) this.arc(x, y, r + 7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, left / SPECIAL.priority.window), 0xffffff, 3, 0.95);
          break;
        }
        case 'twin': {
          const partner = b.lk !== undefined ? byId.get(b.lk) : undefined;
          if (partner && b.id < partner.id) {
            g.lineStyle(2, 0xffd166, 0.6);
            g.lineBetween(x, y, partner.x, top + partner.y);
          }
          if ((b.sa ?? 0) > 0) {
            const total = alive <= 1 ? SPECIAL.twin.fuseSecondsSolo : SPECIAL.twin.fuseSeconds;
            this.arc(x, y, r + 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, (b.sa ?? 0) / total), 0xff3355, 4, 0.95);
            this.label(`${b.id}:t`, x, y - r - 13, String(Math.ceil(b.sa ?? 0)), '#ff6680', 11);
          } else this.arc(x, y, r + 2, 0, Math.PI * 2, 0xffd166, 2, 0.8);
          break;
        }
        case 'sync':
        case 'heavy':
        case 'quad':
        case 'coop': {
          const need = b.sp === 'coop' ? (b.n ?? SPECIAL.coop.defaultNeed) : b.sp === 'sync' ? 2 : b.sp === 'quad' ? 4 : Math.max(SPECIAL.heavy.minShooters, Math.ceil(alive / 2));
          const have = popcount(b.hm ?? 0);
          this.arc(x, y, r + 3, 0, Math.PI * 2, SPECIAL_COLOR[b.sp], 2.5, 0.9);
          // Coop: once one Lancer has landed a hit, the orb pulses to say it is ready for the next.
          if (b.sp === 'coop' && have > 0) this.arc(x, y, r + 11, 0, Math.PI * 2, SPECIAL_COLOR.coop, 3, 0.3 + 0.5 * pulse);
          this.pips(x, y + r + 9, need, have, SPECIAL_COLOR[b.sp]);
          if ((b.sa ?? 0) > 0) {
            const total = b.sp === 'coop' ? coopWindow(b.n ?? 2) : b.sp === 'sync' ? (alive <= 1 ? SPECIAL.sync.windowSolo : SPECIAL.sync.window) : b.sp === 'quad' ? SPECIAL.quad.window : SPECIAL.heavy.window;
            this.arc(x, y, r + 7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, (b.sa ?? 0) / total), 0xffffff, 3, 0.9);
          }
          break;
        }
        case 'pincer': {
          const mask = b.hm ?? 0;
          // Left and right halves light up as each side is hit; the centre line is a no-score zone for teams.
          this.arc(x, y, r + 3, Math.PI / 2, (Math.PI * 3) / 2, mask & 1 ? 0xffffff : SPECIAL_COLOR.pincer, mask & 1 ? 5 : 2.5, 0.95);
          this.arc(x, y, r + 3, -Math.PI / 2, Math.PI / 2, mask & 2 ? 0xffffff : SPECIAL_COLOR.pincer, mask & 2 ? 5 : 2.5, 0.95);
          g.lineStyle(1, 0xffffff, 0.35);
          g.lineBetween(x, y - r, x, y + r);
          if ((b.sa ?? 0) > 0) {
            const total = alive <= 1 ? SPECIAL.pincer.windowSolo : SPECIAL.pincer.window;
            this.arc(x, y, r + 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, (b.sa ?? 0) / total), 0xffffff, 3, 0.9);
          }
          break;
        }
        case 'sequence': {
          const lit = (b.sa ?? 0) >= 1;
          const next = nextSeq.get(b.lk ?? 0) === b.n;
          if (lit) this.arc(x, y, r + 3, 0, Math.PI * 2, 0x5cf2a0, 4, 0.95);
          else if (next) this.arc(x, y, r + 3 + pulse * 2, 0, Math.PI * 2, 0xffffff, 3, 0.9);
          this.label(`${b.id}:n`, x, y, lit ? '✓' : String(b.n ?? ''), lit ? '#5cf2a0' : '#ffffff', r > 14 ? 14 : 10);
          break;
        }
      }
    }

    // Baton: the holder pulses and the ring runs down, so teammates see the window to pop an orb.
    if (v.baton) {
      const holder = v.players[v.baton.owner];
      if (holder && holder.active && holder.life === 'alive') {
        const yy = VIEW.arenaBottom - 22;
        this.arc(holder.x, yy, 30, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, v.baton.t / RARE.batonSeconds), 0x4cc9f0, 4, 0.95);
        this.arc(holder.x, yy, 36, 0, Math.PI * 2, 0x4cc9f0, 2, 0.25 + 0.5 * pulse);
      }
    }

    // Tether between linked Lancers.
    for (const p of v.players) {
      if (p.fx > 0 && CHAOS_KINDS[p.fx - 1] === 'tether' && p.fxP > p.slot) {
        const q = v.players[p.fxP];
        if (q) {
          const yy = VIEW.arenaBottom - 22;
          g.lineStyle(3, 0xe879f9, 0.85);
          g.lineBetween(p.x, yy, q.x, yy);
          g.lineStyle(1, 0xffffff, 0.8);
          g.lineBetween(p.x, yy - 1, q.x, yy - 1);
          void PLAYER_COLORS;
        }
      }
    }

    for (const [k, t] of this.texts) if (!this.used.has(k)) (t.destroy(), this.texts.delete(k));
    this.drawSky(v, timeMs);
  }

  private pips(x: number, y: number, need: number, have: number, color: number): void {
    const gap = 9;
    const x0 = x - ((need - 1) * gap) / 2;
    for (let i = 0; i < need; i++) {
      this.g.fillStyle(i < have ? 0xffffff : 0x000000, i < have ? 1 : 0.55);
      this.g.fillCircle(x0 + i * gap, y, 3.4);
      this.g.lineStyle(1.5, color, 1);
      this.g.strokeCircle(x0 + i * gap, y, 3.4);
    }
  }

  private dashedRing(x: number, y: number, r: number, color: number, timeMs: number): void {
    const n = 14;
    const rot = timeMs / 700;
    for (let i = 0; i < n; i += 2) this.arc(x, y, r, rot + (i / n) * Math.PI * 2, rot + ((i + 1) / n) * Math.PI * 2, color, 2, 0.8);
  }

  /** Warnings for the one sky event in progress. */
  private drawSky(v: ViewState, timeMs: number): void {
    const g = this.sky;
    g.clear();
    if (v.slow > 0) {
      g.fillStyle(0x6fa8ff, 0.07);
      g.fillRect(0, VIEW.arenaY, WORLD.width, WORLD.height);
      this.label('slowT', VIEW.width / 2, VIEW.arenaY + 20, `SLOW ORBS ${Math.ceil(v.slow)}`, '#9cc2ff', 9);
    }
    const s = v.sky;
    if (!s) {
      this.skyText.setText('');
      return;
    }
    const top = VIEW.arenaY;
    const bottom = VIEW.arenaBottom;
    const flash = Math.floor(timeMs / 120) % 2 === 0;
    const beam = (x: number, w: number, color: number) => {
      g.fillStyle(color, flash ? 0.22 : 0.1);
      g.fillRect(x - w / 2, top, w, WORLD.height);
      g.lineStyle(2, color, 0.8);
      for (let y = top + 6; y < bottom; y += 18) g.lineBetween(x, y, x, y + 9);
    };
    const warn = (x: number, color: number) => {
      g.fillStyle(color, 1);
      g.fillTriangle(x - 12, top + 6, x + 12, top + 6, x, top + 28);
      g.fillStyle(0x000000, 1);
      g.fillRect(x - 1.5, top + 10, 3, 9);
      g.fillCircle(x, top + 22, 1.8);
    };
    if (s.kind === 'gift') {
      beam(s.a, 30, 0xffe066);
      warn(s.a, 0xffe066);
      setLabel(this.skyText, 'SUPPLY DROP!', '#ffe066');
    } else if (s.kind === 'comet') {
      const fromLeft = s.a > 0;
      const x = fromLeft ? 30 : WORLD.width - 30;
      g.fillStyle(0xff3355, flash ? 0.9 : 0.5);
      g.fillTriangle(x + (fromLeft ? 26 : -26), top + 60, x, top + 40, x, top + 80);
      warn(x, 0xff3355);
      g.lineStyle(2, 0xff3355, 0.5);
      g.lineBetween(x, top + 60, fromLeft ? WORLD.width : 0, top + 60);
      setLabel(this.skyText, 'COMET!', '#ff6680');
    } else if (s.kind === 'hail') {
      for (const x of s.lanes) {
        beam(x, 24, 0x7fd8ff);
        warn(x, 0x7fd8ff);
      }
      setLabel(this.skyText, 'HAIL INCOMING!', '#9fe3ff');
    } else if (s.kind === 'wobble') {
      if (s.phase === 'warn') setLabel(this.skyText, 'GRAVITY SHIFT…', '#b9a7ff');
      else {
        g.fillStyle(0x7a5cff, 0.07 + 0.03 * Math.sin(timeMs / 300));
        g.fillRect(0, top, WORLD.width, WORLD.height);
        const w = 240 * Math.min(1, s.t / SKY.wobbleSeconds);
        g.fillStyle(0xb9a7ff, 0.9);
        g.fillRect(WORLD.width / 2 - 120, top + 74, w, 4);
        setLabel(this.skyText, 'LOW GRAVITY', '#b9a7ff');
      }
    }
  }
}
