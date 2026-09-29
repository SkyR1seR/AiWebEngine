import type { BindLayout, Device, GpuBindGroup, GpuBuffer, GpuTexture, TexFormat, Blend } from '../gpu/device';
import type { Renderer, PostProcess } from '../render/renderer';

const WGSL = /* wgsl */ `
struct P { a: vec4f, b: vec4f, c: vec4f, d: vec4f }
@group(0) @binding(0) var<uniform> U: P;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var srcS: sampler;
@group(0) @binding(3) var bloomTex: texture_2d<f32>;
@group(0) @binding(4) var bloomS: sampler;
struct VO { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
@vertex fn vs_main(@builtin(vertex_index) i: u32) -> VO {
  let uv = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var o: VO;
  o.pos = vec4f(uv * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2f(uv.x, 1.0 - uv.y);
  return o;
}
fn tx(uv: vec2f) -> vec3f { return textureSampleLevel(src, srcS, uv, 0.0).rgb; }
fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.299, 0.587, 0.114)); }
fn aces(x: vec3f) -> vec3f { return clamp(x * (2.51 * x + 0.03) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0)); }
@fragment fn fs_main(i: VO) -> @location(0) vec4f {
  let t = U.a.xy;
  let uv = i.uv;
#if PREFILTER
  var c = (tx(uv + t * vec2f(-1.0, -1.0)) + tx(uv + t * vec2f(1.0, -1.0)) + tx(uv + t * vec2f(-1.0, 1.0)) + tx(uv + t * vec2f(1.0, 1.0))) * 0.25;
  let br = max(c.r, max(c.g, c.b));
  let th = U.a.z;
  let knee = th * 0.5 + 1e-4;
  var s = clamp(br - th + knee, 0.0, 2.0 * knee);
  s = s * s / (4.0 * knee);
  c *= max(s, br - th) / max(br, 1e-4);
  return vec4f(min(c, vec3f(32.0)), 1.0);
#elif DOWN
  let c = tx(uv) * 0.5 + (tx(uv + t * vec2f(-1.0, -1.0)) + tx(uv + t * vec2f(1.0, -1.0)) + tx(uv + t * vec2f(-1.0, 1.0)) + tx(uv + t * vec2f(1.0, 1.0))) * 0.125;
  return vec4f(c, 1.0);
#elif UP
  var c = tx(uv) * 4.0;
  c += (tx(uv + t * vec2f(-1.0, 0.0)) + tx(uv + t * vec2f(1.0, 0.0)) + tx(uv + t * vec2f(0.0, -1.0)) + tx(uv + t * vec2f(0.0, 1.0))) * 2.0;
  c += tx(uv + t * vec2f(-1.0, -1.0)) + tx(uv + t * vec2f(1.0, -1.0)) + tx(uv + t * vec2f(-1.0, 1.0)) + tx(uv + t * vec2f(1.0, 1.0));
  return vec4f(c / 16.0 * U.a.w, 1.0);
#elif COMPOSITE
  var c = tx(uv) + textureSampleLevel(bloomTex, bloomS, uv, 0.0).rgb * U.a.z;
  c *= U.b.x;
  if (U.b.y > 0.5) { c = aces(c); }
  c = pow(clamp(c, vec3f(0.0), vec3f(1.0)), vec3f(1.0 / 2.2));
  c = (c - 0.5) * U.b.z + 0.5;
  c = mix(vec3f(luma(c)), c, U.b.w);
  let d = length(uv - 0.5) * 1.414;
  c *= 1.0 - U.c.x * smoothstep(1.0 - U.c.y, 1.0, d);
  c = mix(c, U.d.rgb, U.d.a);
  return vec4f(clamp(c, vec3f(0.0), vec3f(1.0)), 1.0);
#elif FXAA
  let nw = tx(uv + t * vec2f(-1.0, -1.0)); let ne = tx(uv + t * vec2f(1.0, -1.0));
  let sw = tx(uv + t * vec2f(-1.0, 1.0)); let se = tx(uv + t * vec2f(1.0, 1.0));
  let m = tx(uv);
  let lnw = luma(nw); let lne = luma(ne); let lsw = luma(sw); let lse = luma(se); let lm = luma(m);
  let lmin = min(lm, min(min(lnw, lne), min(lsw, lse)));
  let lmax = max(lm, max(max(lnw, lne), max(lsw, lse)));
  var dir = vec2f(-((lnw + lne) - (lsw + lse)), (lnw + lsw) - (lne + lse));
  let red = max((lnw + lne + lsw + lse) * 0.03125, 0.0078125);
  let rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + red);
  dir = clamp(dir * rcp, vec2f(-8.0), vec2f(8.0)) * t;
  let a = 0.5 * (tx(uv + dir * (1.0 / 3.0 - 0.5)) + tx(uv + dir * (2.0 / 3.0 - 0.5)));
  let b = a * 0.5 + 0.25 * (tx(uv - dir * 0.5) + tx(uv + dir * 0.5));
  let lb = luma(b);
  if (lb < lmin || lb > lmax) { return vec4f(a, 1.0); }
  return vec4f(b, 1.0);
#else
  return vec4f(tx(uv), 1.0);
#endif
}`;

const GLSL = /* glsl */ `
layout(std140) uniform Post { vec4 a; vec4 b; vec4 c; vec4 d; } U;
uniform sampler2D src;
uniform sampler2D bloomTex;
#if VERTEX
out vec2 vUv;
void main() {
  vec2 uv = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = uv;
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}
#endif
#if FRAGMENT
in vec2 vUv;
out vec4 outColor;
vec3 tx(vec2 uv) { return textureLod(src, uv, 0.0).rgb; }
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec3 aces(vec3 x) { return clamp(x * (2.51 * x + 0.03) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
void main() {
  vec2 t = U.a.xy;
  vec2 uv = vUv;
#if PREFILTER
  vec3 c = (tx(uv + t * vec2(-1, -1)) + tx(uv + t * vec2(1, -1)) + tx(uv + t * vec2(-1, 1)) + tx(uv + t * vec2(1, 1))) * 0.25;
  float br = max(c.r, max(c.g, c.b));
  float th = U.a.z, knee = th * 0.5 + 1e-4;
  float s = clamp(br - th + knee, 0.0, 2.0 * knee);
  s = s * s / (4.0 * knee);
  c *= max(s, br - th) / max(br, 1e-4);
  outColor = vec4(min(c, vec3(32.0)), 1.0);
#elif DOWN
  vec3 c = tx(uv) * 0.5 + (tx(uv + t * vec2(-1, -1)) + tx(uv + t * vec2(1, -1)) + tx(uv + t * vec2(-1, 1)) + tx(uv + t * vec2(1, 1))) * 0.125;
  outColor = vec4(c, 1.0);
#elif UP
  vec3 c = tx(uv) * 4.0;
  c += (tx(uv + t * vec2(-1, 0)) + tx(uv + t * vec2(1, 0)) + tx(uv + t * vec2(0, -1)) + tx(uv + t * vec2(0, 1))) * 2.0;
  c += tx(uv + t * vec2(-1, -1)) + tx(uv + t * vec2(1, -1)) + tx(uv + t * vec2(-1, 1)) + tx(uv + t * vec2(1, 1));
  outColor = vec4(c / 16.0 * U.a.w, 1.0);
#elif COMPOSITE
  vec3 c = tx(uv) + textureLod(bloomTex, uv, 0.0).rgb * U.a.z;
  c *= U.b.x;
  if (U.b.y > 0.5) c = aces(c);
  c = pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));
  c = (c - 0.5) * U.b.z + 0.5;
  c = mix(vec3(luma(c)), c, U.b.w);
  float d = length(uv - 0.5) * 1.414;
  c *= 1.0 - U.c.x * smoothstep(1.0 - U.c.y, 1.0, d);
  c = mix(c, U.d.rgb, U.d.a);
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
#elif FXAA
  vec3 nw = tx(uv + t * vec2(-1, -1)), ne = tx(uv + t * vec2(1, -1)), sw = tx(uv + t * vec2(-1, 1)), se = tx(uv + t * vec2(1, 1)), m = tx(uv);
  float lnw = luma(nw), lne = luma(ne), lsw = luma(sw), lse = luma(se), lm = luma(m);
  float lmin = min(lm, min(min(lnw, lne), min(lsw, lse)));
  float lmax = max(lm, max(max(lnw, lne), max(lsw, lse)));
  vec2 dir = vec2(-((lnw + lne) - (lsw + lse)), (lnw + lsw) - (lne + lse));
  float red = max((lnw + lne + lsw + lse) * 0.03125, 0.0078125);
  float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + red);
  dir = clamp(dir * rcp, vec2(-8.0), vec2(8.0)) * t;
  vec3 a = 0.5 * (tx(uv + dir * (1.0 / 3.0 - 0.5)) + tx(uv + dir * (2.0 / 3.0 - 0.5)));
  vec3 b = a * 0.5 + 0.25 * (tx(uv - dir * 0.5) + tx(uv + dir * 0.5));
  float lb = luma(b);
  outColor = vec4((lb < lmin || lb > lmax) ? a : b, 1.0);
#else
  outColor = vec4(tx(uv), 1.0);
#endif
}
#endif`;

const LAYOUT: BindLayout = { entries: [{ name: 'Post', kind: 'ubo' }, { name: 'src', kind: 'tex' }, { name: 'bloomTex', kind: 'tex' }] };

export interface BloomOptions {
  enabled?: boolean;
  /** brightness above which pixels bloom (linear HDR; default 0.9) */
  threshold?: number;
  intensity?: number;
  /** spread multiplier per level (default 0.85) */
  radius?: number;
  /** mip levels (default 5) */
  levels?: number;
}

export interface PostOptions {
  bloom?: boolean | BloomOptions;
  /** 'aces' filmic tonemapping or 'none' (default 'aces') */
  tonemap?: 'aces' | 'none';
  exposure?: number;
  contrast?: number;
  saturation?: number;
  /** vignette strength 0..1 (default 0.25) */
  vignette?: number;
  vignetteSoftness?: number;
  fxaa?: boolean;
}

/** Post-processing chain: bloom → exposure/tonemap/grade/vignette/fade → FXAA. `game.renderer.post = new PostFX()` */
export class PostFX implements PostProcess {
  enabled = true;
  bloom: Required<BloomOptions>;
  tonemap: 'aces' | 'none';
  exposure: number;
  contrast: number;
  saturation: number;
  vignette: number;
  vignetteSoftness: number;
  fxaa: boolean;
  /** full-screen color overlay (rgb, a = amount) — use for fades and damage flashes */
  fade = new Float32Array(4);
  private d: Device | null = null;
  private chain: GpuTexture[] = [];
  private ldr: GpuTexture | null = null;
  private black: GpuTexture | null = null;
  private ubos: GpuBuffer[] = [];
  private bgs = new Map<number, { bg: GpuBindGroup; src: GpuTexture; b2: GpuTexture }>();
  private size = '';
  private u = new Float32Array(16);

  constructor(o: PostOptions = {}) {
    const b = typeof o.bloom === 'object' ? o.bloom : { enabled: o.bloom ?? true };
    this.bloom = { enabled: true, threshold: 0.9, intensity: 0.6, radius: 0.85, levels: 5, ...b };
    this.tonemap = o.tonemap ?? 'aces';
    this.exposure = o.exposure ?? 1;
    this.contrast = o.contrast ?? 1;
    this.saturation = o.saturation ?? 1;
    this.vignette = o.vignette ?? 0.25;
    this.vignetteSoftness = o.vignetteSoftness ?? 0.6;
    this.fxaa = o.fxaa ?? true;
  }

  private ensure(r: Renderer) {
    const d = (this.d = r.device);
    const key = `${d.width}x${d.height}:${this.bloom.levels}:${this.fxaa}`;
    if (key === this.size) return;
    this.size = key;
    for (const t of this.chain) d.destroyTexture(t);
    if (this.ldr) d.destroyTexture(this.ldr);
    this.bgs.clear();
    this.chain = [];
    let w = d.width, h = d.height;
    for (let i = 0; i < this.bloom.levels; i++) {
      w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
      this.chain.push(d.createTexture({ width: w, height: h, format: r.hdrFormat, target: true }));
    }
    this.ldr = this.fxaa ? d.createTexture({ width: d.width, height: d.height, format: 'rgba8', target: true }) : null;
    this.black ??= d.createTexture({ width: 1, height: 1, data: new Uint8Array(4) });
  }

  private pass(r: Renderer, idx: number, def: string, src: GpuTexture, dst: GpuTexture | 'screen', blend: Blend, fill: (u: Float32Array) => void, bloom?: GpuTexture) {
    const d = this.d!;
    while (this.ubos.length <= idx) this.ubos.push(d.createBuffer('uniform', 64));
    const u = this.u;
    u.fill(0);
    fill(u);
    d.writeBuffer(this.ubos[idx], u);
    const b2 = bloom ?? this.black!;
    let e = this.bgs.get(idx);
    if (!e || e.src !== src || e.b2 !== b2) { e = { bg: d.createBindGroup(LAYOUT, [this.ubos[idx], src, b2]), src, b2 }; this.bgs.set(idx, e); }
    const bg = e.bg;
    const fmt: TexFormat | 'screen' = dst === 'screen' ? 'screen' : dst.format;
    const pipe = r.customPipeline(`post|${def}|${fmt}|${blend}`, () => d.createPipeline({
      code: d.kind === 'webgpu' ? WGSL : GLSL, defines: def ? { [def]: 1 } : {}, groups: [LAYOUT], buffers: [],
      cull: 'none', depthTest: false, depthWrite: false, blend, color: fmt, depth: null,
    }));
    const p = d.beginPass({ color: dst, depth: null, clear: blend === 'opaque' ? [0, 0, 0, 1] : null });
    p.setPipeline(pipe);
    p.setBindGroup(0, bg);
    p.draw(3);
    p.end();
  }

  render(r: Renderer, color: GpuTexture) {
    this.ensure(r);
    const d = this.d!, b = this.bloom, ch = this.chain;
    let k = 0;
    const useBloom = b.enabled && b.intensity > 0 && ch.length > 0;
    if (useBloom) {
      this.pass(r, k++, 'PREFILTER', color, ch[0], 'opaque', (u) => { u[0] = 1 / color.width; u[1] = 1 / color.height; u[2] = b.threshold; });
      for (let i = 1; i < ch.length; i++) {
        const s = ch[i - 1];
        this.pass(r, k++, 'DOWN', s, ch[i], 'opaque', (u) => { u[0] = 1 / s.width; u[1] = 1 / s.height; });
      }
      for (let i = ch.length - 1; i > 0; i--) {
        const s = ch[i];
        this.pass(r, k++, 'UP', s, ch[i - 1], 'add', (u) => { u[0] = 1 / s.width; u[1] = 1 / s.height; u[3] = b.radius; });
      }
    }
    const target = this.fxaa ? this.ldr! : 'screen';
    this.pass(r, k++, 'COMPOSITE', color, target, 'opaque', (u) => {
      u[2] = useBloom ? b.intensity : 0;
      u[4] = this.exposure; u[5] = this.tonemap === 'aces' ? 1 : 0; u[6] = this.contrast; u[7] = this.saturation;
      u[8] = this.vignette; u[9] = this.vignetteSoftness;
      u.set(this.fade, 12);
    }, useBloom ? ch[0] : undefined);
    if (this.fxaa) this.pass(r, k++, 'FXAA', this.ldr!, 'screen', 'opaque', (u) => { u[0] = 1 / d.width; u[1] = 1 / d.height; });
  }
}
