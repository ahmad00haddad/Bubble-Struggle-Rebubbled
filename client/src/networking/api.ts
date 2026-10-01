import { serverUrl } from '../config/clientConfig';

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(serverUrl() + path, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  } catch {
    throw new ApiError('NETWORK', 'Cannot reach the game server. Check your connection.');
  }
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(body.error ?? `HTTP_${res.status}`, `Server error (${body.error ?? res.status}).`);
  return body;
}

export function createRoom(): Promise<{ code: string }> {
  return call('/api/rooms', { method: 'POST', body: '{}' });
}

export interface RoomStatus {
  exists: boolean;
  expired: boolean;
  players: number;
  full: boolean;
  inMatch: boolean;
}

export function roomStatus(code: string): Promise<RoomStatus> {
  return call(`/api/rooms/${encodeURIComponent(code)}`);
}
