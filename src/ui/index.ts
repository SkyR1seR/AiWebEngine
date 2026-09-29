import type { Game } from '../core/game';
import type { Node } from '../scene/node';
import { v3, type V3 } from '../core/math';

export type Anchor = 'top-left' | 'top' | 'top-right' | 'left' | 'center' | 'right' | 'bottom-left' | 'bottom' | 'bottom-right' | 'fill';

export interface UIOptions {
  /** design resolution (default 1280x720; use [720,1280] for portrait games) */
  reference?: [number, number];
  /** 0 = scale by width, 1 = by height, 0.5 = blend (default 0.5) */
  match?: number;
  minScale?: number;
  maxScale?: number;
  /** CSS font-family */
  font?: string;
}

type Child = Node_ | string | number | null | undefined | false;
type Node_ = HTMLElement | SVGElement;
export type Props = Record<string, any> & { style?: Partial<CSSStyleDeclaration> | string; class?: string; onClick?: (e: MouseEvent) => void };

/** Size in UI units (scaled with the screen). */
export const u = (n: number) => `calc(var(--u) * ${n}px)`;

/** Create an element: h('div', { class: 'x', onClick }, 'text', child) */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) for (const k in props) {
    const v = props[k];
    if (k === 'style') typeof v === 'string' ? (el.style.cssText = v) : Object.assign(el.style, v);
    else if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(typeof c === 'object' ? c : String(c));
  return el;
}

const CSS = `
.ui-root{position:fixed;inset:0;pointer-events:none;z-index:10;box-sizing:border-box;font-size:calc(var(--u)*20px);color:#fff;
padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
text-shadow:0 calc(var(--u)*2px) calc(var(--u)*3px) rgba(0,0,0,.45);user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent}
.ui-root *{box-sizing:border-box}
.ui-a{position:absolute;display:flex;gap:calc(var(--u)*12px);padding:calc(var(--u)*16px)}
.ui-a>*{pointer-events:auto}
.ui-top-left{top:0;left:0;flex-direction:column;align-items:flex-start}
.ui-top{top:0;left:50%;transform:translateX(-50%);flex-direction:column;align-items:center}
.ui-top-right{top:0;right:0;flex-direction:column;align-items:flex-end}
.ui-left{top:50%;left:0;transform:translateY(-50%);flex-direction:column}
.ui-center{top:50%;left:50%;transform:translate(-50%,-50%);flex-direction:column;align-items:center}
.ui-right{top:50%;right:0;transform:translateY(-50%);flex-direction:column;align-items:flex-end}
.ui-bottom-left{bottom:0;left:0;flex-direction:column;align-items:flex-start}
.ui-bottom{bottom:0;left:50%;transform:translateX(-50%);flex-direction:column;align-items:center}
.ui-bottom-right{bottom:0;right:0;flex-direction:column;align-items:flex-end}
.ui-fill{inset:0;align-items:center;justify-content:center;flex-direction:column}
.ui-btn{pointer-events:auto;cursor:pointer;border:none;font:inherit;font-weight:700;color:#fff;letter-spacing:.02em;
padding:calc(var(--u)*14px) calc(var(--u)*30px);border-radius:calc(var(--u)*14px);background:linear-gradient(#4cc3ff,#2a8bff);
box-shadow:0 calc(var(--u)*5px) 0 #1b5fb8,0 calc(var(--u)*8px) calc(var(--u)*14px) rgba(0,0,0,.3);transition:transform .08s,box-shadow .08s;text-shadow:0 2px 0 rgba(0,0,0,.25)}
.ui-btn:active{transform:translateY(calc(var(--u)*4px));box-shadow:0 calc(var(--u)*1px) 0 #1b5fb8}
.ui-btn.green{background:linear-gradient(#6ee27a,#2fb84a);box-shadow:0 calc(var(--u)*5px) 0 #1f7f33,0 calc(var(--u)*8px) calc(var(--u)*14px) rgba(0,0,0,.3)}
.ui-btn.red{background:linear-gradient(#ff7a7a,#e5383b);box-shadow:0 calc(var(--u)*5px) 0 #a4161a,0 calc(var(--u)*8px) calc(var(--u)*14px) rgba(0,0,0,.3)}
.ui-bar{position:relative;width:calc(var(--u)*240px);height:calc(var(--u)*20px);border-radius:calc(var(--u)*10px);background:rgba(0,0,0,.45);overflow:hidden;box-shadow:inset 0 0 0 calc(var(--u)*2px) rgba(255,255,255,.35)}
.ui-bar>i{position:absolute;left:0;top:0;bottom:0;border-radius:inherit;transition:width .15s}
.ui-panel{pointer-events:auto;background:rgba(18,22,40,.85);border-radius:calc(var(--u)*22px);padding:calc(var(--u)*28px) calc(var(--u)*36px);
display:flex;flex-direction:column;align-items:center;gap:calc(var(--u)*18px);box-shadow:0 calc(var(--u)*12px) calc(var(--u)*40px) rgba(0,0,0,.5);backdrop-filter:blur(6px)}
.ui-screen{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.35);pointer-events:auto;transition:opacity .25s}
.ui-screen.hidden{opacity:0;pointer-events:none}
.ui-title{font-size:calc(var(--u)*56px);font-weight:900;letter-spacing:.02em}
.ui-big{font-size:calc(var(--u)*36px);font-weight:800}
.ui-wl{position:absolute;left:0;top:0;transform:translate(-50%,-100%);pointer-events:none;white-space:nowrap;will-change:transform}
.ui-float{position:absolute;left:0;top:0;pointer-events:none;font-weight:900;font-size:calc(var(--u)*30px);white-space:nowrap}
.ui-stick{position:absolute;width:calc(var(--u)*150px);height:calc(var(--u)*150px);border-radius:50%;background:rgba(255,255,255,.12);box-shadow:inset 0 0 0 calc(var(--u)*3px) rgba(255,255,255,.3);pointer-events:none;opacity:.0;transition:opacity .15s}
.ui-stick>i{position:absolute;left:50%;top:50%;width:calc(var(--u)*64px);height:calc(var(--u)*64px);margin:calc(var(--u)*-32px) 0 0 calc(var(--u)*-32px);border-radius:50%;background:rgba(255,255,255,.55)}
.ui-tbtn{pointer-events:auto;width:calc(var(--u)*110px);height:calc(var(--u)*110px);border-radius:50%;border:none;font:inherit;font-weight:800;color:#fff;background:rgba(255,255,255,.18);box-shadow:inset 0 0 0 calc(var(--u)*3px) rgba(255,255,255,.35);touch-action:none}
.ui-tbtn.on{background:rgba(255,255,255,.4)}
.ui-toast{padding:calc(var(--u)*10px) calc(var(--u)*22px);border-radius:calc(var(--u)*12px);background:rgba(0,0,0,.6);transition:opacity .3s,transform .3s}
`;

interface WorldLabel { el: HTMLElement; target: Node | (() => V3); offset: number[] }

/** Reactive value bound to a text node — only touches the DOM when the value changes. */
export interface Label { el: HTMLElement; set(v: string | number): void }
export interface Bar { el: HTMLElement; set(v: number): void }

/**
 * DOM-based adaptive UI overlay. Everything scales with `--u` (CanvasScaler-like), respects safe areas.
 *   const ui = new UI(game);
 *   const score = ui.text('0', 'top');
 *   ui.button('Play', () => start(), 'center');
 */
export class UI {
  root: HTMLDivElement;
  scale = 1;
  readonly isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  private _anchors = new Map<Anchor, HTMLDivElement>();
  private _labels: WorldLabel[] = [];
  private _floats: { el: HTMLElement; p: number[]; t: number; dur: number; rise: number }[] = [];
  private _screens = new Map<string, HTMLDivElement>();
  private _o: Required<UIOptions>;

  constructor(public game: Game, o: UIOptions = {}) {
    this._o = { reference: [1280, 720], match: 0.5, minScale: 0.35, maxScale: 3, font: 'system-ui,-apple-system,Segoe UI,Roboto,sans-serif', ...o };
    if (!document.getElementById('ui-css')) document.head.append(h('style', { id: 'ui-css' }, CSS));
    this.root = h('div', { class: 'ui-root', style: { fontFamily: this._o.font } });
    document.body.append(this.root);
    game.screen.onResize(() => this._layout());
    this._layout();
    game.onRender(() => this._sync());
  }

  private _layout() {
    const [rw, rh] = this._o.reference, s = this.game.screen;
    const lw = Math.log2(s.width / rw), lh = Math.log2(s.height / rh);
    this.scale = Math.min(this._o.maxScale, Math.max(this._o.minScale, Math.pow(2, lw + (lh - lw) * this._o.match)));
    this.root.style.setProperty('--u', String(this.scale));
  }

  /** Container for an anchor (created on demand). */
  anchor(a: Anchor) {
    let el = this._anchors.get(a);
    if (!el) { el = h('div', { class: `ui-a ui-${a}` }); this.root.append(el); this._anchors.set(a, el); }
    return el;
  }
  /** Add an element at an anchor. */
  add<T extends HTMLElement>(el: T, a: Anchor = 'top-left'): T { this.anchor(a).append(el); return el; }

  text(initial: string | number = '', a: Anchor = 'top-left', style: Partial<CSSStyleDeclaration> = {}): Label {
    const el = this.add(h('div', { style: { fontWeight: '800', ...style } }, String(initial)), a);
    let cur = String(initial);
    return { el, set(v) { const s = String(v); if (s !== cur) { cur = s; el.textContent = s; } } };
  }

  button(label: string, onClick: () => void, a: Anchor = 'center', cls = ''): HTMLButtonElement {
    const b = h('button', { class: 'ui-btn ' + cls }, label);
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    return this.add(b, a);
  }

  bar(value = 1, a: Anchor = 'top-left', color = 'linear-gradient(#7dff8a,#2fb84a)', width = 240): Bar {
    const fill = h('i', { style: { background: color, width: value * 100 + '%' } });
    const el = this.add(h('div', { class: 'ui-bar', style: { width: u(width) } }, fill), a);
    let cur = value;
    return { el, set(v) { v = Math.max(0, Math.min(1, v)); if (v !== cur) { cur = v; fill.style.width = v * 100 + '%'; } } };
  }

  /** Full-screen modal layer (menus, pause, game over). Returns its panel. Toggle with show()/hide(). */
  screen(name: string, ...content: Child[]): HTMLDivElement {
    const panel = h('div', { class: 'ui-panel' }, ...content);
    const scr = h('div', { class: 'ui-screen hidden' }, panel);
    scr.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.root.append(scr);
    this._screens.set(name, scr);
    return panel;
  }
  show(name: string) { this._screens.get(name)?.classList.remove('hidden'); }
  hide(name?: string) { for (const [n, s] of this._screens) if (!name || n === name) s.classList.add('hidden'); }
  isShown(name: string) { return !this._screens.get(name)?.classList.contains('hidden'); }

  /** Element that follows a 3D node/point (name tags, HP bars). Remove with `el.remove()`. */
  worldLabel(target: Node | (() => V3), content: Child, offset: V3 = [0, 2, 0]): HTMLElement {
    const el = h('div', { class: 'ui-wl' }, content);
    this.root.append(el);
    this._labels.push({ el, target, offset: [offset[0], offset[1], offset[2]] });
    return el;
  }

  /** Floating text rising from a world point (damage numbers, +1 coins). */
  floatText(text: string, at: V3, color = '#fff', duration = 0.9, rise = 60) {
    const el = h('div', { class: 'ui-float', style: { color } }, text);
    this.root.append(el);
    this._floats.push({ el, p: [at[0], at[1], at[2]], t: 0, dur: duration, rise });
  }

  toast(msg: string, duration = 1.5, a: Anchor = 'top') {
    const el = this.add(h('div', { class: 'ui-toast', style: { opacity: '0', transform: 'translateY(-10px)' } }, msg), a);
    requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'none'; });
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, duration * 1000);
  }

  /**
   * Virtual joystick writing `input.virtual` (appears where the touch starts within its screen half).
   * Only on touch devices unless `always`.
   */
  joystick(o: { side?: 'left' | 'right'; always?: boolean; radius?: number } = {}) {
    if (!this.isTouch && !o.always) return null;
    const side = o.side ?? 'left';
    const base = h('div', { class: 'ui-stick' }), knob = h('i');
    base.append(knob);
    this.root.append(base);
    const inp = this.game.input, canvas = this.game.canvas;
    let id = -1, cx = 0, cy = 0;
    const R = () => (o.radius ?? 60) * this.scale;
    canvas.addEventListener('pointerdown', (e) => {
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      if (id >= 0 || (side === 'left' ? x > r.width / 2 : x < r.width / 2)) return;
      id = e.pointerId; cx = x; cy = y;
      base.style.left = `calc(${x}px - var(--u) * 75px)`;
      base.style.top = `calc(${y}px - var(--u) * 75px)`;
      base.style.opacity = '1';
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      const r = canvas.getBoundingClientRect();
      let dx = e.clientX - r.left - cx, dy = e.clientY - r.top - cy;
      const l = Math.hypot(dx, dy), m = R();
      if (l > m) { dx *= m / l; dy *= m / l; }
      knob.style.transform = `translate(${dx}px,${dy}px)`;
      inp.virtual.x = dx / m;
      inp.virtual.y = -dy / m;
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = -1;
      inp.virtual.x = inp.virtual.y = 0;
      knob.style.transform = '';
      base.style.opacity = '0';
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    return base;
  }

  /** On-screen button mapped to a virtual input code (e.g. 'jump'); check with input.isDown/wasPressed('jump'). */
  touchButton(label: string, code: string, a: Anchor = 'bottom-right', always = false) {
    if (!this.isTouch && !always) return null;
    const b = h('button', { class: 'ui-tbtn' }, label);
    const inp = this.game.input;
    const on = (e: PointerEvent) => { e.preventDefault(); e.stopPropagation(); inp.virtualButtons.add(code); b.classList.add('on'); };
    const off = () => { inp.virtualButtons.delete(code); b.classList.remove('on'); };
    b.addEventListener('pointerdown', on);
    b.addEventListener('pointerup', off);
    b.addEventListener('pointercancel', off);
    b.addEventListener('pointerleave', off);
    return this.add(b, a);
  }

  private _sync() {
    const g = this.game, cam = g.camera, W = g.screen.width, H = g.screen.height, p = v3(), s = v3();
    for (let i = this._labels.length - 1; i >= 0; i--) {
      const l = this._labels[i];
      if (!l.el.isConnected) { this._labels.splice(i, 1); continue; }
      if (typeof l.target === 'function') p.set(l.target()); else l.target.worldPosition(p);
      p[0] += l.offset[0]; p[1] += l.offset[1]; p[2] += l.offset[2];
      cam.worldToScreen(p, W, H, s);
      const vis = s[2] >= 0 && s[2] <= 1;
      l.el.style.display = vis ? '' : 'none';
      if (vis) l.el.style.transform = `translate(${s[0].toFixed(1)}px,${s[1].toFixed(1)}px) translate(-50%,-100%)`;
    }
    const dt = g.time.dt;
    for (let i = this._floats.length - 1; i >= 0; i--) {
      const f = this._floats[i];
      f.t += dt;
      const k = f.t / f.dur;
      if (k >= 1) { f.el.remove(); this._floats.splice(i, 1); continue; }
      cam.worldToScreen(f.p, W, H, s);
      const y = s[1] - f.rise * this.scale * (1 - (1 - k) * (1 - k));
      f.el.style.transform = `translate(${s[0].toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-50%) scale(${(k < 0.15 ? 0.6 + k * 4 : 1).toFixed(2)})`;
      f.el.style.opacity = String(k > 0.7 ? (1 - k) / 0.3 : 1);
    }
  }
}
