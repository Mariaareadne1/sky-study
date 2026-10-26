#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;

//#include common

uniform vec3 uSunDir;
uniform vec3 uSunIlluminance;
uniform vec3 uMoonDir;
uniform vec3 uMoonIlluminance;
uniform float uHaze;
uniform float uAltitude;
uniform float uGroundAlbedo;
uniform vec3 uTwilightDome;
uniform vec3 uTwilightGlow;

vec3 twilight(vec3 dir) {
  vec2 s = normalize(uSunDir.xz + vec2(1e-6));
  float toward = max(0.0, dot(normalize(dir.xz + vec2(1e-6)), s));
  float low = exp(-max(dir.y, 0.0) * 5.0);
  float dome = 0.75 + 0.25 * max(dir.y, 0.0);
  return uTwilightDome * dome + uTwilightGlow * pow(toward, 3.0) * low;
}

vec3 extinctionAt(float h) {
  float r = exp(-h / RAYLEIGH_HEIGHT);
  float mie = exp(-h / MIE_HEIGHT) * uHaze * MIE_EXTINCTION;
  float oz = max(0.0, 1.0 - abs(h - 25.0) / 15.0);
  return RAYLEIGH_SCATTERING * r + mie + OZONE_ABSORPTION * oz;
}

vec3 transmittanceTo(float h, float cosZ) {
  vec3 ro = vec3(0.0, PLANET_RADIUS + h, 0.0);
  vec3 rd = vec3(sqrt(max(0.0, 1.0 - cosZ * cosZ)), cosZ, 0.0);
  if (raySphereNear(ro, rd, PLANET_RADIUS) > 0.0) return vec3(0.0);
  float tMax = raySphereFar(ro, rd, ATMOSPHERE_RADIUS);
  const int N = 12;
  float dt = tMax / float(N);
  vec3 od = vec3(0.0);
  for (int i = 0; i < N; i++) {
    vec3 p = ro + rd * ((float(i) + 0.5) * dt);
    od += extinctionAt(length(p) - PLANET_RADIUS) * dt;
  }
  return exp(-od);
}

vec3 lightScatter(vec3 dir, vec3 p, float r, float h, vec3 lightDir, vec3 illum, vec3 tv, float rd, float md, float dt) {
  vec3 up = p / r;
  vec3 ts = transmittanceTo(h, dot(up, lightDir));
  float mu = dot(dir, lightDir);
  float pr = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
  float g = 0.8;
  float g2 = g * g;
  float pm = 3.0 / (8.0 * PI) * ((1.0 - g2) * (1.0 + mu * mu)) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * g * mu, 1.5));
  vec3 scat = RAYLEIGH_SCATTERING * rd * (pr + MULTI_SCATTER) + md * (pm + MULTI_SCATTER);
  return illum * ts * scat * tv * dt;
}

void main() {
  vec3 dir = skyDir(vUv);
  vec3 ro = vec3(0.0, PLANET_RADIUS + uAltitude, 0.0);
  float tGround = raySphereNear(ro, dir, PLANET_RADIUS);
  bool hitsGround = tGround > 0.0;
  float tMax = hitsGround ? tGround : raySphereFar(ro, dir, ATMOSPHERE_RADIUS);
  const int N = 24;
  float dt = tMax / float(N);
  vec3 L = vec3(0.0);
  vec3 od = vec3(0.0);
  bool moon = dot(uMoonIlluminance, vec3(1.0)) > 0.0;
  for (int i = 0; i < N; i++) {
    vec3 p = ro + dir * ((float(i) + 0.5) * dt);
    float r = length(p);
    float h = r - PLANET_RADIUS;
    vec3 e = extinctionAt(h);
    vec3 tv = exp(-(od + e * dt * 0.5));
    od += e * dt;
    float rd = exp(-h / RAYLEIGH_HEIGHT);
    float md = exp(-h / MIE_HEIGHT) * uHaze * MIE_SCATTERING;
    L += lightScatter(dir, p, r, h, uSunDir, uSunIlluminance, tv, rd, md, dt);
    if (moon) L += lightScatter(dir, p, r, h, uMoonDir, uMoonIlluminance, tv, rd, md, dt);
  }
  if (hitsGround) {
    vec3 pg = ro + dir * tGround;
    vec3 n = normalize(pg);
    vec3 tv = exp(-od);
    vec3 eSun = uSunIlluminance * transmittanceTo(0.0, dot(n, uSunDir)) * max(0.0, dot(n, uSunDir));
    vec3 eMoon = uMoonIlluminance * transmittanceTo(0.0, dot(n, uMoonDir)) * max(0.0, dot(n, uMoonDir));
    L += tv * (eSun + eMoon) * uGroundAlbedo / PI;
  }
  L += twilight(dir) * (hitsGround ? 0.6 : 1.0);
  outColor = vec4(L, 1.0);
}
