#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 vUv;
out vec4 outColor;

//#include common

#define MAX_CLOUDS 16

uniform vec2 uResolution;
uniform float uFrame;
uniform vec2 uJitter;

uniform vec3 uCamPos;
uniform vec3 uCamForward;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform float uTanHalfFov;
uniform float uAspect;

uniform sampler2D uSkyLut;
uniform sampler3D uNoiseShape;
uniform sampler3D uNoiseDetail;
uniform sampler3D uAtlas;
uniform float uSlotCount;
uniform vec3 uSlotTexel; // 1 / atlas texel counts within a slot (x, y, z)

uniform vec3 uSunDir;
uniform vec3 uSunIlluminance;
uniform vec3 uMoonDir;
uniform vec3 uMoonIlluminance;
uniform vec3 uKeyDir;
uniform vec3 uKeyColor;
uniform vec3 uAmbientTop;
uniform vec3 uAmbientBottom;
uniform float uHaze;
uniform float uNight;
uniform float uTime;

uniform int uCloudCount;
uniform vec4 uCloudPos[MAX_CLOUDS];    // world centre (km), w = scale
uniform vec4 uCloudHalf[MAX_CLOUDS];   // half extents in shape space (km), w = yaw
uniform vec4 uCloudParam[MAX_CLOUDS];  // x = atlas slot, y = growth 0..1, z = seed, w = density
uniform int uQuality;                  // 0 reduced, 1 balanced, 2 high
uniform float uPixelAngle;             // radians per internal pixel (vertical)
uniform float uPixelStyle;             // 1 = pixel art: chunkier masses, harder edges

const float SIGMA = 52.0;       // extinction per km at density 1
const float SHAPE_FREQ = 0.42;  // shape-noise tiles per km
const float DETAIL_FREQ = 2.3;  // detail-noise tiles per km
const float AMBIENT_STRENGTH = 0.72;

float remap(float v, float a, float b, float c, float d) {
  return c + (v - a) / max(b - a, 1e-5) * (d - c);
}

float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// ---- per-cloud transforms ----
vec3 toLocalDir(int i, vec3 d) {
  float yaw = uCloudHalf[i].w;
  float c = cos(yaw), s = sin(yaw);
  return vec3(c * d.x - s * d.z, d.y, s * d.x + c * d.z);
}

vec2 boxInterval(vec3 ro, vec3 rd, vec3 halfSize) {
  vec3 inv = 1.0 / rd;
  vec3 t0 = (-halfSize - ro) * inv;
  vec3 t1 = (halfSize - ro) * inv;
  vec3 tmin = min(t0, t1);
  vec3 tmax = max(t0, t1);
  return vec2(max(max(tmin.x, tmin.y), max(tmin.z, 0.0)), min(min(tmax.x, tmax.y), tmax.z));
}

// Base envelope from the baked gesture volume: r = coverage, g = formation order.
vec2 sampleEnvelope(int i, vec3 p) {
  vec3 h = uCloudHalf[i].xyz;
  vec3 uvw = clamp(p / h * 0.5 + 0.5, uSlotTexel * 0.5, 1.0 - uSlotTexel * 0.5);
  float slot = uCloudParam[i].x;
  uvw.z = (slot + uvw.z) / uSlotCount;
  return texture(uAtlas, uvw).rg;
}

// Density at shape-space point p. lod: 0 = full detail, 1 = no fine detail.
// The baked coverage acts like a smooth distance field; noise octaves displace
// its surface (large billows → cauliflower → fine grain) and a narrow smoothstep
// turns the result into a crisp but soft-edged cumulus boundary.
float cloudDensity(int i, vec3 p, float lod, float detailFade) {
  vec2 env = sampleEnvelope(i, p);
  float cov = env.r;
  if (cov < 0.02) return 0.0;
  vec4 prm = uCloudParam[i];
  float growth = prm.y;
  float reveal = smoothstep(0.0, 1.0, clamp(growth * 1.4 - env.g * 0.4, 0.0, 1.0));
  float seedOff = prm.z * 0.137;
  vec3 q = p + vec3(seedOff * 7.1, seedOff * 3.3, seedOff * 5.7);
  vec4 sn = texture(uNoiseShape, q * SHAPE_FREQ);
  float hy = p.y / uCloudHalf[i].y * 0.5 + 0.5;
  float billow = sn.g * 0.5 + sn.b * 0.3 + sn.a * 0.2;
  float d = cov * mix(0.55, 1.0, reveal) + 0.2 - (1.0 - sn.r) * 0.3 - (1.0 - billow) * 0.32;
  d -= (1.0 - reveal) * 0.35;
  if (d < -0.3) return 0.0;
  if (lod < 0.5) {
    vec3 dn = texture(uNoiseDetail, q * DETAIL_FREQ).rgb;
    // cauliflower on top, ragged and wispier toward the base
    float cauli = dn.r * 0.6 + dn.g * 0.28 + dn.b * 0.12;
    float base = smoothstep(0.35, 0.0, hy);
    // while condensing the fine erosion is weak, so vapour reads soft, not speckled
    d -= ((1.0 - cauli) * mix(0.3, 0.42, base)) * detailFade * mix(0.35, 1.0, reveal) * mix(1.0, 0.12, uPixelStyle);
  } else {
    d -= 0.13;
  }
  // forming: a wide, translucent ramp (vapour) that tightens into a crisp surface
  float edge = mix(mix(0.12, 0.05, detailFade), 0.025, uPixelStyle);
  float dens = smoothstep(0.0, mix(0.5, edge, reveal), d) * mix(0.3, 1.0, reveal);
  return dens * prm.w;
}

float lightOpticalDepth(int i, vec3 p, vec3 ldirLocal, float scale, float detailFade, float jitter) {
  float od = 0.0;
  float seg = 0.024;
  float t = 0.0;
  for (int k = 0; k < 6; k++) {
    // jittered sample position within each segment hides the terracing of a short march
    vec3 sp = p + ldirLocal * ((t + seg * jitter) / scale);
    od += cloudDensity(i, sp, k < 2 ? 0.0 : 1.0, detailFade) * seg;
    t += seg;
    seg *= 1.9;
  }
  return od * SIGMA;
}

vec3 skyColor(vec3 dir) {
  vec3 c = texture(uSkyLut, skyUv(dir)).rgb;
  // Below the horizon: no scenery, just the haze of the lower atmosphere
  // deepening slightly toward the ground.
  // (only near the ground; from high up the real surface below shows through)
  float below = smoothstep(0.03, -0.04, dir.y) * (1.0 - smoothstep(1.6, 5.0, uCamPos.y));
  if (below > 0.0) {
    vec3 hz = texture(uSkyLut, skyUv(normalize(vec3(dir.x, 0.03, dir.z)))).rgb;
    vec3 deep = texture(uSkyLut, skyUv(normalize(vec3(dir.x, 0.3, dir.z)))).rgb;
    vec3 haze = mix(hz, mix(hz, deep, 0.45) * 0.62, smoothstep(0.0, -0.3, dir.y));
    c = mix(c, haze, below);
  }
  return c;
}

vec3 celestial(vec3 dir) {
  vec3 c = vec3(0.0);
  // sun disk (0.27° radius) with limb darkening, attenuated by the sky LUT's horizon
  float cs = dot(dir, uSunDir);
  float sunCos = cos(0.0047);
  if (cs > sunCos - 0.00002 && dir.y > -0.02) {
    float r = sqrt(max(0.0, 1.0 - cs * cs)) / sin(0.0047);
    float limb = 1.0 - 0.6 * (1.0 - sqrt(max(0.0, 1.0 - r * r)));
    float edge = smoothstep(1.0, 0.92, r);
    // transmittance approximated from the sky colour's ratio to its zenith
    c += uSunIlluminance * limb * edge * 120.0 * clamp(dir.y * 8.0 + 0.4, 0.0, 1.0);
  }
  // moon
  float cm = dot(dir, uMoonDir);
  float moonR = 0.0062;
  if (uNight > 0.0 && cm > cos(moonR * 1.2)) {
    float r = acos(clamp(cm, -1.0, 1.0)) / moonR;
    vec3 t = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
    vec3 b = cross(t, uMoonDir);
    vec2 uv = vec2(dot(dir, t), dot(dir, b)) / moonR;
    float maria = 0.75 + 0.25 * smoothstep(0.2, 0.9, hash12(floor(uv * 3.0 + 7.0)) * 0.6 + 0.4 * sin(uv.x * 3.1 + uv.y * 2.3));
    c += vec3(0.9, 0.93, 1.0) * smoothstep(1.0, 0.94, r) * maria * 0.35 * uNight;
    c += vec3(0.6, 0.7, 0.9) * exp(-r * 2.2) * 0.003 * uNight;
  }
  // stars: sparse, tiny, dim, only high in the sky
  if (uNight > 0.0 && dir.y > 0.05) {
    vec2 sp = vec2(atan(dir.x, -dir.z), asin(dir.y)) * 420.0;
    vec2 cell = floor(sp);
    float h = hash12(cell);
    if (h > 0.9965) {
      vec2 f = fract(sp) - 0.5 - (vec2(hash12(cell + 3.1), hash12(cell + 7.7)) - 0.5) * 0.6;
      float s = exp(-dot(f, f) * 40.0) * (h - 0.9965) / 0.0035;
      c += vec3(0.85, 0.9, 1.0) * s * 0.012 * uNight * smoothstep(0.05, 0.3, dir.y);
    }
  }
  return c;
}

// Shadow cast by the clouds onto the surface below: a short march from the
// ground point toward the key light through each cloud's coarse density.
float groundShadow(vec3 pg) {
  float od = 0.0;
  for (int i = 0; i < MAX_CLOUDS; i++) {
    if (i >= uCloudCount) break;
    float s = uCloudPos[i].w;
    vec3 o = toLocalDir(i, pg - uCloudPos[i].xyz) / s;
    vec3 d = toLocalDir(i, uKeyDir) / s;
    vec2 t = boxInterval(o, d, uCloudHalf[i].xyz);
    if (t.x >= t.y) continue;
    float dt = (t.y - t.x) / 5.0;
    for (int k = 0; k < 5; k++) {
      od += cloudDensity(i, o + d * (t.x + (float(k) + 0.5) * dt), 1.0, 0.0) * dt;
    }
  }
  return exp(-od * SIGMA * 0.12);
}

void main() {
  vec2 frag = gl_FragCoord.xy + uJitter;
  vec2 ndc = frag / uResolution * 2.0 - 1.0;
  vec3 rd = normalize(uCamForward + uCamRight * ndc.x * uTanHalfFov * uAspect + uCamUp * ndc.y * uTanHalfFov);
  vec3 sky = skyColor(rd);
  // From altitude the surface below is open ocean: deepen it toward slate blue
  // and let the clouds shade it.
  float high = smoothstep(1.6, 5.0, uCamPos.y);
  if (high > 0.0 && rd.y < -0.01) {
    float down = smoothstep(-0.01, -0.35, rd.y) * high;
    sky = mix(sky, sky * vec3(0.5, 0.6, 0.78), down);
    float tG = -uCamPos.y / rd.y;
    if (uKeyDir.y > 0.02) {
      // jittered per frame; accumulation turns it into a soft penumbra
      float a = hash12(gl_FragCoord.xy + uFrame * 17.0) * 6.2832;
      float r = sqrt(hash12(gl_FragCoord.yx + uFrame * 7.0)) * 0.16;
      vec3 pg = uCamPos + rd * tG + vec3(cos(a), 0.0, sin(a)) * r;
      sky *= mix(1.0, mix(0.45, 1.0, groundShadow(pg)), down);
    }
  }
  vec3 background = sky + celestial(rd);

  // ---- gather the clouds this ray crosses, sorted by entry distance ----
  vec2 iv[MAX_CLOUDS];
  vec3 lo[MAX_CLOUDS];
  vec3 ld[MAX_CLOUDS];
  int act[MAX_CLOUDS];
  int nAct = 0;
  float tStart = 1e9;
  float tEnd = -1.0;
  for (int i = 0; i < MAX_CLOUDS; i++) {
    if (i >= uCloudCount) break;
    float s = uCloudPos[i].w;
    vec3 o = toLocalDir(i, uCamPos - uCloudPos[i].xyz) / s;
    vec3 d = toLocalDir(i, rd) / s;
    vec2 t = boxInterval(o, d, uCloudHalf[i].xyz);
    iv[i] = t;
    lo[i] = o;
    ld[i] = d;
    if (t.x < t.y) {
      tStart = min(tStart, t.x);
      tEnd = max(tEnd, t.y);
      // insertion sort by entry distance
      int k = nAct;
      while (k > 0 && iv[act[k - 1]].x > t.x) {
        act[k] = act[k - 1];
        k--;
      }
      act[k] = i;
      nAct++;
    }
  }

  if (tEnd < 0.0) {
    outColor = vec4(background, 1.0);
    return;
  }

  float noiseOffset = ign(gl_FragCoord.xy + uFrame * 5.588238);
  float fineStep = uQuality == 2 ? 0.014 : (uQuality == 1 ? 0.02 : 0.03);
  int maxSteps = uQuality == 2 ? 320 : (uQuality == 1 ? 220 : 150);
  vec3 L = vec3(0.0);
  float T = 1.0;
  float t = tStart + fineStep * noiseOffset;
  float firstHit = -1.0;
  float weightedDepth = 0.0;
  float depthWeight = 0.0;
  int emptyRun = 0;

  for (int s = 0; s < 400; s++) {
    if (s >= maxSteps || t > tEnd || T < 0.012) break;
    float dist = t;
    float detailFade = 1.0 - smoothstep(18.0, 45.0, dist);
    float sigmaSum = 0.0;
    vec3 scatter = vec3(0.0);
    bool nearAny = false;
    int nextIndex = -1;
    float nextStart = 1e9;
    for (int k = 0; k < MAX_CLOUDS; k++) {
      if (k >= nAct) break;
      int i = act[k];
      vec2 ti = iv[i];
      if (t < ti.x) { if (ti.x < nextStart) { nextStart = ti.x; nextIndex = i; } break; }
      if (t > ti.y) continue;
      float scl = uCloudPos[i].w;
      vec3 p = lo[i] + ld[i] * t;
      vec2 env = sampleEnvelope(i, p);
      if (env.r < 0.01) continue;
      nearAny = true;
      float dens = cloudDensity(i, p, 0.0, detailFade);
      if (dens <= 0.0) continue;
      float sigma = dens * SIGMA;
      vec3 kl = toLocalDir(i, uKeyDir);
      float od = lightOpticalDepth(i, p, kl, scl, detailFade, fract(noiseOffset + float(s) * 0.618034));
      float mu = dot(rd, uKeyDir);
      // multiple-scattering octaves (Wrenninge 2015)
      vec3 sun = vec3(0.0);
      float a = 1.0, b = 1.0, c = 1.0;
      for (int o = 0; o < 4; o++) {
        float ph = mix(hgPhase(mu, 0.72 * c), hgPhase(mu, -0.2 * c), 0.28);
        sun += b * exp(-od * a) * ph;
        a *= 0.33; b *= 0.6; c *= 0.5;
      }
      // "powder": dark crevices facing the light; strongest away from the sun
      float powder = 1.0 - exp(-sigma * 0.09);
      powder = mix(1.0, powder * 1.6 + 0.12, 0.55 * (0.5 - 0.5 * mu));
      // skylight: brighter on tops, occluded by the mass above
      float hy = p.y / uCloudHalf[i].y * 0.5 + 0.5;
      float above = sampleEnvelope(i, p + vec3(0.0, 0.18 / scl, 0.0)).r;
      float ao = exp(-above * 2.4) * 0.62 + 0.38 * hy * hy;
      vec3 amb = mix(uAmbientBottom, uAmbientTop, smoothstep(0.0, 0.85, hy)) * ao * AMBIENT_STRENGTH;
      scatter += sigma * (uKeyColor * sun * powder + amb);
      sigmaSum += sigma;
    }
    // never step finer than ~1.3 pixel footprints: far clouds need fewer samples
    float dt = max(fineStep, t * uPixelAngle * 1.3);
    if (sigmaSum > 0.0) {
      emptyRun = 0;
      float stepT = exp(-sigmaSum * dt);
      vec3 sInt = (scatter - scatter * stepT) / sigmaSum;
      L += T * sInt;
      if (firstHit < 0.0) firstHit = t;
      weightedDepth += t * T * (1.0 - stepT);
      depthWeight += T * (1.0 - stepT);
      T *= stepT;
    } else if (nearAny) {
      // inside the envelope but eroded away: stride a little faster
      dt *= 1.6;
    } else {
      // outside every envelope: stride, or jump to the next cloud's box
      emptyRun++;
      dt *= emptyRun > 2 ? 4.0 : 2.0;
      bool inside = false;
      for (int k = 0; k < MAX_CLOUDS; k++) {
        if (k >= nAct) break;
        vec2 ti = iv[act[k]];
        if (t < ti.x) break;
        if (t <= ti.y) inside = true;
      }
      if (!inside && nextIndex >= 0) {
        t = nextStart + fineStep * noiseOffset;
        continue;
      }
      if (!inside && nextIndex < 0) break;
    }
    t += dt;
  }

  float alpha = 1.0 - T;
  vec3 col = background * T;
  if (alpha > 0.0) {
    float d = depthWeight > 0.0 ? weightedDepth / depthWeight : tEnd;
    // aerial perspective: distant clouds dissolve into the sky behind them
    float fog = exp(-d * 0.018 * uHaze);
    col += L * fog + sky * alpha * (1.0 - fog);
  }
  outColor = vec4(col, 1.0);
}
