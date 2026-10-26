import { type Vec3, DEG, clamp, dirFromAngles, lerp, smoothstep } from '../math/vec';
import { type Light, PLANET_RADIUS, skyRadiance, transmittance } from './physics';

/**
 * The time-of-day model. One number — the hour — drives everything: sun and
 * moon positions, haze, exposure. Lighting for the clouds is *derived* from the
 * same atmosphere model that paints the sky, so the two never disagree.
 */

export type PresetId = 'dawn' | 'noon' | 'golden' | 'dusk' | 'night';

export interface Preset {
  readonly id: PresetId;
  readonly label: string;
  readonly hour: number;
}

export const PRESETS: readonly Preset[] = [
  { id: 'dawn', label: 'Dawn', hour: 6.35 },
  { id: 'noon', label: 'Noon', hour: 12.5 },
  { id: 'golden', label: 'Golden hour', hour: 18.2 },
  { id: 'dusk', label: 'Blue hour', hour: 19.45 },
  { id: 'night', label: 'Moonlight', hour: 22.5 },
];

export const HOUR_MIN = 5.5;
export const HOUR_MAX = 23.5;

/** Art-directed keyframes over the hour. Angles in degrees; unwrapped azimuth. */
interface Key {
  readonly h: number;
  readonly sunAz: number;
  readonly sunEl: number;
  readonly haze: number;
  readonly exposure: number;
}

const KEYS: readonly Key[] = [
  { h: 5.5, sunAz: -70, sunEl: -5, haze: 2.2, exposure: 1.1 },
  { h: 6.35, sunAz: -78, sunEl: 3.5, haze: 2.4, exposure: 1.0 },
  { h: 8.5, sunAz: -125, sunEl: 24, haze: 1.6, exposure: 1.12 },
  { h: 12.5, sunAz: -250, sunEl: 48, haze: 1.0, exposure: 1.22 },
  { h: 16.5, sunAz: -268, sunEl: 20, haze: 1.5, exposure: 1.12 },
  { h: 18.2, sunAz: -284, sunEl: 5.0, haze: 2.6, exposure: 1.0 },
  { h: 19.0, sunAz: -290, sunEl: -2.0, haze: 2.3, exposure: 1.0 },
  { h: 19.45, sunAz: -294, sunEl: -5.5, haze: 1.5, exposure: 0.9 },
  { h: 20.5, sunAz: -300, sunEl: -12, haze: 1.8, exposure: 1.0 },
  { h: 23.5, sunAz: -320, sunEl: -30, haze: 1.6, exposure: 1.0 },
];

function sampleKeys(hour: number): Key {
  const h = clamp(hour, KEYS[0].h, KEYS[KEYS.length - 1].h);
  let i = 0;
  while (i < KEYS.length - 2 && h > KEYS[i + 1].h) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const t = smoothstep(0, 1, (h - a.h) / (b.h - a.h));
  return {
    h,
    sunAz: lerp(a.sunAz, b.sunAz, t),
    sunEl: lerp(a.sunEl, b.sunEl, t),
    haze: lerp(a.haze, b.haze, t),
    exposure: lerp(a.exposure, b.exposure, t),
  };
}

const SUN_ILLUMINANCE: Vec3 = [1.0, 0.96, 0.9];
const SUN_INTENSITY = 20;
/** Artistic moon brightness (real moonlight is ~1e-6 of the sun; the eye adapts). */
const MOON_INTENSITY = SUN_INTENSITY * 0.0035;
const MOON_AZ = -28 * DEG;
const MOON_EL = 34 * DEG;
/** Altitude at which cloud lighting is evaluated (km). */
const CLOUD_LIGHT_ALTITUDE = 2.2;
const GROUND_ALBEDO = 0.12;

/**
 * Twilight: once the sun is below the horizon the lower atmosphere is in the
 * Earth's shadow and single scattering goes dark, while the real sky stays lit
 * by light scattered from high altitudes. This term stands in for it: a blue
 * dome plus a warm glow toward the sun's azimuth. Mirrored in skyLut.frag.
 */
export interface Twilight {
  readonly dome: Vec3;
  readonly glow: Vec3;
}

export function twilightAt(sunElDeg: number): Twilight {
  const w = smoothstep(-17, -4, sunElDeg) * (1 - smoothstep(-3, 3, sunElDeg));
  const glowW = smoothstep(-12, -3, sunElDeg) * (1 - smoothstep(-1, 4, sunElDeg));
  return {
    dome: scaleV([0.16, 0.24, 0.5], 0.03 * w),
    glow: scaleV([1.0, 0.5, 0.36], 0.06 * glowW),
  };
}

/** Twilight radiance in a direction (mirrors the GLSL). */
export function twilightRadiance(t: Twilight, dir: Vec3, sunDir: Vec3): Vec3 {
  const h = Math.hypot(sunDir[0], sunDir[2]) || 1;
  const sx = sunDir[0] / h;
  const sz = sunDir[2] / h;
  const dh = Math.hypot(dir[0], dir[2]) || 1;
  const toward = Math.max(0, (dir[0] * sx + dir[2] * sz) / dh);
  const low = Math.exp(-Math.max(dir[1], 0) * 5);
  const g = Math.pow(toward, 3) * low;
  const dome = 0.75 + 0.25 * Math.max(dir[1], 0);
  return [t.dome[0] * dome + t.glow[0] * g, t.dome[1] * dome + t.glow[1] * g, t.dome[2] * dome + t.glow[2] * g];
}

export interface Atmosphere {
  readonly hour: number;
  readonly sunDir: Vec3;
  readonly moonDir: Vec3;
  readonly sunIlluminance: Vec3;
  readonly moonIlluminance: Vec3;
  readonly haze: number;
  /** Dominant light for cloud shading (sun by day, moon by night). */
  readonly keyDir: Vec3;
  /** Key light colour at cloud altitude, already attenuated by the atmosphere. */
  readonly keyColor: Vec3;
  /** Sky radiance reaching the top of clouds (averaged hemisphere). */
  readonly ambientTop: Vec3;
  /** Light bounced up from the ground into cloud bases. */
  readonly ambientBottom: Vec3;
  readonly exposure: number;
  readonly twilight: Twilight;
  /** 0 by day → 1 at full night. */
  readonly night: number;
}

const scaleV = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const mulV = (a: Vec3, b: Vec3): Vec3 => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
const addV = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const luminance = (c: Vec3): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** Irradiance-weighted average sky radiance over the upper hemisphere. */
function hemisphereRadiance(altitude: number, lights: readonly Light[], haze: number, tw: Twilight, sunDir: Vec3): Vec3 {
  let acc: Vec3 = [0, 0, 0];
  let wsum = 0;
  const elevations = [6, 20, 38, 60, 82];
  for (const el of elevations) {
    for (let a = 0; a < 8; a++) {
      const d = dirFromAngles((a / 8) * Math.PI * 2, el * DEG);
      const w = Math.sin(el * DEG) * Math.cos(el * DEG);
      acc = addV(acc, scaleV(addV(skyRadiance(altitude, d, lights, { haze }, 10), twilightRadiance(tw, d, sunDir)), w));
      wsum += w;
    }
  }
  return scaleV(acc, 1 / wsum);
}

export function computeAtmosphere(hour: number): Atmosphere {
  const k = sampleKeys(hour);
  const sunDir = dirFromAngles(k.sunAz * DEG, k.sunEl * DEG);
  const moonDir = dirFromAngles(MOON_AZ, MOON_EL);
  const night = smoothstep(-6, -14, k.sunEl);
  const sunIlluminance = scaleV(SUN_ILLUMINANCE, SUN_INTENSITY);
  const moonIlluminance: Vec3 = scaleV([0.86, 0.92, 1.0], MOON_INTENSITY * night);
  const lights: Light[] = [{ dir: sunDir, illuminance: sunIlluminance }];
  if (night > 0) lights.push({ dir: moonDir, illuminance: moonIlluminance });
  const medium = { haze: k.haze };

  // Sun as seen from cloud altitude. Clouds stay sunlit a little past sunset
  // (they're above the horizon dip); fade it out through civil twilight.
  const dip = -Math.acos(PLANET_RADIUS / (PLANET_RADIUS + CLOUD_LIGHT_ALTITUDE)) / DEG;
  const sunElForLight = Math.max(k.sunEl, dip + 0.6);
  const sunLightDir = dirFromAngles(k.sunAz * DEG, sunElForLight * DEG);
  const sunFade = smoothstep(-9, dip + 0.6, k.sunEl);
  const sunAtCloud = scaleV(mulV(sunIlluminance, transmittance(CLOUD_LIGHT_ALTITUDE, sunLightDir, medium)), sunFade);
  const moonAtCloud = mulV(moonIlluminance, transmittance(CLOUD_LIGHT_ALTITUDE, moonDir, medium));
  const sunWins = luminance(sunAtCloud) >= luminance(moonAtCloud);
  const keyDir = sunWins ? sunLightDir : moonDir;
  // After sunset the last direct light is deep red; the eye (and the twilight
  // sky filling the shadows) reads it as soft pink. Desaturate toward that.
  const rawKey = sunWins ? sunAtCloud : moonAtCloud;
  const desat = sunWins ? smoothstep(0, -6, k.sunEl) * 0.5 : 0;
  const keyL = luminance(rawKey);
  const pink: Vec3 = [keyL * 1.9, keyL * 0.75, keyL * 0.85];
  const keyColor: Vec3 = [
    rawKey[0] + (pink[0] - rawKey[0]) * desat,
    rawKey[1] + (pink[1] - rawKey[1]) * desat,
    rawKey[2] + (pink[2] - rawKey[2]) * desat,
  ];

  const twilight = twilightAt(k.sunEl);
  const sky = hemisphereRadiance(CLOUD_LIGHT_ALTITUDE, lights, k.haze, twilight, sunDir);
  // a faint airglow/starlight floor keeps night from collapsing to black
  const airglow: Vec3 = [0.0011, 0.0016, 0.0032];
  const ambientTop = addV(sky, airglow);

  const sunGround = mulV(sunIlluminance, transmittance(0.05, sunDir, medium));
  const groundE = addV(scaleV(sunGround, Math.max(0, sunDir[1])), scaleV(sky, Math.PI));
  const moonGround = scaleV(mulV(moonIlluminance, transmittance(0.05, moonDir, medium)), Math.max(0, moonDir[1]));
  const ambientBottom = addV(scaleV(addV(groundE, moonGround), GROUND_ALBEDO / Math.PI), scaleV(airglow, 0.5));

  // Partial auto-exposure: night stays darker than day, but readable.
  const ref = luminance(ambientTop) + 0.25 * luminance(keyColor) * 0.05;
  const exposure = (k.exposure * 0.32) / Math.pow(ref + 1e-5, 0.78);

  return {
    hour,
    sunDir,
    moonDir,
    sunIlluminance,
    moonIlluminance,
    haze: k.haze,
    keyDir,
    keyColor,
    ambientTop,
    ambientBottom,
    exposure,
    twilight,
    night,
  };
}
