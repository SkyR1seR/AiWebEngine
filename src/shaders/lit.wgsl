// Universal surface shader. Lighting model: UNLIT | LAMBERT | TOON | STANDARD (default lambert).
struct Material { color: vec4f, emissive: vec4f, params: vec4f, rim: vec4f, outline: vec4f, extra: vec4f }
struct Object { model: mat4x4f, normal: mat4x4f, tint: vec4f, flash: vec4f }

@group(1) @binding(0) var<uniform> M: Material;
@group(1) @binding(1) var map: texture_2d<f32>;
@group(1) @binding(2) var mapSampler: sampler;
@group(2) @binding(0) var<uniform> O: Object;
#if SKINNED
@group(2) @binding(1) var<uniform> J: array<mat4x4f, {{MAX_JOINTS}}>;
#endif

struct VIn {
  @location(0) pos: vec3f,
#if HAS_NORMAL
  @location(1) normal: vec3f,
#endif
#if HAS_UV
  @location(2) uv: vec2f,
#endif
#if HAS_COLOR
  @location(3) color: vec4f,
#endif
#if SKINNED
  @location(4) joints: vec4f,
  @location(5) weights: vec4f,
#endif
#if INSTANCED
  @location(6) i0: vec4f,
  @location(7) i1: vec4f,
  @location(8) i2: vec4f,
  @location(9) i3: vec4f,
#endif
#if INSTANCE_COLOR
  @location(10) icolor: vec4f,
#endif
}

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
  @location(3) color: vec4f,
}

@vertex fn vs_main(v: VIn) -> VOut {
  var o: VOut;
  var model = O.model;
#if INSTANCED
  model = model * mat4x4f(v.i0, v.i1, v.i2, v.i3);
#endif
  var p = vec4f(v.pos, 1.0);
  var n = vec3f(0.0, 1.0, 0.0);
#if HAS_NORMAL
  n = v.normal;
#endif
#if SKINNED
  let sk = J[u32(v.joints.x)] * v.weights.x + J[u32(v.joints.y)] * v.weights.y + J[u32(v.joints.z)] * v.weights.z + J[u32(v.joints.w)] * v.weights.w;
  p = sk * p;
  n = (sk * vec4f(n, 0.0)).xyz;
#endif
  var w = (model * p).xyz;
#if INSTANCED
  let wn = normalize((model * vec4f(n, 0.0)).xyz);
#else
  let wn = normalize((O.normal * vec4f(n, 0.0)).xyz);
#endif
#if OUTLINE
  w += wn * M.outline.w;
#endif
  o.world = w;
  o.normal = wn;
  o.pos = F.viewProj * vec4f(w, 1.0);
  o.uv = vec2f(0.0);
#if HAS_UV
  o.uv = v.uv;
#endif
  o.color = vec4f(1.0);
#if HAS_COLOR
  o.color = v.color;
#endif
#if INSTANCE_COLOR
  o.color *= v.icolor;
#endif
  return o;
}

fn shadow(wp: vec3f, n: vec3f) -> f32 {
  if (F.shadowParams.x < 0.5) { return 1.0; }
  let sp = F.shadowMat * vec4f(wp + n * F.shadowParams.z, 1.0);
  let ndc = sp.xyz / sp.w;
  let uv = ndc.xy * vec2f(0.5, -0.5) + 0.5;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0 || ndc.z > 1.0) { return 1.0; }
  let d = ndc.z - F.shadowParams.y;
  let t = F.shadowParams.w;
  var s = textureSampleCompareLevel(shadowMap, shadowSampler, uv, d);
  s += textureSampleCompareLevel(shadowMap, shadowSampler, uv + vec2f(-t, -t), d);
  s += textureSampleCompareLevel(shadowMap, shadowSampler, uv + vec2f(t, -t), d);
  s += textureSampleCompareLevel(shadowMap, shadowSampler, uv + vec2f(-t, t), d);
  s += textureSampleCompareLevel(shadowMap, shadowSampler, uv + vec2f(t, t), d);
  return s * 0.2;
}

fn brdf(albedo: vec3f, n: vec3f, V: vec3f, L: vec3f, rad: vec3f) -> vec3f {
  let NL = dot(n, L);
#if TOON
  let steps = M.params.z;
  let q = max(NL, 0.0) * steps;
  let d = (floor(q) + smoothstep(0.0, 0.06, fract(q))) / steps;
  let H = normalize(L + V);
  let spec = M.extra.y * smoothstep(0.955, 0.965, max(dot(n, H), 0.0)) * step(0.0, NL);
  return (albedo * d + spec) * rad;
#elif STANDARD
  let NLc = max(NL, 0.0);
  let metal = M.params.x;
  let rough = max(M.params.y, 0.04);
  let f0 = mix(vec3f(0.04), albedo, metal);
  let H = normalize(L + V);
  let NH = max(dot(n, H), 0.0);
  let NV = max(dot(n, V), 1e-4);
  let VH = max(dot(V, H), 0.0);
  let a2 = rough * rough * rough * rough;
  let dd = NH * NH * (a2 - 1.0) + 1.0;
  let D = a2 / (3.14159 * dd * dd);
  let k = (rough + 1.0) * (rough + 1.0) / 8.0;
  let G = NV / (NV * (1.0 - k) + k) * NLc / (NLc * (1.0 - k) + k);
  let Fr = f0 + (1.0 - f0) * pow(1.0 - VH, 5.0);
  let spec = D * G * Fr / (4.0 * NV * NLc + 1e-4);
  return ((1.0 - Fr) * (1.0 - metal) * albedo + spec * 3.14159) * rad * NLc;
#else
  return albedo * rad * max(NL, 0.0);
#endif
}

fn shade(albedo: vec3f, n: vec3f, V: vec3f, wp: vec3f) -> vec3f {
  let amb = mix(F.ground.rgb, F.sky.rgb, n.y * 0.5 + 0.5) * F.sky.w;
#if STANDARD
  let f0 = mix(vec3f(0.04), albedo, M.params.x);
  var c = amb * (albedo * (1.0 - M.params.x) + f0 * (1.0 - M.params.y) * 0.5);
#else
  var c = amb * albedo;
#endif
  var sh = 1.0;
#if RECEIVE_SHADOW
  sh = shadow(wp, n);
#if TOON
  sh = smoothstep(0.3, 0.7, sh);
#endif
#endif
  c += brdf(albedo, n, V, F.lightDir.xyz, F.lightColor.rgb * F.lightDir.w * sh);
  let np = u32(F.misc.x);
  for (var i = 0u; i < np; i++) {
    let pl = F.points[i];
    let d = pl.posRange.xyz - wp;
    let dist = max(length(d), 1e-4);
    let f = clamp(1.0 - pow(dist / pl.posRange.w, 4.0), 0.0, 1.0);
    c += brdf(albedo, n, V, d / dist, pl.color.rgb * pl.color.w * f * f / (dist * dist + 1.0));
  }
#if TOON
  let rim = smoothstep(M.params.w, M.params.w + 0.03, 1.0 - max(dot(n, V), 0.0)) * (dot(n, F.lightDir.xyz) * 0.5 + 0.5);
  c += M.rim.rgb * M.rim.w * rim;
#endif
  return c;
}

fn finalize(c: vec4f, wp: vec3f) -> vec4f {
  var rgb = c.rgb;
#if FOG
  let dist = length(F.camPos.xyz - wp);
  var f = smoothstep(F.fogParams.x, F.fogParams.y, dist);
  if (F.fogParams.z > 0.0) { f = 1.0 - exp(-pow(F.fogParams.z * dist, 2.0)); }
  rgb = mix(rgb, F.fogColor.rgb, f);
#endif
#if GAMMA_OUT
  rgb = pow(clamp(rgb * F.misc.w, vec3f(0.0), vec3f(1.0)), vec3f(1.0 / 2.2));
#endif
  return vec4f(rgb, c.a);
}

#if DEPTH_ONLY
#if ALPHA_TEST
// shadow pass of cut-out materials (leaves, sprites): holes cast no shadow
@fragment fn fs_depth(i: VOut) {
  var a = M.color.a * O.tint.a * i.color.a;
#if HAS_MAP
  a *= textureSample(map, mapSampler, i.uv).a;
#endif
  if (a < M.extra.x) { discard; }
}
#endif
#endif

@fragment fn fs_main(i: VOut, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  var base = M.color * O.tint * i.color;
#if HAS_MAP
  base *= textureSample(map, mapSampler, i.uv);
#endif
#if ALPHA_TEST
  if (base.a < M.extra.x) { discard; }
#endif
#if OUTLINE
  return finalize(vec4f(M.outline.rgb, 1.0), i.world);
#else
  var n = normalize(i.normal);
  if (!ff) { n = -n; }
  var c = base.rgb;
#if !UNLIT
  c = shade(base.rgb, n, normalize(F.camPos.xyz - i.world), i.world);
#endif
  c += M.emissive.rgb * M.emissive.w;
  c = mix(c, O.flash.rgb, O.flash.a);
  return finalize(vec4f(c, base.a), i.world);
#endif
}
