#version 300 es
precision highp float;
precision highp int;
in vec2 vUv;
out vec4 outColor;

// Writes one z-slice of a tileable 3D noise volume.
uniform float uSlice;   // 0..1 z coordinate of this slice (texel centre)
uniform int uMode;      // 0 = shape (Perlin-Worley + Worley fbm), 1 = detail (Worley fbm)

uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}

vec3 hash3(ivec3 c, int seed) {
  uvec3 h = pcg3d(uvec3(c + ivec3(seed * 157, seed * 311, seed * 73) + 4096));
  return vec3(h) * (1.0 / 4294967295.0);
}

ivec3 wrap(ivec3 c, int period) {
  return ((c % period) + period) % period;
}

// 1 - F1 Worley ("billows"), tileable with the given cell period.
float worley(vec3 p, int period, int seed) {
  vec3 x = p * float(period);
  ivec3 cell = ivec3(floor(x));
  vec3 f = fract(x);
  float d = 1e9;
  for (int k = -1; k <= 1; k++)
  for (int j = -1; j <= 1; j++)
  for (int i = -1; i <= 1; i++) {
    ivec3 o = ivec3(i, j, k);
    vec3 r = vec3(o) + hash3(wrap(cell + o, period), seed) - f;
    d = min(d, dot(r, r));
  }
  return 1.0 - clamp(sqrt(d), 0.0, 1.0);
}

vec3 grad(ivec3 c, int period, int seed) {
  return normalize(hash3(wrap(c, period), seed + 17) * 2.0 - 1.0);
}

float perlin(vec3 p, int period, int seed) {
  vec3 x = p * float(period);
  ivec3 c = ivec3(floor(x));
  vec3 f = fract(x);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n000 = dot(grad(c + ivec3(0,0,0), period, seed), f - vec3(0,0,0));
  float n100 = dot(grad(c + ivec3(1,0,0), period, seed), f - vec3(1,0,0));
  float n010 = dot(grad(c + ivec3(0,1,0), period, seed), f - vec3(0,1,0));
  float n110 = dot(grad(c + ivec3(1,1,0), period, seed), f - vec3(1,1,0));
  float n001 = dot(grad(c + ivec3(0,0,1), period, seed), f - vec3(0,0,1));
  float n101 = dot(grad(c + ivec3(1,0,1), period, seed), f - vec3(1,0,1));
  float n011 = dot(grad(c + ivec3(0,1,1), period, seed), f - vec3(0,1,1));
  float n111 = dot(grad(c + ivec3(1,1,1), period, seed), f - vec3(1,1,1));
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
             mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}

float worleyFbm(vec3 p, int period, int seed) {
  return worley(p, period, seed) * 0.625
       + worley(p, period * 2, seed + 1) * 0.25
       + worley(p, period * 4, seed + 2) * 0.125;
}

float remap(float v, float a, float b, float c, float d) {
  return c + (v - a) / (b - a) * (d - c);
}

void main() {
  vec3 p = vec3(vUv, uSlice);
  if (uMode == 0) {
    float pf = perlin(p, 4, 1) * 0.5 + perlin(p, 8, 2) * 0.25 + perlin(p, 16, 3) * 0.125;
    pf = clamp(pf * 0.9 + 0.5, 0.0, 1.0);
    float w = worleyFbm(p, 4, 5);
    float pw = clamp(remap(pf, w - 1.0, 1.0, 0.0, 1.0), 0.0, 1.0);
    outColor = vec4(pw, worleyFbm(p, 4, 9), worleyFbm(p, 8, 13), worleyFbm(p, 16, 21));
  } else {
    outColor = vec4(worleyFbm(p, 4, 31), worleyFbm(p, 8, 37), worleyFbm(p, 16, 41), 1.0);
  }
}
