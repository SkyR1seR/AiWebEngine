// Per-frame uniforms shared by scene shaders (group 0).
struct PointLight { posRange: vec4f, color: vec4f }
struct Frame {
  viewProj: mat4x4f, view: mat4x4f, invViewProj: mat4x4f, shadowMat: mat4x4f,
  camPos: vec4f, sky: vec4f, ground: vec4f, lightDir: vec4f, lightColor: vec4f,
  fogColor: vec4f, fogParams: vec4f, shadowParams: vec4f, misc: vec4f,
  points: array<PointLight, 8>,
}
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var shadowMap: texture_depth_2d;
@group(0) @binding(2) var shadowSampler: sampler_comparison;
