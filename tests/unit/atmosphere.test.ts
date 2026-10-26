import { describe, expect, test } from 'vitest';
import { PRESETS, computeAtmosphere, luminance } from '../../src/atmosphere/timeOfDay';
import { skyRadiance, transmittance } from '../../src/atmosphere/physics';

const at = (id: string) => computeAtmosphere(PRESETS.find((p) => p.id === id)!.hour);
const finite = (v: readonly number[]) => v.every((x) => Number.isFinite(x) && x >= 0);

describe('atmosphere model', () => {
  test('transmittance is reddened near the horizon and blocked by the planet', () => {
    const up = transmittance(1, [0, 1, 0], { haze: 1 });
    const low = transmittance(1, [Math.cos(0.02), Math.sin(0.02), 0], { haze: 1 });
    expect(up[2]).toBeGreaterThan(low[2]);
    expect(low[0] / low[2]).toBeGreaterThan(up[0] / up[2]);
    expect(transmittance(1, [0, -1, 0], { haze: 1 })).toEqual([0, 0, 0]);
  });

  test('a midday sky is blue at the zenith', () => {
    const sky = skyRadiance(1, [0, 1, 0], [{ dir: [0.3, 0.9, -0.3], illuminance: [1, 1, 1] }], { haze: 1 });
    expect(sky[2]).toBeGreaterThan(sky[1]);
    expect(sky[1]).toBeGreaterThan(sky[0]);
  });

  test('every preset produces finite, non-negative lighting', () => {
    for (const p of PRESETS) {
      const a = computeAtmosphere(p.hour);
      expect(finite(a.keyColor), p.id).toBe(true);
      expect(finite(a.ambientTop), p.id).toBe(true);
      expect(finite(a.ambientBottom), p.id).toBe(true);
      expect(Number.isFinite(a.exposure) && a.exposure > 0, p.id).toBe(true);
    }
  });

  test('presets genuinely change the light on the clouds', () => {
    const noon = at('noon');
    const golden = at('golden');
    const dusk = at('dusk');
    const night = at('night');
    const warmth = (c: readonly number[]) => c[0] / c[2];
    expect(warmth(golden.keyColor)).toBeGreaterThan(warmth(noon.keyColor) * 2);
    expect(luminance(noon.keyColor)).toBeGreaterThan(luminance(golden.keyColor));
    expect(luminance(golden.keyColor)).toBeGreaterThan(luminance(dusk.keyColor));
    expect(night.night).toBeGreaterThan(0.9);
    expect(noon.night).toBe(0);
    // moonlight is cool and silvery
    expect(night.keyColor[2]).toBeGreaterThanOrEqual(night.keyColor[0] * 0.8);
    // light direction really moves
    expect(noon.keyDir[1]).toBeGreaterThan(golden.keyDir[1] + 0.4);
  });

  test('blue hour is lit by a bluish twilight sky with a soft pink key', () => {
    const dusk = at('dusk');
    expect(dusk.ambientTop[2]).toBeGreaterThan(dusk.ambientTop[0]);
    expect(dusk.keyColor[0]).toBeGreaterThan(dusk.keyColor[1]);
    // desaturated toward pink rather than pure red
    expect(dusk.keyColor[2] / dusk.keyColor[0]).toBeGreaterThan(0.1);
  });

  test('lighting varies continuously with the hour (no jumps between presets)', () => {
    let prev = computeAtmosphere(5.6);
    for (let h = 5.65; h <= 23.4; h += 0.05) {
      const a = computeAtmosphere(h);
      const exposedNow = luminance(a.ambientTop) * a.exposure;
      const exposedPrev = luminance(prev.ambientTop) * prev.exposure;
      expect(Math.abs(exposedNow - exposedPrev) / Math.max(exposedPrev, 1e-4), `hour ${h.toFixed(2)}`).toBeLessThan(0.25);
      prev = a;
    }
  });
});
