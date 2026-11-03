// In-race HUD (owner: ui-core): place, progress bar with racer markers, ball size meter, coins, countdown, event texts, hints, pause.
import type { Ctx, Racer } from './types';
import type { RaceSim } from './sim';

export class Hud {
  /** called when the player chooses "leave race" in the pause dialog */
  onQuit: () => void = () => {};
  constructor(ctx: Ctx) { void ctx; }
  show(on: boolean): void { void on; }
  /** new race: racers (player included) */
  bind(sim: RaceSim, player: Racer): void { void sim; void player; }
  update(dt: number): void { void dt; }
  /** big centered countdown: 3, 2, 1, 'go' */
  countdown(v: number | 'go'): void { void v; }
  /** short big text in the middle ("СТЕНА ПРОБИТА!", "x2", "КОМ РАЗБИТ") */
  flash(text: string, color?: string): void { void text; void color; }
  /** tutorial / hint banner (null hides) */
  hint(text: string | null): void { void text; }
  /** shield count / power-up indicator */
  power(kind: string | null, seconds?: number): void { void kind; void seconds; }
}
