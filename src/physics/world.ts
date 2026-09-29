import { v3, quat, m4, m4invert, m4mul, m4decompose, v3transformMat4, qslerp, type V3, type Vec3 } from '../core/math';
import type { System } from '../core/game';
import { Node } from '../scene/node';
import { Mesh } from '../scene/mesh';
import { Body, type BodyOptions, type ContactInfo } from './body';
import { collide, computeAABB, axes, type CP } from './collide';
import { boxShape, sphereShape, capsuleShape, meshShape, type Shape } from './shapes';

export type ShapeKind = 'box' | 'sphere' | 'capsule' | 'mesh';
export type AddOptions = Omit<BodyOptions, 'shape'> & { shape?: Shape | ShapeKind };

export interface RayHit { body: Body; point: Vec3; normal: Vec3; distance: number }
export interface QueryOptions { mask?: number; ignore?: Body | Body[] | null; triggers?: boolean }
export interface WorldOptions { gravity?: V3; iterations?: number }

interface Point {
  p: number[]; n: number[]; d: number;
  ra: number[]; rb: number[]; t1: number[]; t2: number[];
  kn: number; kt1: number; kt2: number; bias: number;
  jn: number; jt1: number; jt2: number;
}
interface Manifold { a: Body; b: Body; pts: Point[]; mu: number; key: number }
interface PairState { a: Body; b: Body; trigger: boolean; info?: ContactInfo }

const SLOP = 0.005, BETA = 0.2;
const SLEEP_LIN = 0.02, SLEEP_ANG = 0.03, SLEEP_TIME = 0.6;
const pairKey = (a: Body, b: Body) => (a.id < b.id ? a.id * 2097152 + b.id : b.id * 2097152 + a.id);

/** Rigid-body physics world. Register with `game.addSystem(world)` to step at the fixed rate and sync nodes. */
export class PhysicsWorld implements System {
  bodies: Body[] = [];
  gravity: Vec3;
  iterations: number;
  manifolds: Manifold[] = [];
  /** Called for every contact/trigger begin. */
  private contactFns: ((a: Body, b: Body, info: ContactInfo) => void)[] = [];
  private prevManifolds = new Map<number, Manifold>();
  private pairs = new Map<number, PairState>();
  private sorted: Body[] = [];
  private infinite: Body[] = [];
  private pre: ((dt: number) => void)[] = [];
  private cps: CP[] = [];

  constructor(o: WorldOptions = {}) {
    this.gravity = v3(...((o.gravity ?? [0, -9.81, 0]) as [number, number, number]));
    this.iterations = o.iterations ?? 8;
  }

  /**
   * Add a body. If `node` is given, the body starts at the node's transform and drives it (dynamic)
   * or follows it (kinematic). `shape` may be a Shape or 'box'|'sphere'|'capsule'|'mesh' to fit the node's geometry.
   */
  add(node: Node | null, o: AddOptions = {}): Body {
    let shape = o.shape ?? 'box';
    let offset = o.offset;
    if (typeof shape === 'string') {
      if (!node) throw new Error('auto shape requires a node');
      const fit = fitShape(node, shape);
      shape = fit.shape;
      offset ??= fit.offset;
    }
    const b = new Body({ ...o, shape, offset });
    if (node) {
      b.node = node;
      node.updateWorld();
      const t = v3(), s = v3();
      m4decompose(node.worldMatrix, t, b.rotation, s);
      if (!o.position) {
        const off = b.offset;
        const ax = axes(b.rotation);
        for (let i = 0; i < 3; i++) b.position[i] = t[i] + ax[0][i] * off[0] + ax[1][i] * off[1] + ax[2][i] * off[2];
      }
      if (o.rotation) b.rotation.set(o.rotation);
      node.data.body = b;
    }
    return this.addBody(b);
  }

  addBody(b: Body) {
    b.prevPos.set(b.position);
    b.prevRot.set(b.rotation);
    b.updateInertiaWorld();
    computeAABB(b);
    this.bodies.push(b);
    if (b.shape.type === 'plane') this.infinite.push(b);
    else this.sorted.push(b);
    return b;
  }

  remove(b: Body) {
    const rm = (arr: Body[]) => { const i = arr.indexOf(b); if (i >= 0) arr.splice(i, 1); };
    rm(this.bodies); rm(this.sorted); rm(this.infinite);
    if (b.node?.data.body === b) delete b.node.data.body;
    for (const [k, p] of this.pairs) if (p.a === b || p.b === b) this.pairs.delete(k);
  }

  /** Global contact listener (begin events for collisions and triggers). */
  onContact(fn: (a: Body, b: Body, info: ContactInfo) => void) {
    this.contactFns.push(fn);
    return () => { this.contactFns = this.contactFns.filter((f) => f !== fn); };
  }
  /** Callback before every physics step (used by character controllers). */
  onPreStep(fn: (dt: number) => void) {
    this.pre.push(fn);
    return () => { this.pre = this.pre.filter((f) => f !== fn); };
  }

  // ---------------------------------------------------------------- System hooks

  fixedUpdate(dt: number) {
    // kinematic bodies follow their nodes
    for (const b of this.bodies) {
      if (b.type !== 'kinematic' || !b.node || !b.enabled) continue;
      const n = b.node;
      n.updateWorld();
      const t = v3(), q = quat(), s = v3();
      m4decompose(n.worldMatrix, t, q, s);
      const ax = axes(q);
      for (let i = 0; i < 3; i++) {
        const target = t[i] + ax[0][i] * b.offset[0] + ax[1][i] * b.offset[1] + ax[2][i] * b.offset[2];
        b.velocity[i] = (target - b.position[i]) / dt;
      }
      // angular velocity from rotation delta
      const c = b.rotation;
      let dx = q[3] * -c[0] + q[0] * c[3] + q[1] * -c[2] - q[2] * -c[1];
      let dy = q[3] * -c[1] + q[1] * c[3] + q[2] * -c[0] - q[0] * -c[2];
      let dz = q[3] * -c[2] + q[2] * c[3] + q[0] * -c[1] - q[1] * -c[0];
      const dw = q[3] * c[3] + q[0] * c[0] + q[1] * c[1] + q[2] * c[2];
      if (dw < 0) { dx = -dx; dy = -dy; dz = -dz; }
      b.angularVelocity[0] = (2 * dx) / dt; b.angularVelocity[1] = (2 * dy) / dt; b.angularVelocity[2] = (2 * dz) / dt;
    }
    for (const f of this.pre) f(dt);
    this.step(dt);
  }

  update(_dt: number, alpha: number) {
    for (const b of this.bodies) {
      const n = b.node;
      if (!n || b.type !== 'dynamic' || !b.enabled) continue;
      const p = v3(), q = quat();
      for (let i = 0; i < 3; i++) p[i] = b.prevPos[i] + (b.position[i] - b.prevPos[i]) * alpha;
      qslerp(q, b.prevRot, b.rotation, alpha);
      const ax = axes(q), o = b.offset;
      for (let i = 0; i < 3; i++) p[i] -= ax[0][i] * o[0] + ax[1][i] * o[1] + ax[2][i] * o[2];
      if (n.parent && n.parent.parent) {
        // convert to parent space
        const inv = m4invert(m4(), n.parent.worldMatrix);
        const w = m4();
        const s = v3();
        const tmp = m4();
        m4decompose(m4mul(w, inv, composeTR(tmp, p, q)), n.position, n.rotation, s);
      } else {
        n.position.set(p);
        n.rotation.set(q);
      }
    }
  }

  // ---------------------------------------------------------------- simulation

  step(dt: number) {
    const g = this.gravity;
    // integrate velocities
    for (const b of this.bodies) {
      if (b.type !== 'dynamic' || b.sleeping || !b.enabled) continue;
      const lf = b.linearFactor, v = b.velocity, w = b.angularVelocity, I = b.invInertiaWorld, t = b.torque;
      for (let i = 0; i < 3; i++) v[i] += (g[i] * b.gravityScale + b.force[i] * b.invMass) * dt * lf[i];
      w[0] += (I[0] * t[0] + I[3] * t[1] + I[6] * t[2]) * dt;
      w[1] += (I[1] * t[0] + I[4] * t[1] + I[7] * t[2]) * dt;
      w[2] += (I[2] * t[0] + I[5] * t[1] + I[8] * t[2]) * dt;
      const ld = 1 / (1 + dt * b.linearDamping), ad = 1 / (1 + dt * b.angularDamping);
      for (let i = 0; i < 3; i++) { v[i] *= ld; w[i] *= ad * (b.angularFactor[i] ? 1 : 0); }
      b.force.fill(0);
      b.torque.fill(0);
    }

    // broadphase (sweep and prune on X)
    const s = this.sorted;
    for (const b of s) if (b.type !== 'static' && !b.sleeping) computeAABB(b);
    for (let i = 1; i < s.length; i++) {
      const b = s[i], x = b.aabb[0];
      let j = i - 1;
      while (j >= 0 && s[j].aabb[0] > x) { s[j + 1] = s[j]; j--; }
      s[j + 1] = b;
    }
    const newPairs = new Map<number, PairState>();
    const manifolds: Manifold[] = [];
    const test = (a: Body, b: Body) => {
      if (!a.enabled || !b.enabled) return;
      if (!(a.layer & b.mask) || !(b.layer & a.mask)) return;
      const trig = a.isTrigger || b.isTrigger;
      if (a.sleeping && b.type === 'kinematic' && v2(b) > 1e-6) a.wake();
      if (b.sleeping && a.type === 'kinematic' && v2(a) > 1e-6) b.wake();
      const ad = a.type === 'dynamic' && !a.sleeping, bd = b.type === 'dynamic' && !b.sleeping;
      if (!ad && !bd && !(trig && (a.type !== 'static' || b.type !== 'static'))) return;
      const cps = this.cps;
      cps.length = 0;
      collide(a, b, cps);
      if (!cps.length) return;
      let deepest = cps[0];
      for (const c of cps) if (c.d > deepest.d) deepest = c;
      if (trig) {
        if (deepest.d > 0) newPairs.set(pairKey(a, b), { a, b, trigger: true });
        return;
      }
      // wake sleeping bodies hit by moving ones
      if (a.sleeping && bd && v2(b) > SLEEP_LIN * 4) a.wake();
      if (b.sleeping && ad && v2(a) > SLEEP_LIN * 4) b.wake();
      const key = pairKey(a, b);
      const m: Manifold = { a, b, pts: [], mu: Math.sqrt(a.friction * b.friction), key };
      const e = Math.max(a.restitution, b.restitution);
      const prev = this.prevManifolds.get(key);
      for (const c of cps) m.pts.push(this.makePoint(m, c, dt, e, prev));
      manifolds.push(m);
      if (deepest.d > -0.01) {
        const n = deepest.n;
        const vn = m.pts.length ? relVel(a, b, m.pts[0].ra, m.pts[0].rb, n) : 0;
        newPairs.set(key, { a, b, trigger: false, info: { point: v3(...(deepest.p as [number, number, number])), normal: v3(n[0], n[1], n[2]), speed: Math.max(0, -vn) } });
      }
    };
    for (let i = 0; i < s.length; i++) {
      const a = s[i], amax = a.aabb[3];
      for (let j = i + 1; j < s.length; j++) {
        const b = s[j];
        if (b.aabb[0] > amax) break;
        if (a.aabb[1] > b.aabb[4] || b.aabb[1] > a.aabb[4] || a.aabb[2] > b.aabb[5] || b.aabb[2] > a.aabb[5]) continue;
        test(a, b);
      }
      for (const p of this.infinite) test(a, p);
    }

    // warm start
    for (const m of manifolds) for (const p of m.pts) {
      const jx = p.n[0] * p.jn + p.t1[0] * p.jt1 + p.t2[0] * p.jt2;
      const jy = p.n[1] * p.jn + p.t1[1] * p.jt1 + p.t2[1] * p.jt2;
      const jz = p.n[2] * p.jn + p.t1[2] * p.jt1 + p.t2[2] * p.jt2;
      applyImp(m.a, m.b, p.ra, p.rb, jx, jy, jz);
    }
    // solve velocities
    for (let it = 0; it < this.iterations; it++) {
      for (const m of manifolds) {
        const a = m.a, b = m.b;
        for (const p of m.pts) {
          // friction
          const lim = m.mu * p.jn;
          let vt = relVel(a, b, p.ra, p.rb, p.t1);
          let old = p.jt1;
          p.jt1 = Math.max(-lim, Math.min(lim, old - vt / p.kt1));
          let d = p.jt1 - old;
          applyImp(a, b, p.ra, p.rb, p.t1[0] * d, p.t1[1] * d, p.t1[2] * d);
          vt = relVel(a, b, p.ra, p.rb, p.t2);
          old = p.jt2;
          p.jt2 = Math.max(-lim, Math.min(lim, old - vt / p.kt2));
          d = p.jt2 - old;
          applyImp(a, b, p.ra, p.rb, p.t2[0] * d, p.t2[1] * d, p.t2[2] * d);
          // normal
          const vn = relVel(a, b, p.ra, p.rb, p.n);
          old = p.jn;
          p.jn = Math.max(0, old + (p.bias - vn) / p.kn);
          d = p.jn - old;
          applyImp(a, b, p.ra, p.rb, p.n[0] * d, p.n[1] * d, p.n[2] * d);
        }
      }
    }

    // integrate positions
    for (const b of this.bodies) {
      if (!b.enabled || b.type === 'static') continue;
      b.prevPos.set(b.position);
      b.prevRot.set(b.rotation);
      if (b.sleeping || !b.integrate) continue;
      const v = b.velocity, w = b.angularVelocity, p = b.position, q = b.rotation;
      p[0] += v[0] * dt; p[1] += v[1] * dt; p[2] += v[2] * dt;
      if (b.type === 'kinematic' && b.node) {
        // rotation already applied from node
        const t = v3(), s = v3();
        m4decompose(b.node.worldMatrix, t, q, s);
      } else {
        const hx = w[0] * dt * 0.5, hy = w[1] * dt * 0.5, hz = w[2] * dt * 0.5;
        const x = q[0], y = q[1], z = q[2], qw = q[3];
        q[0] += hx * qw + hy * z - hz * y;
        q[1] += hy * qw + hz * x - hx * z;
        q[2] += hz * qw + hx * y - hy * x;
        q[3] += -hx * x - hy * y - hz * z;
        const l = Math.hypot(q[0], q[1], q[2], q[3]);
        q[0] /= l; q[1] /= l; q[2] /= l; q[3] /= l;
      }
      b.updateInertiaWorld();
      // sleeping
      if (b.type === 'dynamic' && b.canSleep) {
        if (v2(b) < SLEEP_LIN && w[0] * w[0] + w[1] * w[1] + w[2] * w[2] < SLEEP_ANG) {
          b.sleepTime += dt;
          if (b.sleepTime > SLEEP_TIME) { b.sleeping = true; v.fill(0); w.fill(0); }
        } else b.sleepTime = 0;
      }
    }

    // events
    for (const [k, p] of newPairs) {
      if (this.pairs.has(k)) continue;
      if (p.trigger) {
        p.a.onTrigger?.(p.b, 'enter');
        p.b.onTrigger?.(p.a, 'enter');
      } else {
        const i = p.info!;
        p.a.onCollide?.(p.b, i);
        p.b.onCollide?.(p.a, { point: i.point, normal: v3(-i.normal[0], -i.normal[1], -i.normal[2]), speed: i.speed });
      }
      for (const f of this.contactFns) f(p.a, p.b, p.info ?? { point: v3(), normal: v3(), speed: 0 });
    }
    for (const [k, p] of this.pairs) {
      if (newPairs.has(k)) continue;
      // keep contacts of sleeping pairs alive
      if ((p.a.sleeping || p.a.type !== 'dynamic') && (p.b.sleeping || p.b.type !== 'dynamic') && !p.trigger && this.bodies.includes(p.a) && this.bodies.includes(p.b)) {
        newPairs.set(k, p);
        continue;
      }
      if (p.trigger) { p.a.onTrigger?.(p.b, 'exit'); p.b.onTrigger?.(p.a, 'exit'); }
      else { p.a.onCollideEnd?.(p.b); p.b.onCollideEnd?.(p.a); }
    }
    this.pairs = newPairs;
    this.manifolds = manifolds;
    this.prevManifolds.clear();
    for (const m of manifolds) this.prevManifolds.set(m.key, m);
  }

  private makePoint(m: Manifold, c: CP, dt: number, e: number, prev?: Manifold): Point {
    const a = m.a, b = m.b, n = c.n;
    const ra = [c.p[0] - a.position[0], c.p[1] - a.position[1], c.p[2] - a.position[2]];
    const rb = [c.p[0] - b.position[0], c.p[1] - b.position[1], c.p[2] - b.position[2]];
    const t1 = Math.abs(n[1]) < 0.9 ? norm(cross([0, 1, 0], n)) : norm(cross([1, 0, 0], n));
    const t2 = cross(n, t1);
    const vn = relVel(a, b, ra, rb, n);
    let bias = c.d > SLOP ? (BETA / dt) * (c.d - SLOP) : c.d < 0 ? c.d / dt : 0;
    if (vn < -1) bias = Math.max(bias, -e * vn);
    const p: Point = {
      p: c.p, n, d: c.d, ra, rb, t1, t2,
      kn: effMass(a, b, ra, rb, n), kt1: effMass(a, b, ra, rb, t1), kt2: effMass(a, b, ra, rb, t2),
      bias, jn: 0, jt1: 0, jt2: 0,
    };
    if (prev) {
      let best: Point | null = null, bd = 0.0025;
      for (const q of prev.pts) {
        const dx = q.p[0] - c.p[0], dy = q.p[1] - c.p[1], dz = q.p[2] - c.p[2], d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < bd) { bd = d2; best = q; }
      }
      if (best) { p.jn = best.jn * 0.9; p.jt1 = best.jt1 * 0.9; p.jt2 = best.jt2 * 0.9; }
    }
    return p;
  }

  // ---------------------------------------------------------------- queries

  /** Closest hit along a ray. `dir` needn't be normalized. */
  raycast(origin: V3, dir: V3, maxDist = 1000, o: QueryOptions = {}): RayHit | null {
    const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const d = [dir[0] / l, dir[1] / l, dir[2] / l];
    const ign = o.ignore ? (Array.isArray(o.ignore) ? o.ignore : [o.ignore]) : [];
    let best: RayHit | null = null;
    let bestT = maxDist;
    for (const b of this.bodies) {
      if (!b.enabled || ign.includes(b) || (b.isTrigger && !o.triggers) || !(b.layer & (o.mask ?? 0xffffffff))) continue;
      if (b.shape.type !== 'plane' && !rayAABB(origin, d, b.aabb, bestT)) continue;
      const h = rayBody(b, origin, d, bestT);
      if (h && h[0] < bestT) {
        bestT = h[0];
        best = { body: b, distance: h[0], point: v3(origin[0] + d[0] * h[0], origin[1] + d[1] * h[0], origin[2] + d[2] * h[0]), normal: v3(h[1][0], h[1][1], h[1][2]) };
      }
    }
    return best;
  }

  /** Bodies overlapping a sphere. */
  overlapSphere(center: V3, radius: number, o: QueryOptions = {}): Body[] {
    return this.overlap(new Body({ type: 'kinematic', shape: sphereShape(radius), position: center }), o);
  }
  /** Bodies overlapping an oriented box. */
  overlapBox(center: V3, half: V3, rotation?: ArrayLike<number>, o: QueryOptions = {}): Body[] {
    return this.overlap(new Body({ type: 'kinematic', shape: boxShape(half[0], half[1], half[2]), position: center, rotation }), o);
  }
  /** Bodies overlapping a test body (not added to the world). */
  overlap(probe: Body, o: QueryOptions = {}): Body[] {
    computeAABB(probe);
    const ign = o.ignore ? (Array.isArray(o.ignore) ? o.ignore : [o.ignore]) : [];
    const out: Body[] = [];
    const cps: CP[] = [];
    for (const b of this.bodies) {
      if (!b.enabled || ign.includes(b) || (b.isTrigger && !o.triggers) || !(b.layer & (o.mask ?? 0xffffffff))) continue;
      const bb = b.aabb, pa = probe.aabb;
      if (b.shape.type !== 'plane' && (pa[0] > bb[3] || bb[0] > pa[3] || pa[1] > bb[4] || bb[1] > pa[4] || pa[2] > bb[5] || bb[2] > pa[5])) continue;
      cps.length = 0;
      collide(probe, b, cps);
      if (cps.some((c) => c.d > 0)) out.push(b);
    }
    return out;
  }

  /** Contacts of a probe body against the world (used by character controllers). Normals point from the world into the probe. */
  contacts(probe: Body, o: QueryOptions & { filter?: (b: Body) => boolean } = {}): { body: Body; n: number[]; d: number; p: number[] }[] {
    computeAABB(probe);
    const ign = o.ignore ? (Array.isArray(o.ignore) ? o.ignore : [o.ignore]) : [];
    const out: { body: Body; n: number[]; d: number; p: number[] }[] = [];
    const cps: CP[] = [];
    const pa = probe.aabb;
    for (const b of this.bodies) {
      if (!b.enabled || b === probe || ign.includes(b) || b.isTrigger || !(b.layer & (o.mask ?? 0xffffffff)) || (o.filter && !o.filter(b))) continue;
      const bb = b.aabb;
      if (b.shape.type !== 'plane' && (pa[0] > bb[3] || bb[0] > pa[3] || pa[1] > bb[4] || bb[1] > pa[4] || pa[2] > bb[5] || bb[2] > pa[5])) continue;
      cps.length = 0;
      collide(b, probe, cps);
      for (const c of cps) out.push({ body: b, n: c.n, d: c.d, p: c.p });
    }
    return out;
  }
}

// ---------------------------------------------------------------- math helpers
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: number[]) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const v2 = (b: Body) => b.velocity[0] ** 2 + b.velocity[1] ** 2 + b.velocity[2] ** 2;
const invM = (b: Body) => (b.sleeping ? 0 : b.invMass);

function mulI(b: Body, v: number[]) {
  const I = b.invInertiaWorld;
  return [I[0] * v[0] + I[3] * v[1] + I[6] * v[2], I[1] * v[0] + I[4] * v[1] + I[7] * v[2], I[2] * v[0] + I[5] * v[1] + I[8] * v[2]];
}
function effMass(a: Body, b: Body, ra: number[], rb: number[], n: number[]) {
  let k = invM(a) + invM(b);
  if (invM(a)) { const c = cross(ra, n), ic = mulI(a, c); k += c[0] * ic[0] + c[1] * ic[1] + c[2] * ic[2]; }
  if (invM(b)) { const c = cross(rb, n), ic = mulI(b, c); k += c[0] * ic[0] + c[1] * ic[1] + c[2] * ic[2]; }
  return k || 1;
}
function relVel(a: Body, b: Body, ra: number[], rb: number[], n: number[]) {
  const wa = a.angularVelocity, wb = b.angularVelocity, va = a.velocity, vb = b.velocity;
  const x = vb[0] + wb[1] * rb[2] - wb[2] * rb[1] - (va[0] + wa[1] * ra[2] - wa[2] * ra[1]);
  const y = vb[1] + wb[2] * rb[0] - wb[0] * rb[2] - (va[1] + wa[2] * ra[0] - wa[0] * ra[2]);
  const z = vb[2] + wb[0] * rb[1] - wb[1] * rb[0] - (va[2] + wa[0] * ra[1] - wa[1] * ra[0]);
  return x * n[0] + y * n[1] + z * n[2];
}
function applyImp(a: Body, b: Body, ra: number[], rb: number[], jx: number, jy: number, jz: number) {
  const ia = invM(a), ib = invM(b);
  if (ia) {
    const lf = a.linearFactor;
    a.velocity[0] -= jx * ia * lf[0]; a.velocity[1] -= jy * ia * lf[1]; a.velocity[2] -= jz * ia * lf[2];
    const t = mulI(a, [ra[1] * jz - ra[2] * jy, ra[2] * jx - ra[0] * jz, ra[0] * jy - ra[1] * jx]);
    a.angularVelocity[0] -= t[0]; a.angularVelocity[1] -= t[1]; a.angularVelocity[2] -= t[2];
  }
  if (ib) {
    const lf = b.linearFactor;
    b.velocity[0] += jx * ib * lf[0]; b.velocity[1] += jy * ib * lf[1]; b.velocity[2] += jz * ib * lf[2];
    const t = mulI(b, [rb[1] * jz - rb[2] * jy, rb[2] * jx - rb[0] * jz, rb[0] * jy - rb[1] * jx]);
    b.angularVelocity[0] += t[0]; b.angularVelocity[1] += t[1]; b.angularVelocity[2] += t[2];
  }
}

function composeTR(o: Float32Array, p: ArrayLike<number>, q: ArrayLike<number>) {
  const ax = axes(q);
  o.set([...ax[0], 0, ...ax[1], 0, ...ax[2], 0, p[0], p[1], p[2], 1]);
  return o;
}

function rayAABB(o: V3, d: number[], bb: Float32Array, maxT: number) {
  let t0 = 0, t1 = maxT;
  for (let k = 0; k < 3; k++) {
    const inv = 1 / d[k];
    let a = (bb[k] - o[k]) * inv, b = (bb[k + 3] - o[k]) * inv;
    if (a > b) { const s = a; a = b; b = s; }
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return false;
  }
  return true;
}

/** Ray vs body shape in world space. Returns [t, normal]. */
function rayBody(b: Body, o: V3, d: number[], maxT: number): [number, number[]] | null {
  const s = b.shape, c = b.position;
  const ax = axes(b.rotation);
  // local ray
  const rel = [o[0] - c[0], o[1] - c[1], o[2] - c[2]];
  const lo = [rel[0] * ax[0][0] + rel[1] * ax[0][1] + rel[2] * ax[0][2], rel[0] * ax[1][0] + rel[1] * ax[1][1] + rel[2] * ax[1][2], rel[0] * ax[2][0] + rel[1] * ax[2][1] + rel[2] * ax[2][2]];
  const ld = [d[0] * ax[0][0] + d[1] * ax[0][1] + d[2] * ax[0][2], d[0] * ax[1][0] + d[1] * ax[1][1] + d[2] * ax[1][2], d[0] * ax[2][0] + d[1] * ax[2][1] + d[2] * ax[2][2]];
  const toW = (n: number[]) => [ax[0][0] * n[0] + ax[1][0] * n[1] + ax[2][0] * n[2], ax[0][1] * n[0] + ax[1][1] * n[1] + ax[2][1] * n[2], ax[0][2] * n[0] + ax[1][2] * n[1] + ax[2][2] * n[2]];
  const sphere = (cy: number, r: number): number => {
    const oy = lo[1] - cy;
    const B = lo[0] * ld[0] + oy * ld[1] + lo[2] * ld[2];
    const C = lo[0] * lo[0] + oy * oy + lo[2] * lo[2] - r * r;
    const disc = B * B - C;
    if (disc < 0) return -1;
    const t = -B - Math.sqrt(disc);
    return t >= 0 ? t : C < 0 ? 0 : -1;
  };
  switch (s.type) {
    case 'sphere': {
      const t = sphere(0, s.radius);
      if (t < 0 || t > maxT) return null;
      const p = [lo[0] + ld[0] * t, lo[1] + ld[1] * t, lo[2] + ld[2] * t];
      return [t, toW(norm(p))];
    }
    case 'box': {
      let t0 = 0, t1 = maxT, axis = -1, sign = 1;
      for (let k = 0; k < 3; k++) {
        const h = s.half[k];
        if (Math.abs(ld[k]) < 1e-12) { if (lo[k] < -h || lo[k] > h) return null; continue; }
        let a = (-h - lo[k]) / ld[k], bb = (h - lo[k]) / ld[k], sg = -1;
        if (a > bb) { const q = a; a = bb; bb = q; sg = 1; }
        if (a > t0) { t0 = a; axis = k; sign = sg; }
        t1 = Math.min(t1, bb);
        if (t0 > t1) return null;
      }
      const n = [0, 0, 0];
      if (axis >= 0) n[axis] = sign;
      else n[1] = 1;
      return [t0, toW(n)];
    }
    case 'capsule': {
      let best = -1, bn: number[] = [0, 1, 0];
      const r = s.radius, h = s.half;
      // cylinder
      const A = ld[0] * ld[0] + ld[2] * ld[2];
      if (A > 1e-12) {
        const B = lo[0] * ld[0] + lo[2] * ld[2], C = lo[0] * lo[0] + lo[2] * lo[2] - r * r, disc = B * B - A * C;
        if (disc >= 0) {
          const t = (-B - Math.sqrt(disc)) / A, y = lo[1] + ld[1] * t;
          if (t >= 0 && Math.abs(y) <= h) { best = t; bn = norm([lo[0] + ld[0] * t, 0, lo[2] + ld[2] * t]); }
        }
      }
      for (const cy of [-h, h]) {
        const t = sphere(cy, r);
        if (t >= 0 && (best < 0 || t < best)) { best = t; bn = norm([lo[0] + ld[0] * t, lo[1] + ld[1] * t - cy, lo[2] + ld[2] * t]); }
      }
      return best >= 0 && best <= maxT ? [best, toW(bn)] : null;
    }
    case 'plane': {
      const den = ld[1];
      if (Math.abs(den) < 1e-12) return null;
      const t = -lo[1] / den;
      return t >= 0 && t <= maxT ? [t, toW([0, den < 0 ? 1 : -1, 0])] : null;
    }
    case 'mesh': {
      const h = s.tri.raycast(lo, ld, maxT);
      if (!h) return null;
      const tn = [s.tri.n[h[1] * 3], s.tri.n[h[1] * 3 + 1], s.tri.n[h[1] * 3 + 2]];
      const f = tn[0] * ld[0] + tn[1] * ld[1] + tn[2] * ld[2] > 0 ? -1 : 1;
      return [h[0], toW([tn[0] * f, tn[1] * f, tn[2] * f])];
    }
  }
}

// ---------------------------------------------------------------- shape fitting

/** Compute a shape fitting a node's geometry (in node local space, including node scale). */
export function fitShape(node: Node, kind: ShapeKind): { shape: Shape; offset: number[] } {
  node.updateWorld();
  for (const c of node.children) c.updateMatrices(node.worldMatrix);
  const inv = m4invert(m4(), node.worldMatrix);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let geomMesh: Mesh | null = null;
  const tmp = v3(), rel = m4();
  node.traverse((n) => {
    if (!(n instanceof Mesh) || !n.geometry) return;
    geomMesh ??= n;
    m4mul(rel, inv, n.worldMatrix);
    const b = n.geometry.bounds;
    for (let i = 0; i < 8; i++) {
      v3transformMat4(tmp, [i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]], rel);
      for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], tmp[k]); max[k] = Math.max(max[k], tmp[k]); }
    }
  });
  if (min[0] === Infinity) { min.fill(-0.5); max.fill(0.5); }
  const sc = node.scale;
  const half = [0, 1, 2].map((k) => ((max[k] - min[k]) / 2) * Math.abs(sc[k]));
  const offset = [0, 1, 2].map((k) => ((max[k] + min[k]) / 2) * sc[k]);
  switch (kind) {
    case 'sphere': return { shape: sphereShape(Math.max(...half)), offset };
    case 'capsule': {
      const r = Math.max(half[0], half[2]);
      return { shape: capsuleShape(r, Math.max(0, half[1] - r)), offset };
    }
    case 'mesh': {
      const m = geomMesh as Mesh | null;
      if (!m) throw new Error('mesh shape requires a Mesh');
      return { shape: meshShape(m.geometry, node.scale), offset: [0, 0, 0] };
    }
    default: return { shape: boxShape(half[0], half[1], half[2]), offset };
  }
}
