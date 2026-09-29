// Camera-facing instanced particle quads with optional sprite-sheet animation.
layout(std140) uniform Material { vec4 color; vec4 emissive; vec4 params; vec4 rim; vec4 outline; vec4 extra; } M;
layout(std140) uniform Object { mat4 model; mat4 normal; vec4 tint; vec4 flash; } O;
uniform sampler2D map;
#if VERTEX
layout(location=0) in vec3 aPos;
layout(location=2) in vec2 aUv;
layout(location=6) in vec4 aPosSize;
layout(location=7) in vec4 aColor;
layout(location=8) in vec4 aExtra;
out vec2 vUv;
out vec4 vColor;
out vec3 vWorld;
void main() {
  vec3 right = vec3(F.view[0][0], F.view[1][0], F.view[2][0]);
  vec3 up = vec3(F.view[0][1], F.view[1][1], F.view[2][1]);
  float c = cos(aExtra.x), s = sin(aExtra.x);
  vec2 q = vec2(aPos.x * c - aPos.y * s, aPos.x * s + aPos.y * c) * aPosSize.w;
  vec3 w = aPosSize.xyz;
#if LOCAL_SPACE
  w = (O.model * vec4(w, 1.0)).xyz;
#endif
  w += right * q.x + up * q.y;
  vWorld = w;
  gl_Position = F.viewProj * vec4(w, 1.0);
  gl_Position.z = gl_Position.z * 2.0 - gl_Position.w;
  float cols = max(M.params.x, 1.0), rows = max(M.params.y, 1.0), fr = floor(aExtra.y);
  vUv = (aUv + vec2(fr - floor(fr / cols) * cols, floor(fr / cols))) / vec2(cols, rows);
  vColor = aColor * M.color;
}
#endif
#if FRAGMENT
in vec2 vUv;
in vec4 vColor;
in vec3 vWorld;
out vec4 outColor;
void main() {
  vec4 c = vColor * texture(map, vUv);
#if FOG
  float f = smoothstep(F.fogParams.x, F.fogParams.y, length(F.camPos.xyz - vWorld));
  c = vec4(mix(c.rgb, F.fogColor.rgb, f), c.a * (1.0 - f));
#endif
#if GAMMA_OUT
  c.rgb = pow(clamp(c.rgb * F.misc.w, vec3(0.0), vec3(1.0)), vec3(1.0 / 2.2));
#endif
  outColor = c;
}
#endif
