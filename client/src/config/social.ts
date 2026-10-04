import type { AwardKind } from '@orb/shared';

/** Emote glyphs, in EMOTES order (laugh, help, here, angry). */
export const EMOTE_GLYPHS = ['😂', '🙏', '👇', '😤'] as const;

/** End-of-match award titles. `{n}` is replaced by the count behind the award. */
export const AWARD_INFO: Record<AwardKind, { title: string; line: string }> = {
  blamed: { title: '🤡 FRIENDLY FIRE', line: 'blamed for {n} teammate death(s)' },
  magnet: { title: '🧲 ORB MAGNET', line: 'died {n} times' },
  bulldozer: { title: '🚜 BULLDOZER', line: 'shoved teammates {n} times' },
  troll: { title: '😈 CHIEF TROLL', line: 'cursed teammates {n} time(s)' },
  hero: { title: '🦸 THE HERO', line: 'grabbed {n} rescue flare(s)' },
  firstOut: { title: '👻 FIRST TO DIE', line: 'went down before anyone else' },
  victim: { title: '🎯 CHAOS VICTIM', line: 'cursed {n} times' },
  closer: { title: '🏁 THE CLOSER', line: 'popped the last orb {n} time(s)' },
  sniper: { title: '🎯 SHARPSHOOTER', line: 'popped {n} orbs' },
};

const CAUSE: Record<string, string> = { orb: 'an orb', spikes: 'the spikes', bomb: 'a bomb', time: 'the clock' };

/** "OMAR ← split by AHMAD" style line for the kill feed and the blame card. */
export function blameLine(victim: string, cause: string | undefined, blamed: string | undefined, shoved: boolean): string {
  if (blamed && shoved) return `${victim} was SHOVED by ${blamed} 💀`;
  if (blamed) return `${victim} hit an orb ${blamed} split 💀`;
  return `${victim} was taken by ${CAUSE[cause ?? 'orb'] ?? 'an orb'}`;
}
