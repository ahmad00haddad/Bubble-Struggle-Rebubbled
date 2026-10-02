import Phaser from 'phaser';
import { TICK_RATE, type PowerUpType } from '@orb/shared';
import { TEXTURES, TEX_SCALE } from '../assets/textures';
import { PLAYER_COLORS, PLAYER_CSS, VIEW } from '../config/clientConfig';
import type { ViewPlayer, ViewState } from '../game/types';
import { setLabel } from './text';
import { COLORS, TEXT } from './theme';

const MAX_HEARTS = 5;
const TIMED: { key: 'shield' | 'speed' | 'dbl'; type: PowerUpType }[] = [
  { key: 'shield', type: 'shield' },
  { key: 'dbl', type: 'doubleHarpoon' },
  { key: 'speed', type: 'speedBoost' },
];

interface Row {
  name: Phaser.GameObjects.Text;
  score: Phaser.GameObjects.Text;
  hearts: Phaser.GameObjects.Image[];
  more: Phaser.GameObjects.Text;
  status: Phaser.GameObjects.Text;
  pu: Phaser.GameObjects.Image[];
  puBars: Phaser.GameObjects.Graphics;
  stripe: Phaser.GameObjects.Rectangle;
  shownScore: number;
}

/**
 * Top bar for up to 4 Lancers: slots 0 and 2 on the left, 1 and 3 on the
 * right, timer and level in the middle. With 2 or fewer players each side
 * uses one tall row; with 3–4 players rows stack.
 */
export class Hud {
  private rows: Row[];
  private timer: Phaser.GameObjects.Text;
  private levelText: Phaser.GameObjects.Text;
  private net: Phaser.GameObjects.Text;
  private heat: Phaser.GameObjects.Graphics;
  private heatText: Phaser.GameObjects.Text;

  constructor(private scene: Phaser.Scene) {
    const g = scene.add.graphics().setDepth(50);
    g.fillGradientStyle(0x10163d, 0x10163d, 0x070a1f, 0x070a1f, 1);
    g.fillRect(0, 0, VIEW.width, VIEW.hudHeight);
    g.fillStyle(0x2e3b8c, 1);
    g.fillRect(0, VIEW.hudHeight - 3, VIEW.width, 3);
    g.fillStyle(0x1a2357, 1);
    g.fillRoundedRect(VIEW.width / 2 - 92, 6, 184, 52, 10);

    this.rows = PLAYER_COLORS.map((_, slot) => this.makeRow(slot));
    this.timer = scene.add.text(VIEW.width / 2, 38, '0:00', TEXT.display(20)).setOrigin(0.5).setDepth(51);
    this.levelText = scene.add.text(VIEW.width / 2, 15, '', TEXT.display(8, COLORS.textDim)).setOrigin(0.5).setDepth(51);
    this.heat = scene.add.graphics().setDepth(52);
    this.heatText = scene.add.text(VIEW.width / 2, 63, '', TEXT.display(6, '#ff9f43')).setOrigin(0.5, 1).setDepth(53);
    this.net = scene.add.text(VIEW.width - 12, VIEW.height - 10, '', TEXT.body(14, COLORS.textDim)).setOrigin(1, 1).setDepth(51);
  }

  private makeRow(slot: number): Row {
    const s = this.scene;
    const left = slot % 2 === 0;
    const ox = left ? 0 : 1;
    const name = s.add.text(0, 0, '', TEXT.display(9, PLAYER_CSS[slot])).setOrigin(ox, 0.5).setDepth(51);
    const score = s.add.text(0, 0, '', TEXT.display(13)).setOrigin(left ? 1 : 0, 0.5).setDepth(51);
    const hearts = Array.from({ length: MAX_HEARTS }, () => s.add.image(0, 0, TEXTURES.heart).setScale(0.8 / TEX_SCALE).setDepth(51));
    const more = s.add.text(0, 0, '', TEXT.display(8)).setOrigin(ox, 0.5).setDepth(51);
    const status = s.add.text(0, 0, '', TEXT.display(8, COLORS.textDim)).setOrigin(ox, 0.5).setDepth(51);
    const pu = TIMED.map((t) => s.add.image(0, 0, TEXTURES.powerUp(t.type)).setScale(0.65 / TEX_SCALE).setDepth(51));
    const puBars = s.add.graphics().setDepth(52);
    const stripe = s.add.rectangle(left ? 3 : VIEW.width - 3, 0, 6, 26, PLAYER_COLORS[slot]).setDepth(51);
    return { name, score, hearts, more, status, pu, puBars, stripe, shownScore: 0 };
  }

  /** Places one row at vertical center y. */
  private layout(row: Row, slot: number, y: number): void {
    const left = slot % 2 === 0;
    const dir = left ? 1 : -1;
    const at = (dx: number) => (left ? dx : VIEW.width - dx);
    row.stripe.setPosition(at(3), y);
    row.name.setPosition(at(14), y);
    row.hearts.forEach((h, i) => h.setPosition(at(132) + dir * i * 15, y));
    row.more.setPosition(at(132) + dir * MAX_HEARTS * 15, y);
    row.status.setPosition(at(132), y);
    row.pu.forEach((p, i) => p.setPosition(at(232) + dir * i * 24, y));
    row.score.setPosition(at(378), y);
  }

  update(
    v: ViewState,
    names: string[],
    localSlot: number,
    mode: 'solo' | 'online',
    levelName: string,
    levelCount: number,
    seatInfo?: { connected: boolean; active: boolean; present: boolean }[],
  ): void {
    const secs = Math.max(0, Math.ceil(v.timeLeftTicks / TICK_RATE));
    this.timer.setText(`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`);
    const low = secs <= 10 && v.phase === 'playing';
    setLabel(this.timer, this.timer.text, low ? COLORS.bad : COLORS.text);
    this.timer.setScale(low ? 1 + 0.08 * Math.abs(Math.sin(this.scene.time.now / 160)) : 1);
    this.drawHeat(v);
    this.levelText.setText(`LEVEL ${v.levelIndex + 1}/${levelCount}`);
    this.levelText.setData('name', levelName);

    const present = (slot: number) => (mode === 'solo' ? slot === 0 : !!seatInfo?.[slot]?.present || !!v.players[slot]?.active);
    const compact = present(2) || present(3);

    this.rows.forEach((row, slot) => {
      const lower = slot >= 2;
      const visible = mode === 'solo' ? slot === 0 : compact || !lower;
      const objs = [row.name, row.score, row.more, row.status, row.stripe, ...row.hearts, ...row.pu];
      objs.forEach((o) => o.setVisible(visible));
      row.puBars.clear();
      if (!visible) return;
      this.layout(row, slot, compact ? (lower ? 46 : 18) : 30);

      const p: ViewPlayer | undefined = v.players[slot];
      const seat = seatInfo?.[slot];
      const here = present(slot);
      row.name.setText(here ? `${slot === localSlot ? '★ ' : ''}${(names[slot] ?? `P${slot + 1}`).toUpperCase()}`.slice(0, 13) : `P${slot + 1}`);
      let status = '';
      if (!here) status = mode === 'online' ? 'OPEN SEAT' : '';
      else if (seat && !seat.connected) status = 'DISCONNECTED';
      else if (p && !p.active) status = 'SITTING OUT';
      else if (p?.life === 'out') status = 'KNOCKED OUT';
      row.status.setText(status);

      const live = here && !!p && p.active && !status;
      const lives = live ? p!.lives : 0;
      row.hearts.forEach((h, i) => h.setVisible(i < Math.min(lives, MAX_HEARTS)));
      row.more.setText(lives > MAX_HEARTS ? `+${lives - MAX_HEARTS}` : '');

      const target = here && p ? p.score : 0;
      const step = (target - row.shownScore) * 0.25;
      row.shownScore += step > 0 ? Math.ceil(step) : Math.floor(step);
      if (Math.abs(target - row.shownScore) < 2) row.shownScore = target;
      row.score.setText(here ? String(row.shownScore).padStart(6, '0') : '');

      TIMED.forEach((t, i) => {
        const remaining = live ? p![t.key] : 0;
        const icon = row.pu[i];
        icon.setVisible(remaining > 0);
        if (remaining > 0) {
          icon.setAlpha(remaining < 3 && Math.floor(this.scene.time.now / 120) % 2 ? 0.35 : 1);
          row.puBars.fillStyle(0xffffff, 0.8);
          row.puBars.fillRect(icon.x - 8, icon.y + 10, 16 * Math.min(1, remaining / 15), 2);
        }
      });
    });
  }

  /** Heat meter under the timer: fills as the team pops fast, flashes red once the governor is on. */
  private drawHeat(v: ViewState): void {
    const g = this.heat;
    g.clear();
    const live = v.phase === 'playing' && v.heat > 0.04;
    this.heatText.setText(live && v.heat >= 1 ? 'OVERHEAT' : live ? 'HEAT' : '');
    if (!live) return;
    const w = 164;
    const x = VIEW.width / 2 - w / 2;
    const hot = v.heat >= 1;
    const flash = hot && Math.floor(this.scene.time.now / 140) % 2 === 0;
    g.fillStyle(0x000000, 0.6);
    g.fillRect(x, 56, w, 5);
    g.fillStyle(hot ? (flash ? 0xffffff : 0xff3355) : 0xffb347, 1);
    g.fillRect(x, 56, w * Math.min(1, v.heat / 1.6), 5);
    g.fillStyle(0xffffff, 0.9);
    g.fillRect(x + w / 1.6 - 1, 54, 2, 9);
  }

  setNet(text: string, color: string): void {
    setLabel(this.net, text, color);
  }
}
