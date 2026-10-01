// Buildable car: a grid of parts -> one rigid body (box around the frame) with soft sphere-probe wheels and fans.
import { Node, v3, v3transformQuat, clamp, rand, quat, qeuler, type Texture } from 'aiwebengine';
import { Body, sphereShape, boxShape, type PhysicsWorld } from 'aiwebengine/physics';
import { Particles } from 'aiwebengine/fx';
import { px } from './fx';
import { createNoob, sit, PX, type Noob } from './noob';
import { buildPart, spinTo, noobPose, type Spinner } from './models';
import type { Hazards } from './obstacles';
import {
  GW, GH, CELL, WHEEL, FAN, SEAT, NOOB_MASS, kindOf, lvlOf, isItem, idx, cellX, cellY, seatOf, reach, connected, fanDir, fanAttach,
  wheelRadius, wheelGrip, fanThrust, fanSpeed, partMass, partStrength, type Design,
} from './parts';

const HALF_Z = 0.45;
/** share of the forward fans' thrust lost with all wheels on ice */
const ICE_SLIP = 0.65;

// ---------------------------------------------------------------- visuals

export interface WheelVis { node: Node; spin: Spinner[]; x: number; y: number; r: number; lvl: number; cell: number }
export interface FanVis { node: Node; rotors: Spinner[]; wind: Particles; x: number; y: number; lvl: number; dir: 'up' | 'fwd'; cell: number }

export interface CarVisual {
  root: Node;
  noob: Noob;
  wheels: WheelVis[];
  fans: FanVis[];
  /** cell -> node */
  parts: Map<number, Node>;
}

/**
 * Part from its data model (parts.json), fans turned to the side they're attached on;
 * fans also get a wind emitter blowing opposite to their thrust. `arrows` = thrust arrows (garage only).
 */
function partNode(d: Design, i: number, arrows: boolean): { node: Node; spin?: Spinner[]; rotors?: Spinner[]; wind?: Particles } {
  const v = d[i], k = kindOf(v);
  const dir = k === FAN ? fanDir(d, i) : 'fwd';
  const { node, spins } = buildPart(v, k === FAN ? fanAttach(d, i) : 'left', undefined, arrows);
  if (k === WHEEL) return { node, spin: spins };
  if (k === FAN) {
    const wind = node.add(new Particles(px({
      max: 80, rate: 0, lifetime: [0.25, 0.45], speed: [3, 5], shape: 'cone', angle: 0.35, direction: dir === 'up' ? [0, -1, 0] : [-1, 0, 0],
      size: [0.12, 0.3], color: 0xffffff, alpha: [0.55, 0], blend: 'alpha', worldSpace: true,
    })));
    return { node, rotors: spins, wind };
  }
  return { node };
}
/** Build the car's visual node from a design. Only `only` cells are used when given; `arrows` = fan thrust arrows (garage). */
export function buildCarVisual(d: Design, skin: Texture, only?: Set<number>, arrows = true): CarVisual {
  const root = new Node('car');
  const wheels: WheelVis[] = [], fans: FanVis[] = [], parts = new Map<number, Node>();
  for (let r = 0; r < GH; r++) for (let c = 0; c < GW; c++) {
    const i = idx(c, r), v = d[i];
    if (!v || (only && !only.has(i))) continue;
    const { node, spin, rotors, wind } = partNode(d, i, arrows);
    const x = cellX(c), y = cellY(r), l = lvlOf(v);
    root.add(node).setPosition(x, y, 0);
    parts.set(i, node);
    if (spin) wheels.push({ node, spin, x, y, r: wheelRadius(l), lvl: l, cell: i });
    if (rotors) fans.push({ node, rotors, wind: wind!, x, y, lvl: l, dir: fanDir(d, i), cell: i });
  }
  const [sc, sr] = seatOf(d);
  const noob = createNoob(skin);
  sit(noob);
  const [p, r] = noobSpot(sc, sr);
  root.add(noob.root).setPosition(p[0], p[1], p[2]);
  noob.root.rotation.set(r);
  return { root, noob, wheels, fans, parts };
}

/** noob root position (car space) and rotation on the seat at (sc, sr), from the seat model's pose */
function noobSpot(sc: number, sr: number): [number[], Float32Array] {
  const { pos, rot } = noobPose(), d = Math.PI / 180;
  return [[cellX(sc) + pos[0], cellY(sr) + pos[1], pos[2]], qeuler(quat(), rot[0] * d, rot[1] * d, rot[2] * d)];
}
/** a point of the sitting noob (its own space, e.g. the head) in car space */
function noobPoint(sc: number, sr: number, local: number[]) {
  const [p, q] = noobSpot(sc, sr), v = v3transformQuat(v3(), v3(local[0], local[1], local[2]), q);
  return [p[0] + v[0], p[1] + v[1], p[2] + v[2]];
}

// ---------------------------------------------------------------- physics

interface WheelState {
  vis: WheelVis; k: number; c: number; mu: number; probe: Body; grounded: boolean; comp: number; vt: number; angle: number; lift: number;
  /** most negative normal speed this step (hitting the ground) */
  impact: number;
  /** in mud / on ice this step */
  mud: boolean;
  ice: boolean;
}
interface Layout { m: number; com: number[]; off: number[]; hx: number; hy: number; I: number }
export interface Debris { body: Body; node: Node }

const tmp = v3(), tmp2 = v3(), tmp3 = v3();
const groundOnly = (o: Body) => !!o.data.ground;
/** slime is soft: no damage, no head crash */
const hardOnly = (o: Body) => !!o.data.ground && !o.data.soft;
const touchable = (o: Body) => !!(o.data.lift || o.data.piston || o.data.soft);
/**
 * The world is flat along Z: real surface normals have no Z part. A sphere near the diagonal of a ground quad also gets
 * an edge contact of the neighbouring triangle, tilted sideways and backwards - a phantom bump that would knock parts off.
 */
const flat = (n: ArrayLike<number>) => Math.abs(n[2]) < 0.1;
type Hit = { body: Body; n: number[]; d: number; p: number[] };
/**
 * Real contacts of a probe: flat ones, minus ghost edges. A sphere resting on one ground quad also touches the edge of the
 * next quad where two segments meet (a tilted normal, "hitting" the seam); such a shallow contact is dropped when the same
 * body gives a clearly deeper one in a similar direction. A real step stays: its wall is a face, its corner gets deeper.
 */
function solid(cs: Hit[]): Hit[] {
  const ok = cs.filter((c) => c.d > 0 && flat(c.n));
  return ok.filter((c) => !ok.some((o) => o !== c && o.body === c.body && o.d > c.d + 0.03 && o.n[0] * c.n[0] + o.n[1] * c.n[1] > 0.5));
}
/** collision layers: the car doesn't collide with its own broken-off parts */
const L_CAR = 2, L_DEBRIS = 8;

export class Car {
  body: Body;
  vis: CarVisual;
  mass = 0;
  /** fans blow while true (player holds the screen) */
  thrust = false;
  grounded = false;
  crashed = false;
  /** the seat broke off (the noob is thrown out) */
  seatLost = false;
  /** cells still attached to the car */
  alive: Set<number>;
  debris: Debris[] = [];
  onCrash?: () => void;
  onBreak?: (at: number[], part: number) => void;
  onFlip?: () => void;
  /** mud and spikes of the level */
  hazards: Hazards | null = null;
  /** bodies touched during the last step (lifts crush it, pistons fire) */
  touch = new Set<Body>();
  wheels: WheelState[] = [];
  fans: FanVis[] = [];
  private _all: WheelState[] = [];
  private _d: Design;
  private _seat: number;
  private _com = [0, 0];
  /** distance from the box center down to the lowest point of the car (upright) */
  private _bottom = 0;
  private _fanAngle = 0;
  /** rotor speed (rad/s): spins up while thrusting, winds down to a stop when released */
  private _fanSpin = 0;
  private _off: () => void;
  private _head: Body;
  private _headLocal: number[];
  private _noobLocal: number[];
  private _probe = new Body({ type: 'kinematic', shape: boxShape(CELL / 2 + 0.02, CELL / 2 + 0.02, HALF_Z) });

  constructor(public world: PhysicsWorld, d: Design, skin: Texture, parent: Node, at: number[]) {
    this._d = d.slice();
    const keep = connected(d);
    this.alive = new Set(keep);
    // no thrust arrows on the road: they're a building hint
    const vis = (this.vis = buildCarVisual(d, skin, keep, false));
    parent.add(vis.root).setPosition(at[0], at[1], 0);
    const [sc, sr] = seatOf(d);
    this._seat = idx(sc, sr);
    // the noob's weight: its body center, a bit above the seat
    this._noobLocal = noobPoint(sc, sr, [0, 0.65, 0]);
    const L = this._layout()!;
    this.body = world.add(vis.root, {
      shape: boxShape(L.hx, L.hy, HALF_Z), offset: L.off, mass: L.m, friction: 0.6, restitution: 0.05, layer: L_CAR,
      gravityScale: 0, linearFactor: [1, 1, 0], angularFactor: [0, 0, 1], angularDamping: 0.6, linearDamping: 0.02, canSleep: false,
    });
    for (const w of vis.wheels) {
      this._all.push({
        vis: w, k: 0, c: 0, mu: wheelGrip(w.lvl), probe: new Body({ type: 'kinematic', shape: sphereShape(w.r) }),
        grounded: false, comp: 0, vt: 0, angle: 0, lift: 0, impact: 0, mud: false, ice: false,
      });
    }
    this._apply(L);
    this._head = new Body({ type: 'kinematic', shape: sphereShape(0.16) });
    // the head is 28 px above the sitting noob's root
    this._headLocal = noobPoint(sc, sr, [0, 28 * PX, 0]);
    this._off = world.onPreStep((dt) => this._step(dt));
  }

  get speed() { return this.body.velocity[0]; }
  /** 1 = driving to +X, -1 = turned around by a piston (the car is rotated 180° about Y) */
  get facing() { const q = this.body.rotation; return 1 - 2 * (q[0] * q[0] + q[1] * q[1]) >= 0 ? 1 : -1; }
  /** world height of the car's lowest point (when upright) */
  get bottomY() { return this.body.position[1] - this._bottom; }

  /** turn around (piston): rotate 180° about the vertical axis, bounce back a little */
  flip() {
    const b = this.body, q = b.rotation, x = q[0], y = q[1], z = q[2], w = q[3];
    // world rotation by 180° about Y: (0,1,0,0) * q
    q[0] = z; q[1] = w; q[2] = -x; q[3] = -y;
    b.prevRot.set(q);
    b.angularVelocity[2] *= -1;
    b.velocity[0] *= -0.3;
    b.updateInertiaWorld();
    this.onFlip?.();
  }

  /** local (car-root space) point -> world */
  toWorld(lx: number, ly: number, out = v3()) {
    const b = this.body, o = b.offset;
    tmp[0] = lx - o[0]; tmp[1] = ly - o[1]; tmp[2] = 0;
    v3transformQuat(out, tmp, b.rotation);
    out[0] += b.position[0]; out[1] += b.position[1]; out[2] += b.position[2];
    return out;
  }
  /** car up vector y component (1 = upright, -1 = upside down) */
  get upY() { const q = this.body.rotation; return 1 - 2 * (q[0] * q[0] + q[2] * q[2]); }

  /** mass, center of mass, inertia and the solid bounding box of the attached parts (null = nothing solid left) */
  private _layout(): Layout | null {
    const d = this._d, pts: number[][] = [];
    let m = 0, cx = 0, cy = 0, x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    const add = (x: number, y: number, mm: number) => { m += mm; cx += x * mm; cy += y * mm; pts.push([x, y, mm]); };
    if (!this.seatLost) add(this._noobLocal[0], this._noobLocal[1], NOOB_MASS);
    for (const i of this.alive) {
      const v = d[i], x = cellX(i % GW), y = cellY(Math.floor(i / GW));
      add(x, y, partMass(v));
      if (!isItem(v)) { x0 = Math.min(x0, x - CELL / 2); x1 = Math.max(x1, x + CELL / 2); y0 = Math.min(y0, y - CELL / 2); y1 = Math.max(y1, y + CELL / 2); }
    }
    if (x0 > x1) return null;
    // with wheels below the frame, the collision box starts a bit above its bottom: the car rides on the wheels and the
    // box doesn't catch on flush edges (lift -> ground, slabs); hard landings still reach it (the bump stop is at 45% r)
    let low = 1e9;
    for (const i of this.alive) if (kindOf(d[i]) === WHEEL) low = Math.min(low, cellY(Math.floor(i / GW)) - wheelRadius(lvlOf(d[i])));
    if (low < y0 - 0.02) y0 = Math.min(y0 + 0.12, y1 - 0.3);
    const off = [(x0 + x1) / 2, (y0 + y1) / 2, 0];
    let I = 0;
    for (const [x, y, mm] of pts) I += mm * ((x - off[0]) ** 2 + (y - off[1]) ** 2 + (CELL * CELL) / 6);
    return { m, com: [cx / m, cy / m], off, hx: (x1 - x0) / 2, hy: (y1 - y0) / 2, I };
  }

  /** (re)configure the body for the current set of parts, keeping the car origin in place */
  private _apply(L: Layout) {
    const b = this.body;
    this.mass = L.m;
    this._com = L.com;
    const dv = v3(L.off[0] - b.offset[0], L.off[1] - b.offset[1], 0);
    if (dv[0] || dv[1]) {
      v3transformQuat(dv, v3(dv[0], dv[1], 0), b.rotation);
      for (let k = 0; k < 3; k++) { b.position[k] += dv[k]; b.prevPos[k] += dv[k]; }
    }
    b.offset.set(L.off);
    b.shape = boxShape(L.hx, L.hy, HALF_Z);
    b.setMass(L.m);
    // inertia around the box center from the actual part layout
    b.invInertia[2] = 1 / L.I;
    b.updateInertiaWorld();
    this.wheels = this._all.filter((w) => this.alive.has(w.vis.cell));
    this.fans = this.vis.fans.filter((f) => this.alive.has(f.cell));
    let low = L.off[1] - L.hy;
    for (const w of this.wheels) low = Math.min(low, w.vis.y - w.vis.r);
    this._bottom = L.off[1] - low;
    const n = Math.max(1, this.wheels.length), sag = 0.08;
    for (const w of this.wheels) {
      w.k = (L.m * 9.81) / (n * sag);
      w.c = 2 * 0.5 * Math.sqrt((w.k * L.m) / n);
    }
  }

  private _step(_dt: number) {
    const b = this.body;
    if (!b.enabled) return;
    const v = b.velocity, wz = b.angularVelocity[2], m = this.mass;
    // gravity at the real center of mass (gives the car its balance on its wheels). The body turns around its box center,
    // so in the air that would be a false torque spinning the car: there it pulls at the body center.
    // (`grounded` / `touch` are still from the last step here)
    const airborne = !this.grounded && this.touch.size === 0;
    this.toWorld(this._com[0], this._com[1], tmp2);
    b.applyForce([0, -9.81 * m, 0], airborne ? b.position : tmp2);
    let grounded = 0;
    const touch = this.touch, hz = this.hazards;
    touch.clear();
    const share = m / Math.max(1, this.wheels.length);
    for (const w of this.wheels) {
      const wc = this.toWorld(w.vis.x, w.vis.y), r = w.vis.r;
      w.probe.position.set(wc);
      const cs = this.world.contacts(w.probe, { filter: groundOnly });
      // merge contacts with similar normals (triangle seams), keep the deepest of each
      const pick: { n: number[]; d: number; o: Body }[] = [];
      const add = (n: number[], d: number, o: Body) => {
        touch.add(o);
        const same = pick.find((p) => p.n[0] * n[0] + p.n[1] * n[1] > 0.9);
        if (!same) pick.push({ n, d, o });
        else if (d > same.d) { same.n = n; same.d = d; same.o = o; }
      };
      // Is the wheel center under the ground? The frame is always above it, so a ray from the car's center to the
      // wheel center that enters the ground means the wheel got inside (fast landing, a corner of a cliff...).
      // The ground is one-sided, so in that case its own contacts are wrong or missing: push out along that surface.
      const under = this._underground(wc);
      if (under) add(under.n, r + under.depth, under.o);
      else for (const c of solid(cs)) add(c.n, c.d, c.body);
      w.grounded = pick.length > 0;
      w.mud = w.grounded && !!hz?.mud(wc[0], wc[1] - r);
      w.ice = w.grounded && !w.mud && !!hz?.ice(wc[0], wc[1] - r);
      w.comp = 0;
      w.impact = 0;
      const rx = wc[0] - b.position[0], ry = wc[1] - b.position[1];
      const px = v[0] - wz * ry, py = v[1] + wz * rx;
      for (const { n, d, o } of pick) {
        // speed relative to the surface (lifts move)
        const gv = o.velocity, vx = px - gv[0], vy = py - gv[1];
        const nx = n[0], ny = n[1], l = Math.hypot(nx, ny) || 1;
        const ux = nx / l, uy = ny / l, tx = uy, ty = -ux;
        const vn = vx * ux + vy * uy, vt = vx * tx + vy * ty;
        if (!o.data.soft) w.impact = Math.min(w.impact, vn);
        const fn = clamp(w.k * d - w.c * vn, 0, m * 9.81 * 6);
        // free-rolling wheels: only a little rolling resistance; platforms carry the car along
        // ice: almost no rolling resistance (the car keeps sliding)
        const ft = clamp(-vt * share * (o.data.lift ? 0.6 : w.ice ? 0.004 : 0.04), -w.mu * fn, w.mu * fn);
        b.applyForce([ux * fn + tx * ft, uy * fn + ty * ft, 0], wc);
        // mud grabs the wheels: drag at the center of mass (slows the car down without tipping it over)
        if (w.mud) { const fm = clamp(-vt * share * 2, -w.mu * fn, w.mu * fn); b.applyForce([tx * fm, ty * fm, 0], tmp2); }
        // bump stop: the suspension bottomed out -> stop sinking like a rigid contact and push the car back out
        const stop = r * 0.45;
        if (d > stop) {
          if (vn < 0) { const J = -vn * share; b.applyImpulse([ux * J, uy * J, 0], wc); }
          const push = Math.min(d - stop, 0.5) * 0.6;
          b.position[0] += ux * push;
          b.position[1] += uy * push;
        }
        w.comp = Math.max(w.comp, d);
        w.vt = vt;
      }
      if (w.grounded) grounded++;
    }
    this.grounded = grounded > 0;
    // the frame itself standing on a platform / pushing into a pad
    for (const c of this.world.contacts(b, { filter: touchable })) touch.add(c.body);
    // fans: forward ones push along the car at the height of the center of mass (no flipping),
    // lifting ones push up at their own position (off-center lift tilts the car)
    // ice under the wheels: they spin and slip, forward fans get the car going much slower
    const onGround = this.wheels.filter((w) => w.grounded), iced = onGround.filter((w) => w.ice).length;
    const iceGrip = onGround.length ? 1 - ICE_SLIP * (iced / onGround.length) : 1;
    if (this.thrust && this.fans.length) {
      const q = b.rotation;
      const fx = 1 - 2 * (q[1] * q[1] + q[2] * q[2]), fy = 2 * (q[0] * q[1] + q[2] * q[3]);
      const ux = 2 * (q[0] * q[1] - q[2] * q[3]), uy = 1 - 2 * (q[0] * q[0] + q[2] * q[2]);
      for (const f of this.fans) {
        const up = f.dir === 'up';
        const ax = up ? ux : fx, ay = up ? uy : fy;
        const along = v[0] * ax + v[1] * ay;
        const F = fanThrust(f.lvl) * (1 - clamp(along / fanSpeed(f.lvl), 0, 1)) * (up ? 1 : iceGrip);
        this.toWorld(f.x, up ? f.y : this._com[1], tmp3);
        if (airborne && !up) tmp3.set(b.position);
        b.applyForce([ax * F, ay * F, 0], tmp3);
      }
    }
    // the noob's head must not touch the ground
    if (!this.crashed && !this.seatLost) {
      this.toWorld(this._headLocal[0], this._headLocal[1], this._head.position);
      const hp = this._head.position;
      if (this.world.contacts(this._head, { filter: hardOnly }).some((c) => c.d > 0.03) || hz?.spike(hp[0], hp[1], 0.16)) {
        this.crashed = true;
        this.onCrash?.();
      }
    }
    // hard hits knock parts off: impact speed into the ground above the part's strength; landing on slime cushions the
    // whole car (a thin slime pad on the ground mustn't let the parts hit the ground under it)
    const broken: number[] = [];
    const cushioned = [...touch].some((o) => o.data.soft && !o.data.lift);
    for (const w of this.wheels) {
      if (!cushioned && w.impact < -partStrength(this._d[w.vis.cell])) { broken.push(w.vis.cell); continue; }
      if (hz) { const wc = this.toWorld(w.vis.x, w.vis.y, tmp3); if (hz.spike(wc[0], wc[1], w.vis.r)) broken.push(w.vis.cell); }
    }
    const pr = this._probe;
    pr.rotation.set(b.rotation);
    for (const i of this.alive) {
      const p = this._d[i];
      if (kindOf(p) === WHEEL) continue;
      this.toWorld(cellX(i % GW), cellY(Math.floor(i / GW)), pr.position);
      if (hz?.spike(pr.position[0], pr.position[1], CELL / 2)) { broken.push(i); continue; }
      let worst = 0;
      for (const c of solid(this.world.contacts(pr, { filter: hardOnly }))) {
        const rx = c.p[0] - b.position[0], ry = c.p[1] - b.position[1];
        worst = Math.min(worst, (v[0] - wz * ry) * c.n[0] + (v[1] + wz * rx) * c.n[1]);
      }
      if (!cushioned && worst < -partStrength(p)) broken.push(i);
    }
    if (broken.length) this._break(broken);
  }

  /**
   * Wheel center under the ground surface? Ray from the car's center to it: entering the ground on the way means yes
   * (unless the ray comes out again before the wheel, e.g. through a thin hump). Returns the surface normal (facing the
   * car) and how deep under it the center is.
   */
  private _underground(wc: ArrayLike<number>): { n: number[]; depth: number; o: Body } | null {
    const o = this.body.position, dx = wc[0] - o[0], dy = wc[1] - o[1], len = Math.hypot(dx, dy);
    if (len < 1e-4) return null;
    const ux = dx / len, uy = dy / len;
    const hit = this.world.raycast(o, [ux, uy, 0], len, { ignore: this.body });
    if (!hit || !hit.body.data.ground) return null;
    // came out again before reaching the wheel -> the wheel is above ground
    const p = hit.point, rest = len - hit.distance;
    const back = this.world.raycast([p[0] + ux * 0.01, p[1] + uy * 0.01, 0], [ux, uy, 0], rest - 0.01, { ignore: this.body });
    if (back && back.body.data.ground) return null;
    let nx = hit.normal[0], ny = hit.normal[1];
    if (nx * ux + ny * uy > 0) { nx = -nx; ny = -ny; }
    return { n: [nx, ny, 0], depth: rest * Math.abs(nx * ux + ny * uy), o: hit.body };
  }
  /** crushed (a lift came down on it): every part comes off, the noob is thrown out */
  crush() {
    if (this.alive.size) this._break([...this.alive]);
  }
  private _break(cells: number[]) {
    for (const i of cells) this._detach(i);
    const has = (j: number) => this.alive.has(j);
    let keep: Set<number> | null = null;
    if (has(this._seat)) keep = reach(this._d, this._seat, has);
    else {
      // without the seat the biggest remaining chunk stays the car
      for (const j of this.alive) {
        if (isItem(this._d[j]) || keep?.has(j)) continue;
        const comp = reach(this._d, j, has);
        if (!keep || comp.size > keep.size) keep = comp;
      }
    }
    for (const j of [...this.alive]) if (!keep?.has(j)) this._detach(j);
    const L = this._layout();
    if (L) this._apply(L);
    else { this.body.enabled = false; this.wheels = []; this.fans = []; }
    if (this.seatLost && !this.crashed) { this.crashed = true; this.onCrash?.(); }
  }

  /** turn a part into a separate tumbling body */
  private _detach(i: number) {
    if (!this.alive.delete(i)) return;
    const p = this._d[i], node = this.vis.parts.get(i)!, b = this.body;
    if (kindOf(p) === SEAT) this.seatLost = true;
    const wp = this.toWorld(cellX(i % GW), cellY(Math.floor(i / GW)));
    const rx = wp[0] - b.position[0], ry = wp[1] - b.position[1], wz = b.angularVelocity[2];
    this.vis.root.parent!.add(node);
    node.position.set(wp);
    node.rotation.set(b.rotation);
    const body = this.world.add(node, {
      shape: kindOf(p) === WHEEL ? sphereShape(wheelRadius(lvlOf(p))) : boxShape(CELL / 2, CELL / 2, HALF_Z), mass: partMass(p),
      friction: 0.7, restitution: 0.25, layer: L_DEBRIS, mask: 1, linearFactor: [1, 1, 0], angularFactor: [0, 0, 1], angularDamping: 0.3,
    });
    body.setVelocity(b.velocity[0] - wz * ry + rand(-1, 1), b.velocity[1] + wz * rx + rand(1, 2.5), 0);
    body.angularVelocity[2] = wz + rand(-5, 5);
    this.debris.push({ body, node });
    this.onBreak?.([wp[0], wp[1], 0], p);
  }

  /** visuals: wheel spin, suspension, fan rotors and wind */
  update(dt: number) {
    for (const w of this.wheels) {
      if (w.grounded) w.angle -= (w.vt / w.vis.r) * dt;
      w.lift += (Math.min(w.comp, 0.14) + (w.mud ? 0.06 : 0) - w.lift) * Math.min(1, dt * 20);
      w.vis.node.position[1] = w.vis.y + w.lift * 0.8;
      for (const s of w.vis.spin) spinTo(s, w.angle);
    }
    const on = this.thrust && !this.crashed;
    this._fanSpin += ((on ? 30 : 0) - this._fanSpin) * Math.min(1, dt * (on ? 8 : 2.5));
    this._fanAngle += dt * this._fanSpin;
    for (const f of this.fans) {
      for (const r of f.rotors) spinTo(r, -this._fanAngle);
      if (on) f.wind.emit(Math.ceil(dt * 60));
    }
  }

  destroy() {
    this._off();
    this.world.remove(this.body);
    this.vis.root.destroy();
    for (const d of this.debris) { this.world.remove(d.body); d.node.destroy(); }
    this.debris = [];
  }
}
