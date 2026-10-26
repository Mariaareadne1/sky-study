// ---- shared atmosphere constants (mirror src/atmosphere/physics.ts) ----
const float PI = 3.14159265359;
const float PLANET_RADIUS = 6360.0;
const float ATMOSPHERE_RADIUS = 6460.0;
const vec3 RAYLEIGH_SCATTERING = vec3(5.802e-3, 13.558e-3, 33.1e-3);
const float RAYLEIGH_HEIGHT = 8.0;
const float MIE_SCATTERING = 3.996e-3;
const float MIE_EXTINCTION = 4.44e-3;
const float MIE_HEIGHT = 1.2;
const vec3 OZONE_ABSORPTION = vec3(0.65e-3, 1.881e-3, 0.085e-3);
const float MULTI_SCATTER = 0.012;

float raySphereNear(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r * r;
  float d = b * b - c;
  if (d < 0.0) return -1.0;
  return -b - sqrt(d);
}

float raySphereFar(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r * r;
  float d = b * b - c;
  if (d < 0.0) return -1.0;
  return -b + sqrt(d);
}

// Sky-view LUT parameterisation: absolute azimuth, elevation compressed toward the horizon.
vec2 skyUv(vec3 dir) {
  float az = atan(dir.x, -dir.z);
  float el = asin(clamp(dir.y, -1.0, 1.0));
  float v = 0.5 + 0.5 * sign(el) * sqrt(abs(el) / (0.5 * PI));
  return vec2(az / (2.0 * PI) + 0.5, v);
}

vec3 skyDir(vec2 uv) {
  float az = (uv.x - 0.5) * 2.0 * PI;
  float s = uv.y * 2.0 - 1.0;
  float el = sign(s) * s * s * 0.5 * PI;
  return vec3(sin(az) * cos(el), sin(el), -cos(az) * cos(el));
}

float hgPhase(float mu, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5));
}
