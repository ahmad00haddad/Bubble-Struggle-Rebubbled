/**
 * Key bindings, expressed as KeyboardEvent.code values so they are layout
 * independent and engine independent.
 *
 * Online play: each device controls exactly one Lancer, so BOTH schemes drive
 * the local player (a player on device B can use either arrows or A/D/Q).
 * Solo play: both schemes drive the solo Lancer as well.
 */
export interface ControlScheme {
  left: readonly string[];
  right: readonly string[];
  shoot: readonly string[];
}

export const CONTROLS: { player1: ControlScheme; player2: ControlScheme; pause: readonly string[] } = {
  player1: { left: ['ArrowLeft'], right: ['ArrowRight'], shoot: ['Space'] },
  player2: { left: ['KeyA'], right: ['KeyD'], shoot: ['KeyQ'] },
  pause: ['Escape', 'KeyP'],
};

/** Human-readable labels for the How To Play screen. */
export function describeKeys(codes: readonly string[]): string {
  return codes
    .map((c) => c.replace(/^Key/, '').replace(/^Arrow/, '').replace('Space', 'SPACE').replace('Escape', 'ESC'))
    .join(' / ');
}
