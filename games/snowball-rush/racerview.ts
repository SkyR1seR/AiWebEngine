// Visuals of one racer (owner: world): character, voxel ball, blob shadow, name tag with ball size, emote bubbles, effects.
import type { Game, Node } from 'aiwebengine';
import type { UI } from 'aiwebengine/ui';
import type { Racer } from './types';

export class RacerView {
  root!: Node;
  constructor(game: Game, ui: UI, public racer: Racer, opts: { label: boolean }) { void game; void ui; void opts; }
  /** sync with racer state (pose, ball size/rotation, visibility) */
  update(dt: number): void { throw new Error('TODO' + dt); }
  shatter(): void {}
  splash(): void {}
  smash(): void {}
  pickup(kind: string): void { void kind; }
  emote(text: string): void { void text; }
  /** the racer left (fake disconnect): fade out */
  vanish(): void {}
  destroy(): void {}
}
