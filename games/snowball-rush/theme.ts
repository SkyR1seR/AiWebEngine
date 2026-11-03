// Blocky pixel UI theme (owner: ui-core): font faces, CSS for buttons/panels/cards/tabs/badges, layers, UI scale.
import type { Game } from 'aiwebengine';
import type { UI } from 'aiwebengine/ui';
import type { Rarity } from './types';

/** CSS font-family of the game UI (pass to new UI(game, { font: FONT })) */
export const FONT = "'Pixelify Sans',system-ui,sans-serif";
export const RARITY_COLOR: Record<Rarity, string> = { common: '#9aa4ad', rare: '#3f8cff', epic: '#b350ff', legendary: '#ffb31a' };
/** inject @font-face + all game CSS (once) */
export function applyTheme(): void { throw new Error('TODO'); }
/** keep --u = clamp(min(W, H) / 720, 0.4, 2.5) on every resize */
export function fitUI(ui: UI, game: Game): void { throw new Error('TODO' + ui + game); }
