#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uImage;
uniform float uExposure;
uniform float uNight;
uniform vec2 uResolution;
uniform float uFrame;
uniform float uPixel;     // 1 = pixel-art style
uniform vec2 uTexSize;    // internal (raymarched) resolution: one "big pixel" per texel
uniform float uLevels;    // tone steps
uniform float uDither;    // ordered-dither strength (fraction of a step)

// AgX tone mapping (minimal fit, Benjamin Wrensch) — gentle highlight roll-off,
// keeps sunset hues from going neon.
vec3 agxContrast(vec3 x) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}

vec3 agx(vec3 c) {
  const mat3 inset = mat3(0.842479062253094, 0.0423282422610123, 0.0423756549057051,
                          0.0784335999999992, 0.878468636469772, 0.0784336,
                          0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  const mat3 outset = mat3(1.19687900512017, -0.0528968517574562, -0.0529716355144438,
                           -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
                           -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
  const float minEv = -12.47393;
  const float maxEv = 4.026069;
  c = inset * c;
  c = clamp(log2(max(c, 1e-10)), minEv, maxEv);
  c = (c - minEv) / (maxEv - minEv);
  c = agxContrast(c);
  c = outset * c;
  // AgX "punchy"-ish look: slight saturation
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = l + 1.08 * (c - l);
  return pow(max(c, 0.0), vec3(2.2));
}

vec3 linearToSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

float bayer4(vec2 p) {
  ivec2 q = ivec2(mod(p, 4.0));
  int i = q.x + q.y * 4;
  // 4x4 Bayer matrix, row-major
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[i]) + 0.5) / 16.0;
}

// Pixel-art finish: flat tone bands (a "palette" of brightness steps chosen by
// the scene's own lighting), ordered dither where bands meet, and the hue
// shifts pixel artists use — cooler, bluer shadows; warmer highlights.
vec3 pixelArt(vec3 c, vec2 cell) {
  // a brighter, more saturated starting point, like a hand-picked palette
  c = pow(c, vec3(0.88));
  float g0 = dot(c, vec3(0.299, 0.587, 0.114));
  c = clamp(g0 + (c - g0) * 1.35, 0.0, 1.0);
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  // dither only in a thin seam where two bands meet; flat colour elsewhere
  float x = l * uLevels;
  float f = fract(x);
  float seam = 1.0 - smoothstep(0.0, uDither, abs(f - 0.5));
  float d = (bayer4(cell) - 0.5) * seam;
  float lq = clamp(floor(x + 0.5 + d) / uLevels, 0.0, 1.0);
  vec3 col = c * (lq / max(l, 0.02));
  // hue-shifted ramps: shadows lean blue-violet, highlights lean warm
  col = mix(col, col * vec3(0.78, 0.9, 1.22), (1.0 - lq) * 0.55);
  col = mix(col, col * vec3(1.06, 1.03, 0.92), lq * lq * 0.3);
  return clamp(col, 0.0, 1.0);
}

void main() {
  vec2 uv = vUv;
  vec2 cell = vec2(0.0);
  if (uPixel > 0.5) {
    cell = floor(vUv * uTexSize);
    uv = (cell + 0.5) / uTexSize;
  }
  vec3 hdr = texture(uImage, uv).rgb * uExposure;
  // scotopic shift at night: low light reads bluer and less saturated
  float l = dot(hdr, vec3(0.2126, 0.7152, 0.0722));
  hdr = mix(hdr, l * vec3(0.78, 0.9, 1.22), uNight * 0.45);
  vec3 c = linearToSrgb(clamp(agx(hdr), 0.0, 1.0));
  if (uPixel > 0.5) {
    outColor = vec4(pixelArt(c, cell), 1.0);
    return;
  }
  c += (ign(gl_FragCoord.xy + uFrame * 5.588238) - 0.5) / 255.0;
  outColor = vec4(c, 1.0);
}
