// Part models as data (games/noobRideMaster/parts.json, edited in editor.html): a list of simple shapes per part kind.
// The game and the editor build parts with the same buildPart(), so the editor shows exactly what the game renders.
import { Node, Mesh, Geometry, box, cylinder, cone, sphere, lambert, qeuler, type Material } from 'aiwebengine';
import { pixelTex, pickC } from './track';
import { BLOCK, WHEEL, FAN, SEAT, kindOf, lvlOf, isItem, wheelRadius, attachDir, setPartStats, TIERS, type Attach, type PartStats } from './parts';

export type ShapeType = 'box' | 'cylinder' | 'cone' | 'sphere';
export type TexName = 'none' | 'plank' | 'wool' | 'stone';
/** body = fixed; spin = rotates around its axis (wheel tires, fan blades); arrow = turned to the fan's thrust direction */
export type Group = 'body' | 'spin' | 'arrow';
export type Axis = 'x' | 'y' | 'z';

export interface Shape {
  name?: string;
  type: ShapeType;
  /** box: width, height, depth; cylinder/cone: radius, height, segments; sphere: radius, -, segments */
  size: [number, number, number];
  pos: [number, number, number];
  /** degrees (Euler, applied Y, X, Z) */
  rot: [number, number, number];
  /** '#rrggbb' or 'tier' (color of the part's level) */
  color: string;
  tex?: TexName;
  /** texture tiling: one texture repeat per this many meters on every face (not stretched); 0 / none = stretched once */
  tile?: number;
  group?: Group;
  /** copy mirrored to the other side (z -> -z) */
  mirrorZ?: boolean;
  /** copies spread around the shape's axis (fan blades) */
  radial?: number;
  /** axis of rotation ('spin' group) and of the radial copies (default 'z') */
  axis?: Axis;
  /** point the axis goes through, in part space (default 0,0,0; mirrored with the shape) */
  pivot?: [number, number, number];
  /** faceted low-poly shading */
  flat?: boolean;
  /** self-illumination 0..2 */
  glow?: number;
}
export interface PartModel {
  /** the level-1 model (and of any level without its own model) */
  shapes: Shape[];
  /** own models of higher levels ("2".."10"); a level without one uses the closest lower level's model */
  levels?: Record<string, Shape[]>;
  /** colors of levels 1..10 (wheels and fans) */
  tiers?: string[];
  /** physics: strength (impact m/s that knocks the part off) and mass (kg); one value, or one per level 1..10 */
  stats?: PartStats;
  /** seat only: where the noob sits, relative to the seat cell center (m), and its rotation (degrees) */
  noob?: { pos: number[]; rot: number[] };
}

/** Level whose model is used for `lvl` (1 = the base `shapes`). */
export function modelLevel(m: PartModel, lvl: number) {
  for (let l = lvl; l > 1; l--) if (m.levels?.[l]) return l;
  return 1;
}
/** Shapes drawn for a level. */
export function shapesFor(m: PartModel, lvl: number): Shape[] {
  const l = modelLevel(m, lvl);
  return l > 1 ? m.levels![l] : m.shapes;
}
export type ModelKey = 'block' | 'seat' | 'wheel' | 'fan';
export type Models = Record<ModelKey, PartModel>;

export const KEY_OF: Record<number, ModelKey> = { [BLOCK]: 'block', [SEAT]: 'seat', [WHEEL]: 'wheel', [FAN]: 'fan' };

let models: Models | null = null;
const listeners: (() => void)[] = [];
export function setModels(m: Models) {
  models = m;
  setPartStats({ [BLOCK]: m.block.stats ?? {}, [SEAT]: m.seat.stats ?? {}, [WHEEL]: m.wheel.stats ?? {}, [FAN]: m.fan.stats ?? {} });
  matCache.clear();
  icons.clear();
  for (const f of listeners) f();
}
/** default noob pose on the seat: a bit behind the cell center, facing +X (the way the car drives) */
export const NOOB_POSE = { pos: [-0.02, -0.1, 0], rot: [0, 90, 0] };
/** the noob's pose on the seat from parts.json (or the default) */
export function noobPose(): { pos: number[]; rot: number[] } {
  const p = models?.seat.noob;
  return { pos: p?.pos ?? NOOB_POSE.pos, rot: p?.rot ?? NOOB_POSE.rot };
}
export function getModels(): Models {
  if (!models) throw new Error('setModels() first');
  return models;
}
export function onModelsChange(f: () => void) { listeners.push(f); }

const hexNum = (s: string) => parseInt(s.replace('#', ''), 16) || 0;
const hexStr = (n: number) => '#' + n.toString(16).padStart(6, '0');

/** Color of a level for a part kind (from the model's tiers, default: Minecraft materials). */
export function tierHex(key: ModelKey, lvl: number): string {
  return getModels()[key].tiers?.[lvl - 1] ?? hexStr(TIERS[lvl - 1][0]);
}

// ---------------------------------------------------------------- building

let texs: Record<string, any> | null = null;
function textures() {
  texs ??= {
    plank: pixelTex(16, 16, (x, y, r) => {
      if (y % 4 === 3) return 0x6e5230;
      if ((x + (Math.floor(y / 4) % 2) * 8) % 16 === 0) return 0x7d5e36;
      return pickC([0xb8945f, 0xa9854f, 0xc29d66, 0x9f7d4a], r);
    }),
    wool: pixelTex(16, 16, (_x, _y, r) => pickC([0xffffff, 0xeeeeee, 0xf6f6f6], r)),
    stone: pixelTex(16, 16, (x, y, r) => ((x % 8 === 0 || y % 5 === 0) && r < 0.8 ? 0x5a5a5a : pickC([0x8a8a8a, 0x7b7b7b, 0x999999, 0x6f6f6f], r))),
  };
  return texs;
}

const matCache = new Map<string, Material>();
function material(color: string, tex: TexName, glow: number) {
  const key = `${color}|${tex}|${glow}`;
  let m = matCache.get(key);
  if (!m) {
    const c = hexNum(color);
    // textured parts are tinted by their color (white = original texture colors)
    m = lambert(c, { map: tex !== 'none' ? textures()[tex] : null, ...(glow ? { emissive: c, emissiveIntensity: glow } : {}) });
    matCache.set(key, m);
  }
  return m;
}

const geoCache = new Map<string, Geometry>();
const DEG = Math.PI / 180;
function geometry(s: Shape) {
  const [a, b, c] = s.size;
  const tile = s.tile && s.tile > 0 ? s.tile : 0;
  const key = `${s.type}|${a}|${b}|${c}|${!!s.flat}|${tile}`;
  let g = geoCache.get(key);
  if (!g) {
    const seg = Math.max(3, Math.round(c) || 12);
    g = s.type === 'box' ? box(a, b, c)
      : s.type === 'cylinder' ? cylinder(a, a, b, seg)
      : s.type === 'cone' ? cone(a, b, seg)
      : sphere(a, seg, Math.max(3, Math.round(seg * 0.66)));
    if (s.flat && s.type !== 'box') g.flatShade();
    if (tile) tileUV(g, s, tile);
    geoCache.set(key, g);
  }
  return g;
}

/**
 * Repeat the texture every `tile` meters instead of stretching it: a box gets its uvs projected per face (from the face's
 * corner, so the tiles line up with the edges); round shapes scale theirs by circumference and height.
 */
function tileUV(g: Geometry, s: Shape, tile: number) {
  const uv = g.attributes.uv?.data as Float32Array | undefined;
  if (!uv) return;
  const [a, b, c] = s.size;
  if (s.type === 'box') {
    const p = g.attributes.position.data, n = g.attributes.normal.data;
    for (let i = 0; i < p.length / 3; i++) {
      const ax = Math.abs(n[i * 3]), ay = Math.abs(n[i * 3 + 1]);
      uv[i * 2] = (ax > 0.5 ? p[i * 3 + 2] + c / 2 : p[i * 3] + a / 2) / tile;
      uv[i * 2 + 1] = (ay > 0.5 ? p[i * 3 + 2] + c / 2 : b / 2 - p[i * 3 + 1]) / tile;
    }
  } else {
    const su = (2 * Math.PI * a) / tile, sv = (s.type === 'sphere' ? Math.PI * a : b) / tile;
    for (let i = 0; i < uv.length; i += 2) { uv[i] *= su; uv[i + 1] *= sv; }
  }
  g.setAttribute('uv', uv, 2);
}

/** a node that spins around one of its local axes */
export interface Spinner { node: Node; axis: Axis }
/** Set a spinner's rotation angle (radians) around its axis. */
export function spinTo(s: Spinner, angle: number) {
  qeuler(s.node.rotation, s.axis === 'x' ? angle : 0, s.axis === 'y' ? angle : 0, s.axis === 'z' ? angle : 0);
}

export interface BuiltPart {
  node: Node;
  /** spinning groups, one per axis/pivot (empty if the model has no spinning shapes) */
  spins: Spinner[];
  /** meshes per shape index (editor highlight) */
  meshes: Mesh[][];
}

/**
 * Build a part node from its model. `v` = cell value (kind + level).
 * Fans: the model is drawn attached on its left (frame at -X) and is turned to the real side `attach`;
 * 'arrow' shapes are drawn for thrust up and turned to the thrust direction (only when `arrows`, i.e. in the garage).
 * Wheels scale their spinning shapes with the physics radius of the level, fans grow their blades a little per level
 * (scaled across the spin axis, around the pivot).
 */
export function buildPart(v: number, attach: Attach = 'left', model?: PartModel, arrows = true): BuiltPart {
  const k = kindOf(v), l = lvlOf(v), key = KEY_OF[k];
  model ??= getModels()[key];
  const root = new Node(key);
  // everything except the arrow turns with the attachment side
  const node = root.add(new Node('orient'));
  if (k === FAN) {
    if (attach === 'right') node.setRotation(0, Math.PI, 0);
    else if (attach === 'top') node.setRotation(0, 0, -Math.PI / 2);
    else if (attach === 'bottom') node.setRotation(0, 0, Math.PI / 2);
  }
  const arrow = root.add(new Node('arrow'));
  arrow.visible = arrows;
  if (k === FAN && attachDir(attach) === 'fwd') arrow.setRotation(0, 0, -Math.PI / 2);
  const grow = k === WHEEL ? wheelRadius(l) / wheelRadius(1) : k === FAN ? 1 + (l - 1) * 0.035 : 1;
  const spinners = new Map<string, Spinner>();
  const meshes: Mesh[][] = [];
  shapesFor(model, isItem(v) ? l : 1).forEach((s, si) => {
    const list: Mesh[] = (meshes[si] = []);
    const color = s.color === 'tier' ? (isItem(v) ? model!.tiers?.[l - 1] ?? tierHex(key, l) : '#ffffff') : s.color;
    const mat = material(color, s.tex ?? 'none', s.glow ?? 0), geo = geometry(s);
    const group = s.group ?? 'body', axis = s.axis ?? 'z', pv = s.pivot ?? [0, 0, 0];
    const n = Math.max(1, Math.round(s.radial ?? 1));
    for (const z of s.mirrorZ ? [1, -1] : [1]) {
      // node sitting on the axis: shared by all spinning shapes with the same axis and pivot
      let axisNode: Node;
      if (group === 'spin') {
        const id = `${axis}|${pv[0]}|${pv[1]}|${pv[2] * z}`;
        let sp = spinners.get(id);
        if (!sp) {
          sp = { node: node.add(new Node('spin')), axis };
          sp.node.setPosition(pv[0], pv[1], pv[2] * z);
          sp.node.setScale(axis === 'x' ? 1 : grow, axis === 'y' ? 1 : grow, axis === 'z' ? 1 : grow);
          spinners.set(id, sp);
        }
        axisNode = sp.node;
      } else {
        axisNode = (group === 'arrow' ? arrow : node).add(new Node());
        axisNode.setPosition(pv[0], pv[1], pv[2] * z);
      }
      for (let i = 0; i < n; i++) {
        const holder = axisNode.add(new Node());
        if (n > 1) spinTo({ node: holder, axis }, (i * Math.PI * 2) / n);
        const m = holder.add(new Mesh(geo, mat));
        m.setPosition(s.pos[0] - pv[0], s.pos[1] - pv[1], (s.pos[2] - pv[2]) * z).setRotation(s.rot[0] * DEG, s.rot[1] * DEG * z, s.rot[2] * DEG);
        list.push(m);
      }
    }
  });
  return { node: root, spins: [...spinners.values()], meshes };
}

// ---------------------------------------------------------------- icons (2D canvas, cached data URLs)

const icons = new Map<number, string>();

/** Square icon for the inventory / drag ghost (colors follow the model's level colors). */
export function iconURL(v: number): string {
  let url = icons.get(v);
  if (url) return url;
  const S = 64, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d')!, k = kindOf(v), l = lvlOf(v);
  const tc = isItem(v) ? tierHex(KEY_OF[k], l) : '#ffffff';
  const plank = (x: number, y: number, w: number, h: number) => {
    g.fillStyle = '#b8945f'; g.fillRect(x, y, w, h);
    g.fillStyle = '#6e5230';
    for (let yy = y + h / 4; yy < y + h; yy += h / 4) g.fillRect(x, yy - 1, w, 2);
    g.strokeStyle = '#5a4226'; g.lineWidth = 3; g.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
  };
  if (k === BLOCK) plank(8, 8, 48, 48);
  else if (k === SEAT) { plank(10, 34, 44, 20); g.fillStyle = '#c0302a'; g.fillRect(10, 28, 44, 8); g.fillRect(10, 8, 9, 26); }
  else if (k === WHEEL) {
    const r = 17 + l * 1.4;
    g.fillStyle = '#262626'; g.beginPath(); g.arc(32, 32, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = tc; g.beginPath(); g.arc(32, 32, r * 0.55, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(29, 32 - r * 0.5, 6, r);
  } else if (k === FAN) {
    g.fillStyle = '#6e5230'; g.fillRect(8, 8, 48, 48);
    g.fillStyle = '#2a2a2a'; g.fillRect(12, 12, 40, 40);
    g.fillStyle = tc;
    for (let a = 0; a < 4; a++) {
      g.save(); g.translate(32, 32); g.rotate(a * Math.PI / 2 + 0.4);
      g.beginPath(); g.ellipse(0, -10, 6, 12, 0, 0, Math.PI * 2); g.fill();
      g.restore();
    }
    g.fillStyle = '#ddd'; g.beginPath(); g.arc(32, 32, 4, 0, Math.PI * 2); g.fill();
  }
  if (isItem(v)) {
    g.fillStyle = 'rgba(0,0,0,.75)'; g.beginPath(); g.arc(50, 50, 12, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.font = 'bold 16px system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(l), 50, 51);
  }
  url = cv.toDataURL();
  icons.set(v, url);
  return url;
}
