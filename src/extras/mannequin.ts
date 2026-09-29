import { Node } from '../scene/node';
import { Mesh } from '../scene/mesh';
import { Model } from '../scene/model';
import { box, sphere } from '../geometry/primitives';
import { mergeGeometries, type Geometry } from '../geometry/geometry';
import { Material, type Lighting } from '../materials/material';
import { Skin } from '../anim/skin';
import { AnimationClip, Animator, type Track } from '../anim/animator';
import { color, m4, m4compose, qeuler, type ColorLike } from '../core/math';

export interface MannequinOptions {
  body?: ColorLike;
  skin?: ColorLike;
  legs?: ColorLike;
  shoes?: ColorLike;
  material?: Lighting;
  outline?: number;
}

type J = { name: string; parent: number; pos: [number, number, number] };
// Skeleton in bind pose (faces +Z, feet at y=0). pos is relative to parent.
const JOINTS: J[] = [
  { name: 'hips', parent: -1, pos: [0, 0.95, 0] },
  { name: 'spine', parent: 0, pos: [0, 0.15, 0] },
  { name: 'chest', parent: 1, pos: [0, 0.25, 0] },
  { name: 'head', parent: 2, pos: [0, 0.3, 0] },
  { name: 'upperArm.L', parent: 2, pos: [0.25, 0.2, 0] },
  { name: 'lowerArm.L', parent: 4, pos: [0, -0.3, 0] },
  { name: 'upperArm.R', parent: 2, pos: [-0.25, 0.2, 0] },
  { name: 'lowerArm.R', parent: 6, pos: [0, -0.3, 0] },
  { name: 'upperLeg.L', parent: 0, pos: [0.11, -0.05, 0] },
  { name: 'lowerLeg.L', parent: 8, pos: [0, -0.42, 0] },
  { name: 'upperLeg.R', parent: 0, pos: [-0.11, -0.05, 0] },
  { name: 'lowerLeg.R', parent: 10, pos: [0, -0.42, 0] },
];
const idx = (n: string) => JOINTS.findIndex((j) => j.name === n);

/**
 * Procedural low-poly humanoid with skeleton and built-in clips:
 * idle, walk, run, jump, fall, attack, wave. Height ~1.8m, faces +Z. Great for prototyping.
 */
export function createMannequin(o: MannequinOptions = {}): Model {
  // world bind positions
  const world: number[][] = [];
  JOINTS.forEach((j, i) => {
    const p = j.parent >= 0 ? world[j.parent] : [0, 0, 0];
    world[i] = [p[0] + j.pos[0], p[1] + j.pos[1], p[2] + j.pos[2]];
  });
  const cBody = color(o.body ?? 0x3d7bd9), cSkin = color(o.skin ?? 0xf2c29b), cLegs = color(o.legs ?? 0x2e3440), cShoe = color(o.shoes ?? 0x222222);
  const parts: Geometry[] = [];
  const part = (g: Geometry, joint: string, off: [number, number, number], c: Float32Array) => {
    const j = idx(joint), w = world[j];
    g.transform(m4compose(m4(), [w[0] + off[0], w[1] + off[1], w[2] + off[2]], [0, 0, 0, 1], [1, 1, 1]));
    const n = g.vertexCount;
    const jt = new Float32Array(n * 4), wt = new Float32Array(n * 4), col = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { jt[i * 4] = j; wt[i * 4] = 1; col.set(c, i * 4); }
    delete g.attributes.uv;
    g.setAttribute('joints', jt, 4).setAttribute('weights', wt, 4).setAttribute('color', col, 4);
    parts.push(g);
  };
  part(box(0.34, 0.2, 0.2), 'hips', [0, 0, 0], cLegs);
  part(box(0.36, 0.25, 0.2), 'spine', [0, 0.1, 0], cBody);
  part(box(0.44, 0.32, 0.24), 'chest', [0, 0.12, 0], cBody);
  part(sphere(0.15, 10, 8), 'head', [0, 0.14, 0], cSkin);
  for (const s of ['L', 'R']) {
    part(box(0.11, 0.3, 0.11), 'upperArm.' + s, [0, -0.14, 0], cBody);
    part(box(0.09, 0.26, 0.09), 'lowerArm.' + s, [0, -0.12, 0], cSkin);
    part(box(0.1, 0.1, 0.1), 'lowerArm.' + s, [0, -0.3, 0], cSkin);
    part(box(0.15, 0.42, 0.15), 'upperLeg.' + s, [0, -0.2, 0], cLegs);
    part(box(0.12, 0.42, 0.12), 'lowerLeg.' + s, [0, -0.2, 0], cLegs);
    part(box(0.13, 0.08, 0.26), 'lowerLeg.' + s, [0, -0.44, 0.05], cShoe);
  }
  const geo = mergeGeometries(parts);

  const model = new Model('mannequin');
  const nodes = JOINTS.map((j) => new Node(j.name).setPosition(...j.pos));
  JOINTS.forEach((j, i) => (j.parent >= 0 ? nodes[j.parent] : model).add(nodes[i]));
  const ibm = new Float32Array(JOINTS.length * 16);
  world.forEach((w, i) => ibm.set(m4compose(m4(), [-w[0], -w[1], -w[2]], [0, 0, 0, 1], [1, 1, 1]), i * 16));
  const mat = new Material({ type: o.material ?? 'toon', outline: o.outline ? { width: o.outline } : undefined, rim: 0xffffff, rimStrength: 0.25 });
  const mesh = new Mesh(geo, mat, 'body');
  mesh.skin = new Skin(nodes, ibm);
  mesh.frustumCulled = false;
  model.add(mesh);
  model.nodes = nodes;
  model.meshes = [mesh];
  model.animator = new Animator(model, mannequinClips(), nodes);
  model.addScript(model.animator);
  return model;
}

/** Build a looping clip by sampling a pose function. pose(phase 0..1) returns joint -> [rx, ry, rz] and optional hips y offset. */
function proc(name: string, dur: number, keys: number, pose: (p: number) => { r: Record<string, number[]>; y?: number; z?: number }, events: [number, string][] = []) {
  const times = new Float32Array(keys + 1);
  for (let k = 0; k <= keys; k++) times[k] = (k / keys) * dur;
  const rot = new Map<string, Float32Array>();
  const hipPos = new Float32Array((keys + 1) * 3);
  const q = new Float32Array(4);
  for (let k = 0; k <= keys; k++) {
    const p = pose(k / keys);
    for (const jn in p.r) {
      if (!rot.has(jn)) rot.set(jn, new Float32Array((keys + 1) * 4));
      const e = p.r[jn];
      rot.get(jn)!.set(qeuler(q, e[0], e[1] ?? 0, e[2] ?? 0), k * 4);
    }
    hipPos.set([0, 0.95 + (p.y ?? 0), p.z ?? 0], k * 3);
  }
  const tracks: Track[] = [...rot].map(([jn, v]) => ({ target: idx(jn), path: 'rotation', times, values: v }));
  tracks.push({ target: 0, path: 'position', times, values: hipPos });
  return new AnimationClip(name, tracks, events.map(([t, n]) => ({ time: t * dur, name: n })), dur);
}

export function mannequinClips(): AnimationClip[] {
  const TAU = Math.PI * 2, S = Math.sin, C = Math.cos;
  const ALL = ['spine', 'chest', 'head', 'upperArm.L', 'lowerArm.L', 'upperArm.R', 'lowerArm.R', 'upperLeg.L', 'lowerLeg.L', 'upperLeg.R', 'lowerLeg.R'];
  const base = () => Object.fromEntries(ALL.map((j) => [j, [0, 0, 0]])) as Record<string, number[]>;
  const gait = (legA: number, knee: number, armA: number, elbow: number, lean: number, bob: number) => (p: number) => {
    const a = p * TAU, r = base();
    r['upperLeg.L'] = [-legA * S(a)];
    r['upperLeg.R'] = [legA * S(a)];
    r['lowerLeg.L'] = [knee * Math.max(0, -C(a))];
    r['lowerLeg.R'] = [knee * Math.max(0, C(a))];
    r['upperArm.L'] = [armA * S(a), 0, 0.08];
    r['upperArm.R'] = [-armA * S(a), 0, -0.08];
    r['lowerArm.L'] = [-elbow];
    r['lowerArm.R'] = [-elbow];
    r.spine = [lean, 0.08 * S(a)];
    r.chest = [lean * 0.5, -0.12 * S(a)];
    r.head = [-lean];
    return { r, y: -bob * Math.abs(S(a)) };
  };
  return [
    proc('idle', 2.4, 12, (p) => {
      const a = p * TAU, r = base();
      r.chest = [0.03 * S(a)];
      r.head = [-0.03 * S(a), 0.05 * S(a / 2)];
      r['upperArm.L'] = [0.03 * S(a), 0, 0.1];
      r['upperArm.R'] = [0.03 * S(a), 0, -0.1];
      r['lowerArm.L'] = [-0.15];
      r['lowerArm.R'] = [-0.15];
      return { r, y: -0.01 * (1 - C(a)) };
    }),
    proc('walk', 1.0, 16, gait(0.5, 0.8, 0.4, 0.3, 0.05, 0.04), [[0.25, 'step'], [0.75, 'step']]),
    proc('run', 0.66, 16, gait(0.9, 1.5, 0.9, 1.4, 0.25, 0.08), [[0.25, 'step'], [0.75, 'step']]),
    proc('jump', 0.4, 4, () => {
      const r = base();
      r['upperLeg.L'] = [-0.9]; r['lowerLeg.L'] = [1.4];
      r['upperLeg.R'] = [-0.2]; r['lowerLeg.R'] = [0.5];
      r['upperArm.L'] = [-2.2, 0, 0.3]; r['upperArm.R'] = [-2.2, 0, -0.3];
      r.spine = [0.1];
      return { r, y: 0.05 };
    }),
    proc('fall', 0.8, 8, (p) => {
      const a = p * TAU, r = base();
      r['upperArm.L'] = [-0.4, 0, 1.3 + 0.2 * S(a)]; r['upperArm.R'] = [-0.4, 0, -1.3 - 0.2 * S(a)];
      r['upperLeg.L'] = [-0.4 + 0.2 * S(a)]; r['lowerLeg.L'] = [0.6];
      r['upperLeg.R'] = [-0.1 - 0.2 * S(a)]; r['lowerLeg.R'] = [0.4];
      return { r };
    }),
    proc('attack', 0.5, 10, (p) => {
      const r = base();
      const w = p < 0.3 ? p / 0.3 : 1 - (p - 0.3) / 0.7;
      const hit = p < 0.3 ? -1.2 * w : -1.2 + 2.6 * Math.min(1, (p - 0.3) / 0.25) * (1 - Math.max(0, (p - 0.55) / 0.45));
      r['upperArm.R'] = [p < 0.3 ? -2.6 * w : -2.6 * (1 - Math.min(1, (p - 0.3) / 0.25)), 0, -0.2];
      r['lowerArm.R'] = [Math.min(0, hit)];
      r.chest = [0.1 * w, -0.5 * (p < 0.3 ? w : 1 - Math.min(1, (p - 0.3) / 0.25) * 2 + 1) * 0.5];
      r['upperLeg.L'] = [-0.4]; r['lowerLeg.L'] = [0.4];
      r['upperLeg.R'] = [0.3]; r['lowerLeg.R'] = [0.2];
      return { r, y: -0.05 };
    }, [[0.4, 'hit']]),
    proc('wave', 1.2, 12, (p) => {
      const a = p * TAU, r = base();
      r['upperArm.R'] = [0, 0, -2.6];
      r['lowerArm.R'] = [0, 0, -0.5 + 0.5 * S(a * 2)];
      r['upperArm.L'] = [0, 0, 0.1];
      r.head = [0, -0.2];
      return { r };
    }),
  ];
}
