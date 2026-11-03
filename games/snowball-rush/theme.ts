// Blocky pixel UI theme (owner: ui-base): font faces, all shared CSS (buttons, snowy panels, cards, tabs, badges, chips,
// bars, modals, toasts, garland...), UI layers and the UI scale. Widgets that build this markup live in widgets.ts.
//
// CSS is written with a `u` unit: `12u` → calc(var(--u)*12px) (see cssU). --u = clamp(min(W, H) / 720, 0.4, 2.5), so a
// portrait screen is >= 720u wide and a landscape one >= 720u tall. Pixel art (frames, snow caps, garland bulbs, noise) is
// drawn once at applyTheme() into tiny canvases and used as data URLs (CSS variables on .ui-root).
//
// Class cheat sheet (all inside ui.root; see widgets.ts for builders):
//   layers   .lay .lay-hud(z1) .lay-screen(z5) .lay-top(z8) .lay-modal(z10) .lay-toast(z12) — pointer-events: none on the
//            layer; buttons, .ia, .panel, .scroll, .screen, .mback get auto (add .ia to make any other element clickable)
//   panels   .panel (wooden frame + snow cap) [.stone .ice .gold frames] [.nosnow], .garland (blinking bulbs strip),
//            .screen > .panel > .tbar(.ttl) .phead .pbody ; modal: .mback > .panel.modal[.wide] > .mhead .mbody .mfoot .xbtn
//   buttons  .btn [.green .blue .gold .red .ad] [.small .big .icon] [.locked] [.tab] (:disabled, .busy)
//   items    .card [.r-common .r-rare .r-epic .r-legendary .r-coins .r-gems] [.sel .lockd .dim .tap] > .art .nm ;
//            .rbadge, .badge [.sale .new .hit .info] [.r], .ndot, .attn (pulsing ring), .chip, .timer, .money, .ic, .ava
//   bars     .pbar (> b fill, > span label; --seg segments, --pc color)
//   layout   .row .col .wrap .center .grow .gap-s .gap-l .grid(--cw) .scroll .well .li .sep .rel .hidden
//   text     .t-xs .t-s .t-m .t-l .t-xl .t-xxl .b .ttl .ol .txt .sub .c-gold .c-good .c-bad .c-dim .c-ice
import type { Game } from 'aiwebengine';
import type { UI } from 'aiwebengine/ui';
import type { Rarity } from './types';
import { SYSTEM_FONT_LANGS } from './i18n';
import { Pix, iconURL, shade } from './textures';
import { rng } from './util';

/** CSS font-family of the game UI (pass to new UI(game, { font: FONT })) */
export const FONT = "'Pixelify Sans',system-ui,sans-serif";
/** rarity frame colors (DESIGN §7) */
export const RARITY_COLOR: Record<Rarity, string> = { common: '#9aa4ad', rare: '#3f8cff', epic: '#b350ff', legendary: '#ffb31a' };
/** shared UI colors (for inline styles / canvas drawing in other modules) */
export const COLORS = {
  outline: '#0b0e1a', text: '#ffffff', dim: '#a9bdd6', gold: '#ffd447', good: '#7ee26a', bad: '#ff6b5e', ice: '#9fe0ff',
  panel: '#12285a', green: '#3faa3a', blue: '#2f7ddf', red: '#d4413a', purple: '#8a4fdf',
} as const;

/** UI scale for a screen size: clamp(min(W, H) / 720, 0.4, 2.5) */
export function uiScale(w: number, h: number): number {
  return Math.min(2.5, Math.max(0.4, Math.min(w, h) / 720));
}

/** convert the `12u` / `-3u` / `.5u` unit of our CSS sources into calc(var(--u)*Npx) */
export function cssU(css: string): string {
  return css.replace(/(^|[^\w.#-])(-?(?:\d+\.?\d*|\.\d+))u\b/g, '$1calc(var(--u)*$2px)');
}

/**
 * Inject a stylesheet once (by id), with the `u` unit (cssU). For module-specific CSS of screens built on this theme:
 *   addCSS('hud', `.hud-place{font-size:60u;text-shadow:var(--tol)}`)
 */
export function addCSS(id: string, css: string): void {
  if (typeof document === 'undefined' || document.getElementById('css-' + id)) return;
  const el = document.createElement('style');
  el.id = 'css-' + id;
  el.textContent = cssU(css);
  document.head.append(el);
}

// ---------------------------------------------------------------- pixel art for the CSS (drawn once)

const OL = 0x0b0e1a;
const dataURL = (p: Pix) => `url(${p.canvas().toDataURL()})`;

/** 16x16 border-image (slice 4): outline, bevel (light top-left / dark bottom-right), body with grain, inner shadow line */
function frame(light: number, body: number, dark: number, seed: number, planks: boolean): string {
  const p = new Pix(16, 16), r = rng(seed);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const d = Math.min(x, y, 15 - x, 15 - y);
    if (d > 3) continue;
    let c: number;
    if (d === 0) c = OL;
    else if (d === 1) c = (y === 1 && x < 14) || (x === 1 && y < 14) ? light : shade(body, 0.78);
    else if (d === 2) c = r() < 0.3 ? shade(body, 0.88) : r() < 0.15 ? shade(body, 1.1) : body;
    else c = dark;
    p.set(x, y, c);
  }
  if (planks) {
    // plank seams every 8 px along the edges (the middle slices repeat) and nails in the corners
    for (const k of [1, 2]) { p.set(4, k, dark).set(4, 15 - k, dark).set(k, 4, dark).set(15 - k, 4, dark); }
    for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) p.set(x, y, 0xc9ced6);
  }
  return dataURL(p);
}

/** snow cap strip: [left end 4px][seamless middle 32px][right end 4px], 10px tall → [left, middle, right] urls */
function snowCap(): [string, string, string] {
  // snow surface row (heaps) and lowest row (drips) per column of the middle tile
  const TOP = [3, 2, 2, 1, 1, 1, 2, 2, 3, 3, 3, 2, 2, 2, 1, 1, 2, 3, 3, 4, 4, 3, 3, 2, 2, 2, 2, 3, 3, 3, 4, 3];
  const BOT = [6, 6, 6, 7, 6, 6, 6, 6, 6, 7, 8, 7, 6, 6, 6, 6, 6, 6, 6, 6, 7, 7, 6, 6, 6, 6, 6, 8, 7, 6, 6, 6];
  const W = 40, strip = new Pix(W, 10), r = rng(7);
  const col = (x: number, t: number, b: number) => {
    for (let y = t; y <= b; y++) {
      const c = y === t ? 0xffffff : y > 6 ? 0xc6dcf2 : y === b ? 0xb0c8e4 : y === b - 1 ? 0xd9e7f6 : r() < 0.1 ? 0xdcefff : 0xf4f8fd;
      strip.set(x, y, c);
    }
  };
  for (let x = 0; x < 32; x++) col(x + 4, TOP[x], BOT[x]);
  [[5, 6], [3, 6], [2, 7], [2, 6]].forEach(([t, b], i) => col(i, t, b)); // rounded left end
  [[3, 6], [3, 7], [4, 6], [5, 6]].forEach(([t, b], i) => col(36 + i, t, b)); // rounded right end
  strip.outline(OL);
  const cut = (x0: number, w: number, tile = false) => {
    const p = new Pix(w, 10, tile);
    for (let y = 0; y < 10; y++) for (let x = 0; x < w; x++) {
      if (strip.alpha(x0 + x, y) && (!tile || strip.get(x0 + x, y) !== OL)) p.set(x, y, strip.get(x0 + x, y));
    }
    if (tile) p.outline(OL); // the middle tile wraps: redo its outline as a tiled buffer
    return dataURL(p);
  };
  return [cut(0, 4), cut(4, 32, true), cut(36, 4)];
}

const BULBS = [0xff4b4b, 0xffd23a, 0x4fe36a, 0x4aa8ff, 0xff7be1, 0xff9a2e];
/** garland tile (6 bulbs on a sagging wire, 96x12 px); in frame `phase` every third bulb is off → chasing lights */
function garlandTile(phase: number): string {
  const p = new Pix(96, 12, true);
  for (let x = 0; x < 96; x++) p.set(x, Math.round(1 + 3 * Math.sin((Math.PI * (x % 16)) / 16)), 0x1f4a2a);
  BULBS.forEach((c, i) => {
    const cx = 16 * i + 8, lit = (i + phase) % 3 !== 0;
    if (lit) for (let y = 3; y < 12; y++) for (let x = cx - 6; x < cx + 6; x++) {
      const q = Math.hypot(x + 0.5 - cx, (y + 0.5 - 8.5) * 1.1);
      if (q < 5.5 && !p.alpha(x, y)) p.set(x, y, c, q < 3.8 ? 110 : 50);
    }
    p.rect(cx - 1, 4, 2, 2, 0x2c5e36).set(cx - 1, 4, 0x4a8a52);
    p.rect(cx - 3, 6, 6, 6, OL).rect(cx - 2, 6, 4, 5, lit ? c : shade(c, 0.42));
    p.set(cx - 2, 6, OL).set(cx + 1, 6, OL);
    if (lit) p.set(cx - 1, 7, 0xffffff).rect(cx + 1, 7, 1, 3, shade(c, 0.78));
    else p.set(cx - 1, 7, shade(c, 0.6));
  });
  return dataURL(p);
}

/** subtle snowflake / star dots on the night-blue panel background (tile 32x32) */
function starsTile(): string {
  const p = new Pix(32, 32, true), r = rng(31);
  for (let i = 0; i < 9; i++) p.set(Math.floor(r() * 32), Math.floor(r() * 32), 0xffffff, 16 + Math.floor(r() * 18));
  for (const [x, y] of [[6, 9], [22, 24]]) for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) p.set(x + dx, y + dy, 0xffffff, 20);
  return dataURL(p);
}

/** stone-ish noise overlay for button faces (alpha only, tiles) */
function noiseTile(): string {
  const p = new Pix(16, 16, true), r = rng(5);
  p.each((x, y) => { const v = r() - 0.5; p.set(x, y, v > 0 ? 0xffffff : 0x000000, Math.round(Math.abs(v) * (v > 0 ? 44 : 64))); });
  return dataURL(p);
}

/** 4-point twinkle (rewards popup, legendary items) */
function sparkle(): string {
  const p = new Pix(7, 7);
  for (const [x, y] of [[3, 1], [3, 2], [3, 4], [3, 5], [1, 3], [2, 3], [4, 3], [5, 3]]) p.set(x, y, 0xfff3a6);
  for (const [x, y] of [[3, 0], [3, 6], [0, 3], [6, 3]]) p.set(x, y, 0xffc93a, 170);
  p.set(3, 3, 0xffffff);
  return dataURL(p);
}

// ---------------------------------------------------------------- fonts

const R_LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const R_LATIN_EXT = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';
const R_CYRILLIC = 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116';

function fontFaces(): string {
  // static URLs per file so Vite sees and bundles each font (a template inside new URL() would not be resolved)
  const files: [string, number, string][] = [
    [new URL('./fonts/pixelify-sans-cyrillic-400-normal.woff2', import.meta.url).href, 400, R_CYRILLIC],
    [new URL('./fonts/pixelify-sans-cyrillic-700-normal.woff2', import.meta.url).href, 700, R_CYRILLIC],
    [new URL('./fonts/pixelify-sans-latin-ext-400-normal.woff2', import.meta.url).href, 400, R_LATIN_EXT],
    [new URL('./fonts/pixelify-sans-latin-ext-700-normal.woff2', import.meta.url).href, 700, R_LATIN_EXT],
    [new URL('./fonts/pixelify-sans-latin-400-normal.woff2', import.meta.url).href, 400, R_LATIN],
    [new URL('./fonts/pixelify-sans-latin-700-normal.woff2', import.meta.url).href, 700, R_LATIN],
  ];
  return files.map(([src, w, range]) =>
    `@font-face{font-family:'Pixelify Sans';font-style:normal;font-weight:${w};font-display:swap;src:url(${src}) format('woff2');unicode-range:${range}}`).join('\n');
}

/** system font stacks for scripts Pixelify Sans can't draw (i18n.SYSTEM_FONT_LANGS) */
const SYSTEM_FONTS: Record<string, string> = {
  ja: '"Hiragino Kaku Gothic ProN","Hiragino Sans","Yu Gothic UI","Yu Gothic",Meiryo,"Noto Sans JP",',
  ko: '"Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",',
  zh: '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans SC",',
  hi: '"Kohinoor Devanagari","Nirmala UI","Noto Sans Devanagari",Mangal,',
  ar: '"Geeza Pro","Segoe UI",Tahoma,"Noto Sans Arabic",',
  th: 'Thonburi,"Leelawadee UI",Tahoma,"Noto Sans Thai",',
  vi: '"Segoe UI",Roboto,"Helvetica Neue",Arial,',
};

/**
 * Wait (up to timeoutMs) until the pixel font faces used by the current language are loaded, to avoid a flash of the
 * fallback font on the first screen. Optional: call after applyTheme() and setLang()/loadLang() during boot.
 */
export function fontsReady(timeoutMs = 1500): Promise<void> {
  const f = typeof document !== 'undefined' ? document.fonts : undefined;
  if (!f?.load) return Promise.resolve();
  const sample = 'AaZzĄąЖж';
  const load = Promise.all([f.load(`400 20px 'Pixelify Sans'`, sample), f.load(`700 20px 'Pixelify Sans'`, sample)]).then(() => {}, () => {});
  return Promise.race([load, new Promise<void>((r) => setTimeout(r, timeoutMs))]);
}

// ---------------------------------------------------------------- the stylesheet

// 9-direction pixel outline for headings (--tol) and a thinner one for small text (--tol2)
const tol = (n: number) => [[-n, 0], [n, 0], [0, -n], [0, n], [-n, -n], [n, -n], [-n, n], [n, n]].map(([x, y]) => `${x}u ${y}u 0 var(--ol)`).join(',');

const CSS = `
html,body{margin:0;overflow:hidden;overscroll-behavior:none;-webkit-text-size-adjust:100%}
canvas{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}
.ui-root{--ol:#0b0e1a;--top:96u;--tol:${tol(3)},0 6u 0 var(--ol);--tol2:${tol(2)};font-synthesis:none;font-size:26u;line-height:1.15;
text-shadow:2u 2u 0 rgba(0,0,0,.55);-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;-webkit-font-smoothing:antialiased}
.ui-root img,.ui-root canvas{image-rendering:pixelated;-webkit-user-drag:none;-webkit-touch-callout:none}
.rel{position:relative}
.hidden{display:none!important}

.lay{position:absolute;top:env(safe-area-inset-top);right:env(safe-area-inset-right);bottom:env(safe-area-inset-bottom);left:env(safe-area-inset-left);pointer-events:none}
.lay-hud{z-index:1}.lay-screen{z-index:5}.lay-top{z-index:8}.lay-modal{z-index:10}.lay-toast{z-index:12}
.lay button,.lay .ia,.lay .panel,.lay .scroll,.lay .screen,.lay .mback{pointer-events:auto}

.t-xs{font-size:18u}.t-s{font-size:22u}.t-m{font-size:26u}.t-l{font-size:34u}.t-xl{font-size:46u}.t-xxl{font-size:72u}
.b{font-weight:700}.c-gold{color:#ffd447}.c-good{color:#7ee26a}.c-bad{color:#ff6b5e}.c-dim{color:#a9bdd6}.c-ice{color:#9fe0ff}
.ttl{margin:0;font-weight:700;font-size:46u;line-height:1.05;color:#fff;text-shadow:var(--tol);overflow-wrap:break-word;hyphens:auto}
.ol{text-shadow:var(--tol2)}
.txt{margin:0;line-height:1.3;overflow-wrap:break-word;hyphens:auto}
.sub{font-size:.75em;color:#c6d4ea}
.row{display:flex;align-items:center;gap:12u}.col{display:flex;flex-direction:column;gap:12u}.wrap{flex-wrap:wrap}
.center{justify-content:center;align-items:center;text-align:center}.grow{flex:1 1 0;min-width:0}.gap-s{gap:6u}.gap-l{gap:24u}
.well{padding:14u;background:rgba(0,0,0,.28);box-shadow:inset 0 0 0 3u rgba(0,0,0,.35),inset 0 6u 0 rgba(0,0,0,.18)}
.li{display:flex;align-items:center;gap:14u;padding:12u 14u;background:rgba(255,255,255,.06);box-shadow:inset 0 0 0 3u rgba(0,0,0,.32),inset 0 6u 0 rgba(255,255,255,.04)}
.sep{height:3u;margin:6u 0;background:rgba(255,255,255,.12);box-shadow:0 3u 0 rgba(0,0,0,.35)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(var(--cw,170u),1fr));gap:22u;padding:10u 8u 16u}

.ic{display:inline-block;flex:none;width:28u;height:28u;background:center/contain no-repeat;vertical-align:middle;image-rendering:pixelated}
.money{display:inline-flex;align-items:center;gap:.25em;font-weight:700;white-space:nowrap}
.money>.ic{width:1.3em;height:1.3em}
.art{display:flex;flex:none;align-items:center;justify-content:center;position:relative}
.art>img{display:block;max-width:100%;max-height:100%}
.art-skin>img{height:100%}.art-ball>img{width:80%}.art-key>img,.art-coins>img,.art-gems>img,.art-noAds>img{width:88%}
.ava{display:inline-flex;flex:none;width:64u;height:64u;padding:4u;background:linear-gradient(#3b5d93,#22385f);box-shadow:inset 0 0 0 3u rgba(255,255,255,.14),0 0 0 3u var(--ol)}
.ava>img{width:100%;height:100%}

.btn{--bf:#8b909a;--bl:#c9cdd5;--bd:#4b4f59;position:relative;display:inline-flex;align-items:center;justify-content:center;gap:10u;
min-height:64u;min-width:64u;max-width:100%;padding:8u 22u 14u;margin:0;border:0;border-radius:0;font:inherit;font-weight:700;font-size:28u;
line-height:1.05;color:#fff;text-align:center;overflow-wrap:break-word;hyphens:auto;cursor:pointer;vertical-align:middle;
text-shadow:3u 3u 0 rgba(0,0,0,.45);background:var(--bf) var(--noise) 0 0/48u 48u;
box-shadow:inset 0 -6u 0 var(--bd),inset 3u 3u 0 var(--bl),inset -3u 0 0 var(--bd),0 0 0 3u var(--ol),0 9u 0 rgba(0,0,0,.3);
-webkit-tap-highlight-color:transparent;touch-action:manipulation;outline-offset:3u}
.btn>.lbl{min-width:0}
.lbl>.sub{display:block}
.btn .ic{width:1.3em;height:1.3em}
.btn .sub{display:block;margin-top:2u;font-size:.68em;color:inherit;opacity:.88}
@media (hover:hover){.btn:not(:disabled):hover{filter:brightness(1.12)}}
.btn:not(:disabled):active{transform:translateY(3u);box-shadow:inset 0 -3u 0 var(--bd),inset 3u 3u 0 var(--bl),inset -3u 0 0 var(--bd),0 0 0 3u var(--ol),0 6u 0 rgba(0,0,0,.3)}
.btn:disabled{filter:grayscale(1) brightness(.7);cursor:default}
.btn.busy{pointer-events:none;filter:brightness(.8)}
.btn.green{--bf:#3faa3a;--bl:#8ae26c;--bd:#1f6624}
.btn.blue{--bf:#2f7ddf;--bl:#86c4ff;--bd:#1a4891}
.btn.gold{--bf:#efb11c;--bl:#ffe47e;--bd:#9a6406;text-shadow:3u 3u 0 rgba(92,46,0,.6)}
.btn.red{--bf:#d4413a;--bl:#ff8f80;--bd:#82201b}
.btn.ad{--bf:#8a4fdf;--bl:#c9a0ff;--bd:#4a238e}
.btn.ad::before{content:'';flex:none;width:1.45em;height:1.45em;background:var(--i-ad) center/contain no-repeat}
.btn.small{min-height:46u;min-width:46u;padding:5u 14u 10u;gap:6u;font-size:22u;text-shadow:2u 2u 0 rgba(0,0,0,.45)}
.btn.big{min-height:86u;padding:12u 40u 18u;gap:14u;font-size:38u}
.btn.icon{width:64u;height:64u;padding:0 0 3u}
.btn.icon.small{width:46u;height:46u}
.btn.icon.big{width:86u;height:86u}
.btn.icon>.ic{width:62%;height:62%}
.btn.locked{--bf:#5d626b;--bl:#80858e;--bd:#383c44;color:#c3c7cf}
.btn.locked>*{filter:grayscale(1) opacity(.75)}
.btn.locked::after,.card.lockd::after,.card.sel::after{content:'';position:absolute;z-index:3;right:-14u;top:-14u;width:36u;height:36u;background:var(--i-lock) center/contain no-repeat;filter:drop-shadow(0 3u 0 rgba(0,0,0,.4))}
.tabs{display:flex;gap:10u;padding:6u 4u 8u}
.btn.tab{--bf:#2c4068;--bl:#4f6c9e;--bd:#18233c;flex:1 1 0;min-width:0;min-height:58u;padding:6u 10u 11u;font-size:24u;color:#b9c8e2}
.btn.tab.on{--bf:#3f8cff;--bl:#a2ceff;--bd:#1d4fa0;color:#fff}
.btn.tab .ic{width:1.2em;height:1.2em}
@media (max-aspect-ratio:4/5){.btn.tab{flex-direction:column;gap:2u;padding:6u 6u 11u}}

.panel{position:relative;display:flex;flex-direction:column;min-width:0;min-height:0;color:#fff;border:12u solid transparent;
border-image:var(--fr-wood) 4/12u round;background:var(--pat) 0 0/96u 96u,linear-gradient(rgba(29,62,118,.96),rgba(12,26,58,.97) 60%);
background-clip:padding-box;box-shadow:0 12u 0 rgba(0,0,0,.35),inset 0 6u 0 rgba(0,0,0,.28);image-rendering:pixelated}
.panel.stone{border-image-source:var(--fr-stone)}.panel.ice{border-image-source:var(--fr-ice)}.panel.gold{border-image-source:var(--fr-gold)}
.panel::before{content:'';position:absolute;z-index:2;left:-18u;right:-18u;top:-27u;height:30u;padding:0 12u;pointer-events:none;
background:var(--cap-l) 0 0/12u 30u no-repeat,var(--cap-r) 100% 0/12u 30u no-repeat,var(--cap) 0 0/96u 30u repeat-x;
background-origin:border-box,border-box,content-box;background-clip:border-box,border-box,content-box}
.panel.nosnow::before{display:none}
.garland{position:absolute;z-index:3;left:0;right:0;top:-12u;height:36u;pointer-events:none;background:var(--gl0) 50% 0/288u 36u repeat-x;animation:chase 1.5s steps(1) infinite}

.screen{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:var(--top) 20u 14u;background:rgba(4,10,26,.3)}
.screen>.panel{width:min(100%,1040u);height:min(100%,880u);animation:pop .2s ease-out}
.screen>.panel.wide{width:min(100%,1320u)}
@media (min-aspect-ratio:16/9){.screen>.panel{width:min(100%,1220u)}.screen>.panel.wide{width:min(100%,1440u)}}
.tbar{flex:none;display:flex;align-items:center;gap:12u;min-height:64u;padding:34u 12u 8u}
.tbar>.ttl{flex:1 1 0;min-width:0;text-align:center;font-size:44u}
.tbar>.btn,.tbar>.tsp{flex:none}.tbar>.tsp{width:64u}
.phead{flex:none;padding:0 10u 6u}.phead:empty{display:none}
.pbody{flex:1 1 auto;min-height:0;overflow-x:hidden;overflow-y:auto;padding:12u 16u 18u}
/* tall screens: a taller panel; square & landscape (720u high): less chrome */
@media (max-aspect-ratio:4/5){.screen>.panel{height:min(100%,1480u)}}
@media (min-aspect-ratio:4/5){.ui-root{--top:88u}.tbar{padding-top:30u;padding-bottom:4u}}

.mback{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(3,8,22,.68);animation:fade .15s;
padding:calc(env(safe-area-inset-top) + 44u) calc(env(safe-area-inset-right) + 36u) calc(env(safe-area-inset-bottom) + 26u) calc(env(safe-area-inset-left) + 36u)}
.panel.modal{width:auto;max-width:min(100%,860u);max-height:100%;min-width:min(100%,460u);animation:pop .22s ease-out}
.mhead{padding:26u 26u 2u;text-align:center}.mhead>.ttl{font-size:40u}
.panel.modal.wide{max-width:min(100%,1120u)}
.mbody{flex:1 1 auto;min-height:0;overflow-x:hidden;overflow-y:auto;display:flex;flex-direction:column;align-items:center;gap:18u;padding:18u 22u 24u;text-align:center}
.mfoot{flex:none;display:flex;flex-wrap:wrap;justify-content:center;gap:16u 20u;padding:6u 22u 26u}
.btn.xbtn{position:absolute;z-index:4;top:-30u;right:-30u}

.toasts{position:absolute;left:50%;top:104u;transform:translateX(-50%);width:min(94%,760u);display:flex;flex-direction:column;align-items:center;gap:12u;pointer-events:none}
.toast{--tc:#5aa9ff;max-width:100%;padding:12u 22u 15u 32u;font-size:26u;text-align:center;overflow-wrap:break-word;background:#203a70;
box-shadow:inset 10u 0 0 var(--tc),inset 0 -5u 0 rgba(0,0,0,.35),inset 0 3u 0 rgba(255,255,255,.18),0 0 0 3u var(--ol),0 0 0 6u rgba(255,255,255,.25),0 10u 0 rgba(0,0,0,.35);animation:tin .25s ease-out;transition:opacity .3s,transform .3s}
.toast.good{--tc:#5fd35a}.toast.bad{--tc:#ff5a4e}.toast.out{opacity:0;transform:translateY(-12u)}

.card{--rc:#9aa4ad;--rb:#3a4352;position:relative;isolation:isolate;display:flex;flex-direction:column;align-items:center;gap:6u;min-width:0;
padding:14u 10u 12u;text-align:center;background:linear-gradient(var(--rb),#0d1830 88%);
box-shadow:inset 0 0 0 4u var(--rc),inset 0 0 0 7u rgba(0,0,0,.35),0 0 0 3u var(--ol),0 9u 0 rgba(0,0,0,.3)}
.r-common{--rc:#9aa4ad;--rb:#3a4352}.r-rare{--rc:#3f8cff;--rb:#163a7a}.r-epic{--rc:#b350ff;--rb:#4b1d7c}.r-legendary{--rc:#ffb31a;--rb:#70440c}
.r-coins{--rc:#ffd447;--rb:#5a4410}.r-gems{--rc:#4fe3ff;--rb:#12476a}
.card.r-epic::before,.card.r-legendary::before{content:'';position:absolute;z-index:-1;inset:-3u;box-shadow:0 0 22u 5u var(--rc);opacity:.35;animation:glow 1.6s ease-in-out infinite alternate;pointer-events:none}
.card.r-legendary::before{box-shadow:0 0 30u 9u var(--rc)}
.card .nm{max-width:100%;font-weight:700;font-size:22u;line-height:1.1;overflow-wrap:break-word;hyphens:auto}
.card .foot{display:flex;flex-wrap:wrap;justify-content:center;gap:8u;margin-top:auto;padding-top:4u;max-width:100%}
.card.sel{box-shadow:inset 0 0 0 4u var(--rc),inset 0 0 0 7u rgba(0,0,0,.35),0 0 0 3u var(--ol),0 0 0 7u #fff,0 13u 0 rgba(0,0,0,.3)}
.card.sel::after{background-image:var(--i-check)}
.card.dim .art{filter:grayscale(1) brightness(.55)}
.card.tap{cursor:pointer}.card.tap:active{transform:translateY(3u)}
@media (hover:hover){.card.tap:hover{filter:brightness(1.1)}}
.rbadge{display:inline-block;max-width:100%;padding:2u 8u 4u;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
font-size:16u;font-weight:700;text-transform:uppercase;color:#fff;background:var(--rc);box-shadow:0 0 0 3u var(--ol);text-shadow:2u 2u 0 rgba(0,0,0,.55)}
.badge{position:absolute;z-index:4;top:-14u;left:-12u;max-width:calc(100% + 12u);padding:3u 12u 6u;font-size:20u;font-weight:700;line-height:1.1;color:#fff;
white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:#e8322b;text-shadow:2u 2u 0 rgba(0,0,0,.45);
box-shadow:0 0 0 3u var(--ol),inset 0 -4u 0 rgba(0,0,0,.25),inset 0 3u 0 rgba(255,255,255,.3)}
.badge.r{left:auto;right:-12u}.badge.new{background:#3faa3a}.badge.hit{background:#f0a818;text-shadow:2u 2u 0 rgba(92,46,0,.6)}.badge.info{background:#2f7ddf}
.ndot{position:absolute;z-index:5;top:-10u;right:-10u;min-width:24u;height:24u;padding:0 5u;font-size:16u;line-height:23u;font-weight:700;text-align:center;
color:#fff;background:#ff3b30;box-shadow:0 0 0 3u var(--ol),inset -3u -3u 0 #b3170e,inset 3u 3u 0 #ff9a90;pointer-events:none;animation:dotb 1.2s steps(2) infinite}
.attn{outline:5u solid #ffe14d;outline-offset:3u;animation:attn 1s ease-out infinite}

.chip{position:relative;display:inline-flex;align-items:center;gap:8u;min-height:50u;padding:4u 14u 4u 10u;font-weight:700;font-size:26u;white-space:nowrap;
background:rgba(7,15,34,.88);box-shadow:inset 0 -4u 0 rgba(0,0,0,.45),inset 0 3u 0 rgba(255,255,255,.1),0 0 0 3u var(--ol)}
.timer{gap:6u;min-height:38u;padding:3u 12u 4u 8u;font-size:22u;color:#ffe9a0}
.timer::before{content:'';flex:none;width:28u;height:28u;background:var(--i-clock) center/contain no-repeat}
.cd{font-variant-numeric:tabular-nums;white-space:nowrap}
.topbar{position:absolute;top:16u;right:20u;display:flex;align-items:center;gap:26u;pointer-events:auto}
.topbar .chip{min-width:150u;padding:3u 6u 3u 0;justify-content:space-between}
.topbar .chip>.ic{width:48u;height:48u;margin:-6u 0 -6u -20u}
.topbar .chip>b{flex:1;text-align:right;padding:0 4u}
.topbar .btn{width:40u;height:40u;min-width:40u;min-height:40u}
@media (max-aspect-ratio:5/4){.topbar{gap:20u;right:16u}.topbar .chip{min-width:120u}}

.pbar{--pc:#5fd35a;position:relative;height:30u;min-width:80u;background:#0a1328;box-shadow:inset 0 5u 0 rgba(0,0,0,.6),0 0 0 3u var(--ol)}
.pbar>b{display:block;height:100%;width:0;background:var(--pc);box-shadow:inset 0 -6u 0 rgba(0,0,0,.28),inset 0 4u 0 rgba(255,255,255,.35);transition:width .35s ease-out}
.pbar::after{content:'';position:absolute;inset:0;pointer-events:none;background:linear-gradient(90deg,transparent calc(100% - 3u),rgba(11,14,26,.9) 0) 0 0/calc(100% / var(--seg,10)) 100% repeat-x}
.pbar>span{position:absolute;inset:0;z-index:1;display:flex;align-items:center;justify-content:center;font-size:20u;font-weight:700;white-space:nowrap;text-shadow:var(--tol2)}

.scroll,.pbody,.mbody{overscroll-behavior:contain;-webkit-overflow-scrolling:touch;touch-action:pan-y}
.ui-root ::-webkit-scrollbar{width:14u;height:14u}
.ui-root ::-webkit-scrollbar-track{background:rgba(0,0,0,.35)}
.ui-root ::-webkit-scrollbar-thumb{background:#8fb6e0;box-shadow:inset 0 0 0 3u var(--ol),inset 6u 0 0 #cfe6ff,inset -6u 0 0 #5e86b5}
.ui-root ::-webkit-scrollbar-button,.ui-root ::-webkit-scrollbar-corner{display:none}
@supports (-moz-appearance:none){.ui-root *{scrollbar-color:#8fb6e0 rgba(0,0,0,.35);scrollbar-width:thin}}

.rwds{position:relative;display:flex;flex-wrap:wrap;justify-content:center;gap:28u;padding:14u 8u 6u}
.rwd{width:200u;opacity:0}.rwd.in{animation:pop .45s cubic-bezier(.2,1.6,.4,1) forwards}
.rwd>.art{width:130u;height:130u}
.rwds.one .rwd{width:270u}.rwds.one .rwd>.art{width:180u;height:180u}
.rwds.many{gap:18u 22u}.rwds.many .rwd{width:160u}.rwds.many .rwd>.art{width:100u;height:100u}
@media (min-aspect-ratio:4/5){.rwds.many .rwd{width:150u;padding:10u 8u}.rwds.many .rwd>.art{width:76u;height:76u}.rwds.many .nm{font-size:20u}
.panel.many .mfoot>.btn.big{min-height:64u;padding:8u 30u 14u;font-size:30u}}
.rwd .dup{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:2u 8u;font-size:18u;color:#ffe9a0}
.rays{position:absolute;z-index:-1;left:50%;top:40%;width:150%;aspect-ratio:1;transform:translate(-50%,-50%);pointer-events:none;border-radius:50%;
background:repeating-conic-gradient(rgba(255,236,160,.26) 0 10deg,transparent 10deg 30deg);-webkit-mask:radial-gradient(closest-side,#000 35%,transparent);
mask:radial-gradient(closest-side,#000 35%,transparent);animation:spin 9s linear infinite}
.spk{position:absolute;z-index:2;width:21u;height:21u;background:var(--spk) center/contain no-repeat;pointer-events:none;transform:scale(0);animation:twk 1.4s ease-in-out infinite}
.fly{position:absolute;left:0;top:0;width:40u;height:40u;margin:-20u 0 0 -20u;pointer-events:none;will-change:transform}

@keyframes pop{0%{transform:scale(.3);opacity:0}60%{transform:scale(1.08);opacity:1}100%{transform:scale(1);opacity:1}}
@keyframes fade{from{opacity:0}}
@keyframes tin{from{opacity:0;transform:translateY(-14u)}}
@keyframes glow{from{opacity:.18}to{opacity:.62}}
@keyframes spin{to{transform:translate(-50%,-50%) rotate(1turn)}}
@keyframes twk{0%,100%{transform:scale(0)}50%{transform:scale(1)}}
@keyframes dotb{50%{transform:translateY(-4u)}}
@keyframes attn{0%{outline-offset:3u;outline-color:rgba(255,225,77,1)}100%{outline-offset:22u;outline-color:rgba(255,225,77,0)}}
@media (prefers-reduced-motion:reduce){.ui-root *,.ui-root *::before,.ui-root *::after{animation-duration:1ms!important;animation-iteration-count:1!important;transition-duration:1ms!important}}
`;

let applied = false;
/**
 * Inject @font-face + all game CSS (once; idempotent). Call at boot before building the UI. Languages the pixel font
 * can't draw (i18n.SYSTEM_FONT_LANGS) switch to system fonts by `html:lang(..)` (setLang sets <html lang>).
 */
export function applyTheme(): void {
  if (applied || typeof document === 'undefined') return;
  applied = true;
  const [capL, cap, capR] = snowCap();
  const gl = [0, 1, 2].map(garlandTile);
  const vars = [
    `--fr-wood:${frame(0xe0aa6a, 0xab6f3b, 0x5e351a, 11, true)}`,
    `--fr-stone:${frame(0xc3c8d0, 0x8c919b, 0x4d525c, 12, false)}`,
    `--fr-ice:${frame(0xeefaff, 0x8fd3f5, 0x3d8fc4, 13, false)}`,
    `--fr-gold:${frame(0xfff0a0, 0xf2b51e, 0x9c650a, 14, false)}`,
    `--cap-l:${capL}`, `--cap:${cap}`, `--cap-r:${capR}`, `--gl0:${gl[0]}`,
    `--pat:${starsTile()}`, `--noise:${noiseTile()}`, `--spk:${sparkle()}`,
    ...(['lock', 'ad', 'check', 'clock'] as const).map((id) => `--i-${id}:url(${iconURL(id)})`),
  ].join(';');
  // the font of the scripts the pixel font lacks must beat the inline font-family that new UI({ font }) puts on the root
  const sys = SYSTEM_FONT_LANGS.map((l) => `html:lang(${l}) .ui-root{font-family:${SYSTEM_FONTS[l] ?? ''}system-ui,-apple-system,sans-serif!important}`).join('\n');
  const el = document.createElement('style');
  el.id = 'sr-theme';
  // data URLs and font URLs stay out of cssU (base64 may contain "3u"-like sequences)
  el.textContent = `${fontFaces()}\n.ui-root{${vars}}\n${sys}\n${cssU(CSS)}\n` +
    `@keyframes chase{0%{background-image:${gl[0]}}33.3%{background-image:${gl[1]}}66.6%{background-image:${gl[2]}}}`;
  document.head.append(el);
}

/**
 * Keep --u = clamp(min(W, H) / 720, 0.4, 2.5) on every resize (call once, right after new UI(...): the engine UI sets its
 * own --u on resize and this listener runs after it, so ours wins). Also keeps ui.scale in sync (floatText, joystick).
 */
export function fitUI(ui: UI, game: Game): void {
  const apply = () => {
    let w = game.screen.width, h = game.screen.height;
    if (w <= 1 || h <= 1) { w = innerWidth; h = innerHeight; } // before the first frame measured the canvas
    const k = uiScale(w, h);
    ui.scale = k;
    ui.root.style.setProperty('--u', String(k));
  };
  game.screen.onResize(apply);
  apply();
}
