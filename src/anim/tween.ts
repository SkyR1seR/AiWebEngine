import { frameHooks } from '../core/hooks';

export type EaseFn = (t: number) => number;

const inOut = (f: EaseFn): EaseFn => (t) => (t < 0.5 ? f(t * 2) / 2 : 1 - f((1 - t) * 2) / 2);
const out = (f: EaseFn): EaseFn => (t) => 1 - f(1 - t);
const pow = (p: number): EaseFn => (t) => Math.pow(t, p);
const sine: EaseFn = (t) => 1 - Math.cos((t * Math.PI) / 2);
const expo: EaseFn = (t) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10));
const back: EaseFn = (t) => 2.70158 * t * t * t - 1.70158 * t * t;
const elastic: EaseFn = (t) => (t === 0 || t === 1 ? t : -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * ((2 * Math.PI) / 3)));
const bounceOut: EaseFn = (t) => {
  const n = 7.5625, d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
};

export const Ease = {
  linear: (t: number) => t,
  quadIn: pow(2), quadOut: out(pow(2)), quadInOut: inOut(pow(2)),
  cubicIn: pow(3), cubicOut: out(pow(3)), cubicInOut: inOut(pow(3)),
  quartIn: pow(4), quartOut: out(pow(4)), quartInOut: inOut(pow(4)),
  sineIn: sine, sineOut: out(sine), sineInOut: inOut(sine),
  expoIn: expo, expoOut: out(expo), expoInOut: inOut(expo),
  backIn: back, backOut: out(back), backInOut: inOut(back),
  elasticIn: elastic, elasticOut: out(elastic),
  bounceIn: out(bounceOut), bounceOut, bounceInOut: inOut(out(bounceOut)),
};
export type EaseName = keyof typeof Ease;

export interface TweenOptions {
  ease?: EaseName | EaseFn;
  delay?: number;
  /** extra repeats; -1 = forever */
  repeat?: number;
  /** reverse on each repeat */
  yoyo?: boolean;
  onUpdate?: (t: number) => void;
  onComplete?: () => void;
}

/** A running tween. Awaitable: `await tween(...)`. */
export class Tween implements PromiseLike<void> {
  done = false;
  paused = false;
  private _t = 0;
  private _from: number[] | null = null;
  private _keys: (string | number)[];
  private _to: number[];
  private _ease: EaseFn;
  private _dir = 1;
  private _left: number;
  private _resolvers: (() => void)[] = [];

  constructor(public target: any, to: Record<string, number> | ArrayLike<number>, public duration: number, private o: TweenOptions = {}) {
    if (typeof (to as any).length === 'number') {
      this._keys = Array.from({ length: (to as ArrayLike<number>).length }, (_, i) => i);
      this._to = Array.from(to as ArrayLike<number>);
    } else {
      this._keys = Object.keys(to);
      this._to = Object.values(to as Record<string, number>);
    }
    this._ease = typeof o.ease === 'function' ? o.ease : Ease[o.ease ?? 'quadOut'];
    this._t = -(o.delay ?? 0);
    this._left = o.repeat ?? 0;
  }

  /** @internal */
  step(dt: number) {
    if (this.done || this.paused) return;
    this._t += dt;
    if (this._t < 0) return;
    if (!this._from) this._from = this._keys.map((k) => this.target[k]);
    const k = this.duration > 0 ? Math.min(1, this._t / this.duration) : 1;
    const e = this._ease(this._dir > 0 ? k : 1 - k);
    for (let i = 0; i < this._keys.length; i++) this.target[this._keys[i]] = this._from[i] + (this._to[i] - this._from[i]) * e;
    this.o.onUpdate?.(e);
    if (k >= 1) {
      if (this._left !== 0) {
        if (this._left > 0) this._left--;
        this._t -= this.duration;
        if (this.o.yoyo) this._dir = -this._dir;
      } else this._finish();
    }
  }
  private _finish() {
    this.done = true;
    this.o.onComplete?.();
    for (const r of this._resolvers) r();
    this._resolvers.length = 0;
  }
  /** Stop without completing (promise resolves). */
  stop() { if (!this.done) { this.done = true; for (const r of this._resolvers) r(); } }
  then<A = void, B = never>(ok?: ((v: void) => A | PromiseLike<A>) | null, err?: ((e: any) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return new Promise<void>((res) => (this.done ? res() : this._resolvers.push(res))).then(ok, err);
  }
}

type Timer = { t: number; res: () => void; fn?: () => void; every?: number };

/** Tween/timer manager. `tweens` is the global one ticked by the Game. */
export class TweenManager {
  list: Tween[] = [];
  timers: Timer[] = [];
  timeScale = 1;
  add(t: Tween) { this.list.push(t); return t; }
  update(dt: number) {
    dt *= this.timeScale;
    const l = this.list;
    for (let i = 0; i < l.length; i++) l[i].step(dt);
    if (l.some((t) => t.done)) this.list = l.filter((t) => !t.done);
    if (this.timers.length) {
      for (const tm of this.timers) {
        tm.t -= dt;
        if (tm.t <= 0) {
          tm.fn?.();
          if (tm.every) tm.t += tm.every;
          else tm.res();
        }
      }
      this.timers = this.timers.filter((tm) => tm.t > 0 || tm.every);
    }
  }
  /** Stop all tweens of a target. */
  kill(target: any) { for (const t of this.list) if (t.target === target) t.stop(); }
  clear() { this.list.forEach((t) => t.stop()); this.list = []; this.timers = []; }
}

export const tweens = /* @__PURE__ */ new TweenManager();
let hooked = false;
/** Make sure the global manager is ticked by the game loop (lazy, so unused tweens cost nothing). */
const hook = () => { if (!hooked) { hooked = true; frameHooks.push((dt) => tweens.update(dt)); } };

/** Animate numeric properties (object keys or array indices) to target values. */
export function tween(target: any, to: Record<string, number> | ArrayLike<number>, duration: number, opts?: TweenOptions) {
  hook();
  return tweens.add(new Tween(target, to, duration, opts));
}
/** Promise resolved after `sec` of game time. */
export function wait(sec: number): Promise<void> {
  hook();
  return new Promise((res) => tweens.timers.push({ t: sec, res }));
}
/** Call fn after `sec` of game time. */
export function after(sec: number, fn: () => void) {
  const tm: Timer = { t: sec, res: () => {}, fn };
  hook();
  tweens.timers.push(tm);
  return () => { tm.t = 0; tm.every = 0; tm.fn = undefined; };
}
/** Call fn every `sec` of game time; returns cancel function. */
export function every(sec: number, fn: () => void) {
  const tm: Timer = { t: sec, res: () => {}, fn, every: sec };
  hook();
  tweens.timers.push(tm);
  return () => { tm.every = 0; tm.t = 0; tm.fn = undefined; };
}
