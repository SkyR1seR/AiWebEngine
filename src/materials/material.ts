import { color, type ColorLike } from '../core/math';
import type { Blend, Cull, GpuBindGroup, GpuBuffer } from '../gpu/device';
import type { Defines } from '../gpu/preprocess';
import type { Texture } from '../render/texture';

export type ShaderRef = string | { wgsl: string; glsl: string };
export type Lighting = 'unlit' | 'lambert' | 'toon' | 'standard';

export interface MaterialOptions {
  /** Lighting model (default 'lambert'). */
  type?: Lighting;
  color?: ColorLike;
  opacity?: number;
  map?: Texture | null;
  emissive?: ColorLike;
  emissiveIntensity?: number;
  /** standard */
  metalness?: number;
  roughness?: number;
  /** toon: number of light bands (default 2) */
  steps?: number;
  /** toon: rim light */
  rim?: ColorLike;
  rimStrength?: number;
  /** toon: 0..1, higher = thinner rim (default 0.6) */
  rimThreshold?: number;
  /** toon: specular highlight strength (default 0) */
  specular?: number;
  /** inverted-hull outline (world-space width) */
  outline?: { color?: ColorLike; width?: number };
  /** use per-vertex colors (default: auto if geometry has them) */
  blend?: Blend;
  cull?: Cull;
  depthWrite?: boolean;
  depthTest?: boolean;
  alphaTest?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
  fog?: boolean;
  shader?: ShaderRef;
  defines?: Defines;
}

let matId = 0;

/**
 * Surface material. Uniform layout (6 x vec4):
 * color | emissive(rgb,intensity) | params(metal,rough,steps,rimThreshold) | rim(rgb,strength) | outline(rgb,width) | extra(alphaCutoff,specular,-,-)
 */
export class Material {
  readonly id = matId++;
  name = '';
  type: Lighting;
  shader: ShaderRef;
  defines: Defines;
  uniforms = new Float32Array(24);
  map: Texture | null;
  blend: Blend;
  cull: Cull;
  depthWrite: boolean;
  depthTest: boolean;
  castShadow: boolean;
  receiveShadow: boolean;
  fog: boolean;
  /** @internal */ gpu?: { ubo: GpuBuffer; bg: GpuBindGroup; map: any };

  constructor(o: MaterialOptions = {}) {
    this.type = o.type ?? 'lambert';
    this.shader = o.shader ?? 'lit';
    this.defines = o.defines ?? {};
    this.map = o.map ?? null;
    this.blend = o.blend ?? ((o.opacity ?? 1) < 1 ? 'alpha' : 'opaque');
    this.cull = o.cull ?? 'back';
    this.depthWrite = o.depthWrite ?? this.blend === 'opaque';
    this.depthTest = o.depthTest ?? true;
    this.castShadow = o.castShadow ?? this.blend === 'opaque';
    this.receiveShadow = o.receiveShadow ?? true;
    this.fog = o.fog ?? true;
    const u = this.uniforms;
    color(o.color ?? 0xffffff, o.opacity ?? 1, u.subarray(0, 4));
    color(o.emissive ?? 0xffffff, 1, u.subarray(4, 8));
    u[7] = o.emissiveIntensity ?? (o.emissive !== undefined ? 1 : 0);
    u[8] = o.metalness ?? 0;
    u[9] = o.roughness ?? 0.6;
    u[10] = o.steps ?? 2;
    u[11] = o.rimThreshold ?? 0.6;
    color(o.rim ?? 0xffffff, 1, u.subarray(12, 16));
    u[15] = o.rimStrength ?? (o.rim !== undefined ? 0.5 : 0);
    color(o.outline?.color ?? 0x000000, 1, u.subarray(16, 20));
    u[19] = o.outline ? o.outline.width ?? 0.03 : 0;
    u[20] = o.alphaTest ?? 0;
    u[21] = o.specular ?? 0;
  }

  /** Base color as linear RGBA view (mutable). */
  get color() { return this.uniforms.subarray(0, 4); }
  setColor(c: ColorLike) { const a = this.uniforms[3]; color(c, a, this.uniforms.subarray(0, 4)); return this; }
  get opacity() { return this.uniforms[3]; }
  set opacity(v: number) { this.uniforms[3] = v; }
  setEmissive(c: ColorLike, intensity = 1) { color(c, intensity, this.uniforms.subarray(4, 8)); this.uniforms[7] = intensity; return this; }
  get emissiveIntensity() { return this.uniforms[7]; }
  set emissiveIntensity(v: number) { this.uniforms[7] = v; }
  get outlineWidth() { return this.uniforms[19]; }
  set outlineWidth(v: number) { this.uniforms[19] = v; }
  get transparent() { return this.blend !== 'opaque'; }

  clone(): Material {
    const m = Object.create(Material.prototype) as Material;
    Object.assign(m, this);
    (m as any).id = matId++;
    m.uniforms = this.uniforms.slice();
    m.defines = { ...this.defines };
    m.gpu = undefined;
    return m;
  }
}

// Shorthand factories
export const lambert = (c: ColorLike = 0xffffff, o: MaterialOptions = {}) => new Material({ ...o, type: 'lambert', color: c });
export const unlit = (c: ColorLike = 0xffffff, o: MaterialOptions = {}) => new Material({ ...o, type: 'unlit', color: c });
export const toon = (c: ColorLike = 0xffffff, o: MaterialOptions = {}) => new Material({ ...o, type: 'toon', color: c });
export const standard = (c: ColorLike = 0xffffff, o: MaterialOptions = {}) => new Material({ ...o, type: 'standard', color: c });
