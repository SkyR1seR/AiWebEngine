// Tutorial UI (owner: ui-core): Нубик's coach bubbles with a pointing hand, new-obstacle intro cards, feature unlock popups.
import { h } from 'aiwebengine/ui';
import type { Ctx, Feature, Loc, ObstacleKind } from './types';
import { addCSS } from './theme';
import { avatar, btn, fitText, icon, layer, modal, attention } from './widgets';
import { Pix, iconURL, shade, text3, type IconId } from './textures';
import { featureName } from './unlocks';
import { sfx } from './audio';
import { tr } from './i18n';

export interface Coach {
  /** remove the bubble */
  close(): void;
}

/** menu icon of each feature (menu buttons, unlock popups) */
export const FEATURE_ICON: Record<Feature, IconId> = { upgrades: 'up', wardrobe: 'shirt', daily: 'calendar', cases: 'gift', shop: 'cart' };

const CSS = `
.co{position:absolute;left:0;right:0;z-index:2;display:flex;justify-content:center;padding:0 20u;pointer-events:none}
.co.top{top:calc(var(--top) + 14u)}.co.bottom{bottom:36u}.co.center{top:50%;transform:translateY(-50%)}
.co-b{display:flex;align-items:flex-end;max-width:min(100%,860u);animation:pop .25s ease-out}
.co-b>.ava{width:116u;height:116u;margin-bottom:-6u}
.co-say{position:relative;display:flex;flex-direction:column;gap:6u;min-width:0;text-align:left;margin-left:26u;padding:12u 22u 16u;color:#15223f;text-shadow:none;
background:#f4f8ff;box-shadow:inset 0 -6u 0 #c4d4ea,0 0 0 3u var(--ol),0 9u 0 rgba(0,0,0,.3)}
.co-say::before,.co-say::after{content:'';position:absolute;bottom:22u;width:27u;height:30u;clip-path:polygon(100% 0,0 60%,100% 100%)}
.co-say::before{left:-27u;background:var(--ol)}.co-say::after{left:-21u;bottom:25u;width:21u;height:24u;background:#f4f8ff}
.co-nm{font-size:20u;font-weight:700;color:#2f7ddf}
.co-tx{margin:0;font-size:28u;font-weight:700;line-height:1.25;overflow-wrap:break-word;hyphens:auto}
.co-say>.btn{align-self:flex-end;margin-top:6u}
.co-bk{position:absolute;inset:0;z-index:1;pointer-events:auto;background:rgba(3,8,22,.55);animation:fade .2s}
.co-bk.spot{background:none}
.co-hole{position:absolute;pointer-events:none;box-shadow:0 0 0 300vmax rgba(3,8,22,.55)}
.hand{position:absolute;z-index:3;width:96u;height:96u;background:var(--hand) center/contain no-repeat;pointer-events:none;filter:drop-shadow(0 6u 0 rgba(0,0,0,.35))}
.hand.tap{left:0;top:0;animation:htap .9s ease-in-out infinite}
@keyframes htap{0%,100%{translate:0 0;scale:1}50%{translate:-6u 14u;scale:.9}}
.co-drag{position:absolute;left:50%;bottom:20%;z-index:2;width:min(520u,80%);height:0;transform:translateX(-50%);pointer-events:none}
.co-drag::before{content:'';position:absolute;left:0;right:0;top:-5u;height:10u;background:repeating-linear-gradient(90deg,rgba(255,255,255,.8) 0 18u,transparent 18u 32u);filter:drop-shadow(0 3u 0 rgba(0,0,0,.4))}
.co-drag>.ic{position:absolute;top:-24u;width:48u;height:48u}
.co-drag>.ic:first-child{left:-56u;transform:scaleX(-1)}.co-drag>.ic:nth-child(2){right:-56u}
.co-drag>.hand{left:50%;top:-10u;margin-left:-36u;animation:hdrag 1.7s ease-in-out infinite}
@keyframes hdrag{0%,100%{transform:translateX(min(-200u,-38vw)) rotate(-10deg)}50%{transform:translateX(min(200u,38vw)) rotate(10deg)}}
.co-keys{position:absolute;left:50%;top:-110u;transform:translateX(-50%);display:none;gap:12u}
.co-keys>b{display:inline-flex;align-items:center;justify-content:center;min-width:54u;height:54u;padding:0 10u;font-size:26u;color:#15223f;text-shadow:none;
background:#e9f0fa;box-shadow:inset 0 -6u 0 #a9bbd3,0 0 0 3u var(--ol)}
@media (hover:hover) and (pointer:fine){.co-keys{display:flex}}
.ic-art{display:flex;align-items:center;justify-content:center;width:min(300u,70vw);aspect-ratio:4/3;padding:10u;background:#0d1a33;
box-shadow:inset 0 0 0 4u rgba(255,255,255,.18),0 0 0 3u var(--ol),0 9u 0 rgba(0,0,0,.3)}
.ic-art>img{width:100%;height:100%;image-rendering:pixelated}
.ic-nm{font-size:40u;font-weight:700;color:#9fe0ff;text-shadow:var(--tol2)}
.ic-rule{width:600u;max-width:100%;font-size:28u;hyphens:manual}
.up-art{position:relative;isolation:isolate;display:flex;align-items:center;justify-content:center;width:220u;height:180u}
.up-art>.ic{width:140u;height:140u;animation:pop .5s cubic-bezier(.2,1.6,.4,1)}
.up-art>.rays{top:50%}
.up-tx{width:600u;max-width:100%;font-size:28u;hyphens:manual}
`;
const css = () => addCSS('tutorial', CSS);

const handURL = () => `url(${iconURL('hand')})`;

/**
 * Speech bubble from Нубик (portrait + text) with an optional animated hand:
 * 'drag' (swipe left-right, race start), 'tap' pointing at `target` (menu buttons). Non-blocking unless `modal`.
 * A modal coach dims the screen (with a spotlight on `target`; taps on the target still reach it) and always has an
 * OK button (okLabel, default «Понятно!»). onOk runs when OK is pressed (the bubble closes itself). A tap forwarded to
 * the target does NOT close the coach: close it from the target's handler (e.g. when the screen it opens shows).
 * where: default 'top', or the side away from `target`.
 */
export function coach(ctx: Ctx, text: string, opts: { hand?: 'drag' | 'tap'; target?: HTMLElement; modal?: boolean; okLabel?: string; onOk?: () => void; where?: 'top' | 'bottom' | 'center' } = {}): Coach {
  css();
  const lay = layer(ctx, 'modal'), top = layer(ctx, 'toast');
  const parts: HTMLElement[] = [];
  let raf = 0, closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    cancelAnimationFrame(raf);
    parts.forEach((p) => p.remove());
    if (opts.target) attention(opts.target, false);
  };

  // backdrop (modal): blocks input; with a target, a spotlight hole whose taps are forwarded to the target
  let hole: HTMLElement | null = null;
  if (opts.modal) {
    const bk = h('div', { class: `co-bk${opts.target ? ' spot' : ''}` });
    if (opts.target) bk.append((hole = h('div', { class: 'co-hole' })));
    const stop = (e: Event) => e.stopPropagation();
    bk.addEventListener('pointerdown', stop);
    bk.addEventListener('click', (e) => {
      e.stopPropagation();
      const r = opts.target?.getBoundingClientRect();
      if (r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) opts.target!.click();
    });
    lay.append(bk);
    parts.push(bk);
  }

  // the bubble
  const say = h('div', { class: 'co-say' }, h('div', { class: 'co-nm' }, tr({ ru: 'Нубик', en: 'Noob' })), h('p', { class: 'co-tx' }, text));
  if (opts.okLabel || opts.onOk || opts.modal) {
    say.append(btn(opts.okLabel ?? tr({ ru: 'Понятно!', en: 'Got it!' }), () => { close(); opts.onOk?.(); }, 'green small'));
  }
  // default place: away from the target (target low on the screen → bubble on top, and vice versa)
  let where = opts.where;
  if (!where) where = opts.target && opts.target.getBoundingClientRect().top < innerHeight * 0.45 ? 'bottom' : 'top';
  const box = h('div', { class: `co ${where}` }, h('div', { class: 'co-b' }, avatar('noob', 116), say));
  lay.append(box);
  parts.push(box);

  // the hand
  if (opts.hand === 'drag') {
    const hand = h('i', { class: 'hand' });
    hand.style.setProperty('--hand', handURL());
    const keys = h('div', { class: 'co-keys' }, h('b', null, '◄'), h('b', null, 'A'), h('b', null, 'D'), h('b', null, '►'));
    const d = h('div', { class: 'co-drag' }, icon('next', 48), icon('next', 48), hand, keys);
    lay.append(d);
    parts.push(d);
  }
  let hand: HTMLElement | null = null;
  if (opts.hand === 'tap' && opts.target) {
    attention(opts.target, true);
    hand = h('i', { class: 'hand tap' });
    hand.style.setProperty('--hand', handURL());
    top.append(hand);
    parts.push(hand);
  }
  // follow the target with the hand / spotlight (it may move: layout changes, scrolling); DOM only when its rect changes
  const t = opts.target;
  if (t && (hand || hole)) {
    let key = '';
    const follow = () => {
      raf = requestAnimationFrame(follow);
      const r = t.getBoundingClientRect(), lr = top.getBoundingClientRect();
      const k = `${r.left | 0},${r.top | 0},${r.width | 0},${r.height | 0}`;
      if (k === key) return;
      key = k;
      if (hand) {
        // the fingertip is at ~37% of the icon width, top edge: put it a bit below the target's center
        const x = r.left + r.width / 2 - lr.left - (hand.offsetWidth || 96) * 0.37, y = r.top + r.height * 0.62 - lr.top;
        hand.style.transform = `translate(${x}px,${y}px)`;
        hand.classList.toggle('hidden', r.width === 0);
      }
      if (hole) Object.assign(hole.style, { left: `${r.left - lr.left - 10}px`, top: `${r.top - lr.top - 10}px`, width: `${r.width + 20}px`, height: `${r.height + 20}px` });
    };
    follow();
  }
  return { close };
}

// ---------------------------------------------------------------- new obstacle intro cards

/** what an intro card can introduce: obstacle kinds and the special surfaces (level.SURF_LEVEL) */
export type IntroKind = ObstacleKind | 'boost' | 'ice' | 'thaw' | 'salt';

/** name + one-line rule of every intro card (Loc pairs: translated by tr() at show time) */
const INTRO: Record<IntroKind, { name: Loc; rule: Loc }> = {
  wall: {
    name: { ru: 'Ледяная стена', en: 'Ice wall' },
    rule: { ru: 'Число на стене — какой нужен ком. Ком побольше пробьёт её!', en: 'The number shows the snowball size you need. A bigger snowball smashes through!' },
  },
  spikes: {
    name: { ru: 'Ледяные шипы', en: 'Ice spikes' },
    rule: { ru: 'Маленький ком о них разобьётся, а большой — сломает шипы.', en: 'A small snowball shatters on them, a big one breaks them.' },
  },
  fire: {
    name: { ru: 'Костёр', en: 'Bonfire' },
    rule: { ru: 'Огонь растапливает ком! Только огромный ком потушит костёр.', en: 'Fire melts your snowball! Only a huge one can put it out.' },
  },
  hammer: {
    name: { ru: 'Молот-маятник', en: 'Swinging hammer' },
    rule: { ru: 'Его не сломать. Проскочи, когда он качнётся в сторону.', en: "It can't be broken. Slip past when it swings away." },
  },
  pusher: {
    name: { ru: 'Подарок-толкач', en: 'Sliding gift box' },
    rule: { ru: 'Ездит туда-сюда. Объезжай или пробей большим комом.', en: 'It slides back and forth. Go around or smash it with a big snowball.' },
  },
  plow: {
    name: { ru: 'Снегоуборщик', en: 'Snowplow' },
    rule: { ru: 'Едет поперёк трассы, и его не сломать. Пропусти его!', en: "It drives across the track and can't be broken. Let it pass!" },
  },
  icicle: {
    name: { ru: 'Сосульки', en: 'Falling icicles' },
    rule: { ru: 'Тень на снегу — сейчас упадёт сосулька. Отойди в сторону!', en: 'A shadow on the snow means an icicle is about to fall. Step aside!' },
  },
  gap: {
    name: { ru: 'Полынья', en: 'Ice hole' },
    rule: { ru: 'Большой ком заткнёт дыру и станет мостом. Маленький — утонет!', en: 'A big snowball plugs the hole and becomes a bridge. A small one sinks!' },
  },
  bonus: {
    name: { ru: 'Бонусные стены', en: 'Bonus walls' },
    rule: { ru: 'После финиша каждая пробитая стена умножает награду!', en: 'After the finish, every wall you smash multiplies your reward!' },
  },
  boost: {
    name: { ru: 'Ускорители', en: 'Boost pads' },
    rule: { ru: 'Синие стрелки на трассе дают рывок вперёд!', en: 'Blue arrows on the track give you a burst of speed!' },
  },
  ice: {
    name: { ru: 'Каток', en: 'Ice patch' },
    rule: { ru: 'На льду быстро и скользко, но ком не растёт.', en: "Ice is fast and slippery, but your snowball doesn't grow there." },
  },
  thaw: {
    name: { ru: 'Проталины', en: 'Thawed ground' },
    rule: { ru: 'На проталинах ком тает. Держись снега!', en: 'Your snowball melts on bare ground. Stay on the snow!' },
  },
  salt: {
    name: { ru: 'Соль', en: 'Salt' },
    rule: { ru: 'Соль очень быстро растапливает ком — объезжай её!', en: 'Salt melts your snowball very fast. Steer around it!' },
  },
};
/** localized name and rule of an intro card */
export function introInfo(kind: IntroKind): { name: string; rule: string } {
  const t = INTRO[kind] ?? INTRO.wall;
  return { name: tr(t.name), rule: tr(t.rule) };
}

// --- pixel art of an intro card (40x30 scene, upscaled), cached as data URLs
const OL = 0x0b0e1a;
const W = 40, H = 30, GROUND = 21;
function scene(): Pix {
  const p = new Pix(W, H);
  for (let y = 0; y < GROUND; y++) p.rect(0, y, W, 1, mixc(0x1b3a73, 0x6d8fc7, y / GROUND));
  for (let y = GROUND; y < H; y++) for (let x = 0; x < W; x++) p.set(x, y, (x * 7 + y * 13) % 11 === 0 ? 0xc9daf0 : y === GROUND ? 0xffffff : 0xeef4fb);
  // distant snowy hills + a few stars
  for (let x = 0; x < W; x++) { const t = GROUND - 3 - Math.round(2 * Math.sin(x / 5) + Math.sin(x / 2.3)); p.rect(x, t, 1, GROUND - t, 0xb8cde8); }
  for (const [x, y] of [[4, 3], [17, 2], [31, 5], [36, 1], [11, 7]]) p.set(x, y, 0xffffff);
  return p;
}
function mixc(a: number, b: number, t: number): number {
  const m = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (m(16) << 16) | (m(8) << 8) | m(0);
}
/** shaded snowball */
function ball(p: Pix, cx: number, cy: number, r: number) {
  p.disc(cx, cy, r + 1, OL);
  p.disc(cx, cy, r, (x, y) => { const l = -((x + 0.5 - cx) * 0.6 + (y + 0.5 - cy) * 0.8) / r; return l > 0.35 ? 0xffffff : l < -0.45 ? 0xa9c2de : 0xe6eef8; });
}
/** ice block wall (x, y, w, h) with seams */
function iceWall(p: Pix, x: number, y: number, w: number, hh: number, col = 0x8fd3f5) {
  p.rect(x - 1, y - 1, w + 2, hh + 2, OL).rect(x, y, w, hh, col);
  for (let j = y; j < y + hh; j++) for (let i = x; i < x + w; i++) {
    if ((j - y) % 5 === 4 || (i - x + ((j - y) / 5 | 0) * 3) % 8 === 7) p.set(i, j, shade(col, 0.78));
    else if ((i + j) % 9 === 0) p.set(i, j, 0xeefaff);
  }
  p.rect(x, y, w, 1, 0xeefaff).rect(x, y - 1, w, 1, 0xffffff);
}
function plate(p: Pix, cx: number, y: number, s: string, fg = 0x1d4f91, bg = 0xffffff) {
  const w = s.length * 4 + 1;
  p.rect(cx - (w >> 1) - 1, y - 1, w + 2, 9, OL).rect(cx - (w >> 1), y, w, 7, bg);
  let x = cx - (w >> 1) + 1;
  for (const c of s) {
    if (c === 'x') { p.set(x, y + 2, fg).set(x + 2, y + 2, fg).set(x + 1, y + 3, fg).set(x, y + 4, fg).set(x + 2, y + 4, fg); x += 4; }
    else x += text3(p, c, x, y + 1, fg) + 2;
  }
}
/** white arrow heads pointing left at x0 and right at x1 (row y) */
function arrowsLR(p: Pix, y: number, x0: number, x1: number) {
  for (let k = 0; k < 3; k++) {
    p.rect(x0 + k, y - k, 1, 1 + 2 * k, 0xffffff).rect(x1 - k, y - k, 1, 1 + 2 * k, 0xffffff);
  }
  p.rect(x0 + 3, y, 2, 1, 0xffffff).rect(x1 - 4, y, 2, 1, 0xffffff);
}

const ART: Record<IntroKind, (p: Pix) => void> = {
  wall: (p) => {
    iceWall(p, 5, 6, 30, 17);
    plate(p, 20, 11, '8');
    ball(p, 9, 25, 4);
  },
  spikes: (p) => {
    for (let i = 0; i < 6; i++) {
      const x = 4 + i * 6, hgt = 9 + ((i * 5) % 4) * 2;
      p.poly([x - 1, GROUND + 3, x + 3, GROUND + 3 - hgt - 1, x + 7, GROUND + 3], OL);
      p.poly([x, GROUND + 2, x + 3, GROUND + 3 - hgt, x + 6, GROUND + 2], (xx) => (xx < x + 3 ? 0xeefaff : 0x8fd3f5));
    }
  },
  fire: (p) => {
    p.rect(9, 22, 22, 4, OL).rect(10, 23, 20, 2, 0x8a5a2b).rect(14, 21, 12, 4, OL).rect(15, 22, 10, 2, 0xa56d36);
    p.poly([11, 23, 15, 8, 20, 14, 23, 4, 28, 13, 30, 23], OL);
    p.poly([12, 22, 15, 10, 20, 15, 23, 6, 27, 14, 29, 22], 0xff7a1a);
    p.poly([15, 22, 18, 13, 21, 17, 23, 11, 26, 22], 0xffc93a);
    p.poly([18, 22, 21, 17, 24, 22], 0xfff3a6);
  },
  hammer: (p) => {
    p.rect(0, 0, W, 4, OL).rect(0, 1, W, 2, 0x8c919b).rect(0, 1, W, 1, 0xc3c8d0);
    p.rect(17, 3, 7, 4, OL).rect(18, 3, 5, 3, 0x5d626b);
    // wooden arm from the pivot to the head (swung to the right), then the stone head
    for (let i = 0; i <= 20; i++) { const x = Math.round(20.5 + 9 * i / 20), y = Math.round(5 + 10 * i / 20); p.rect(x - 1, y - 1, 3, 3, OL); }
    for (let i = 0; i <= 20; i++) { const x = Math.round(20.5 + 9 * i / 20), y = Math.round(5 + 10 * i / 20); p.set(x, y, 0xa56d36); }
    p.rect(22, 12, 15, 11, OL).rect(23, 13, 13, 9, 0x9aa4ad).rect(23, 13, 13, 2, 0xdfe5ec).rect(23, 20, 13, 2, 0x5d626b).rect(35, 13, 1, 9, 0x5d626b);
    // motion trail on the left: where it swings next
    for (let a = 0; a < 10; a++) { const t = -1.1 + a * 0.13; if (a % 2) p.rect(Math.round(20.5 + 15 * Math.sin(t)), Math.round(4 + 15 * Math.cos(t)), 2, 1, 0xffffff); }
    ball(p, 7, 25, 3);
  },
  pusher: (p) => {
    p.rect(13, 8, 14, 15, OL).rect(14, 9, 12, 13, 0xd4413a).rect(19, 9, 2, 13, 0xffd447).rect(14, 14, 12, 2, 0xffd447);
    p.rect(14, 9, 12, 1, 0xff8f80);
    p.rect(16, 6, 3, 3, OL).rect(21, 6, 3, 3, OL).rect(17, 7, 1, 1, 0xffd447).rect(22, 7, 1, 1, 0xffd447);
    arrowsLR(p, 15, 7, 32);
  },
  plow: (p) => {
    p.rect(9, 9, 13, 13, OL).rect(10, 10, 11, 7, 0xff9a2e).rect(12, 11, 7, 4, 0x9fe0ff);
    p.rect(8, 15, 22, 7, OL).rect(9, 16, 20, 5, 0xffb31a).rect(9, 16, 20, 1, 0xffe47e);
    p.poly([29, 11, 35, 9, 35, 24, 29, 22], OL).poly([30, 12, 34, 10, 34, 23, 30, 21], 0xc3c8d0);
    ball(p, 12, 23, 2.5); ball(p, 25, 23, 2.5);
    p.disc(12, 23, 2.5, 0x2a2d3a); p.disc(25, 23, 2.5, 0x2a2d3a);
    for (const [x, y] of [[37, 14], [38, 18], [36, 7], [38, 11]]) p.set(x, y, 0xffffff);
  },
  icicle: (p) => {
    p.rect(0, 0, W, 4, OL).rect(0, 0, W, 3, 0xd9eefa);
    for (let i = 0; i < 6; i++) { const x = 2 + i * 7, l = 4 + ((i * 3) % 4); if (i === 3) continue; p.poly([x - 1, 3, x + 2, 3 + l, x + 4, 3], OL).poly([x, 3, x + 2, 2 + l, x + 3, 3], 0x9fe0ff); }
    p.poly([21, 9, 23, 19, 25, 9], OL).poly([22, 9, 23, 18, 24, 9], 0xeefaff);
    for (let x = 16; x <= 30; x++) for (let y = 24; y <= 27; y++) if (((x - 23) / 7) ** 2 + ((y - 25.5) / 2) ** 2 <= 1) p.set(x, y, 0x7d93b4);
    p.set(23, 21, 0xffffff).set(22, 20, 0xffffff).set(24, 20, 0xffffff);
  },
  gap: (p) => {
    for (let x = 5; x <= 34; x++) for (let y = 21; y <= 29; y++) {
      const q = ((x - 20) / 15) ** 2 + ((y - 25) / 4.2) ** 2;
      if (q <= 1) p.set(x, y, q > 0.7 ? 0x8fd3f5 : q > 0.45 ? 0x1f6fb2 : (x + y) % 5 === 0 ? 0x3b8fd8 : 0x0d3b66);
    }
    ball(p, 31, 15, 6);
  },
  bonus: (p) => {
    iceWall(p, 2, 7, 11, 15, 0xffd447); iceWall(p, 15, 5, 11, 17, 0xffb31a); iceWall(p, 28, 3, 11, 19, 0xff9a2e);
    plate(p, 7, 11, 'x2', 0x9a6406); plate(p, 20, 9, 'x3', 0x9a6406); plate(p, 33, 7, 'x5', 0x9a6406);
  },
  boost: (p) => {
    p.rect(12, 21, 16, 9, OL).rect(13, 21, 14, 9, 0x2f7ddf);
    // chevrons pointing forward (up the track)
    for (const y0 of [22, 26]) for (let k = 0; k < 4; k++) p.rect(16 + k, y0 + 3 - k, 1, 1, 0xffffff).rect(23 - k, y0 + 3 - k, 1, 1, 0xffffff);
    ball(p, 20, 14, 5);
    for (const y of [9, 12, 15]) p.rect(9, y, 4, 1, 0xffffff).rect(27, y, 4, 1, 0xffffff);
  },
  ice: (p) => {
    for (let x = 3; x < 37; x++) for (let y = 21; y < 30; y++) p.set(x, y, (x - y * 2) % 9 === 0 ? 0xffffff : (x + y) % 4 === 0 ? 0xbfeaff : 0x8fd3f5);
    ball(p, 20, 15, 5);
    for (const y of [12, 15, 18]) p.rect(28, y, 6, 1, 0xffffff);
  },
  thaw: (p) => {
    for (let x = 4; x < 36; x++) for (let y = 21; y < 30; y++) {
      const q = ((x - 20) / 16) ** 2 + ((y - 25) / 5) ** 2;
      if (q <= 1) p.set(x, y, q > 0.75 ? 0x6b4a2b : (x * 3 + y) % 7 === 0 ? 0x4f9a3a : q < 0.25 ? 0x4a7fb0 : 0x5a3d22);
    }
    ball(p, 20, 15, 5);
    for (const [x, y] of [[13, 10], [27, 11], [15, 20], [26, 20]]) p.rect(x, y, 1, 2, 0x9fe0ff);
  },
  salt: (p) => {
    for (let x = 4; x < 36; x++) for (let y = 21; y < 30; y++) {
      const q = ((x - 20) / 16) ** 2 + ((y - 25) / 5) ** 2;
      if (q <= 1) p.set(x, y, (x * 7 + y * 3) % 5 === 0 ? 0xffffff : (x + y * 2) % 7 === 0 ? 0xffc6d6 : 0x9aa4ad);
    }
    ball(p, 20, 14, 5);
    for (const [x, y] of [[12, 12], [28, 13], [14, 19], [27, 19]]) p.rect(x, y, 1, 2, 0x9fe0ff);
  },
};
/** paint the 40x30 pixel scene of an intro card (pure, no DOM) */
export function paintIntro(kind: IntroKind): Pix {
  const p = scene();
  (ART[kind] ?? ART.wall)(p);
  return p;
}
const arts = new Map<IntroKind, string>();
/** data URL of an intro card picture (40x30 pixel scene, 6x) */
export function introArtURL(kind: IntroKind): string {
  let s = arts.get(kind);
  if (!s) {
    s = paintIntro(kind).canvas(6).toDataURL();
    arts.set(kind, s);
  }
  return s;
}

/** card before a race introducing a new obstacle kind (art + name + one-line rule); resolves on "OK" / X */
export function introCard(ctx: Ctx, kind: IntroKind): Promise<void> {
  css();
  const t = introInfo(kind);
  const surface = kind === 'boost' || kind === 'ice' || kind === 'thaw' || kind === 'salt';
  sfx('bell');
  return new Promise((res) => {
    const nm = h('div', { class: 'ic-nm' }, t.name);
    const m = modal(ctx, [
      h('div', { class: 'ic-art' }, h('img', { src: introArtURL(kind), alt: '', draggable: 'false' })),
      nm,
      h('p', { class: 'txt ic-rule' }, t.rule),
    ], {
      title: surface ? tr({ ru: 'Новое на трассе!', en: 'New on the track!' }) : tr({ ru: 'Новое препятствие!', en: 'New obstacle!' }),
      cls: 'ice',
      foot: [btn(tr({ ru: 'Понятно!', en: 'Got it!' }), () => m.close(), 'green big')],
      onClose: () => res(),
    });
    fitText(nm, 2, 0.6);
  });
}

// ---------------------------------------------------------------- feature unlock popup

function featureDesc(f: Feature): string {
  switch (f) {
    case 'upgrades': return tr({ ru: 'Прокачивай скорость, липкость снега и броню кома. Первое улучшение — бесплатно!', en: 'Boost your speed, sticky snow and snowball armor. The first upgrade is free!' });
    case 'wardrobe': return tr({ ru: 'Наряжай Нубика в новогодние костюмы! Там тебя ждёт подарок.', en: 'Dress Noob up in festive costumes! A gift is waiting for you there.' });
    case 'daily': return tr({ ru: 'Заходи каждый день и забирай новогодние подарки.', en: 'Come back every day to collect holiday gifts.' });
    case 'cases': return tr({ ru: 'Открывай подарки с костюмами и комами. Первый — бесплатно!', en: 'Open gifts with costumes and snowballs. The first one is free!' });
    default: return tr({ ru: 'Кристаллы, наборы и выгодные предложения.', en: 'Gems, bundles and great deals.' });
  }
}

/** "Unlocked: Gifts!" popup for a feature; resolves true if the player chose to open it now («Посмотреть») */
export function unlockPopup(ctx: Ctx, f: Feature): Promise<boolean> {
  css();
  sfx('levelup');
  return new Promise((res) => {
    let go = false;
    const name = featureName(f);
    const m = modal(ctx, [
      h('div', { class: 'up-art' }, h('div', { class: 'rays' }), icon(FEATURE_ICON[f], 140)),
      h('p', { class: 'txt up-tx' }, featureDesc(f)),
    ], {
      title: tr({ ru: `Открыто: ${name}!`, en: `Unlocked: ${name}!` }),
      cls: 'gold',
      foot: [
        btn(tr({ ru: 'Позже', en: 'Later' }), () => m.close()),
        btn(tr({ ru: 'Посмотреть', en: 'Take a look' }), () => { go = true; m.close(); }, 'green big'),
      ],
      onClose: () => res(go),
    });
  });
}
