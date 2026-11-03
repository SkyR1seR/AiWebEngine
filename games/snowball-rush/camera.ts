// Race camera (owner: world): chase cam behind the player, intro flyover, shake.
import type { Game } from 'aiwebengine';
import type { Racer } from './types';
import type { RaceSim } from './sim';

export class RaceCamera {
  constructor(game: Game) { void game; }
  reset(r: Racer): void { throw new Error('TODO' + r); }
  update(r: Racer, dt: number): void { throw new Error('TODO' + r + dt); }
  shake(amount: number): void { void amount; }
  /** fly from the finish to the start line over `seconds` */
  intro(sim: RaceSim, seconds: number): Promise<void> { throw new Error('TODO' + sim + seconds); }
}
