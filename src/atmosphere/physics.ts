import { type Vec3, dot, normalize } from '../math/vec';

/**
 * Single-scattering Earth atmosphere (Rayleigh + Mie + ozone absorption), after
 * Bruneton & Neyret / Hillaire. Units: km. The GLSL sky pass mirrors these
 * constants; the CPU copy derives cloud light colours so sky and clouds agree.
 */
export const PLANET_RADIUS = 6360;
export const ATMOSPHERE_RADIUS = 6460;
export const RAYLEIGH_SCATTERING: Vec3 = [5.802e-3, 13.558e-3, 33.1e-3];
export const RAYLEIGH_HEIGHT = 8;
export const MIE_SCATTERING = 3.996e-3;
export const MIE_EXTINCTION = 4.44e-3;
export const MIE_HEIGHT = 1.2;
export const OZONE_ABSORPTION: Vec3 = [0.65e-3, 1.881e-3, 0.085e-3];

export interface Medium {
  /** Multiplier on Mie density (haze). */
  readonly haze: number;
}

function raySphereFar(ro: Vec3, rd: Vec3, radius: number): number {
  const b = dot(ro, rd);
  const c = dot(ro, ro) - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return -1;
  return -b + Math.sqrt(disc);
}

function raySphereNear(ro: Vec3, rd: Vec3, radius: number): number {
  const b = dot(ro, rd);
  const c = dot(ro, ro) - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t;
}

function extinctionAt(h: number, m: Medium): Vec3 {
  const r = Math.exp(-h / RAYLEIGH_HEIGHT);
  const mie = Math.exp(-h / MIE_HEIGHT) * m.haze * MIE_EXTINCTION;
  const oz = Math.max(0, 1 - Math.abs(h - 25) / 15);
  return [
    RAYLEIGH_SCATTERING[0] * r + mie + OZONE_ABSORPTION[0] * oz,
    RAYLEIGH_SCATTERING[1] * r + mie + OZONE_ABSORPTION[1] * oz,
    RAYLEIGH_SCATTERING[2] * r + mie + OZONE_ABSORPTION[2] * oz,
  ];
}

/** Transmittance from a point at altitude `altitudeKm` toward `dir` to the top of the atmosphere. */
export function transmittance(altitudeKm: number, dir: Vec3, m: Medium, steps = 40): Vec3 {
  const ro: Vec3 = [0, PLANET_RADIUS + altitudeKm, 0];
  if (raySphereNear(ro, dir, PLANET_RADIUS) > 0) return [0, 0, 0];
  const tMax = raySphereFar(ro, dir, ATMOSPHERE_RADIUS);
  const dt = tMax / steps;
  const od = [0, 0, 0];
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) * dt;
    const p: Vec3 = [ro[0] + dir[0] * t, ro[1] + dir[1] * t, ro[2] + dir[2] * t];
    const h = Math.hypot(p[0], p[1], p[2]) - PLANET_RADIUS;
    const e = extinctionAt(h, m);
    od[0] += e[0] * dt;
    od[1] += e[1] * dt;
    od[2] += e[2] * dt;
  }
  return [Math.exp(-od[0]), Math.exp(-od[1]), Math.exp(-od[2])];
}

const rayleighPhase = (mu: number) => (3 / (16 * Math.PI)) * (1 + mu * mu);
const miePhase = (mu: number, g = 0.8) => {
  const g2 = g * g;
  return ((3 / (8 * Math.PI)) * ((1 - g2) * (1 + mu * mu))) / ((2 + g2) * Math.pow(1 + g2 - 2 * g * mu, 1.5));
};

export interface Light {
  readonly dir: Vec3;
  /** Illuminance at the top of the atmosphere, RGB. */
  readonly illuminance: Vec3;
}

/** Sky radiance seen from `altitudeKm` along `dir` (single scattering + a multiple-scattering fudge). */
export function skyRadiance(altitudeKm: number, dirIn: Vec3, lights: readonly Light[], m: Medium, steps = 16): Vec3 {
  const dir = normalize(dirIn);
  const ro: Vec3 = [0, PLANET_RADIUS + altitudeKm, 0];
  const tGround = raySphereNear(ro, dir, PLANET_RADIUS);
  const tMax = tGround > 0 ? tGround : raySphereFar(ro, dir, ATMOSPHERE_RADIUS);
  const dt = tMax / steps;
  const out = [0, 0, 0];
  const odView = [0, 0, 0];
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) * dt;
    const p: Vec3 = [ro[0] + dir[0] * t, ro[1] + dir[1] * t, ro[2] + dir[2] * t];
    const r = Math.hypot(p[0], p[1], p[2]);
    const h = r - PLANET_RADIUS;
    const e = extinctionAt(h, m);
    odView[0] += e[0] * dt * 0.5;
    odView[1] += e[1] * dt * 0.5;
    odView[2] += e[2] * dt * 0.5;
    const tv = [Math.exp(-odView[0]), Math.exp(-odView[1]), Math.exp(-odView[2])];
    odView[0] += e[0] * dt * 0.5;
    odView[1] += e[1] * dt * 0.5;
    odView[2] += e[2] * dt * 0.5;
    const rd = Math.exp(-h / RAYLEIGH_HEIGHT);
    const md = Math.exp(-h / MIE_HEIGHT) * m.haze * MIE_SCATTERING;
    for (const light of lights) {
      const mu = dot(dir, light.dir);
      const up: Vec3 = [p[0] / r, p[1] / r, p[2] / r];
      // rotate the light dir into the local frame: only the zenith angle matters
      const cosZ = dot(up, light.dir);
      const sinZ = Math.sqrt(Math.max(0, 1 - cosZ * cosZ));
      const ts = transmittance(h, [sinZ, cosZ, 0], m, 12);
      const pr = rayleighPhase(mu);
      const pm = miePhase(mu);
      for (let c = 0; c < 3; c++) {
        const scat = RAYLEIGH_SCATTERING[c] * rd * (pr + MULTI_SCATTER) + md * (pm + MULTI_SCATTER);
        out[c] += light.illuminance[c] * ts[c] * scat * tv[c] * dt;
      }
    }
  }
  return [out[0], out[1], out[2]];
}

/** Isotropic fudge standing in for multiple scattering (brightens twilight and the shadowed sky). */
export const MULTI_SCATTER = 0.012;
