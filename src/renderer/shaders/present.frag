#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uImage;
uniform float uExposure;
uniform float uNight;
uniform vec2 uResolution;
uniform float uFrame;

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

void main() {
  vec3 hdr = texture(uImage, vUv).rgb * uExposure;
  // scotopic shift at night: low light reads bluer and less saturated
  float l = dot(hdr, vec3(0.2126, 0.7152, 0.0722));
  hdr = mix(hdr, l * vec3(0.78, 0.9, 1.22), uNight * 0.45);
  vec3 c = linearToSrgb(clamp(agx(hdr), 0.0, 1.0));
  c += (ign(gl_FragCoord.xy + uFrame * 5.588238) - 0.5) / 255.0;
  outColor = vec4(c, 1.0);
}
