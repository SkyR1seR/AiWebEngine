// Wardrobe (owner: ui-store): character skins & ball skins, rarity frames, buy / equip / try for an ad / "from cases".
//
// Layout: a preview pane (big art of the selected item, where it comes from, main action + "try for an ad") and a grid of
// item cards with a compact action each. Selecting a card also previews it on the 3D lobby hero:
//   window event 'snowball:preview', detail { skin: string; ball: string } — the selected skin/ball (the equipped ones when
//   the wardrobe closes). The lobby (integrator) listens: addEventListener('snowball:preview', (e) => lobby.setLook(...)).
import { h } from 'aiwebengine/ui';
import type { Ctx, ScreenApi } from './types';
import { CASES, buyItem, casePool, itemDef, itemsOf, ownsItem, type ItemDef } from './catalog';
import { activeOffers, type Offer } from './offers';
import { claimSkinGift, isUnlocked } from './unlocks';
import { addCSS } from './theme';
import { sfx } from './audio';
import {
  btn, confirmBox, fitText, icon, itemArt, itemCard, makeScreen, money, rarityBadge, rewardedBtn, saleBadge, showRewards, tabs, toast, type Child,
} from './widgets';
import { showOffer } from './offersui';
import { tr } from './i18n';
import { fmtNum } from './util';

type Kind = 'skin' | 'ball';
type Tab = 'skins' | 'balls';

/** detail of the 'snowball:preview' window event */
export interface PreviewDetail { skin: string; ball: string }
export const PREVIEW_EVENT = 'snowball:preview';

const CSS = `
.wd-body{display:flex;gap:20u;overflow:hidden!important;padding:8u 12u 14u}
.wd-pv{position:relative;flex:none;width:330u;display:flex;flex-direction:column;align-items:center;gap:10u;padding:14u 14u 16u;min-height:0;
background:rgba(0,0,0,.28);box-shadow:inset 0 0 0 3u rgba(0,0,0,.35),inset 0 6u 0 rgba(0,0,0,.18)}
.wd-stage{position:relative;isolation:isolate;flex:1 1 auto;width:100%;min-height:150u;display:flex;align-items:flex-end;justify-content:center}
.wd-stage::before{content:'';position:absolute;z-index:-1;left:12%;right:12%;bottom:0;height:34u;border-radius:50%;background:radial-gradient(closest-side,rgba(255,255,255,.5),transparent)}
.wd-stage::after{content:'';position:absolute;z-index:-2;inset:6% 4% 0;border-radius:50%;background:radial-gradient(closest-side,var(--rc),transparent);opacity:.45}
.wd-stage>.art{width:100%;height:100%;max-height:330u;animation:wdin .3s ease-out}
.wd-stage>.art-ball>img{width:auto;height:72%;max-width:80%}
@keyframes wdin{from{opacity:0;transform:translateY(12u) scale(.94)}}
.wd-info{display:flex;flex-direction:column;align-items:center;gap:8u;width:100%;min-width:0;text-align:center}
.wd-nm{font-size:32u;font-weight:700;line-height:1.05;text-shadow:var(--tol2);max-width:100%;overflow-wrap:break-word}
.wd-src{font-size:20u;color:#c6d4ea;max-width:100%}
.wd-act{display:flex;flex-direction:column;align-items:stretch;gap:12u;width:100%}
.wd-act>.btn{width:100%}
.wd-on{color:#7ee26a;font-weight:700;font-size:26u;padding:10u}
.wd-list{flex:1 1 0;min-width:0;min-height:0;overflow-x:hidden;overflow-y:auto}
.wd-list>.grid{--cw:168u;padding:16u 10u 16u}
.wd-list .card{gap:4u;padding:12u 8u 10u}
.wd-list .card.pick{outline:5u solid #ffe14d;outline-offset:4u}
.wd-list .card .foot>.btn{min-width:0}
.wd-list .card .btn.no .money{color:#ff8f80}
.wd-tag{font-size:18u;color:#c6d4ea}
.wd-ok{font-size:20u;font-weight:700;color:#7ee26a}
.wd-trial{font-size:19u;color:#e3c7ff}
@media (max-aspect-ratio:4/5){
.wd-body{flex-direction:column;gap:16u}
.wd-pv{width:auto;flex-direction:row;height:330u;gap:14u;padding:12u}
.wd-stage{flex:0 0 40%;height:100%}
.wd-info{flex:1 1 0;justify-content:center}
}
@media (min-aspect-ratio:4/5) and (max-height:560px){.wd-pv{width:300u}.wd-nm{font-size:28u}}
`;

/** offer currently selling this item (hot deal / packs) */
function offerFor(ctx: Ctx, kind: Kind, id: string): Offer | undefined {
  return activeOffers(ctx.save, ctx.now()).find((o) => o.rewards.some((r) => r.kind === kind && r.id === id));
}
/** cases that can drop this item */
function casesWith(kind: Kind, d: ItemDef): string[] {
  return CASES.filter((c) => casePool(c.id, d.rarity).some((x) => x.kind === kind && x.def.id === d.id)).map((c) => tr(c.name));
}

export function createWardrobe(ctx: Ctx): ScreenApi & { tab(): Tab } {
  addCSS('wardrobe', CSS);
  const p = makeScreen(ctx, tr({ ru: 'Гардероб', en: 'Wardrobe' }), { wide: true });
  const sel: Record<Kind, string> = { skin: ctx.save.skin, ball: ctx.save.ball };
  let kind: Kind = 'skin';
  const pv = h('div', { class: 'wd-pv' });
  const grid = h('div', { class: 'grid' });
  const list = h('div', { class: 'wd-list scroll' }, grid);
  p.body.classList.add('wd-body');
  p.body.append(pv, list);

  const preview = (skin: string, ball: string) => {
    try { window.dispatchEvent(new CustomEvent<PreviewDetail>(PREVIEW_EVENT, { detail: { skin, ball } })); } catch { /* no window (tests) */ }
  };
  const equipped = (k: Kind) => (k === 'skin' ? ctx.save.skin : ctx.save.ball);

  const equip = (k: Kind, id: string) => {
    if (!ownsItem(ctx.save, k, id)) return;
    if (k === 'skin') ctx.save.skin = id; else ctx.save.ball = id;
    ctx.persist();
    ctx.refresh();
    render();
  };

  const buy = async (k: Kind, id: string) => {
    const s = ctx.save, d = itemDef(k, id);
    if (!d.price || ownsItem(s, k, id)) return;
    const { cur, n } = d.price;
    if (s[cur] < n) {
      toast(ctx, cur === 'gems' ? tr({ ru: 'Не хватает кристаллов', en: 'Not enough gems' }) : tr({ ru: 'Не хватает монет', en: 'Not enough coins' }), 'bad');
      if (isUnlocked(s, 'shop')) ctx.nav.shop(cur === 'gems' ? 'gems' : 'coins');
      return;
    }
    if (cur === 'gems') {
      const name = tr(d.name), num = fmtNum(n);
      const ok = await confirmBox(ctx, tr({ ru: `Купить «${name}» за ${num} кристаллов?`, en: `Buy "${name}" for ${num} gems?` }), tr({ ru: 'Купить', en: 'Buy' }));
      if (!ok) return;
    }
    if (!buyItem(s, k, id)) return; // buyItem also equips
    if (s.trial && s.trial[k] === id) { delete s.trial[k]; if (!s.trial.skin && !s.trial.ball) s.trial = null; }
    sfx('buy');
    ctx.persist();
    ctx.refresh();
    render();
    await showRewards(ctx, [{ kind: k, id, rarity: d.rarity, dup: false, comp: 0 }], tr({ ru: 'Новинка в гардеробе!', en: 'New in your wardrobe!' }));
  };

  const priceBtn = (k: Kind, d: ItemDef, cls: string) => {
    const pr = d.price!;
    const afford = ctx.save[pr.cur] >= pr.n;
    return btn(money(pr.cur, pr.n), () => void buy(k, d.id), `${cls} ${afford ? (pr.cur === 'gems' ? 'blue' : 'gold') : 'no'}`);
  };

  /** the compact action on a card */
  const cardFoot = (k: Kind, d: ItemDef, off: Offer | undefined): Child => {
    const s = ctx.save;
    if (ownsItem(s, k, d.id)) {
      return equipped(k) === d.id ? h('span', { class: 'wd-ok' }, tr({ ru: 'Надето ✔', en: 'Equipped ✔' }))
        : btn(tr({ ru: 'Надеть', en: 'Equip' }), () => equip(k, d.id), 'small blue');
    }
    if (d.price) return priceBtn(k, d, 'small');
    if (off) return btn(tr({ ru: 'В наборе', en: 'In a pack' }), () => showOffer(ctx, off.id), 'small gold');
    if (d.src === 'case' || (d.src !== 'offer' && casesWith(k, d).length)) {
      return isUnlocked(s, 'cases') ? btn([icon('gift'), tr({ ru: 'Из подарков', en: 'From gifts' })], () => ctx.nav.cases(), 'small red')
        : h('span', { class: 'wd-tag' }, tr({ ru: 'Из подарков', en: 'From gifts' }));
    }
    return h('span', { class: 'wd-tag' }, tr({ ru: 'В наборе', en: 'In a pack' }));
  };

  /** the preview pane: big art, name, rarity, where it comes from, actions */
  const renderPreview = () => {
    const s = ctx.save, k = kind, id = sel[k], d = itemDef(k, id), off = offerFor(ctx, k, id);
    const owned = ownsItem(s, k, id);
    const stage = h('div', { class: `wd-stage r-${d.rarity}` }, itemArt(k, id, 0));
    const nm = h('div', { class: 'wd-nm' }, tr(d.name));
    let src = '';
    if (owned) src = equipped(k) === id ? tr({ ru: 'Сейчас надето', en: 'Equipped now' }) : tr({ ru: 'Есть в твоей коллекции', en: 'In your collection' });
    else if (d.price) src = d.price.cur === 'coins' ? tr({ ru: 'Можно купить за монеты', en: 'Buy it with coins' }) : tr({ ru: 'Можно купить за кристаллы', en: 'Buy it with gems' });
    else if (d.src === 'offer') src = tr({ ru: 'Только в особых наборах', en: 'Only in special packs' });
    else { const names = casesWith(k, d).join(', '); if (names) src = tr({ ru: `Выпадает из: ${names}`, en: `Drops from: ${names}` }); }
    const act: HTMLElement[] = [];
    if (owned) {
      if (equipped(k) === id) act.push(h('div', { class: 'wd-on' }, tr({ ru: 'Надето ✔', en: 'Equipped ✔' })));
      else act.push(btn(tr({ ru: 'Надеть', en: 'Equip' }), () => equip(k, id), 'blue'));
    } else {
      if (d.price) act.push(priceBtn(k, d, ''));
      if (off) act.push(btn([icon('star'), tr({ ru: 'Смотреть набор', en: 'View the pack' })], () => showOffer(ctx, off.id), 'gold'));
      else if (!d.price && d.src !== 'offer' && isUnlocked(s, 'cases') && casesWith(k, d).length) act.push(btn([icon('gift'), tr({ ru: 'К подаркам', en: 'Go to gifts' })], () => ctx.nav.cases(), 'red'));
      if (s.trial?.[k] === id) act.push(h('div', { class: 'wd-trial b' }, tr({ ru: 'Примеришь в следующем заезде!', en: "You'll try it in the next race!" })));
      else {
        act.push(rewardedBtn(ctx, tr({ ru: 'Примерить за рекламу', en: 'Try it for an ad' }), 'try_skin', () => {
          ctx.save.trial = { ...(ctx.save.trial ?? {}), [k]: id };
          ctx.persist();
          ctx.refresh();
          toast(ctx, tr({ ru: 'Отлично! В следующем заезде ты будешь в обновке.', en: "Great! You'll wear it in the next race." }), 'good');
          render();
        }));
      }
    }
    const info = h('div', { class: 'wd-info' }, nm, rarityBadge(d.rarity), src ? h('div', { class: 'wd-src' }, src) : null, h('div', { class: 'wd-act' }, ...act));
    pv.replaceChildren(stage, info);
    fitText(nm, 2, 0.6);
  };

  const render = () => {
    const k = kind, s = ctx.save;
    const offers = activeOffers(s, ctx.now());
    grid.replaceChildren(...itemsOf(k).map((d) => {
      const off = ownsItem(s, k, d.id) ? undefined : offers.find((o) => o.rewards.some((r) => r.kind === k && r.id === d.id));
      const c = itemCard(k, d.id, {
        sizeU: k === 'skin' ? 120 : 96,
        sel: equipped(k) === d.id,
        badge: off ? saleBadge(off.discount, true) : undefined,
        dim: !ownsItem(s, k, d.id) && !d.price && !off,
        foot: cardFoot(k, d, off),
        onClick: () => { sel[k] = d.id; render(); preview(sel.skin, sel.ball); },
      });
      if (sel[k] === d.id) c.classList.add('pick');
      return c;
    }));
    renderPreview();
  };

  const t = tabs<Tab>([
    { id: 'skins', label: tr({ ru: 'Персонажи', en: 'Characters' }), icon: 'shirt' },
    { id: 'balls', label: tr({ ru: 'Комья', en: 'Snowballs' }), icon: 'ball' },
  ], (id) => { kind = id === 'balls' ? 'ball' : 'skin'; render(); list.scrollTop = 0; });
  p.head.append(t.el);

  return {
    show(arg) {
      sel.skin = ctx.save.skin;
      sel.ball = ctx.save.ball;
      t.select(arg === 'balls' ? 'balls' : 'skins');
      p.show();
      preview(sel.skin, sel.ball);
      // first visit: the tutorial gift (winter Нубик), once
      const gift = claimSkinGift(ctx.save);
      if (gift) {
        sel.skin = ctx.save.skin;
        ctx.persist();
        ctx.refresh();
        render();
        void showRewards(ctx, [gift], tr({ ru: 'Подарок для Нубика!', en: 'A gift for Noob!' }));
      }
    },
    hide() {
      p.hide();
      preview(ctx.save.skin, ctx.save.ball);
    },
    get visible() { return p.visible; },
    refresh() { if (p.visible) render(); },
    tab: () => (kind === 'ball' ? 'balls' : 'skins'),
  };
}
