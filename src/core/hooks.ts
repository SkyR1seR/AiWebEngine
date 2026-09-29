/** Per-frame callbacks registered lazily by optional modules (e.g. tweens), so the Game doesn't import them. */
export const frameHooks: ((dt: number) => void)[] = [];
