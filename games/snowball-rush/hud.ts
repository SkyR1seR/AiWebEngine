// In-race HUD (owner: ui-core): place, progress bar with racer markers, ball size meter, coins, countdown, event texts, hints, pause.
// Lives in the .lay-hud layer; everything is click-through (pointer-events none) except the pause button, so drag
// steering anywhere on the screen keeps working. update() runs every frame and touches the DOM only on changes.
import { h } from 'aiwebengine/ui';
import type { Ctx, Racer } from './types';
import type { RaceSim } from './sim';
import { addCSS } from './theme';
import { btn, fitText, icon, layer, modal, setText } from './widgets';
import { skinColor, skinPortrait } from './skinart';
import { soundButtons } from './menu';
import { sfx } from './audio';
import { tr } from './i18n';
import { fmtNum } from './util';

const CSS = `
.hud{position:absolute;inset:0;pointer-events:none;font-weight:700}
.hud-l{position:absolute;left:18u;top:14u;display:flex;align-items:flex-start;gap:16u}
.hud-l>.btn{pointer-events:auto}
.hud-ps{display:block;width:38%;height:42%;background:linear-gradient(90deg,#fff 0 34%,transparent 34% 66%,#fff 66%);filter:drop-shadow(3u 3u 0 rgba(0,0,0,.45))}
.hud-pl{--pc:#fff;display:flex;align-items:baseline;color:var(--pc);text-shadow:var(--tol);line-height:.9;margin-top:-2u}
.hud-pl>b{font-size:84u}.hud-pl>span{font-size:38u;color:#e9f0fa}
.hud-r{position:absolute;right:18u;top:14u;display:flex;flex-direction:column;align-items:flex-end;gap:14u}
.hud-c{display:inline-flex;align-items:center;gap:8u;min-height:52u;padding:2u 16u 4u 8u;font-size:30u;background:rgba(7,15,34,.78);
box-shadow:inset 0 -4u 0 rgba(0,0,0,.45),inset 0 3u 0 rgba(255,255,255,.1),0 0 0 3u var(--ol);white-space:nowrap}
.hud-c>.ic{width:40u;height:40u}
.hud-sz{min-height:68u;padding-right:20u;font-size:44u;color:#e8f6ff}
.hud-sz>.ic{width:54u;height:54u}
.hud-sz.melt{color:#ff6b5e;box-shadow:inset 0 -4u 0 rgba(0,0,0,.45),0 0 0 3u var(--ol),0 0 0 6u rgba(255,90,78,.7);animation:hmelt .3s steps(2) infinite}
@keyframes hmelt{50%{translate:2u 0}}
.hud-pw{display:flex;gap:10u}
.hud-pw>.hud-c{font-size:26u;min-height:46u}
.hud-pw>.hud-c>.ic{width:34u;height:34u}
.hud-bt{position:relative;width:70u;height:12u;background:#0a1328;box-shadow:0 0 0 3u var(--ol)}
.hud-bt>b{position:absolute;left:0;top:0;bottom:0;width:100%;background:#ffd447;transform-origin:left;transition:transform .1s linear}
.hud-tr{position:absolute;top:66u;left:50%;width:min(620u,calc(100% - 640u));transform:translateX(-50%)}
.hud-bar{position:relative;height:20u;background:linear-gradient(#cfe6ff,#8fb6e0);box-shadow:inset 0 -5u 0 rgba(0,0,0,.25),0 0 0 3u var(--ol),0 6u 0 rgba(0,0,0,.3)}
.hud-bar>b{position:absolute;left:0;top:0;bottom:0;width:100%;background:linear-gradient(#8ae26c,#3faa3a);transform-origin:left;transform:scaleX(0)}
.hud-mk{position:absolute;left:0;bottom:-4u;width:24u;height:28u;margin-left:-12u;background:var(--mc);box-shadow:0 0 0 3u var(--ol),inset -3u -3u 0 rgba(0,0,0,.3),inset 3u 3u 0 rgba(255,255,255,.35)}
.hud-mk.me{z-index:2;width:46u;height:46u;margin-left:-23u;bottom:34u;background:#22385f;box-shadow:0 0 0 3u #ffd447,0 0 0 6u var(--ol)}
.hud-mk.me::after{content:'';position:absolute;left:50%;bottom:-20u;margin-left:-8u;border:8u solid transparent;border-top:9u solid #ffd447}
.hud-mk>canvas{display:block;width:100%;height:100%}
.hud-fin{position:absolute;right:-26u;bottom:-8u;width:44u;height:44u}
.hud-mid{position:absolute;left:0;right:0;display:flex;justify-content:center;text-align:center;padding:0 24u}
.hud-cd{top:30%;font-size:190u;line-height:1;text-shadow:var(--tol),0 12u 0 var(--ol)}
.hud-cd.go{font-size:130u;color:#7ee26a}
.hud-fl{top:24%;font-size:62u;line-height:1.05;text-shadow:var(--tol)}
.hud-hint>div{max-width:min(92%,820u);padding:14u 24u 18u;font-size:30u;line-height:1.25;background:rgba(7,15,34,.82);
box-shadow:inset 0 -5u 0 rgba(0,0,0,.4),inset 0 3u 0 rgba(255,255,255,.12),0 0 0 3u var(--ol),0 9u 0 rgba(0,0,0,.3);animation:tin .25s ease-out}
.hud-hint{bottom:23%}
@media (max-aspect-ratio:4/5){
.hud-r{flex-direction:row;align-items:flex-start;flex-wrap:wrap-reverse;justify-content:flex-end;max-width:420u}
.hud-tr{top:160u;width:auto;left:46u;right:50u;transform:none}
.hud-pw{position:absolute;right:0;top:206u}
}
@media (max-aspect-ratio:5/4) and (min-aspect-ratio:4/5){.hud-tr{top:170u;width:auto;left:46u;right:330u;transform:none}}
.ps-tg{display:flex;gap:16u;justify-content:center}
`;

/** track progress in percent, rounded to 0.2% steps (fewer DOM writes) */
const prog = (d: number, start: number, span: number) => Math.round(Math.max(0, Math.min(1, (d - start) / span)) * 500) / 5;
// gold, silver, bronze, then a reddish tint for the losing places
const PLACE_COLOR = ['#ffd447', '#cfe0f5', '#f0a060', '#ffb3a8', '#ffb3a8'];

export class Hud {
  /** called when the player chooses "leave race" in the pause dialog */
  onQuit: () => void = () => {};
  /** the HUD root (in the hud layer) */
  readonly el: HTMLElement;
  private _ctx: Ctx;
  private _sim: RaceSim | null = null;
  private _player: Racer | null = null;
  private _place: HTMLElement;
  private _placeN: HTMLElement;
  private _placeOf: HTMLElement;
  private _coins: HTMLElement;
  private _size: HTMLElement;
  private _sizeN: HTMLElement;
  private _pw: HTMLElement;
  private _shield: HTMLElement;
  private _shieldN: HTMLElement;
  private _boost: HTMLElement;
  private _boostBar: HTMLElement;
  private _bar: HTMLElement;
  private _barFill: HTMLElement;
  private _marks: HTMLElement[] = [];
  private _cd: HTMLElement;
  private _fl: HTMLElement;
  private _hint: HTMLElement;
  private _hintTx: HTMLElement;
  /** last shown values (DOM changes only on change) */
  private _v = { pos: -1, n: -1, coins: -1, size: -1, melt: false, shields: -1, boost: -1, fill: -1 };
  private _mx: number[] = [];
  /** boost timer set by power('boost', s): end time (sim clock) and length; 0 = use the racer's boostT */
  private _boostEnd = 0;
  private _boostLen = 2.5;
  private _paused: { close(): void } | null = null;
  private _cdTimer = 0;

  constructor(ctx: Ctx) {
    addCSS('hud', CSS);
    this._ctx = ctx;
    const pause = btn(h('i', { class: 'hud-ps' }), () => this.pause(), 'icon');
    pause.setAttribute('aria-label', tr({ ru: 'Пауза', en: 'Pause' }));
    this._placeN = h('b');
    this._placeOf = h('span');
    this._place = h('div', { class: 'hud-pl' }, this._placeN, this._placeOf);
    this._coins = h('b', null, '0');
    this._sizeN = h('b', null, '0');
    this._size = h('div', { class: 'hud-c hud-sz' }, icon('snowflake', 54), this._sizeN);
    this._shieldN = h('b');
    this._shield = h('div', { class: 'hud-c hidden' }, icon('shield', 34), this._shieldN);
    this._boostBar = h('b');
    this._boost = h('div', { class: 'hud-c hidden' }, icon('boost', 34), h('div', { class: 'hud-bt' }, this._boostBar));
    this._pw = h('div', { class: 'hud-pw' }, this._shield, this._boost);
    this._barFill = h('b');
    this._bar = h('div', { class: 'hud-bar' }, this._barFill, icon('flag', 44));
    this._bar.lastElementChild!.classList.add('hud-fin');
    this._cd = h('div', { class: 'hud-mid hud-cd hidden' });
    this._fl = h('div', { class: 'hud-mid hud-fl hidden' });
    this._hintTx = h('div');
    this._hint = h('div', { class: 'hud-mid hud-hint hidden' }, this._hintTx);
    this.el = h('div', { class: 'hud hidden' },
      h('div', { class: 'hud-tr' }, this._bar),
      h('div', { class: 'hud-l' }, pause, this._place),
      h('div', { class: 'hud-r' }, h('div', { class: 'hud-c' }, icon('coin', 40), this._coins), this._size, this._pw),
      this._cd, this._fl, this._hint);
    layer(ctx, 'hud').append(this.el);
  }

  show(on: boolean): void {
    this.el.classList.toggle('hidden', !on);
    if (!on) { this.hint(null); this._cd.classList.add('hidden'); this._fl.classList.add('hidden'); this._paused?.close(); }
  }

  /** new race: racers (player included) */
  bind(sim: RaceSim, player: Racer): void {
    this._sim = sim;
    this._player = player;
    this._boostEnd = 0;
    for (const m of this._marks) m.remove();
    this._marks = [];
    this._mx = [];
    for (const r of sim.racers) {
      const m = h('i', { class: `hud-mk${r === player ? ' me' : ''}` });
      if (r === player) m.append(skinPortrait(r.profile.skin, 40));
      else m.style.setProperty('--mc', skinColor(r.profile.skin));
      this._bar.append(m);
      this._marks.push(m);
      this._mx.push(-1);
    }
    Object.assign(this._v, { pos: -1, n: -1, coins: -1, size: -1, melt: false, shields: -1, boost: -1, fill: -1 });
    this._size.classList.remove('melt');
    this.hint(null);
    this.update(0);
  }

  update(dt: number): void {
    void dt;
    const sim = this._sim, p = this._player, v = this._v;
    if (!sim || !p) return;
    const L = sim.level, span = Math.max(1, L.finishD - L.startD);
    // place
    const n = sim.racers.length, pos = p.place || p.pos;
    if (pos !== v.pos || n !== v.n) {
      v.pos = pos; v.n = n;
      setText(this._placeN, pos);
      setText(this._placeOf, `/${n}`);
      this._place.style.setProperty('--pc', PLACE_COLOR[pos - 1] ?? '#fff');
      if (v.pos > 0) this._place.animate?.([{ scale: 1.35 }, { scale: 1 }], { duration: 260, easing: 'ease-out' });
    }
    // coins, ball size
    if (p.coins !== v.coins) { v.coins = p.coins; setText(this._coins, fmtNum(p.coins)); }
    const s = Math.round(p.size);
    if (s !== v.size) {
      const grew = s > v.size && v.size >= 0;
      v.size = s;
      setText(this._sizeN, s);
      if (grew) this._size.animate?.([{ scale: 1.18 }, { scale: 1 }], { duration: 200, easing: 'ease-out' });
    }
    if (p.melting !== v.melt) { v.melt = p.melting; this._size.classList.toggle('melt', p.melting); }
    // power-ups: shields count, boost time left
    if (p.shields !== v.shields) {
      v.shields = p.shields;
      this._shield.classList.toggle('hidden', p.shields <= 0);
      setText(this._shieldN, p.shields > 1 ? `×${p.shields}` : '');
    }
    let bk = p.boostT > 0 ? Math.min(1, p.boostT / this._boostLen) : 0;
    if (this._boostEnd > 0) bk = Math.max(0, (this._boostEnd - sim.time) / this._boostLen);
    const bq = Math.ceil(bk * 20) / 20; // 5% steps
    if (bq !== v.boost) {
      v.boost = bq;
      this._boost.classList.toggle('hidden', bq <= 0);
      this._boostBar.style.transform = `scaleX(${bq})`;
      if (bq <= 0) this._boostEnd = 0;
    }
    // progress bar & markers (0.2% steps)
    const fill = prog(p.d, L.startD, span);
    if (fill !== v.fill) { v.fill = fill; this._barFill.style.transform = `scaleX(${fill / 100})`; }
    for (let i = 0; i < sim.racers.length; i++) {
      const x = prog(sim.racers[i].d, L.startD, span);
      if (x !== this._mx[i]) { this._mx[i] = x; this._marks[i].style.left = `${x}%`; }
    }
  }

  /** big centered countdown: 3, 2, 1, 'go' (with sounds) */
  countdown(v: number | 'go'): void {
    const el = this._cd, go = v === 'go';
    clearTimeout(this._cdTimer);
    setText(el, go ? tr({ ru: 'ВПЕРЁД!', en: 'GO!' }) : String(v));
    el.classList.toggle('go', go);
    el.style.color = go ? '' : ['#7ee26a', '#ffd447', '#ff6b5e'][Math.max(0, Math.min(2, (v as number) - 1))];
    el.classList.remove('hidden');
    if (go) fitText(el, 1, 0.4);
    sfx(go ? 'go' : 'count');
    el.getAnimations?.().forEach((a) => a.cancel());
    el.animate?.([
      { transform: 'scale(2.4)', opacity: 0 },
      { transform: 'scale(1)', opacity: 1, offset: 0.22 },
      { transform: 'scale(1)', opacity: 1, offset: 0.75 },
      { transform: 'scale(.7)', opacity: 0 },
    ], { duration: go ? 1100 : 950, easing: 'ease-out', fill: 'forwards' });
    this._cdTimer = window.setTimeout(() => el.classList.add('hidden'), go ? 1100 : 950);
  }

  /** short big text in the middle ("СТЕНА ПРОБИТА!", "x2", "КОМ РАЗБИТ") */
  flash(text: string, color = '#ffffff'): void {
    const el = this._fl;
    setText(el, text);
    el.style.color = color;
    el.classList.remove('hidden');
    el.getAnimations?.().forEach((a) => a.cancel());
    const a = el.animate?.([
      { transform: 'scale(.4) rotate(-6deg)', opacity: 0 },
      { transform: 'scale(1.12) rotate(2deg)', opacity: 1, offset: 0.15 },
      { transform: 'scale(1) rotate(0)', opacity: 1, offset: 0.3 },
      { transform: 'scale(1) translateY(0)', opacity: 1, offset: 0.78 },
      { transform: 'scale(.95) translateY(-30px)', opacity: 0 },
    ], { duration: 1250, easing: 'ease-out', fill: 'forwards' });
    if (a) a.onfinish = () => el.classList.add('hidden');
  }

  /** tutorial / hint banner in the lower middle (null hides) */
  hint(text: string | null): void {
    if (!text) { this._hint.classList.add('hidden'); return; }
    if (this._hintTx.textContent !== text || this._hint.classList.contains('hidden')) {
      setText(this._hintTx, text);
      this._hint.classList.remove('hidden');
      this._hintTx.getAnimations?.().forEach((a) => { a.cancel(); a.play(); });
    }
  }

  /**
   * Power-up indicator. The shield count and the boost timer follow the racer automatically in update(); call this
   * on a pickup to pulse the indicator ('shield' | 'boost' | 'grow'), optionally with an explicit boost length (s).
   * null clears an explicit boost timer.
   */
  power(kind: string | null, seconds?: number): void {
    if (!kind) { this._boostEnd = 0; return; }
    if (kind === 'boost' && seconds && this._sim) { this._boostLen = seconds; this._boostEnd = this._sim.time + seconds; }
    else if (kind === 'boost' && this._player) this._boostLen = Math.max(1, this._player.boostT);
    const el = kind === 'shield' ? this._shield : kind === 'boost' ? this._boost : this._size;
    this._v.boost = -1;
    el.animate?.([{ scale: 1.5, filter: 'brightness(1.8)' }, { scale: 1, filter: 'none' }], { duration: 420, easing: 'ease-out' });
  }

  /** open the pause dialog (game paused until it closes) */
  pause(): void {
    if (this._paused) return;
    const ctx = this._ctx;
    ctx.game.pause();
    const toggles = soundButtons(ctx);
    toggles.el.classList.add('ps-tg');
    let quit = false;
    const m = modal(ctx, [toggles.el], {
      title: tr({ ru: 'Пауза', en: 'Paused' }),
      foot: [
        btn(tr({ ru: 'Выйти из гонки', en: 'Leave race' }), () => { quit = true; m.close(); }, 'red'),
        btn(tr({ ru: 'Продолжить', en: 'Continue' }), () => m.close(), 'green big'),
      ],
      onClose: () => {
        this._paused = null;
        ctx.game.resume();
        if (quit) this.onQuit();
      },
    });
    this._paused = m;
  }
  /** the pause dialog is open */
  get paused(): boolean { return !!this._paused; }
}
