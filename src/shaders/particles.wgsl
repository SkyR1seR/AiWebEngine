// Camera-facing instanced particle quads with optional sprite-sheet animation.
struct Material { color: vec4f, emissive: vec4f, params: vec4f, rim: vec4f, outline: vec4f, extra: vec4f }
struct Object { model: mat4x4f, normal: mat4x4f, tint: vec4f, flash: vec4f }
@group(1) @binding(0) var<uniform> M: Material;
@group(1) @binding(1) var map: texture_2d<f32>;
@group(1) @binding(2) var mapSampler: sampler;
@group(2) @binding(0) var<uniform> O: Object;

struct VIn {
  @location(0) pos: vec3f,
  @location(2) uv: vec2f,
  @location(6) posSize: vec4f,
  @location(7) color: vec4f,
  @location(8) extra: vec4f,
}
struct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) color: vec4f, @location(2) world: vec3f }

@vertex fn vs_main(v: VIn) -> VOut {
  var o: VOut;
  let right = vec3f(F.view[0][0], F.view[1][0], F.view[2][0]);
  let up = vec3f(F.view[0][1], F.view[1][1], F.view[2][1]);
  let c = cos(v.extra.x);
  let s = sin(v.extra.x);
  let q = vec2f(v.pos.x * c - v.pos.y * s, v.pos.x * s + v.pos.y * c) * v.posSize.w;
  var w = v.posSize.xyz;
#if LOCAL_SPACE
  w = (O.model * vec4f(w, 1.0)).xyz;
#endif
  w += right * q.x + up * q.y;
  o.world = w;
  o.pos = F.viewProj * vec4f(w, 1.0);
  let cols = max(M.params.x, 1.0);
  let rows = max(M.params.y, 1.0);
  let fr = floor(v.extra.y);
  o.uv = (v.uv + vec2f(fr - floor(fr / cols) * cols, floor(fr / cols))) / vec2f(cols, rows);
  o.color = v.color * M.color;
  return o;
}

@fragment fn fs_main(i: VOut) -> @location(0) vec4f {
  var c = i.color * textureSample(map, mapSampler, i.uv);
#if FOG
  let f = smoothstep(F.fogParams.x, F.fogParams.y, length(F.camPos.xyz - i.world));
  c = vec4f(mix(c.rgb, F.fogColor.rgb, f), c.a * (1.0 - f));
#endif
#if GAMMA_OUT
  c = vec4f(pow(clamp(c.rgb * F.misc.w, vec3f(0.0), vec3f(1.0)), vec3f(1.0 / 2.2)), c.a);
#endif
  return c;
}
