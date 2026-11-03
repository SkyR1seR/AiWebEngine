// 3D level view (owner: world): track blocks, decorations, obstacles, pickups, holes/bridges, finish, bonus walls.
//
// Rendering budget: all static blocks of a level go through one atlas Mesher (every block texture in one 128x80 atlas +
// vertex tint), cut into CHUNK-long pieces along the track: per chunk one floor mesh, one prop mesh (casts shadows only
// near the camera), one unlit "glow" mesh (windows, lamps) and two blinking garland meshes, plus a repeating-texture
// mesh for the big outer ground / hills. Chunks out of the [camera - BEHIND, camera + AHEAD] window are hidden (the
// renderer's shadow pass doesn't cull). Obstacles are small meshes (one draw each + a sign); coins are one instanced
// draw. Nothing is allocated per frame in update().
import {
  DirectionalLight, Geometry, Instances, Material, Mesh, Node, PointLight, Texture, color, m4, m4compose, qeuler, quad,
  quat, softDot, v3, type Game,
} from 'aiwebengine';
import { PostFX } from 'aiwebengine/fx';
import type { LevelData, Obstacle, Pickup } from './types';
import { SURF, TRACK_W } from './types';
import type { RaceSim } from './sim';
import { TEX_IDS, signTexture, texCanvas, type TexId } from './textures';
import { blockGeometry, blockMaterial, crossSprite, type Block } from './blocks';
import { BONUS_MULTS, HAMMER_PIVOT } from './config';
import { rng } from './util';
import { tr } from './i18n';
import { Snowfall, clearBursts, pixelBurst } from './fx';

// ================================================================ environment

export interface Env {
  sun: DirectionalLight;
  /** 0 day, 1 sunset, 2 night, 3 snowstorm, 4 = lobby look */
  setTheme(theme: number): void;
  /** center of the shadow map (RaceCamera with `env` set calls it every frame, Lobby on enter) */
  focus(x: number, y: number, z: number): void;
  /** shadow map follows the camera position again (default; Lobby.leave calls it) */
  followCamera(): void;
  /** current theme */
  theme: number;
  /** touch device: smaller shadow map, no bloom */
  phone: boolean;
  /** falling snow around the camera (density set by the theme; follows the camera by itself) */
  snow: Snowfall;
}

interface Look {
  /** sky top, horizon, bottom, sun glow */
  sky: [number, number, number, number];
  sun: number; sunI: number; dir: [number, number, number];
  amb: [number, number, number];
  fog: [number, number, number];
  snow: number; wind: number;
  /** brightness of garlands/windows (x2.2 when bloom is on) */
  glow: number;
  bloom: boolean;
}
// light travels along `dir`; all suns come from behind the camera (the race looks along -Z) so racers' backs are lit
const LOOKS: Look[] = [
  // 0 sunny winter day
  { sky: [0x3f86e0, 0xd8ecff, 0xeef4fb, 0.35], sun: 0xfff3e0, sunI: 1.3, dir: [-0.45, -1, -0.55], amb: [0xd8e8ff, 0xa9b6c8, 0.62], fog: [0xd8ecff, 32, 110], snow: 0.25, wind: 0.3, glow: 1, bloom: false },
  // 1 pink-orange sunset
  { sky: [0x3b3f8f, 0xffa27c, 0xf6c4b8, 0.5], sun: 0xffad72, sunI: 1.15, dir: [-0.9, -0.5, -0.55], amb: [0xf2c4dc, 0x7e6a8c, 0.62], fog: [0xf6ad94, 30, 105], snow: 0.15, wind: 0.2, glow: 1.1, bloom: false },
  // 2 night: dark blue sky, garlands and lamps glow (bloom on non-phones)
  { sky: [0x040a22, 0x1d3168, 0x0b1430, 0.12], sun: 0x9db5ff, sunI: 0.5, dir: [0.35, -1, -0.55], amb: [0x5068b4, 0x1c2238, 0.62], fog: [0x15224d, 26, 92], snow: 0.45, wind: 0.2, glow: 1.15, bloom: true },
  // 3 snowstorm: gray-white, dense fog, blizzard
  { sky: [0x97a5b8, 0xd5dce5, 0xe3e8ee, 0.1], sun: 0xeef3ff, sunI: 0.75, dir: [-0.3, -1, -0.45], amb: [0xe0e7f0, 0xaab3c0, 0.8], fog: [0xd2d9e2, 8, 64], snow: 2.6, wind: 2.6, glow: 1.1, bloom: false },
  // 4 lobby: cozy evening
  { sky: [0x1a2350, 0x8c6aa6, 0x3a3560, 0.3], sun: 0xffc890, sunI: 0.8, dir: [-0.6, -0.8, -0.6], amb: [0x8c92d4, 0x3a3048, 0.66], fog: [0x5d5088, 30, 95], snow: 0.6, wind: 0.2, glow: 1.15, bloom: true },
];

let glowK = 1;
/** how far ahead chunks are drawn (fog far + margin) */
let viewFar = 120;
/** brightness of glowing decorations for the current theme (used by WorldView / Lobby blinking) */
export function glowLevel(): number { return glowK; }

/** sky, fog, lights, post (once at startup) */
export function setupEnv(game: Game): Env {
  const phone = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  const scene = game.scene;
  const sun = scene.add(new DirectionalLight({ direction: [-0.45, -1, -0.55], intensity: 1.3, shadow: { size: phone ? 1024 : 2048, extent: 28 } }));
  const fp = [0, 0, 0];
  const snow = new Snowfall(game, 0);
  let post: PostFX | null = null;
  const env: Env = {
    sun, snow, phone, theme: -1,
    setTheme(t: number) {
      t = Math.max(0, Math.min(LOOKS.length - 1, Math.floor(t) || 0));
      if (t === env.theme) return;
      env.theme = t;
      const k = LOOKS[t];
      scene.setSky({ top: k.sky[0], horizon: k.sky[1], bottom: k.sky[2], sun: k.sky[3], sunSharpness: 60 });
      scene.setFog(k.fog[0], k.fog[1], k.fog[2]);
      scene.setAmbient(k.amb[0], k.amb[1], k.amb[2]);
      color(k.sun, 1, sun.color);
      sun.intensity = k.sunI;
      sun.setDirection(k.dir[0], k.dir[1], k.dir[2]);
      snow.setDensity(k.snow);
      snow.setWind(k.wind);
      const bloom = k.bloom && !phone;
      if (bloom) {
        // tonemap 'none' keeps the colors of the no-post path; only HDR (> 1) pixels bloom
        post ??= new PostFX({ bloom: { threshold: 1, intensity: 0.65, levels: 5 }, tonemap: 'none', vignette: 0.15, fxaa: false });
        game.renderer.post = post;
        post.enabled = true;
      } else if (post) post.enabled = false;
      glowK = bloom ? k.glow * 2.2 : k.glow;
      viewFar = k.fog[2] + 10;
    },
    focus(x, y, z) { fp[0] = x; fp[1] = y; fp[2] = z; sun.shadowFocus = fp; },
    followCamera() { sun.shadowFocus = null; },
  };
  env.setTheme(0);
  return env;
}

// ================================================================ atlas mesher

/** one texture for all faces, or [top, side, bottom] */
export type Faces = TexId | readonly [TexId, TexId, TexId];
/** mesh layers of the Mesher: floor (no shadow casting), props, unlit glow, blinking garland groups A / B */
export const L_FLOOR = 0, L_PROP = 1, L_GLOW = 2, L_BLINK_A = 3, L_BLINK_B = 4;

/** 16 px tiles in 32 px cells: an 8 px wrap-around gutter on every side stops anisotropic / mip sampling from bleeding
 * into the neighbor tile, and keeps every mip level aligned (cells stay separate down to 1 px) */
const TILE = 16, CELL = 32, GUT = 8, COLS = 8, EPS = 0.02;
let atlasTex: Texture | null = null;
let atlasW = 1, atlasH = 1;
const tileIndex = /* @__PURE__ */ new Map<TexId, number>();

/** atlas cell of every texture (pure: the Mesher needs only this) */
function atlasLayout() {
  if (tileIndex.size) return;
  atlasW = COLS * CELL;
  atlasH = Math.ceil(TEX_IDS.length / COLS) * CELL;
  TEX_IDS.forEach((id, i) => tileIndex.set(id, i));
}

/** atlas uv rect [u0, v0, u1, v1] of a texture's 16 px tile (tests / custom geometry) */
export function tileUV(id: TexId): [number, number, number, number] {
  atlasLayout();
  const i = tileIndex.get(id) ?? 0, x = (i % COLS) * CELL + GUT, y = Math.floor(i / COLS) * CELL + GUT;
  return [x / atlasW, y / atlasH, (x + TILE) / atlasW, (y + TILE) / atlasH];
}

/** every block texture in one atlas (one material for all static and voxel meshes) */
export function atlasTexture(): Texture {
  if (atlasTex) return atlasTex;
  atlasLayout();
  const c = document.createElement('canvas');
  c.width = atlasW;
  c.height = atlasH;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  TEX_IDS.forEach((id, i) => {
    const cx = (i % COLS) * CELL, cy = Math.floor(i / COLS) * CELL, src = texCanvas(id);
    g.save();
    g.beginPath();
    g.rect(cx, cy, CELL, CELL);
    g.clip();
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) g.drawImage(src, cx + GUT + a * TILE, cy + GUT + b * TILE, TILE, TILE);
    g.restore();
  });
  return (atlasTex = Texture.fromCanvas(c, { filter: 'nearest', wrap: 'clamp', mips: true }));
}

interface AtlasMats { lit: Material; glow: Material; a: Material; b: Material }
let mats: AtlasMats | null = null;
/** shared atlas materials: lit (lambert), unlit glow, and the two blinking garland groups */
export function atlasMaterials(): AtlasMats {
  if (!mats) {
    const map = atlasTexture();
    mats = {
      lit: new Material({ type: 'lambert', map }),
      glow: new Material({ type: 'unlit', map }),
      a: new Material({ type: 'unlit', map }),
      b: new Material({ type: 'unlit', map }),
    };
  }
  return mats;
}
const setRGB = (m: Material, v: number) => { m.uniforms[0] = m.uniforms[1] = m.uniforms[2] = v; };
/** animate the garland groups (call once per frame with any clock; idempotent for the same t) */
export function blinkLights(t: number, k = glowK): void {
  const m = atlasMaterials(), s = 0.5 + 0.5 * Math.sin(t * 2.7), q = s * s * (3 - 2 * s);
  setRGB(m.a, k * (0.3 + 0.7 * q));
  setRGB(m.b, k * (1 - 0.7 * q));
  setRGB(m.glow, k);
}

/** face directions (same conventions as blocks.ts): normal N, texture u (right), v (down) */
const DIRS = [
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, -1, 0] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, -1, 0] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, -1, 0] },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, -1, 0] },
];
const SEE = /* @__PURE__ */ new Set<TexId>(['glass', 'fire']);
const faceTex = (t: Faces, d: number): TexId => (typeof t === 'string' ? t : t[d === 0 ? 0 : d === 1 ? 2 : 1]);
const key3 = (x: number, y: number, z: number) =>
  Math.round(x * 2) + 4096 + (Math.round(y * 2) + 256) * 8192 + (Math.round(z * 2) + 4096) * 8192 * 512;

/** growable typed buffer */
class Buf<T extends Float32Array | Uint8Array> {
  n = 0;
  constructor(public d: T) {}
  room(k: number) {
    if (this.n + k <= this.d.length) return;
    const a = new (this.d.constructor as { new (n: number): T })(Math.max(this.d.length * 2, this.n + k));
    a.set(this.d);
    this.d = a;
  }
  cut(): T { return this.d.slice(0, this.n) as T; }
}
class Group {
  p = new Buf(new Float32Array(1536)); nr = new Buf(new Float32Array(1536)); uv = new Buf(new Float32Array(1024));
  /** vertex colors as unorm8 RGBA (4 bytes instead of 16) */
  c = new Buf(new Uint8Array(2048));
  idx: number[] = [];
  nv = 0;
  constructor(public layer: number, public chunk: number) {}
  geometry(): Geometry {
    return new Geometry().setAttribute('position', this.p.cut(), 3).setAttribute('normal', this.nr.cut(), 3)
      .setAttribute('uv', this.uv.cut(), 2).setAttribute('color', this.c.cut(), 4)
      .setIndex(this.nv > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx));
  }
}

/**
 * Accumulates textured boxes (atlas tiles × vertex tint) and builds one geometry per (chunk, layer).
 * Unit blocks (1x1x1, not rotated) hide each other's touching faces. Faces bigger than 1 m are split per meter so the
 * texture repeats like on real blocks; faces smaller than 1 m show the middle part of the tile (`fit` stretches the
 * whole tile over each face instead: gift boxes). Build voxel models at integer scale and scale the geometry.
 */
export class Mesher {
  private _f: number[] = [];
  private _t: Faces[] = [];
  private _solid = new Map<number, number>();
  /** chunk length along Z (0 = everything in chunk 0) */
  constructor(public chunk = 0) {}

  get count(): number { return this._t.length; }

  /** box centered at (x,y,z), size sx*sy*sz, optional tint (sRGB hex, x`glow` brightness), rotation about Y */
  add(layer: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, t: Faces, tint = 0xffffff, ry = 0, fit = false): this {
    this._f.push(layer, x, y, z, sx, sy, sz, tint, ry, fit ? 1 : 0);
    this._t.push(t);
    if (sx === 1 && sy === 1 && sz === 1 && ry === 0 && !fit) this._solid.set(key3(x, y, z), SEE.has(faceTex(t, 2)) ? 2 : 1);
    return this;
  }
  /** unit block */
  unit(layer: number, x: number, y: number, z: number, t: Faces, tint = 0xffffff): this {
    return this._solid.has(key3(x, y, z)) ? this : this.add(layer, x, y, z, 1, 1, 1, t, tint);
  }
  /** is there a unit block at this cell */
  has(x: number, y: number, z: number): boolean { return this._solid.has(key3(x, y, z)); }

  build(): { layer: number; chunk: number; geo: Geometry }[] {
    atlasLayout();
    const groups = new Map<number, Group>(), col = new Float32Array(4), F = this._f;
    const pos = [0, 0, 0], nrm = [0, 0, 0];
    for (let i = 0, j = 0; i < this._t.length; i++, j += 10) {
      const layer = F[j], x = F[j + 1], y = F[j + 2], z = F[j + 3], sx = F[j + 4], sy = F[j + 5], sz = F[j + 6];
      const ry = F[j + 8], fit = F[j + 9] === 1, t = this._t[i];
      const unit = sx === 1 && sy === 1 && sz === 1 && ry === 0 && !fit;
      const see = SEE.has(faceTex(t, 2));
      const ch = this.chunk ? Math.floor(z / this.chunk) : 0;
      const gk = (ch + 100000) * 8 + layer;
      let g = groups.get(gk);
      if (!g) groups.set(gk, (g = new Group(layer, ch)));
      color(F[j + 7], 1, col);
      const c0 = Math.round(col[0] * 255), c1 = Math.round(col[1] * 255), c2 = Math.round(col[2] * 255);
      const cs = Math.cos(ry), sn = Math.sin(ry);
      // faces looking down from ground level or below are never seen (the outer ground / water hide them)
      const ground = y - sy / 2 <= 0.01;
      for (let d = 0; d < 6; d++) {
        const { n, u, v } = DIRS[d];
        if (d === 1 && ground) continue;
        if (unit) {
          const nb = this._solid.get(key3(x + n[0], y + n[1], z + n[2]));
          if (nb === 1 || (nb === 2 && see)) continue;
        }
        const tile = tileIndex.get(faceTex(t, d)) ?? 0;
        const tx = (tile % COLS) * CELL + GUT, ty = Math.floor(tile / COLS) * CELL + GUT;
        const su = Math.abs(u[0] * sx + u[1] * sy + u[2] * sz), sv = Math.abs(v[0] * sx + v[1] * sy + v[2] * sz);
        const h = Math.abs(n[0] * sx + n[1] * sy + n[2] * sz) / 2;
        const nu = fit ? 1 : Math.max(1, Math.ceil(su - 1e-3)), nv = fit ? 1 : Math.max(1, Math.ceil(sv - 1e-3));
        // rotated normal
        nrm[0] = n[0] * cs + n[2] * sn; nrm[1] = n[1]; nrm[2] = -n[0] * sn + n[2] * cs;
        for (let a = 0; a < nu; a++) for (let e = 0; e < nv; e++) {
          const a0 = fit ? 0 : a, a1 = fit ? su : Math.min(su, a + 1), e0 = fit ? 0 : e, e1 = fit ? sv : Math.min(sv, e + 1);
          // texture window inside the tile: whole tile (fit), from the tile corner, or centered for sub-meter faces
          const uo = fit ? 0 : su < 1 ? (1 - su) / 2 : 0, vo = fit ? 0 : sv < 1 ? (1 - sv) / 2 : 0;
          const ua = fit ? 0 : uo, ub = fit ? 1 : uo + (a1 - a0), va = fit ? 0 : vo, vb = fit ? 1 : vo + (e1 - e0);
          const base = g.nv;
          g.p.room(12); g.nr.room(12); g.uv.room(8); g.c.room(16);
          for (let k = 0; k < 4; k++) {
            const s = k === 2 || k === 3 ? 1 : 0, q = k === 1 || k === 2 ? 1 : 0; // TL, BL, BR, TR
            const fa = (s ? a1 : a0) - su / 2, fe = (q ? e1 : e0) - sv / 2;
            // local offset from the box center
            const ox = n[0] * h + u[0] * fa + v[0] * fe, oy = n[1] * h + u[1] * fa + v[1] * fe, oz = n[2] * h + u[2] * fa + v[2] * fe;
            pos[0] = x + ox * cs + oz * sn; pos[1] = y + oy; pos[2] = z - ox * sn + oz * cs;
            const P = g.p, N = g.nr, U = g.uv, C = g.c;
            P.d[P.n++] = pos[0]; P.d[P.n++] = pos[1]; P.d[P.n++] = pos[2];
            N.d[N.n++] = nrm[0]; N.d[N.n++] = nrm[1]; N.d[N.n++] = nrm[2];
            const fu = s ? ub : ua, fv = q ? vb : va;
            U.d[U.n++] = (tx + EPS + fu * (TILE - 2 * EPS)) / atlasW;
            U.d[U.n++] = (ty + EPS + fv * (TILE - 2 * EPS)) / atlasH;
            C.d[C.n++] = c0; C.d[C.n++] = c1; C.d[C.n++] = c2; C.d[C.n++] = 255;
          }
          g.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
          g.nv += 4;
        }
      }
    }
    return [...groups.values()].map((g) => ({ layer: g.layer, chunk: g.chunk, geo: g.geometry() }));
  }

  /** everything as one geometry per layer (chunk 0); `scale` scales positions around the origin */
  geometries(scale = 1): Geometry[] {
    const out: Geometry[] = [];
    for (const { layer, geo } of this.build()) {
      if (scale !== 1) geo.transform(m4compose(m4(), [0, 0, 0], quat(), [scale, scale, scale]));
      out[layer] = geo;
    }
    return out;
  }
}

/** material of a mesher layer */
export function layerMaterial(layer: number): Material {
  const m = atlasMaterials();
  return layer === L_GLOW ? m.glow : layer === L_BLINK_A ? m.a : layer === L_BLINK_B ? m.b : m.lit;
}

/** meshes for all layers of a mesher geometry list (props cast shadows) */
export function layerMeshes(parent: Node, geos: Geometry[], cast = true): Mesh[] {
  const out: Mesh[] = [];
  geos.forEach((g, layer) => {
    if (!g) return;
    const m = parent.add(new Mesh(g, layerMaterial(layer)));
    m.castShadow = cast && layer === L_PROP;
    m.receiveShadow = layer <= L_PROP;
    out.push(m);
  });
  return out;
}

/** free the GPU buffers of a geometry (the engine has no public disposal; buffers are recreated if it is drawn again) */
export function disposeGeometry(game: Game, g: Geometry): void {
  const d = game.renderer.device;
  for (const k in g.attributes) {
    const a = g.attributes[k];
    if (a.gpu) { d.destroyBuffer(a.gpu); a.gpu = undefined; a.gpuVersion = -1; }
  }
  if (g.gpuIndex) { d.destroyBuffer(g.gpuIndex); g.gpuIndex = undefined; g.gpuIndexVersion = -1; }
}

// ================================================================ voxel props (shared by world & lobby)

const BULBS = [0xff3040, 0xffd23a, 0x30d860, 0x3a8cff, 0xff7ae0, 0xff9a2a];
/** a garland bulb, alternating blink groups */
export function bulb(M: Mesher, x: number, y: number, z: number, i: number, s = 0.16): void {
  const k = ((i % BULBS.length) + BULBS.length) % BULBS.length;
  M.add(k % 2 ? L_BLINK_B : L_BLINK_A, x, y, z, s, s * 1.25, s, 'voxel', BULBS[k]);
}

/** blocky snowy pine; size 0 small .. 3 huge; `deco` = number of ornaments; `tree` = a green New-Year tree (no snow) */
export function pine(M: Mesher, x: number, z: number, size: number, deco = 0, rnd: () => number = Math.random, tree = false): void {
  const trunk = size >= 2 ? 2 : 1;
  for (let y = 0; y < trunk; y++) M.unit(L_PROP, x, y + 0.5, z, ['logTop', 'log', 'logTop']);
  const radii = [[2, 1, 1, 0], [2, 2, 1, 1, 0], [3, 2, 2, 1, 1, 0], [4, 3, 3, 2, 2, 1, 1, 0]][Math.min(3, size)];
  const leaf: Faces = tree ? ['snow', 'leaves', 'leaves'] : ['snow', 'snowLeaves', 'leaves'];
  let y = trunk + 0.5;
  const spots: number[] = [];
  for (const R of radii) {
    for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) {
      if (R >= 2 && Math.abs(dx) === R && Math.abs(dz) === R) continue;
      if (R >= 3 && Math.abs(dx) + Math.abs(dz) > R + 1) continue;
      M.unit(L_PROP, x + dx, y, z + dz, leaf);
      if (R >= 1 && (Math.abs(dx) === R || Math.abs(dz) === R)) spots.push(x + dx, y, z + dz, dx, dz);
    }
    y++;
  }
  // ornaments on the outer faces (glowing voxels in both blink groups)
  for (let i = 0; i < deco && spots.length; i++) {
    const k = Math.floor(rnd() * (spots.length / 5)) * 5;
    const [bx, by, bz, dx, dz] = spots.slice(k, k + 5);
    const ox = Math.abs(dx) >= Math.abs(dz) ? Math.sign(dx) * 0.56 : 0, oz = ox ? 0 : Math.sign(dz) * 0.56;
    bulb(M, bx + ox, by - 0.2, bz + oz, i, 0.24);
  }
  if (tree) {
    // golden star on top
    const sy = y + 0.3;
    M.add(L_GLOW, x, sy, z, 0.3, 0.9, 0.3, 'voxel', 0xffd447).add(L_GLOW, x, sy, z, 0.9, 0.3, 0.3, 'voxel', 0xffd447);
  }
}

/** snowman facing yaw `ry` (0 = facing +Z) */
export function snowman(M: Mesher, x: number, z: number, ry: number, hat: number): void {
  const L = L_PROP, cs = Math.cos(ry), sn = Math.sin(ry);
  // offsets in the snowman's frame (+z = his front)
  const at = (dx: number, y: number, dz: number, sx: number, sy: number, sz: number, c: number, layer = L) =>
    M.add(layer, x + dx * cs + dz * sn, y, z - dx * sn + dz * cs, sx, sy, sz, 'voxel', c, ry);
  M.add(L, x, 0.5, z, 1.1, 1, 1.1, 'snow').add(L, x, 1.36, z, 0.82, 0.74, 0.82, 'snow').add(L, x, 2.0, z, 0.6, 0.56, 0.6, 'snow');
  at(-0.13, 2.08, 0.3, 0.09, 0.09, 0.04, 0x1b1d22);
  at(0.13, 2.08, 0.3, 0.09, 0.09, 0.04, 0x1b1d22);
  at(0, 1.98, 0.42, 0.09, 0.09, 0.26, 0xf07a1a);
  for (const by of [1.2, 1.4, 1.6]) at(0, by, 0.42, 0.09, 0.09, 0.04, 0x1b1d22);
  at(-0.6, 1.45, 0, 0.5, 0.07, 0.07, 0x6b4426);
  at(0.6, 1.5, 0, 0.5, 0.07, 0.07, 0x6b4426);
  if (hat === 0) { at(0, 2.3, 0, 0.62, 0.06, 0.62, 0x1b1d22); at(0, 2.5, 0, 0.4, 0.38, 0.4, 0x1b1d22); at(0, 2.33, 0, 0.42, 0.07, 0.42, 0xd02030); }
  else { at(0, 2.42, 0, 0.5, 0.36, 0.5, 0xd02030); at(0, 2.66, 0, 0.18, 0.14, 0.18, 0xffffff); at(0, 1.72, 0.05, 0.66, 0.1, 0.66, 0x2fa84a); }
}

const GIFTS: TexId[] = ['giftRed', 'giftGreen', 'giftBlue', 'giftGold'];
const RIBBON = [0xffd447, 0xe0303a, 0xffd447, 0xe0303a];
/** gift box (texture stretched over each face) with a voxel bow; s = size */
export function gift(M: Mesher, x: number, y: number, z: number, s: number, kind: number, ry = 0): void {
  const k = kind % 4, c = RIBBON[k];
  M.add(L_PROP, x, y + s / 2, z, s, s, s, GIFTS[k], 0xffffff, ry, true);
  const top = y + s + 0.08 * s;
  M.add(L_PROP, x, top, z, 0.42 * s, 0.16 * s, 0.14 * s, 'voxel', c, ry + 0.5).add(L_PROP, x, top, z, 0.42 * s, 0.16 * s, 0.14 * s, 'voxel', c, ry - 0.5);
}

/** lamp post at x (arm toward the track), glowing lamp head */
export function lampPost(M: Mesher, x: number, z: number): void {
  const s = Math.sign(x) || 1;
  M.add(L_PROP, x, 1.7, z, 0.2, 3.4, 0.2, 'metal').add(L_PROP, x, 0.15, z, 0.45, 0.3, 0.45, 'stone');
  M.add(L_PROP, x - s * 0.35, 3.45, z, 0.9, 0.12, 0.12, 'metal');
  M.add(L_GLOW, x - s * 0.7, 3.2, z, 0.38, 0.42, 0.38, 'lamp');
  M.add(L_PROP, x - s * 0.7, 3.45, z, 0.5, 0.08, 0.5, 'snow');
}

/** log cabin with lit windows and a garland; `face` = +1 / -1: the side (X) that faces the track */
export function cabin(M: Mesher, x0: number, z0: number, face: number, rnd: () => number): void {
  // footprint: 5 (x) by 6 (z) cells, cells centered at integers
  const W = 5, D = 6, xs = Math.round(x0 - (W - 1) / 2), zs = Math.round(z0 - (D - 1) / 2);
  const front = face < 0 ? xs : xs + W - 1;
  for (let y = 0.5; y < 3; y++) for (let i = 0; i < W; i++) for (let j = 0; j < D; j++) {
    const edge = i === 0 || j === 0 || i === W - 1 || j === D - 1;
    if (!edge) continue;
    const x = xs + i, z = zs + j, corner = (i === 0 || i === W - 1) && (j === 0 || j === D - 1);
    const win = x === front && y === 1.5 && (j === 1 || j === D - 2);
    const door = x === front && (y === 0.5 || y === 1.5) && j === Math.floor(D / 2);
    const back = y === 1.5 && (((x !== front && (i === 0 || i === W - 1)) && j === 2) || ((j === 0 || j === D - 1) && i === 2));
    if (win || back) M.unit(L_GLOW, x, y, z, 'window');
    else if (door) M.unit(L_PROP, x, y, z, 'planks');
    else M.unit(L_PROP, x, y, z, corner ? ['logTop', 'log', 'logTop'] : 'log');
  }
  // stepped snowy roof, gable along z
  for (let k = 0; k < 3; k++) {
    const w = W + 2 - 2 * k;
    M.add(L_PROP, xs + (W - 1) / 2, 3 + k * 0.6 + 0.3, zs + (D - 1) / 2, w, 0.6, D + 1.2, ['snow', 'snowSide', 'planks']);
  }
  // chimney
  M.add(L_PROP, xs + (face < 0 ? W - 1 : 0), 4.4, zs + 1, 0.8, 2, 0.8, 'brick').add(L_PROP, xs + (face < 0 ? W - 1 : 0), 5.45, zs + 1, 0.9, 0.1, 0.9, 'snow');
  // garland along the eave on the track side
  const ex = (face < 0 ? xs - 1 : xs + W) + face * 0.0, n = Math.round((D + 1) / 0.5);
  for (let i = 0; i <= n; i++) bulb(M, ex - face * 0.05, 3.0 - 0.14 * Math.abs(Math.sin((i / n) * Math.PI * 3)), zs - 1.1 + i * 0.5 + 0.0, i + Math.floor(rnd() * 2));
}

/** striped candy cane (hook toward +x or -x) */
export function candyCane(M: Mesher, x: number, z: number, dir: number): void {
  M.add(L_PROP, x, 1.1, z, 0.3, 2.2, 0.3, 'candy').add(L_PROP, x + dir * 0.3, 2.35, z, 0.9, 0.3, 0.3, 'candy').add(L_PROP, x + dir * 0.6, 2.05, z, 0.3, 0.4, 0.3, 'candy');
}

// ================================================================ procedural decal textures

let cracks: Texture[] | null = null;
/** 3 crack stages (16x16, transparent with lines), drawn once */
function crackTex(stage: number): Texture {
  if (!cracks) {
    cracks = [1, 2, 3].map((k) => {
      const c = document.createElement('canvas');
      c.width = c.height = 16;
      const g = c.getContext('2d')!, r = rng(97 + k);
      for (let i = 0; i < 2 + k * 2; i++) {
        let x = Math.floor(r() * 16), y = Math.floor(r() * 16);
        for (let s = 0; s < 4 + k * 2; s++) {
          g.fillStyle = s % 3 ? '#e9fbff' : '#3f7fae';
          g.fillRect(x, y, 1, 1);
          x = (x + (r() < 0.5 ? 1 : -1) + 16) % 16;
          y = (y + (r() < 0.7 ? 1 : 0) + 16) % 16;
        }
      }
      return Texture.fromCanvas(c, { filter: 'nearest', wrap: 'repeat', mips: false });
    });
  }
  return cracks[Math.max(0, Math.min(2, stage - 1))];
}

let blobTex: Texture | null = null;
/** soft dark disc (shadows / warnings) */
export function blobTexture(): Texture { return (blobTex ??= softDot(32, 0.2)); }

// ================================================================ WorldView

/** track chunk length (m) */
const CHUNK = 32;
/** draw window around the camera (m along the track) */
const BEHIND = 14;
/** floor rows before the start line / after the level end */
const PRE = 24, POST = 48;
/** water surface in ice holes */
const WATER_Y = -0.4;
const SURF_TEX: TexId[] = ['snow', 'ice', 'thaw', 'salt', 'boost'];
const BONUS_TINT = [0xc8ffd0, 0xb8f4ff, 0xb8d0ff, 0xe0c0ff, 0xffd0a8, 0xfff0a0];
const BONUS_BG = ['#2a8f3a', '#1f8f9f', '#2f6fdf', '#8a4fdf', '#e07a1a', '#d4a010'];
const SIGN_OK = '#2a9a3a', SIGN_NO = '#1d4f91';

interface Sign { mesh: Mesh; mat: Material; n: number; ok: number; plate: boolean; w: number; h: number }
/** visual of one obstacle */
interface OV {
  o: Obstacle;
  node: Node;
  main: Mesh | null;
  sign: Sign | null;
  /** moving part: hammer arm, icicle, plow body, flame */
  part: Node | null;
  /** secondary: crack overlay, icicle shadow, plow beacon */
  aux: Mesh | null;
  /** kind state: icicle cycle, plow heading, crack stage */
  st: number;
  shown: boolean;
  /** casting a sun shadow (only near the camera: the shadow pass is not culled) */
  cast: boolean;
}
interface PV { p: Pickup; node: Node | null; shown: boolean }
interface Chunk { d0: number; d1: number; node: Node; casters: Mesh[]; shadow: boolean }

const _m = /* @__PURE__ */ m4(), _q = /* @__PURE__ */ quat(), _p = /* @__PURE__ */ v3(), _s = /* @__PURE__ */ v3(1, 1, 1), _at = /* @__PURE__ */ v3();

/** tiny instanced cube debris (smashed walls / gifts): ballistic, bouncing, shrinking */
class Debris {
  mesh: Mesh;
  private _n = 0;
  private _d: Float32Array;
  constructor(parent: Node, geo: Geometry, private _max = 48) {
    this.mesh = parent.add(new Mesh(geo, atlasMaterials().lit));
    this.mesh.instances = new Instances(_max);
    this.mesh.castShadow = false;
    this._d = new Float32Array(_max * 10); // x y z vx vy vz life rx ry s
  }
  spawn(x: number, y: number, z: number, wx: number, wy: number, n: number, speed: number, size: number): void {
    for (let i = 0; i < n && this._n < this._max; i++) {
      const o = this._n++ * 10, D = this._d;
      D[o] = x + (Math.random() * 2 - 1) * wx; D[o + 1] = y + (Math.random() * 2 - 1) * wy; D[o + 2] = z + (Math.random() - 0.5) * 0.6;
      D[o + 3] = (Math.random() * 2 - 1) * speed * 0.6; D[o + 4] = (0.4 + Math.random()) * speed * 0.8; D[o + 5] = -(0.3 + Math.random()) * speed;
      D[o + 6] = 1 + Math.random() * 0.6; D[o + 7] = Math.random() * 6; D[o + 8] = Math.random() * 6; D[o + 9] = size * (0.6 + Math.random() * 0.7);
    }
  }
  update(dt: number): void {
    const D = this._d, inst = this.mesh.instances as Instances;
    if (!this._n && !inst.count) return;
    inst.count = 0;
    for (let i = 0; i < this._n; i++) {
      const o = i * 10;
      D[o + 6] -= dt;
      if (D[o + 6] <= 0) { D.copyWithin(o, (this._n - 1) * 10, this._n * 10); this._n--; i--; continue; }
      D[o + 4] -= 22 * dt;
      D[o] += D[o + 3] * dt; D[o + 1] += D[o + 4] * dt; D[o + 2] += D[o + 5] * dt;
      const s = D[o + 9] * Math.min(1, D[o + 6] * 3);
      if (D[o + 1] < s / 2) { D[o + 1] = s / 2; D[o + 4] *= -0.35; D[o + 3] *= 0.6; D[o + 5] *= 0.6; }
      D[o + 7] += dt * 7; D[o + 8] += dt * 5;
      qeuler(_q, D[o + 7], D[o + 8], 0);
      _p[0] = D[o]; _p[1] = D[o + 1]; _p[2] = D[o + 2];
      _s[0] = _s[1] = _s[2] = s;
      inst.setMatrix(i, m4compose(_m, _p, _q, _s));
    }
    inst.count = this._n;
    inst.update();
  }
}

/** cube model of one tile (debris, unit scale) */
function cubeGeo(t: TexId, fit = true): Geometry {
  return new Mesher().add(L_PROP, 0, 0, 0, 1, 1, 1, t, 0xffffff, 0, fit).geometries()[L_PROP];
}

/** voxel coin (8x8 disc, bulging middle), ~0.52 m wide, facing +Z */
function coinGeo(): Geometry {
  const M = new Mesher();
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
    const dx = i - 3.5, dy = j - 3.5, r = Math.hypot(dx, dy);
    if (r > 4.1) continue;
    const rim = r > 3, hi = dx < -0.5 && dy > 0.5 && r < 2.6;
    M.unit(L_PROP, dx, dy, 0, 'voxel', rim ? 0xe39b22 : hi ? 0xfff0a0 : 0xffd447);
    if (r < 2.4) { M.unit(L_PROP, dx, dy, 1, 'voxel', 0xffc83a); M.unit(L_PROP, dx, dy, -1, 'voxel', 0xffc83a); }
  }
  return M.geometries(0.065)[L_PROP];
}

/** voxel gem (cut diamond), unit ~0.6 m */
function gemGeo(): Geometry {
  const M = new Mesher(), layers: [number, number][] = [[0, 0], [1, 1], [2, 2], [3, 2], [4, 1]];
  for (const [y, R] of layers) for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) {
    if (Math.abs(dx) + Math.abs(dz) > R + (R > 1 ? 1 : 0)) continue;
    const c = (dx + dz + y) % 2 ? 0xff5ad8 : y >= 3 ? 0xffb0f0 : 0xd030c0;
    M.unit(L_PROP, dx, y - 2, dz, 'voxel', c);
  }
  return M.geometries(0.13)[L_PROP];
}

/** reward hint on top of a wall section */
function rewardGeo(kind: 'coins' | 'gem' | 'gift'): Geometry {
  const M = new Mesher();
  if (kind === 'gift') gift(M, 0, 0, 0, 0.55, 0);
  else if (kind === 'gem') return gemGeo();
  else for (let i = 0; i < 3; i++) M.add(L_PROP, -0.2 + i * 0.2, 0.05 + i * 0.1, 0, 0.42, 0.1, 0.42, 'gold');
  return M.geometries()[L_PROP];
}

const geoCache = /* @__PURE__ */ new Map<string, Geometry>();
function cached(key: string, make: () => Geometry): Geometry {
  let g = geoCache.get(key);
  if (!g) geoCache.set(key, (g = make()));
  return g;
}

export class WorldView {
  root!: Node;
  readonly level: LevelData;
  private _game: Game;
  private _sim: RaceSim | null = null;
  private _chunks: Chunk[] = [];
  private _ov: OV[] = [];
  private _pv: PV[] = [];
  private _coins: Pickup[] = [];
  private _coinMesh: Mesh;
  private _coinCur = 0;
  private _own: Geometry[] = [];
  private _ownMats: Material[] = [];
  private _bridges: Mesh[] = [];
  private _bridgeKeys = new Set<string>();
  private _bridgeAnim: { m: Mesh; t: number }[] = [];
  private _synced = 0;
  private _debris: Debris;
  private _giftDebris: Debris;
  private _fire: OV[] = [];
  private _lights: PointLight[] = [];
  private _fireAcc = 0;
  private _t = 0;
  private _hl: OV | null = null;
  private _sprayT = 0;
  private _beacon: Material;
  private _shadowMat: Material;
  private _signGeo = new Map<string, Geometry>();
  /** geometries of this level only (sizes vary per level): disposed in destroy */
  private _vcache = new Map<string, Geometry>();
  private _gemT = 0;

  constructor(game: Game, level: LevelData) {
    this._game = game;
    this.level = level;
    this.root = game.scene.add(new Node('world'));
    const rnd = rng((level.seed ^ 0x77031d) >>> 0);
    const M = new Mesher(CHUNK), big: Block[] = [];
    const end = level.length + POST;
    const holes = level.obstacles.filter((o) => o.kind === 'gap').map((o) => [o.d - o.len, o.d + o.len] as const);
    this._beacon = new Material({ type: 'unlit', color: 0xff8a1a });
    this._shadowMat = new Material({ type: 'unlit', color: 0x0a1028, map: blobTexture(), blend: 'alpha', depthWrite: false, castShadow: false, receiveShadow: false });
    this._ownMats.push(this._beacon, this._shadowMat);
    this._buildTrack(M, big, holes, end);
    // obstacles in track order (fire pits, hammer frames and icicle beams add static blocks to M)
    for (const o of level.obstacles.slice().sort((a, b) => a.d - b.d)) this._obstacle(o, M);
    this._buildDecor(M, big, rnd, holes, end);
    this._buildChunks(M, big);
    // pickups
    this._coins = level.pickups.filter((p) => p.kind === 'coin').sort((a, b) => a.d - b.d);
    const coinMat = new Material({ type: 'lambert', map: atlasTexture(), emissive: 0x8a6a20, emissiveIntensity: 0.85 });
    this._ownMats.push(coinMat);
    this._coinMesh = this.root.add(new Mesh(cached('coin', coinGeo), coinMat));
    this._coinMesh.instances = new Instances(Math.max(1, this._coins.length));
    this._coinMesh.castShadow = false;
    for (const p of level.pickups) if (p.kind !== 'coin') this._pickup(p);
    this._debris = new Debris(this.root, cached('dIce', () => cubeGeo('iceWall', false)));
    this._giftDebris = new Debris(this.root, cached('dGift', () => cubeGeo('giftRed')), 24);
    for (let i = 0; i < 3; i++) {
      const l = this.root.add(new PointLight(0xff9a40, 0, 9));
      l.visible = false;
      this._lights.push(l);
    }
  }

  // ---------------------------------------------------------------- static world

  private _buildTrack(M: Mesher, big: Block[], holes: (readonly [number, number])[], end: number) {
    const L = this.level;
    const holeAt = (a: number, b: number) => holes.some(([h0, h1]) => a < h1 - 1e-6 && b > h0 + 1e-6);
    for (let r = -PRE; r < end; r++) {
      const z = -(r + 0.5);
      // solid parts of this row (holes are row-aligned in practice; partial rows are handled anyway)
      let parts: [number, number][] = [[r, r + 1]];
      for (const [h0, h1] of holes) {
        const next: [number, number][] = [];
        for (const [a, b] of parts) {
          if (b <= h0 || a >= h1) { next.push([a, b]); continue; }
          if (a < h0) next.push([a, h0]);
          if (b > h1) next.push([h1, b]);
        }
        parts = next;
      }
      const full = parts.length === 1 && parts[0][0] === r && parts[0][1] === r + 1;
      for (const [a, b] of parts) {
        const zz = -(a + b) / 2, len = b - a;
        for (let x = -8; x <= 8; x++) {
          const c = x + 6, onTrack = c >= 0 && c < TRACK_W && r >= 0 && r < L.length;
          const t: Faces = [SURF_TEX[onTrack ? L.surface[r * TRACK_W + c] : SURF.snow] ?? 'snow', 'snowSide', 'dirt'];
          if (full) M.unit(L_FLOOR, x, -0.5, z, t);
          else M.add(L_FLOOR, x, -0.5, zz, 1, 1, len, t);
        }
      }
      // side banks (1 then 2 blocks high) with a wooden fence and a garland on the inner bank
      if (!full || holeAt(r - 0.5, r + 1.5)) continue;
      for (const s of [-1, 1]) {
        M.unit(L_PROP, s * 7, 0.5, z, ['snow', 'snowBrick', 'snow']);
        M.unit(L_PROP, s * 8, 0.5, z, ['snow', 'snowBrick', 'snow']).unit(L_PROP, s * 8, 1.5, z, ['snow', 'snowBrick', 'snow']);
        const fx = s * 6.95;
        if (r % 2 === 0) M.add(L_PROP, fx, 1.5, z + 0.5, 0.18, 1, 0.18, 'log');
        M.add(L_PROP, fx, 1.32, z, 0.08, 0.13, 1, 'planks').add(L_PROP, fx, 1.78, z, 0.08, 0.13, 1, 'planks');
        bulb(M, s * 6.86, 1.62 - 0.07 * Math.abs(Math.sin(r * 1.3)), z, r + (s > 0 ? 1 : 0), 0.13);
      }
    }
    // water in the holes (spanning the banks) with a few ice floes
    const rnd = rng((L.seed ^ 0x4a7e5) >>> 0);
    for (const [h0, h1] of holes) {
      // the water sits high (0.4 m below the floor): visible from the chase camera even for 2 m holes
      M.add(L_FLOOR, 0, WATER_Y - 0.05, -(h0 + h1) / 2, 17, 0.1, h1 - h0, 'water', 0x7f9cc4);
      for (let i = 0; i < 6; i++) {
        const w = 0.5 + rnd() * 0.7;
        M.add(L_PROP, -7.5 + rnd() * 15, WATER_Y + 0.03, -(h0 + 0.35 + rnd() * (h1 - h0 - 0.7)), w, 0.08, w * (0.6 + rnd() * 0.5), 'packedIce', 0xffffff, rnd() * 3);
      }
      // hazard posts with orange flags on both banks at both edges of the hole
      for (const s of [-1, 1]) for (const e of [h0 - 0.35, h1 + 0.35]) {
        M.add(L_PROP, s * 7.3, 1.25, -e, 0.2, 2.5, 0.2, 'hazard');
        M.add(L_GLOW, s * 7.3 - s * 0.32, 2.3, -e, 0.5, 0.36, 0.05, 'voxel', 0xff7a1a);
      }
    }
    // outer snowfield (repeating texture, one quad per chunk side) and the end hill
    for (let d = -PRE; d < end; d += CHUNK) {
      const len = Math.min(CHUNK, end - d), z = -(d + len / 2);
      for (const s of [-1, 1]) big.push({ x: s * (8.5 + 35), y: -1, z, sx: 70, sy: 2, sz: len, t: ['snow', 'snowSide', 'dirt'] });
    }
    big.push({ x: 0, y: 4, z: -(end + 4), sx: 120, sy: 8, sz: 8, t: ['snow', 'snowSide', 'dirt'] });
    // start line (checkers) with two flags, finish line + arch built in _buildDecor
    M.add(L_FLOOR, 0, 0.02, -3.1, 13, 0.04, 0.6, 'finish');
    for (const s of [-1, 1]) {
      M.add(L_PROP, s * 7, 2.6, -3.1, 0.14, 3.2, 0.14, 'metal');
      M.add(L_PROP, s * 7 - s * 0.45, 3.85, -3.1, 0.8, 0.6, 0.06, 'redWool');
    }
  }

  private _buildDecor(M: Mesher, big: Block[], rnd: () => number, holes: (readonly [number, number])[], end: number) {
    const L = this.level, F = L.finishD;
    const nearHole = (d: number, m: number) => holes.some(([h0, h1]) => d > h0 - m && d < h1 + m);
    // finish line: checkers + candy pillars + banner (sign mesh) with a garland
    M.add(L_FLOOR, 0, 0.02, -F, 13, 0.04, 1, 'finish');
    for (const s of [-1, 1]) {
      M.add(L_PROP, s * 7.5, 3.5, -F, 1, 7, 1, 'candy').add(L_PROP, s * 7.5, 7.1, -F, 1.2, 0.2, 1.2, 'snow');
      for (let i = 0; i < 9; i++) bulb(M, s * 7.5 + Math.cos(i * 1.2) * 0.58, 0.6 + i * 0.7, -F + Math.sin(i * 1.2) * 0.58, i, 0.18);
    }
    for (let i = 0; i <= 20; i++) bulb(M, -7 + i * 0.7, 5.0 - 0.12 * Math.sin((i / 20) * Math.PI), -F + 0.32, i, 0.18);
    M.add(L_PROP, 0, 6.7, -F, 14.2, 0.25, 0.7, 'snow');
    const banner = this.root.add(new Mesh(cached('banner', () => boxGeo(14, 1.5, 0.4)), this._signMat(signTexture(tr({ ru: 'ФИНИШ', en: 'FINISH' }), '#ffffff', '#c81e2a', { w: 112, h: 12 }), false)));
    banner.setPosition(0, 5.85, -F);
    // big decorated New-Year tree near the finish with gifts around it
    const tx = -15, tz = -(F + 3);
    pine(M, tx, tz, 3, 0, rnd, true);
    for (let i = 0; i < 26; i++) {
      const y = 3 + rnd() * 7, R = Math.max(0.6, 4.4 - (y - 3) * 0.55), a = rnd() * Math.PI * 2;
      bulb(M, tx + Math.cos(a) * R, y, tz + Math.sin(a) * R, i, 0.3);
    }
    for (let i = 0; i < 5; i++) gift(M, tx + 4.6 + (i % 3) * 1.15, 0, tz - 2 + Math.floor(i / 3) * 1.3 + i * 0.4, 0.75 + (i % 2) * 0.25, i, i * 0.3);
    // bonus zone flags
    for (let d = F + 4; d < L.length; d += 4) for (const s of [-1, 1]) M.add(L_PROP, s * 8, 2.4, -d, 0.6, 0.5, 0.05, ((d / 4) | 0) % 2 ? 'giftGold' : 'redWool');

    // decorations outside the banks, per side: near lane, mid lane (cabins / big pines), far lane, hills
    for (const s of [-1, 1]) {
      const busy = (d: number) => (s < 0 && Math.abs(d - (F + 3)) < 9) || nearHole(d, 1.5);
      // mid lane first (cabins win their cells: Mesher.unit keeps the first block of a cell)
      const cabins: number[] = [];
      for (let d = -PRE + 4 + rnd() * 6; d < end; d += 6 + rnd() * 5) {
        if (s < 0 && Math.abs(d - (F + 3)) < 10) continue;
        if ((cabins.length ? d - cabins[cabins.length - 1] : 99) > 34 && rnd() < 0.3) { cabin(M, s * 16.5, -d, -s, rnd); cabins.push(d); d += 5; continue; }
        pine(M, Math.round(s * (15 + rnd() * 4)), Math.round(-d), 2, rnd() < 0.2 ? 5 : 0, rnd);
      }
      for (let d = -PRE + (s > 0 ? 8 : 0); d < end; d += 16) if (!busy(d)) lampPost(M, s * 9.4, -d);
      for (let d = -PRE + rnd() * 3; d < end; d += 3.5 + rnd() * 4) {
        if (busy(d) || (((d - (s > 0 ? 8 : 0) + PRE) % 16) + 16) % 16 < 1.6 || cabins.some((c) => Math.abs(c - d) < 5)) continue;
        const k = rnd(), x = s * (10.6 + rnd() * 1.6), z = -d;
        if (k < 0.42) pine(M, Math.round(x + s * 1.2), Math.round(z), rnd() < 0.35 ? 0 : 1, rnd() < 0.35 ? 3 + Math.floor(rnd() * 4) : 0, rnd);
        else if (k < 0.54) snowman(M, x, z, s > 0 ? -0.9 + rnd() * 0.4 : 0.9 - rnd() * 0.4, Math.floor(rnd() * 2));
        else if (k < 0.66) {
          const n = 2 + Math.floor(rnd() * 3), ry = rnd();
          for (let i = 0; i < n; i++) gift(M, x + (i % 2) * 0.9 * s, i > 2 ? 0.9 : 0, z + (i - 1) * 0.6, i > 2 ? 0.6 : 0.8 + rnd() * 0.25, Math.floor(rnd() * 4), ry + i);
        } else if (k < 0.75) candyCane(M, s * 9.9, z, -s);
        else if (k < 0.87) {
          // snow heap
          const hx = Math.round(x), hz = Math.round(z);
          M.unit(L_PROP, hx, 0.5, hz, ['snow', 'snowSide', 'dirt']).unit(L_PROP, hx + s, 0.5, hz, ['snow', 'snowSide', 'dirt']).unit(L_PROP, hx, 0.5, hz - 1, ['snow', 'snowSide', 'dirt']).unit(L_PROP, hx, 1.5, hz, 'snow');
        }
      }
      for (let d = -PRE + rnd() * 5; d < end + 20; d += 10 + rnd() * 7) pine(M, Math.round(s * (23 + rnd() * 11)), Math.round(-d), rnd() < 0.7 ? 2 : 3, 0, rnd);
      // distant hills: stepped snow mounds (fogged silhouettes)
      for (let d = -PRE - 20 + rnd() * 10; d < end + 40; d += 22 + rnd() * 18) {
        const hx = s * (52 + rnd() * 18), w = 16 + rnd() * 16, h = 4 + rnd() * 9, len = 18 + rnd() * 16;
        for (let k = 0; k < 3; k++) big.push({ x: hx + s * k * 2, y: (h * (k + 0.5)) / 3, z: -d, sx: w - k * w * 0.28, sy: h / 3, sz: len - k * len * 0.28, t: ['snow', 'snowSide', 'dirt'] });
      }
    }
  }

  private _buildChunks(M: Mesher, big: Block[]) {
    const byChunk = new Map<number, Chunk>();
    const chunk = (c: number) => {
      let ch = byChunk.get(c);
      if (!ch) {
        // chunk c covers z in [c*CHUNK, (c+1)*CHUNK) → d in (-(c+1)*CHUNK, -c*CHUNK]
        ch = { d0: -(c + 1) * CHUNK - 8, d1: -c * CHUNK + 8, node: this.root.add(new Node('chunk')), casters: [], shadow: true };
        byChunk.set(c, ch);
      }
      return ch;
    };
    for (const { layer, chunk: c, geo } of M.build()) {
      const ch = chunk(c), m = ch.node.add(new Mesh(geo, layerMaterial(layer)));
      m.castShadow = layer === L_PROP;
      m.receiveShadow = layer <= L_PROP;
      if (layer === L_PROP) ch.casters.push(m);
      this._own.push(geo);
    }
    for (const { t, chunk: c, geo } of blockGeometry(big, { noBottom: true, chunk: CHUNK })) {
      const m = chunk(c).node.add(new Mesh(geo, blockMaterial(t)));
      m.castShadow = false;
      this._own.push(geo);
    }
    this._chunks = [...byChunk.values()].sort((a, b) => a.d0 - b.d0);
  }

  // ---------------------------------------------------------------- dynamic objects

  private _vgeo(key: string, make: () => Geometry): Geometry {
    let g = this._vcache.get(key);
    if (!g) { this._vcache.set(key, (g = make())); this._own.push(g); }
    return g;
  }

  private _signMat(map: Texture, cut: boolean): Material {
    const m = new Material({ type: 'unlit', map, alphaTest: cut ? 0.5 : 0 });
    this._ownMats.push(m);
    return m;
  }

  /** sign on `parent`: plate (box with the texture on the faces) or decal (quad, cut-out); updated by _setSign */
  private _sign(parent: Node, x: number, y: number, z: number, w: number, h: number, plate: boolean): Sign {
    const k = `${plate ? 'p' : 'd'}${w.toFixed(2)}x${h.toFixed(2)}`;
    let g = this._signGeo.get(k);
    if (!g) {
      g = plate ? boxGeo(w, h, 0.12) : quad(w, h);
      this._signGeo.set(k, g);
      this._own.push(g);
    }
    const mat = this._signMat(signTexture(' ', '#fff', 'none'), !plate);
    const mesh = parent.add(new Mesh(g, mat));
    mesh.setPosition(x, y, z);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    return { mesh, mat, n: -1, ok: -1, plate, w: Math.round(w * 20), h: Math.round(h * 20) };
  }
  private _setSign(s: Sign, n: number, ok: boolean) {
    const v = ok ? 1 : 0;
    if (s.n === n && s.ok === v) return;
    s.n = n;
    s.ok = v;
    const txt = String(n);
    s.mat.map = s.plate
      ? signTexture(txt, '#ffffff', ok ? SIGN_OK : SIGN_NO, { w: Math.max(12, s.w), h: Math.max(8, s.h) })
      : signTexture(txt, ok ? '#9dff6a' : '#ffffff', 'none', { w: Math.max(12, s.w), h: Math.max(8, s.h) });
  }

  private _obstacle(o: Obstacle, M: Mesher) {
    const node = this.root.add(new Node(o.kind));
    node.setPosition(o.x, 0, -o.d);
    node.visible = false;
    const v: OV = { o, node, main: null, sign: null, part: null, aux: null, st: -1, shown: false, cast: true };
    const lit = atlasMaterials().lit;
    const mesh = (g: Geometry, parent: Node = node, m: Material = lit) => parent.add(new Mesh(g, m));
    switch (o.kind) {
      case 'wall': {
        const w = Math.max(0.6, o.w * 2 - 0.08), k = w.toFixed(2);
        v.main = mesh(this._vgeo('wall' + k, () => {
          // ice body, darker packed-ice edge pillars (section seams) and a snow cap
          const W = new Mesher().add(L_PROP, 0, 1.5, 0, w - 0.36, 3, 1, 'iceWall');
          for (const e of [-1, 1]) W.add(L_PROP, e * (w / 2 - 0.15), 1.55, 0, 0.3, 3.1, 1.06, 'packedIce', 0xb8d4f0);
          W.add(L_PROP, 0, 3.08, 0, w - 0.3, 0.16, 1.04, 'snow');
          return W.geometries()[L_PROP];
        }));
        const crack = new Material({ type: 'lambert', map: crackTex(1), alphaTest: 0.5 });
        this._ownMats.push(crack);
        v.aux = mesh(this._vgeo('crack' + k, () => boxGeo(w + 0.03, 3.03, 1.03)), node, crack);
        v.aux.visible = false;
        v.aux.castShadow = false;
        const sw = Math.min(w - 0.5, 2.5);
        v.sign = this._sign(node, 0, 1.65, 0.52, sw, Math.min(1.7, sw * 0.68), false);
        if (o.reward) mesh(cached('rw' + o.reward, () => rewardGeo(o.reward!))).setPosition(0, 3.16, 0);
        break;
      }
      case 'spikes': {
        const g = spikesGeo(o.w, o.id);
        this._own.push(g);
        v.main = mesh(g);
        v.sign = this._sign(node, 0, 2.35, 0, 1.1, 0.6, true);
        break;
      }
      case 'fire': {
        // logs and a stone ring stay after the fire is out (static); flame, embers and light are dynamic
        const z = -o.d, x = o.x, w = o.w;
        M.add(L_PROP, x, 0.16, z, w * 1.5, 0.3, 0.32, ['logTop', 'log', 'logTop'], 0xffffff, 0.5).add(L_PROP, x, 0.36, z, w * 1.5, 0.3, 0.32, ['logTop', 'log', 'logTop'], 0xffffff, -0.6);
        for (let i = 0; i < 8; i++) M.add(L_PROP, x + Math.cos(i * 0.785) * w * 0.95, 0.14, z + Math.sin(i * 0.785) * w * 0.95, 0.34, 0.28, 0.34, 'cobble', 0xffffff, i * 0.785);
        const part = node.add(new Node('flame'));
        const fm = blockMaterial('fire');
        const fg = this._vgeo('flame' + w.toFixed(2), () => crossSprite(w * 1.5, w * 1.9));
        const f1 = mesh(fg, part, fm), f2 = mesh(fg, part, fm);
        f2.setRotation(0, Math.PI / 4, 0).setScale(0.75, 0.8, 0.75);
        f1.castShadow = f2.castShadow = false;
        const emb = mesh(cached('embers', () => {
          const E = new Mesher();
          for (let i = 0; i < 7; i++) E.add(L_GLOW, Math.cos(i * 2.4) * 0.35, 0.5, Math.sin(i * 2.4) * 0.35, 0.16, 0.12, 0.16, 'voxel', i % 2 ? 0xffb020 : 0xff5a10);
          return E.geometries()[L_GLOW];
        }), part, atlasMaterials().glow);
        emb.castShadow = false;
        v.part = part;
        v.main = f1;
        v.sign = this._sign(node, 0, 2.3 + w, 0, 1.1, 0.6, true);
        this._fire.push(v);
        break;
      }
      case 'hammer': {
        // static frame across the track, swinging candy mallet
        const z = -o.d;
        for (const s of [-1, 1]) M.add(L_PROP, s * 7.3, 2.85, z, 0.5, 5.7, 0.5, ['logTop', 'log', 'logTop']).add(L_PROP, s * 7.3, 5.8, z, 0.7, 0.2, 0.7, 'snow');
        M.add(L_PROP, 0, 5.4, z, 15.1, 0.45, 0.45, ['logTop', 'log', 'logTop']).add(L_PROP, 0, 5.7, z, 15.1, 0.15, 0.55, 'snow');
        M.add(L_PROP, o.x, HAMMER_PIVOT + 0.4, z, 0.35, 0.8, 0.35, 'metal');
        const part = node.add(new Node('arm'));
        part.setPosition(0, HAMMER_PIVOT, 0);
        const w = o.w;
        v.main = mesh(this._vgeo('hammer' + w.toFixed(2), () => {
          const H = new Mesher();
          H.add(L_PROP, 0, -(w - 0.5) / 2, 0, 0.22, w - 0.5, 0.22, 'candy');
          H.add(L_PROP, 0, -w, 0, 1.5, 1.15, 1.15, 'candy').add(L_PROP, -0.8, -w, 0, 0.1, 1.2, 1.2, 'snow').add(L_PROP, 0.8, -w, 0, 0.1, 1.2, 1.2, 'snow');
          return H.geometries()[L_PROP];
        }), part);
        v.part = part;
        break;
      }
      case 'pusher': {
        const s = o.w * 2;
        v.main = mesh(this._vgeo('pusher' + (o.id % 4) + s.toFixed(2), () => { const G = new Mesher(); gift(G, 0, 0, 0, s, o.id % 4); return G.geometries()[L_PROP]; }));
        v.sign = this._sign(node, 0, s * 0.5, s / 2 + 0.07, Math.min(1.2, s * 0.7), Math.min(0.65, s * 0.38), true);
        break;
      }
      case 'plow': {
        v.part = node.add(new Node('plow'));
        v.main = mesh(cached('plow', plowGeo), v.part);
        v.aux = mesh(cached('beacon', () => boxGeo(0.26, 0.2, 0.26)), v.part, this._beacon);
        v.aux.setPosition(-0.25, 1.82, 0);
        v.aux.castShadow = false;
        node.setPosition(0, 0, -o.d);
        break;
      }
      case 'icicle': {
        const z = -o.d;
        // a beam across the track with small decorative icicles
        for (const s of [-1, 1]) M.add(L_PROP, s * 7.4, 3.25, z, 0.45, 6.5, 0.45, ['logTop', 'log', 'logTop']);
        M.add(L_PROP, 0, 6.5, z, 15.3, 0.45, 0.5, ['logTop', 'log', 'logTop']).add(L_PROP, 0, 6.8, z, 15.3, 0.16, 0.6, 'snow');
        for (let i = 0; i < 12; i++) {
          const x = -6.6 + i * 1.2 + ((o.id * 7 + i * 3) % 5) * 0.08;
          if (Math.abs(x - o.x) > 0.7) M.add(L_PROP, x, 6.05, z, 0.16, 0.45 + ((i * 7) % 4) * 0.12, 0.16, 'packedIce');
        }
        v.part = node.add(new Node('icicle'));
        v.part.setPosition(0, 6.28, 0);
        v.main = mesh(cached('icicle', icicleGeo), v.part);
        v.aux = mesh(cached('blob', () => planeGeo(2, 2)), node, this._shadowMat);
        v.aux.setPosition(0, 0.03, 0);
        v.aux.visible = false;
        v.aux.castShadow = false;
        v.aux.renderOrder = 1;
        break;
      }
      case 'gap': {
        node.setPosition(0, 0, -o.d);
        v.sign = this._sign(node, 0, 2.6, 0, 1.6, 0.85, true);
        break;
      }
      case 'bonus': {
        const i = Math.max(0, Math.min(BONUS_TINT.length - 1, BONUS_MULTS.indexOf(o.mult ?? 1)));
        node.setPosition(0, 0, -o.d);
        v.main = mesh(cached('bonusWall', () => new Mesher().add(L_PROP, 0, 1.5, 0, 12.92, 3, 1, 'iceWall').geometries()[L_PROP]));
        color(BONUS_TINT[i], 1, v.main.tint);
        const plate = mesh(cached('bonusPlate', () => boxGeo(3.2, 1.4, 0.3)), node, this._signMat(signTexture(`x${o.mult ?? 1}`, '#ffffff', BONUS_BG[i], { w: 40, h: 18 }), false));
        plate.setPosition(0, 3.75, 0);
        plate.castShadow = false;
        v.sign = this._sign(node, 0, 1.5, 0.52, 2.2, 1.35, false);
        break;
      }
    }
    if (v.main) v.main.receiveShadow = true;
    this._ov.push(v);
  }

  private _pickup(p: Pickup) {
    const node = this.root.add(new Node(p.kind));
    node.setPosition(p.x, 0.7, -p.d);
    node.visible = false;
    if (p.kind === 'gem') {
      const m = new Material({ type: 'lambert', map: atlasTexture(), emissive: 0x9a2a90, emissiveIntensity: 0.6 });
      this._ownMats.push(m);
      node.add(new Mesh(cached('gem', gemGeo), m)).castShadow = false;
    } else {
      const g = node.add(new Mesh(cached('giftP' + (p.id % 4), () => { const G = new Mesher(); gift(G, 0, -0.35, 0, 0.7, p.id % 4); return G.geometries()[L_PROP]; }), atlasMaterials().lit));
      g.castShadow = false;
    }
    this._pv.push({ p, node, shown: false });
  }

  // ---------------------------------------------------------------- per frame

  /** sync moving obstacles, broken obstacles, bridges, pickups with the sim */
  update(sim: RaceSim, dt: number): void {
    this._sim = sim;
    this._t += dt;
    const t = sim.time, cd = -this._game.camera.position[2], d0 = cd - BEHIND, d1 = cd + viewFar;
    for (const c of this._chunks) {
      const vis = c.d1 > d0 && c.d0 < d1;
      if (c.node.visible !== vis) c.node.visible = vis;
      const sh = vis && c.d1 > cd - 4 && c.d0 < cd + 36;
      if (sh !== c.shadow) { c.shadow = sh; for (const m of c.casters) m.castShadow = sh; }
    }
    blinkLights(this._t);
    const ps = sim.player.size;
    let fires = 0;
    for (const v of this._ov) {
      const o = v.o, show = o.d + 8 > d0 && o.d - 8 < d1 && !sim.broken.has(o.id);
      if (show !== v.shown) { v.shown = show; v.node.visible = show; }
      if (!show) continue;
      const cast = o.d > cd - 6 && o.d < cd + 30;
      if (cast !== v.cast && v.main) { v.cast = cast; v.main.castShadow = cast; }
      const s = sim.strengthLeft(o);
      if (v.sign && s !== Infinity) this._setSign(v.sign, Math.ceil(s - 1e-6), ps >= s);
      switch (o.kind) {
        case 'wall': {
          const q = 1 - s / Math.max(1, o.strength), stage = q > 0.66 ? 3 : q > 0.4 ? 2 : q > 0.12 ? 1 : 0;
          if (stage !== v.st && v.aux) {
            v.st = stage;
            v.aux.visible = stage > 0;
            if (stage) v.aux.material.map = crackTex(stage);
          }
          break;
        }
        case 'hammer': v.part!.setRotation(0, 0, sim.hammerAngle(o)); break;
        case 'pusher': {
          const x = sim.obstacleX(o);
          v.node.position[0] = x;
          v.node.setRotation(0, Math.sin(t * 1.7 + o.id) * 0.06, 0);
          break;
        }
        case 'plow': {
          const x = sim.obstacleX(o), dir = sim.obstacleX(o, t + 0.05) - x >= 0 ? 1 : -1;
          v.node.position[0] = x;
          // turn around smoothly at the ends of its run
          v.st = v.st < -1.5 ? dir : v.st + Math.max(-dt * 8, Math.min(dt * 8, dir - v.st));
          v.part!.setRotation(0, v.st >= 0 ? (1 - v.st) * Math.PI / 2 : Math.PI - (1 + v.st) * Math.PI / 2, 0);
          const b = 0.5 + 0.5 * Math.sin(this._t * 12);
          this._beacon.uniforms[0] = 1 + b * glowK; this._beacon.uniforms[1] = 0.35 + 0.3 * b; this._beacon.uniforms[2] = 0.05;
          if (Math.abs(o.d - cd) < 40 && this._sprayT <= 0) {
            _at[0] = x + dir * 1.4; _at[1] = 0.3; _at[2] = -o.d;
            pixelBurst(this.root, 'snow', _at, 3, 0.8);
          }
          break;
        }
        case 'icicle': this._icicle(v, sim, t); break;
        case 'fire': {
          const f = 1 + 0.12 * Math.sin(this._t * 13 + o.id) + 0.07 * Math.sin(this._t * 29 + o.id * 2);
          v.part!.setScale(1, f, 1);
          if (fires < this._lights.length && o.d > cd - 4 && o.d < cd + 45 && this.level.theme !== 0) {
            const l = this._lights[fires++];
            l.visible = true;
            l.position[0] = o.x; l.position[1] = 1.3; l.position[2] = -o.d;
            l.intensity = (this.level.theme === 2 ? 9 : 5) * (0.85 + 0.15 * f);
          }
          break;
        }
      }
    }
    for (let i = fires; i < this._lights.length; i++) this._lights[i].visible = false;
    this._sprayT = this._sprayT <= 0 ? 0.09 : this._sprayT - dt;
    this._fireFx(dt, cd);
    this._syncBridges(sim);
    for (let i = this._bridgeAnim.length - 1; i >= 0; i--) {
      const b = this._bridgeAnim[i];
      b.t += dt;
      const k = Math.min(1, b.t / 0.3);
      b.m.scale[1] = k * (2 - k);
      if (k >= 1) this._bridgeAnim.splice(i, 1);
    }
    this._pickups(sim, cd, d0, d1);
    this._debris.update(dt);
    this._giftDebris.update(dt);
    if (this._hl?.main) {
      const f = this._hl.main.flash;
      f[0] = 1; f[1] = 0.95; f[2] = 0.4; f[3] = 0.25 + 0.25 * Math.sin(this._t * 9);
    }
  }

  private _icicle(v: OV, sim: RaceSim, t: number) {
    const o = v.o, P = o.period ?? 3, ph = t + (o.phase ?? 0), c = ((ph % P) + P) % P, cycle = Math.floor(ph / P);
    const s = sim.icicleState(o), part = v.part!, sh = v.aux!, top = 6.28, ground = ICICLE_LEN - 0.35;
    const near = Math.abs(o.d + this._game.camera.position[2]) < 60;
    _at[0] = o.x; _at[1] = 0.3; _at[2] = -o.d;
    if (s.fall < 0) {
      // a new cycle: the one stuck in the snow shatters, a new icicle grows from the beam
      if (part.position[1] < top - 1 && near) pixelBurst(this.root, 'ice', _at, 14, 1);
      part.position[1] = top;
      part.setScale(1, Math.min(1, Math.max(0.05, c / 0.5)), 1);
    } else if (s.fall < 1) {
      part.setScale(1, 1, 1);
      part.position[1] = top - (top - ground) * s.fall * s.fall;
    } else {
      // impact (dangerous window): stuck in the snow, burst once
      part.position[1] = ground;
      if (v.st !== cycle && near) { pixelBurst(this.root, 'ice', _at, 20, 1.2); pixelBurst(this.root, 'snow', _at, 14, 1.1); }
      v.st = cycle;
    }
    sh.visible = s.warn > 0;
    if (s.warn > 0) {
      const r = o.w * (0.5 + 0.9 * s.warn);
      sh.setScale(r, 1, r);
      sh.tint[3] = 0.4 + 0.6 * s.warn;
    }
  }

  /** shared fire particle system: a few sparks per frame at each visible, burning fire (cone spread) */
  private _fireFx(dt: number, cd: number) {
    this._fireAcc += dt * 26;
    const n = Math.floor(this._fireAcc);
    if (!n) return;
    this._fireAcc -= n;
    for (const v of this._fire) {
      if (!v.shown || Math.abs(v.o.d - cd - 15) > 40) continue;
      _at[0] = v.o.x; _at[1] = 0.5; _at[2] = -v.o.d;
      pixelBurst(this.root, 'fire', _at, n * 2, v.o.w);
    }
  }

  private _pickups(sim: RaceSim, cd: number, d0: number, d1: number) {
    // coins: one instanced draw, only the ones in the view window
    const C = this._coins, inst = this._coinMesh.instances as Instances, t = this._t;
    while (this._coinCur > 0 && C[this._coinCur - 1].d >= d0) this._coinCur--;
    while (this._coinCur < C.length && C[this._coinCur].d < d0) this._coinCur++;
    inst.count = 0;
    let n = 0;
    for (let i = this._coinCur; i < C.length && C[i].d < d1; i++) {
      const c = C[i];
      if (sim.taken.has(c.id)) continue;
      qeuler(_q, 0, t * 2.6 + c.d * 0.35, 0);
      _p[0] = c.x; _p[1] = 0.62 + 0.07 * Math.sin(t * 3 + c.d); _p[2] = -c.d;
      _s[0] = _s[1] = _s[2] = 1;
      inst.setMatrix(n++, m4compose(_m, _p, _q, _s));
    }
    inst.count = n;
    inst.update();
    this._gemT -= this._game.time.dt;
    const sparkle = this._gemT <= 0;
    if (sparkle) this._gemT = 0.3;
    for (const v of this._pv) {
      const p = v.p, show = p.d > d0 && p.d < d1 && !sim.taken.has(p.id);
      if (show !== v.shown) { v.shown = show; v.node!.visible = show; }
      if (!show) continue;
      const n2 = v.node!;
      n2.position[1] = 0.75 + 0.12 * Math.sin(t * 2.4 + p.id);
      n2.setRotation(0, t * (p.kind === 'gem' ? 2.2 : 1.1) + p.id, 0);
      if (sparkle && p.kind === 'gem' && Math.abs(p.d - cd) < 35) pixelBurst(this.root, 'gem', n2.position, 3, 0.8);
    }
  }

  private _syncBridges(sim: RaceSim) {
    for (; this._synced < sim.bridges.length; this._synced++) {
      const b = sim.bridges[this._synced], o = this.level.obstacles.find((q) => q.id === b.o);
      if (o) this.onBridge(o, b.x0, b.x1);
    }
  }

  // ---------------------------------------------------------------- events (effects only)

  /** an obstacle was destroyed: debris + particles (hiding happens in update via sim.broken) */
  onSmash(o: Obstacle): void {
    const x = o.kind === 'pusher' && this._sim ? this._sim.obstacleX(o) : o.x, z = -o.d;
    const at = [x, 1.2, z];
    switch (o.kind) {
      case 'wall':
        this._debris.spawn(x, 1.5, z + 0.3, o.w * 0.9, 1.2, Math.min(26, 10 + Math.round(o.w * 6)), 7, 0.42);
        pixelBurst(this.root, 'ice', at, 30, 1.6);
        pixelBurst(this.root, 'snow', at, 16, 1.4);
        break;
      case 'bonus':
        this._debris.spawn(0, 1.5, z + 0.3, 5.5, 1.2, 40, 8, 0.5);
        pixelBurst(this.root, 'ice', at, 40, 2);
        pixelBurst(this.root, 'confetti', [0, 3, z], 50, 1.2);
        break;
      case 'spikes':
        this._debris.spawn(x, 0.6, z + 0.2, o.w * 0.8, 0.4, 10, 6, 0.3);
        pixelBurst(this.root, 'ice', at, 26, 1.3);
        break;
      case 'pusher':
        this._giftDebris.spawn(x, 0.9, z + 0.3, 0.7, 0.6, 14, 7, 0.4);
        pixelBurst(this.root, 'gift', at, 30, 1.4);
        pixelBurst(this.root, 'confetti', at, 30, 1);
        break;
      case 'fire':
        pixelBurst(this.root, 'steam', [x, 0.8, z], 36, 2.2);
        pixelBurst(this.root, 'snow', [x, 0.5, z], 20, 1.3);
        break;
      default:
        pixelBurst(this.root, 'snow', at, 20, 1.3);
    }
  }

  /** a racer's ball plugged a hole: a snow bridge rises over x0..x1 (also built from sim.bridges in update) */
  onBridge(o: Obstacle, x0: number, x1: number): void {
    const key = `${o.id}:${x0.toFixed(2)}:${x1.toFixed(2)}`;
    if (this._bridgeKeys.has(key)) return;
    this._bridgeKeys.add(key);
    const w = x1 - x0, len = o.len * 2 + 0.3;
    const g = new Mesher().add(L_PROP, 0, -0.5, 0, w, 1, len, ['snow', 'snowSide', 'snowSide']).geometries()[L_PROP];
    this._own.push(g);
    const m = this.root.add(new Mesh(g, atlasMaterials().lit));
    m.setPosition((x0 + x1) / 2, 0, -o.d);
    m.scale[1] = 0.01;
    this._bridges.push(m);
    this._bridgeAnim.push({ m, t: 0 });
    pixelBurst(this.root, 'snow', [(x0 + x1) / 2, 0.2, -o.d], 30, Math.max(1, w * 0.6));
    pixelBurst(this.root, 'splash', [(x0 + x1) / 2, WATER_Y, -o.d], 16, 1);
  }

  onPickup(p: Pickup): void {
    const at = [p.x, 0.7, -p.d];
    if (p.kind === 'coin') pixelBurst(this.root, 'coin', at, 10, 1);
    else if (p.kind === 'gem') { pixelBurst(this.root, 'gem', at, 26, 1.4); pixelBurst(this.root, 'spark', at, 10, 1); }
    else { pixelBurst(this.root, 'gift', at, 28, 1.2); pixelBurst(this.root, 'confetti', at, 24, 0.9); }
  }

  /** tutorial helper: pulse-highlight an obstacle (null clears) */
  highlight(o: Obstacle | null): void {
    if (this._hl?.main) this._hl.main.flash[3] = 0;
    this._hl = o ? this._ov.find((v) => v.o === o) ?? null : null;
  }

  /** world point of an obstacle's sign / center (tutorial pointer); `out` is reused if given */
  worldPoint(o: Obstacle, out: Float32Array = v3()): Float32Array {
    const x = o.kind === 'pusher' || o.kind === 'plow' ? this._sim?.obstacleX(o) ?? o.x : o.kind === 'gap' || o.kind === 'bonus' ? 0 : o.x;
    const y = o.kind === 'wall' || o.kind === 'bonus' ? 1.7 : o.kind === 'gap' ? 2.6 : o.kind === 'fire' ? 2.3 + o.w : o.kind === 'hammer' ? 2 : 1.4;
    out[0] = x; out[1] = y; out[2] = -o.d;
    return out;
  }

  /** remove everything and free the GPU buffers of the meshes built for this level */
  destroy(): void {
    clearBursts(this.root);
    this.root.parent?.remove(this.root);
    const g = this._game;
    for (const geo of this._own) disposeGeometry(g, geo);
    const d = g.renderer.device;
    for (const m of [this._coinMesh, this._debris.mesh, this._giftDebris.mesh]) {
      const ib = m.instances;
      if (ib?.gpu) { d.destroyBuffer(ib.gpu); ib.gpu = undefined; ib.gpuVersion = -1; }
    }
    for (const m of this._ownMats) if (m.gpu) { d.destroyBuffer(m.gpu.ubo); m.gpu = undefined; }
    this._own = [];
    this._ownMats = [];
    this._ov = [];
    this._pv = [];
    this._fire = [];
    this._chunks = [];
    this._bridges = [];
    this._bridgeAnim = [];
    this._lights = [];
    this._vcache.clear();
    this._signGeo.clear();
    this._hl = null;
    this._sim = null;
  }
}

// ---------------------------------------------------------------- small geometries

/** box with each face showing the whole texture (signs, plates) */
function boxGeo(w: number, h: number, d: number): Geometry {
  const g = new Mesher().add(L_PROP, 0, 0, 0, w, h, d, 'snow', 0xffffff, 0, true).geometries()[L_PROP];
  // remap the atlas uv of the fitted faces to 0..1 for a standalone texture
  const uv = g.attributes.uv.data as Float32Array, tile = tileIndex.get('snow')!;
  const u0 = ((tile % COLS) * CELL + GUT + EPS) / atlasW, v0 = (Math.floor(tile / COLS) * CELL + GUT + EPS) / atlasH;
  const du = (TILE - 2 * EPS) / atlasW, dv = (TILE - 2 * EPS) / atlasH;
  for (let i = 0; i < uv.length; i += 2) { uv[i] = (uv[i] - u0) / du; uv[i + 1] = (uv[i + 1] - v0) / dv; }
  g.update('uv');
  delete g.attributes.color;
  return g;
}

/** horizontal quad (y up) of size w x d */
function planeGeo(w: number, d: number): Geometry {
  const x = w / 2, z = d / 2;
  return new Geometry().setAttribute('position', [-x, 0, -z, -x, 0, z, x, 0, z, x, 0, -z], 3).setAttribute('normal', [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3)
    .setAttribute('uv', [0, 0, 0, 1, 1, 1, 1, 0], 2).setIndex([0, 1, 2, 0, 2, 3]);
}

/** ice spikes over a width of 2w: an ice slab with stepped spikes (seeded by id) */
function spikesGeo(w: number, id: number): Geometry {
  const M = new Mesher(), r = rng(id * 131 + 7), n = Math.max(2, Math.round(w * 2.4));
  M.add(L_PROP, 0, 0.12, 0, w * 2, 0.24, 1, 'packedIce');
  for (let i = 0; i < n; i++) {
    const x = -w + ((i + 0.5) * 2 * w) / n, z = (r() - 0.5) * 0.4, h = 0.8 + r() * 0.8;
    M.add(L_PROP, x, 0.24 + h * 0.2, z, 0.44, h * 0.4, 0.44, 'ice').add(L_PROP, x, 0.24 + h * 0.55, z, 0.3, h * 0.3, 0.3, 'ice').add(L_PROP, x, 0.24 + h * 0.85, z, 0.16, h * 0.3, 0.16, 'packedIce');
  }
  return M.geometries()[L_PROP];
}

/** hanging icicle, top at y=0, tip at -ICICLE_LEN */
const ICICLE_LEN = 2.3;
function icicleGeo(): Geometry {
  const M = new Mesher();
  M.add(L_PROP, 0, -0.25, 0, 0.84, 0.5, 0.84, 'packedIce').add(L_PROP, 0, -0.77, 0, 0.62, 0.55, 0.62, 'ice')
    .add(L_PROP, 0, -1.3, 0, 0.44, 0.5, 0.44, 'ice').add(L_PROP, 0, -1.77, 0, 0.26, 0.45, 0.26, 'packedIce')
    .add(L_PROP, 0, -2.14, 0, 0.12, 0.32, 0.12, 'ice');
  return M.geometries()[L_PROP];
}

/** blocky snowplow, 2.4 (x) by 1.6 (z), blade toward +X */
function plowGeo(): Geometry {
  const M = new Mesher();
  M.add(L_PROP, -0.15, 0.55, 0, 1.9, 0.5, 1.4, 'metal', 0xff9a30);
  M.add(L_PROP, -0.25, 1.25, 0, 1.0, 0.9, 1.2, 'metal', 0xff8a1a);
  M.add(L_PROP, 0.27, 1.3, 0, 0.06, 0.5, 1.0, 'voxel', 0x26405c).add(L_PROP, -0.25, 1.3, 0.61, 0.8, 0.45, 0.04, 'voxel', 0x26405c).add(L_PROP, -0.25, 1.3, -0.61, 0.8, 0.45, 0.04, 'voxel', 0x26405c);
  M.add(L_PROP, 1.05, 0.45, 0, 0.25, 0.8, 1.7, 'hazard');
  M.add(L_PROP, 0.85, 0.4, 0, 0.4, 0.12, 0.3, 'metal');
  for (const x of [-0.75, 0.45]) for (const z of [-0.62, 0.62]) M.add(L_PROP, x, 0.28, z, 0.5, 0.5, 0.25, 'coal');
  M.add(L_PROP, -0.25, 1.73, 0, 0.5, 0.06, 0.5, 'metal');
  return M.geometries()[L_PROP];
}
