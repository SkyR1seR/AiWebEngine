// Tutorial UI (owner: ui-core): Нубик's coach bubbles with a pointing hand, new-obstacle intro cards, feature unlock popups.
import type { Ctx, Feature, ObstacleKind } from './types';

export interface Coach {
  /** remove the bubble */
  close(): void;
}
/**
 * Speech bubble from Нубик (portrait + text) with an optional animated hand:
 * 'drag' (swipe left-right, race start), 'tap' pointing at `target` (menu buttons). Non-blocking unless `modal`.
 */
export function coach(ctx: Ctx, text: string, opts?: { hand?: 'drag' | 'tap'; target?: HTMLElement; modal?: boolean; okLabel?: string; onOk?: () => void; where?: 'top' | 'bottom' | 'center' }): Coach {
  throw new Error('TODO' + ctx + text + opts);
}
/** card before a race introducing a new obstacle kind (art + name + one-line rule); resolves on "OK" */
export function introCard(ctx: Ctx, kind: ObstacleKind): Promise<void> { throw new Error('TODO' + ctx + kind); }
/** "New: Cases!" popup for an unlocked feature; resolves true if the player chose to open it now */
export function unlockPopup(ctx: Ctx, f: Feature): Promise<boolean> { throw new Error('TODO' + ctx + f); }
