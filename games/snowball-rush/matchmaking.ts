// Fake online matchmaking screen (owner: ui-core): slots fill with opponents over ~2-4 s, online counter. Resolves when done.
import type { Ctx, Profile } from './types';

export function matchmaking(ctx: Ctx, player: Profile, opponents: Profile[]): Promise<void> { throw new Error('TODO' + ctx + player + opponents); }
