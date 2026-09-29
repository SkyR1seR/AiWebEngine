import type {
  BindLayout, Device, GpuBindGroup, GpuBuffer, GpuPipeline, GpuTexture, RenderPass, TexFormat, VertexBufferLayout,
} from '../gpu/device';
import type { Defines } from '../gpu/preprocess';
import { ATTR_LOC, type Geometry, type InstanceBuffer } from '../geometry/geometry';
import type { Material } from '../materials/material';
import { Mesh } from '../scene/mesh';
import type { Scene } from '../scene/scene';
import type { Camera } from '../scene/camera';
import { DirectionalLight, PointLight } from '../scene/light';
import { MAX_JOINTS } from '../anim/skin';
import { Texture } from './texture';
import { m4, m4mul, m4normal, m4ortho, m4targetTo, m4invert, sphereInFrustum, v3, v3dist, v3transformMat4 } from '../core/math';

export const FRAME_LAYOUT: BindLayout = { entries: [{ name: 'Frame', kind: 'ubo' }, { name: 'shadowMap', kind: 'depth' }] };
export const MAT_LAYOUT: BindLayout = { entries: [{ name: 'Material', kind: 'ubo' }, { name: 'map', kind: 'tex' }] };
export const OBJ_LAYOUT: BindLayout = { entries: [{ name: 'Object', kind: 'dyn' }] };
export const SKIN_LAYOUT: BindLayout = { entries: [{ name: 'Object', kind: 'dyn' }, { name: 'Skin', kind: 'ubo' }] };
const SCENE_GROUPS = [FRAME_LAYOUT, MAT_LAYOUT, OBJ_LAYOUT];
const SKIN_GROUPS = [FRAME_LAYOUT, MAT_LAYOUT, SKIN_LAYOUT];

const OBJ_BYTES = 160;
const FRAME_FLOATS = 164;
const MAX_POINTS = 8;

type PassKind = 'main' | 'shadow' | 'outline';

/** Something that can post-process the rendered frame (see fx/post). */
export interface PostProcess {
  enabled: boolean;
  render(r: Renderer, color: GpuTexture, depth: GpuTexture): void;
}

export interface RenderStats { draws: number; triangles: number; shadowDraws: number; meshes: number }

interface Item { mesh: Mesh; slot: number; z: number }

export class Renderer {
  stats: RenderStats = { draws: 0, triangles: 0, shadowDraws: 0, meshes: 0 };
  post: PostProcess | null = null;
  /** Meshes drawn after the scene without culling (debug lines, gizmos). */
  overlays: Mesh[] = [];
  time = 0;

  private frameUbo: GpuBuffer;
  private shadowFrameUbo: GpuBuffer;
  private frameData = new Float32Array(FRAME_FLOATS);
  private frameBG!: GpuBindGroup;
  private shadowFrameBG: GpuBindGroup;
  private objStride: number;
  private objCap = 0;
  private objBuf!: GpuBuffer;
  private objBG!: GpuBindGroup;
  private objGen = 0;
  private objData = new Float32Array(0);
  private objCount = 0;
  private pipes = new Map<string, GpuPipeline>();
  private white: GpuTexture;
  private dummyDepth: GpuTexture;
  private shadowTex: GpuTexture | null = null;
  private shadowMat = m4();
  private skyUbo: GpuBuffer | null = null;
  private skyBG: GpuBindGroup | null = null;
  private target: { color: GpuTexture; depth: GpuTexture } | null = null;
  private opaque: Item[] = [];
  private transparent: Item[] = [];
  private casters: Item[] = [];
  private outlines: Item[] = [];
  private points: PointLight[] = [];
  private sun: DirectionalLight | null = null;
  private matSeen = new Set<Material>();
  readonly hdrFormat: TexFormat;

  constructor(public device: Device) {
    const d = device;
    this.objStride = Math.ceil(OBJ_BYTES / d.caps.uboAlign) * d.caps.uboAlign;
    this.frameUbo = d.createBuffer('uniform', FRAME_FLOATS * 4);
    this.shadowFrameUbo = d.createBuffer('uniform', FRAME_FLOATS * 4);
    this.white = d.createTexture({ width: 1, height: 1, data: new Uint8Array([255, 255, 255, 255]) });
    this.dummyDepth = d.createTexture({ width: 1, height: 1, format: 'depth32f', compare: true });
    this.shadowFrameBG = d.createBindGroup(FRAME_LAYOUT, [this.shadowFrameUbo, this.dummyDepth]);
    this.frameBG = d.createBindGroup(FRAME_LAYOUT, [this.frameUbo, this.dummyDepth]);
    this.hdrFormat = d.caps.halfFloatTarget ? 'rgba16f' : 'rgba8';
    this.growObjects(256);
  }

  private growObjects(cap: number) {
    if (this.objBuf) this.device.destroyBuffer(this.objBuf);
    this.objCap = cap;
    this.objBuf = this.device.createBuffer('uniform', cap * this.objStride);
    const old = this.objData;
    this.objData = new Float32Array((cap * this.objStride) / 4);
    this.objData.set(old.subarray(0, Math.min(old.length, this.objData.length)));
    this.objBG = this.device.createBindGroup(OBJ_LAYOUT, [{ buffer: this.objBuf, size: OBJ_BYTES }]);
    this.objGen++;
  }

  // ---------------------------------------------------------------- resources

  /** Upload/refresh a texture on the GPU. */
  texture(t: Texture): GpuTexture {
    if (!t.gpu || t.gpuVersion !== t.version) {
      if (t.gpu) this.device.destroyTexture(t.gpu);
      const o = t.options;
      t.gpu = this.device.createTexture({
        width: t.width, height: t.height, data: t.source, format: o.srgb === false ? 'rgba8' : 'rgba8srgb',
        mips: o.mips ?? true, wrap: o.wrap ?? 'repeat', filter: o.filter ?? 'linear',
      });
      t.gpuVersion = t.version;
    }
    return t.gpu;
  }

  private uploadGeometry(g: Geometry) {
    const d = this.device;
    for (const k in g.attributes) {
      const a = g.attributes[k];
      if (a.gpu && a.gpuVersion === a.version) continue;
      if (a.gpu && a.gpu.size >= a.data.byteLength) d.writeBuffer(a.gpu, a.data);
      else {
        if (a.gpu) d.destroyBuffer(a.gpu);
        a.gpu = d.createBuffer('vertex', a.data);
      }
      a.gpuVersion = a.version;
    }
    if (g.index && g.gpuIndexVersion !== g.indexVersion) {
      if (g.gpuIndex && g.gpuIndex.size >= g.index.byteLength) d.writeBuffer(g.gpuIndex, g.index);
      else {
        if (g.gpuIndex) d.destroyBuffer(g.gpuIndex);
        g.gpuIndex = d.createBuffer('index', g.index);
      }
      g.gpuIndexVersion = g.indexVersion;
    }
  }

  private uploadInstances(ib: InstanceBuffer) {
    if (ib.gpu && ib.gpuVersion === ib.version) return;
    const bytes = ib.count * ib.stride * 4;
    if (!ib.gpu || ib.gpuSize < ib.data.byteLength) {
      if (ib.gpu) this.device.destroyBuffer(ib.gpu);
      ib.gpu = this.device.createBuffer('vertex', ib.data.byteLength);
      ib.gpuSize = ib.data.byteLength;
    }
    if (bytes) this.device.writeBuffer(ib.gpu, ib.data, 0, bytes);
    ib.gpuVersion = ib.version;
  }

  /** Material UBO + bind group (uniforms uploaded every frame it is used). */
  materialBG(m: Material | { uniforms: Float32Array; map: Texture | null; gpu?: any }): GpuBindGroup {
    const tex = m.map ? this.texture(m.map) : this.white;
    if (!m.gpu) {
      const ubo = this.device.createBuffer('uniform', 96);
      m.gpu = { ubo, bg: this.device.createBindGroup(MAT_LAYOUT, [ubo, tex]), map: tex };
    } else if (m.gpu.map !== tex) {
      m.gpu.bg = this.device.createBindGroup(MAT_LAYOUT, [m.gpu.ubo, tex]);
      m.gpu.map = tex;
    }
    return m.gpu.bg;
  }

  // ---------------------------------------------------------------- pipelines

  private layoutFor(g: Geometry, ib: InstanceBuffer | null): VertexBufferLayout[] {
    const out: VertexBufferLayout[] = [];
    for (const k in g.attributes) {
      const loc = ATTR_LOC[k];
      if (loc === undefined) continue;
      const a = g.attributes[k];
      out.push({ stride: a.format === 'unorm8x4' ? 4 : a.size * 4, step: 'vertex', attrs: [{ loc, format: a.format, offset: 0 }] });
    }
    if (ib) {
      const attrs: VertexBufferLayout['attrs'] = [];
      let off = 0;
      for (const a of ib.attrs) {
        if (a.size === 16) for (let c = 0; c < 4; c++) attrs.push({ loc: a.loc + c, format: 'float32x4', offset: off + c * 16 });
        else attrs.push({ loc: a.loc, format: a.size === 1 ? 'float32' : (`float32x${a.size}` as any), offset: off });
        off += a.size * 4;
      }
      out.push({ stride: ib.stride * 4, step: 'instance', attrs });
    }
    return out;
  }

  /** Get (cached) pipeline for drawing a mesh in the given pass. */
  pipeline(mesh: Mesh, scene: Scene | null, kind: PassKind): GpuPipeline {
    const m = mesh.material, g = mesh.geometry, ib = mesh.instances;
    const defs: Defines = { ...m.defines, ...(ib?.defines ?? {}) };
    defs[m.type.toUpperCase()] = 1;
    if (g.attributes.normal) defs.HAS_NORMAL = 1;
    if (g.attributes.uv) defs.HAS_UV = 1;
    if (g.attributes.color) defs.HAS_COLOR = 1;
    if (m.map) defs.HAS_MAP = 1;
    const skinned = !!(mesh.skin && g.attributes.joints);
    if (skinned) { defs.SKINNED = 1; defs.MAX_JOINTS = MAX_JOINTS; }
    if (m.uniforms[20] > 0) defs.ALPHA_TEST = 1;
    let color: TexFormat | 'screen' | null = this.target ? this.hdrFormat : 'screen';
    let depth: TexFormat | 'screen' | null = this.target ? 'depth24' : 'screen';
    let cull = m.cull, blend = m.blend, depthWrite = m.depthWrite;
    if (kind === 'shadow') {
      defs.DEPTH_ONLY = 1;
      color = null;
      depth = 'depth32f';
      blend = 'opaque';
      depthWrite = true;
    } else {
      if (scene?.fog && m.fog) defs.FOG = 1;
      if (mesh.receiveShadow && m.receiveShadow && this.shadowTex && this.sun?.castShadow) defs.RECEIVE_SHADOW = 1;
      if (!this.target) defs.GAMMA_OUT = 1;
      if (kind === 'outline') { defs.OUTLINE = 1; cull = 'front'; }
    }
    const buffers = this.layoutFor(g, ib);
    const shader = typeof m.shader === 'string' ? this.device.lib[m.shader] : m.shader[this.device.kind === 'webgpu' ? 'wgsl' : 'glsl'];
    const dk = Object.keys(defs).sort().map((k) => k + '=' + defs[k]).join(',');
    const key = `${typeof m.shader === 'string' ? m.shader : shader.length}|${dk}|${JSON.stringify(buffers)}|${g.topology}|${blend}|${cull}|${depthWrite}|${m.depthTest}|${color}|${depth}`;
    let p = this.pipes.get(key);
    if (!p) {
      p = this.device.createPipeline({
        code: shader, defines: defs, groups: skinned ? SKIN_GROUPS : SCENE_GROUPS, buffers,
        topology: g.topology, cull, blend, depthWrite, depthTest: m.depthTest, color, depth,
        depthBias: kind === 'shadow' ? 1 : 0, depthBiasSlope: kind === 'shadow' ? 1.5 : 0,
      });
      this.pipes.set(key, p);
    }
    return p;
  }

  /** Cached fullscreen/custom pipeline helper for effects. */
  customPipeline(key: string, make: () => GpuPipeline) {
    let p = this.pipes.get(key);
    if (!p) { p = make(); this.pipes.set(key, p); }
    return p;
  }

  // ---------------------------------------------------------------- frame

  private allocSlot(mesh: Mesh) {
    if (this.objCount >= this.objCap) this.growObjects(this.objCap * 2);
    const slot = this.objCount++;
    const o = (slot * this.objStride) / 4, d = this.objData;
    d.set(mesh.worldMatrix, o);
    m4normal(d.subarray(o + 16, o + 32), mesh.worldMatrix);
    d.set(mesh.tint, o + 32);
    d.set(mesh.flash, o + 36);
    return slot;
  }

  private collect(node: import('../scene/node').Node, cam: Camera) {
    if (!node.visible) return;
    if (node instanceof Mesh && node.geometry && node.material) {
      const mesh = node;
      const slot = this.allocSlot(mesh);
      const g = mesh.geometry;
      const m = mesh.material;
      const b = g.bounds;
      const wm = mesh.worldMatrix;
      const c = v3transformMat4(_c, b.center, wm);
      const s = Math.max(Math.hypot(wm[0], wm[1], wm[2]), Math.hypot(wm[4], wm[5], wm[6]), Math.hypot(wm[8], wm[9], wm[10]));
      const item = { mesh, slot, z: v3dist(c, _camPos) };
      if (mesh.castShadow && m.castShadow) this.casters.push(item);
      if (!mesh.frustumCulled || mesh.instances || sphereInFrustum(cam.planes, c, b.radius * s)) {
        (m.transparent ? this.transparent : this.opaque).push(item);
        if (m.type === 'toon' && m.uniforms[19] > 0) this.outlines.push(item);
      }
    } else if (node instanceof DirectionalLight) {
      if (!this.sun) this.sun = node;
    } else if (node instanceof PointLight) this.points.push(node);
    const ch = node.children;
    for (let i = 0; i < ch.length; i++) this.collect(ch[i], cam);
  }

  private prepare(item: Item) {
    const mesh = item.mesh;
    this.uploadGeometry(mesh.geometry);
    if (mesh.instances) this.uploadInstances(mesh.instances);
    const m = mesh.material;
    if (!this.matSeen.has(m)) {
      this.matSeen.add(m);
      this.materialBG(m);
      this.device.writeBuffer(m.gpu!.ubo, m.uniforms);
    }
    if (mesh.skin && mesh.geometry.attributes.joints) {
      const sk = mesh.skin;
      sk.update(mesh.worldMatrix);
      if (!sk.gpu) sk.gpu = { ubo: this.device.createBuffer('uniform', MAX_JOINTS * 64), bg: null as any, gen: -1 };
      if (sk.gpu.gen !== this.objGen) {
        sk.gpu.bg = this.device.createBindGroup(SKIN_LAYOUT, [{ buffer: this.objBuf, size: OBJ_BYTES }, sk.gpu.ubo]);
        sk.gpu.gen = this.objGen;
      }
      this.device.writeBuffer(sk.gpu.ubo, sk.matrices);
    }
  }

  /** Issue the draw call for one mesh. */
  draw(pass: RenderPass, item: Item, pipe: GpuPipeline) {
    const mesh = item.mesh, g = mesh.geometry, ib = mesh.instances;
    const inst = ib ? ib.count : 1;
    const count = g.count;
    if (!inst || !count) return;
    pass.setPipeline(pipe);
    pass.setBindGroup(1, mesh.material.gpu!.bg);
    pass.setBindGroup(2, mesh.skin && g.attributes.joints ? mesh.skin.gpu!.bg : this.objBG, [item.slot * this.objStride]);
    let slot = 0;
    for (const k in g.attributes) if (ATTR_LOC[k] !== undefined) pass.setVertexBuffer(slot++, g.attributes[k].gpu!);
    if (ib) pass.setVertexBuffer(slot, ib.gpu!);
    if (g.index) {
      pass.setIndexBuffer(g.gpuIndex!, g.index instanceof Uint16Array ? 'uint16' : 'uint32');
      pass.drawIndexed(count, inst);
    } else pass.draw(count, inst);
    this.stats.draws++;
    this.stats.triangles += (count / 3) * inst;
  }

  private writeFrame(f: Float32Array, cam: Camera, scene: Scene, viewProj?: Float32Array) {
    f.set(viewProj ?? cam.viewProj, 0);
    f.set(cam.view, 16);
    f.set(cam.invViewProj, 32);
    f.set(this.shadowMat, 48);
    f[64] = _camPos[0]; f[65] = _camPos[1]; f[66] = _camPos[2]; f[67] = this.time;
    const a = scene.ambient;
    f.set(a.sky, 68); f[71] = a.intensity;
    f.set(a.ground, 72);
    const sun = this.sun;
    if (sun) {
      f[76] = -sun.direction[0]; f[77] = -sun.direction[1]; f[78] = -sun.direction[2]; f[79] = sun.intensity;
      f.set(sun.color, 80);
    } else f.fill(0, 76, 84);
    if (scene.fog) {
      f.set(scene.fog.color, 84);
      f[88] = scene.fog.near; f[89] = scene.fog.far; f[90] = scene.fog.density;
    }
    const sh = this.shadowTex && sun?.castShadow;
    f[92] = sh ? 1 : 0;
    if (sun) {
      f[93] = sun.shadow.bias; f[94] = sun.shadow.normalBias; f[95] = 1 / sun.shadow.size;
    }
    const pts = this.points;
    if (pts.length > MAX_POINTS) pts.sort((p, q) => v3dist(p.worldPosition(_p), _camPos) - v3dist(q.worldPosition(_p2), _camPos));
    const np = Math.min(pts.length, MAX_POINTS);
    f[96] = np; f[97] = this.device.width; f[98] = this.device.height; f[99] = scene.exposure;
    for (let i = 0; i < np; i++) {
      const p = pts[i], o = 100 + i * 8;
      p.worldPosition(_p);
      f[o] = _p[0]; f[o + 1] = _p[1]; f[o + 2] = _p[2]; f[o + 3] = p.range;
      f[o + 4] = p.color[0]; f[o + 5] = p.color[1]; f[o + 6] = p.color[2]; f[o + 7] = p.intensity;
    }
  }

  private updateShadow(cam: Camera) {
    const sun = this.sun!;
    const sz = sun.shadow.size;
    if (!this.shadowTex || this.shadowTex.width !== sz) {
      if (this.shadowTex) this.device.destroyTexture(this.shadowTex);
      this.shadowTex = this.device.createTexture({ width: sz, height: sz, format: 'depth32f', compare: true, target: true });
      this.frameBG = this.device.createBindGroup(FRAME_LAYOUT, [this.frameUbo, this.shadowTex]);
    }
    const ext = sun.shadow.extent;
    const focus = sun.shadowFocus ?? cam.worldPosition(_p);
    const dir = sun.direction;
    // rotation-only light view, then snap focus to texel grid to avoid shimmering
    m4invert(_lv, m4targetTo(_lv, [0, 0, 0], dir, Math.abs(dir[1]) > 0.99 ? [0, 0, 1] : [0, 1, 0]));
    const f = v3transformMat4(_p2, focus, _lv);
    const texel = (2 * ext) / sz;
    f[0] = Math.round(f[0] / texel) * texel;
    f[1] = Math.round(f[1] / texel) * texel;
    const depth = Math.max(ext * 3, 60);
    m4ortho(_lp, f[0] - ext, f[0] + ext, f[1] - ext, f[1] + ext, -f[2] - depth, -f[2] + depth);
    m4mul(this.shadowMat, _lp, _lv);
  }

  /** Render a scene from a camera to the screen (or post-processing chain). */
  render(scene: Scene, cam: Camera) {
    const d = this.device;
    const st = this.stats;
    st.draws = st.triangles = st.shadowDraws = 0;
    this.objCount = 0;
    this.opaque.length = this.transparent.length = this.casters.length = this.outlines.length = this.points.length = 0;
    this.sun = null;
    cam.updateProjection(d.width / d.height);
    cam.worldPosition(_camPos);

    // offscreen target for post-processing
    const post = this.post?.enabled ? this.post : null;
    if (post) {
      const t = this.target;
      if (!t || t.color.width !== d.width || t.color.height !== d.height) {
        if (t) { d.destroyTexture(t.color); d.destroyTexture(t.depth); }
        this.target = {
          color: d.createTexture({ width: d.width, height: d.height, format: this.hdrFormat, target: true }),
          depth: d.createTexture({ width: d.width, height: d.height, format: 'depth24', target: true }),
        };
      }
    } else if (this.target) {
      d.destroyTexture(this.target.color);
      d.destroyTexture(this.target.depth);
      this.target = null;
    }

    this.collect(scene, cam);
    for (const o of this.overlays) {
      if (o.geometry && o.geometry.count) this.transparent.push({ mesh: o, slot: this.allocSlot(o), z: -1e9 });
    }
    st.meshes = this.objCount;
    const shadows = !!((this.sun as DirectionalLight | null)?.castShadow && this.casters.length);
    if (shadows) this.updateShadow(cam);

    const seen = new Set<Mesh>();
    this.matSeen.clear();
    for (const list of [this.opaque, this.transparent, shadows ? this.casters : []]) {
      for (const it of list) if (!seen.has(it.mesh)) { seen.add(it.mesh); this.prepare(it); }
    }
    d.writeBuffer(this.objBuf, this.objData, 0, this.objCount * this.objStride);

    // --- shadow pass
    if (shadows) {
      this.writeFrame(this.frameData, cam, scene, this.shadowMat);
      d.writeBuffer(this.shadowFrameUbo, this.frameData);
      const pass = d.beginPass({ color: null, depth: this.shadowTex!, clearDepth: true });
      pass.setBindGroup(0, this.shadowFrameBG);
      for (const it of this.casters) this.draw(pass, it, this.pipeline(it.mesh, scene, 'shadow'));
      pass.end();
      st.shadowDraws = st.draws;
    }

    // --- main pass
    this.writeFrame(this.frameData, cam, scene);
    d.writeBuffer(this.frameUbo, this.frameData);
    const t = this.target;
    const pass = d.beginPass({
      color: t ? t.color : 'screen', depth: t ? t.depth : 'screen', clear: scene.background, clearDepth: true,
    });
    pass.setBindGroup(0, this.frameBG);
    if (scene.sky) this.drawSky(pass, scene.sky);
    this.opaque.sort((a, b) => a.mesh.renderOrder - b.mesh.renderOrder || a.mesh.material.id - b.mesh.material.id || a.z - b.z);
    for (const it of this.opaque) this.draw(pass, it, this.pipeline(it.mesh, scene, 'main'));
    for (const it of this.outlines) this.draw(pass, it, this.pipeline(it.mesh, scene, 'outline'));
    this.transparent.sort((a, b) => a.mesh.renderOrder - b.mesh.renderOrder || b.z - a.z);
    for (const it of this.transparent) this.draw(pass, it, this.pipeline(it.mesh, scene, 'main'));
    pass.end();

    if (post && t) post.render(this, t.color, t.depth);
    d.submit();
  }

  private drawSky(pass: RenderPass, u: Float32Array) {
    const d = this.device;
    if (!this.skyUbo) {
      this.skyUbo = d.createBuffer('uniform', 96);
      this.skyBG = d.createBindGroup(MAT_LAYOUT, [this.skyUbo, this.white]);
    }
    d.writeBuffer(this.skyUbo, u);
    const color = this.target ? this.hdrFormat : 'screen';
    const depth = this.target ? 'depth24' : 'screen';
    const p = this.customPipeline('sky|' + color, () => d.createPipeline({
      code: d.lib.sky, defines: this.target ? {} : { GAMMA_OUT: 1 }, groups: [FRAME_LAYOUT, MAT_LAYOUT], buffers: [],
      cull: 'none', depthTest: false, depthWrite: false, color, depth: depth as any,
    }));
    pass.setPipeline(p);
    pass.setBindGroup(1, this.skyBG!);
    pass.draw(3);
  }
}

const _c = v3(), _p = v3(), _p2 = v3(), _camPos = v3();
const _lv = m4(), _lp = m4();
