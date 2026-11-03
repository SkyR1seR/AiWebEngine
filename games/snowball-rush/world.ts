// 3D level view (owner: world): track blocks, decorations, obstacles, pickups, holes/bridges, finish, bonus walls.
import type { DirectionalLight, Game, Node } from 'aiwebengine';
import type { LevelData, Obstacle, Pickup } from './types';
import type { RaceSim } from './sim';

export interface Env {
  sun: DirectionalLight;
  /** 0 day, 1 sunset, 2 night, 3 snowstorm, 4 = lobby look */
  setTheme(theme: number): void;
  /** center of the shadow map */
  focus(x: number, y: number, z: number): void;
}
/** sky, fog, lights, post (once at startup) */
export function setupEnv(game: Game): Env { throw new Error('TODO ' + game); }

export class WorldView {
  root!: Node;
  constructor(game: Game, level: LevelData) { void game; void level; }
  /** sync moving obstacles, broken obstacles, bridges, pickups with the sim */
  update(sim: RaceSim, dt: number): void { throw new Error('TODO' + sim + dt); }
  onSmash(o: Obstacle): void { throw new Error('TODO' + o); }
  onBridge(o: Obstacle, x0: number, x1: number): void { throw new Error('TODO' + o + x0 + x1); }
  onPickup(p: Pickup): void { throw new Error('TODO' + p); }
  destroy(): void {}
}
