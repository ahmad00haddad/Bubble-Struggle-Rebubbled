import type { RelicKind } from '@orb/shared';

export interface RelicInfo {
  /** Two letters shown over the Lancer. */
  code: string;
  name: string;
  desc: string;
}

/** Relics are permanent for the run (see RELIC in shared constants). Utility over raw power. */
export const RELIC_INFO: Record<RelicKind, RelicInfo> = {
  magnet: { code: 'MG', name: 'MAGNET HAND', desc: 'Crates near you drift toward you.' },
  quickdraw: { code: 'QD', name: 'QUICK DRAW', desc: 'Your first tether after a respawn or level start fires instantly and starts higher.' },
  anchor: { code: 'AM', name: 'ANCHOR MASTER', desc: 'Anchor charge and stick time +50%.' },
  dash: { code: 'DS', name: 'DASH', desc: 'Double-tap a direction to dash, with brief protection. 4 s cooldown.' },
  guardian: { code: 'GD', name: 'GUARDIAN', desc: 'Orbs near you move slower. Stay close to your team.' },
  relay: { code: 'RL', name: 'RELAY', desc: 'After a teammate pops an orb, you get a second tether for 1.5 s.' },
  coordinator: { code: 'CO', name: 'COORDINATOR', desc: 'Co-op targets you start give the team a 50% longer window.' },
  lifeline: { code: 'LL', name: 'LIFELINE', desc: 'A fallen teammate gives you a speed burst. Rescue flares last longer.' },
  teamplayer: { code: 'TP', name: 'TEAM PLAYER', desc: 'A nearby teammate gets a short copy of your Shield, Speed or Double Tether.' },
  secondwind: { code: 'SW', name: 'SECOND WIND', desc: 'Once per level: you respawn faster, with extra protection.' },
  lightfeet: { code: 'LF', name: 'LIGHT FEET', desc: 'Ice hardly slides you.' },
  steadyhand: { code: 'SH', name: 'STEADY HAND', desc: 'Reversed controls last half as long.' },
};
