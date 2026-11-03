// Cases (owner: ui-store): case cards (price, keys, free-for-ad timer, chances) and the roulette opening animation.
//
// openCase(ctx, id, via): pay (gems / key / rewarded ad / the one-time tutorial freebie) → catalog.openCaseResult →
// persist → roulette popup (strip of random drops scrolling to the real one, ease-out ~5 s, skippable after 1 s) → reveal.
import { h } from 'aiwebengine/ui';
import type { CaseId, Ctx, Drop, ScreenApi } from './types';
import { CASES, PITY, caseDef, caseOdds, casePool, dropTable, isItemDrop, itemDef, openCaseResult, rouletteFiller, type ItemDef } from './catalog';
import { spend } from './save';
import { freebieAvailable, useFreebie } from './unlocks';
import { addCSS, RARITY_COLOR } from './theme';
import { iconURL } from './textures';
import { sfx } from './audio';
import {
  adBtn, attention, badge, btn, card, fitText, icon, itemArt, lines, makeScreen, modal, money, rarityBadge, timerChip, toast,
} from './widgets';
import { needGems } from './offersui';
import { tr } from './i18n';
import { fmtNum } from './util';

const CSS = `
.cs-grid{display:flex;flex-wrap:wrap;justify-content:center;align-items:stretch;gap:30u 26u;padding:26u 10u 18u}
.cs-card{flex:1 1 300u;max-width:400u;gap:8u;padding:18u 14u 16u}
.cs-art{position:relative;isolation:isolate;width:170u;height:170u;cursor:pointer}
.cs-art::before{content:'';position:absolute;z-index:-1;inset:4%;border-radius:50%;background:radial-gradient(closest-side,var(--rc),transparent);opacity:.6;animation:glow 1.6s ease-in-out infinite alternate}
.cs-art>img{width:100%;height:100%;filter:drop-shadow(0 8u 0 rgba(0,0,0,.35));animation:cswob 3.4s ease-in-out infinite}
.cs-card:nth-child(2) .cs-art>img{animation-delay:-1.1s}.cs-card:nth-child(3) .cs-art>img{animation-delay:-2.2s}
@keyframes cswob{0%,70%,100%{rotate:0deg;translate:0 0}75%{rotate:-6deg;translate:0 -6u}80%{rotate:6deg}85%{rotate:-4deg}90%{rotate:3deg;translate:0 0}}
.cs-card .nm{font-size:30u}
.cs-loot{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:6u;font-size:18u;color:#c6d4ea}
.cs-loot>.art{width:54u;height:54u;padding:2u;background:rgba(0,0,0,.3);box-shadow:inset 0 0 0 3u var(--c)}
.cs-card .foot{flex-direction:column;align-items:stretch;width:100%;gap:14u}
.cs-card .foot>.btn{width:100%}
.cs-wait{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:4u 10u;font-size:20u;color:#c6d4ea}
.cs-card>.btn.cs-odds{position:absolute;z-index:4;top:-14u;right:-12u}
.cs-note{margin:0 auto;max-width:900u;text-align:center;font-size:21u;color:#a9bdd6}
@media (max-aspect-ratio:4/5){
.cs-grid{flex-direction:column;align-items:stretch;gap:30u}
.cs-card{flex:none;max-width:none;display:grid;grid-template-columns:200u 1fr;grid-template-areas:'art nm' 'art loot' 'art foot';column-gap:18u;align-items:center;text-align:left}
.cs-card>.cs-art{grid-area:art;width:190u;height:190u}.cs-card>.nm{grid-area:nm;text-align:left}.cs-card>.cs-loot{grid-area:loot;justify-content:flex-start}
.cs-card>.foot{grid-area:foot}
}
@media (min-aspect-ratio:4/5) and (max-height:560px){.cs-art{width:140u;height:140u}}
/* odds */
.cs-od{width:100%;text-align:left}
.cs-od .sw{flex:none;width:30u;height:30u;background:var(--c);box-shadow:0 0 0 3u var(--ol)}
.cs-od .ic{width:34u;height:34u}
.cs-od .pct{flex:none;font-size:30u;font-weight:700;color:#ffe9a0}
.cs-od .pool{display:flex;flex-wrap:wrap;gap:4u;margin-top:6u}
.cs-od .pool>.art{width:50u;height:50u}
.cs-ods{display:flex;flex-direction:column;gap:10u;width:min(100%,640u)}
/* roulette */
.panel.modal.rl-pop{width:min(100%,1000u)}
.rl-win{position:relative;width:100%;height:200u;overflow:hidden;flex:none;background:linear-gradient(#08142c,#0e2248);
box-shadow:inset 0 0 0 4u var(--ol),inset 0 10u 0 rgba(0,0,0,.35)}
.rl-win::before,.rl-win::after{content:'';position:absolute;z-index:2;top:0;bottom:0;width:18%;pointer-events:none}
.rl-win::before{left:0;background:linear-gradient(90deg,#08142c,transparent)}.rl-win::after{right:0;background:linear-gradient(-90deg,#08142c,transparent)}
.rl-strip{position:absolute;left:0;top:22u;display:flex;gap:12u;padding:0 12u;will-change:transform}
.rl-t{flex:none;width:150u;height:156u;justify-content:center;padding:10u 6u}
.rl-t>.art{width:104u;height:104u}
.rl-t .nm{font-size:20u}
.rl-t.win{z-index:1;animation:rlwin .5s ease-out forwards}
@keyframes rlwin{50%{scale:1.18;filter:brightness(1.6)}100%{scale:1.1;filter:brightness(1.15)}}
.rl-mk{position:absolute;z-index:3;left:calc(50% - 3u);top:0;bottom:0;width:6u;background:#ffd447;box-shadow:0 0 0 3u var(--ol),0 0 18u #ffd447;pointer-events:none}
.rl-mk::before,.rl-mk::after{content:'';position:absolute;left:-12u;border:15u solid transparent}
.rl-mk::before{top:-3u;border-top:18u solid #ffd447}.rl-mk::after{bottom:-3u;border-bottom:18u solid #ffd447}
.rl-rv{position:relative;isolation:isolate;display:flex;flex-direction:column;align-items:center;gap:10u;padding:10u 20u;animation:pop .45s cubic-bezier(.2,1.6,.4,1)}
.rl-rv>.art{width:220u;height:220u;filter:drop-shadow(0 0 16u var(--rc)) drop-shadow(0 8u 0 rgba(0,0,0,.35))}
.rl-rv>.rays{top:45%;width:520u;max-width:140%}
.rl-rv>.nm{font-size:38u;font-weight:700;text-shadow:var(--tol2)}
.rl-rv>.rbadge{font-size:22u}
.rl-rv .dup{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:4u 10u;font-size:24u;color:#ffe9a0}
@media (min-aspect-ratio:4/5) and (max-height:560px){.rl-rv>.art{width:160u;height:160u}.rl-win{height:180u}.rl-t{height:140u}.rl-t>.art{width:92u;height:92u}}
.rl-skip{visibility:hidden}.rl-skip.on{visibility:visible}
`;

const css = () => addCSS('casesui', CSS);
const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** case grids currently on screen re-render after any open (shop tab + cases screen) */
const listeners = new Set<() => void>();
function changed() { for (const f of listeners) f(); }

/** the best items a case can drop (for the "inside" preview): legendary first, up to n */
function bestItems(id: CaseId, n: number): { kind: 'skin' | 'ball'; def: ItemDef }[] {
  const out: { kind: 'skin' | 'ball'; def: ItemDef }[] = [];
  for (const r of ['legendary', 'epic', 'rare'] as const) {
    for (const it of casePool(id, r)) if (out.length < n) out.push(it);
  }
  return out;
}

const pct = (c: number) => `${Math.round(c * 1000) / 10}%`;

/** "Chances" popup: every row of the drop table with its probability and the exact items of each rarity */
export function showOdds(ctx: Ctx, id: CaseId): void {
  css();
  const table = dropTable(id);
  const rows = caseOdds(id).map((o, i) => {
    const left: HTMLElement[] = [h('div', { class: 'b' }, tr(o.label))];
    if (o.rarity) {
      left.push(h('div', { class: 'pool' }, ...casePool(id, o.rarity).map((it) => {
        const a = itemArt(it.kind, it.def.id, 0);
        a.title = tr(it.def.name);
        return a;
      })));
    }
    let sw: HTMLElement;
    if (o.rarity) { sw = h('i', { class: 'sw' }); sw.style.setProperty('--c', RARITY_COLOR[o.rarity]); } else sw = icon(table[i]?.kind === 'gems' ? 'gem' : 'coin');
    return h('div', { class: 'li cs-od' }, sw, h('div', { class: 'grow' }, ...left), h('span', { class: 'pct' }, pct(o.chance)));
  });
  const notes: HTMLElement[] = [h('p', { class: 'txt sub' }, tr({ ru: 'Если предмет уже есть, вместо него ты получишь монеты.', en: 'If you already own the item, you get coins instead.' }))];
  if (id !== 'snow') {
    const left = Math.max(1, PITY - ctx.save.pity);
    notes.unshift(h('p', { class: 'txt c-gold b' }, tr({
      ru: `Легендарный предмет гарантирован хотя бы раз за ${PITY} открытий. Осталось не больше: ${left}.`,
      en: `A legendary item is guaranteed at least once every ${PITY} openings. At most ${left} to go.`,
    })));
  }
  modal(ctx, [h('div', { class: 'cs-ods' }, ...rows), ...notes], { title: tr({ ru: `Шансы: ${tr(caseDef(id).name)}`, en: `Drop chances: ${tr(caseDef(id).name)}` }) });
}

/**
 * Case cards (used by the cases screen and the shop's Gifts tab). The grid re-renders itself after opens and timers.
 * freeBtn: the snow case's free button when the tutorial freebie is available (tutorial hand target).
 */
export function caseCards(ctx: Ctx): { el: HTMLElement; render(): void; freeBtn(): HTMLElement | null } {
  css();
  const el = h('div', { class: 'cs-grid' });
  let free: HTMLElement | null = null;
  const open = (id: CaseId, via: OpenVia, b?: HTMLElement) => {
    b?.classList.add('busy');
    void openCase(ctx, id, via).finally(() => b?.classList.remove('busy'));
  };
  const render = () => {
    const s = ctx.save, now = ctx.now();
    free = null;
    el.replaceChildren(...CASES.map((c) => {
      const id = c.id;
      const foot: HTMLElement[] = [];
      let ribbon: HTMLElement | undefined;
      if (id === 'snow' && freebieAvailable(s, 'case')) {
        const b = btn(tr({ ru: 'Бесплатно', en: 'Free' }), () => open(id, 'free', b), 'green big');
        attention(b, true);
        free = b;
        foot.push(b);
        ribbon = badge(tr({ ru: 'Подарок!', en: 'Gift!' }), 'new');
      } else if (c.adEvery && ctx.sdk.rewardedSupported) {
        if (s.freeCase <= now) {
          const b = adBtn(tr({ ru: 'Бесплатно за рекламу', en: 'Free for an ad' }), () => open(id, 'ad', b));
          foot.push(b);
          ribbon = badge(tr({ ru: 'Бесплатно', en: 'Free' }), 'new');
        } else {
          foot.push(h('div', { class: 'cs-wait' }, tr({ ru: 'Бесплатный через:', en: 'Free one in:' }), timerChip(ctx, s.freeCase, render)));
        }
      }
      const keys = s.keys[id] || 0;
      if (keys > 0) {
        const b = btn([icon('key'), lines(tr({ ru: 'Открыть бесплатно', en: 'Open for free' }), tr({ ru: `Ключ ×${keys}`, en: `Key ×${keys}` }))], () => open(id, 'key', b), 'green');
        foot.push(b);
      }
      const gb = btn([tr({ ru: 'Открыть', en: 'Open' }), money('gems', c.price)], () => open(id, 'gems', gb), 'blue');
      foot.push(gb);
      const art = h('div', { class: 'cs-art' }, h('img', { src: iconURL(c.id === 'snow' ? 'case_snow' : c.id === 'ice' ? 'case_ice' : 'case_santa'), alt: '', draggable: 'false' }));
      art.addEventListener('click', () => { sfx('click'); showOdds(ctx, id); });
      const loot = h('div', { class: 'cs-loot' }, h('span', null, tr({ ru: 'Внутри:', en: 'Inside:' })), ...bestItems(id, 4).map((it) => {
        const a = itemArt(it.kind, it.def.id, 0);
        a.style.setProperty('--c', RARITY_COLOR[it.def.rarity]);
        a.title = tr(it.def.name);
        return a;
      }));
      const nm = h('div', { class: 'nm' }, tr(c.name));
      const cd = card({ rarity: c.rarity, badge: ribbon, cls: 'cs-card', foot });
      cd.insertBefore(art, cd.querySelector(':scope>.foot'));
      cd.insertBefore(nm, cd.querySelector(':scope>.foot'));
      cd.insertBefore(loot, cd.querySelector(':scope>.foot'));
      const odds = btn([icon('info')], () => showOdds(ctx, id), 'blue small icon cs-odds');
      odds.title = odds.ariaLabel = tr({ ru: 'Шансы', en: 'Chances' });
      cd.append(odds);
      fitText(nm, 2, 0.6);
      return cd;
    }));
  };
  // re-render while attached (listeners of detached grids are dropped on the next change)
  const self = () => { if (el.isConnected) render(); else if (listeners.size > 4) listeners.delete(self); };
  listeners.add(self);
  render();
  return { el, render, freeBtn: () => free };
}

export function createCases(ctx: Ctx): ScreenApi & { freeButton(): HTMLElement | null } {
  css();
  const p = makeScreen(ctx, tr({ ru: 'Подарки', en: 'Gifts' }));
  const cc = caseCards(ctx);
  p.body.append(cc.el, h('p', { class: 'cs-note' }, tr({ ru: 'Нажми на подарок, чтобы увидеть шансы и всё, что может выпасть.', en: 'Tap a gift to see the chances and everything it can contain.' })));
  return {
    show() { cc.render(); p.show(); },
    hide() { p.hide(); },
    get visible() { return p.visible; },
    refresh() { if (p.visible) cc.render(); },
    freeButton: () => cc.freeBtn(),
  };
}

export type OpenVia = 'gems' | 'key' | 'ad' | 'free';

/** pay (gems / key / ad / 'free' = the one-time tutorial freebie) and play the roulette; true if a case was opened.
 * Resolves when the roulette popup is closed. */
export async function openCase(ctx: Ctx, id: CaseId, via: OpenVia): Promise<boolean> {
  css();
  const s = ctx.save, c = caseDef(id);
  switch (via) {
    case 'free':
      if (id !== 'snow' || !freebieAvailable(s, 'case')) return false;
      useFreebie(s, 'case');
      break;
    case 'key':
      if (!(s.keys[id] > 0)) return false;
      s.keys[id]--;
      break;
    case 'ad': {
      if (!c.adEvery || s.freeCase > ctx.now()) return false;
      let ok = false;
      try { ok = await ctx.sdk.showRewarded('free_case'); } catch { ok = false; }
      if (!ok) { toast(ctx, tr({ ru: 'Награда не получена: видео не досмотрено или недоступно', en: 'No reward: the video was skipped or is unavailable' }), 'bad'); return false; }
      s.freeCase = ctx.now() + c.adEvery;
      break;
    }
    default:
      if (!spend(s, 'gems', c.price)) { needGems(ctx); return false; }
  }
  ctx.persist();
  ctx.refresh(); // the payment shows at once; the prize lands in the bar after the reveal
  const drop = openCaseResult(s, id);
  ctx.persist();
  changed();
  await roulette(ctx, id, drop);
  ctx.refresh();
  changed();
  return true;
}

// ---------------------------------------------------------------- roulette

const STRIP = 45, WIN = 38;

function tile(d: Drop): HTMLElement {
  if (isItemDrop(d)) return card({ rarity: d.rarity, art: itemArt(d.kind, d.id, 0), cls: 'rl-t' });
  return card({ rarity: d.kind, art: itemArt(d.kind, undefined, 0), name: `+${fmtNum(d.n)}`, cls: 'rl-t' });
}

function reveal(d: Drop): HTMLElement {
  const el = h('div', { class: 'rl-rv' }, h('div', { class: 'rays' }));
  if (isItemDrop(d)) {
    el.classList.add(`r-${d.rarity}`);
    el.append(itemArt(d.kind, d.id, 0), h('div', { class: 'nm' }, tr(itemDef(d.kind, d.id).name)), rarityBadge(d.rarity));
    if (d.dup) el.append(h('div', { class: 'dup' }, tr({ ru: 'Дубликат →', en: 'Duplicate →' }), money('coins', `+${fmtNum(d.comp)}`)));
    else el.append(h('div', { class: 'b c-good' }, tr({ ru: 'Новый предмет!', en: 'New item!' })));
  } else {
    el.classList.add(`r-${d.kind}`);
    el.append(itemArt(d.kind, undefined, 0), h('div', { class: 'nm' }, money(d.kind, `+${fmtNum(d.n)}`, 44)));
  }
  return el;
}

/** the opening popup; resolves when closed */
function roulette(ctx: Ctx, id: CaseId, drop: Drop): Promise<void> {
  return new Promise((resolve) => {
    const items = rouletteFiller(id, STRIP);
    items[WIN] = drop;
    const tiles = items.map(tile);
    const strip = h('div', { class: 'rl-strip' }, ...tiles);
    const win = h('div', { class: 'rl-win' }, strip, h('i', { class: 'rl-mk' }));
    let raf = 0, t0 = 0, target = 0, step = 1, first = 0, half = 0, last = -1, lastTick = 0, done = false;
    const dur = reducedMotion() ? 400 : 5200;
    const skip = btn(tr({ ru: 'Пропустить', en: 'Skip' }), () => { t0 = -1e9; }, 'rl-skip');
    const skipT = window.setTimeout(() => skip.classList.add('on'), 1000);
    const m = modal(ctx, [win], {
      title: tr(caseDef(id).name), cls: 'gold wide rl-pop', closable: false, foot: [skip],
      onClose: () => { cancelAnimationFrame(raf); clearTimeout(skipT); resolve(); },
    });
    const foot = m.el.querySelector<HTMLElement>('.mfoot')!;

    const frame = (t: number) => {
      const k = Math.min(1, Math.max(0, (t - t0) / dur));
      const x = target * (1 - Math.pow(1 - k, 4)); // quartic ease-out
      strip.style.transform = `translateX(${-x.toFixed(1)}px)`;
      const idx = Math.floor((x + half - first) / step);
      if (idx !== last) { last = idx; if (t - lastTick > 45) { lastTick = t; sfx('tick', 0.6); } }
      if (k < 1) raf = requestAnimationFrame(frame);
      else finish();
    };
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(skipT);
      tiles[WIN].classList.add('win');
      sfx('reveal');
      setTimeout(() => {
        if (!win.isConnected) return;
        win.replaceWith(reveal(drop));
        const s = ctx.save, btns: HTMLElement[] = [];
        if (isItemDrop(drop) && (drop.kind === 'skin' ? s.skin : s.ball) !== drop.id) {
          btns.push(btn(tr({ ru: 'Надеть', en: 'Equip' }), () => {
            if (drop.kind === 'skin') s.skin = drop.id; else s.ball = drop.id;
            ctx.persist();
            m.close();
          }, 'blue big'));
        }
        // one more (keys first, then gems)
        const c = caseDef(id), keys = s.keys[id] || 0;
        if (keys > 0 || s.gems >= c.price) {
          const via: OpenVia = keys > 0 ? 'key' : 'gems';
          btns.push(btn(keys > 0 ? [icon('key'), tr({ ru: 'Ещё раз', en: 'Again' })] : [tr({ ru: 'Ещё раз', en: 'Again' }), money('gems', c.price)],
            () => { m.close(); void openCase(ctx, id, via); }, 'big'));
        }
        btns.push(btn(tr({ ru: 'Забрать', en: 'Collect' }), () => m.close(), 'green big'));
        foot.replaceChildren(...btns);
      }, reducedMotion() ? 50 : 750);
    };
    // measure after layout, then spin; the stop point is randomized inside the winning tile
    requestAnimationFrame(() => {
      first = tiles[0].offsetLeft;
      step = Math.max(1, tiles[1].offsetLeft - first);
      half = win.clientWidth / 2;
      const tw = tiles[WIN].offsetWidth;
      target = tiles[WIN].offsetLeft + tw / 2 - half + (Math.random() - 0.5) * tw * 0.7;
      t0 = performance.now();
      raf = requestAnimationFrame(frame);
    });
  });
}
