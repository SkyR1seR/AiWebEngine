// Offer popups & banners (owner: ui-store).
import type { Ctx } from './types';
import type { Offer } from './offers';

/** big popup for an offer id (from offers.activeOffers); no-op if it is gone */
export function showOffer(ctx: Ctx, id: string): void { throw new Error('TODO' + ctx + id); }
/** compact banner (art, discount badge, timer) that opens showOffer on click — used by the menu */
export function offerBanner(ctx: Ctx, offer: Offer): HTMLElement { throw new Error('TODO' + ctx + offer); }
