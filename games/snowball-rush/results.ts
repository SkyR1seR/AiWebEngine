// Race results (owner: ui-core): places table, rewards (coins, trophies, gems, league up), x2 for an ad, next/retry/menu.
import { h } from 'aiwebengine/ui';
import type { Ctx, Racer } from './types';
import { addCSS } from './theme';
import { avatar, btn, fitText, flyCurrency, icon, modal, money, rewardedBtn, setText } from './widgets';
import { LEAGUES } from './catalog';
import { earn } from './save';
import { sfx } from './audio';
import { tr } from './i18n';
import { fmtNum } from './util';

export interface ResultData {
  level: number;
  place: number;
  passed: boolean;
  /** all racers sorted by place */
  racers: Racer[];
  player: Racer;
  /** coins before the x2 ad (already added to the save) */
  coins: number;
  collected: number;
  mult: number;
  trophies: number;
  gems: number;
  /** league reached for the first time (index) or -1 */
  leagueUp: number;
}

const CSS = `
.rs.panel{width:min(100%,1120u)}
.rs .mbody{gap:14u;padding-top:30u}
.rs-hd{position:relative;isolation:isolate;display:flex;flex-direction:column;align-items:center;gap:4u;max-width:100%}
.rs-hd>.ttl{font-size:60u}
.rs-hd>.rays{top:50%;width:520u}
.rs-hd.win>.ttl{color:#ffd447}.rs-hd.lose>.ttl{color:#ffb3a8}
.rs-hint{font-size:24u;color:#c6d4ea}
.rs-main{display:flex;flex-wrap:wrap;justify-content:center;gap:20u 28u;width:100%}
.rs-tb{flex:1 1 440u;max-width:560u;display:flex;flex-direction:column;gap:8u}
.rs-row{display:flex;align-items:center;gap:12u;min-height:56u;padding:4u 14u 4u 8u;font-size:24u;text-align:left;background:rgba(255,255,255,.06);box-shadow:inset 0 0 0 3u rgba(0,0,0,.32)}
.rs-row.me{background:rgba(255,212,71,.22);box-shadow:inset 0 0 0 3u #ffd447,0 0 0 3u var(--ol)}
.rs-row.in{animation:tin .3s ease-out both}
.rs-pl{flex:none;display:flex;align-items:center;justify-content:center;width:44u;height:44u;font-size:28u;font-weight:700;color:#a9bdd6}
.rs-pl>.ic{width:44u;height:44u}
.rs-row>.ava{width:48u;height:48u;padding:2u}
.rs-nm{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:6u;font-weight:700}
.rs-nm>span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rs-nm>.ic{width:28u;height:28u}
.rs-t{flex:none;font-variant-numeric:tabular-nums;color:#c6d4ea}
.rs-rw{flex:1 1 300u;max-width:460u;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14u;padding:16u;
background:rgba(0,0,0,.28);box-shadow:inset 0 0 0 3u rgba(0,0,0,.35),inset 0 6u 0 rgba(0,0,0,.18)}
.rs-coins{display:flex;align-items:center;gap:12u;font-size:58u}
.rs-coins>.ic{width:64u;height:64u}
.rs-x2{font-size:34u;color:#7ee26a;font-weight:700;animation:pop .4s ease-out}
.rs-det{display:flex;flex-wrap:wrap;justify-content:center;gap:8u 18u;font-size:21u;color:#c6d4ea}
.rs-det>span{display:inline-flex;align-items:center;gap:4u;white-space:nowrap}
.rs-det .ic{width:24u;height:24u}
.rs-ch{display:flex;flex-wrap:wrap;justify-content:center;gap:12u 20u}
.rs-ch>.chip{font-size:28u}
.rs-ch .ic{width:36u;height:36u}
.rs-lu{--lc:#bfe3ff;max-width:100%;padding:8u 18u 11u;font-size:26u;font-weight:700;text-align:center;color:#fff;background:linear-gradient(90deg,rgba(0,0,0,.2),var(--lc) 50%,rgba(0,0,0,.2));
box-shadow:0 0 0 3u var(--ol);text-shadow:var(--tol2);animation:pop .5s .5s cubic-bezier(.2,1.6,.4,1) both}
@media (min-aspect-ratio:4/5){.rs .mbody{padding-top:22u}.rs-hd>.ttl{font-size:50u}.rs-row{min-height:48u}.rs-row>.ava{width:42u;height:42u}.rs-pl,.rs-pl>.ic{width:38u;height:38u}}
@media (min-aspect-ratio:4/5) and (max-aspect-ratio:5/4){
.rs .mbody{gap:10u;padding:20u 16u 10u}.rs-hd>.ttl{font-size:42u}.rs-hint{font-size:20u}
.rs-tb{flex-basis:100%;gap:6u}.rs-row{min-height:42u;font-size:22u}.rs-row>.ava{width:38u;height:38u}.rs-pl,.rs-pl>.ic{width:34u;height:34u}
.rs-rw{flex-direction:row;flex-wrap:wrap;max-width:none;gap:8u 18u;padding:8u}.rs-coins{font-size:44u}.rs-coins>.ic{width:48u;height:48u}
.rs .mfoot{flex-wrap:nowrap;gap:14u;padding:4u 16u 20u}.rs .mfoot>.btn{flex:1 1 0;min-height:68u;padding:6u 14u 12u;font-size:24u}.rs .mfoot>.btn:first-child{flex:none}.rs .mfoot>.btn:first-child>.lbl{display:none}}
.rs .mfoot>.btn{hyphens:manual;overflow-wrap:normal}
`;

/** race time "1:05.3" (seconds → m:ss.d) */
export function fmtRace(s: number): string {
  const m = Math.floor(s / 60), r = s - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}`;
}

/** results headline by place: 1 victory, 2–3 top-3 (level passed), 4–5 try again (+ a hint that it gets easier) */
export function resultTitle(place: number): { text: string; cls: 'win' | 'top' | 'lose'; hint?: string } {
  if (place === 1) return { text: tr({ ru: 'ПОБЕДА!', en: 'VICTORY!' }), cls: 'win' };
  if (place >= 2 && place <= 3) return { text: tr({ ru: 'ТОП-3! Уровень пройден', en: 'TOP 3! Level complete' }), cls: 'top' };
  return { text: tr({ ru: 'Не сдавайся!', en: "Don't give up!" }), cls: 'lose', hint: tr({ ru: 'В следующий раз будет легче', en: 'It will be a little easier next time' }) };
}

/** shows the screen; the x2 ad adds coins itself; resolves with the chosen action */
export function showResults(ctx: Ctx, r: ResultData): Promise<'next' | 'retry' | 'menu'> {
  addCSS('results', CSS);
  sfx(r.passed ? 'win' : 'lose');
  const t = resultTitle(r.place);
  const ttl = h('h2', { class: 'ttl' }, t.text);
  const head = h('div', { class: `rs-hd ${t.cls}` }, r.place === 1 ? h('div', { class: 'rays' }) : null, ttl, t.hint ? h('div', { class: 'rs-hint' }, t.hint) : null);

  // places table
  const rows = r.racers.map((x, i) => {
    const pl = x.place || i + 1;
    const medal = pl <= 3 && x.place > 0 ? icon((['medal1', 'medal2', 'medal3'] as const)[pl - 1], 44) : h('span', null, String(pl));
    const nm = h('div', { class: 'rs-nm' }, h('span', null, x.profile.name), x.profile.vip ? icon('crown', 28) : null);
    const row = h('div', { class: `rs-row${x === r.player ? ' me' : ''}` }, h('div', { class: 'rs-pl' }, medal), avatar(x.profile.skin, 48), nm,
      h('div', { class: 'rs-t' }, x.place > 0 && x.finishTime > 0 ? fmtRace(x.finishTime) : '—'));
    row.classList.add('in');
    row.style.animationDelay = `${0.15 + i * 0.08}s`;
    return row;
  });

  // rewards
  const coinN = h('b', null, '0');
  const coins = h('div', { class: 'rs-coins money' }, icon('coin', 64), coinN);
  const det = h('div', { class: 'rs-det' },
    h('span', null, tr({ ru: `Собрано на трассе: ${fmtNum(r.collected)}`, en: `Picked up: ${fmtNum(r.collected)}` })),
    r.mult > 1 ? h('span', { class: 'c-gold' }, tr({ ru: `Бонус ×${r.mult}`, en: `Bonus ×${r.mult}` })) : null);
  const tcol = r.trophies >= 0 ? 'c-good' : 'c-bad';
  const chips = h('div', { class: 'rs-ch' },
    h('span', { class: `chip ${tcol}` }, icon('trophy', 36), h('b', null, `${r.trophies >= 0 ? '+' : '−'}${Math.abs(r.trophies)}`)),
    r.gems > 0 ? h('span', { class: 'chip c-ice' }, money('gems', `+${fmtNum(r.gems)}`, 28)) : null);
  const rw = h('div', { class: 'rs-rw' }, coins, det, chips);
  if (r.leagueUp >= 0 && LEAGUES[r.leagueUp]) {
    const L = LEAGUES[r.leagueUp], name = tr(L.name);
    const lu = h('div', { class: 'rs-lu' }, tr({ ru: `Новая лига: ${name}!`, en: `New league: ${name}!` }));
    lu.style.setProperty('--lc', L.color);
    rw.append(lu);
  }

  // coin count-up (rAF, DOM only on change)
  let shown = 0, raf = 0;
  const countTo = (to: number, ms: number) => {
    cancelAnimationFrame(raf);
    const from = shown, t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms), v = Math.round(from + (to - from) * (1 - (1 - k) ** 3));
      if (v !== shown) { shown = v; setText(coinN, fmtNum(v)); }
      if (k < 1) raf = requestAnimationFrame(step); else sfx('coin');
    };
    raf = requestAnimationFrame(step);
  };

  return new Promise((res) => {
    let choice: 'next' | 'retry' | 'menu' = 'menu';
    const done = (c: typeof choice) => { choice = c; m.close(); };
    const x2 = rewardedBtn(ctx, tr({ ru: '×2 за рекламу', en: '×2 for an ad' }), 'double_reward', () => {
      earn(ctx.save, 'coins', r.coins);
      ctx.persist();
      ctx.refresh();
      x2.classList.add('hidden');
      coins.after(h('div', { class: 'rs-x2' }, tr({ ru: 'Награда удвоена!', en: 'Reward doubled!' })));
      countTo(r.coins * 2, 700);
      void flyCurrency(ctx, 'coins', coins);
    }, 'big');
    if (r.coins <= 0) x2.classList.add('hidden');
    const menuLbl = tr({ ru: 'Меню', en: 'Menu' });
    const menuBtn = btn([icon('home'), menuLbl], () => done('menu'));
    menuBtn.setAttribute('aria-label', menuLbl);
    const main = r.passed
      ? btn([tr({ ru: 'Дальше', en: 'Next' }), icon('next')], () => done('next'), 'green big')
      : btn([icon('play'), tr({ ru: 'Ещё раз', en: 'Try again' })], () => done('retry'), 'green big');
    const m = modal(ctx, [head, h('div', { class: 'rs-main' }, h('div', { class: 'rs-tb' }, ...rows), rw)], {
      cls: 'rs gold wide',
      closable: false,
      foot: [menuBtn, x2, main],
      onClose: () => { cancelAnimationFrame(raf); res(choice); },
    });
    fitText(ttl, 2, 0.5);
    // long translations: shrink the button labels rather than overflow (square screens keep the buttons in one row)
    m.el.querySelectorAll<HTMLElement>('.mfoot .lbl').forEach((l) => fitText(l, 2, 0.6));
    setTimeout(() => countTo(r.coins, 900), 350);
  });
}
