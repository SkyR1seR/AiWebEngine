// Per-frame uniforms shared by scene shaders (group 0).
struct PointLight { vec4 posRange; vec4 color; };
layout(std140) uniform Frame {
  mat4 viewProj; mat4 view; mat4 invViewProj; mat4 shadowMat;
  vec4 camPos; vec4 sky; vec4 ground; vec4 lightDir; vec4 lightColor;
  vec4 fogColor; vec4 fogParams; vec4 shadowParams; vec4 misc;
  PointLight points[8];
} F;
uniform sampler2DShadow shadowMap;
