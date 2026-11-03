// Shop (owner: ui-store): tabs offers / gems (IAP) / coins (for gems + ad coins) / cases, no-ads.
import { h } from 'aiwebengine/ui';
import type { Ctx, ScreenApi, ShopTab } from './types';
import { AD_COINS_MS, AD_COINS_PER_DAY, COIN_PACKS, GEM_PRODUCTS, adCoins, product } from './catalog';
import { activeOffers, HOT_MS } from './offers';
import { buyProduct } from './payments';
import { earn, spend } from './save';
import { addCSS } from './theme';
import { sfx } from './audio';
import { adBtn, badge, btn, card, fitText, flyCurrency, hitBadge, itemArt, makeScreen, money, showRewards, tabs, timerChip, toast } from './widgets';
import { caseCards } from './casesui';
import { needGems, offerCard, offersCount, priceButton, shownRewards } from './offersui';
import { tr } from './i18n';
import { dayKey, fmtNum } from './util';

const CSS = `
.sh-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,var(--cw,250u)),1fr));gap:34u 24u;padding:26u 12u 18u}
.sh-grid.of{--cw:540u;gap:40u 30u}
.sh-p{gap:8u;padding:20u 12u 14u}
.sh-p>.art{width:120u;height:120u;filter:drop-shadow(0 0 10u var(--rc))}
.sh-p .nm{font-size:30u}
.sh-p .sub{font-size:19u}
.sh-p .foot{width:100%}.sh-p .foot>.btn{width:100%}
.sh-p.t0>.art{width:84u;height:84u;margin:18u 0}.sh-p.t1>.art{width:100u;height:100u;margin:10u 0}.sh-p.t2>.art{width:118u;height:118u;margin:1u 0}
.sh-p.t3>.art{width:132u;height:132u;margin:-6u 0}.sh-p.t4>.art{width:146u;height:146u;margin:-13u 0}
.sh-bon{padding:2u 10u 5u;font-size:19u;font-weight:700;color:#173400;background:#8ae26c;text-shadow:none;white-space:nowrap;
box-shadow:0 0 0 3u var(--ol),inset 0 -4u 0 rgba(0,0,0,.2),inset 0 3u 0 rgba(255,255,255,.4)}
.sh-grid.gm{--cw:200u;gap:34u 20u}
.sh-old{font-size:19u;color:#c6d4ea}
.sh-old>s{text-decoration-color:#ff4b4b;text-decoration-thickness:3u}
.sh-na,.sh-ad{grid-column:1/-1;display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:12u 22u;padding:18u 22u;text-align:left}
.sh-na>.art,.sh-ad>.art{width:104u;height:104u}
.sh-na .col,.sh-ad .col{gap:6u;min-width:0}
.sh-na>.foot,.sh-ad>.foot{grid-column:1/-1;flex-direction:column;align-items:stretch;margin:0;padding:0}
.sh-na>.foot>.btn,.sh-ad>.foot>.btn{width:100%}
@media (min-aspect-ratio:5/4){.sh-na,.sh-ad{grid-template-columns:auto minmax(0,1fr) minmax(0,330u)}.sh-na>.foot,.sh-ad>.foot{grid-column:auto}}
.sh-empty{display:flex;flex-direction:column;align-items:center;gap:16u;padding:40u 10u;text-align:center}
.sh-note{margin:0 auto;padding:0 12u 8u;max-width:900u;text-align:center;font-size:20u;color:#a9bdd6}
`;

const TABS: ShopTab[] = ['offers', 'gems', 'coins', 'cases'];

/** show(tab) opens a tab: 'offers' | 'gems' | 'coins' | 'cases' */
export function createShop(ctx: Ctx): ScreenApi & { tab(): ShopTab } {
  addCSS('shop', CSS);
  const p = makeScreen(ctx, tr({ ru: 'Магазин', en: 'Shop' }), { wide: true });
  const cases = caseCards(ctx);
  let cur: ShopTab = 'offers';

  const after = () => { ctx.persist(); ctx.refresh(); render(); };

  // ---- offers
  const offersTab = (): HTMLElement[] => {
    const list = activeOffers(ctx.save, ctx.now());
    if (!list.length) {
      const next = (Math.floor(ctx.now() / HOT_MS) + 1) * HOT_MS;
      return [h('div', { class: 'sh-empty' }, h('div', { class: 't-l b' }, tr({ ru: 'Новые предложения скоро!', en: 'New offers are coming soon!' })), timerChip(ctx, next, render))];
    }
    return [h('div', { class: 'sh-grid of' }, ...list.map((o) => offerCard(ctx, o, render)))];
  };

  // ---- gems (IAP)
  const buy = async (id: string, b: HTMLElement) => {
    b.classList.add('busy');
    const drops = await buyProduct(ctx, id);
    b.classList.remove('busy');
    if (!drops) return;
    sfx('buy');
    render();
    await showRewards(ctx, shownRewards(product(id)?.rewards ?? [], drops));
    ctx.refresh();
  };
  const gemsTab = (): HTMLElement[] => {
    const cards = GEM_PRODUCTS.map((id, i) => {
      const pr = product(id)!;
      const n = pr.rewards[0]?.kind === 'gems' ? pr.rewards[0].n : 0;
      const b: HTMLButtonElement = priceButton(ctx, id, () => void buy(id, b));
      const c = card({
        rarity: i >= 4 ? 'legendary' : i >= 2 ? 'epic' : 'gems', art: itemArt('gems', undefined, 0), cls: `sh-p t${i}`,
        badge: pr.badge ? (i >= 4 ? badge(tr(pr.badge), 'hit', true) : hitBadge(true)) : undefined,
        foot: b,
      });
      c.insertBefore(h('div', { class: 'nm' }, money('gems', n, 34)), c.querySelector(':scope>.foot'));
      if (pr.bonus) c.insertBefore(h('span', { class: 'sh-bon' }, tr({ ru: `+${pr.bonus}% бонус`, en: `+${pr.bonus}% bonus` })), c.querySelector(':scope>.foot'));
      return c;
    });
    const out: HTMLElement[] = [h('div', { class: 'sh-grid gm' }, ...cards, noAdsCard())];
    if (!ctx.pay.available) out.push(h('p', { class: 'sh-note' }, tr({ ru: 'Покупки недоступны на этой площадке.', en: 'Purchases are not available on this platform.' })));
    return out;
  };
  const noAdsCard = (): HTMLElement | null => {
    const s = ctx.save;
    if (s.noAds || s.bought.includes('no_ads')) return null;
    const b: HTMLButtonElement = priceButton(ctx, 'no_ads', () => void buy('no_ads', b), 'gold');
    const c = card({ rarity: 'rare', art: itemArt('noAds', undefined, 0), cls: 'sh-na', foot: b });
    c.insertBefore(h('div', { class: 'col' },
      h('div', { class: 'nm', style: 'text-align:left;font-size:calc(var(--u)*30px)' }, tr({ ru: 'Отключить рекламу', en: 'Remove ads' })),
      h('div', { class: 'sub' }, tr({ ru: 'Навсегда убирает рекламу между заездами. Награды за видео остаются по желанию.', en: 'Removes the ads between races forever. Optional reward videos stay available.' }))),
    c.querySelector(':scope>.foot'));
    return c;
  };

  // ---- coins
  const adState = () => {
    const s = ctx.save, now = ctx.now(), today = dayKey(now);
    const n = s.adCoins.day === today ? s.adCoins.n : 0;
    return { n, left: Math.max(0, AD_COINS_PER_DAY - n), wait: s.adCoins.next > now ? s.adCoins.next : 0, today };
  };
  const adCoinsCard = (): HTMLElement | null => {
    if (!ctx.sdk.rewardedSupported) return null;
    const s = ctx.save, st = adState(), amount = adCoins(s.level);
    let foot: HTMLElement;
    if (st.left <= 0) {
      const d = new Date(ctx.now());
      foot = h('div', { class: 'col center' }, h('div', { class: 'b c-dim' }, tr({ ru: 'На сегодня всё!', en: "That's all for today!" })),
        timerChip(ctx, new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime(), render));
    } else if (st.wait) {
      foot = h('div', { class: 'col center' }, h('div', { class: 'sub' }, tr({ ru: 'Следующее видео через:', en: 'Next video in:' })), timerChip(ctx, st.wait, render));
    } else {
      const b: HTMLButtonElement = adBtn(tr({ ru: `+${fmtNum(amount)} монет`, en: `+${fmtNum(amount)} coins` }), async () => {
        const st2 = adState();
        if (st2.left <= 0 || st2.wait) return;
        b.classList.add('busy');
        let ok = false;
        try { ok = await ctx.sdk.showRewarded('free_coins'); } catch { ok = false; }
        b.classList.remove('busy');
        if (!ok) { toast(ctx, tr({ ru: 'Награда не получена: видео не досмотрено или недоступно', en: 'No reward: the video was skipped or is unavailable' }), 'bad'); return; }
        s.adCoins = { day: st2.today, n: st2.n + 1, next: ctx.now() + AD_COINS_MS };
        earn(s, 'coins', amount);
        ctx.persist();
        void flyCurrency(ctx, 'coins', b);
        ctx.refresh();
        render();
      }, 'big');
      foot = b;
    }
    const c = card({ rarity: 'coins', art: itemArt('coins', undefined, 0), cls: 'sh-ad', badge: st.left > 0 && !st.wait ? badge(tr({ ru: 'Бесплатно', en: 'Free' }), 'new') : undefined });
    c.append(h('div', { class: 'col' },
      h('div', { class: 'nm', style: 'text-align:left;font-size:calc(var(--u)*30px)' }, tr({ ru: 'Монеты за рекламу', en: 'Coins for an ad' })),
      h('div', { class: 'sub' }, tr({ ru: `Посмотри короткое видео и получи монеты. Осталось сегодня: ${st.left} из ${AD_COINS_PER_DAY}`, en: `Watch a short video to get coins. Left today: ${st.left} of ${AD_COINS_PER_DAY}` }))),
    h('div', { class: 'foot' }, foot));
    return c;
  };
  const coinsTab = (): HTMLElement[] => {
    const base = COIN_PACKS[0].coins / COIN_PACKS[0].gems; // coins per gem of the smallest pack → bonus % of the bigger ones
    const cards = COIN_PACKS.map((pk, i) => {
      const bonus = Math.round((pk.coins / pk.gems / base - 1) * 100);
      const b = btn(money('gems', pk.gems), () => {
        if (!spend(ctx.save, 'gems', pk.gems)) { needGems(ctx); return; }
        earn(ctx.save, 'coins', pk.coins);
        sfx('buy');
        after();
        void showRewards(ctx, [{ kind: 'coins', n: pk.coins }]).then(() => ctx.refresh());
      }, 'blue');
      const c = card({ rarity: i >= 2 ? 'legendary' : 'coins', art: itemArt('coins', undefined, 0), cls: `sh-p t${i + 1}`, foot: b, badge: i === 1 ? hitBadge(true) : undefined });
      c.insertBefore(h('div', { class: 'nm' }, money('coins', pk.coins, 32)), c.querySelector(':scope>.foot'));
      if (bonus > 0) c.insertBefore(h('span', { class: 'sh-bon' }, tr({ ru: `+${bonus}% бонус`, en: `+${bonus}% bonus` })), c.querySelector(':scope>.foot'));
      return c;
    });
    return [h('div', { class: 'sh-grid gm' }, adCoinsCard(), ...cards)];
  };

  const casesTab = (): HTMLElement[] => { cases.render(); return [cases.el]; };

  const pages: Record<ShopTab, () => (HTMLElement | null)[]> = { offers: offersTab, gems: gemsTab, coins: coinsTab, cases: casesTab };
  const render = () => {
    const top = p.body.scrollTop;
    p.body.replaceChildren(...pages[cur]().filter((e): e is HTMLElement => !!e));
    p.body.scrollTop = top;
    t.setDot('offers', offersCount(ctx));
    const s = ctx.save;
    t.setDot('cases', s.keys.snow + s.keys.ice + s.keys.santa > 0 || (ctx.sdk.rewardedSupported && s.freeCase <= ctx.now()));
    const st = adState();
    t.setDot('coins', ctx.sdk.rewardedSupported && st.left > 0 && !st.wait);
  };

  const t = tabs<ShopTab>([
    { id: 'offers', label: tr({ ru: 'Предложения', en: 'Offers' }), icon: 'star' },
    { id: 'gems', label: tr({ ru: 'Кристаллы', en: 'Gems' }), icon: 'gem' },
    { id: 'coins', label: tr({ ru: 'Монеты', en: 'Coins' }), icon: 'coin' },
    { id: 'cases', label: tr({ ru: 'Подарки', en: 'Gifts' }), icon: 'gift' },
  ], (id) => { cur = id; p.body.scrollTop = 0; render(); });
  p.head.append(t.el);
  fitText(p.title, 2);

  return {
    show(arg) {
      const tab = (TABS as string[]).includes(arg ?? '') ? (arg as ShopTab) : !activeOffers(ctx.save, ctx.now()).length ? 'gems' : 'offers';
      t.select(tab);
      p.show();
    },
    hide() { p.hide(); },
    get visible() { return p.visible; },
    refresh() { if (p.visible) render(); },
    tab: () => cur,
  };
}
