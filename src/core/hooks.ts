/** Per-frame callbacks registered lazily by optional modules (e.g. tweens), so the Game doesn't import them. */
export const frameHooks: ((dt: number) => void)[] = [];

/**
 * Startup progress marker: sets <html data-boot="..."> and logs `[aiwe] stage`.
 * Lets portal builds (see `npm run export`) report where loading stopped.
 */
export function boot(stage: string) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.boot = stage;
  console.info('[aiwe] ' + stage);
}
