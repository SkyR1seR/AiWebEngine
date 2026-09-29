// Fullscreen gradient sky with sun glow. Uses Frame.invViewProj to get view direction.
struct Sky { top: vec4f, horizon: vec4f, bottom: vec4f, params: vec4f, a: vec4f, b: vec4f }
@group(1) @binding(0) var<uniform> S: Sky;
struct VOut { @builtin(position) pos: vec4f, @location(0) ndc: vec2f }

@vertex fn vs_main(@builtin(vertex_index) i: u32) -> VOut {
  let uv = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var o: VOut;
  o.ndc = uv * 2.0 - 1.0;
  o.pos = vec4f(o.ndc, 0.0, 1.0);
  return o;
}

@fragment fn fs_main(i: VOut) -> @location(0) vec4f {
  let p = F.invViewProj * vec4f(i.ndc, 1.0, 1.0);
  let dir = normalize(p.xyz / p.w - F.camPos.xyz);
  var c = mix(S.horizon.rgb, S.top.rgb, pow(clamp(dir.y, 0.0, 1.0), S.params.x));
  c = mix(c, S.bottom.rgb, pow(clamp(-dir.y, 0.0, 1.0), S.params.y));
  c += F.lightColor.rgb * S.params.z * pow(max(dot(dir, F.lightDir.xyz), 0.0), S.params.w);
#if GAMMA_OUT
  c = pow(clamp(c * F.misc.w, vec3f(0.0), vec3f(1.0)), vec3f(1.0 / 2.2));
#endif
  return vec4f(c, 1.0);
}
