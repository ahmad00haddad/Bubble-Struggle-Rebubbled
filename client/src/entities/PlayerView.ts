import Phaser from 'phaser';
import { CHAOS_KINDS } from '@orb/shared';
import { LANCER_FRAMES, TEXTURES, TEX_SCALE } from '../assets/textures';
import { PLAYER_COLORS, PLAYER_CSS, VIEW } from '../config/clientConfig';
import type { ViewPlayer } from '../game/types';
import { TEXT } from '../ui/theme';

/** Visual representation of one Lancer. Pure presentation — no game logic. */
export class PlayerView {
  readonly root: Phaser.GameObjects.Container;
  private sprite: Phaser.GameObjects.Image;
  private ring: Phaser.GameObjects.Image;
  private tag: Phaser.GameObjects.Text;
  private fxText: Phaser.GameObjects.Text;
  private anchorRing: Phaser.GameObjects.Image;
  private lastX = NaN;
  private walkClock = 0;
  private wasDead = false;

  constructor(
    private scene: Phaser.Scene,
    readonly slot: number,
  ) {
    this.sprite = scene.add.image(0, 0, TEXTURES.lancer(slot, LANCER_FRAMES.idle)).setOrigin(0.5, 1).setScale(1 / TEX_SCALE);
    this.ring = scene.add.image(0, -24, TEXTURES.ring).setTint(0x7ff3ff).setAlpha(0.8).setScale(0.95).setBlendMode(Phaser.BlendModes.ADD);
    this.tag = scene.add
      .text(0, -66, '', TEXT.display(9, PLAYER_CSS[slot]))
      .setOrigin(0.5)
      .setShadow(2, 2, '#000', 0, false, true);
    this.fxText = scene.add.text(0, -80, '', TEXT.display(8, '#e879f9')).setOrigin(0.5).setShadow(2, 2, '#000', 0, false, true);
    this.anchorRing = scene.add.image(0, -24, TEXTURES.ring).setTint(0xff9f43).setAlpha(0.7).setScale(1.1).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    this.root = scene.add.container(0, VIEW.arenaBottom, [this.anchorRing, this.ring, this.sprite, this.tag, this.fxText]).setDepth(20);
    scene.tweens.add({ targets: this.ring, scale: 1.05, duration: 500, yoyo: true, repeat: -1 });
  }

  update(p: ViewPlayer | undefined, name: string, isLocal: boolean, dtMs: number, timeMs: number): void {
    if (!p || !p.active || p.life === 'out') {
      this.root.setVisible(false);
      this.lastX = NaN;
      return;
    }
    this.root.setVisible(true);
    this.root.x = p.x;
    this.tag.setText(isLocal ? `${name}\n▼` : name).setAlign('center');

    const dead = p.life === 'dead';
    const moved = Number.isFinite(this.lastX) && Math.abs(p.x - this.lastX) > 0.25;
    this.lastX = p.x;

    let frame: number = LANCER_FRAMES.idle;
    if (dead) frame = LANCER_FRAMES.hurt;
    else if (moved) {
      this.walkClock += dtMs;
      frame = Math.floor(this.walkClock / 110) % 2 === 0 ? LANCER_FRAMES.walkA : LANCER_FRAMES.walkB;
    } else {
      this.walkClock = 0;
    }
    this.sprite.setTexture(TEXTURES.lancer(this.slot, frame));
    this.sprite.setFlipX(p.facing < 0);

    // idle breathing / walking bounce
    const bob = dead ? 0 : moved ? Math.abs(Math.sin(this.walkClock / 55)) * -2 : Math.sin(timeMs / 380) * 0.8;
    this.sprite.y = bob;

    if (dead) {
      if (!this.wasDead) {
        this.scene.tweens.add({ targets: this.sprite, y: -38, duration: 260, yoyo: true, ease: 'Quad.easeOut' });
        this.sprite.setTint(0xff9aa8);
      }
      this.sprite.setAlpha(0.45 + 0.25 * Math.sin(timeMs / 70));
      this.sprite.setAngle(p.facing < 0 ? 18 : -18);
    } else {
      this.sprite.clearTint();
      this.sprite.setAngle(0);
      this.sprite.setAlpha(p.invuln ? (Math.floor(timeMs / 80) % 2 ? 0.35 : 1) : 1);
    }
    this.wasDead = dead;

    this.ring.setVisible(p.shield > 0 && !dead);
    if (p.shield > 0 && p.shield < 3) this.ring.setAlpha(Math.floor(timeMs / 120) % 2 ? 0.25 : 0.8);
    else this.ring.setAlpha(0.8);

    // speed boost: warm glow; double harpoon: violet edge
    if (!dead && p.speed > 0) this.sprite.setTint(0xffffff, 0xffffff, 0xfff0a0, 0xfff0a0);

    // Chaos effect: purple tint and a label; loaded Anchor: orange ring.
    const fxName = p.fx > 0 ? CHAOS_KINDS[p.fx - 1].toUpperCase() : '';
    if (!dead && p.fx > 0) this.sprite.setTint(0xe9a8ff);
    const loaded = !dead && (p.anchor > 0 || p.boom > 0);
    this.anchorRing.setVisible(loaded).setAlpha(0.5 + 0.3 * Math.sin(timeMs / 140));
    const tags: string[] = [];
    if (p.potato > 0) tags.push('POTATO');
    if (p.boots > 0) tags.push('BOOTS');
    if (p.wide > 0) tags.push('WIDE');
    if (p.mag > 0) tags.push('MAGNET');
    if (p.boom > 0) tags.push('BOOMERANG');
    else if (loaded) tags.push('ANCHOR');
    if (p.don === 1) tags.push('DOUBLE?');
    if (p.sx > 0) tags.push('x2');
    this.fxText.setText(dead ? '' : fxName ? `${fxName}!` : tags.slice(0, 2).join(' ')).setColor(fxName ? '#e879f9' : '#ff9f43');
  }

  get color(): number {
    return PLAYER_COLORS[this.slot];
  }
}
