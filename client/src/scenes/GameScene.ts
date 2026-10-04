import Phaser from 'phaser';
import { AwardTally, BUBBLE_SIZES, EMOTES, INPUT, LEVELS, RELIC_KINDS, SHOVE, TICK_RATE, dailyChallenge, type TickedEvent } from '@orb/shared';
import { AWARD_INFO, EMOTE_GLYPHS, blameLine } from '../config/social';
import { ClipRecorder } from '../game/ClipRecorder';
import { RELIC_INFO } from '../config/relics';
import { orbColor, TEXTURES } from '../assets/textures';
import { audio } from '../audio/AudioManager';
import { PLAYER_COLORS, PLAYER_CSS, VIEW } from '../config/clientConfig';
import { getSettings } from '../config/settings';
import { POWERUP_INFO } from '../config/powerups';
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
  /** Solo only: play just `startLevel` (from the Practice menu). */
  practice?: boolean;
  /** Solo only: the daily level of this UTC day ('YYYY-MM-DD'). */
  daily?: string;
}


export class GameScene extends Phaser.Scene {
  private source!: GameSource;
  private session: NetSession | null = null;
  private input2!: InputController;
  private arena!: ArenaView;
  private layers!: WorldLayers;
  private fx!: FxLayer;
  private lastView: ViewState | null = null;
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
  /** Who did what this match, for the awards card (cosmetic). */
  private tally = new AwardTally();
  /** When each Lancer was last shoved (ms), to tell "shoved into it" from "orb a friend split". */
  private shovedAt: number[] = [];
  private feed: Phaser.GameObjects.Text[] = [];
  private clip: ClipRecorder | null = null;

  constructor() {
    super(SCENES.game);
  }

  create(data: GameSceneData): void {
    this.cameras.main.fadeIn(200, 7, 10, 31);
    this.leaving = false;
    this.fatal = null;
    this.emitters.clear();
    this.lastView = null;
    this.overlayKey = '';
    this.levelId = '';
    this.lastPhase = '';
    this.prevBits = 0;
    this.tally = new AwardTally();
    this.shovedAt = [];
    this.feed = [];

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
      session.on('emo', this.onEmote, this);
    } else if (data.daily) {
      this.session = null;
      const d = dailyChallenge(data.daily, LEVELS.length);
      const src = new LocalSource(data.nickname || 'Lancer', d.level, true, d.seed);
      src.daily = data.daily;
      this.source = src;
    } else {
      this.session = null;
      this.source = new LocalSource(data.nickname || 'Lancer', data.startLevel ?? 0, !!data.practice);
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
    this.createSocialControls();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
    if (this.session && this.session.room && !this.session.room.inMatch) this.toLobby();
  }

  private cleanup(): void {
    this.input2?.destroy();
    this.overlayGroup?.destroy();
    this.session?.off('room', this.onRoom, this);
    this.session?.off('error', this.onNetError, this);
    this.session?.off('emo', this.onEmote, this);
    this.clip?.stop();
    this.clip = null;
    this.source?.destroy();
  }

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------

  override update(time: number, delta: number): void {
    if (this.leaving || !this.source) return;
    const pre = this.lastView; // last frame's view: building it twice per frame was wasted work
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
    this.lastView = v;
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
    this.tally.add(e);
    switch (e.k) {
      case 'shove': {
        const q = v.players[e.to];
        this.shovedAt[e.to] = performance.now();
        audio.play('hit', { pitch: 0.7 });
        if (q) this.floatText(q.x, VIEW.arenaBottom - 70, 'SHOVE!', PLAYER_CSS[e.p] ?? '#fff', 10);
        break;
      }
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
        if (this.source.mode === 'online') {
          const names = this.source.names();
          const blamed = e.b !== undefined ? (names[e.b] ?? `P${e.b + 1}`).toUpperCase() : undefined;
          const line = blameLine((names[e.p] ?? `P${e.p + 1}`).toUpperCase(), e.c, blamed, this.wasShoved(e.p));
          this.addFeed(line, e.b !== undefined ? (PLAYER_CSS[e.b] ?? COLORS.bad) : COLORS.textDim);
          if (e.b !== undefined && p) this.floatText(p.x, VIEW.arenaBottom - 104, `THANKS, ${blamed} 🙃`, PLAYER_CSS[e.b] ?? '#fff', 10);
        }
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
        this.floatText(e.x, top + e.y - 26, POWERUP_INFO[e.type].label, PLAYER_CSS[e.p] ?? '#fff', 11);
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
      case 'relic': {
        const who = v.players[e.p];
        const x = e.x;
        const y = VIEW.arenaBottom - 30;
        if (e.t === 'get' && e.r !== undefined) {
          audio.play('combo');
          this.burst(x, y, 0xa855f7, 30, 240);
          this.floatText(x, y - 70, `RELIC: ${RELIC_INFO[RELIC_KINDS[e.r]].name}`, '#d8b4fe', 11);
          if (who) this.cameras.main.flash(100, 168, 85, 247, false);
        } else if (e.t === 'full') {
          audio.play('pickup');
          this.floatText(x, y - 70, 'RELICS FULL +300', '#d8b4fe', 9);
        } else if (e.t === 'dash') {
          audio.play('sync', { pitch: 1.6 });
          this.burst(x, y, 0xffffff, 10, 160);
        } else if (e.t === 'wake') {
          audio.play('pickup', { pitch: 1.3 });
          this.floatText(x, y - 70, 'SECOND WIND', '#d8b4fe', 9);
        } else if (e.t === 'lifeline') {
          this.floatText(x, y - 70, 'LIFELINE!', '#d8b4fe', 9);
        } else if (e.t === 'share') {
          audio.play('pickup', { pitch: 1.2 });
          this.burst(x, y, 0x4cc9f0, 10, 140);
        }
        break;
      }
      case 'stage':
        if (e.t === 'wallWarn' || e.t === 'mirrorWarn') audio.play('warn');
        else if (e.t === 'wallStart') {
          audio.play('sky');
          shake(160, 0.006);
        } else if (e.t === 'mirrorStart') audio.play('chaos');
        break;
      case 'pinch':
        audio.play('combo');
        this.burst(e.x, top + e.y, 0xffe066, 26, 240);
        this.floatText(e.x, top + e.y - 26, 'PINCH!', '#ffe066', 12);
        shake(120, 0.006);
        break;
      case 'gift':
        this.onGift(e, v);
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

  /** Rare-crate outcomes: only the ones that need a word of their own (the pickup label covers the rest). */
  private onGift(e: Extract<TickedEvent, { k: 'gift' }>, v: ViewState): void {
    const x = e.x;
    const y = VIEW.arenaY + e.y;
    const say = (text: string, color: string, size = 10) => this.floatText(x, y - 28, text, color, size);
    switch (e.t) {
      case 'chestLife':
        audio.play('combo');
        this.burst(x, y, 0x5cf2a0, 20, 200);
        say('+1 LIFE!', '#5cf2a0', 12);
        break;
      case 'chestCurse':
        audio.play('deny');
        this.burst(x, y, 0xff3355, 18, 180);
        say('CURSED! IT GREW', '#ff6680', 11);
        break;
      case 'decoy':
        audio.play('warn');
        say('BOMB! RUN!', '#ff6680', 13);
        break;
      case 'pinata':
        audio.play('combo');
        this.burst(x, y, 0xff70a6, 30, 260);
        break;
      case 'freeze':
        audio.play('sync');
        this.burst(x, y, 0xbff3ff, 16, 160);
        break;
      case 'thaw':
        audio.play('hit', { pitch: 1.4 });
        break;
      case 'slow':
        audio.play('fuse');
        break;
      case 'slowEnd':
        audio.play('hit', { pitch: 0.8 });
        break;
      case 'donWin':
        audio.play('combo');
        say('DOUBLE BONUS!', '#ffe066', 12);
        break;
      case 'donLose':
        audio.play('deny');
        say('NOTHING! -500', '#ff6680', 11);
        break;
      case 'batonGive': {
        audio.play('combo');
        const from = e.to !== undefined ? v.players[e.to] : undefined;
        say('SHARED SHIELD!', '#4cc9f0', 11);
        if (from) this.burst(from.x, VIEW.arenaBottom - 24, 0x4cc9f0, 14, 160);
        break;
      }
      case 'flare':
        audio.play('combo');
        this.burst(x, y, 0xff6b35, 28, 240);
        say('REVIVED!', '#ff9f43', 13);
        break;
      case 'flareFizzle':
        audio.play('deny');
        say('NOBODY DOWN', '#9aa3c7', 9);
        break;
      default:
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
      case 'coopHit':
        audio.play('sync', { pitch: 1.25 });
        this.burst(x, y, 0x2ee6a6, 8, 120);
        break;
      case 'linkStart':
        audio.play('fuse', { pitch: 1.2 });
        this.burst(x, y, 0xff9f1c, 10, 140);
        break;
      case 'linkDone':
      case 'priorityDone':
        audio.play('combo');
        this.burst(x, y, 0xffe066, 22, 220);
        break;
      case 'priorityFail':
        audio.play('enrage');
        this.burst(x, y, 0xff3b30, 14, 180);
        break;
      case 'linkFail':
      case 'coopFail':
        audio.play('deny');
        this.burst(x, y, 0xff3b30, 10, 150);
        break;
      case 'coopDone':
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

  /**
   * Particle bursts reuse a few long-lived emitters (one per speed class) instead of creating and
   * destroying two emitters per pop, which got expensive when four players pop at once.
   */
  private emitters = new Map<string, Phaser.GameObjects.Particles.ParticleEmitter>();

  private emitter(kind: 'spark' | 'shard', speed: number): Phaser.GameObjects.Particles.ParticleEmitter {
    const cls = speed <= 160 ? 150 : speed <= 260 ? 240 : 340;
    const key = `${kind}${cls}`;
    let em = this.emitters.get(key);
    if (!em) {
      em =
        kind === 'spark'
          ? this.add.particles(0, 0, TEXTURES.spark, {
              speed: { min: cls * 0.3, max: cls },
              angle: { min: 0, max: 360 },
              scale: { start: 0.7, end: 0 },
              alpha: { start: 1, end: 0 },
              lifespan: { min: 300, max: 650 },
              gravityY: 380,
              blendMode: Phaser.BlendModes.ADD,
              maxAliveParticles: 90,
              emitting: false,
            })
          : this.add.particles(0, 0, TEXTURES.shard, {
              speed: { min: cls * 0.5, max: cls * 1.2 },
              angle: { min: 0, max: 360 },
              rotate: { start: 0, end: 360 },
              scale: { start: 0.8, end: 0.2 },
              lifespan: 500,
              gravityY: 520,
              maxAliveParticles: 40,
              emitting: false,
            });
      em.setDepth(kind === 'spark' ? 30 : 29);
      this.emitters.set(key, em);
    }
    return em;
  }

  private burst(x: number, y: number, tint: number, count: number, speed: number): void {
    const sparks = this.emitter('spark', speed);
    sparks.setParticleTint(tint);
    sparks.explode(Math.min(count, 28), x, y);
    const shards = this.emitter('shard', speed);
    shards.setParticleTint(tint);
    shards.explode(Math.min(Math.ceil(count / 3), 10), x, y);
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
    if ((this.lastPhase === 'gameOver' || this.lastPhase === 'victory') && v.phase === 'countdown') {
      this.tally = new AwardTally();
      this.shovedAt = [];
    }
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
      const social = this.socialLines(v, won);
      const daily = this.source.daily;
      // Awards make the card taller; everything below the scores moves down by `dy`.
      const dy = social.length ? 8 + social.length * 21 : 0;
      add(panel(this, cx, cy + dy / 2, 620, 380 + dy));
      title(cy - 140, won ? 'VICTORY!' : 'GAME OVER', won ? COLORS.good : COLORS.bad, 32);
      const scoreLines = v.players
        .filter((p) => p.active || p.score > 0)
        .map((p) => `${(names[p.slot] ?? 'P' + (p.slot + 1)).toUpperCase()}   ${String(p.score).padStart(6, '0')}`)
        .join('\n');
      add(this.add.text(cx, cy - 64, scoreLines, TEXT.display(14)).setOrigin(0.5).setAlign('center').setLineSpacing(10));
      social.forEach((l, i) => body(cy - 2 + i * 21, l.text, l.color, 15));
      const y0 = cy + dy;
      if (daily) body(y0 - 4, `DAILY LEVEL ${daily}  ·  the same level for everyone today`, COLORS.textDim, 15);
      else if (won) body(y0 - 4, this.source.practice ? 'Practice level cleared!' : `All ${this.source.levelCount} levels cleared. Legendary teamwork!`, COLORS.textDim, 16);
      if (online) {
        const seats = this.session?.room?.seats ?? [];
        const mine = seats[this.source.localSlot]?.rematch;
        const theirs = seats.some((s, i) => i !== this.source.localSlot && s?.rematch);
        if (theirs && !mine) body(y0 + 22, 'Your partner wants a rematch!', COLORS.accentCss, 17);
        btn(y0 + 64, mine ? 'WAITING FOR PARTNER…' : 'REMATCH', () => this.source.requestRematch(), true).setEnabled(!mine);
        btn(y0 + 128, 'RETURN TO LOBBY', () => this.session?.toLobby());
        if (this.clip) {
          btn(y0 + 182, '📹 SAVE CLIP', () => this.saveClip(), false, 220).setScale(0.85).setX(cx - 120);
          btn(y0 + 182, 'MAIN MENU', () => this.quitToMenu(), false, 220).setScale(0.85).setX(cx + 120);
        } else btn(y0 + 182, 'MAIN MENU', () => this.quitToMenu(), false, 220).setScale(0.85);
      } else if (daily) {
        btn(y0 + 64, 'PLAY AGAIN', () => this.source.requestRematch(), true);
        btn(y0 + 128, 'COPY SCORE', () => this.copyDaily(v, won), false, 220).setX(cx - 120);
        btn(y0 + 128, 'MAIN MENU', () => this.quitToMenu(), false, 220).setX(cx + 120);
      } else {
        btn(y0 + 64, 'PLAY AGAIN', () => this.source.requestRematch(), true);
        btn(y0 + 128, 'MAIN MENU', () => this.quitToMenu());
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
  // Social: awards, blame, emotes, clips, daily score
  // ---------------------------------------------------------------------------

  /** Award lines and the "final blow" line for the end card (online matches with 2+ Lancers). */
  private socialLines(v: ViewState, won: boolean): { text: string; color: string }[] {
    if (this.source.mode !== 'online') return [];
    const names = this.source.names();
    const slots = v.players.filter((p) => p.active || p.score > 0).map((p) => p.slot);
    if (slots.length < 2) return [];
    const nm = (s: number) => (names[s] ?? `P${s + 1}`).toUpperCase();
    const out: { text: string; color: string }[] = this.tally.awards(slots).map((a) => ({
      text: `${AWARD_INFO[a.kind].title}  ${nm(a.slot)}: ${AWARD_INFO[a.kind].line.replace('{n}', String(a.n))}`,
      color: PLAYER_CSS[a.slot] ?? COLORS.text,
    }));
    const last = this.tally.lastDeath;
    if (!won && last) {
      const blamed = last.b !== undefined ? nm(last.b) : undefined;
      out.push({ text: `FINAL BLOW: ${blameLine(nm(last.p), last.c, blamed, this.wasShoved(last.p))}`, color: COLORS.bad });
    }
    return out.slice(0, 5);
  }

  private wasShoved(slot: number): boolean {
    return performance.now() - (this.shovedAt[slot] ?? -1e9) < SHOVE.blameSeconds * 1000 + 400;
  }

  /** Kill feed under the HUD: the newest three lines, each fading after a few seconds. */
  private addFeed(text: string, color: string): void {
    const t = this.add.text(12, VIEW.arenaY + 10, text, TEXT.body(15, color)).setDepth(96).setShadow(2, 2, '#000', 0, false, true);
    this.feed.unshift(t);
    this.feed.splice(3).forEach((o) => o.destroy());
    this.feed.forEach((o, i) => o.setY(VIEW.arenaY + 10 + i * 20));
    this.tweens.add({
      targets: t,
      alpha: 0,
      delay: 3500,
      duration: 600,
      onComplete: () => {
        this.feed = this.feed.filter((o) => o !== t);
        t.destroy();
      },
    });
  }

  private onEmote(slot: number, index: number): void {
    const glyph = EMOTE_GLYPHS[index];
    const p = this.lastView?.players[slot];
    if (!glyph || !p || !p.active) return;
    const name = (this.source.names()[slot] ?? '').toUpperCase();
    const t = this.add.text(p.x, VIEW.arenaBottom - 96, glyph, { fontSize: '34px', fontFamily: 'sans-serif' }).setOrigin(0.5).setDepth(97).setScale(0.3);
    const tag = this.add.text(p.x, VIEW.arenaBottom - 70, name, TEXT.body(12, PLAYER_CSS[slot] ?? '#fff')).setOrigin(0.5).setDepth(97);
    audio.play('tick', { pitch: 1.4 + index * 0.15 });
    this.tweens.add({ targets: t, scale: 1, duration: 220, ease: 'Back.easeOut' });
    this.tweens.add({ targets: [t, tag], y: '-=40', alpha: 0, delay: 1100, duration: 500, onComplete: () => (t.destroy(), tag.destroy()) });
  }

  private sendEmote(index: number): void {
    if (index >= 0 && index < EMOTES.length) this.session?.sendEmote(index);
  }

  private saveClip(): void {
    const ok = this.clip?.clip();
    this.floatText(VIEW.width / 2, VIEW.arenaY + 60, ok ? 'CLIP SAVED 📹' : 'NOTHING RECORDED YET', ok ? COLORS.good : COLORS.textDim, 12);
  }

  private copyDaily(v: ViewState, won: boolean): void {
    const score = v.players[0]?.score ?? 0;
    const text = `Orb Lancers DAILY ${this.source.daily}: level ${v.levelIndex + 1}, ${score} pts ${won ? '✅' : '💀'}\n${location.origin}`;
    const shown = () => this.floatText(VIEW.width / 2, VIEW.arenaY + 60, 'SCORE COPIED, SEND IT TO YOUR FRIENDS', COLORS.good, 11);
    const failed = () => this.floatText(VIEW.width / 2, VIEW.arenaY + 60, text.split('\n')[0], COLORS.text, 9);
    if (navigator.clipboard) void navigator.clipboard.writeText(text).then(shown, failed);
    else failed();
  }

  /** Emote keys (1-4), clip key (C), the clip recorder, and touch buttons for both. Online only. */
  private createSocialControls(): void {
    if (this.source.mode !== 'online') return;
    if (ClipRecorder.supported) {
      this.clip = new ClipRecorder(this.game.canvas, audio.stream());
      this.clip.start();
    }
    const kb = this.input.keyboard;
    ['ONE', 'TWO', 'THREE', 'FOUR'].forEach((k, i) => kb?.on(`keydown-${k}`, () => this.sendEmote(i)));
    kb?.on('keydown-C', () => this.saveClip());
    if (this.sys.game.device.input.touch) {
      const items: [string, () => void][] = EMOTE_GLYPHS.map((g, i): [string, () => void] => [g, () => this.sendEmote(i)]);
      if (this.clip) items.push(['📹', () => this.saveClip()]);
      items.forEach(([g, fn], i) => {
        const x = VIEW.width / 2 + (i - (items.length - 1) / 2) * 50;
        const y = VIEW.height - 34;
        const c = this.add.circle(x, y, 20, 0xffffff, 0.1).setStrokeStyle(2, 0xffffff, 0.3).setDepth(80).setInteractive();
        this.add.text(x, y, g, { fontSize: '20px', fontFamily: 'sans-serif' }).setOrigin(0.5).setDepth(81).setAlpha(0.85);
        c.on('pointerdown', fn);
      });
    } else {
      this.add.text(VIEW.width / 2, VIEW.height - 8, `1-4 EMOTES${this.clip ? '  ·  C SAVE CLIP' : ''}`, TEXT.body(12, COLORS.textDim)).setOrigin(0.5, 1).setDepth(81).setAlpha(0.6);
    }
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
