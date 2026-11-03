// Fake online matchmaking screen (owner: ui-core): slots fill with opponents over ~2-4 s, online counter. Resolves when done.
import { h } from 'aiwebengine/ui';
import type { Ctx, Profile } from './types';
import { addCSS } from './theme';
import { avatar, badge, fitText, icon, layer, setText } from './widgets';
import { LEAGUES, leagueOf } from './catalog';
import { onlineCount } from './bots';
import { sfx } from './audio';
import { tr } from './i18n';
import { fmtNum } from './util';

const CSS = `
.mm{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:calc(var(--top) - 10u) 24u 24u;background:rgba(3,8,22,.6);pointer-events:auto;animation:fade .2s}
.mm>.panel{width:min(100%,1180u);max-height:100%;padding:30u 26u 22u;align-items:center;gap:20u;animation:pop .22s ease-out}
.mm-h{display:flex;align-items:center;justify-content:center;gap:18u;max-width:100%}
.mm-h>.ic{width:64u;height:64u;flex:none;animation:mmspin 1.2s steps(8) infinite}
.mm-h>.ic.ok{animation:pop .3s ease-out}
.mm-h>.ttl{font-size:44u}
@keyframes mmspin{to{rotate:1turn}}
.mm-try{padding:6u 18u 9u;font-size:24u;font-weight:700;color:#7ee26a;background:rgba(10,40,12,.6);box-shadow:0 0 0 3u var(--ol);text-align:center}
.mm-sl{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:20u;width:100%}
.mm-c{--lc:#3a4352;position:relative;display:flex;flex-direction:column;align-items:center;gap:8u;min-width:0;padding:16u 8u 18u;
background:linear-gradient(#22385f,#0d1830);box-shadow:inset 0 -8u 0 var(--lc),inset 0 0 0 3u rgba(255,255,255,.12),0 0 0 3u var(--ol),0 8u 0 rgba(0,0,0,.3)}
.mm-c.me{background:linear-gradient(#5a4410,#2a1f08);box-shadow:inset 0 -8u 0 var(--lc),inset 0 0 0 4u #ffd447,0 0 0 3u var(--ol),0 8u 0 rgba(0,0,0,.3)}
.mm-c.in{animation:pop .35s cubic-bezier(.2,1.6,.4,1)}
.mm-c>.ava{width:96u;height:96u}
.mm-c .nm{max-width:100%;font-size:22u;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mm-c .tr{display:flex;align-items:center;gap:4u;font-size:20u;color:#ffe9a0}
.mm-c .tr>.ic{width:26u;height:26u}
.mm-c .lg{font-size:16u;color:var(--lc);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.mm-c .cr{position:absolute;top:-24u;left:50%;width:44u;height:44u;margin-left:-22u;filter:drop-shadow(0 3u 0 rgba(0,0,0,.4))}
.mm-c.wait>.ava{opacity:.35;animation:mmw 1s ease-in-out infinite}
.mm-q{display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:52u;color:#a9bdd6}
@keyframes mmw{50%{opacity:.15}}
.mm-on{display:flex;align-items:center;gap:10u;font-size:24u;color:#c6d4ea}
.mm-on::before{content:'';width:16u;height:16u;background:#5fd35a;box-shadow:0 0 0 3u var(--ol),0 0 12u #5fd35a;animation:dotb 1s steps(2) infinite}
@media (max-aspect-ratio:4/5){
.mm>.panel{width:min(100%,680u)}
.mm-sl{grid-template-columns:1fr;gap:14u}
.mm-c{flex-direction:row;gap:16u;padding:10u 22u 14u 12u;text-align:left}
.mm-c>.ava{width:76u;height:76u}
.mm-c .col{flex:1 1 auto;min-width:0;gap:2u;align-items:flex-start}
.mm-c .nm{font-size:26u}.mm-c .tr{font-size:22u}
.mm-c .cr{top:-12u;left:62u;margin:0;width:38u;height:38u}
}
@media (min-aspect-ratio:4/5){.mm-c .col{display:contents}}
`;

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** one slot card; empty (waiting) until fill() */
function slot(): { el: HTMLElement; fill(p: Profile, me: boolean): void } {
  const ava = h('div', { class: 'ava' }, h('span', { class: 'mm-q' }, '?'));
  const nm = h('div', { class: 'nm' }, '…');
  const trph = h('div', { class: 'tr' });
  const lg = h('div', { class: 'lg' });
  const el = h('div', { class: 'mm-c wait' }, ava, h('div', { class: 'col' }, nm, trph, lg));
  return {
    el,
    fill(p, me) {
      const L = LEAGUES[leagueOf(p.trophies)];
      el.classList.remove('wait');
      el.classList.toggle('me', me);
      el.style.setProperty('--lc', L.color);
      ava.replaceWith(avatar(p.skin, 96));
      setText(nm, p.name);
      nm.title = p.name;
      trph.replaceChildren(icon('trophy', 26), h('b', null, fmtNum(p.trophies)));
      setText(lg, tr(L.name));
      if (p.vip) { const c = icon('crown', 44); c.classList.add('cr'); el.append(c); }
      if (me) el.append(badge(tr({ ru: 'Ты', en: 'You' }), 'new'));
      el.classList.add('in');
    },
  };
}

/** "Searching for opponents…": the player's slot first, opponents pop in one by one over 2–4 s, then "Found!" */
export function matchmaking(ctx: Ctx, player: Profile, opponents: Profile[]): Promise<void> {
  addCSS('mm', CSS);
  const title = h('h2', { class: 'ttl' }, tr({ ru: 'Поиск соперников…', en: 'Finding opponents…' }));
  const spin = icon('snowflake', 64);
  const slots = [player, ...opponents].map(() => slot());
  const online = h('div', { class: 'mm-on' });
  const tries = ctx.save.tries;
  const panel = h('div', { class: 'panel' },
    h('div', { class: 'mm-h' }, spin, title),
    tries > 0 ? h('div', { class: 'mm-try' }, tr({ ru: `Попытка ${tries + 1} — уровень стал легче!`, en: `Attempt ${tries + 1}: the level got easier!` })) : null,
    h('div', { class: 'mm-sl' }, ...slots.map((s) => s.el)),
    online);
  const root = h('div', { class: 'mm' }, panel);
  root.addEventListener('pointerdown', (e) => e.stopPropagation());
  layer(ctx, 'modal').append(root);
  fitText(title, 2, 0.6);

  // fake online counter: the hourly curve from bots.ts + a little live jitter
  const base = onlineCount(ctx.now());
  let jit = 0;
  const showOnline = () => setText(online, tr({ ru: `Сейчас играют: ${fmtNum(base + jit)}`, en: `Playing now: ${fmtNum(base + jit)}` }));
  showOnline();
  const tick = window.setInterval(() => { jit += Math.round((Math.random() - 0.45) * 30); showOnline(); }, 700);

  slots[0].fill(player, true);
  // arrival times: sorted random moments within a 2–4 s total
  const total = 2000 + Math.random() * 2000;
  const times = opponents.map(() => 250 + Math.random() * (total - 250)).sort((a, b) => a - b);
  times[times.length - 1] = total;

  return (async () => {
    let t = 0;
    for (let i = 0; i < opponents.length; i++) {
      await wait(times[i] - t);
      t = times[i];
      slots[i + 1].fill(opponents[i], false);
      sfx('pop');
    }
    setText(title, tr({ ru: 'Соперники найдены!', en: 'Opponents found!' }));
    fitText(title, 2, 0.6);
    const ok = icon('check', 64);
    ok.classList.add('ok');
    spin.replaceWith(ok);
    sfx('bell');
    await wait(600);
    clearInterval(tick);
    root.remove();
  })();
}
