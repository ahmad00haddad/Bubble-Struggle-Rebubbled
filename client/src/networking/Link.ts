import type { ServerMessage } from '@orb/shared';

export type NetStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

/**
 * One connection to a room, whatever carries it: a WebSocket to the online server
 * (NetClient), a WebRTC data channel to a friend who hosts the match (RtcGuestLink),
 * or the host's own in-memory connection to the room it runs (LoopLink).
 * NetSession only talks to this interface.
 */
export interface Link {
  status: NetStatus;
  rttMs: number;
  closeCode: number;
  readonly isFatal: boolean;
  onMessage: (m: ServerMessage) => void;
  onStatus: (s: NetStatus) => void;
  connect(): void;
  send(msg: object): void;
  close(): void;
}
