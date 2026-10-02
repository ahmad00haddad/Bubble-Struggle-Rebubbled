import type { PowerUpType } from '@orb/shared';

export type CrateKind = 'good' | 'risky' | 'trap' | 'team';

export interface CrateInfo {
  /** Short word shown when it is picked up. */
  label: string;
  /** Full name in the guide. */
  name: string;
  desc: string;
  kind: CrateKind;
}

/** Everything the player can read about a crate: pickup text and the guide page. */
export const POWERUP_INFO: Record<PowerUpType, CrateInfo> = {
  shield: { label: 'SHIELD!', name: 'SHIELD', desc: 'Absorbs one hit.', kind: 'good' },
  extraLife: { label: '1-UP!', name: 'EXTRA LIFE', desc: '+1 life.', kind: 'good' },
  extraTime: { label: '+TIME!', name: 'EXTRA TIME', desc: '+20 s on the clock.', kind: 'good' },
  doubleHarpoon: { label: 'DOUBLE TETHER!', name: 'DOUBLE TETHER', desc: 'Two shots at once.', kind: 'good' },
  speedBoost: { label: 'SPEED UP!', name: 'SPEED BOOST', desc: 'Run faster for 10 s.', kind: 'good' },
  anchor: { label: 'ANCHOR TETHER!', name: 'ANCHOR', desc: 'Next shot sticks to the ceiling for 4 s.', kind: 'good' },
  chaos: { label: 'CHAOS!', name: 'CHAOS', desc: 'A short prank on a teammate. Teams only.', kind: 'team' },
  shrink: { label: 'SHRINK TIME!', name: 'SHRINK TIME', desc: '-8 s on the clock, but double points for 10 s.', kind: 'risky' },
  boots: { label: 'HEAVY BOOTS!', name: 'HEAVY BOOTS', desc: 'Slower for 8 s, but you get a shield.', kind: 'risky' },
  potato: { label: 'HOT POTATO!', name: 'HOT POTATO', desc: 'Super speed for 6 s, but you cannot shoot.', kind: 'risky' },
  wide: { label: 'WIDE TETHER!', name: 'WIDE TETHER', desc: 'Shots three times wider for 8 s.', kind: 'good' },
  pinata: { label: 'PIÑATA!', name: 'PIÑATA', desc: 'Breaks the nearest small orb into gifts.', kind: 'good' },
  chest: { label: 'GAMBLE!', name: 'GAMBLE CHEST', desc: '60% extra life. Otherwise a nearby orb grows.', kind: 'risky' },
  decoy: { label: 'IT WAS A TRAP!', name: 'DECOY', desc: 'Looks like a Shield. Drops a bomb under you!', kind: 'trap' },
  slow: { label: 'SLOW ORBS!', name: 'SLOW ORBS', desc: 'Every orb 40% slower for 5 s.', kind: 'good' },
  freeze: { label: 'FREEZE!', name: 'FREEZE', desc: 'Freezes the nearest orb for 5 s. It cannot hurt you.', kind: 'good' },
  magnet: { label: 'MAGNET!', name: 'MAGNET CORE', desc: 'Small orbs head for you for 4 s. Careful.', kind: 'risky' },
  double: { label: 'DOUBLE OR NOTHING!', name: 'DOUBLE OR NOTHING', desc: 'Clear the level unhit: double bonus. Get hit: -500.', kind: 'risky' },
  baton: { label: 'BATON!', name: 'BATON', desc: 'Shield for you. A teammate pops an orb in 3 s: shield for them too.', kind: 'team' },
  flare: { label: 'RESCUE FLARE!', name: 'RESCUE FLARE', desc: 'Brings a fallen teammate back right where you stand.', kind: 'team' },
  boomerang: { label: 'BOOMERANG!', name: 'BOOMERANG', desc: 'Piercing shot that returns. Up to 3 hits.', kind: 'good' },
};

export const KIND_COLOR: Record<CrateKind, string> = {
  good: '#5cf2a0',
  risky: '#ffc145',
  trap: '#ff6680',
  team: '#4cc9f0',
};
