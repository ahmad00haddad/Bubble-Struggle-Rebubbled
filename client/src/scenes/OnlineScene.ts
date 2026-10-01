import Phaser from 'phaser';
import { normalizeRoomCode, sanitizeNickname } from '@orb/shared';
import { VIEW } from '../config/clientConfig';
import { getSettings, updateSettings } from '../config/settings';
import { ApiError, createRoom, roomStatus } from '../networking/api';
import { NetSession } from '../networking/NetSession';
import { Button, ButtonGroup } from '../ui/Button';
import { COLORS, TEXT } from '../ui/theme';
import { goTo, heading, menuBackdrop, panel, textInput } from '../ui/widgets';
import { REGISTRY, SCENES } from './keys';

export class OnlineScene extends Phaser.Scene {
  private status!: Phaser.GameObjects.Text;
  private busy = false;
  private nameEl!: HTMLInputElement;
  private codeEl!: HTMLInputElement;
  private buttons: Button[] = [];

  constructor() {
    super(SCENES.online);
  }

  create(data: { joinCode?: string; message?: string }): void {
    this.busy = false;
    this.cameras.main.fadeIn(200, 7, 10, 31);
    menuBackdrop(this);
    panel(this, VIEW.width / 2, 312, 620, 500);
    heading(this, 'PLAY ONLINE', 96);
    const cx = VIEW.width / 2;

    this.add.text(cx, 136, 'YOUR NICKNAME', TEXT.display(10, COLORS.textDim)).setOrigin(0.5);
    this.nameEl = textInput(this, cx, 172, { placeholder: 'NICKNAME', value: getSettings().nickname, maxLength: 12, width: 320 });

    const create = new Button(this, cx, 244, 'CREATE ROOM', () => void this.createRoomFlow(), { primary: true, width: 320 });
    this.add.text(cx, 292, '— OR JOIN A FRIEND —', TEXT.display(10, COLORS.textDim)).setOrigin(0.5);
    this.codeEl = textInput(this, cx, 332, { placeholder: 'ROOM CODE', value: data.joinCode ?? '', maxLength: 9, width: 320, uppercase: true });
    const join = new Button(this, cx, 400, 'JOIN ROOM', () => void this.joinRoomFlow(), { width: 320 });
    const back = new Button(this, cx, 516, 'BACK', () => goTo(this, SCENES.menu), { width: 200 });
    this.buttons = [create, join, back];
    new ButtonGroup(this, this.buttons, { onBack: () => goTo(this, SCENES.menu) }).focus(data.joinCode ? 1 : 0);

    this.status = this.add.text(cx, 456, data.message ?? '', TEXT.body(17, data.message ? COLORS.bad : COLORS.textDim)).setOrigin(0.5).setAlign('center');
    // Page refreshed / tab restored mid-game: we still hold this room's
    // reconnect token, so rejoin our seat automatically.
    const code = data.joinCode ? normalizeRoomCode(data.joinCode) : null;
    if (code && !data.message && sessionStorage.getItem(`orb-lancers.token.${code}`) && getSettings().nickname) {
      this.time.delayedCall(250, () => void this.joinRoomFlow());
    }
    this.codeEl.addEventListener('keydown', (e) => e.key === 'Enter' && void this.joinRoomFlow());
    this.nameEl.addEventListener('keydown', (e) => e.key === 'Enter' && !this.codeEl.value && void this.createRoomFlow());
  }

  private nickname(): string | null {
    const raw = this.nameEl.value.trim();
    if (!raw) {
      this.say('Please enter a nickname first.', true);
      this.nameEl.focus();
      return null;
    }
    const name = sanitizeNickname(raw);
    this.nameEl.value = name;
    updateSettings({ nickname: name });
    return name;
  }

  private say(msg: string, error = false): void {
    this.status.setText(msg).setColor(error ? COLORS.bad : COLORS.textDim);
  }

  private setBusy(b: boolean): void {
    this.busy = b;
    this.buttons.slice(0, 2).forEach((btn) => btn.setEnabled(!b));
  }

  private async createRoomFlow(): Promise<void> {
    if (this.busy) return;
    const name = this.nickname();
    if (!name) return;
    this.setBusy(true);
    this.say('Creating room…');
    try {
      const { code } = await createRoom();
      this.connect(code, name);
    } catch (e) {
      this.say(e instanceof ApiError ? e.message : 'Could not create a room.', true);
      this.setBusy(false);
    }
  }

  private async joinRoomFlow(): Promise<void> {
    if (this.busy) return;
    const name = this.nickname();
    if (!name) return;
    const code = normalizeRoomCode(this.codeEl.value);
    if (!code) {
      this.say('Room codes are 6 letters/numbers, e.g. K7PX2M.', true);
      this.codeEl.focus();
      return;
    }
    this.setBusy(true);
    this.say('Looking for room…');
    try {
      const st = await roomStatus(code);
      const rejoining = !!sessionStorage.getItem(`orb-lancers.token.${code}`);
      if (st.expired) throw new ApiError('ROOM_EXPIRED', 'That room has expired. Ask your friend for a new code.');
      if (!st.exists) throw new ApiError('ROOM_NOT_FOUND', `No room "${code}" — check the code.`);
      if (st.full && !rejoining) throw new ApiError('ROOM_FULL', 'That room is full (2 players).');
      this.connect(code, name);
    } catch (e) {
      this.say(e instanceof ApiError ? e.message : 'Could not join the room.', true);
      this.setBusy(false);
    }
  }

  private connect(code: string, name: string): void {
    this.say(`Connecting to ${code}…`);
    const old = this.registry.get(REGISTRY.session) as NetSession | undefined;
    if (old) old.leave();
    const session = new NetSession(code, name);
    this.registry.set(REGISTRY.session, session);
    const onWelcome = () => {
      session.off('error', onError);
      goTo(this, SCENES.lobby);
    };
    const onError = (err: { msg: string }) => {
      session.off('welcome', onWelcome);
      this.registry.remove(REGISTRY.session);
      this.say(err.msg, true);
      this.setBusy(false);
    };
    session.once('welcome', onWelcome);
    session.once('error', onError);
    session.connect();
  }
}
