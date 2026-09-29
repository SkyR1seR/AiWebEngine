import { Node } from '../scene/node';
import { Mesh } from '../scene/mesh';
import { Geometry } from '../geometry/geometry';
import { Material, type Lighting, type MaterialOptions } from '../materials/material';
import { Texture } from '../render/texture';
import { Skin } from '../anim/skin';
import { AnimationClip, Animator, type Track } from '../anim/animator';
import { m4decompose } from '../core/math';
import { Model } from '../scene/model';
export { Model };

export interface GLTFOptions {
  /** Lighting model for imported materials (default 'standard'). Or a function to build materials. */
  material?: Lighting | ((o: MaterialOptions, src: any) => Material);
  /** Extra options merged into every material (e.g. outline for toon). */
  materialOptions?: MaterialOptions;
  castShadow?: boolean;
  receiveShadow?: boolean;
}

/** Loaded glTF asset. Call `instantiate()` for each copy placed in the scene (GPU data is shared). */
export class GLTFAsset {
  constructor(public template: Node, public nodes: Node[], public clips: AnimationClip[]) {}

  instantiate(): Model {
    const map = new Map<Node, Node>();
    const model = new Model(this.template.name);
    for (const c of this.template.children) model.add(cloneTree(c, map));
    model.nodes = this.nodes.map((n) => map.get(n)!);
    model.traverse((n) => {
      if (n instanceof Mesh) {
        model.meshes.push(n);
        if (n.skin) n.skin = n.skin.remap(map);
      }
    });
    if (this.clips.length) {
      model.animator = new Animator(model, this.clips, model.nodes);
      model.addScript(model.animator);
    }
    return model;
  }
}

function cloneTree(n: Node, map: Map<Node, Node>): Node {
  const c = n instanceof Mesh ? new Mesh(n.geometry, n.material) : new Node();
  (c as any).copyFrom(n);
  map.set(n, c);
  for (const ch of n.children) c.add(cloneTree(ch, map));
  return c;
}

const cache = new Map<string, Promise<GLTFAsset>>();

/** Load a .glb or .gltf file. Cached per URL. */
export function loadGLTF(url: string, opts: GLTFOptions = {}): Promise<GLTFAsset> {
  const key = url + JSON.stringify({ ...opts, material: typeof opts.material === 'function' ? 'fn' : opts.material });
  let p = cache.get(key);
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`Failed to load ${url}: ${r.status}`);
      return r.arrayBuffer();
    }).then((buf) => parseGLTF(buf, url, opts));
    cache.set(key, p);
  }
  return p;
}

const COMP: Record<number, [any, number]> = {
  5120: [Int8Array, 127], 5121: [Uint8Array, 255], 5122: [Int16Array, 32767], 5123: [Uint16Array, 65535], 5125: [Uint32Array, 0], 5126: [Float32Array, 0],
};
const SIZE: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const WRAP: Record<number, 'repeat' | 'clamp' | 'mirror'> = { 10497: 'repeat', 33071: 'clamp', 33648: 'mirror' };

export async function parseGLTF(data: ArrayBuffer, baseUrl = '', opts: GLTFOptions = {}): Promise<GLTFAsset> {
  let json: any;
  let bin: ArrayBuffer | null = null;
  const dv = new DataView(data);
  if (dv.getUint32(0, true) === 0x46546c67) {
    let off = 12;
    while (off < data.byteLength) {
      const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
      const chunk = data.slice(off + 8, off + 8 + len);
      if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
      else if (type === 0x004e4942) bin = chunk;
      off += 8 + len;
    }
  } else json = JSON.parse(new TextDecoder().decode(data));

  const base = baseUrl.slice(0, baseUrl.lastIndexOf('/') + 1);
  const resolve = (u: string) => (/^(data:|blob:|https?:|\/)/.test(u) ? u : base + u);
  const buffers: ArrayBuffer[] = await Promise.all(
    (json.buffers ?? []).map((b: any, i: number) => (b.uri ? fetch(resolve(b.uri)).then((r) => r.arrayBuffer()) : Promise.resolve(i === 0 ? bin! : new ArrayBuffer(0)))),
  );
  const view = (i: number) => {
    const bv = json.bufferViews[i];
    return { buf: buffers[bv.buffer], off: bv.byteOffset ?? 0, len: bv.byteLength, stride: bv.byteStride ?? 0 };
  };

  /** Read accessor; returns typed array of raw component type (or Float32 if normalized/float). */
  const accessor = (i: number, asFloat = true): { data: any; size: number } => {
    const a = json.accessors[i];
    const size = SIZE[a.type];
    const [Ctor, max] = COMP[a.componentType];
    const n = a.count * size;
    let raw: any;
    if (a.bufferView === undefined) raw = new Ctor(n);
    else {
      const v = view(a.bufferView);
      const off = v.off + (a.byteOffset ?? 0);
      const esz = Ctor.BYTES_PER_ELEMENT;
      if (!v.stride || v.stride === esz * size) {
        raw = off % esz === 0 ? new Ctor(v.buf, off, n) : new Ctor(v.buf.slice(off, off + n * esz));
      } else {
        raw = new Ctor(n);
        const src = new DataView(v.buf);
        const get = { 1: Ctor === Int8Array ? 'getInt8' : 'getUint8', 2: Ctor === Int16Array ? 'getInt16' : 'getUint16', 4: Ctor === Float32Array ? 'getFloat32' : 'getUint32' }[esz as 1 | 2 | 4] as 'getUint8';
        for (let e = 0; e < a.count; e++) for (let c = 0; c < size; c++) raw[e * size + c] = (src[get] as any)(off + e * v.stride + c * esz, true);
      }
    }
    if (a.sparse) console.warn('glTF: sparse accessors are not supported');
    if (!asFloat || Ctor === Float32Array) return { data: Ctor === Float32Array ? new Float32Array(raw) : raw, size };
    const f = new Float32Array(n);
    const norm = a.normalized && max;
    for (let k = 0; k < n; k++) f[k] = norm ? Math.max(raw[k] / max, -1) : raw[k];
    return { data: f, size };
  };

  // --- textures
  const images: Promise<ImageBitmap>[] = (json.images ?? []).map(async (im: any) => {
    let blob: Blob;
    if (im.bufferView !== undefined) {
      const v = view(im.bufferView);
      blob = new Blob([new Uint8Array(v.buf, v.off, v.len)], { type: im.mimeType });
    } else blob = await (await fetch(resolve(im.uri))).blob();
    return createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  });
  const texCache = new Map<string, Promise<Texture>>();
  const texture = (i: number, srgb: boolean) => {
    const k = i + ':' + srgb;
    let t = texCache.get(k);
    if (!t) {
      const tx = json.textures[i];
      const src = tx.extensions?.EXT_texture_webp?.source ?? tx.extensions?.EXT_texture_avif?.source ?? tx.source;
      const s = json.samplers?.[tx.sampler] ?? {};
      t = images[src].then((img) => new Texture(img, img.width, img.height, {
        srgb, mips: true, wrap: WRAP[s.wrapS ?? 10497], filter: s.magFilter === 9728 ? 'nearest' : 'linear',
      }));
      texCache.set(k, t);
    }
    return t;
  };

  // --- materials
  const materials: Promise<Material>[] = (json.materials ?? []).map(async (m: any) => {
    const pbr = m.pbrMetallicRoughness ?? {};
    const unlitExt = !!m.extensions?.KHR_materials_unlit;
    const blend = m.alphaMode === 'BLEND';
    const mo: MaterialOptions = {
      type: unlitExt ? 'unlit' : typeof opts.material === 'string' ? opts.material : 'standard',
      map: pbr.baseColorTexture ? await texture(pbr.baseColorTexture.index, true) : null,
      metalness: pbr.metallicFactor ?? 1,
      roughness: pbr.roughnessFactor ?? 1,
      blend: blend ? 'alpha' : 'opaque',
      cull: m.doubleSided ? 'none' : 'back',
      alphaTest: m.alphaMode === 'MASK' ? m.alphaCutoff ?? 0.5 : 0,
      ...opts.materialOptions,
    };
    const mat = typeof opts.material === 'function' ? opts.material(mo, m) : new Material(mo);
    // glTF factors are already linear
    if (pbr.baseColorFactor) mat.uniforms.set(pbr.baseColorFactor, 0);
    if (m.emissiveFactor && m.emissiveFactor.some((x: number) => x > 0)) {
      mat.uniforms.set(m.emissiveFactor, 4);
      mat.uniforms[7] = m.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1;
    }
    mat.name = m.name ?? '';
    return mat;
  });
  const defaultMat = new Material({ type: typeof opts.material === 'string' ? opts.material : 'standard', ...opts.materialOptions });

  // --- meshes (array of primitives)
  const meshes = await Promise.all((json.meshes ?? []).map(async (m: any) => Promise.all(m.primitives.map(async (p: any) => {
    const g = new Geometry();
    const at = p.attributes;
    const set = (name: string, key: string) => { if (at[key] !== undefined) { const a = accessor(at[key]); g.setAttribute(name, a.data, a.size); } };
    set('position', 'POSITION');
    set('normal', 'NORMAL');
    set('uv', 'TEXCOORD_0');
    set('color', 'COLOR_0');
    set('joints', 'JOINTS_0');
    set('weights', 'WEIGHTS_0');
    if (p.indices !== undefined) {
      const ix = accessor(p.indices, false).data;
      g.setIndex(ix instanceof Uint32Array ? ix : new Uint16Array(ix));
    }
    if (p.mode === 1) g.topology = 'lines';
    if (!g.attributes.normal && g.topology === 'triangles') g.flatShade();
    return { g, mat: p.material !== undefined ? await materials[p.material] : defaultMat };
  }))));

  // --- nodes
  const nodes: Node[] = (json.nodes ?? []).map((n: any, i: number) => {
    const prims = n.mesh !== undefined ? meshes[n.mesh] : null;
    const node = prims && prims.length === 1 ? new Mesh(prims[0].g, prims[0].mat) : new Node();
    node.name = n.name ?? (prims ? json.meshes[n.mesh].name : '') ?? 'node' + i;
    if (n.matrix) m4decompose(n.matrix, node.position, node.rotation, node.scale);
    if (n.translation) node.position.set(n.translation);
    if (n.rotation) node.rotation.set(n.rotation);
    if (n.scale) node.scale.set(n.scale);
    if (prims && prims.length > 1) for (const p of prims) node.add(new Mesh(p.g, p.mat));
    return node;
  });
  (json.nodes ?? []).forEach((n: any, i: number) => { for (const c of n.children ?? []) nodes[i].add(nodes[c]); });

  // --- skins
  (json.nodes ?? []).forEach((n: any, i: number) => {
    if (n.skin === undefined) return;
    const s = json.skins[n.skin];
    const ibm = s.inverseBindMatrices !== undefined ? accessor(s.inverseBindMatrices).data : identityMats(s.joints.length);
    const skin = new Skin(s.joints.map((j: number) => nodes[j]), ibm);
    nodes[i].traverse((m) => {
      if (m instanceof Mesh && (m === nodes[i] || m.parent === nodes[i])) { m.skin = skin; m.frustumCulled = false; }
    });
  });

  // --- animations
  const paths: Record<string, Track['path']> = { translation: 'position', rotation: 'rotation', scale: 'scale' };
  const clips = (json.animations ?? []).map((an: any, ai: number) => {
    const tracks: Track[] = [];
    for (const ch of an.channels) {
      const path = paths[ch.target.path];
      if (!path || ch.target.node === undefined) continue;
      const s = an.samplers[ch.sampler];
      tracks.push({ target: ch.target.node, path, times: accessor(s.input).data, values: accessor(s.output).data, interp: s.interpolation ?? 'LINEAR' });
    }
    return new AnimationClip(an.name ?? 'anim' + ai, tracks);
  });

  const root = new Node('gltf');
  const sc = json.scenes?.[json.scene ?? 0];
  const top: number[] = sc ? sc.nodes : nodes.map((_, i) => i).filter((i) => !nodes[i].parent);
  for (const i of top) root.add(nodes[i]);
  root.traverse((m) => {
    if (m instanceof Mesh) {
      m.castShadow = opts.castShadow ?? true;
      m.receiveShadow = opts.receiveShadow ?? true;
    }
  });
  return new GLTFAsset(root, nodes, clips);
}

function identityMats(n: number) {
  const a = new Float32Array(n * 16);
  for (let i = 0; i < n; i++) a[i * 16] = a[i * 16 + 5] = a[i * 16 + 10] = a[i * 16 + 15] = 1;
  return a;
}
