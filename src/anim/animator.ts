import type { Node, Script } from '../scene/node';
import { qslerp } from '../core/math';

export type TrackPath = 'position' | 'rotation' | 'scale';
export type Interp = 'LINEAR' | 'STEP' | 'CUBICSPLINE';

export interface Track {
  /** node index (into the model's node list) or node name */
  target: number | string;
  path: TrackPath;
  times: Float32Array;
  values: Float32Array;
  interp?: Interp;
}

export interface ClipEvent { time: number; name: string }

/** Keyframe animation clip. Shareable between model instances. */
export class AnimationClip {
  duration: number;
  constructor(public name: string, public tracks: Track[], public events: ClipEvent[] = [], duration?: number) {
    this.duration = duration ?? tracks.reduce((d, t) => Math.max(d, t.times[t.times.length - 1] ?? 0), 0);
  }
  /** Add a named event fired when playback crosses `time`. */
  addEvent(time: number, name: string) { this.events.push({ time, name }); return this; }
}

export interface PlayOptions {
  /** crossfade duration in seconds (default 0.2) */
  fade?: number;
  loop?: boolean;
  speed?: number;
  /** restart if already playing */
  restart?: boolean;
  /** target weight (default 1). Use with `additive` layers or manual blending. */
  weight?: number;
}

interface Binding { node: Node; path: TrackPath; track: Track; last: number }

export class Action {
  time = 0;
  weight = 0;
  target = 1;
  fadeRate = 0;
  speed = 1;
  loop = true;
  playing = true;
  bindings: Binding[] = [];
  constructor(public clip: AnimationClip) {}
  get progress() { return this.clip.duration ? this.time / this.clip.duration : 1; }
}

const _v = new Float32Array(4), _a = new Float32Array(4), _b = new Float32Array(4);

/** Plays and blends animation clips on a node hierarchy. Add to a node via `node.addScript(animator)` (done automatically by models). */
export class Animator implements Script {
  actions = new Map<string, Action>();
  clips = new Map<string, AnimationClip>();
  timeScale = 1;
  private rest = new Map<Node, Float32Array[]>();
  private acc = new Map<Node, { p: Float32Array; r: Float32Array; s: Float32Array; wp: number; wr: number; ws: number }>();
  private listeners = new Map<string, ((name: string, a: Action) => void)[]>();

  constructor(public root: Node, clips: AnimationClip[] = [], public nodes: Node[] = []) {
    for (const c of clips) this.clips.set(c.name, c);
  }

  get current(): Action | undefined {
    let best: Action | undefined;
    for (const a of this.actions.values()) if (a.target > 0 && (!best || a.weight > best.weight)) best = a;
    return best;
  }

  addClip(c: AnimationClip) { this.clips.set(c.name, c); return this; }

  /** Play a clip, crossfading others out. */
  play(name: string, o: PlayOptions = {}): Action {
    const clip = this.clips.get(name);
    if (!clip) throw new Error(`Animation '${name}' not found. Available: ${[...this.clips.keys()].join(', ')}`);
    let a = this.actions.get(name);
    if (!a) {
      a = new Action(clip);
      a.bindings = this.bind(clip);
      this.actions.set(name, a);
    }
    const fade = o.fade ?? 0.2;
    if (o.restart || !a.playing || a.target === 0) {
      if (o.restart || a.weight === 0) a.time = 0;
    }
    a.playing = true;
    a.loop = o.loop ?? true;
    a.speed = o.speed ?? 1;
    a.target = o.weight ?? 1;
    if (fade <= 0) a.weight = a.target;
    a.fadeRate = fade > 0 ? 1 / fade : Infinity;
    if (o.weight === undefined) for (const b of this.actions.values()) if (b !== a) { b.target = 0; b.fadeRate = fade > 0 ? 1 / fade : Infinity; }
    return a;
  }

  /** Play once, then return to `then` clip (if given). Resolves when finished. */
  playOnce(name: string, then?: string, o: PlayOptions = {}): Promise<void> {
    const a = this.play(name, { ...o, loop: false, restart: true });
    return new Promise((res) => {
      const off = this.on('end', (n, act) => {
        if (act !== a) return;
        off();
        if (then) this.play(then, { fade: o.fade });
        res();
      });
    });
  }

  stop(name?: string, fade = 0.2) {
    for (const [n, a] of this.actions) if (!name || n === name) { a.target = 0; a.fadeRate = fade > 0 ? 1 / fade : Infinity; }
  }

  /** Listen for clip events ('end', 'loop', or custom clip event names). Returns unsubscribe. */
  on(event: string, fn: (name: string, a: Action) => void) {
    const l = this.listeners.get(event) ?? [];
    l.push(fn);
    this.listeners.set(event, l);
    return () => { const x = this.listeners.get(event); if (x) x.splice(x.indexOf(fn), 1); };
  }
  private emit(event: string, a: Action) {
    const l = this.listeners.get(event);
    if (l) for (const f of [...l]) f(a.clip.name, a);
  }

  private bind(clip: AnimationClip): Binding[] {
    const out: Binding[] = [];
    for (const t of clip.tracks) {
      const node = typeof t.target === 'number' ? this.nodes[t.target] : this.root.find(t.target);
      if (!node) continue;
      if (!this.rest.has(node)) this.rest.set(node, [node.position.slice(), node.rotation.slice(), node.scale.slice()]);
      out.push({ node, path: t.path, track: t, last: 0 });
    }
    return out;
  }

  update(dt: number) {
    dt *= this.timeScale;
    // advance
    for (const [name, a] of this.actions) {
      if (a.weight !== a.target) {
        const step = a.fadeRate * dt;
        a.weight = a.weight < a.target ? Math.min(a.target, a.weight + step) : Math.max(a.target, a.weight - step);
      }
      if (a.weight === 0 && a.target === 0) { this.actions.delete(name); continue; }
      if (!a.playing) continue;
      const d = a.clip.duration, prev = a.time;
      a.time += dt * a.speed;
      for (const e of a.clip.events) if (prev < e.time && a.time >= e.time) this.emit(e.name, a);
      if (a.time >= d || a.time < 0) {
        if (a.loop && d > 0) {
          a.time = ((a.time % d) + d) % d;
          this.emit('loop', a);
          for (const e of a.clip.events) if (e.time <= a.time) this.emit(e.name, a);
        } else {
          a.time = Math.max(0, Math.min(d, a.time));
          a.playing = false;
          this.emit('end', a);
        }
      }
    }
    // blend
    const acc = this.acc;
    for (const v of acc.values()) { v.p.fill(0); v.r.fill(0); v.s.fill(0); v.wp = v.wr = v.ws = 0; }
    for (const a of this.actions.values()) {
      const w = a.weight;
      if (w <= 0) continue;
      for (const b of a.bindings) {
        let e = acc.get(b.node);
        if (!e) { e = { p: new Float32Array(3), r: new Float32Array(4), s: new Float32Array(3), wp: 0, wr: 0, ws: 0 }; acc.set(b.node, e); }
        this.sample(b, a.time);
        if (b.path === 'rotation') {
          const sign = e.wr > 0 && e.r[0] * _v[0] + e.r[1] * _v[1] + e.r[2] * _v[2] + e.r[3] * _v[3] < 0 ? -w : w;
          for (let i = 0; i < 4; i++) e.r[i] += _v[i] * sign;
          e.wr += w;
        } else if (b.path === 'position') {
          for (let i = 0; i < 3; i++) e.p[i] += _v[i] * w;
          e.wp += w;
        } else {
          for (let i = 0; i < 3; i++) e.s[i] += _v[i] * w;
          e.ws += w;
        }
      }
    }
    for (const [node, e] of acc) {
      const rest = this.rest.get(node)!;
      if (e.wp > 0) for (let i = 0; i < 3; i++) node.position[i] = e.p[i] + rest[0][i] * Math.max(0, 1 - e.wp);
      if (e.ws > 0) for (let i = 0; i < 3; i++) node.scale[i] = e.s[i] + rest[2][i] * Math.max(0, 1 - e.ws);
      if (e.wr > 0) {
        const r = e.r;
        if (e.wr < 1) {
          const rr = rest[1], k = 1 - e.wr, s = r[0] * rr[0] + r[1] * rr[1] + r[2] * rr[2] + r[3] * rr[3] < 0 ? -k : k;
          for (let i = 0; i < 4; i++) r[i] += rr[i] * s;
        }
        const l = Math.hypot(r[0], r[1], r[2], r[3]) || 1;
        for (let i = 0; i < 4; i++) node.rotation[i] = r[i] / l;
      }
    }
  }

  /** Sample a binding at time t into _v. */
  private sample(b: Binding, t: number) {
    const tr = b.track, times = tr.times, vals = tr.values, n = times.length;
    const size = b.path === 'rotation' ? 4 : 3;
    const cubic = tr.interp === 'CUBICSPLINE';
    const stride = cubic ? size * 3 : size;
    const off = cubic ? size : 0;
    if (n === 1 || t <= times[0]) { for (let i = 0; i < size; i++) _v[i] = vals[off + i]; return; }
    if (t >= times[n - 1]) { for (let i = 0; i < size; i++) _v[i] = vals[(n - 1) * stride + off + i]; return; }
    // cached search
    let k = b.last;
    if (k >= n - 1 || times[k] > t) k = 0;
    while (k < n - 2 && times[k + 1] <= t) k++;
    b.last = k;
    const t0 = times[k], t1 = times[k + 1], dt = t1 - t0, u = (t - t0) / dt;
    if (tr.interp === 'STEP') { for (let i = 0; i < size; i++) _v[i] = vals[k * stride + i]; return; }
    if (cubic) {
      const u2 = u * u, u3 = u2 * u;
      const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
      const a = k * stride, c = (k + 1) * stride;
      for (let i = 0; i < size; i++) _v[i] = h00 * vals[a + size + i] + h10 * dt * vals[a + 2 * size + i] + h01 * vals[c + size + i] + h11 * dt * vals[c + i];
      if (size === 4) { const l = Math.hypot(_v[0], _v[1], _v[2], _v[3]) || 1; for (let i = 0; i < 4; i++) _v[i] /= l; }
      return;
    }
    if (size === 4) {
      for (let i = 0; i < 4; i++) { _a[i] = vals[k * 4 + i]; _b[i] = vals[(k + 1) * 4 + i]; }
      qslerp(_v, _a, _b, u);
    } else for (let i = 0; i < 3; i++) _v[i] = vals[k * 3 + i] + (vals[(k + 1) * 3 + i] - vals[k * 3 + i]) * u;
  }
}
