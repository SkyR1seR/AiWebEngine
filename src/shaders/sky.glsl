// Fullscreen gradient sky with sun glow.
layout(std140) uniform Material { vec4 top; vec4 horizon; vec4 bottom; vec4 params; vec4 a; vec4 b; } S;
#if VERTEX
out vec2 vNdc;
void main() {
  vec2 uv = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vNdc = uv * 2.0 - 1.0;
  gl_Position = vec4(vNdc, 0.0, 1.0);
}
#endif
#if FRAGMENT
in vec2 vNdc;
out vec4 outColor;
void main() {
  vec4 p = F.invViewProj * vec4(vNdc, 1.0, 1.0);
  vec3 dir = normalize(p.xyz / p.w - F.camPos.xyz);
  vec3 c = mix(S.horizon.rgb, S.top.rgb, pow(clamp(dir.y, 0.0, 1.0), S.params.x));
  c = mix(c, S.bottom.rgb, pow(clamp(-dir.y, 0.0, 1.0), S.params.y));
  c += F.lightColor.rgb * S.params.z * pow(max(dot(dir, F.lightDir.xyz), 0.0), S.params.w);
#if GAMMA_OUT
  c = pow(clamp(c * F.misc.w, vec3(0.0), vec3(1.0)), vec3(1.0 / 2.2));
#endif
  outColor = vec4(c, 1.0);
}
#endif
