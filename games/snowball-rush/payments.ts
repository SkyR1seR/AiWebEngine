// In-app purchases (owner: meta): Playgama Bridge payments (ctx.sdk) with catalog prices, consume by product id,
// crash recovery (getPurchases on start); local test mode.
//
// Double-grant guard: a consumable is granted first and consumed afterwards. If consuming fails (network, crash), the
// platform returns the purchase again from purchases() on the next launch. So the product id is pushed to save.tokens
// when granted and removed once consumed; restorePurchases() consumes ids found in save.tokens without granting again.
import type { Playgama } from 'aiwebengine/playgama';
import type { Ctx, Drop, Save } from './types';
import { grantRewards, product, type Product } from './catalog';

export interface Price { text: string; /** currency icon URL from the portal (optional) */ icon?: string }

/** max wait (ms) for portal catalog / purchases lists at startup */
const SDK_WAIT = 5000;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** local test mode: no portal payments, but running on localhost or with ?testpay=1 */
function testHost(): boolean {
  try {
    const l = (globalThis as { location?: Location }).location;
    if (!l) return false;
    return l.hostname === 'localhost' || l.hostname === '127.0.0.1' || new URLSearchParams(l.search).get('testpay') === '1';
  } catch { return false; }
}

export class Payments {
  /** purchases possible (portal payments ready, or local test mode) */
  available = false;
  /** local test mode: purchases succeed instantly (localhost / ?testpay=1 without the SDK) */
  test = false;
  private _sdk: Playgama | null = null;
  private _prices = new Map<string, Price>();
  private _busy = false;

  static async init(sdk: Playgama): Promise<Payments> {
    const p = new Payments();
    p._sdk = sdk;
    try {
      if (sdk.paymentsSupported) {
        p.available = true;
        // a slow portal must not block the boot: prices that arrive later still fill in
        const load = sdk.catalog().then((list) => {
          for (const it of list) {
            const text = it.price?.trim() || (it.priceValue > 0 ? `${it.priceValue} ${it.currency}`.trim() : '');
            if (text) p._prices.set(it.id, { text });
          }
        }).catch(() => {});
        await Promise.race([load, wait(SDK_WAIT)]);
      } else if (testHost()) {
        p.available = p.test = true;
      }
    } catch { /* catalog failed: prices stay empty, purchases still work */ }
    return p;
  }
  /** display price: the portal's price; the product's fallback price in test mode; '' if unknown (show "Buy") */
  price(productId: string): Price {
    return this._prices.get(productId) ?? { text: this.test ? product(productId)?.fallbackPrice ?? '' : '' };
  }
  /** a purchase is running (the UI may disable buy buttons) */
  get busy(): boolean { return this._busy; }
  /** purchase; on success calls grant() exactly once, then consumes consumables. true = granted.
   * `onConsumed(ok)` reports the consume result (called only for consumables on the real platform). */
  async buy(productId: string, grant: () => void, opts?: { onConsumed?(ok: boolean): void }): Promise<boolean> {
    const p = product(productId);
    if (!this.available || this._busy || !p) return false;
    this._busy = true;
    try {
      if (this.test) {
        await wait(300);
        try { grant(); } catch (e) { console.warn('grant failed', e); }
        return true;
      }
      const res = await this._sdk!.purchase(productId).catch(() => null);
      if (!res) return false;
      try { grant(); } catch (e) { console.warn('grant failed', e); }
      if (p.consumable) {
        const ok = await this.consume(productId);
        try { opts?.onConsumed?.(ok); } catch { /* caller bug must not break the purchase */ }
      }
      return true;
    } finally {
      this._busy = false;
    }
  }
  /** consume a consumable purchase by product id (true = done; always true in test mode) */
  async consume(productId: string): Promise<boolean> {
    if (this.test) return true;
    try { return !!(await this._sdk?.consume(productId)); } catch { return false; }
  }
  /** product ids of active purchases: unconsumed consumables (crash between pay and grant) and owned permanent ones (no_ads) */
  async pending(): Promise<string[]> { return (await this.activePurchases()) ?? []; }
  /** like pending(), but null when the portal did not answer in time (restore then leaves everything for the next launch) */
  async activePurchases(): Promise<string[] | null> {
    if (this.test || !this._sdk) return [];
    try { return await Promise.race([this._sdk.purchases(), wait(SDK_WAIT).then(() => null)]); } catch { return null; }
  }
}

/** grant a product's rewards to the save (+ one-time mark); returns the drops */
export function applyProduct(save: Save, p: Product): Drop[] {
  const drops = grantRewards(save, p.rewards);
  if (p.once && !save.bought.includes(p.id)) save.bought.push(p.id);
  return drops;
}
/** product can be bought now (exists, purchases available, one-time products not bought yet) */
export function canBuy(ctx: Ctx, productId: string): boolean {
  const p = product(productId);
  return !!p && ctx.pay.available && !(p.once && ctx.save.bought.includes(p.id));
}
function removeOne(list: string[], id: string) {
  const i = list.indexOf(id);
  if (i >= 0) list.splice(i, 1);
}
function sync(ctx: Ctx) {
  try { ctx.persist(); } catch (e) { console.warn(e); }
  try { ctx.refresh(); } catch (e) { console.warn(e); }
}

/** buy a product and grant its rewards (+ one-time mark, persist, refresh). Resolves the granted drops or null.
 * no_ads sets save.noAds; keys would be applied but not listed (see catalog.grantRewards). Never throws. */
export async function buyProduct(ctx: Ctx, productId: string): Promise<Drop[] | null> {
  const p = product(productId);
  if (!p || !canBuy(ctx, productId)) return null;
  let drops: Drop[] | null = null;
  try {
    const ok = await ctx.pay.buy(p.id, () => {
      drops = applyProduct(ctx.save, p);
      if (p.consumable && !ctx.pay.test) ctx.save.tokens.push(p.id); // granted, not consumed yet
      sync(ctx);
    }, {
      onConsumed: (consumed) => {
        if (!consumed) return; // stays in save.tokens: restorePurchases consumes it next launch without granting again
        removeOne(ctx.save.tokens, p.id);
        sync(ctx);
      },
    });
    return ok ? drops ?? [] : null;
  } catch (e) {
    console.warn('purchase failed', e);
    return drops;
  }
}

/** at startup: grant + consume unprocessed consumables, restore no_ads. Never throws. */
export async function restorePurchases(ctx: Ctx): Promise<void> {
  try {
    const ids = await ctx.pay.activePurchases();
    if (!ids) return;
    const s = ctx.save;
    // granted-but-unconsumed marks; marks without a pending purchase are stale (consumed, then crashed) → dropped
    const granted = [...s.tokens];
    const toConsume: string[] = [];
    let changed = granted.length > 0;
    for (const id of ids) {
      const p = product(id);
      if (!p) continue;
      if (!p.consumable) {
        // permanent (no_ads): restore idempotently on every launch / new device
        if (!s.bought.includes(p.id) || p.rewards.some((r) => r.kind === 'noAds' && !s.noAds)) { applyProduct(s, p); changed = true; }
        continue;
      }
      const i = granted.indexOf(id);
      if (i >= 0) granted.splice(i, 1); // already granted before: consume only
      else if (!(p.once && s.bought.includes(p.id))) { applyProduct(s, p); changed = true; } // paid, never granted
      toConsume.push(id);
    }
    s.tokens = [...toConsume];
    if (changed || toConsume.length) sync(ctx);
    if (!toConsume.length) return;
    for (const id of toConsume) if (await ctx.pay.consume(id)) removeOne(s.tokens, id);
    sync(ctx);
  } catch (e) {
    console.warn('restore purchases failed', e);
  }
}
