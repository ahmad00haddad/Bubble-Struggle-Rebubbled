import { sanitizeNickname } from '@orb/shared';
import { NetSession } from '../networking/NetSession';
import { LanHost } from './LanHost';
import { LoopLink, RtcGuestLink } from './links';

/** Cloudflare's public STUN server: lets two browsers on different networks find each other too. */
const ICE: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] };
/** Give up and fall back to the online server after this long. */
const LINK_TIMEOUT_MS = 12000;

interface Guest {
  pc: RTCPeerConnection;
  dc: RTCDataChannel;
  name: string;
}

export interface LanCallbacks {
  /** Human-readable progress ("Linking…", or why it failed). */
  status: (text: string, bad?: boolean) => void;
  /** The match room is now this P2P session; the scene should switch to it. */
  adopt: (session: NetSession) => void;
}

/** Wait until the browser has found its network addresses (we send one complete description, no trickling). */
function iceDone(pc: RTCPeerConnection, ms = 2500): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    const check = () => pc.iceGatheringState === 'complete' && finish();
    const timer = setTimeout(finish, ms);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

/**
 * Sets up a direct (WebRTC) link between the players of an online room, using the room itself
 * to pass the connection details around. When every friend is linked, the host starts running the
 * match in their own tab and everyone switches to it; if linking fails nothing changes and the
 * normal online START still works.
 */
export class LanCoordinator {
  static get supported(): boolean {
    return typeof RTCPeerConnection !== 'undefined';
  }

  private guests = new Map<number, Guest>(); // host side, by room seat
  private toHost: { pc: RTCPeerConnection; dc: RTCDataChannel | null; slot: number } | null = null; // guest side
  private busy = false;
  private adopted = false;

  constructor(
    private cloud: NetSession,
    private nickname: string,
    private cb: LanCallbacks,
  ) {
    cloud.on('rtc', this.onRtc, this);
  }

  /** Stop listening. Links that were handed to the match stay open. */
  dispose(): void {
    this.cloud.off('rtc', this.onRtc, this);
    if (!this.adopted) this.closeAll();
  }

  get isBusy(): boolean {
    return this.busy;
  }

  // ---- host ---------------------------------------------------------------------------------

  async startAsHost(): Promise<void> {
    const room = this.cloud.room;
    if (this.busy || !room) return;
    const friends = room.seats.flatMap((s, i) => (s && s.connected && i !== this.cloud.slot ? [{ slot: i, name: s.name }] : []));
    if (friends.length === 0) {
      this.cb.status('Wait for at least one friend to join the room first.', true);
      return;
    }
    this.busy = true;
    this.cb.status('Linking directly to your friends…');
    try {
      await Promise.all(friends.map((f) => this.offer(f.slot, f.name)));
    } catch {
      this.failHost(friends.map((f) => f.slot));
      return;
    }

    // Everyone is linked: this tab becomes the match server. Guests hear "go" through the room.
    const lan = new LanHost(this.cloud.code);
    lan.expected = this.guests.size;
    for (const g of this.guests.values()) {
      g.dc.onmessage = (ev) => {
        try {
          const hello = JSON.parse(String(ev.data)) as { t?: string; name?: string };
          if (hello.t === 'hello') lan.attachPeer(g.dc, sanitizeNickname(hello.name ?? g.name));
        } catch {
          /* not a hello */
        }
      };
    }
    const session = new NetSession(this.cloud.code, this.nickname, { link: new LoopLink(lan, this.nickname), peer: true, autoReady: false });
    lan.onAllJoined = () => session.setReady(true);
    this.adopted = true;
    for (const f of friends) this.cloud.sendRtc(f.slot, JSON.stringify({ k: 'go' }));
    this.cb.adopt(session);
  }

  private async offer(slot: number, name: string): Promise<void> {
    const pc = new RTCPeerConnection(ICE);
    const dc = pc.createDataChannel('game');
    this.guests.set(slot, { pc, dc, name });
    const opened = new Promise<void>((resolve, reject) => {
      dc.onopen = () => resolve();
      setTimeout(() => reject(new Error('timeout')), LINK_TIMEOUT_MS);
    });
    await pc.setLocalDescription(await pc.createOffer());
    await iceDone(pc);
    this.cloud.sendRtc(slot, JSON.stringify({ k: 'offer', sdp: pc.localDescription?.sdp ?? '' }));
    await opened;
  }

  private failHost(slots: number[]): void {
    for (const s of slots) this.cloud.sendRtc(s, JSON.stringify({ k: 'fail' }));
    this.closeAll();
    this.busy = false;
    this.cb.status('Could not link directly (this network blocks it). Use the normal START to play online.', true);
  }

  // ---- guest + host replies ---------------------------------------------------------------------

  private onRtc(from: number, d: string): void {
    let m: { k?: string; sdp?: string; name?: string };
    try {
      m = JSON.parse(d);
    } catch {
      return;
    }
    if (m.k === 'offer' && typeof m.sdp === 'string') void this.answer(from, m.sdp);
    else if (m.k === 'answer' && typeof m.sdp === 'string') void this.guests.get(from)?.pc.setRemoteDescription({ type: 'answer', sdp: m.sdp }).catch(() => {});
    else if (m.k === 'go') this.joinHost(from);
    else if (m.k === 'fail') {
      this.closeAll();
      this.busy = false;
      this.cb.status('The host could not link directly. Use the normal START to play online.', true);
    }
  }

  private async answer(from: number, sdp: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.cb.status('Host is linking you directly…');
    try {
      const pc = new RTCPeerConnection(ICE);
      this.toHost = { pc, dc: null, slot: from };
      pc.ondatachannel = (ev) => {
        if (this.toHost) this.toHost.dc = ev.channel;
      };
      await pc.setRemoteDescription({ type: 'offer', sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      await iceDone(pc);
      this.cloud.sendRtc(from, JSON.stringify({ k: 'answer', sdp: pc.localDescription?.sdp ?? '', name: this.nickname }));
    } catch {
      this.closeAll();
      this.busy = false;
    }
  }

  private joinHost(from: number): void {
    const link = this.toHost;
    if (!link || link.slot !== from || !link.dc) return;
    this.adopted = true;
    const session = new NetSession(this.cloud.code, this.nickname, { link: new RtcGuestLink(link.dc, this.nickname), peer: true, autoReady: true });
    this.cb.adopt(session);
  }

  private closeAll(): void {
    for (const g of this.guests.values()) g.pc.close();
    this.guests.clear();
    this.toHost?.pc.close();
    this.toHost = null;
  }
}
