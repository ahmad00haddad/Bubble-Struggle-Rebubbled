import Phaser from 'phaser';
import { LEVELS, type RoomInfo } from '@orb/shared';
import { LANCER_FRAMES, TEXTURES, TEX_SCALE } from '../assets/textures';
import { audio } from '../audio/AudioManager';
import { LanCoordinator } from '../lan/LanCoordinator';
import { PLAYER_COLORS, PLAYER_CSS, VIEW } from '../config/clientConfig';
import { EMOTE_GLYPHS } from '../config/social';
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
  private chaosBtn!: Button;
  private shoveBtn!: Button;
  private levelBtn!: Button;
  private lanBtn: Button | null = null;
  private lan: LanCoordinator | null = null;
  private noteUntil = 0;
  private leaving = false;

  constructor() {
    super(SCENES.lobby);
  }

  create(): void {
    this.leaving = false;
    // The scene object is reused (e.g. back from the level picker): drop views of the last visit.
    this.seatViews = [];
    this.lanBtn = null;
    this.lan = null;
    this.noteUntil = 0;
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
    this.add.text(cx, 168, 'Share this code with 1–3 friends — they choose JOIN ROOM.', TEXT.body(16, COLORS.textDim)).setOrigin(0.5);

    for (let i = 0; i < PLAYER_COLORS.length; i++) {
      const { x, y } = this.cardPos(i);
      const card = this.add.graphics({ x, y });
      const sprite = this.add.image(x - 108, y + 2, TEXTURES.lancer(i, LANCER_FRAMES.idle)).setScale(0.8 / TEX_SCALE);
      const name = this.add.text(x - 80, y - 14, '', TEXT.display(10, PLAYER_CSS[i])).setOrigin(0, 0.5);
      const state = this.add.text(x - 80, y + 14, '', TEXT.body(16, COLORS.textDim)).setOrigin(0, 0.5);
      this.seatViews.push({ name, state, sprite, card });
      this.tweens.add({ targets: sprite, y: y - 3, duration: 600 + i * 120, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }

    this.status = this.add.text(cx, 366, '', TEXT.body(19)).setOrigin(0.5);
    const canLan = !session.peer && LanCoordinator.supported;
    const bw = canLan ? 230 : 320;
    const bx = canLan ? [cx - 240, cx, cx + 240] : [cx - 165, cx + 165, 0];
    this.chaosBtn = new Button(this, bx[0], 406, 'CHAOS: ON', () => this.toggleChaos(), { width: bw, fontSize: canLan ? 8 : 10 });
    this.levelBtn = new Button(this, bx[1], 406, 'LEVELS: ALL', () => this.pickLevel(), { width: bw, fontSize: canLan ? 8 : 10 });
    if (canLan) {
      this.lanBtn = new Button(this, bx[2], 406, 'LAN MATCH (P2P)', () => void this.lan?.startAsHost(), { width: bw, fontSize: 8 });
      this.lan = new LanCoordinator(session, session.nickname, { status: (t, bad) => this.note(t, bad), adopt: (s) => this.adoptLan(s) });
    }
    this.startBtn = new Button(this, cx, 456, 'START', () => this.toggleReady(), { primary: true, width: 300 });
    this.shoveBtn = new Button(this, cx - 260, 456, 'SHOVE: OFF', () => this.toggleShove(), { width: 190, fontSize: 8 });
    const emote = new Button(this, cx + 260, 456, `SEND ${EMOTE_GLYPHS[0]}`, () => this.session.sendEmote(0), { width: 190, fontSize: 9 });
    const copyLink = session.peer ? null : new Button(this, cx - 130, 514, 'COPY INVITE LINK', () => this.copy(this.inviteLink(), 'Invite link copied!'), { width: 250, fontSize: 11 });
    const leave = new Button(this, session.peer ? cx : cx + 130, 514, 'LEAVE ROOM', () => this.leave(), { width: session.peer ? 320 : 250, fontSize: 11 });
    const group = [this.startBtn, this.shoveBtn, emote, this.chaosBtn, this.levelBtn, ...(this.lanBtn ? [this.lanBtn] : []), ...(copyLink ? [copyLink] : []), leave];
    new ButtonGroup(this, group, { onBack: () => this.leave() }).focus(0);
    this.net = this.add.text(VIEW.width - 12, VIEW.height - 10, '', TEXT.body(14, COLORS.textDim)).setOrigin(1, 1);

    session.on('room', this.refresh, this);
    session.on('error', this.onError, this);
    session.on('emo', this.onEmote, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      session.off('emo', this.onEmote, this);
      session.off('room', this.refresh, this);
      session.off('error', this.onError, this);
      this.lan?.dispose();
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
    room.seats.forEach((st, i) => {
      const v = this.seatViews[i];
      if (!v) return;
      v.card.clear();
      v.card.fillStyle(st ? 0x1a2357 : 0x10163d, 1);
      v.card.fillRoundedRect(-150, -34, 300, 68, 12);
      v.card.lineStyle(3, st?.ready ? 0x5cf2a0 : st ? PLAYER_COLORS[i] : 0x2e3b8c, 1);
      v.card.strokeRoundedRect(-150, -34, 300, 68, 12);
      v.sprite.setAlpha(st ? 1 : 0.25);
      v.name.setText(st ? `${st.name.toUpperCase()}${i === me ? ' (YOU)' : ''}` : `PLAYER ${i + 1}`);
      if (!st) v.state.setText('open seat').setColor(COLORS.textDim);
      else if (!st.connected) v.state.setText('reconnecting…').setColor(COLORS.bad);
      else if (st.ready) v.state.setText('READY ✓').setColor(COLORS.good);
      else v.state.setText('not ready').setColor(COLORS.textDim);
    });
    const isHost = room.host === me;
    this.chaosBtn.setText(`CHAOS PICKUPS: ${room.chaos ? 'ON' : 'OFF'}${isHost ? '' : ' (HOST ONLY)'}`);
    this.chaosBtn.setEnabled(isHost);
    this.shoveBtn.setText(`SHOVE: ${room.shove ? 'ON 😈' : 'OFF'}${isHost ? '' : ' (HOST)'}`);
    this.shoveBtn.setEnabled(isHost);
    const pick = room.pick ?? -1;
    const lv = pick >= 0 ? LEVELS[pick] : undefined;
    this.levelBtn.setText(pick >= 0 ? `LEVEL ${pick + 1}: ${(lv?.name ?? '').toUpperCase()}${isHost ? '' : ' (HOST)'}` : `LEVELS: ALL${isHost ? '' : ' (HOST ONLY)'}`);
    this.levelBtn.setEnabled(isHost);
    if (this.lanBtn) {
      const friends = room.seats.some((st, i) => !!st && st.connected && i !== me);
      this.lanBtn.setText(isHost ? 'LAN MATCH (P2P)' : 'LAN MATCH (HOST ONLY)');
      this.lanBtn.setEnabled(isHost && friends && !this.lan?.isBusy);
    }
    const mine = room.seats[me];
    const others = room.seats.filter((st, i) => st && i !== me);
    this.startBtn.setText(mine?.ready ? 'READY ✓ (CANCEL)' : 'START');
    if (performance.now() < this.noteUntil) return;
    const waiting = others.filter((st) => st && !st.ready).map((st) => st!.name);
    if (others.length === 0) this.status.setText('Waiting for at least one more player (up to 4)…').setColor(COLORS.text);
    else if (others.some((st) => !st!.connected)) this.status.setText('A player disconnected — waiting for them…').setColor(COLORS.bad);
    else if (mine?.ready && waiting.length) this.status.setText(`Waiting for ${waiting.join(', ')} to press START…`).setColor(COLORS.text);
    else if (!mine?.ready && !waiting.length) this.status.setText('Everyone else is ready! Press START.').setColor(COLORS.accentCss);
    else if (mine?.ready) this.status.setText('All ready — starting!').setColor(COLORS.good);
    else this.status.setText(`${others.length + 1} players here. Everyone presses START to begin.`).setColor(COLORS.text);
  }

  private cardPos(i: number): { x: number; y: number } {
    return { x: VIEW.width / 2 + (i % 2 === 0 ? -165 : 165), y: 236 + Math.floor(i / 2) * 82 };
  }

  /** A message about LAN linking, shown in place of the usual status for a few seconds. */
  private note(text: string, bad = false): void {
    this.noteUntil = performance.now() + 9000;
    this.status.setText(text).setColor(bad ? COLORS.bad : COLORS.accentCss);
    this.time.delayedCall(9100, () => this.scene.isActive() && this.session.room && this.refresh(this.session.room));
    if (this.session.room && this.lanBtn) this.lanBtn.setEnabled(!this.lan?.isBusy && this.session.room.host === this.session.slot);
  }

  /** The room is now run by a player's tab (LAN mode): switch to it and leave the online one. */
  private adoptLan(s: NetSession): void {
    if (this.leaving) return;
    this.leaving = true;
    const cloud = this.session;
    this.registry.set(REGISTRY.session, s);
    s.connect();
    cloud.leave();
    goTo(this, SCENES.lobby);
  }

  private pickLevel(): void {
    const room = this.session.room;
    if (!room || room.host !== this.session.slot) return;
    audio.unlock();
    goTo(this, SCENES.levelSelect, { forRoom: true });
  }

  /** Host option: walking into a teammate pushes them (and a death right after is their fault). */
  private toggleShove(): void {
    const room = this.session.room;
    if (!room || room.host !== this.session.slot) return;
    audio.unlock();
    this.session.setShove(!room.shove);
  }

  /** A player sent an emote: it pops above their seat card. */
  private onEmote(slot: number, index: number): void {
    const glyph = EMOTE_GLYPHS[index];
    if (!glyph || this.leaving) return;
    const { x, y } = this.cardPos(slot);
    const t = this.add.text(x + 120, y - 10, glyph, { fontSize: '30px', fontFamily: 'sans-serif' }).setOrigin(0.5).setDepth(20).setScale(0.3);
    audio.play('tick', { pitch: 1.5 });
    this.tweens.add({ targets: t, scale: 1, duration: 200, ease: 'Back.easeOut' });
    this.tweens.add({ targets: t, y: y - 50, alpha: 0, delay: 900, duration: 500, onComplete: () => t.destroy() });
  }

  private toggleChaos(): void {
    const room = this.session.room;
    if (!room || room.host !== this.session.slot) return;
    audio.unlock();
    this.session.setChaos(!room.chaos);
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
