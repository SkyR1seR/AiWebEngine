// Upgrades (owner: ui-store): 5 upgrade cards with level pips, effect, coin price, free level for an ad (cooldown).
// The very first upgrade is free (tutorial freebie 'upgrade'); every card then also offers a free level for a rewarded ad
// (one shared 10-minute cooldown, save.freeUp).
import { h } from 'aiwebengine/ui';
import type { Ctx, ScreenApi, UpgradeId } from './types';
import { FREE_UP_MS, UPGRADES, upgradeCost, upgradeLabel, type UpgradeDef } from './catalog';
import { spend } from './save';
import { freebieAvailable, isUnlocked, useFreebie } from './unlocks';
import { addCSS } from './theme';
import { sfx } from './audio';
import { adBtn, attention, btn, fitText, icon, makeScreen, money, progress, setText, timerChip, toast, type Progress } from './widgets';
import { tr } from './i18n';

const CSS = `
.up-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,460u),1fr));gap:26u 22u;padding:12u 6u 16u}
.up-c{--rc:#5aa9ff;position:relative;display:grid;grid-template-columns:auto 1fr;grid-template-areas:'ic info' 'act act';gap:10u 16u;align-items:center;padding:16u 16u 14u;
background:linear-gradient(#21406f,#0d1830 90%);box-shadow:inset 0 0 0 4u var(--rc),inset 0 0 0 7u rgba(0,0,0,.35),0 0 0 3u var(--ol),0 9u 0 rgba(0,0,0,.3)}
.up-c.max{--rc:#ffb31a;background:linear-gradient(#5a3d0e,#1a1408 90%)}
.up-ic{grid-area:ic;width:92u;height:92u;padding:8u;background:rgba(0,0,0,.3);box-shadow:inset 0 0 0 3u rgba(255,255,255,.12)}
.up-ic>.ic{width:100%;height:100%}
.up-info{grid-area:info;display:flex;flex-direction:column;gap:6u;min-width:0}
.up-top{display:flex;align-items:baseline;gap:10u}
.up-nm{flex:1 1 auto;min-width:0;font-weight:700;font-size:28u;overflow-wrap:break-word}
.up-lv{flex:none;font-weight:700;font-size:22u;color:#ffe9a0}
.up-ds{font-size:20u;color:#c6d4ea}
.up-c .pbar{height:22u;min-width:0}
.up-ef{display:flex;flex-wrap:wrap;align-items:center;gap:2u 8u;font-size:21u;font-weight:700}
.up-ef>.nx{color:#7ee26a}
.up-act{grid-area:act;display:flex;flex-wrap:wrap;gap:12u}
.up-act>.btn{flex:1 1 180u}
.up-act>.btn.no .money{color:#ff8f80}
.up-mx{flex:1;text-align:center;font-size:30u;font-weight:700;color:#ffd447;text-shadow:var(--tol2);padding:8u}
.up-c.fx{animation:upfx .6s ease-out}
@keyframes upfx{0%{scale:1}25%{scale:1.05;filter:brightness(1.7)}100%{scale:1;filter:none}}
.up-pop{position:absolute;z-index:5;left:50%;top:30%;font-size:44u;font-weight:700;color:#7ee26a;text-shadow:var(--tol);pointer-events:none;white-space:nowrap;
animation:uppop 1s ease-out forwards}
@keyframes uppop{0%{transform:translate(-50%,0) scale(.4);opacity:0}25%{transform:translate(-50%,-20u) scale(1.15);opacity:1}100%{transform:translate(-50%,-90u) scale(1);opacity:0}}
.up-spk{position:absolute;z-index:5;width:16u;height:16u;background:var(--spk) center/contain no-repeat;pointer-events:none;animation:upspk .8s ease-out forwards}
@keyframes upspk{from{transform:translate(0,0) scale(1.4);opacity:1}to{transform:translate(var(--dx),var(--dy)) scale(.2);opacity:0}}
.up-hd{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:6u 12u;padding:2u 8u 6u;font-size:22u;color:#c6d4ea;text-align:center}
@media (min-aspect-ratio:4/5) and (max-height:560px){.up-ic{width:76u;height:76u}.up-ds{display:none}}
`;

interface UpCard { el: HTMLElement; buy: HTMLButtonElement | null; update(): void }

export interface UpgradesApi extends ScreenApi {
  /** price/free button of an upgrade card (default: the first card) — the tutorial hand points at it */
  buyButton(id?: UpgradeId): HTMLElement | null;
}

export function createUpgrades(ctx: Ctx): UpgradesApi {
  addCSS('upgradesui', CSS);
  const p = makeScreen(ctx, tr({ ru: 'Улучшения', en: 'Upgrades' }));
  const grid = h('div', { class: 'up-grid' });
  p.body.append(grid);
  const cards = new Map<UpgradeId, UpCard>();
  let headKey = '';

  /** cooldown line in the header (free ad upgrade in mm:ss) */
  const updHead = () => {
    const s = ctx.save, now = ctx.now();
    const wait = ctx.sdk.rewardedSupported && !freebieAvailable(s, 'upgrade') && s.freeUp > now;
    const key = wait ? String(s.freeUp) : '';
    if (key === headKey) return;
    headKey = key;
    p.head.replaceChildren(...(wait ? [h('div', { class: 'up-hd' }, tr({ ru: 'Бесплатное улучшение за рекламу через:', en: 'Free upgrade for an ad in:' }), timerChip(ctx, s.freeUp, () => refreshAll()))] : []));
  };
  const refreshAll = () => { for (const c of cards.values()) c.update(); updHead(); };

  const levelUp = (c: UpCard, id: UpgradeId) => {
    ctx.save.up[id]++;
    ctx.persist();
    ctx.refresh();
    refreshAll();
    sfx('levelup');
    // juice: flash, "+1" rising, sparkles flying out
    c.el.classList.remove('fx');
    void c.el.offsetWidth;
    c.el.classList.add('fx');
    const pop = h('div', { class: 'up-pop' }, tr({ ru: `Ур. ${ctx.save.up[id]}!`, en: `Lv. ${ctx.save.up[id]}!` }));
    c.el.append(pop);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2, r = 70 + (i % 3) * 30;
      const sp = h('i', { class: 'up-spk' });
      sp.style.cssText = `left:calc(var(--u)*62px);top:calc(var(--u)*62px);--dx:calc(var(--u)*${Math.round(Math.cos(a) * r)}px);--dy:calc(var(--u)*${Math.round(Math.sin(a) * r)}px)`;
      c.el.append(sp);
      setTimeout(() => sp.remove(), 850);
    }
    setTimeout(() => pop.remove(), 1050);
  };

  const makeCard = (d: UpgradeDef): UpCard => {
    const id = d.id;
    const lv = h('span', { class: 'up-lv' });
    const nm = h('span', { class: 'up-nm' }, tr(d.name));
    const bar: Progress = progress(0, { seg: d.max, color: '#5fd35a' });
    const cur = h('span'), nx = h('span', { class: 'nx' });
    const ef = h('div', { class: 'up-ef' }, cur, nx);
    const act = h('div', { class: 'up-act' });
    const el = h('div', { class: 'up-c' },
      h('div', { class: 'up-ic' }, icon(id, 76)),
      h('div', { class: 'up-info' }, h('div', { class: 'up-top' }, nm, lv), h('div', { class: 'up-ds' }, tr(d.desc)), bar.el, ef),
      act);
    fitText(nm, 2, 0.7);
    let key = '';
    const c: UpCard = {
      el, buy: null,
      update() {
        const s = ctx.save, now = ctx.now(), l = s.up[id], max = l >= d.max;
        const free = !max && freebieAvailable(s, 'upgrade');
        const cost = upgradeCost(id, l), afford = s.coins >= cost;
        const ad = !max && !free && ctx.sdk.rewardedSupported && s.freeUp <= now;
        const k = `${l}|${free}|${afford}|${ad}`;
        if (k === key) return;
        key = k;
        setText(lv, tr({ ru: `Ур. ${l}/${d.max}`, en: `Lv. ${l}/${d.max}` }));
        bar.set(l / d.max);
        el.classList.toggle('max', max);
        setText(cur, upgradeLabel(id, l));
        setText(nx, max ? '' : `→ ${upgradeLabel(id, l + 1)}`);
        c.buy = null;
        if (max) { act.replaceChildren(h('div', { class: 'up-mx' }, tr({ ru: 'МАКСИМУМ', en: 'MAX LEVEL' }))); return; }
        let b: HTMLButtonElement;
        if (free) {
          b = btn([icon('up'), tr({ ru: 'Бесплатно', en: 'Free' })], () => {
            if (!freebieAvailable(ctx.save, 'upgrade')) return;
            useFreebie(ctx.save, 'upgrade');
            levelUp(c, id);
          }, 'green');
          attention(b, id === UPGRADES[0].id);
        } else {
          b = btn([icon('up'), money('coins', cost)], () => {
            if (!spend(ctx.save, 'coins', upgradeCost(id, ctx.save.up[id]))) {
              toast(ctx, tr({ ru: 'Не хватает монет', en: 'Not enough coins' }), 'bad');
              if (isUnlocked(ctx.save, 'shop')) ctx.nav.shop('coins');
              return;
            }
            sfx('buy');
            levelUp(c, id);
          }, afford ? 'gold' : 'no');
        }
        c.buy = b;
        const btns: HTMLElement[] = [b];
        if (ad) {
          const ab: HTMLButtonElement = adBtn(tr({ ru: 'Бесплатно', en: 'Free' }), async () => {
            if (ctx.save.freeUp > ctx.now() || ctx.save.up[id] >= d.max) return;
            ab.classList.add('busy');
            let ok = false;
            try { ok = await ctx.sdk.showRewarded('free_upgrade'); } catch { ok = false; }
            ab.classList.remove('busy');
            if (!ok) { toast(ctx, tr({ ru: 'Награда не получена: видео не досмотрено или недоступно', en: 'No reward: the video was skipped or is unavailable' }), 'bad'); return; }
            ctx.save.freeUp = ctx.now() + FREE_UP_MS;
            levelUp(c, id);
          });
          btns.push(ab);
        }
        act.replaceChildren(...btns);
      },
    };
    return c;
  };

  for (const d of UPGRADES) {
    const c = makeCard(d);
    cards.set(d.id, c);
    grid.append(c.el);
  }

  return {
    show() { p.show(); refreshAll(); },
    hide() { p.hide(); },
    get visible() { return p.visible; },
    refresh() { refreshAll(); },
    buyButton: (id) => cards.get(id ?? UPGRADES[0].id)?.buy ?? null,
  };
}
