// Player steering (owner: core): keyboard A/D/arrows + relative horizontal drag (mouse / touch) → racer.targetX.
import type { Game } from 'aiwebengine';
import type { Racer } from './types';

export class PlayerControls {
  enabled = false;
  constructor(game: Game) { void game; }
  /** read input, set r.targetX */
  update(r: Racer, dt: number): void { throw new Error('TODO' + r + dt); }
  /** forget drag state, target = x */
  reset(x: number): void { throw new Error('TODO' + x); }
  destroy(): void {}
}
