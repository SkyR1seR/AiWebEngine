// Main menu (owner: ui-core): title, Play with level, league & trophies, side buttons (wardrobe, upgrades, shop, cases,
// calendar with red dots), offer banners with timers, sound/music toggles. The 3D lobby shows behind it.
//
// Layout (CSS only, one DOM): landscape — logo + league + offers in the left column, feature buttons in the right column,
// PLAY at the bottom between them (the lobby frames Нубик center-right); portrait — toggles | TopBar row, offers strip,
// logo, league, (hero), a row of feature buttons, PLAY; square — a compact landscape with PLAY across the bottom.
import { h } from 'aiwebengine/ui';
import type { Ctx, Feature, ScreenApi } from './types';
import { addCSS } from './theme';
import { btn, card, dot, fitText, garland, icon, itemArt, layer, lines, progress, saleBadge, setText, timerChip, toast, type Progress } from './widgets';
import { featureName, freebieAvailable, isUnlocked, lockLabel, lockShort } from './unlocks';
import { LEAGUES, canClaimDaily, leagueOf } from './catalog';
import { activeOffers, type Offer } from './offers';
import { offerBanner } from './offersui';
import { music } from './audio';
import { FEATURE_ICON } from './tutorial';
import { tr } from './i18n';
import { fmtNum } from './util';

export interface MenuApi extends ScreenApi {
  /** the menu's root element */
  readonly el: HTMLElement;
  /** feature button (tutorial hand target) */
  button(f: Feature): HTMLElement;
  /** the PLAY button */
  readonly playButton: HTMLElement;
}

/** menu button order (DESIGN §8) */
const ORDER: Feature[] = ['wardrobe', 'upgrades', 'shop', 'cases', 'daily'];
const COLOR: Record<Feature, string> = { wardrobe: 'blue', upgrades: 'green', shop: 'gold', cases: 'red', daily: 'blue' };
/** logo letter block colors (toy blocks / gift boxes) */
const BLOCKS = ['#e04a3a', '#3faa3a', '#efb11c', '#2f7ddf', '#8a4fdf'];

const CSS = `
.mn{position:absolute;inset:0;pointer-events:none}
.mn>.garland{top:-8u}
.mn-tg{position:absolute;left:22u;bottom:24u;display:flex;gap:16u}
.mn-tg .btn.off{--bf:#5d626b;--bl:#80858e;--bd:#383c44}
.mn-tg .btn.off::before{content:'';position:absolute;z-index:1;left:12%;right:12%;top:calc(50% - 4u);height:8u;background:#ff4b4b;transform:rotate(-45deg);box-shadow:0 0 0 3u var(--ol)}
.mn-l{position:absolute;left:22u;top:34u;bottom:112u;width:360u;display:flex;flex-direction:column;align-items:flex-start;gap:18u}
.mn-logo{display:flex;flex-direction:column;align-items:center;gap:6u;width:100%;animation:pop .35s ease-out}
.lg-w{--bs:74u;display:flex;justify-content:center;gap:7u;width:100%;padding-top:12u;container-type:inline-size}
.lg-b{--c:#e04a3a;position:relative;flex:none;display:flex;align-items:center;justify-content:center;font-weight:700;line-height:1;color:#fff;
width:var(--bs);height:var(--bs);font-size:calc(var(--bs) * .78);
width:min(var(--bs),calc((100cqw - 7u * var(--n)) / var(--n)));height:min(var(--bs),calc((100cqw - 7u * var(--n)) / var(--n)));
font-size:min(calc(var(--bs) * .78),calc((100cqw - 7u * var(--n)) / var(--n) * .78));text-shadow:var(--tol2),0 5u 0 var(--ol);
background:var(--c) var(--noise) 0 0/48u 48u;box-shadow:inset 0 -7u 0 rgba(0,0,0,.3),inset 5u 5u 0 rgba(255,255,255,.3),inset -4u 0 0 rgba(0,0,0,.2),0 0 0 3u var(--ol),0 9u 0 rgba(0,0,0,.3);
animation:lgb 2.6s ease-in-out infinite}
.lg-b::before{content:'';position:absolute;left:-7u;right:-7u;top:-15u;height:24u;padding:0 9u;pointer-events:none;
background:var(--cap-l) 0 0/9u 24u no-repeat,var(--cap-r) 100% 0/9u 24u no-repeat,var(--cap) 0 0/72u 24u repeat-x;
background-origin:border-box,border-box,content-box;background-clip:border-box,border-box,content-box}
.lg-b:nth-child(odd){rotate:-4deg}.lg-b:nth-child(even){rotate:3deg}
.lg-b:nth-child(2){animation-delay:-.5s}.lg-b:nth-child(3){animation-delay:-1s}.lg-b:nth-child(4){animation-delay:-1.5s}.lg-b:nth-child(5){animation-delay:-2s}
@keyframes lgb{0%,100%{translate:0 0}50%{translate:0 -5u}}
.lg-s{max-width:100%;font-size:38u;font-weight:700;line-height:1.05;text-align:center;color:#bfefff;letter-spacing:1u;text-shadow:var(--tol);white-space:nowrap}
.mn-lg{display:flex;align-items:center;gap:12u;width:330u;max-width:100%;padding:8u 14u 10u 10u;background:rgba(7,15,34,.86);
box-shadow:inset 0 -4u 0 rgba(0,0,0,.45),inset 0 3u 0 rgba(255,255,255,.1),0 0 0 3u var(--ol),inset 8u 0 0 var(--lc,#bfe3ff)}
.mn-lg>.ic{width:54u;height:54u;margin-left:8u}
.mn-lg .col{gap:6u;flex:1 1 auto;min-width:0}
.mn-lg .nm{font-size:24u;font-weight:700;color:var(--lc);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mn-lg .pbar{width:100%;min-width:0;height:28u;--pc:var(--lc)}.mn-lg .pbar>span{font-size:19u}
.mn-ofs{display:flex;flex-direction:column;gap:22u;width:100%;min-height:0}
.mn-ofs>*{flex:none;max-width:100%}
.mn-ofs>:nth-child(n+3){display:none}
.mn-ofb{flex-direction:row;gap:12u;width:100%;padding:10u 12u;text-align:left}
.mn-ofb>.art{width:84u;height:84u;margin:-6u 0}
.mn-ofb>.col{gap:6u;min-width:0;align-items:flex-start}
.mn-ofb .nm{text-align:left}
.mn-fs{position:absolute;right:22u;top:calc(var(--top) + 6u);bottom:24u;width:270u;display:flex;flex-direction:column;justify-content:center;gap:18u}
.mn-fs>.btn{justify-content:flex-start;min-height:72u;padding:6u 14u 12u 12u;font-size:25u;text-align:left}
.mn-fs>.btn>.ic{width:50u;height:50u}
.mn-fs>.btn.locked>.lbl{color:#c3c7cf}
.mn-fs .lbl{hyphens:manual;overflow-wrap:normal}
.mn-pl{position:absolute;left:400u;right:312u;bottom:26u;display:flex;justify-content:center}
.mn-pw{display:flex;max-width:100%;animation:mnp 1.3s ease-in-out infinite}
.mn-go.btn{min-width:min(100%,400u);min-height:120u;padding:10u 36u 18u;font-size:54u;gap:18u;box-shadow:inset 0 -8u 0 var(--bd),inset 4u 4u 0 var(--bl),inset -4u 0 0 var(--bd),0 0 0 4u var(--ol),0 12u 0 rgba(0,0,0,.3),0 0 40u rgba(126,226,106,.45)}
.mn-go>.ic{width:62u;height:62u}
.mn-go .sub{font-size:24u}
@keyframes mnp{0%,100%{scale:1}50%{scale:1.05}}
/* square-ish screens: compact landscape, PLAY across the bottom */
@media (max-aspect-ratio:5/4) and (min-aspect-ratio:4/5){
.mn-tg{left:20u;top:16u;bottom:auto}
.mn-l{top:96u;left:20u;bottom:178u;width:330u;gap:14u}
.lg-s{font-size:30u}.lg-w{--bs:62u}
.mn-ofs>:nth-child(n+2){display:none}
.mn-fs{right:20u;top:var(--top);bottom:178u;width:236u;gap:12u}
.mn-fs>.btn{min-height:64u;font-size:22u}.mn-fs>.btn>.ic{width:42u;height:42u}
.mn-pl{left:20u;right:20u;bottom:24u}
.mn-go.btn{min-height:110u;font-size:48u}
}
/* portrait: everything stacks around the hero in the middle */
@media (max-aspect-ratio:4/5){
.mn-tg{left:20u;top:16u;bottom:auto;gap:14u}
.mn-l{top:var(--top);left:20u;right:20u;bottom:auto;width:auto;align-items:center;gap:18u}
.mn-ofs{order:-1;flex-direction:row;justify-content:center;gap:16u}
.mn-ofs>*{flex:0 1 330u;min-width:0}
.mn-ofb>.art{width:70u;height:70u}
.mn-logo{margin-top:6u;max-width:600u}
.lg-w{--bs:100u;gap:10u}.lg-s{font-size:50u}
.mn-fs{left:16u;right:16u;top:auto;bottom:178u;width:auto;flex-direction:row;justify-content:center;gap:12u}
.mn-fs>.btn{flex:1 1 0;max-width:160u;flex-direction:column;justify-content:flex-start;gap:4u;min-height:122u;padding:10u 4u 14u;font-size:19u;text-align:center}
.mn-fs>.btn>.ic{width:58u;height:58u}
.mn-fs>.btn>.lbl{width:100%}
.mn-fs .lbl{hyphens:auto;overflow-wrap:break-word}
.mn-lg{width:420u;padding:10u 18u 12u 12u}.mn-lg .nm{font-size:28u}.mn-lg>.ic{width:64u;height:64u}
.mn-pl{left:20u;right:20u;bottom:30u}
.mn-go.btn{min-width:min(100%,460u)}
}
`;

/** sound + music toggle buttons (menu, pause dialog): sound → ctx.sdk.mute + save.muted, music → music.setEnabled + save.music */
export function soundButtons(ctx: Ctx): { el: HTMLElement; sync(): void } {
  const s = ctx.save;
  const snd = btn(icon('sound'), () => { s.muted = !s.muted; ctx.sdk.mute(s.muted); ctx.persist(); sync(); }, 'icon blue');
  const mus = btn(icon('music'), () => { s.music = !s.music; music.setEnabled(s.music); ctx.persist(); sync(); }, 'icon blue');
  const sync = () => {
    snd.classList.toggle('off', s.muted);
    mus.classList.toggle('off', !s.music);
    (snd.firstElementChild as HTMLElement).style.backgroundImage = icon(s.muted ? 'mute' : 'sound').style.backgroundImage;
    snd.setAttribute('aria-label', s.muted ? tr({ ru: 'Включить звук', en: 'Sound on' }) : tr({ ru: 'Выключить звук', en: 'Sound off' }));
    mus.setAttribute('aria-label', s.music ? tr({ ru: 'Выключить музыку', en: 'Music off' }) : tr({ ru: 'Включить музыку', en: 'Music on' }));
  };
  sync();
  return { el: h('div', { class: 'row', style: 'gap:inherit' }, snd, mus), sync };
}

/** compact offer banner used when offersui.offerBanner is not available */
function fallbackBanner(ctx: Ctx, o: Offer): HTMLElement {
  const art = itemArt(o.hero.kind === 'key' ? 'key' : o.hero.kind, o.hero.id, 0);
  const c = card({
    rarity: o.kind === 'hot' ? 'epic' : 'legendary', badge: o.discount > 0 ? saleBadge(o.discount, true) : undefined, art,
    onClick: () => ctx.nav.offer(o.id), cls: 'mn-ofb',
  });
  const nm = h('div', { class: 'nm' }, tr(o.title));
  c.append(h('div', { class: 'col' }, nm, timerChip(ctx, o.endsAt)));
  return c;
}

/** blocky snow-capped logo: «НУБИК» letter blocks + «СНЕЖНАЯ ГОНКА» */
function logo(): HTMLElement {
  const word = Array.from(tr({ ru: 'НУБИК', en: 'NOOB' }));
  const w = h('div', { class: 'lg-w' });
  // blocks shrink to fit long translations (CSS: min(--bs, container width / --n))
  w.style.setProperty('--n', String(Math.max(4, word.length)));
  word.forEach((ch, i) => { const b = h('span', { class: 'lg-b' }, ch); b.style.setProperty('--c', BLOCKS[i % BLOCKS.length]); w.append(b); });
  const sub = h('div', { class: 'lg-s' }, tr({ ru: 'СНЕЖНАЯ ГОНКА', en: 'SNOWBALL RUSH' }));
  const el = h('div', { class: 'mn-logo', role: 'heading', 'aria-level': '1' }, w, sub);
  fitText(sub, 1, 0.5);
  return el;
}

export function createMenu(ctx: Ctx): MenuApi {
  addCSS('menu', CSS);
  const s = () => ctx.save;
  const feats = new Map<Feature, HTMLButtonElement>();
  const locked = new Map<Feature, boolean | null>();

  // ---- feature buttons
  const fs = h('div', { class: 'mn-fs' });
  for (const f of ORDER) {
    const b = btn([], () => {
      if (!isUnlocked(s(), f)) { toast(ctx, lockLabel(f)); return; }
      ctx.nav[f]();
    });
    feats.set(f, b);
    locked.set(f, null);
    fs.append(b);
  }

  // ---- PLAY
  const lvl = h('span', { class: 'sub' });
  const playLbl = h('span', { class: 'lbl' }, tr({ ru: 'ИГРАТЬ', en: 'PLAY' }), lvl);
  const play = btn([icon('play'), playLbl], () => ctx.nav.play(), 'green big mn-go');
  fitText(playLbl, 2, 0.6);

  // ---- league chip
  const lgName = h('div', { class: 'nm' });
  const lgBar: Progress = progress(0, { seg: 8 });
  const lg = h('div', { class: 'mn-lg' }, icon('trophy', 54), h('div', { class: 'col' }, lgName, lgBar.el));

  // ---- offers, toggles
  const ofs = h('div', { class: 'mn-ofs' });
  const toggles = soundButtons(ctx);
  const el = h('div', { class: 'mn hidden' },
    garland(),
    h('div', { class: 'mn-l' }, logo(), lg, ofs),
    fs,
    h('div', { class: 'mn-pl' }, h('div', { class: 'mn-pw' }, play)),
    h('div', { class: 'mn-tg' }, toggles.el));
  layer(ctx, 'screen').append(el);

  let vis = false, timer = 0, offerKey = '', lvlShown = -1, trophiesShown = -1;

  const updOffers = (now: number) => {
    const list = isUnlocked(s(), 'shop') ? activeOffers(s(), now).slice(0, 3) : [];
    const key = list.map((o) => o.id).join('|');
    if (key === offerKey) return;
    offerKey = key;
    ofs.replaceChildren(...list.map((o) => {
      try { return offerBanner(ctx, o); } catch { return fallbackBanner(ctx, o); }
    }));
  };

  const refresh = () => {
    const sv = s(), now = ctx.now();
    // level
    if (sv.level !== lvlShown) { lvlShown = sv.level; setText(lvl, tr({ ru: `Уровень ${sv.level + 1}`, en: `Level ${sv.level + 1}` })); fitText(playLbl, 2, 0.6); }
    // league
    if (sv.trophies !== trophiesShown) {
      trophiesShown = sv.trophies;
      const i = leagueOf(sv.trophies), L = LEAGUES[i], next = LEAGUES[i + 1];
      lg.style.setProperty('--lc', L.color);
      setText(lgName, tr(L.name));
      lgName.title = tr(L.name);
      if (next) lgBar.set((sv.trophies - L.min) / (next.min - L.min), `${fmtNum(sv.trophies)} / ${fmtNum(next.min)}`);
      else lgBar.set(1, fmtNum(sv.trophies));
    }
    // feature buttons: lock state, labels, dots
    for (const f of ORDER) {
      const b = feats.get(f)!, open = isUnlocked(sv, f);
      if (locked.get(f) !== !open) {
        locked.set(f, !open);
        b.classList.remove('blue', 'green', 'gold', 'red', 'locked');
        b.classList.add(open ? COLOR[f] : 'locked');
        const lbl = open ? h('span', { class: 'lbl' }, featureName(f)) : lines(featureName(f), lockShort(f));
        b.replaceChildren(icon(FEATURE_ICON[f]), lbl);
        b.setAttribute('aria-label', open ? featureName(f) : `${featureName(f)}: ${lockLabel(f)}`);
        fitText(lbl, 2, 0.55);
      }
      let d: boolean | number = false;
      if (open) {
        if (f === 'daily') d = canClaimDaily(sv, now);
        else if (f === 'cases') {
          const keys = sv.keys.snow + sv.keys.ice + sv.keys.santa;
          d = keys > 0 ? keys : freebieAvailable(sv, 'case') || (ctx.sdk.rewardedSupported && sv.freeCase <= now);
        } else if (f === 'upgrades') d = freebieAvailable(sv, 'upgrade');
        else if (f === 'wardrobe') d = freebieAvailable(sv, 'skin');
      }
      dot(b, d);
    }
    updOffers(now);
    toggles.sync();
  };

  const api: MenuApi = {
    el,
    playButton: play,
    button: (f) => feats.get(f)!,
    show() {
      vis = true;
      el.classList.remove('hidden');
      refresh();
      // time-based state (calendar day, free case timer, offers expiring) — cheap checks, DOM touched on change only
      if (!timer) timer = window.setInterval(() => { if (vis) refresh(); }, 1000);
    },
    hide() {
      vis = false;
      el.classList.add('hidden');
      clearInterval(timer);
      timer = 0;
    },
    get visible() { return vis; },
    refresh,
  };
  refresh();
  return api;
}
