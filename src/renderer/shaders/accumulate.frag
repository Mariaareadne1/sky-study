#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uCurrent;
uniform sampler2D uHistory;
uniform float uBlend; // weight of the new frame
void main() {
  vec3 c = texture(uCurrent, vUv).rgb;
  vec3 h = texture(uHistory, vUv).rgb;
  outColor = vec4(mix(h, c, uBlend), 1.0);
}
