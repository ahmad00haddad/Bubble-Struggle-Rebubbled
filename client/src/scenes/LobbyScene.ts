import Phaser from 'phaser';
import type { RoomInfo } from '@orb/shared';
import { LANCER_FRAMES, TEXTURES, TEX_SCALE } from '../assets/textures';
import { audio } from '../audio/AudioManager';
import { PLAYER_COLORS, PLAYER_CSS, VIEW } from '../config/clientConfig';
import { getSettings } from '../config/settings';
import type { NetSession } from '../networking/NetSession';
import { Button, ButtonGroup } from '../ui/Button';
import { COLORS, TEXT } from '../ui/theme';
import { goTo, menuBackdrop, panel } from '../ui/widgets';
import { REGISTRY, SCENES } from './keys';

/** Waiting room: shows the code, both seats, ready state; auto-starts when both are ready. */
export class LobbyScene extends Phaser.Scene {
  private session!: NetSession;
  private seatViews: { name: Phaser.GameObjects.Text; state: Phaser.GameObjects.Text; sprite: Phaser.GameObjects.Image; card: Phaser.GameObjects.Graphics }[] = [];
  private status!: Phaser.GameObjects.Text;
  private net!: Phaser.GameObjects.Text;
  private startBtn!: Button;
  private leaving = false;

  constructor() {
    super(SCENES.lobby);
  }

  create(): void {
    this.leaving = false;
    const session = this.registry.get(REGISTRY.session) as NetSession | undefined;
    if (!session) {
      this.scene.start(SCENES.online);
      return;
    }
    this.session = session;
    this.cameras.main.fadeIn(200, 7, 10, 31);
    menuBackdrop(this);
    panel(this, VIEW.width / 2, 300, 760, 500);
    const cx = VIEW.width / 2;

    this.add.text(cx, 82, 'ROOM CODE', TEXT.display(12, COLORS.textDim)).setOrigin(0.5);
    // Body font: the pixel font makes S/8 and similar glyphs ambiguous.
    const code = this.add
      .text(cx, 128, session.code.split('').join(' '), { ...TEXT.body(58), fontStyle: '700' })
      .setOrigin(0.5)
      .setTint(0xffe066, 0xffe066, 0xff9f6b, 0xff9f6b);
    code.setInteractive({ useHandCursor: true }).on('pointerup', () => this.copy(session.code, 'Code copied!'));
    this.add.text(cx, 168, 'Share this code with your friend — they choose JOIN ROOM.', TEXT.body(16, COLORS.textDim)).setOrigin(0.5);

    for (let i = 0; i < 2; i++) {
      const x = cx + (i === 0 ? -170 : 170);
      const card = this.add.graphics({ x, y: 268 });
      const sprite = this.add.image(x - 90, 272, TEXTURES.lancer(i, LANCER_FRAMES.idle)).setScale(1.1 / TEX_SCALE);
      const name = this.add.text(x - 50, 248, '', TEXT.display(12, PLAYER_CSS[i])).setOrigin(0, 0.5);
      const state = this.add.text(x - 50, 282, '', TEXT.body(17, COLORS.textDim)).setOrigin(0, 0.5);
      this.seatViews.push({ name, state, sprite, card });
      this.tweens.add({ targets: sprite, y: 266, duration: 600 + i * 120, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }

    this.status = this.add.text(cx, 352, '', TEXT.body(19)).setOrigin(0.5);
    this.startBtn = new Button(this, cx, 412, 'START', () => this.toggleReady(), { primary: true, width: 320 });
    const copyLink = new Button(this, cx - 130, 482, 'COPY INVITE LINK', () => this.copy(this.inviteLink(), 'Invite link copied!'), { width: 250, fontSize: 11 });
    const leave = new Button(this, cx + 130, 482, 'LEAVE ROOM', () => this.leave(), { width: 250, fontSize: 11 });
    new ButtonGroup(this, [this.startBtn, copyLink, leave], { onBack: () => this.leave() }).focus(0);
    this.net = this.add.text(VIEW.width - 12, VIEW.height - 10, '', TEXT.body(14, COLORS.textDim)).setOrigin(1, 1);

    session.on('room', this.refresh, this);
    session.on('error', this.onError, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      session.off('room', this.refresh, this);
      session.off('error', this.onError, this);
    });
    if (session.room) this.refresh(session.room);
    if (session.error) this.onError(session.error);
  }

  override update(): void {
    if (!this.session || !getSettings().showNetStats) return;
    const st = this.session.status;
    this.net.setText(st === 'open' ? `● CONNECTED  PING ${Math.round(this.session.rttMs)}ms` : st === 'closed' ? '● OFFLINE' : '● RECONNECTING…');
    this.net.setColor(st === 'open' ? COLORS.good : st === 'closed' ? COLORS.bad : COLORS.accentCss);
  }

  private refresh(room: RoomInfo): void {
    if (this.leaving) return;
    if (room.inMatch) {
      this.leaving = true;
      goTo(this, SCENES.game, { mode: 'online' });
      return;
    }
    const me = this.session.slot;
    room.seats.forEach((s, i) => {
      const v = this.seatViews[i];
      const x = VIEW.width / 2 + (i === 0 ? -170 : 170);
      v.card.clear();
      v.card.fillStyle(s ? 0x1a2357 : 0x10163d, 1);
      v.card.fillRoundedRect(-150, -50, 300, 100, 14);
      v.card.lineStyle(3, s?.ready ? 0x5cf2a0 : s ? PLAYER_COLORS[i] : 0x2e3b8c, 1);
      v.card.strokeRoundedRect(-150, -50, 300, 100, 14);
      v.card.x = x;
      v.sprite.setAlpha(s ? 1 : 0.25);
      v.name.setText(s ? `${s.name.toUpperCase()}${i === me ? ' (YOU)' : ''}` : `PLAYER ${i + 1}`);
      if (!s) v.state.setText('waiting to join…').setColor(COLORS.textDim);
      else if (!s.connected) v.state.setText('disconnected — reconnecting…').setColor(COLORS.bad);
      else if (s.ready) v.state.setText('READY ✓').setColor(COLORS.good);
      else v.state.setText('not ready').setColor(COLORS.textDim);
    });
    const mine = room.seats[me];
    const other = room.seats[1 - me];
    this.startBtn.setText(mine?.ready ? 'READY ✓ (CANCEL)' : 'START');
    if (!other) this.status.setText('Waiting for Player 2…').setColor(COLORS.text);
    else if (!other.connected) this.status.setText(`${other.name} disconnected — waiting for them to come back…`).setColor(COLORS.bad);
    else if (mine?.ready && !other.ready) this.status.setText(`Waiting for ${other.name} to press START…`).setColor(COLORS.text);
    else if (!mine?.ready && other.ready) this.status.setText(`${other.name} is ready! Press START.`).setColor(COLORS.accentCss);
    else if (mine?.ready && other.ready) this.status.setText('Both ready — starting!').setColor(COLORS.good);
    else this.status.setText('Both players here. Press START when ready.').setColor(COLORS.text);
  }

  private toggleReady(): void {
    const room = this.session.room;
    if (!room) return;
    audio.unlock();
    this.session.setReady(!room.seats[this.session.slot]?.ready);
  }

  private onError(err: { msg: string }): void {
    if (this.leaving) return;
    this.leaving = true;
    this.registry.remove(REGISTRY.session);
    goTo(this, SCENES.online, { message: err.msg });
  }

  private leave(): void {
    if (this.leaving) return;
    this.leaving = true;
    this.session.leave();
    this.registry.remove(REGISTRY.session);
    goTo(this, SCENES.online);
  }

  private inviteLink(): string {
    const u = new URL(window.location.href);
    u.search = '';
    u.searchParams.set('room', this.session.code);
    return u.toString();
  }

  private copy(text: string, msg: string): void {
    navigator.clipboard?.writeText(text).then(
      () => this.flash(msg),
      () => this.flash(text),
    );
  }

  private flash(msg: string): void {
    const t = this.add.text(VIEW.width / 2, 196, msg, TEXT.display(10, COLORS.good)).setOrigin(0.5);
    this.tweens.add({ targets: t, alpha: 0, delay: 900, duration: 400, onComplete: () => t.destroy() });
  }
}
