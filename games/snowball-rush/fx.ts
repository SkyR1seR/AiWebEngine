// Pixel particles and festive effects (owner: world).
import type { Game, Node, V3 } from 'aiwebengine';

export type BurstKind = 'snow' | 'ice' | 'wood' | 'fire' | 'steam' | 'coin' | 'gem' | 'confetti' | 'splash' | 'spark' | 'gift';
/** one-shot burst of square pixel particles */
export function pixelBurst(parent: Node, kind: BurstKind, at: V3, count?: number, scale?: number): void { throw new Error('TODO' + parent + kind + at + count + scale); }
/** falling snow around the camera */
export class Snowfall {
  constructor(game: Game, density = 1) { void game; void density; }
  setDensity(v: number): void { void v; }
  update(dt: number): void { void dt; }
  destroy(): void {}
}
/** festive firework burst in the sky */
export function fireworks(parent: Node, at: V3): void { throw new Error('TODO' + parent + at); }
