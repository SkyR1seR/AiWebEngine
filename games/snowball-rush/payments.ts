// In-app purchases (owner: meta): Yandex Games payments with catalog prices, consume, crash recovery; local test mode.
import type { Yandex } from 'aiwebengine/yandex';
import type { Ctx, Drop } from './types';

export interface Price { text: string; /** currency icon URL from the portal (optional) */ icon?: string }

export class Payments {
  /** purchases possible (portal payments ready, or local test mode) */
  available = false;
  /** local test mode: purchases succeed instantly (localhost / ?testpay=1 without the SDK) */
  test = false;
  static async init(ya: Yandex): Promise<Payments> { throw new Error('TODO' + ya); }
  price(productId: string): Price { throw new Error('TODO' + productId); }
  /** purchase; on success calls grant() exactly once, then consumes consumables. true = granted */
  async buy(productId: string, grant: () => void): Promise<boolean> { throw new Error('TODO' + productId + grant); }
  /** unconsumed purchases (crash between pay and consume) and owned non-consumables (no_ads) */
  async pending(): Promise<{ productId: string; token: string; consume(): Promise<void> }[]> { throw new Error('TODO'); }
}

/** buy a product and grant its rewards (+ one-time mark, persist, refresh). Resolves the granted drops or null. */
export async function buyProduct(ctx: Ctx, productId: string): Promise<Drop[] | null> { throw new Error('TODO' + ctx + productId); }
/** at startup: grant unprocessed purchases (dedupe by save.tokens), restore no_ads */
export async function restorePurchases(ctx: Ctx): Promise<void> { throw new Error('TODO' + ctx); }
