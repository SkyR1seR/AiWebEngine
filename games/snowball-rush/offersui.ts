// Offer popups & banners (owner: ui-store). Also the shared store pieces used by shop.ts: offer cards, reward chips,
// IAP price buttons and the "buy → rewards popup → refresh" flows.
//
// Honest but attractive: every offer shows its exact contents, a live timer, the discount ribbon and the struck-through
// old price (IAP: the real portal price scaled by the discount; gem offers: offer.oldGems).
import { h } from 'aiwebengine/ui';
import type { Ctx, Drop, Reward } from './types';
import { activeOffers, buyGemOffer, markBought, offerById, type Offer } from './offers';
import { buyProduct } from './payments';
import { itemDef } from './catalog';
import { isUnlocked } from './unlocks';
import { addCSS } from './theme';
import { badge, btn, card, fitText, hitBadge, itemArt, modal, money, rewardLabel, showRewards, timerChip, toast, type Child } from './widgets';
import { tr } from './i18n';
import { fmtNum } from './util';

const CSS = `
.of-rib{position:absolute;z-index:6;left:-26u;top:-22u;padding:6u 22u 10u;font-size:44u;font-weight:700;line-height:1;color:#fff;background:#e8322b;rotate:-10deg;
text-shadow:var(--tol2);box-shadow:0 0 0 4u var(--ol),inset 0 -6u 0 rgba(0,0,0,.25),inset 0 4u 0 rgba(255,255,255,.35),0 10u 0 rgba(0,0,0,.35);animation:ofr 1.2s ease-in-out infinite;pointer-events:none}
.of-rib.s{font-size:28u;padding:4u 14u 7u;left:-16u;top:-16u}
@keyframes ofr{0%,100%{scale:1}50%{scale:1.08}}
.of-hero{position:relative;isolation:isolate;display:flex;align-items:center;justify-content:center;flex:none;width:250u;height:250u}
.of-hero>.art{width:86%;height:86%;filter:drop-shadow(0 0 14u var(--rc)) drop-shadow(0 8u 0 rgba(0,0,0,.35));animation:offl 2.4s ease-in-out infinite}
.of-hero::before{content:'';position:absolute;z-index:-1;inset:8%;border-radius:50%;background:radial-gradient(closest-side,var(--rc),transparent);opacity:.55}
.of-hero>.rays{top:50%;width:130%}
@keyframes offl{0%,100%{translate:0 0}50%{translate:0 -8u}}
.of-list{display:flex;flex-wrap:wrap;justify-content:center;gap:12u}
.of-it{--rc:#5aa9ff;display:flex;align-items:center;gap:8u;min-width:0;max-width:100%;padding:6u 14u 6u 6u;font-weight:700;font-size:24u;background:rgba(7,15,34,.8);
box-shadow:inset 0 0 0 3u var(--rc),0 0 0 3u var(--ol)}
.of-it>.art{width:56u;height:56u}
.of-it>.lbl{min-width:0;overflow-wrap:break-word;text-align:left}
.of-old{position:relative;font-size:26u;color:#d5e0f2;font-weight:700;white-space:nowrap}
.of-old::after{content:'';position:absolute;left:-4u;right:-4u;top:calc(50% - 3u);height:3u;background:#ff4b4b;rotate:-7deg;opacity:.9}
.of-buy{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:10u 22u}
.of-buy>.btn{min-width:min(100%,280u)}
.of-buy>.of-old{font-size:32u}
.btn .of-pi{width:1.2em;height:1.2em;object-fit:contain}
.of-pop .mbody{gap:14u}
.of-pop>.badge.r{top:-30u;right:58u;font-size:24u}
.of-main{display:flex;flex-direction:column;align-items:center;gap:14u;width:100%}
.of-info{display:flex;flex-direction:column;align-items:center;gap:14u;min-width:0}
.of-desc{max-width:620u;font-size:26u}
@media (min-aspect-ratio:4/5){.of-main{flex-direction:row;justify-content:center;gap:26u;text-align:left}.of-info{align-items:flex-start;flex:1 1 auto;max-width:620u}
.of-info .of-list{justify-content:flex-start}.of-hero{width:270u;height:270u}}
@media (min-aspect-ratio:4/5) and (max-height:520px){.of-hero{width:210u;height:210u}}
/* shop offer card: art left, info right */
.of-card{flex-direction:row;align-items:center;gap:8u 14u;padding:24u 16u 18u 8u}
.of-card>.of-hero{width:200u;height:200u}
.of-ci{display:flex;flex-direction:column;align-items:flex-start;gap:10u;flex:1 1 0;min-width:0;text-align:left}
.of-ci>.nm{font-size:32u;text-align:left}
.of-ci .of-list{justify-content:flex-start;gap:8u}
.of-ci .of-it{font-size:20u;padding:3u 10u 3u 3u}.of-ci .of-it>.art{width:42u;height:42u}
.of-card .foot{justify-content:flex-start;align-items:center;gap:10u 16u;margin-top:4u;padding-top:0}
.of-card .foot>.btn{min-width:150u}
/* menu banner */
.ofb{cursor:pointer}
.ofb::after{content:'';position:absolute;z-index:3;inset:0;pointer-events:none;background:linear-gradient(100deg,transparent 42%,rgba(255,255,255,.26) 50%,transparent 58%) no-repeat;
background-size:300% 100%;animation:ofsh 3.2s ease-in-out infinite}
@keyframes ofsh{0%,50%{background-position:100% 0}100%{background-position:0 0}}
.ofb>.art{filter:drop-shadow(0 0 8u var(--rc))}
.ofb .nm{font-size:23u}
.ofb .ofb-p{font-size:20u;color:#ffe9a0}
`;

const css = () => addCSS('offersui', CSS);
const DISC = (pct: number) => `−${Math.round(pct)}%`;

// ---------------------------------------------------------------- shared pieces (also used by shop.ts)

/**
 * Scale the number inside a localized price text: scalePrice('$1.99', 10) → '$19.90', scalePrice('99 ₽', 10) → '990 ₽'.
 * Keeps the currency text and the decimal separator; '' when no number is found.
 */
export function scalePrice(text: string, k: number): string {
  const m = /\d(?:[\d\s  .,']*\d)?/.exec(text);
  if (!m || !(k > 0)) return '';
  const raw = m[0];
  const dm = /[.,](\d{1,2})$/.exec(raw); // decimal part = 1–2 digits after the LAST separator ("1,999" is a thousand)
  const frac = dm ? dm[1] : '';
  const int = (dm ? raw.slice(0, -frac.length - 1) : raw).replace(/\D/g, '');
  const v = Number(int + (frac ? '.' + frac : ''));
  if (!Number.isFinite(v) || v <= 0) return '';
  const out = frac ? (v * k).toFixed(frac.length).replace('.', raw[raw.length - frac.length - 1]) : String(Math.round(v * k));
  return text.slice(0, m.index) + out + text.slice(m.index + raw.length);
}

/** rarity / currency frame color of a reward */
function rewardRarity(r: Reward | Drop): string {
  if (r.kind === 'skin' || r.kind === 'ball') return itemDef(r.kind, r.id).rarity;
  if (r.kind === 'coins' || r.kind === 'gems') return r.kind;
  return 'rare';
}
/** one chip per reward: [art] label (currencies get their icon instead of a big art) */
export function rewardChips(rewards: readonly Reward[]): HTMLElement {
  css();
  return h('div', { class: 'of-list' }, ...rewards.map((r) => {
    const el = h('div', { class: `of-it r-${rewardRarity(r)}` });
    el.append(itemArt(r.kind === 'key' ? 'key' : r.kind, 'id' in r ? r.id : undefined, 0), h('span', { class: 'lbl' }, rewardLabel(r)));
    return el;
  }));
}

/** what to show in the rewards popup: granted drops + keys / no-ads (grantRewards applies those but does not list them) */
export function shownRewards(rewards: readonly Reward[], drops: readonly Drop[]): (Drop | Reward)[] {
  return [...drops, ...rewards.filter((r) => r.kind === 'key' || r.kind === 'noAds')];
}

/** big art of an offer's hero item with a glow and rays (rarity color) */
export function offerHero(o: Offer, rays = true): HTMLElement {
  css();
  const k = o.hero.kind;
  const rar = k === 'skin' || k === 'ball' ? itemDef(k, o.hero.id ?? '').rarity : k === 'coins' || k === 'gems' ? k : 'legendary';
  const el = h('div', { class: `of-hero r-${rar}` }, itemArt(k, o.hero.id, 0));
  if (rays) el.prepend(h('div', { class: 'rays' }));
  return el;
}

/** "−90%" ribbon (small = card version) */
export function discountRibbon(pct: number, small = false): HTMLElement {
  css();
  return h('div', { class: `of-rib${small ? ' s' : ''}` }, DISC(pct));
}

/**
 * IAP buy button with the portal price (+ the portal currency icon when given). Disabled «Недоступно» when payments are
 * unavailable on this platform; «Купить» when the price is unknown yet. onBuy runs on click.
 */
export function priceButton(ctx: Ctx, productId: string, onBuy: () => void, cls = 'green'): HTMLButtonElement {
  css();
  if (!ctx.pay.available) {
    const b = btn(tr({ ru: 'Недоступно', en: 'Unavailable' }), () => {}, cls);
    b.disabled = true;
    return b;
  }
  const p = ctx.pay.price(productId);
  const content: Child[] = [];
  if (p.icon) content.push(h('img', { class: 'of-pi', src: p.icon, alt: '', draggable: 'false' }));
  content.push(p.text || tr({ ru: 'Купить', en: 'Buy' }));
  return btn(content, onBuy, cls);
}

/** struck-through old price element ('' text → null) */
export function oldPrice(content: Child): HTMLElement | null {
  if (content === '' || content == null || content === false) return null;
  return h('span', { class: 'of-old' }, typeof content === 'object' ? content : String(content));
}

/** old price of an offer: gem offers → oldGems, IAP → the portal price × 1 / (1 − discount) */
function offerOldPrice(ctx: Ctx, o: Offer): HTMLElement | null {
  if (o.gems != null) return o.oldGems ? oldPrice(money('gems', o.oldGems)) : null;
  if (!o.productId || !ctx.pay.available || o.discount <= 0 || o.discount >= 100) return null;
  return oldPrice(scalePrice(ctx.pay.price(o.productId).text, 100 / (100 - o.discount)));
}

/** "not enough gems" toast; opens the gems tab when the shop is open */
export function needGems(ctx: Ctx): void {
  toast(ctx, tr({ ru: 'Не хватает кристаллов', en: 'Not enough gems' }), 'bad');
  if (isUnlocked(ctx.save, 'shop')) ctx.nav.shop('gems');
}

/** buy an offer (IAP or gems): grant, mark bought, persist, rewards popup, refresh. true if bought */
export async function buyOffer(ctx: Ctx, o: Offer, b?: HTMLElement): Promise<boolean> {
  let drops: Drop[] | null;
  if (o.productId) {
    b?.classList.add('busy');
    drops = await buyProduct(ctx, o.productId);
    b?.classList.remove('busy');
    if (!drops) return false;
    markBought(ctx.save, o);
  } else {
    if (o.gems == null) return false;
    if (ctx.save.gems < o.gems) { needGems(ctx); return false; }
    drops = buyGemOffer(ctx.save, o);
    if (!drops) return false;
  }
  ctx.persist();
  ctx.refresh();
  await showRewards(ctx, shownRewards(o.rewards, drops));
  ctx.refresh();
  return true;
}

/** buy button of an offer: real price (IAP) or gems */
function offerBuyButton(ctx: Ctx, o: Offer, onDone: () => void, big: boolean): HTMLButtonElement {
  const cls = big ? 'green big' : 'green';
  const go = () => { void buyOffer(ctx, o, b).then((ok) => { if (ok) onDone(); }); };
  const b: HTMLButtonElement = o.productId ? priceButton(ctx, o.productId, go, cls) : btn(money('gems', o.gems ?? 0), go, big ? 'blue big' : 'blue');
  return b;
}

/** extra corner badge per offer kind */
function kindBadge(o: Offer): HTMLElement | undefined {
  if (o.kind === 'starter') return hitBadge(true);
  if (o.kind === 'newyear') return badge(tr({ ru: 'Выгодно', en: 'Best value' }), 'hit', true);
  return undefined;
}

/** frame rarity of an offer card */
const offerRarity = (o: Offer) => (o.kind === 'hot' || o.kind === 'comeback' ? 'epic' : 'legendary');

/** big offer card for the shop's offers tab: art on the left, contents + timer + price on the right (art click opens
 * the popup; onDone after a purchase or when the timer ends) */
export function offerCard(ctx: Ctx, o: Offer, onDone: () => void): HTMLElement {
  css();
  const hero = offerHero(o);
  hero.classList.add('ia');
  hero.addEventListener('click', () => showOffer(ctx, o.id));
  const nm = h('div', { class: 'nm' }, tr(o.title));
  const c = card({ rarity: offerRarity(o), badge: kindBadge(o), cls: 'of-card' });
  c.prepend(discountRibbon(o.discount, true));
  c.append(hero, h('div', { class: 'of-ci' }, nm, timerChip(ctx, o.endsAt, onDone), rewardChips(o.rewards),
    h('div', { class: 'foot' }, offerOldPrice(ctx, o), offerBuyButton(ctx, o, onDone, false))));
  fitText(nm, 2, 0.6);
  return c;
}

// ---------------------------------------------------------------- popup & banner

/** big popup for an offer id (from offers.activeOffers); no-op if it is gone */
export function showOffer(ctx: Ctx, id: string): void {
  css();
  const o = offerById(ctx.save, ctx.now(), id);
  if (!o) { toast(ctx, tr({ ru: 'Это предложение уже закончилось', en: 'This offer has ended' })); return; }
  const info = h('div', { class: 'of-info' },
    h('p', { class: 'txt of-desc' }, tr(o.desc)),
    h('div', { class: 'row wrap', style: 'justify-content:inherit' }, h('span', { class: 'b c-gold' }, tr({ ru: 'Осталось:', en: 'Time left:' })), timerChip(ctx, o.endsAt, () => m.close())),
    rewardChips(o.rewards));
  const m = modal(ctx, [h('div', { class: 'of-main' }, offerHero(o), info)], {
    title: tr(o.title), cls: 'gold wide of-pop',
    foot: [h('div', { class: 'of-buy' }, offerOldPrice(ctx, o), offerBuyButton(ctx, o, () => m.close(), true))],
  });
  m.el.append(discountRibbon(o.discount));
  const kb = kindBadge(o);
  if (kb) m.el.append(kb);
}

/** compact banner (art, discount badge, timer) that opens showOffer on click — used by the menu */
export function offerBanner(ctx: Ctx, offer: Offer): HTMLElement {
  css();
  const price = offer.gems != null ? money('gems', offer.gems) : ctx.pay.available ? ctx.pay.price(offer.productId ?? '').text : '';
  const nm = h('div', { class: 'nm' }, tr(offer.title));
  const c = card({
    rarity: offerRarity(offer), badge: badge(DISC(offer.discount), 'sale', true), art: itemArt(offer.hero.kind, offer.hero.id, 0),
    onClick: () => showOffer(ctx, offer.id), cls: 'mn-ofb ofb',
  });
  c.append(h('div', { class: 'col' }, nm, timerChip(ctx, offer.endsAt), price ? h('div', { class: 'ofb-p b' }, price) : null));
  fitText(nm, 2, 0.6);
  return c;
}

/** active offers count (shop tab dot) */
export function offersCount(ctx: Ctx): number { return activeOffers(ctx.save, ctx.now()).length; }

/** "+1 234" text (shared by shop cards) */
export const plusNum = (n: number) => `+${fmtNum(n)}`;
