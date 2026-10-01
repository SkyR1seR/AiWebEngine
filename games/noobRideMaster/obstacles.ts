// Level obstacles: mud and ice strips, retractable spikes, levitating platforms (lifts), slime blocks and pistons.
import { Node, Mesh, Geometry, box, lambert, mergeGeometries, m4compose, quat, qeuler, clamp } from 'aiwebengine';
import { boxShape, type Body, type PhysicsWorld } from 'aiwebengine/physics';
import { Particles } from 'aiwebengine/fx';
import { px } from './fx';
import { pixelTex, pickC, traceSurface, blockTex, LIFT_T, PISTON_DIR, type Level } from './track';

/** depth of the platforms / pads along Z (the car drives at z = 0) */
const DEPTH = 3.2, ZC = -0.7;
/** spikes: full height, time to shoot out / pull in, warning before they come out */
const SPIKE_H = 0.6, OUT = 0.08, IN = 0.25, WARN = 0.6;

/** what the car asks about the level each physics step */
export interface Hazards {
  /** is this point (a wheel's bottom) in mud? */
  mud(x: number, y: number): boolean;
  /** ... on ice? */
  ice(x: number, y: number): boolean;
  /** does a circle of radius r at (x, y) touch spikes that are out? */
  spike(x: number, y: number, r: number): boolean;
}

/** what a piston does to the car */
export interface CarLike { body: Body; facing: number; bottomY: number; flip(): void }
/** pistons: head travel time out / in, how long it stays out, rest before it can fire again; up-piston throw speed (m/s) */
const P_OUT = 0.15, P_HOLD = 0.5, P_IN = 0.15, P_REST = 0.3, P_LAUNCH = 8.5, P_PUSH_DOWN = 5;
/** state 0 idle, 1 out, 2 going in, 3 resting; e = head extension 0..1 */
interface Piston { a: number[]; body: Body; node: Node; face: Mesh; head: Node; state: number; t: number; e: number }

/** s = 0..1 along the path, dir = where it's heading, wait = pause left at an end */
interface Lift { a: number[]; body: Body; node: Node; time: number; pause: number; s: number; dir: number; wait: number; glow: Particles }
interface Spike { a: number[]; node: Node; h: number }
/** a mud or ice strip: x range and the surface heights along it */
interface Strip { x0: number; x1: number; pts: number[][] }

const ease = (t: number) => t * t * (3 - 2 * t);

/** is (x, y) (a wheel's bottom) on one of the strips: inside its x range, near its surface */
function onStrip(list: Strip[], x: number, y: number) {
  for (const m of list) {
    if (x < m.x0 || x > m.x1) continue;
    const i = clamp(Math.round((x - m.x0) / 0.25), 0, m.pts.length - 1), sy = m.pts[i][1];
    if (y > sy - 0.35 && y < sy + 0.3) return true;
  }
  return false;
}

/** box with its texture repeated once per meter on every face (not stretched), centered */
function tiledBox(w: number, h: number, d: number) {
  const g = box(w, h, d);
  const p = g.attributes.position.data, n = g.attributes.normal.data, uv = g.attributes.uv.data as Float32Array;
  for (let i = 0; i < p.length / 3; i++) {
    const ax = Math.abs(n[i * 3]), ay = Math.abs(n[i * 3 + 1]);
    // from the top-left corner of each face, so the blocks line up with the pad's edges
    uv[i * 2] = (ax > 0.5 ? p[i * 3 + 2] + d / 2 : p[i * 3] + w / 2);
    uv[i * 2 + 1] = (ay > 0.5 ? p[i * 3 + 2] + d / 2 : h / 2 - p[i * 3 + 1]);
  }
  return g.setAttribute('uv', uv, 2);
}

/** one spike: two crossed flat quads (like plants in Minecraft), base at y = 0 */
function spikeQuads(): Geometry {
  const s = SPIKE_H, hw = s / 2;
  const g = new Geometry()
    .setAttribute('position', [-hw, 0, 0, hw, 0, 0, hw, s, 0, -hw, s, 0], 3)
    .setAttribute('normal', [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3)
    .setAttribute('uv', [0, 1, 1, 1, 1, 0, 0, 0], 2)
    .setIndex([0, 1, 2, 0, 2, 3]);
  const m = (a: number) => { const o = new Float32Array(16); m4compose(o, [0, 0, 0], qeuler(quat(), 0, a, 0), [1, 1, 1]); return o; };
  return mergeGeometries([g, g], [m(Math.PI / 4), m(-Math.PI / 4)]);
}

const PLANKS = [0xa8834f, 0x9c7646, 0xb48d57, 0x8f6b3e];
const COBBLE = [0x7c7c7c, 0x6a6a6a, 0x8d8d8d, 0x5c5c5c, 0x969696];
/** Minecraft piston textures drawn as pixel art: top (planks with iron corners), side (planks band + cobblestone), bottom, inner */
function pistonTextures() {
  const plank = (x: number, y: number, r: number) => (y % 4 === 3 ? 0x6b4f2c : (x + (Math.floor(y / 4) % 2) * 8) % 16 === 15 ? 0x7a5a33 : pickC(PLANKS, r));
  const iron = (x: number, y: number) => (x < 3 || x > 12) && (y < 3 || y > 12);
  const cobble = (x: number, y: number, r: number) => (((x * 7 + y * 3) % 11 === 0 || (x * 3 + y * 5) % 13 === 0) ? 0x4a4a4a : pickC(COBBLE, r));
  return {
    top: blockTex.pistonTop ?? pixelTex(16, 16, (x, y, r) => (iron(x, y) ? (r < 0.5 ? 0xd4d4d4 : 0xbcbcbc) : plank(x, y, r))),
    side: blockTex.pistonSide ?? pixelTex(16, 16, (x, y, r) => (y < 4 ? plank(x, y, r) : cobble(x, y, r))),
    bottom: blockTex.pistonBottom ?? pixelTex(16, 16, (x, y, r) => cobble(x, y, r)),
    inner: blockTex.pistonInner ?? pixelTex(16, 16, (x, y, r) => (x > 5 && x < 10 && y > 5 && y < 10 ? 0x9c7646 : x > 3 && x < 12 && y > 3 && y < 12 ? 0x777777 : cobble(x, y, r))),
    // edge of the head plate: a plank strip with iron caps at both ends
    edge: pixelTex(16, 4, (x, y, r) => (x < 3 || x > 12 ? (r < 0.5 ? 0xd4d4d4 : 0xa8a8a8) : plank(x, y, r))),
    // the arm: planks along it with iron bands (as in Minecraft)
    arm: pixelTex(4, 16, (x, y, r) => (y % 8 < 2 ? (x === 0 || r < 0.3 ? 0x9a9a9a : 0xd0d0d0) : x === 3 ? 0x6b4f2c : pickC(PLANKS, r))),
  };
}

let geo: { spike: Geometry; lift: Geometry; beam: Geometry; arm: Geometry } | null = null;
let mat: { spike: any; plate: any; lift: any; glow: any; mud: any; ice: any; slime: any; beam: any; pTop: any; pSide: any; pBottom: any; pInner: any; pEdge: any; pArm: any } | null = null;
function assets() {
  geo ??= { spike: spikeQuads(), lift: box(1, LIFT_T, DEPTH), beam: box(0.08, 1, 0.08), arm: box(0.25, 1, 0.25) };
  const P = mat ? null : pistonTextures();
  mat ??= {
    pTop: lambert(0xffffff, { map: P!.top }), pSide: lambert(0xffffff, { map: P!.side }),
    pBottom: lambert(0xffffff, { map: P!.bottom }), pInner: lambert(0xffffff, { map: P!.inner }),
    pEdge: lambert(0xffffff, { map: P!.edge }), pArm: lambert(0xffffff, { map: P!.arm }),
    // bamboo shoots as spikes (cut out, both sides), on a smooth stone plate
    spike: blockTex.bamboo ? lambert(0xffffff, { map: blockTex.bamboo, alphaTest: 0.5, cull: 'none' }) : lambert(0xd9dde3, { cull: 'none' }),
    plate: blockTex.smooth ? lambert(0xffffff, { map: blockTex.smooth }) : lambert(0x55595f),
    ice: lambert(0xffffff, { map: blockTex.ice ?? pixelTex(16, 16, (_x, _y, r) => pickC([0x9ec3ff, 0x8fb6f5, 0xb3d1ff], r)), emissive: 0x9ec3ff, emissiveIntensity: 0.15 }),
    // purpur blocks (end city)
    lift: lambert(0xffffff, { map: blockTex.purpur ?? pixelTex(16, 16, (x, y, r) => (x % 8 === 0 || y % 8 === 0 ? 0x8a5f8a : pickC([0xa77ba7, 0xb487b4, 0x9d6f9d], r))) }),
    glow: lambert(0xd9a3ff, { emissive: 0xc27cff, emissiveIntensity: 1.2 }),
    // soul sand (slows down like in Minecraft)
    mud: lambert(0xffffff, { map: blockTex.soul ?? pixelTex(16, 16, (_x, _y, r) => (r < 0.1 ? 0x2e1d10 : pickC([0x4a3120, 0x563a25, 0x3f2a1b], r))) }),
    slime: lambert(0xffffff, {
      map: blockTex.slime ?? pixelTex(16, 16, (x, y, r) => (x === 0 || y === 0 || x === 15 || y === 15 ? 0x4f9e3c : x > 3 && x < 12 && y > 3 && y < 12 ? 0x8ce26f : pickC([0x76c95a, 0x7fd363], r))),
      emissive: 0x3a8a2a, emissiveIntensity: 0.15,
    }),
    beam: lambert(0xc27cff, { emissive: 0xc27cff, emissiveIntensity: 0.6, opacity: 0.35 }),
  };
  return { geo, mat };
}

export class Obstacles implements Hazards {
  root: Node;
  lifts: Lift[] = [];
  spikes: Spike[] = [];
  muds: Strip[] = [];
  ices: Strip[] = [];
  slime: Body[] = [];
  pistons: Piston[] = [];
  /** bodies the car touched during the last physics step (lifts wait for the car) */
  touch: Set<Body> | null = null;
  /** the car (lifts crush it, pistons push it) */
  car: CarLike | null = null;
  /** a piston fired (sound) */
  onPiston?: (a: number[]) => void;
  /** a lift came down on the car: it's crushed */
  onCrush?: () => void;
  /** physics time */
  t = 0;
  private _off: () => void;
  private _bodies: Body[] = [];

  constructor(public level: Level, private _world: PhysicsWorld, parent: Node) {
    const { geo: G, mat: M } = assets();
    const root = (this.root = parent.add(new Node('obstacles')));
    // mud (soul sand) and ice: strips following the surface, slightly above it
    for (const [list, out, material, lift] of [[level.mud, this.muds, M.mud, 0.04], [level.ice, this.ices, M.ice, 0.045]] as const) for (const m of list ?? []) {
      const [x0, x1] = m[0] < m[1] ? [m[0], m[1]] : [m[1], m[0]];
      const pts = traceSurface(level, x0, x1, m[2]);
      out.push({ x0, x1, pts });
      const p: number[] = [], n: number[] = [], uv: number[] = [], idx: number[] = [];
      const zf = 1.6, zb = -2.6;
      for (let i = 0; i < pts.length; i++) {
        const [x, y] = pts[i];
        p.push(x, y + lift, zf, x, y + lift, zb);
        n.push(0, 1, 0, 0, 1, 0);
        uv.push(x, -zf, x, -zb);
        if (i) { const b = (i - 1) * 2; idx.push(b, b + 2, b + 3, b, b + 3, b + 1); }
      }
      const mesh = root.add(new Mesh(new Geometry().setAttribute('position', p, 3).setAttribute('normal', n, 3).setAttribute('uv', uv, 2).setIndex(idx), material));
      mesh.castShadow = false;
    }
    // spikes: a smooth stone plate with a bed of bamboo-shoot spikes that shoots out of it
    for (const a of level.spikes ?? []) {
      const [x, y, w] = a;
      root.add(new Mesh(tiledBox(w, 0.1, DEPTH), M.plate)).setPosition(x, y - 0.03, ZC);
      const node = root.add(new Node('spikes')).setPosition(x, y, 0);
      const cols = Math.max(1, Math.round(w / 0.3)), rows = 5, mats: Float32Array[] = [];
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
        const m = new Float32Array(16);
        m4compose(m, [-w / 2 + (w * (i + 0.5)) / cols, 0, ZC + (j - (rows - 1) / 2) * 0.55], quat(), [1, 1, 1]);
        mats.push(m);
      }
      node.add(new Mesh(mergeGeometries(mats.map(() => G.spike), mats), M.spike));
      this.spikes.push({ a, node, h: 0 });
    }
    // levitating platforms: kinematic boxes driven every physics step
    for (const a of level.lifts ?? []) {
      const [x, y, w, dx, dy, time, pause, phase] = a;
      const node = root.add(new Node('lift'));
      // purpur blocks, tiled one per meter (not stretched over the platform)
      node.add(new Mesh(tiledBox(w, LIFT_T, DEPTH), M.lift)).setPosition(0, -LIFT_T / 2, ZC);
      node.add(new Mesh(G.lift, M.glow)).setPosition(0, -LIFT_T - 0.04, ZC).setScale(w * 0.8, 0.2, 0.8);
      const glow = node.add(new Particles(px({
        max: 60, rate: 14, lifetime: [0.5, 0.9], speed: [0.3, 0.8], shape: 'box', box: [w / 2, 0.02, DEPTH / 2 - 0.3], direction: [0, -1, 0],
        size: [0.14, 0.05], color: [0xf0c8ff, 0xb070ff], alpha: [0.9, 0], blend: 'add', worldSpace: true,
      }, 1)));
      glow.position.set([0, -LIFT_T - 0.05, ZC]);
      // faint guide beams along the path
      if (Math.hypot(dx, dy) > 0.1) {
        const len = Math.hypot(dx, dy), ang = Math.atan2(dy, dx) - Math.PI / 2;
        for (const s of [-1, 1]) {
          const beam = root.add(new Mesh(G.beam, M.beam));
          beam.castShadow = false;
          beam.setPosition(x + s * (w / 2 - 0.1) + dx / 2, y - LIFT_T / 2 + dy / 2, ZC - DEPTH / 2 + 0.05);
          beam.setRotation(0, 0, ang).setScale(1, len + LIFT_T, 1);
        }
      }
      const body = _world.add(null, {
        type: 'kinematic', shape: boxShape(w / 2, LIFT_T / 2, DEPTH / 2), position: [x, y - LIFT_T / 2, ZC], friction: 0.9,
      });
      body.data.ground = true;
      body.data.lift = true;
      // bumping into a moving platform doesn't knock parts off
      body.data.soft = true;
      this._bodies.push(body);
      const l: Lift = { a, body, node, time: Math.max(0.3, time || 2), pause: Math.max(0, pause ?? 1), s: 0, dir: 1, wait: 0, glow };
      this._start(l, phase || 0);
      this._place(l, ease(l.s), body.position);
      node.position.set([x + dx * ease(l.s), y + dy * ease(l.s), 0]);
      this.lifts.push(l);
    }
    // slime: soft blocks - standing walls or flat pads (nothing breaks on them, the head may touch them)
    for (const a of level.slime ?? []) {
      const [x, y0, y1] = a, w = a[3] > 0 ? a[3] : 1, hh = Math.max(0.2, y1 - y0);
      root.add(new Mesh(tiledBox(w, hh, DEPTH), M.slime)).setPosition(x, (y0 + y1) / 2, ZC);
      const body = _world.add(null, {
        type: 'static', shape: boxShape(w / 2, hh / 2, DEPTH / 2), position: [x, (y0 + y1) / 2, ZC], friction: 0.4, restitution: 0.6,
      });
      body.data.ground = true;
      body.data.soft = true;
      this._bodies.push(body);
      this.slime.push(body);
    }
    // pistons: a block whose face shoots out when the car touches it
    for (const a of level.pistons ?? []) this.pistons.push(this._piston(a, root, M));
    this._off = _world.onPreStep((dt) => this._step(dt));
  }

  /**
   * Piston model, built facing up in its own space (block center at the origin) and turned to its face direction:
   * the block (side texture on the sides, face texture in front, bottom texture behind; the front turns into the inner
   * texture while the head is out), and the head - a plank plate on a rod - that slides out by one block.
   */
  private _piston(a: number[], root: Node, M: NonNullable<typeof mat>): Piston {
    const [fx, fy] = PISTON_DIR[a[2] & 3] ?? PISTON_DIR[0], D = 3;
    // the model sits 1 cm proud of its block: a face flush with the ground doesn't flicker with the grass
    const node = root.add(new Node('piston')).setPosition(a[0] - fx * 0.49, a[1] - fy * 0.49, ZC);
    node.setRotation(0, 0, Math.atan2(fy, fx) - Math.PI / 2);
    const quad = (p: number[][], n: number[], uv: number[][]) => new Geometry().setAttribute('position', p.flat(), 3)
      .setAttribute('normal', [...n, ...n, ...n, ...n], 3).setAttribute('uv', uv.flat(), 2).setIndex([0, 1, 2, 0, 2, 3]);
    const h = 0.5, z0 = -D / 2, z1 = D / 2;
    // sides (texture upright: planks band towards the face), the face (+Y) and the back (-Y), D blocks deep
    const sides = mergeGeometries([
      quad([[-h, -h, z1], [h, -h, z1], [h, h, z1], [-h, h, z1]], [0, 0, 1], [[0, 1], [1, 1], [1, 0], [0, 0]]),
      quad([[h, -h, z0], [-h, -h, z0], [-h, h, z0], [h, h, z0]], [0, 0, -1], [[0, 1], [1, 1], [1, 0], [0, 0]]),
      quad([[h, -h, z1], [h, -h, z0], [h, h, z0], [h, h, z1]], [1, 0, 0], [[0, 1], [D, 1], [D, 0], [0, 0]]),
      quad([[-h, -h, z0], [-h, -h, z1], [-h, h, z1], [-h, h, z0]], [-1, 0, 0], [[0, 1], [D, 1], [D, 0], [0, 0]]),
    ]);
    const front = quad([[-h, h, z1], [h, h, z1], [h, h, z0], [-h, h, z0]], [0, 1, 0], [[0, 0], [1, 0], [1, D], [0, D]]);
    const back = quad([[-h, -h, z0], [h, -h, z0], [h, -h, z1], [-h, -h, z1]], [0, -1, 0], [[0, 0], [1, 0], [1, D], [0, D]]);
    node.add(new Mesh(sides, M.pSide));
    node.add(new Mesh(back, M.pBottom));
    const face = node.add(new Mesh(front, M.pTop));
    // head: a plate (planks front and back, plank edges) and a rod per block of depth
    // head as in Minecraft: a plank plate (face texture front and back, a plank strip with iron ends on its edges) and a
    // wooden arm with iron bands behind it, one per block of depth
    const head = node.add(new Node('head'));
    const t4 = 0.25, plate = mergeGeometries([
      quad([[-h, h, z1], [h, h, z1], [h, h, z0], [-h, h, z0]], [0, 1, 0], [[0, 0], [1, 0], [1, D], [0, D]]),
      quad([[-h, h - t4, z0], [h, h - t4, z0], [h, h - t4, z1], [-h, h - t4, z1]], [0, -1, 0], [[0, 0], [1, 0], [1, D], [0, D]]),
    ]);
    const edges = mergeGeometries([
      quad([[-h, h - t4, z1], [h, h - t4, z1], [h, h, z1], [-h, h, z1]], [0, 0, 1], [[0, 1], [1, 1], [1, 0], [0, 0]]),
      quad([[h, h - t4, z0], [-h, h - t4, z0], [-h, h, z0], [h, h, z0]], [0, 0, -1], [[0, 1], [1, 1], [1, 0], [0, 0]]),
      quad([[h, h - t4, z1], [h, h - t4, z0], [h, h, z0], [h, h, z1]], [1, 0, 0], [[0, 1], [D, 1], [D, 0], [0, 0]]),
      quad([[-h, h - t4, z0], [-h, h - t4, z1], [-h, h, z1], [-h, h, z0]], [-1, 0, 0], [[0, 1], [D, 1], [D, 0], [0, 0]]),
    ]);
    head.add(new Mesh(plate, M.pTop));
    head.add(new Mesh(edges, M.pEdge));
    for (let k = 0; k < D; k++) head.add(new Mesh(geo!.arm, M.pArm)).setPosition(0, h - t4 - 0.5, z0 + k + 0.5);
    head.visible = false;
    const body = this._world.add(null, {
      type: 'static', shape: boxShape(0.5, 0.5, D / 2), position: [a[0] - fx * 0.5, a[1] - fy * 0.5, ZC], friction: 0.8,
    });
    body.data.ground = true;
    body.data.piston = true;
    this._bodies.push(body);
    return { a, body, node, face, head, state: 0, t: 0, e: 0 };
  }

  /** fire pistons the car touches with their face; run their out / hold / in / rest cycle */
  private _pistons(dt: number) {
    const car = this.car;
    for (const p of this.pistons) {
      p.t += dt;
      if (p.state === 0) {
        if (!car || !this.touch?.has(p.body)) continue;
        const [fx, fy] = PISTON_DIR[p.a[2] & 3] ?? PISTON_DIR[0], v = car.body.velocity, cy = car.body.position[1];
        if (fx) {
          // sideways: only a car driving into the face, standing at least at the block's level (a lift brings it up first)
          if (car.facing * fx >= 0 || car.bottomY < p.a[1] - 0.8) continue;
          car.flip();
          v[0] = fx * 3;
        } else if (fy > 0) {
          if (cy < p.a[1]) continue;
          // the plate pushes the car flat: up, without spinning it
          v[1] = Math.max(v[1], P_LAUNCH);
          car.body.angularVelocity[2] = 0;
        } else {
          if (cy > p.a[1]) continue;
          v[1] = Math.min(v[1], -P_PUSH_DOWN);
          car.body.angularVelocity[2] = 0;
        }
        p.state = 1;
        p.t = 0;
        this.onPiston?.(p.a);
      } else if (p.state === 1 && p.t > P_HOLD) { p.state = 2; p.t = 0; }
      else if (p.state === 2 && p.t > P_IN) { p.state = 3; p.t = 0; }
      else if (p.state === 3 && p.t > P_REST) p.state = 0;
      p.e = p.state === 1 ? Math.min(1, p.t / P_OUT) : p.state === 2 ? Math.max(0, 1 - p.t / P_IN) : 0;
    }
  }

  /** where in its cycle (there, pause, back, pause) a lift starts: phase 0..1 */
  private _start(l: Lift, phase: number) {
    const p = l.pause, t = l.time, c = 2 * (t + p), k = ((((phase % 1) + 1) % 1) * c);
    if (k < p) { l.s = 0; l.dir = 1; l.wait = p - k; }
    else if (k < p + t) { l.s = (k - p) / t; l.dir = 1; }
    else if (k < 2 * p + t) { l.s = 1; l.dir = -1; l.wait = 2 * p + t - k; }
    else { l.s = 1 - (k - 2 * p - t) / t; l.dir = -1; }
  }
  private _place(l: Lift, s: number, out: Float32Array | number[]) {
    const [x, y, , dx, dy] = l.a;
    out[0] = x + dx * s;
    out[1] = y + dy * s - LIFT_T / 2;
    out[2] = ZC;
  }

  private _step(dt: number) {
    this.t += dt;
    const target = [0, 0, 0];
    for (const l of this.lifts) {
      const b = l.body;
      // a platform always goes all the way: coming down on the car (it got under it) crushes it; only the nose under its
      // edge just gets pushed away
      const car = this.car, cp = car?.body.position;
      if (cp && b.velocity[1] < -0.01 && cp[1] < b.position[1] && Math.abs(cp[0] - b.position[0]) < l.a[2] / 2 && this.touch?.has(b)) this.onCrush?.();
      // there and back on its own, a short pause at each end
      if (l.wait > 0) l.wait = Math.max(0, l.wait - dt);
      else {
        l.s = clamp(l.s + (l.dir * dt) / l.time, 0, 1);
        if (l.s === 0 || l.s === 1) { l.dir = l.s ? -1 : 1; l.wait = l.pause; }
      }
      // the eased value drives the platform; velocity makes the solver and the wheels see it moving
      this._place(l, ease(l.s), target);
      for (let i = 0; i < 3; i++) b.velocity[i] = (target[i] - b.position[i]) / dt;
    }
    for (const s of this.spikes) s.h = this._spikeH(s.a, this.t);
    this._pistons(dt);
  }

  /** spikes height at time t: out for the second half of the period, a short twitch before */
  private _spikeH(a: number[], t: number) {
    const period = a[3];
    if (!period) return SPIKE_H;
    const k = (((t / period + (a[4] || 0)) % 1) + 1) % 1 * period, half = period / 2;
    if (k < half - WARN) return 0;
    if (k < half) return 0.06 + 0.04 * Math.sin(k * 60);
    if (k < half + OUT) return 0.1 + ((k - half) / OUT) * (SPIKE_H - 0.1);
    if (k < period - IN) return SPIKE_H;
    return SPIKE_H * ((period - k) / IN);
  }

  mud(x: number, y: number) { return onStrip(this.muds, x, y); }
  ice(x: number, y: number) { return onStrip(this.ices, x, y); }
  spike(x: number, y: number, r: number) {
    for (const s of this.spikes) {
      if (s.h < 0.2) continue;
      const [sx, sy, w] = s.a;
      if (Math.abs(x - sx) < w / 2 + r * 0.7 && y - r < sy + s.h && y + r > sy - 0.2) return true;
    }
    return false;
  }

  /** visuals (per frame) */
  update(dt: number) {
    for (const l of this.lifts) {
      const p = l.body.position;
      l.node.position.set([p[0], p[1] + LIFT_T / 2, 0]);
      l.glow.o.rate = l.wait ? 14 : 40;
    }
    for (const s of this.spikes) s.node.setScale(1, Math.max(0.01, s.h / SPIKE_H), 1);
    for (const p of this.pistons) {
      // head out by e blocks; while it's out the block's front shows the inner texture
      p.head.visible = p.e > 0.01;
      p.head.position[1] = p.e;
      p.face.material = p.head.visible ? mat!.pInner : mat!.pTop;
    }
    void dt;
  }

  destroy() {
    this._off();
    for (const b of this._bodies) this._world.remove(b);
    this.root.destroy();
  }
}
