import Phaser from 'phaser';
import { TICK_RATE, type PowerUpType } from '@orb/shared';
import { TEXTURES, TEX_SCALE } from '../assets/textures';
import { PLAYER_COLORS, PLAYER_CSS, VIEW } from '../config/clientConfig';
import type { ViewPlayer, ViewState } from '../game/types';
import { COLORS, TEXT } from './theme';

const MAX_HEARTS = 5;
const TIMED: { key: 'shield' | 'speed' | 'dbl'; type: PowerUpType }[] = [
  { key: 'shield', type: 'shield' },
  { key: 'dbl', type: 'doubleHarpoon' },
  { key: 'speed', type: 'speedBoost' },
];

interface Side {
  name: Phaser.GameObjects.Text;
  score: Phaser.GameObjects.Text;
  hearts: Phaser.GameObjects.Image[];
  more: Phaser.GameObjects.Text;
  status: Phaser.GameObjects.Text;
  pu: Phaser.GameObjects.Image[];
  puBars: Phaser.GameObjects.Graphics;
  shownScore: number;
}

/**
 * Top bar: P1 (left) · timer + level (center) · P2 (right), with lives,
 * scores and active power-ups. Network status sits in the footer.
 */
export class Hud {
  private sides: Side[];
  private timer: Phaser.GameObjects.Text;
  private levelText: Phaser.GameObjects.Text;
  private net: Phaser.GameObjects.Text;

  constructor(private scene: Phaser.Scene) {
    const g = scene.add.graphics().setDepth(50);
    g.fillGradientStyle(0x10163d, 0x10163d, 0x070a1f, 0x070a1f, 1);
    g.fillRect(0, 0, VIEW.width, VIEW.hudHeight);
    g.fillStyle(0x2e3b8c, 1);
    g.fillRect(0, VIEW.hudHeight - 3, VIEW.width, 3);
    g.fillStyle(0x1a2357, 1);
    g.fillRoundedRect(VIEW.width / 2 - 92, 6, 184, 52, 10);
    PLAYER_COLORS.forEach((c, i) => {
      g.fillStyle(c, 1);
      g.fillRect(i === 0 ? 0 : VIEW.width - 6, 0, 6, VIEW.hudHeight - 3);
    });

    this.sides = [0, 1].map((slot) => this.makeSide(slot));
    this.timer = scene.add.text(VIEW.width / 2, 38, '0:00', TEXT.display(20)).setOrigin(0.5).setDepth(51);
    this.levelText = scene.add.text(VIEW.width / 2, 15, '', TEXT.display(8, COLORS.textDim)).setOrigin(0.5).setDepth(51);
    this.net = scene.add.text(VIEW.width - 12, VIEW.height - 10, '', TEXT.body(14, COLORS.textDim)).setOrigin(1, 1).setDepth(51);
  }

  private makeSide(slot: number): Side {
    const s = this.scene;
    const left = slot === 0;
    const x = left ? 18 : VIEW.width - 18;
    const ox = left ? 0 : 1;
    const name = s.add.text(x, 8, '', TEXT.display(10, PLAYER_CSS[slot])).setOrigin(ox, 0).setDepth(51);
    const score = s.add.text(left ? 330 : VIEW.width - 330, 10, '0', TEXT.display(18)).setOrigin(left ? 1 : 0, 0).setDepth(51);
    const hearts = Array.from({ length: MAX_HEARTS }, (_, i) =>
      s.add.image(x + (left ? 1 : -1) * (8 + i * 19), 38, TEXTURES.heart).setScale(1 / TEX_SCALE).setDepth(51),
    );
    const more = s.add.text(x + (left ? 1 : -1) * (MAX_HEARTS * 19 + 4), 38, '', TEXT.display(9)).setOrigin(ox, 0.5).setDepth(51);
    const status = s.add.text(x, 38, '', TEXT.display(9, COLORS.textDim)).setOrigin(ox, 0.5).setDepth(51);
    const pu = TIMED.map((t, i) =>
      s.add.image((left ? 230 : VIEW.width - 230) + (left ? 1 : -1) * i * 30, 42, TEXTURES.powerUp(t.type)).setScale(0.8 / TEX_SCALE).setDepth(51),
    );
    const puBars = s.add.graphics().setDepth(52);
    return { name, score, hearts, more, status, pu, puBars, shownScore: 0 };
  }

  update(v: ViewState, names: string[], localSlot: number, mode: 'solo' | 'online', levelName: string, levelCount: number, seatInfo?: { connected: boolean; active: boolean }[]): void {
    const secs = Math.max(0, Math.ceil(v.timeLeftTicks / TICK_RATE));
    this.timer.setText(`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`);
    const low = secs <= 10 && v.phase === 'playing';
    this.timer.setColor(low ? COLORS.bad : COLORS.text);
    this.timer.setScale(low ? 1 + 0.08 * Math.abs(Math.sin(this.scene.time.now / 160)) : 1);
    this.levelText.setText(`LEVEL ${v.levelIndex + 1}/${levelCount}`);
    this.levelText.setData('name', levelName);

    this.sides.forEach((side, slot) => {
      const p: ViewPlayer | undefined = v.players[slot];
      const seat = seatInfo?.[slot];
      const present = !!p && (mode === 'solo' ? slot === 0 : !!seat);
      const isSolo = mode === 'solo' && slot === 1;
      side.name.setText(isSolo ? '' : present ? `${slot === localSlot ? '★ ' : ''}${(names[slot] ?? `P${slot + 1}`).toUpperCase()}` : `P${slot + 1}`);
      let status = '';
      if (isSolo) status = '';
      else if (!present) status = mode === 'online' ? 'WAITING…' : '';
      else if (seat && !seat.connected) status = 'DISCONNECTED';
      else if (p && !p.active) status = 'SITTING OUT';
      else if (p?.life === 'out') status = 'KNOCKED OUT';
      side.status.setText(status);

      const showStats = present && !!p && p.active && !isSolo;
      const lives = showStats && !status ? p.lives : 0;
      side.hearts.forEach((h, i) => h.setVisible(i < Math.min(lives, MAX_HEARTS)));
      side.more.setText(lives > MAX_HEARTS ? `+${lives - MAX_HEARTS}` : '');
      // rolling score counter
      const target = present && p ? p.score : 0;
      const step = (target - side.shownScore) * 0.25;
      side.shownScore += step > 0 ? Math.ceil(step) : Math.floor(step);
      if (Math.abs(target - side.shownScore) < 2) side.shownScore = target;
      side.score.setText(present && !isSolo ? String(side.shownScore).padStart(6, '0') : '');

      side.puBars.clear();
      TIMED.forEach((t, i) => {
        const remaining = showStats ? p![t.key] : 0;
        const icon = side.pu[i];
        icon.setVisible(remaining > 0);
        if (remaining > 0) {
          icon.setAlpha(remaining < 3 && Math.floor(this.scene.time.now / 120) % 2 ? 0.35 : 1);
          side.puBars.fillStyle(0xffffff, 0.8);
          side.puBars.fillRect(icon.x - 10, 56, 20 * Math.min(1, remaining / 15), 3);
        }
      });
    });
  }

  setNet(text: string, color: string): void {
    this.net.setText(text).setColor(color);
  }
}
