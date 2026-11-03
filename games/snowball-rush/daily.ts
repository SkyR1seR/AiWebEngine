// New Year calendar (owner: ui-store): 7 day cells, claim today's gift.
// A popup (shown over the menu) styled as an advent calendar: wrapped gift doors, claimed ones ticked, today's glowing,
// future ones closed (their reward is visible but dimmed — a reason to come back). A missed day does not reset the loop.
// Coin gifts can be doubled for a rewarded ad ('daily_double').
import { h } from 'aiwebengine/ui';
import type { Ctx, Reward, ScreenApi } from './types';
import { DAILY, grantRewards } from './catalog';
import { addCSS } from './theme';
import { adBtn, btn, itemArt, modal, rewardLabel, showRewards, timerChip, toast, type Modal } from './widgets';
import { tr } from './i18n';
import { dayKey, fmtNum } from './util';

const CSS = `
.dl-pop{width:min(100%,1060u)}
.dl-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:22u 18u;width:100%;padding:16u 6u 8u}
.dl-c{--g:#c8342c;--gl:#e85a4a;--rb:#ffd447;position:relative;display:flex;flex-direction:column;align-items:center;gap:4u;min-width:0;padding:44u 8u 12u;
background:linear-gradient(90deg,transparent calc(50% - 7u),var(--rb) 0 calc(50% + 7u),transparent 0),linear-gradient(transparent 26u,var(--rb) 0 36u,transparent 0),linear-gradient(var(--gl),var(--g));
box-shadow:inset 0 0 0 3u rgba(255,255,255,.25),inset 0 -8u 0 rgba(0,0,0,.25),0 0 0 3u var(--ol),0 9u 0 rgba(0,0,0,.3)}
.dl-c:nth-child(3n+2){--g:#2b8a3a;--gl:#46b552;--rb:#f04848}.dl-c:nth-child(3n){--g:#2a62c4;--gl:#4a8af0;--rb:#f0f0f0}
.dl-c::before{content:'';position:absolute;left:calc(50% - 26u);top:-16u;width:52u;height:28u;background:
radial-gradient(circle at 30% 50%,var(--rb) 0 9u,transparent 10u),radial-gradient(circle at 70% 50%,var(--rb) 0 9u,transparent 10u);filter:drop-shadow(0 0 0 var(--ol)) drop-shadow(0 3u 0 rgba(0,0,0,.4))}
.dl-day{position:absolute;left:6u;top:4u;font-size:18u;font-weight:700;text-shadow:var(--tol2)}
.dl-c>.art{position:relative;z-index:1;width:96u;height:96u;padding:6u;background:rgba(5,12,30,.55);box-shadow:0 0 0 3u var(--ol)}
.dl-amt{font-size:22u;font-weight:700;text-shadow:var(--tol2);text-align:center;max-width:100%;overflow-wrap:break-word;min-height:1.2em}
.dl-c .btn{width:100%;margin-top:4u}
.dl-c.done>.art,.dl-c.done>.dl-amt{opacity:.45;filter:grayscale(.6)}
.dl-c.done::after{content:'';position:absolute;z-index:2;left:calc(50% - 34u);top:42u;width:68u;height:68u;background:var(--i-check) center/contain no-repeat;filter:drop-shadow(0 4u 0 rgba(0,0,0,.5))}
.dl-c.lock{filter:brightness(.8) saturate(.8)}
.dl-c.lock:not(.big)>.art{opacity:.75}
.dl-c.lock::after{content:'';position:absolute;z-index:2;right:-10u;top:-10u;width:34u;height:34u;background:var(--i-lock) center/contain no-repeat}
.dl-c.today{z-index:1;animation:dlb 1.4s ease-in-out infinite;box-shadow:inset 0 0 0 3u rgba(255,255,255,.4),inset 0 -8u 0 rgba(0,0,0,.25),0 0 0 3u var(--ol),0 0 0 7u #ffe14d,0 0 34u 10u rgba(255,225,77,.55)}
@keyframes dlb{0%,100%{scale:1}50%{scale:1.04}}
.dl-c.next{box-shadow:inset 0 0 0 3u rgba(255,255,255,.25),0 0 0 3u var(--ol),0 0 0 6u #9fe0ff}
.dl-c .timer{font-size:18u;min-height:32u;margin-top:4u}
.dl-c.big{grid-column:span 2;flex-direction:row;flex-wrap:wrap;justify-content:center;gap:6u 14u;--g:#c08a10;--gl:#f2c23a;--rb:#d83030}
.dl-c.big>.art{width:120u;height:120u}
.dl-c.big .dl-col{display:flex;flex-direction:column;align-items:center;gap:6u;flex:1 1 160u;min-width:0}
.dl-c.big .dl-amt{font-size:30u}
.dl-c.big .dl-top{font-size:24u;font-weight:700;color:#fff3a6;text-shadow:var(--tol2)}
.dl-txt{margin:0;font-size:22u;color:#c6d4ea;max-width:860u}
@media (max-aspect-ratio:4/5){.dl-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.dl-c.big{grid-column:span 3}}
@media (min-aspect-ratio:4/5) and (max-height:560px){.dl-c>.art{width:72u;height:72u}.dl-c.big>.art{width:90u;height:90u}.dl-grid{gap:18u 14u}}
`;

/** art for a calendar reward */
function rewardArt(r: Reward): HTMLElement {
  switch (r.kind) {
    case 'coins': case 'gems': return itemArt(r.kind, undefined, 0);
    case 'key': return itemArt('key', r.id, 0);
    case 'skin': case 'ball': return itemArt(r.kind, r.id, 0);
    default: return itemArt('noAds', undefined, 0);
  }
}

/** local midnight after `now` (next claim) */
function nextDay(now: number): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
}

export function createDaily(ctx: Ctx): ScreenApi & { claimable(): boolean } {
  addCSS('daily', CSS);
  let m: Modal | null = null;
  let grid: HTMLElement | null = null;
  const claimable = () => ctx.save.daily.last !== dayKey(ctx.now());

  const claim = async (mult: number) => {
    if (!claimable()) return;
    const s = ctx.save, base = DAILY[s.daily.day % DAILY.length];
    const r: Reward = base.kind === 'coins' ? { kind: 'coins', n: base.n * mult } : base;
    grantRewards(s, [r]);
    s.daily = { day: s.daily.day + 1, last: dayKey(ctx.now()) };
    ctx.persist();
    ctx.refresh();
    render();
    await showRewards(ctx, [r], tr({ ru: 'Подарок дня!', en: "Today's gift!" }));
    ctx.refresh();
  };

  const render = () => {
    if (!grid) return;
    const s = ctx.save, now = ctx.now(), can = claimable();
    const pos = s.daily.day % DAILY.length;
    // after the 7th gift (claimed today) the whole week stays ticked until tomorrow
    const weekDone = !can && pos === 0 && s.daily.day > 0;
    grid.replaceChildren(...DAILY.map((r, i) => {
      const done = weekDone || i < pos, today = can && i === pos, next = !can && !weekDone && i === pos;
      const big = i === DAILY.length - 1;
      const c = h('div', { class: `dl-c${done ? ' done' : today ? ' today' : next ? ' next' : ' lock'}${big ? ' big' : ''}` },
        h('span', { class: 'dl-day' }, tr({ ru: `День ${i + 1}`, en: `Day ${i + 1}` })));
      const amt = h('div', { class: 'dl-amt' }, r.kind === 'coins' || r.kind === 'gems' ? `+${fmtNum(r.n)}` : rewardLabel(r));
      const extra: HTMLElement[] = [];
      if (today) {
        extra.push(btn(tr({ ru: 'Забрать', en: 'Claim' }), () => void claim(1), 'green small'));
        if (r.kind === 'coins' && ctx.sdk.rewardedSupported) {
          const ab: HTMLButtonElement = adBtn(tr({ ru: '×2', en: '×2' }), async () => {
            ab.classList.add('busy');
            let ok = false;
            try { ok = await ctx.sdk.showRewarded('daily_double'); } catch { ok = false; }
            ab.classList.remove('busy');
            if (ok) void claim(2);
            else toast(ctx, tr({ ru: 'Награда не получена: видео не досмотрено или недоступно', en: 'No reward: the video was skipped or is unavailable' }), 'bad');
          }, 'small');
          ab.title = ab.ariaLabel = tr({ ru: 'Удвоить за рекламу', en: 'Double it for an ad' });
          extra.push(ab);
        }
      } else if (next) extra.push(timerChip(ctx, nextDay(now), render));
      if (big) c.append(rewardArt(r), h('div', { class: 'dl-col' }, h('div', { class: 'dl-top' }, tr({ ru: 'Главный приз!', en: 'Grand prize!' })), amt, ...extra));
      else c.append(rewardArt(r), amt, ...extra);
      return c;
    }));
  };

  const api = {
    show() {
      if (m) { render(); return; }
      grid = h('div', { class: 'dl-grid' });
      render();
      m = modal(ctx, [
        h('p', { class: 'txt dl-txt' }, tr({ ru: 'Заходи каждый день за подарком! На седьмой день — самый большой.', en: 'Come back every day for a gift! The biggest one waits on day 7.' })),
        grid,
      ], {
        title: tr({ ru: 'Новогодний календарь', en: 'Gift Calendar' }), cls: 'wide gold dl-pop',
        onClose: () => { m = null; grid = null; },
      });
    },
    hide() { m?.close(); },
    get visible() { return !!m; },
    refresh() { render(); },
    claimable,
  };
  return api;
}
