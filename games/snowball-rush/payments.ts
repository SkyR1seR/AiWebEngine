// In-app purchases (owner: meta): Playgama Bridge payments (ctx.sdk) with catalog prices, consume by product id,
// crash recovery (getPurchases on start); local test mode.
import type { Playgama } from 'aiwebengine/playgama';
import type { Ctx, Drop } from './types';

export interface Price { text: string; /** currency icon URL from the portal (optional) */ icon?: string }

export class Payments {
  /** purchases possible (portal payments ready, or local test mode) */
  available = false;
  /** local test mode: purchases succeed instantly (localhost / ?testpay=1 without the SDK) */
  test = false;
  static async init(sdk: Playgama): Promise<Payments> { throw new Error('TODO' + sdk); }
  price(productId: string): Price { throw new Error('TODO' + productId); }
  /** purchase; on success calls grant() exactly once, then consumes consumables. true = granted */
  async buy(productId: string, grant: () => void): Promise<boolean> { throw new Error('TODO' + productId + grant); }
  /** product ids of active purchases: unconsumed consumables (crash between pay and grant) and owned permanent ones (no_ads) */
  async pending(): Promise<string[]> { throw new Error('TODO'); }
}

/** buy a product and grant its rewards (+ one-time mark, persist, refresh). Resolves the granted drops or null. */
export async function buyProduct(ctx: Ctx, productId: string): Promise<Drop[] | null> { throw new Error('TODO' + ctx + productId); }
/** at startup: grant + consume unprocessed consumables, restore no_ads */
export async function restorePurchases(ctx: Ctx): Promise<void> { throw new Error('TODO' + ctx); }
