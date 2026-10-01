// Universal surface shader (GLSL ES 3.0 mirror of lit.wgsl).
layout(std140) uniform Material { vec4 color; vec4 emissive; vec4 params; vec4 rim; vec4 outline; vec4 extra; } M;
layout(std140) uniform Object { mat4 model; mat4 normal; vec4 tint; vec4 flash; } O;
#if SKINNED
layout(std140) uniform Skin { mat4 joints[{{MAX_JOINTS}}]; } J;
#endif
uniform sampler2D map;

#if VERTEX
layout(location=0) in vec3 aPos;
#if HAS_NORMAL
layout(location=1) in vec3 aNormal;
#endif
#if HAS_UV
layout(location=2) in vec2 aUv;
#endif
#if HAS_COLOR
layout(location=3) in vec4 aColor;
#endif
#if SKINNED
layout(location=4) in vec4 aJoints;
layout(location=5) in vec4 aWeights;
#endif
#if INSTANCED
layout(location=6) in vec4 aI0;
layout(location=7) in vec4 aI1;
layout(location=8) in vec4 aI2;
layout(location=9) in vec4 aI3;
#endif
#if INSTANCE_COLOR
layout(location=10) in vec4 aIColor;
#endif
out vec3 vWorld;
out vec3 vNormal;
out vec2 vUv;
out vec4 vColor;
void main() {
  mat4 model = O.model;
#if INSTANCED
  model = model * mat4(aI0, aI1, aI2, aI3);
#endif
  vec4 p = vec4(aPos, 1.0);
  vec3 n = vec3(0.0, 1.0, 0.0);
#if HAS_NORMAL
  n = aNormal;
#endif
#if SKINNED
  mat4 sk = J.joints[int(aJoints.x)] * aWeights.x + J.joints[int(aJoints.y)] * aWeights.y + J.joints[int(aJoints.z)] * aWeights.z + J.joints[int(aJoints.w)] * aWeights.w;
  p = sk * p;
  n = (sk * vec4(n, 0.0)).xyz;
#endif
  vec3 w = (model * p).xyz;
#if INSTANCED
  vec3 wn = normalize((model * vec4(n, 0.0)).xyz);
#else
  vec3 wn = normalize((O.normal * vec4(n, 0.0)).xyz);
#endif
#if OUTLINE
  w += wn * M.outline.w;
#endif
  vWorld = w;
  vNormal = wn;
  gl_Position = F.viewProj * vec4(w, 1.0);
  gl_Position.z = gl_Position.z * 2.0 - gl_Position.w;
  vUv = vec2(0.0);
#if HAS_UV
  vUv = aUv;
#endif
  vColor = vec4(1.0);
#if HAS_COLOR
  vColor = aColor;
#endif
#if INSTANCE_COLOR
  vColor *= aIColor;
#endif
}
#endif

#if FRAGMENT
#if DEPTH_ONLY
// shadow pass; cut-out materials (leaves, sprites) discard their holes
in vec2 vUv;
in vec4 vColor;
void main() {
#if ALPHA_TEST
  float a = M.color.a * O.tint.a * vColor.a;
#if HAS_MAP
  a *= texture(map, vUv).a;
#endif
  if (a < M.extra.x) discard;
#endif
}
#else
in vec3 vWorld;
in vec3 vNormal;
in vec2 vUv;
in vec4 vColor;
out vec4 outColor;

float shadow(vec3 wp, vec3 n) {
  if (F.shadowParams.x < 0.5) return 1.0;
  vec4 sp = F.shadowMat * vec4(wp + n * F.shadowParams.z, 1.0);
  vec3 ndc = sp.xyz / sp.w;
  vec2 uv = ndc.xy * 0.5 + 0.5;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0 || ndc.z > 1.0) return 1.0;
  float d = ndc.z - F.shadowParams.y;
  float t = F.shadowParams.w;
  float s = texture(shadowMap, vec3(uv, d));
  s += texture(shadowMap, vec3(uv + vec2(-t, -t), d));
  s += texture(shadowMap, vec3(uv + vec2(t, -t), d));
  s += texture(shadowMap, vec3(uv + vec2(-t, t), d));
  s += texture(shadowMap, vec3(uv + vec2(t, t), d));
  return s * 0.2;
}

vec3 brdf(vec3 albedo, vec3 n, vec3 V, vec3 L, vec3 rad) {
  float NL = dot(n, L);
#if TOON
  float steps = M.params.z;
  float q = max(NL, 0.0) * steps;
  float d = (floor(q) + smoothstep(0.0, 0.06, fract(q))) / steps;
  vec3 H = normalize(L + V);
  float spec = M.extra.y * smoothstep(0.955, 0.965, max(dot(n, H), 0.0)) * step(0.0, NL);
  return (albedo * d + spec) * rad;
#elif STANDARD
  float NLc = max(NL, 0.0);
  float metal = M.params.x;
  float rough = max(M.params.y, 0.04);
  vec3 f0 = mix(vec3(0.04), albedo, metal);
  vec3 H = normalize(L + V);
  float NH = max(dot(n, H), 0.0);
  float NV = max(dot(n, V), 1e-4);
  float VH = max(dot(V, H), 0.0);
  float a2 = rough * rough * rough * rough;
  float dd = NH * NH * (a2 - 1.0) + 1.0;
  float D = a2 / (3.14159 * dd * dd);
  float k = (rough + 1.0) * (rough + 1.0) / 8.0;
  float G = NV / (NV * (1.0 - k) + k) * NLc / (NLc * (1.0 - k) + k);
  vec3 Fr = f0 + (1.0 - f0) * pow(1.0 - VH, 5.0);
  vec3 spec = D * G * Fr / (4.0 * NV * NLc + 1e-4);
  return ((1.0 - Fr) * (1.0 - metal) * albedo + spec * 3.14159) * rad * NLc;
#else
  return albedo * rad * max(NL, 0.0);
#endif
}

vec3 shade(vec3 albedo, vec3 n, vec3 V, vec3 wp) {
  vec3 amb = mix(F.ground.rgb, F.sky.rgb, n.y * 0.5 + 0.5) * F.sky.w;
#if STANDARD
  vec3 f0 = mix(vec3(0.04), albedo, M.params.x);
  vec3 c = amb * (albedo * (1.0 - M.params.x) + f0 * (1.0 - M.params.y) * 0.5);
#else
  vec3 c = amb * albedo;
#endif
  float sh = 1.0;
#if RECEIVE_SHADOW
  sh = shadow(wp, n);
#if TOON
  sh = smoothstep(0.3, 0.7, sh);
#endif
#endif
  c += brdf(albedo, n, V, F.lightDir.xyz, F.lightColor.rgb * F.lightDir.w * sh);
  int np = int(F.misc.x);
  for (int i = 0; i < 8; i++) {
    if (i >= np) break;
    PointLight pl = F.points[i];
    vec3 d = pl.posRange.xyz - wp;
    float dist = max(length(d), 1e-4);
    float f = clamp(1.0 - pow(dist / pl.posRange.w, 4.0), 0.0, 1.0);
    c += brdf(albedo, n, V, d / dist, pl.color.rgb * pl.color.w * f * f / (dist * dist + 1.0));
  }
#if TOON
  float rim = smoothstep(M.params.w, M.params.w + 0.03, 1.0 - max(dot(n, V), 0.0)) * (dot(n, F.lightDir.xyz) * 0.5 + 0.5);
  c += M.rim.rgb * M.rim.w * rim;
#endif
  return c;
}

vec4 finalize(vec4 c, vec3 wp) {
  vec3 rgb = c.rgb;
#if FOG
  float dist = length(F.camPos.xyz - wp);
  float f = smoothstep(F.fogParams.x, F.fogParams.y, dist);
  if (F.fogParams.z > 0.0) f = 1.0 - exp(-pow(F.fogParams.z * dist, 2.0));
  rgb = mix(rgb, F.fogColor.rgb, f);
#endif
#if GAMMA_OUT
  rgb = pow(clamp(rgb * F.misc.w, vec3(0.0), vec3(1.0)), vec3(1.0 / 2.2));
#endif
  return vec4(rgb, c.a);
}

void main() {
  vec4 base = M.color * O.tint * vColor;
#if HAS_MAP
  base *= texture(map, vUv);
#endif
#if ALPHA_TEST
  if (base.a < M.extra.x) discard;
#endif
#if OUTLINE
  outColor = finalize(vec4(M.outline.rgb, 1.0), vWorld);
#else
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  vec3 c = base.rgb;
#if !UNLIT
  c = shade(base.rgb, n, normalize(F.camPos.xyz - vWorld), vWorld);
#endif
  c += M.emissive.rgb * M.emissive.w;
  c = mix(c, O.flash.rgb, O.flash.a);
  outColor = finalize(vec4(c, base.a), vWorld);
#endif
}
#endif
#endif
