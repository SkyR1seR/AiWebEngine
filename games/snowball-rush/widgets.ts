// Shared UI building blocks (owner: ui-base). Everything is DOM inside ui.root, styled by theme.ts (class list there);
// sizes via u(). Text arguments are already-translated strings (callers use tr()); the few texts made here use tr() too.
//
// Typical screen:
//   const p = makeScreen(ctx, tr({ ru: 'Гардероб', en: 'Wardrobe' }));
//   const t = tabs([{ id: 'skins', label: … }, { id: 'balls', label: … }], (id) => render(id));
//   p.head.append(t.el); t.select('skins');
//   p.body.append(h('div', { class: 'grid' }, ...cards));
//   p.show();
import { h, u } from 'aiwebengine/ui';
import type { CaseId, Ctx, Drop, Rarity, Reward } from './types';
import { iconURL, type IconId } from './textures';
import { ballIcon, skinFigure, skinPortrait } from './skinart';
import { caseDef, itemDef } from './catalog';
import { isUnlocked } from './unlocks';
import { sfx } from './audio';
import { tr } from './i18n';
import { fmtNum, fmtTime } from './util';

/** what widgets accept as content: elements, text (strings/numbers), or nothing */
export type Child = HTMLElement | SVGElement | string | number | null | undefined | false;
/** UI layers (see layer()) */
export type LayerName = 'hud' | 'screen' | 'top' | 'modal' | 'toast';

const stop = (e: Event) => e.stopPropagation();
const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** append children (strings become <span class="lbl"> so flex layouts can wrap them) */
function add(el: HTMLElement, content: Child | Child[]) {
  for (const c of Array.isArray(content) ? content : [content]) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'object' ? c : h('span', { class: 'lbl' }, String(c)));
  }
}

/** set textContent only when it differs (no DOM work for unchanged values) */
export function setText(el: Element, s: string | number): void {
  const v = String(s);
  if (el.textContent !== v) el.textContent = v;
}

/** two-line button label: main text + a smaller second line (btn([icon('cart'), lines('Магазин', 'Ур. 5')], …)) */
export function lines(main: string, sub: string): HTMLElement {
  return h('span', { class: 'lbl' }, main, h('span', { class: 'sub' }, sub));
}

const fits = new WeakMap<Element, { lines: number; min: number; w: number }>();
let fitRO: ResizeObserver | null = null;
function refit(el: HTMLElement, force: boolean) {
  const o = fits.get(el), w = el.clientWidth;
  if (!o || !w || (!force && w === o.w)) return;
  o.w = w;
  el.style.fontSize = '';
  const base = parseFloat(getComputedStyle(el).fontSize);
  // measure the text itself (a Range: one rect per line fragment), not the box, which may be stretched by its parent
  const range = document.createRange();
  range.selectNodeContents(el);
  for (let k = 1; k > o.min;) {
    let n = 0, top = -1e9;
    for (const r of range.getClientRects()) if (r.width > 0 && Math.abs(r.top - top) > 2) { n++; top = r.top; }
    if (n <= o.lines && range.getBoundingClientRect().width <= w + 1) break;
    k -= 0.08;
    el.style.fontSize = `${(base * k).toFixed(1)}px`;
  }
}
/**
 * Shrink an element's font (down to `min` of its CSS size) until its text fits in `maxLines` lines without horizontal
 * overflow — for long translations in titles/tabs. Re-fits on resize; call again after changing the text.
 */
export function fitText(el: HTMLElement, maxLines = 1, min = 0.55): void {
  fits.set(el, { lines: maxLines, min, w: 0 });
  if (!fitRO && typeof ResizeObserver !== 'undefined') fitRO = new ResizeObserver((es) => { for (const e of es) refit(e.target as HTMLElement, false); });
  fitRO?.observe(el);
  if (el.isConnected) refit(el, true);
}

// ---------------------------------------------------------------- layers

const layers = new WeakMap<HTMLElement, Partial<Record<LayerName, HTMLElement>>>();
/** layer container in ui.root: hud(z1) screen(z5) top(z8) modal(z10) toast(z12); full size, safe-area inset, click-through */
export function layer(ctx: Ctx, name: LayerName): HTMLElement {
  const root = ctx.ui.root;
  let m = layers.get(root);
  if (!m) layers.set(root, (m = {}));
  let el = m[name];
  if (!el || el.parentNode !== root) {
    el = h('div', { class: `lay lay-${name}` });
    root.append(el);
    m[name] = el;
  }
  return el;
}

// ---------------------------------------------------------------- small pieces

/** pixel icon <i> element; sizeU in UI units (default: 28u, or 1.3em inside buttons/money) */
export function icon(id: IconId, sizeU = 28): HTMLElement {
  const el = h('i', { class: 'ic' });
  el.style.backgroundImage = `url(${iconURL(id)})`;
  if (sizeU !== 28) el.style.width = el.style.height = u(sizeU);
  return el;
}

/** "[coin] 1 234" / "[gem] 50"; sizeU = font size in UI units (default: inherit from the parent) */
export function money(kind: 'coins' | 'gems', n: number | string, sizeU = 26): HTMLElement {
  const el = h('span', { class: 'money' }, icon(kind === 'coins' ? 'coin' : 'gem'), h('b', null, typeof n === 'number' ? fmtNum(n) : n));
  if (sizeU !== 26) el.style.fontSize = u(sizeU);
  return el;
}

/**
 * Themed button: click sound, stops pointerdown/click propagation (race drag controls listen on the window).
 * cls: '' (stone) | 'green' | 'blue' | 'gold' | 'red' | 'ad' + size 'small' | 'big' | 'icon' (square, icon only), plus
 * 'locked' (grayed with a lock; still clickable → show lockLabel in a toast). b.disabled = true blocks clicks.
 * Content: btn([icon('play'), lines(tr(…'Играть'…), tr(…'Уровень 3'…))], go, 'green big'); strings become <span class="lbl">.
 */
export function btn(content: Child | Child[], onClick: () => void, cls = ''): HTMLButtonElement {
  const b = h('button', { class: `btn ${cls}`.trim(), type: 'button' });
  add(b, content);
  b.addEventListener('pointerdown', stop);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (b.disabled) return;
    sfx('click');
    onClick();
  });
  return b;
}

/** purple "watch an ad" button with the video icon (the caller shows the ad; see rewardedBtn for the full flow) */
export function adBtn(label: string, onClick: () => void, cls = ''): HTMLButtonElement {
  return btn(label, onClick, `ad ${cls}`);
}

/**
 * Rewarded-ad button with the whole flow: busy state while the ad runs, `onReward()` only if the platform granted it,
 * a toast otherwise. Hidden when the platform has no rewarded ads (in dev builds shown disabled with "unavailable").
 */
export function rewardedBtn(ctx: Ctx, label: string, placement: string, onReward: () => void, cls = ''): HTMLButtonElement {
  const b = adBtn(label, async () => {
    b.classList.add('busy');
    let ok = false;
    try { ok = await ctx.sdk.showRewarded(placement); } catch { ok = false; }
    b.classList.remove('busy');
    if (ok) onReward();
    else toast(ctx, tr({ ru: 'Награда не получена: видео не досмотрено или недоступно', en: 'No reward: the video was skipped or is unavailable' }), 'bad');
  }, cls);
  if (!ctx.sdk.rewardedSupported) {
    if (import.meta.env.DEV) {
      b.disabled = true;
      b.append(h('span', { class: 'sub' }, tr({ ru: 'недоступно', en: 'unavailable' })));
    } else b.classList.add('hidden');
  }
  return b;
}

/** decorative garland of blinking colored bulbs; put it into a positioned element (panels have one on top already) */
export function garland(cls = ''): HTMLElement {
  return h('div', { class: `garland ${cls}`.trim() });
}

/** corner ribbon on a card/button: 'sale' (red "−50%"), 'new' (green), 'hit' (gold), 'info' (blue); right = top-right corner */
export function badge(text: string, kind: 'sale' | 'new' | 'hit' | 'info' = 'sale', right = false): HTMLElement {
  return h('span', { class: `badge ${kind}${right ? ' r' : ''}` }, text);
}
/** red "−50%" ribbon */
export const saleBadge = (pct: number, right = false) => badge(`−${Math.round(pct)}%`, 'sale', right);
/** green "NEW" ribbon */
export const newBadge = (right = false) => badge(tr({ ru: 'Новинка', en: 'New' }), 'new', right);
/** gold "HIT" (bestseller) ribbon */
export const hitBadge = (right = false) => badge(tr({ ru: 'Хит', en: 'Bestseller' }), 'hit', right);

/** red notification dot on an element (a number > 1 is shown inside); the element gets position:relative if static */
export function dot(el: HTMLElement, on: boolean | number): void {
  let d = el.querySelector<HTMLElement>(':scope>.ndot');
  if (!on) { d?.remove(); return; }
  if (!d) {
    d = h('i', { class: 'ndot' });
    el.append(d);
    const isStatic = el.isConnected ? getComputedStyle(el).position === 'static' : !/\b(btn|card|chip|panel)\b/.test(el.className) && !el.style.position;
    if (isStatic) el.classList.add('rel');
  }
  setText(d, typeof on === 'number' && on > 1 ? String(Math.min(99, on)) : '');
}

/** pulsing yellow ring around an element (tutorial: "tap here") */
export function attention(el: HTMLElement, on: boolean): void {
  el.classList.toggle('attn', on);
}

/** progress bar handle: set(v 0..1, label?) touches the DOM only on change */
export interface Progress { el: HTMLElement; set(v: number, label?: string): void }
/** blocky segmented progress bar (v 0..1); seg = number of segments, color = fill, label = centered text */
export function progress(v = 0, opts: { seg?: number; color?: string; label?: string; cls?: string } = {}): Progress {
  const fill = h('b'), lbl = h('span');
  const el = h('div', { class: `pbar ${opts.cls ?? ''}`.trim() }, fill, lbl);
  el.style.setProperty('--seg', String(opts.seg ?? 10));
  if (opts.color) el.style.setProperty('--pc', opts.color);
  let cur = -1;
  const set = (x: number, label?: string) => {
    x = Math.max(0, Math.min(1, x || 0));
    if (x !== cur) { cur = x; fill.style.width = `${x * 100}%`; }
    if (label !== undefined) setText(lbl, label);
  };
  set(v, opts.label ?? '');
  return { el, set };
}

/** player avatar: framed pixel head of a skin */
export function avatar(skinId: string, sizeU = 64): HTMLElement {
  const el = h('div', { class: 'ava' }, h('img', { src: artURL(`p:${skinId}`, () => skinPortrait(skinId, 56)), alt: '', draggable: 'false' }));
  if (sizeU !== 64) el.style.width = el.style.height = u(sizeU);
  return el;
}

// ---------------------------------------------------------------- screens & popups

/** a screen made by makeScreen() */
export interface Panel {
  /** full-screen container (.screen in the screen layer) */
  el: HTMLElement;
  /** title text element */
  title: HTMLElement;
  /** scrollable content area */
  body: HTMLElement;
  show(): void;
  hide(): void;
  readonly visible: boolean;
  /** the framed snowy panel */
  panel: HTMLElement;
  /** title bar (back button, title, a free slot on the right: bar.lastElementChild) */
  bar: HTMLElement;
  /** fixed area between the title bar and the body (tabs, filters); hidden while empty */
  head: HTMLElement;
  /** change the title (re-fits long texts) */
  setTitle(text: string): void;
}
/**
 * Full-screen screen layer with a framed snowy panel (garland on top), title bar with a back button (back defaults to
 * ctx.nav.menu) and a scrollable body. Hidden until show(). The panel adapts: wide in landscape, tall in portrait, all
 * of the free area on square screens; the top var(--top) is left for the TopBar. wide: a wider panel (shop);
 * cls: extra panel classes (frames 'stone' | 'ice' | 'gold', 'nosnow').
 */
export function makeScreen(ctx: Ctx, title: string, opts: { back?: () => void; wide?: boolean; cls?: string } = {}): Panel {
  const back = btn(icon('back'), opts.back ?? (() => ctx.nav.menu()), 'icon');
  back.setAttribute('aria-label', tr({ ru: 'Назад', en: 'Back' }));
  const t = h('h2', { class: 'ttl' }, title);
  fitText(t, 2);
  const bar = h('div', { class: 'tbar' }, back, t, h('div', { class: 'tsp' }));
  const head = h('div', { class: 'phead' });
  const body = h('div', { class: 'pbody scroll' });
  const panel = h('div', { class: `panel${opts.wide ? ' wide' : ''} ${opts.cls ?? ''}`.trim() }, garland(), bar, head, body);
  const el = h('div', { class: 'screen hidden' }, panel);
  el.addEventListener('pointerdown', stop);
  layer(ctx, 'screen').append(el);
  let vis = false;
  return {
    el, title: t, body, panel, bar, head,
    setTitle(text) { setText(t, text); fitText(t, 2); },
    show() { vis = true; el.classList.remove('hidden'); },
    hide() { vis = false; el.classList.add('hidden'); },
    get visible() { return vis; },
  };
}

/** an open popup (el = its panel) */
export interface Modal { el: HTMLElement; close(): void; /** content area (scrolls when too tall) */ body: HTMLElement }
/**
 * Modal popup over everything: centered snowy panel over a dark backdrop; content scrolls when too tall, `foot` (action
 * buttons) stays visible below it. closable (default true) shows an X and closes on a backdrop tap; onClose runs once
 * however it was closed. cls: extra panel classes: 'wide' (up to 1120u), frames 'stone' | 'ice' | 'gold', 'nosnow'.
 */
export function modal(ctx: Ctx, content: Child[], opts: { title?: string; onClose?: () => void; closable?: boolean; cls?: string; foot?: Child[] } = {}): Modal {
  const panel = h('div', { class: `panel modal ${opts.cls ?? ''}`.trim() });
  if (opts.title) { const t = h('h2', { class: 'ttl' }, opts.title); fitText(t, 2); panel.append(h('div', { class: 'mhead' }, t)); }
  const body = h('div', { class: 'mbody scroll' });
  add(body, content);
  panel.append(body);
  if (opts.foot) { const f = h('div', { class: 'mfoot' }); add(f, opts.foot); panel.append(f); }
  const back = h('div', { class: 'mback' }, panel);
  let closed = false, downOnBack = false;
  const close = () => {
    if (closed) return;
    closed = true;
    back.remove();
    opts.onClose?.();
  };
  back.addEventListener('pointerdown', (e) => { downOnBack = e.target === back; e.stopPropagation(); });
  if (opts.closable ?? true) {
    const x = btn(icon('close'), close, 'red icon small xbtn');
    x.setAttribute('aria-label', tr({ ru: 'Закрыть', en: 'Close' }));
    panel.append(x);
    // a tap that starts and ends on the backdrop closes (a drag out of the panel doesn't)
    back.addEventListener('click', (e) => { if (e.target === back && downOnBack) { sfx('click'); close(); } });
  }
  layer(ctx, 'modal').append(back);
  return { el: panel, close, body };
}

/** confirm dialog → true if confirmed (X / backdrop / cancel → false) */
export function confirmBox(ctx: Ctx, text: string, ok: string, cancel?: string): Promise<boolean> {
  return new Promise((res) => {
    let yes = false;
    const m = modal(ctx, [h('p', { class: 'txt' }, text)], {
      onClose: () => res(yes),
      foot: [btn(cancel ?? tr({ ru: 'Отмена', en: 'Cancel' }), () => m.close()), btn(ok, () => { yes = true; m.close(); }, 'green')],
    });
  });
}

const toastTimers = new WeakMap<HTMLElement, number>();
/** short message at the top (stacks up to 3; the same text again just stays longer); 'bad' also plays the error sound */
export function toast(ctx: Ctx, msg: string, kind: 'info' | 'good' | 'bad' = 'info'): void {
  const lay = layer(ctx, 'toast');
  let box = lay.querySelector<HTMLElement>(':scope>.toasts');
  if (!box) lay.append((box = h('div', { class: 'toasts' })));
  let el = Array.from(box.children).find((c) => c.textContent === msg && !c.classList.contains('out')) as HTMLElement | undefined;
  if (!el) {
    while (box.children.length >= 3) box.firstElementChild!.remove();
    box.append((el = h('div', { class: `toast ${kind}` }, msg)));
  }
  if (kind === 'bad') sfx('error');
  clearTimeout(toastTimers.get(el));
  const t = el;
  toastTimers.set(t, window.setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, 2400));
}

/** tab strip (buttons share the width; labels wrap). select(id) highlights the tab AND calls onSelect; tapping the current tab does nothing */
export function tabs<T extends string>(items: { id: T; label: string; icon?: IconId }[], onSelect: (id: T) => void): { el: HTMLElement; select(id: T): void; setDot(id: T, on: boolean | number): void; readonly current: T | null } {
  const el = h('div', { class: 'tabs' });
  const map = new Map<T, HTMLButtonElement>();
  let cur: T | null = null;
  const select = (id: T) => {
    cur = id;
    for (const [k, b] of map) b.classList.toggle('on', k === id);
    onSelect(id);
  };
  for (const it of items) {
    const b = btn([it.icon ? icon(it.icon) : null, it.label], () => { if (cur !== it.id) select(it.id); }, 'tab');
    fitText(b.querySelector('.lbl')!, 2, 0.7);
    map.set(it.id, b);
    el.append(b);
  }
  return { el, select, setDot(id, on) { const b = map.get(id); if (b) dot(b, on); }, get current() { return cur; } };
}

// ---------------------------------------------------------------- rarity, timers

/** localized rarity name ("Legendary") */
export function rarityName(r: Rarity): string {
  switch (r) {
    case 'rare': return tr({ ru: 'Редкий', en: 'Rare' });
    case 'epic': return tr({ ru: 'Эпический', en: 'Epic' });
    case 'legendary': return tr({ ru: 'Легендарный', en: 'Legendary' });
    default: return tr({ ru: 'Обычный', en: 'Common' });
  }
}
/** small colored label with the rarity name */
export function rarityBadge(r: Rarity): HTMLElement {
  return h('span', { class: `rbadge r-${r}` }, rarityName(r));
}

/** remaining time text: "2d 05:12:09" (day part localized) / "05:12:09" / "12:09" */
export function fmtLeft(ms: number): string {
  ms = Math.max(0, ms);
  const d = Math.floor(ms / 864e5);
  if (d <= 0) return fmtTime(ms);
  const s = Math.floor(ms / 1000) % 86400, p = (v: number) => String(v).padStart(2, '0');
  const t = `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`;
  return tr({ ru: `${d}д ${t}`, en: `${d}d ${t}` });
}

interface LiveCd { el: HTMLElement; end: number; prefix: string; onEnd?: () => void; now: () => number; seen: boolean; miss: number }
const liveCds = new Set<LiveCd>();
let cdTimer = 0;
/** one shared 1 s interval for every countdown; detached elements are dropped (after a short grace period) */
function tickCds() {
  for (const c of liveCds) {
    if (!c.el.isConnected) {
      // not attached yet (built before insertion) or removed: give it a few ticks, then forget it
      if (++c.miss > (c.seen ? 2 : 30)) liveCds.delete(c);
      continue;
    }
    c.seen = true;
    c.miss = 0;
    const left = c.end - c.now();
    setText(c.el, c.prefix + fmtLeft(left));
    if (left <= 0) { liveCds.delete(c); c.onEnd?.(); }
  }
  if (!liveCds.size) { clearInterval(cdTimer); cdTimer = 0; }
}
/**
 * Element whose text counts down to endsAt (ms, ctx.now() clock) every second while connected (prefix e.g. "⏱ ").
 * onEnd runs once when it reaches zero. Rebuild the element if you detach and re-attach it for longer than ~2 s.
 */
export function countdown(ctx: Ctx, endsAt: number, prefix = '', onEnd?: () => void): HTMLElement {
  const el = h('span', { class: 'cd' }, prefix + fmtLeft(endsAt - ctx.now()));
  liveCds.add({ el, end: endsAt, prefix, onEnd, now: () => ctx.now(), seen: false, miss: 0 });
  if (!cdTimer) cdTimer = window.setInterval(tickCds, 1000);
  return el;
}
/** timer chip: [clock] 05:12:09 */
export function timerChip(ctx: Ctx, endsAt: number, onEnd?: () => void): HTMLElement {
  return h('span', { class: 'chip timer' }, countdown(ctx, endsAt, '', onEnd));
}

// ---------------------------------------------------------------- items & rewards

/** cached PNG data URLs of drawn art (canvases can't be shared between elements; URLs can) */
const arts = new Map<string, string>();
function artURL(key: string, draw: () => HTMLCanvasElement): string {
  let s = arts.get(key);
  if (!s) { s = draw().toDataURL(); arts.set(key, s); }
  return s;
}
const CASE_ICON: Record<CaseId, IconId> = { snow: 'case_snow', ice: 'case_ice', santa: 'case_santa' };

/** square art for a reward/drop/item: skin figure, ball icon, case (key: id = case id), coins pile, gems, no-ads.
 * sizeU <= 0: no inline size (set .art width/height in CSS) */
export function itemArt(kind: 'skin' | 'ball' | 'key' | 'coins' | 'gems' | 'noAds', id?: string, sizeU = 96): HTMLElement {
  let src: string;
  switch (kind) {
    case 'skin': src = artURL(`s:${id}`, () => skinFigure(id ?? 'noob', 132)); break;
    case 'ball': src = artURL(`b:${id}`, () => ballIcon(id ?? 'snow', 64)); break;
    case 'key': src = iconURL(CASE_ICON[id as CaseId] ?? 'case_snow'); break;
    case 'coins': src = iconURL('coins'); break;
    case 'gems': src = iconURL('gems'); break;
    default: src = iconURL('noads');
  }
  const el = h('div', { class: `art art-${kind}` }, h('img', { src, alt: '', draggable: 'false' }));
  if (sizeU > 0) el.style.width = el.style.height = u(sizeU);
  return el;
}

/**
 * Item / reward card with a rarity frame (epic & legendary glow). art: itemArt(...); name: wrapped title; badge: a ribbon
 * (saleBadge...); foot: bottom row (price, buttons); sel: equipped (white frame + check); locked: lock icon; dim: gray art.
 */
export function card(o: {
  rarity?: Rarity | 'coins' | 'gems'; art?: HTMLElement; name?: string; badge?: HTMLElement; foot?: Child | Child[];
  sel?: boolean; locked?: boolean; dim?: boolean; onClick?: () => void; cls?: string;
} = {}): HTMLElement {
  const cls = ['card', `r-${o.rarity ?? 'common'}`, o.sel && 'sel', o.locked && 'lockd', o.dim && 'dim', o.onClick && 'tap', o.cls].filter(Boolean).join(' ');
  const el = h('div', { class: cls });
  add(el, [o.badge, o.art, o.name ? h('div', { class: 'nm' }, o.name) : null]);
  if (o.foot !== undefined && o.foot !== null) { const f = h('div', { class: 'foot' }); add(f, o.foot); el.append(f); }
  if (o.onClick) {
    const fn = o.onClick;
    el.addEventListener('pointerdown', stop);
    el.addEventListener('click', (e) => { e.stopPropagation(); sfx('click'); fn(); });
  }
  return el;
}

/** catalog skin/ball card: art + name + rarity badge (+ the card() options) */
export function itemCard(kind: 'skin' | 'ball', id: string, o: Parameters<typeof card>[0] & { sizeU?: number } = {}): HTMLElement {
  const def = itemDef(kind, id);
  const c = card({ rarity: def.rarity, art: itemArt(kind, id, o.sizeU ?? 110), name: tr(def.name), ...o });
  c.insertBefore(rarityBadge(def.rarity), c.querySelector(':scope>.foot'));
  return c;
}

/** short label of a reward ("+500", "Дед Мороз", "Ледяной подарок x3", "Без рекламы") */
export function rewardLabel(r: Reward | Drop): string {
  switch (r.kind) {
    case 'coins': case 'gems': return `+${fmtNum(r.n)}`;
    case 'skin': case 'ball': return tr(itemDef(r.kind, r.id).name);
    case 'key': { const name = tr(caseDef(r.id).name); return r.n > 1 ? `${name} x${r.n}` : name; }
    default: return tr({ ru: 'Без рекламы', en: 'No ads' });
  }
}

/** card of one reward in showRewards */
function rewardCard(d: Reward | Drop): HTMLElement {
  let rarity: Rarity | 'coins' | 'gems', art: HTMLElement, extra: HTMLElement | null = null;
  switch (d.kind) {
    case 'coins': case 'gems': rarity = d.kind; art = itemArt(d.kind, undefined, 0); break;
    case 'skin': case 'ball': {
      rarity = itemDef(d.kind, d.id).rarity;
      art = itemArt(d.kind, d.id, 0);
      if ('dup' in d && d.dup) extra = h('div', { class: 'dup' }, tr({ ru: 'Уже есть', en: 'Already owned' }), money('coins', `+${fmtNum(d.comp)}`));
      break;
    }
    case 'key': rarity = caseDef(d.id).rarity; art = itemArt('key', d.id, 0); break;
    default: rarity = 'rare'; art = itemArt('noAds', undefined, 0);
  }
  const c = card({ rarity, art, name: rewardLabel(d), cls: 'rwd' });
  c.prepend(h('div', { class: 'rays' }));
  if (d.kind === 'skin' || d.kind === 'ball') c.append(rarityBadge(rarity as Rarity));
  if (extra) c.append(extra);
  return c;
}

/**
 * Celebratory "You got!" popup: reward cards pop in one by one (sfx 'reveal'), rays and sparkles; duplicates show
 * "+X coins". Accepts Drop[] and also Reward[] items (keys, no-ads). Resolves when closed (Collect / X / backdrop).
 */
export function showRewards(ctx: Ctx, drops: ReadonlyArray<Drop | Reward>, title?: string): Promise<void> {
  return new Promise((resolve) => {
    const n = drops.length;
    const cards = drops.map(rewardCard);
    const list = h('div', { class: `rwds${n === 1 ? ' one' : n > 3 ? ' many' : ''}` }, ...cards);
    // sparkles around the cards (fixed spots, staggered)
    [[4, 8], [92, 4], [14, 78], [84, 70], [48, -4], [70, 30], [28, 36], [96, 44]].forEach(([x, y], i) =>
      list.append(h('i', { class: 'spk', style: { left: `${x}%`, top: `${y}%`, animationDelay: `${i * 0.23}s` } })));
    const timers: number[] = [];
    const m = modal(ctx, [list], {
      title: title ?? tr({ ru: 'Получено!', en: 'You got!' }),
      cls: n > 3 ? 'gold wide many' : 'gold wide',
      foot: [btn(tr({ ru: 'Забрать', en: 'Collect' }), () => m.close(), 'green big')],
      onClose: () => { timers.forEach(clearTimeout); resolve(); },
    });
    cards.forEach((c, i) => timers.push(window.setTimeout(() => { c.classList.add('in'); sfx('reveal'); }, 180 + i * 380)));
  });
}

// ---------------------------------------------------------------- currency bar

type Cur = 'coins' | 'gems';
interface ChipState { chip: HTMLElement; num: HTMLElement; plus: HTMLButtonElement; shown: number; target: number; raf: number }
const bars = new WeakMap<Ctx, TopBar>();

/** currency bar (coins, gems with "+" → shop) shown over menu screens, top-right of the top layer */
export class TopBar {
  el!: HTMLElement;
  private _ctx: Ctx;
  private _c: Record<Cur, ChipState>;
  private _shop: boolean | null = null;
  constructor(ctx: Ctx) {
    this._ctx = ctx;
    const mk = (kind: Cur): ChipState => {
      const num = h('b', null, '0');
      const plus = btn(icon('plus'), () => ctx.nav.shop(kind), 'green icon small');
      plus.setAttribute('aria-label', tr({ ru: 'Купить', en: 'Buy' }));
      const chip = h('div', { class: 'chip ia' }, icon(kind === 'coins' ? 'coin' : 'gem'), num, plus);
      return { chip, num, plus, shown: -1, target: -1, raf: 0 };
    };
    this._c = { coins: mk('coins'), gems: mk('gems') };
    this.el = h('div', { class: 'topbar' }, this._c.coins.chip, this._c.gems.chip);
    this.el.addEventListener('pointerdown', stop);
    layer(ctx, 'top').append(this.el);
    bars.set(ctx, this);
    this.update();
  }
  /** re-read coins/gems (counts up/down with a bump when changed) and the shop lock */
  update(): void {
    const s = this._ctx.save;
    for (const kind of ['coins', 'gems'] as const) {
      const c = this._c[kind], v = Math.max(0, Math.floor(s[kind] || 0));
      if (v === c.target) continue;
      const first = c.target < 0;
      c.target = v;
      if (first || reducedMotion() || !this.visible) { c.shown = v; setText(c.num, fmtNum(v)); continue; }
      this._tween(c, v > c.shown);
    }
    let open = false;
    try { open = isUnlocked(s, 'shop'); } catch { open = false; }
    if (open !== this._shop) {
      this._shop = open;
      this._c.coins.plus.classList.toggle('hidden', !open);
      this._c.gems.plus.classList.toggle('hidden', !open);
    }
  }
  show(on: boolean): void { this.el.classList.toggle('hidden', !on); }
  get visible(): boolean { return !this.el.classList.contains('hidden'); }
  /** the chip of a currency (target for flyCurrency / tutorial pointing) */
  chip(kind: Cur): HTMLElement { return this._c[kind].chip; }

  private _tween(c: ChipState, up: boolean) {
    cancelAnimationFrame(c.raf);
    const from = c.shown, to = c.target, t0 = performance.now(), dur = 550;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / dur);
      c.shown = Math.round(from + (to - from) * (1 - (1 - k) * (1 - k)));
      setText(c.num, fmtNum(c.shown));
      if (k < 1) c.raf = requestAnimationFrame(step);
    };
    c.raf = requestAnimationFrame(step);
    c.chip.animate?.([{ transform: 'scale(1)' }, { transform: 'scale(1.16)' }, { transform: 'scale(1)' }], { duration: 320, easing: 'ease-out' });
    c.num.animate?.([{ color: up ? '#7ee26a' : '#ff6b5e' }, { color: '#fff' }], { duration: 700 });
  }
}

/**
 * Coin/gem icons flying from an element (or a client point) to the TopBar chip; resolves when the last one lands.
 * No-op (resolves at once) without a visible TopBar or with reduced motion. Update the save + ctx.refresh() yourself.
 */
export function flyCurrency(ctx: Ctx, kind: Cur, from: HTMLElement | { x: number; y: number }, count = 8): Promise<void> {
  const bar = bars.get(ctx);
  if (!bar || !bar.visible || reducedMotion()) return Promise.resolve();
  const lay = layer(ctx, 'toast'), lr = lay.getBoundingClientRect();
  const fr = 'getBoundingClientRect' in from ? from.getBoundingClientRect() : null;
  const ax = (fr ? fr.left + fr.width / 2 : (from as { x: number }).x) - lr.left, ay = (fr ? fr.top + fr.height / 2 : (from as { y: number }).y) - lr.top;
  const tg = bar.chip(kind).firstElementChild!.getBoundingClientRect();
  const bx = tg.left + tg.width / 2 - lr.left, by = tg.top + tg.height / 2 - lr.top;
  return new Promise((res) => {
    let left = count;
    for (let i = 0; i < count; i++) {
      const el = icon(kind === 'coins' ? 'coin' : 'gem');
      el.classList.add('fly');
      el.style.left = `${ax}px`;
      el.style.top = `${ay}px`;
      lay.append(el);
      const a = (i / count) * Math.PI * 2, r = 30 + (i % 3) * 18;
      const anim = el.animate([
        { transform: 'translate(0,0) scale(.5)', opacity: 0 },
        { transform: `translate(${Math.cos(a) * r}px,${Math.sin(a) * r}px) scale(1.1)`, opacity: 1, offset: 0.3 },
        { transform: `translate(${bx - ax}px,${by - ay}px) scale(.8)`, opacity: 1 },
      ], { duration: 650 + i * 30, delay: i * 50, easing: 'cubic-bezier(.45,0,.75,.55)', fill: 'forwards' });
      anim.onfinish = () => {
        el.remove();
        if (--left > 0) return;
        sfx(kind === 'coins' ? 'coin' : 'gem');
        bar.chip(kind).animate?.([{ transform: 'scale(1)' }, { transform: 'scale(1.2)' }, { transform: 'scale(1)' }], { duration: 260 });
        res();
      };
    }
  });
}
