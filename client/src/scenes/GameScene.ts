import Phaser from 'phaser';
import { BUBBLE_SIZES, INPUT, TICK_RATE, type PowerUpType, type TickedEvent } from '@orb/shared';
import { orbColor, TEXTURES } from '../assets/textures';
import { audio } from '../audio/AudioManager';
import { PLAYER_COLORS, PLAYER_CSS, VIEW } from '../config/clientConfig';
import { getSettings } from '../config/settings';
import { ArenaView } from '../entities/ArenaView';
import { FxLayer } from '../entities/FxLayer';
import { PlayerView } from '../entities/PlayerView';
import { WorldLayers } from '../entities/WorldLayers';
import { LocalSource } from '../game/LocalSource';
import { NetSource } from '../game/NetSource';
import type { GameSource, ViewState } from '../game/types';
import { InputController } from '../input/InputController';
import type { NetSession } from '../networking/NetSession';
import { Button, ButtonGroup } from '../ui/Button';
import { Hud } from '../ui/Hud';
import { COLORS, TEXT } from '../ui/theme';
import { goTo, panel } from '../ui/widgets';
import { REGISTRY, SCENES } from './keys';

export interface GameSceneData {
  mode: 'solo' | 'online';
  nickname?: string;
  /** Solo only: start at this level index (dev / level testing). */
  startLevel?: number;
}

const PU_LABEL: Record<PowerUpType, string> = {
  shield: 'SHIELD!',
  extraLife: '1-UP!',
  extraTime: '+TIME!',
  doubleHarpoon: 'DOUBLE TETHER!',
  speedBoost: 'SPEED UP!',
  anchor: 'ANCHOR TETHER!',
  chaos: 'CHAOS!',
};

export class GameScene extends Phaser.Scene {
  private source!: GameSource;
  private session: NetSession | null = null;
  private input2!: InputController;
  private arena!: ArenaView;
  private layers!: WorldLayers;
  private fx!: FxLayer;
  private players!: PlayerView[];
  private hud!: Hud;
  private overlay!: Phaser.GameObjects.Container;
  private overlayKey = '';
  private overlayGroup: ButtonGroup | null = null;
  private overlayLive: ((v: ViewState) => void) | null = null;
  private bigText!: Phaser.GameObjects.Text;
  private banner!: Phaser.GameObjects.Text;
  private levelId = '';
  private lastPhase = '';
  private lastCount = -1;
  private prevBits = 0;
  private clearBonus: number[] = [];
  private fatal: string | null = null;
  private leaving = false;

  constructor() {
    super(SCENES.game);
  }

  create(data: GameSceneData): void {
    this.cameras.main.fadeIn(200, 7, 10, 31);
    this.leaving = false;
    this.fatal = null;
    this.overlayKey = '';
    this.levelId = '';
    this.lastPhase = '';
    this.prevBits = 0;

    if (data.mode === 'online') {
      const session = this.registry.get(REGISTRY.session) as NetSession | undefined;
      if (!session) {
        this.scene.start(SCENES.menu);
        return;
      }
      this.session = session;
      this.source = new NetSource(session);
      session.on('room', this.onRoom, this);
      session.on('error', this.onNetError, this);
    } else {
      this.session = null;
      this.source = new LocalSource(data.nickname || 'Lancer', data.startLevel ?? 0);
    }

    this.input2 = new InputController();
    this.arena = new ArenaView(this);
    this.layers = new WorldLayers(this);
    this.fx = new FxLayer(this);
    this.players = PLAYER_COLORS.map((_, s) => new PlayerView(this, s));
    this.hud = new Hud(this);
    this.overlay = this.add.container(0, 0).setDepth(100);
    this.bigText = this.add.text(VIEW.width / 2, VIEW.arenaY + 200, '', TEXT.title(64)).setOrigin(0.5).setDepth(90).setShadow(5, 6, '#1a0f3d', 0, false, true);
    this.banner = this.add.text(VIEW.width / 2, VIEW.arenaY + 22, '', TEXT.display(11, COLORS.accentCss)).setOrigin(0.5).setDepth(95).setShadow(2, 2, '#000', 0, false, true);
    this.createTouchControls();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
    if (this.session && this.session.room && !this.session.room.inMatch) this.toLobby();
  }

  private cleanup(): void {
    this.input2?.destroy();
    this.overlayGroup?.destroy();
    this.session?.off('room', this.onRoom, this);
    this.session?.off('error', this.onNetError, this);
    this.source?.destroy();
  }

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------

  override update(time: number, delta: number): void {
    if (this.leaving || !this.source) return;
    const pre = this.source.view();
    const me = pre?.players[this.source.localSlot];
    const playing = pre?.phase === 'playing';

    let bits = this.input2.bits();
    if (this.overlayKey.startsWith('paused') || this.fatal) bits = 0;

    if (this.input2.consumePause() && pre) this.togglePause(pre);

    // Online: instant local feedback for our own shot (the server confirms later).
    if (this.source.mode === 'online' && bits & INPUT.SHOOT && !(this.prevBits & INPUT.SHOOT) && playing && me?.life === 'alive') {
      audio.play('shoot');
    }
    this.prevBits = bits;

    this.source.update(delta, bits);
    const v = this.source.view();
    if (!v) {
      this.banner.setText(this.session?.status === 'reconnecting' ? 'RECONNECTING…' : 'SYNCING WITH SERVER…');
      return;
    }

    const level = this.source.level;
    if (level && level.id + v.levelIndex !== this.levelId) {
      this.levelId = level.id + v.levelIndex;
      this.arena.build(level);
      this.layers.clear();
      this.fx.clear();
      this.layers.orbColor = level.theme.orb;
      this.layers.level = level;
      this.showLevelIntro(v.levelIndex, level.name);
    }

    if (v.phase === 'gameOver' || v.phase === 'victory') v.harpoons = [];
    this.layers.update(v, time);
    this.fx.update(v, time);
    const names = this.source.names();
    this.players.forEach((pv, i) => pv.update(v.players[i], names[i] ?? `P${i + 1}`, i === this.source.localSlot && this.source.mode === 'online', delta, time));
    const seats = this.session?.room?.seats.map((s) => ({ present: !!s, connected: !!s?.connected, active: !!s?.active }));
    this.hud.update(v, names, this.source.localSlot, this.source.mode, level?.name ?? '', this.source.levelCount, seats);
    this.updateNetStatus();

    for (const e of this.source.drainEvents()) this.handleEvent(e, v);
    this.updatePhase(v);
    this.overlayLive?.(v);
  }

  private togglePause(v: ViewState): void {
    if (v.phase === 'paused') {
      if (this.session?.room?.pause?.reason !== 'disconnect') this.source.requestResume();
    } else if (v.phase === 'playing' || v.phase === 'countdown') {
      this.source.requestPause();
    }
  }

  // ---------------------------------------------------------------------------
  // Events → audio / particles / shake
  // ---------------------------------------------------------------------------

  private handleEvent(e: TickedEvent, v: ViewState): void {
    const top = VIEW.arenaY;
    const shake = (ms: number, k: number) => getSettings().screenShake && this.cameras.main.shake(ms, k);
    switch (e.k) {
      case 'shoot':
        if (this.source.mode === 'solo' || e.p !== this.source.localSlot) audio.play('shoot');
        break;
      case 'pop': {
        const color = orbColor(this.source.level?.theme.orb ?? 0xff7a59, e.s);
        this.burst(e.x, top + e.y, color, 10 + e.s * 8, 120 + e.s * 50);
        audio.play(e.s > 0 ? 'split' : 'destroy', { pitch: 1 + (3 - e.s) * 0.18 });
        this.floatText(e.x, top + e.y - BUBBLE_SIZES[e.s].radius, `+${e.pts}`, PLAYER_CSS[e.by] ?? '#fff', 12);
        if (e.s >= 2) shake(90, 0.004 + e.s * 0.001);
        break;
      }
      case 'hurt': {
        const p = v.players[e.p];
        if (e.shield) {
          audio.play('shieldBreak');
          if (p) this.burst(p.x, VIEW.arenaBottom - 24, 0x7ff3ff, 24, 220);
          shake(120, 0.006);
        } else {
          audio.play('damage');
          shake(260, 0.014);
          this.cameras.main.flash(120, 255, 60, 80, false);
        }
        break;
      }
      case 'die': {
        const p = v.players[e.p];
        audio.play('death');
        if (p) this.burst(p.x, VIEW.arenaBottom - 24, PLAYER_COLORS[e.p], 30, 260);
        if (e.out && p) this.floatText(p.x, VIEW.arenaBottom - 80, 'KNOCKED OUT', COLORS.bad, 12);
        break;
      }
      case 'respawn': {
        const p = v.players[e.p];
        if (p) this.burst(p.x, VIEW.arenaBottom - 24, 0xffffff, 16, 140);
        break;
      }
      case 'drop':
        audio.play('hit', { pitch: 1.6 });
        break;
      case 'pickup':
        audio.play('pickup');
        this.burst(e.x, top + e.y, 0xffe066, 18, 160);
        this.floatText(e.x, top + e.y - 26, PU_LABEL[e.type], PLAYER_CSS[e.p] ?? '#fff', 11);
        break;
      case 'clear':
        this.clearBonus = e.bonus;
        break;
      case 'boom':
        audio.play('boom');
        this.burst(e.x, top + e.y, 0xff7a00, 46, 340);
        this.burst(e.x, top + e.y, 0xffe066, 20, 200);
        shake(320, 0.016);
        break;
      case 'sp':
        this.onSpecial(e, v);
        break;
      case 'anchor':
        audio.play('anchor');
        this.burst(e.x, top + e.y + 10, 0xff9f43, 20, 200);
        this.floatText(e.x, top + e.y + 36, 'ANCHORED!', '#ff9f43', 10);
        shake(80, 0.004);
        break;
      case 'sky':
        if (e.t === 'warn') audio.play('warn');
        else if (e.t === 'start') {
          audio.play(e.kind === 'gift' ? 'pickup' : 'sky');
          if (e.kind === 'comet') shake(200, 0.006);
        }
        break;
      case 'heat':
        if (e.on) {
          audio.play('heat');
          this.floatText(VIEW.width / 2, top + 100, 'OVERHEAT!', '#ff6a3d', 12);
        }
        break;
      case 'chaos': {
        if (e.t === 'end') break;
        const target = v.players[e.t === 'fizzle' ? e.by : e.to];
        const x = target?.x ?? VIEW.width / 2;
        audio.play(e.t === 'swap' ? 'swap' : e.t === 'fizzle' ? 'deny' : 'chaos');
        const label = { jam: 'JAMMED!', flip: 'FLIPPED!', slow: 'SLOWED!', tether: 'TETHERED!', swap: 'SWAPPED!', fizzle: 'FIZZLE' }[e.t];
        this.floatText(x, VIEW.arenaBottom - 96, label, '#e879f9', 11);
        if (e.t !== 'fizzle') this.burst(x, VIEW.arenaBottom - 24, 0xe879f9, 22, 220);
        break;
      }
      case 'timeup':
        audio.play('damage');
        shake(300, 0.01);
        break;
      case 'phase':
        if (e.ph === 'playing' && this.lastPhase === 'countdown') {
          audio.play('go');
        }
        if (e.ph === 'levelComplete') audio.play('levelComplete');
        if (e.ph === 'victory') audio.play('victory');
        if (e.ph === 'gameOver') audio.play('gameOver');
        break;
    }
  }

  /** Special-orb feedback: short sounds and floating words so the rule is learnable by watching. */
  private onSpecial(e: Extract<TickedEvent, { k: 'sp' }>, v: ViewState): void {
    const x = e.x;
    const y = VIEW.arenaY + e.y;
    const word = (text: string, color: string, size = 9) => this.floatText(x, y - 30, text, color, size);
    switch (e.t) {
      case 'enrage':
        audio.play('enrage');
        this.burst(x, y, 0xff3b30, 14, 180);
        word('ENRAGED!', '#ff6a5e');
        break;
      case 'fade':
        audio.play('hit', { pitch: 0.6 });
        break;
      case 'fuseStart':
        audio.play('fuse');
        word('POP ITS TWIN!', '#ffd166');
        break;
      case 'fuseSave':
        audio.play('pickup');
        word('LINKED!', '#5cf2a0');
        break;
      case 'fuseFail':
        audio.play('deny');
        word('REGROWN!', '#ff6680');
        break;
      case 'syncArm':
        audio.play('sync');
        word('SYNC! NEED A PARTNER', '#4cc9f0');
        break;
      case 'pincerArm':
        audio.play('sync');
        word('PINCER! HIT THE OTHER SIDE', '#ff6bd6');
        break;
      case 'heavyHit':
        audio.play('sync');
        word('TEAM UP!', '#c9a27e');
        break;
      case 'syncDone':
      case 'pincerDone':
      case 'heavyDone':
        audio.play('combo');
        this.burst(x, y, 0xffe066, 22, 220);
        word('NICE!', '#ffe066', 11);
        break;
      case 'deny':
        audio.play('deny');
        word('NO EFFECT', '#9aa3c7', 8);
        break;
      case 'seqStep': {
        const n = v.bubbles.find((b) => b.id === e.id)?.n ?? 1;
        audio.play('seq', { pitch: 1 + n * 0.16 });
        break;
      }
      case 'seqReset':
        audio.play('deny');
        word('WRONG ORDER!', '#ff6680');
        break;
      case 'seqDone':
        audio.play('combo');
        word('SEQUENCE!', '#5cf2a0', 11);
        break;
      default:
        break;
    }
  }

  private burst(x: number, y: number, tint: number, count: number, speed: number): void {
    const em = this.add.particles(x, y, TEXTURES.spark, {
      speed: { min: speed * 0.3, max: speed },
      angle: { min: 0, max: 360 },
      scale: { start: 0.7, end: 0 },
      alpha: { start: 1, end: 0 },
      lifespan: { min: 300, max: 650 },
      gravityY: 380,
      tint: [tint, 0xffffff],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    });
    em.setDepth(30);
    em.explode(count);
    const shards = this.add.particles(x, y, TEXTURES.shard, {
      speed: { min: speed * 0.5, max: speed * 1.2 },
      angle: { min: 0, max: 360 },
      rotate: { start: 0, end: 360 },
      scale: { start: 0.8, end: 0.2 },
      lifespan: 500,
      gravityY: 520,
      tint,
      emitting: false,
    });
    shards.setDepth(29);
    shards.explode(Math.ceil(count / 3));
    this.time.delayedCall(900, () => {
      em.destroy();
      shards.destroy();
    });
  }

  private floatText(x: number, y: number, text: string, color: string, size: number): void {
    const t = this.add.text(x, y, text, TEXT.display(size, color)).setOrigin(0.5).setDepth(60).setShadow(2, 2, '#000', 0, false, true);
    this.tweens.add({ targets: t, y: y - 36, alpha: 0, duration: 900, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }

  private showLevelIntro(index: number, name: string): void {
    const t = this.add
      .text(VIEW.width / 2, VIEW.arenaY + 120, `LEVEL ${index + 1}\n${name.toUpperCase()}`, TEXT.display(20, COLORS.accentCss))
      .setOrigin(0.5)
      .setAlign('center')
      .setLineSpacing(14)
      .setDepth(91)
      .setShadow(3, 4, '#1a0f3d', 0, false, true)
      .setAlpha(0);
    this.tweens.add({ targets: t, alpha: 1, y: VIEW.arenaY + 110, duration: 300, hold: 1500, yoyo: true, onComplete: () => t.destroy() });
  }

  // ---------------------------------------------------------------------------
  // Phases & overlays
  // ---------------------------------------------------------------------------

  private updatePhase(v: ViewState): void {
    // Countdown numbers (3, 2, 1) and GO!
    if (v.phase === 'countdown') {
      const n = Math.ceil(v.phaseTicks / TICK_RATE);
      if (n !== this.lastCount && n > 0) {
        this.lastCount = n;
        audio.play('tick');
        this.bigText.setText(String(n)).setScale(1.6).setAlpha(1).setColor(COLORS.text);
        this.tweens.add({ targets: this.bigText, scale: 1, duration: 260, ease: 'Back.easeOut' });
      }
    } else if (this.lastPhase === 'countdown' && v.phase === 'playing') {
      this.lastCount = -1;
      this.bigText.setText('GO!').setScale(0.6).setAlpha(1).setColor(COLORS.accentCss);
      this.tweens.add({ targets: this.bigText, scale: 1.3, alpha: 0, duration: 600, ease: 'Cubic.easeOut' });
    } else if (v.phase !== 'playing') {
      this.lastCount = -1;
    }
    if (v.phase === 'paused') this.bigText.setAlpha(0);
    this.lastPhase = v.phase;

    // Banner: reconnecting / partner state
    const room = this.session?.room;
    let banner = '';
    if (this.session?.status === 'reconnecting') banner = 'CONNECTION LOST — RECONNECTING…';
    else if (room?.grace && v.phase !== 'paused') banner = `PLAYER ${room.grace.slot + 1} DISCONNECTED`;
    this.banner.setText(banner);

    const key = this.computeOverlayKey(v);
    if (key !== this.overlayKey) {
      this.overlayKey = key;
      this.buildOverlay(key, v);
    }
  }

  private computeOverlayKey(v: ViewState): string {
    if (this.fatal) return 'fatal';
    const room = this.session?.room;
    switch (v.phase) {
      case 'paused':
        return room?.pause?.reason === 'disconnect' ? `paused-dc` : 'paused';
      case 'levelComplete':
        return 'levelComplete';
      case 'timeUp':
        return 'timeUp';
      case 'gameOver':
      case 'victory': {
        const votes = room?.seats.map((s) => (s?.rematch ? 1 : 0)).join('') ?? '';
        return `${v.phase}-${votes}`;
      }
      default:
        return '';
    }
  }

  private clearOverlay(): void {
    this.overlayGroup?.destroy();
    this.overlayGroup = null;
    this.overlayLive = null;
    this.overlay.removeAll(true);
  }

  private buildOverlay(key: string, v: ViewState): void {
    this.clearOverlay();
    if (!key) return;
    const cx = VIEW.width / 2;
    const cy = VIEW.arenaY + VIEW.height / 2 - 70;
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => (this.overlay.add(o), o);
    const dim = add(this.add.rectangle(cx, VIEW.height / 2, VIEW.width, VIEW.height, 0x05071a, 0.55));
    dim.setInteractive(); // block clicks to the world
    const names = this.source.names();
    const online = this.source.mode === 'online';
    const buttons: Button[] = [];
    const btn = (y: number, label: string, fn: () => void, primary = false, w = 300) => {
      const b = new Button(this, cx, y, label, fn, { primary, width: w });
      add(b);
      buttons.push(b);
      return b;
    };
    const title = (y: number, text: string, color: string = COLORS.text, size = 28) =>
      add(this.add.text(cx, y, text, TEXT.display(size, color)).setOrigin(0.5).setShadow(3, 4, '#000', 0, false, true));
    const body = (y: number, text: string, color: string = COLORS.text, size = 18) => add(this.add.text(cx, y, text, TEXT.body(size, color)).setOrigin(0.5).setAlign('center'));

    if (key === 'fatal') {
      add(panel(this, cx, cy, 560, 260));
      title(cy - 80, 'CONNECTION ENDED', COLORS.bad, 20);
      body(cy - 20, this.fatal ?? '');
      btn(cy + 70, 'MAIN MENU', () => this.quitToMenu(), true);
    } else if (key === 'paused') {
      add(panel(this, cx, cy, 460, 300));
      title(cy - 100, 'PAUSED', COLORS.accentCss);
      const by = this.session?.room?.pause?.by;
      if (online && by !== undefined && by >= 0) body(cy - 58, `paused by ${names[by] ?? 'player ' + (by + 1)}`, COLORS.textDim, 16);
      btn(cy - 4, 'RESUME', () => this.source.requestResume(), true);
      if (online) btn(cy + 62, 'RETURN TO LOBBY', () => this.session?.toLobby());
      btn(cy + (online ? 128 : 62), 'QUIT TO MENU', () => this.quitToMenu());
    } else if (key === 'paused-dc') {
      const room = this.session?.room;
      const slot = room?.grace?.slot ?? room?.pause?.by ?? 1;
      add(panel(this, cx, cy, 600, 360));
      title(cy - 130, `PLAYER ${slot + 1} DISCONNECTED`, COLORS.bad, 18);
      const info = body(cy - 82, '', COLORS.textDim, 17);
      this.overlayLive = () => {
        const g = this.session?.room?.grace;
        info.setText(g ? `Waiting for ${names[slot] ?? 'your partner'} to reconnect… ${Math.ceil(g.msLeft / 1000 - (performance.now() - graceAt) / 1000)}s` : 'Waiting for your partner…');
      };
      const graceAt = performance.now();
      btn(cy - 20, 'WAIT FOR RECONNECT', () => this.floatText(cx, cy - 40, 'Waiting…', COLORS.textDim, 10));
      btn(cy + 46, 'CONTINUE SOLO', () => this.session?.continueSolo(), true);
      btn(cy + 112, 'RETURN TO LOBBY', () => this.session?.toLobby());
    } else if (key === 'levelComplete') {
      add(panel(this, cx, cy, 560, 250, 0.85));
      title(cy - 80, 'LEVEL CLEAR!', COLORS.good, 26);
      const lines = this.clearBonus
        .map((b, i) => (v.players[i]?.active ? `${names[i] ?? 'P' + (i + 1)}  +${b}` : ''))
        .filter(Boolean)
        .join('\n');
      body(cy - 10, `BONUS\n${lines}`, COLORS.text, 20);
      body(cy + 80, 'next level incoming…', COLORS.textDim, 15);
    } else if (key === 'timeUp') {
      add(panel(this, cx, cy, 460, 180, 0.85));
      title(cy - 30, "TIME'S UP!", COLORS.bad, 26);
      body(cy + 30, 'Everyone loses a life — retry!', COLORS.textDim, 17);
    } else if (key.startsWith('gameOver') || key.startsWith('victory')) {
      const won = key.startsWith('victory');
      add(panel(this, cx, cy, 620, 380));
      title(cy - 140, won ? 'VICTORY!' : 'GAME OVER', won ? COLORS.good : COLORS.bad, 32);
      const scoreLines = v.players
        .filter((p) => p.active || p.score > 0)
        .map((p) => `${(names[p.slot] ?? 'P' + (p.slot + 1)).toUpperCase()}   ${String(p.score).padStart(6, '0')}`)
        .join('\n');
      add(this.add.text(cx, cy - 64, scoreLines, TEXT.display(14)).setOrigin(0.5).setAlign('center').setLineSpacing(10));
      if (won) body(cy - 4, `All ${this.source.levelCount} levels cleared. Legendary teamwork!`, COLORS.textDim, 16);
      if (online) {
        const seats = this.session?.room?.seats ?? [];
        const mine = seats[this.source.localSlot]?.rematch;
        const theirs = seats.some((s, i) => i !== this.source.localSlot && s?.rematch);
        if (theirs && !mine) body(cy + 22, 'Your partner wants a rematch!', COLORS.accentCss, 17);
        btn(cy + 64, mine ? 'WAITING FOR PARTNER…' : 'REMATCH', () => this.source.requestRematch(), true).setEnabled(!mine);
        btn(cy + 128, 'RETURN TO LOBBY', () => this.session?.toLobby());
        btn(cy + 192 - 10, 'MAIN MENU', () => this.quitToMenu(), false, 220).setScale(0.85);
      } else {
        btn(cy + 64, 'PLAY AGAIN', () => this.source.requestRematch(), true);
        btn(cy + 128, 'MAIN MENU', () => this.quitToMenu());
      }
    }

    if (buttons.length) {
      this.overlayGroup = new ButtonGroup(this, buttons.filter((b) => b.alpha > 0.5));
      this.overlayGroup.focus(0);
    }
    this.overlay.setAlpha(0);
    this.tweens.add({ targets: this.overlay, alpha: 1, duration: 180 });
  }

  // ---------------------------------------------------------------------------
  // Online plumbing
  // ---------------------------------------------------------------------------

  private onRoom(): void {
    const room = this.session?.room;
    if (room && !room.inMatch && !this.leaving) this.toLobby();
  }

  private onNetError(err: { msg: string }): void {
    this.fatal = err.msg;
  }

  private updateNetStatus(): void {
    if (!this.session || !getSettings().showNetStats) {
      this.hud.setNet(this.session ? '' : 'SOLO', COLORS.textDim);
      return;
    }
    const st = this.session.status;
    const rtt = Math.round(this.session.rttMs);
    if (st === 'open') this.hud.setNet(`● CONNECTED  PING ${rtt}ms  ROOM ${this.session.code}`, rtt < 120 ? COLORS.good : COLORS.accentCss);
    else if (st === 'reconnecting' || st === 'connecting') this.hud.setNet('● RECONNECTING…', COLORS.accentCss);
    else this.hud.setNet('● OFFLINE', COLORS.bad);
  }

  private toLobby(): void {
    if (this.leaving) return;
    this.leaving = true;
    goTo(this, SCENES.lobby);
  }

  private quitToMenu(): void {
    if (this.leaving) return;
    this.leaving = true;
    if (this.session) {
      this.session.leave();
      this.registry.remove(REGISTRY.session);
    }
    goTo(this, SCENES.menu);
  }

  // ---------------------------------------------------------------------------
  // Touch controls (shown on touch devices; desktop keyboard stays primary)
  // ---------------------------------------------------------------------------

  private createTouchControls(): void {
    if (!this.sys.game.device.input.touch) return;
    this.input.addPointer(2);
    const mk = (x: number, y: number, r: number, label: string, button: 'left' | 'right' | 'shoot') => {
      const c = this.add.circle(x, y, r, 0xffffff, 0.12).setStrokeStyle(3, 0xffffff, 0.35).setDepth(80).setInteractive();
      this.add.text(x, y, label, TEXT.display(r > 40 ? 14 : 18)).setOrigin(0.5).setDepth(81).setAlpha(0.8);
      const set = (v: boolean) => {
        this.input2.setVirtual(button, v);
        c.setFillStyle(0xffffff, v ? 0.3 : 0.12);
        if (v) audio.unlock();
      };
      c.on('pointerdown', () => set(true));
      c.on('pointerup', () => set(false));
      c.on('pointerout', () => set(false));
    };
    mk(70, VIEW.height - 70, 46, '◀', 'left');
    mk(180, VIEW.height - 70, 46, '▶', 'right');
    mk(VIEW.width - 80, VIEW.height - 76, 56, 'FIRE', 'shoot');
  }
}
