import { ROOM } from '../constants/game';

/** No I, O, 0, 1 — easy to read aloud and type on a phone. 32 symbols → 32^6 ≈ 1.07e9 codes. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_RE = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM.codeLength}}$`);

export function generateRoomCode(random: (n: number) => Uint8Array = defaultRandom): string {
  const bytes = random(ROOM.codeLength);
  let out = '';
  // 256 is an exact multiple of 32 → no modulo bias.
  for (let i = 0; i < ROOM.codeLength; i++) out += ROOM_CODE_ALPHABET[bytes[i] % ROOM_CODE_ALPHABET.length];
  return out;
}

/** Case-insensitive; strips spaces/dashes people add when sharing. Returns null if invalid. */
export function normalizeRoomCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const c = input.trim().toUpperCase().replace(/[\s-]/g, '');
  return CODE_RE.test(c) ? c : null;
}

function defaultRandom(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

/** Nicknames: 1–12 chars of letters, digits, space, _ - . (anything else is stripped). */
export function sanitizeNickname(input: unknown, fallback = 'Lancer'): string {
  if (typeof input !== 'string') return fallback;
  const s = input
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N} _.-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 12)
    .trim();
  return s.length > 0 ? s : fallback;
}
