// Menu backdrop (owner: world): cozy snowy yard with a decorated tree, the player's character and ball, camera framing.
import type { Game } from 'aiwebengine';
import type { Env } from './world';

export class Lobby {
  constructor(game: Game, env: Env) { void game; void env; }
  /** show the lobby and take over the camera */
  enter(): void { throw new Error('TODO'); }
  leave(): void { throw new Error('TODO'); }
  setLook(skin: string, ball: string): void { throw new Error('TODO' + skin + ball); }
  update(dt: number): void { throw new Error('TODO' + dt); }
  /** a little celebration (bought a skin, opened a case) */
  cheer(): void {}
}
