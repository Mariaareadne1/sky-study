import { createRng } from '../math/rng';
import { clamp } from '../math/vec';

/**
 * Gesture → cloud volume.
 *
 * A stroke (already projected onto the drawing plane, in km, centred on the
 * cloud) is turned into a set of overlapping spherical "lobes": a skeleton of
 * primary masses along the gesture (or filling it, when the gesture is closed),
 * convective towers pushing upward, and smaller cauliflower lobes on the upper
 * surfaces. The lobes are baked into a coarse coverage volume; the shader adds
 * all of the fine structure with noise. Everything is seeded, so the same
 * stroke + seed always produces the same cloud.
 */

export interface Point2 {
  readonly x: number;
  readonly y: number;
}

export interface Lobe {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly r: number;
  /** Formation order, 0 = forms first. */
  readonly t: number;
}

export interface CloudShape {
  readonly lobes: readonly Lobe[];
  readonly half: readonly [number, number, number];
  readonly closed: boolean;
  /** Bottom of the cloud in shape space (km) — the flat convective base. */
  readonly baseY: number;
}

export const MIN_STROKE_KM = 0.25;
const MAX_EXTENT_KM = 14;

export function pathLength(pts: readonly Point2[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return len;
}

export function bounds(pts: readonly Point2[]): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, maxX, minY, maxY };
}

/** Evenly resample a polyline by arc length. */
export function resample(pts: readonly Point2[], count: number): Point2[] {
  const valid = pts.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (valid.length === 0) return [];
  if (valid.length === 1 || count < 2) return [valid[0]];
  const total = pathLength(valid);
  if (total === 0) return [valid[0]];
  const out: Point2[] = [valid[0]];
  const step = total / (count - 1);
  let acc = 0;
  let target = step;
  for (let i = 1; i < valid.length && out.length < count - 1; i++) {
    const a = valid[i - 1];
    const b = valid[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    while (seg > 0 && acc + seg >= target && out.length < count - 1) {
      const u = (target - acc) / seg;
      out.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
      target += step;
    }
    acc += seg;
  }
  out.push(valid[valid.length - 1]);
  return out;
}

/** Light moving-average smoothing that keeps the endpoints. */
export function smooth(pts: readonly Point2[], passes = 2, closed = false): Point2[] {
  let cur = pts.slice();
  const n = cur.length;
  if (n < 3) return cur;
  for (let k = 0; k < passes; k++) {
    const next: Point2[] = [];
    for (let i = 0; i < n; i++) {
      if (!closed && (i === 0 || i === n - 1)) {
        next.push(cur[i]);
        continue;
      }
      const a = cur[(i - 1 + n) % n];
      const b = cur[i];
      const c = cur[(i + 1) % n];
      next.push({ x: (a.x + 2 * b.x + c.x) / 4, y: (a.y + 2 * b.y + c.y) / 4 });
    }
    cur = next;
  }
  return cur;
}

export function isClosedGesture(pts: readonly Point2[]): boolean {
  if (pts.length < 8) return false;
  const b = bounds(pts);
  const size = Math.max(b.maxX - b.minX, b.maxY - b.minY);
  const gap = Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y);
  return size > 0 && gap < size * 0.3 && pathLength(pts) > size * 2.2;
}

function pointInPolygon(x: number, y: number, poly: readonly Point2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function distToPolyline(x: number, y: number, poly: readonly Point2[], closed: boolean): { d: number; s: number } {
  let best = Infinity;
  let bestS = 0;
  let acc = 0;
  const total = pathLength(poly) + (closed ? Math.hypot(poly[0].x - poly[poly.length - 1].x, poly[0].y - poly[poly.length - 1].y) : 0);
  const n = closed ? poly.length : poly.length - 1;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const u = len2 > 0 ? clamp(((x - a.x) * dx + (y - a.y) * dy) / len2, 0, 1) : 0;
    const d = Math.hypot(x - (a.x + dx * u), y - (a.y + dy * u));
    if (d < best) {
      best = d;
      bestS = (acc + Math.sqrt(len2) * u) / (total || 1);
    }
    acc += Math.sqrt(len2);
  }
  return { d: best, s: bestS };
}

/** Normalise a raw plane-space stroke: drop invalid points, smooth, resample, centre. */
export function prepareStroke(raw: readonly Point2[]): { points: Point2[]; center: Point2; closed: boolean } | null {
  const finite = raw.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (finite.length < 2) return null;
  const len = pathLength(finite);
  if (len < MIN_STROKE_KM) return null;
  const count = clamp(Math.round(len / 0.06), 16, 160);
  const closed = isClosedGesture(finite);
  const pts = smooth(resample(finite, count), 3, false);
  const b = bounds(pts);
  const center = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  const scaleDown = Math.min(1, MAX_EXTENT_KM / Math.max(b.maxX - b.minX, b.maxY - b.minY, 1e-6));
  const points = pts.map((p) => ({ x: (p.x - center.x) * scaleDown, y: (p.y - center.y) * scaleDown }));
  return { points, center, closed };
}

const round4 = (v: number) => Math.round(v * 1e4) / 1e4;

export function buildShape(points: readonly Point2[], closed: boolean, seed: number): CloudShape {
  const rng = createRng(seed);
  const rand = (a: number, b: number) => a + (b - a) * rng();
  const b = bounds(points);
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  const size = Math.max(w, h, 0.05);
  const total = pathLength(points);
  const primaries: Lobe[] = [];

  if (closed && points.length >= 8) {
    // Fill the enclosed region and inflate it: lobes sized by the distance to the outline.
    const grid = clamp(size / 11, 0.08, 1.2);
    let maxD = 0;
    const interior: { x: number; y: number; d: number; s: number }[] = [];
    for (let y = b.minY + grid * 0.5; y < b.maxY; y += grid) {
      for (let x = b.minX + grid * 0.5; x < b.maxX; x += grid) {
        const jx = x + rand(-0.3, 0.3) * grid;
        const jy = y + rand(-0.3, 0.3) * grid;
        if (!pointInPolygon(jx, jy, points)) continue;
        const { d, s } = distToPolyline(jx, jy, points, true);
        if (d < grid * 0.35) continue;
        interior.push({ x: jx, y: jy, d, s });
        maxD = Math.max(maxD, d);
      }
    }
    for (const p of interior) {
      const r = clamp(p.d * rand(0.95, 1.15), grid * 0.6, size * 0.4);
      const depth = Math.min(p.d, maxD) * 0.55;
      primaries.push({ x: p.x, y: p.y, z: rand(-0.35, 0.35) * depth, r, t: 0.55 * (1 - p.d / (maxD || 1)) + 0.45 * p.s });
    }
    // the outline itself, so the silhouette follows the gesture
    const rim = clamp(size * 0.075, 0.1, 0.8);
    const step = Math.max(1, Math.round((rim * 0.9) / (total / points.length || 1)));
    for (let i = 0; i < points.length; i += step) {
      const p = points[i];
      primaries.push({ x: p.x, y: p.y, z: rand(-0.3, 0.3) * rim, r: rim * rand(0.8, 1.2), t: i / points.length });
    }
  } else {
    const r0 = clamp(0.1 * total + 0.22, 0.24, 1.25);
    const spacing = r0 * 0.5;
    const n = Math.max(2, Math.ceil(total / spacing));
    const pts = resample(points, n + 1);
    for (let i = 0; i < pts.length; i++) {
      const u = pts.length > 1 ? i / (pts.length - 1) : 0.5;
      const taper = 0.55 + 0.45 * Math.pow(Math.sin(Math.PI * clamp(u, 0, 1)), 0.6);
      const r = r0 * taper * rand(0.82, 1.15);
      primaries.push({ x: pts[i].x + rand(-0.1, 0.1) * r, y: pts[i].y + rand(-0.08, 0.12) * r, z: rand(-0.3, 0.3) * r0, r, t: u });
      // body depth: lobes in front of and behind the gesture
      if (rng() < 0.7) primaries.push({ x: pts[i].x, y: pts[i].y - r * 0.15, z: (rng() < 0.5 ? -1 : 1) * r0 * rand(0.35, 0.6), r: r * rand(0.7, 0.9), t: u + 0.05 });
    }
  }

  // Convective towers and cauliflower: smaller lobes riding the upper surfaces.
  const lobes: Lobe[] = [...primaries];
  const meanR = primaries.reduce((a, l) => a + l.r, 0) / (primaries.length || 1);
  const sorted = primaries.slice().sort((a, b) => b.y + b.r - (a.y + a.r));
  const towerCount = Math.min(sorted.length, Math.max(1, Math.round(primaries.length * 0.35)));
  for (let i = 0; i < towerCount; i++) {
    const p = sorted[Math.floor(rng() * Math.min(sorted.length, towerCount * 2))];
    if (rng() < 0.45) continue;
    const r = p.r * rand(0.55, 0.8);
    lobes.push({ x: p.x + rand(-0.3, 0.3) * p.r, y: p.y + p.r * rand(0.45, 0.75), z: p.z + rand(-0.25, 0.25) * p.r, r, t: p.t + 0.12 });
  }
  const parents = lobes.slice();
  for (const p of parents) {
    if (p.r < meanR * 0.35) continue;
    const k = p.r > meanR * 0.8 ? 3 : 2;
    for (let j = 0; j < k; j++) {
      // a direction on the upper hemisphere, leaning outward from the core
      const theta = rand(0, Math.PI * 2);
      const up = rand(0.15, 1);
      const sxz = Math.sqrt(1 - up * up);
      const dir = [Math.cos(theta) * sxz, up, Math.sin(theta) * sxz];
      const r = p.r * rand(0.35, 0.55);
      const d = p.r * rand(0.7, 0.85);
      lobes.push({ x: p.x + dir[0] * d, y: p.y + dir[1] * d, z: p.z + dir[2] * d * 0.8, r, t: Math.min(1.2, p.t + 0.15) });
    }
  }

  let minY = Infinity;
  let hx = 0, hy = 0, hz = 0;
  for (const l of lobes) {
    minY = Math.min(minY, l.y - l.r);
    hx = Math.max(hx, Math.abs(l.x) + l.r);
    hy = Math.max(hy, Math.abs(l.y) + l.r);
    hz = Math.max(hz, Math.abs(l.z) + l.r);
  }
  // A flatter convective base: trim the lowest part of the mass.
  const height = 2 * hy;
  const baseY = minY + height * 0.1;
  const pad = 0.06;
  return {
    lobes: lobes.map((l) => ({ x: round4(l.x), y: round4(l.y), z: round4(l.z), r: round4(l.r), t: round4(clamp(l.t, 0, 1.2)) })),
    half: [round4(hx + pad), round4(hy + pad), round4(hz + pad)],
    closed,
    baseY: round4(baseY),
  };
}

export const SLOT_DIMS = { x: 96, y: 64, z: 64 } as const;

/**
 * Bake lobes into a coverage volume (RG8: r = coverage, g = formation order).
 * Coverage is the probabilistic union 1 - Π(1 - kᵢ) of smooth lobe kernels.
 */
export function bakeEnvelope(shape: CloudShape, dims = SLOT_DIMS): Uint8Array {
  const { x: nx, y: ny, z: nz } = dims;
  const keep = new Float32Array(nx * ny * nz).fill(1);
  const best = new Float32Array(nx * ny * nz);
  const order = new Float32Array(nx * ny * nz).fill(1);
  const [hx, hy, hz] = shape.half;
  const vx = (2 * hx) / nx;
  const vy = (2 * hy) / ny;
  const vz = (2 * hz) / nz;
  for (const l of shape.lobes) {
    const i0 = Math.max(0, Math.floor((l.x - l.r + hx) / vx));
    const i1 = Math.min(nx - 1, Math.ceil((l.x + l.r + hx) / vx));
    const j0 = Math.max(0, Math.floor((l.y - l.r + hy) / vy));
    const j1 = Math.min(ny - 1, Math.ceil((l.y + l.r + hy) / vy));
    const k0 = Math.max(0, Math.floor((l.z - l.r + hz) / vz));
    const k1 = Math.min(nz - 1, Math.ceil((l.z + l.r + hz) / vz));
    const inv = 1 / (l.r * l.r);
    for (let k = k0; k <= k1; k++) {
      const pz = -hz + (k + 0.5) * vz - l.z;
      for (let j = j0; j <= j1; j++) {
        const py = -hy + (j + 0.5) * vy - l.y;
        const row = (k * ny + j) * nx;
        for (let i = i0; i <= i1; i++) {
          const px = -hx + (i + 0.5) * vx - l.x;
          const q = (px * px + py * py + pz * pz) * inv;
          if (q >= 1) continue;
          const f = (1 - q) * (1 - q);
          const idx = row + i;
          keep[idx] *= 1 - f;
          if (f > best[idx]) {
            best[idx] = f;
            order[idx] = l.t;
          }
        }
      }
    }
  }
  const out = new Uint8Array(nx * ny * nz * 2);
  const baseBand = Math.max(vy * 2, hy * 0.18);
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      const y = -hy + (j + 0.5) * vy;
      const base = clamp((y - shape.baseY) / baseBand, 0, 1);
      const baseMask = base * base * (3 - 2 * base);
      for (let i = 0; i < nx; i++) {
        const idx = (k * ny + j) * nx + i;
        const cov = (1 - keep[idx]) * baseMask;
        out[idx * 2] = Math.round(clamp(cov, 0, 1) * 255);
        out[idx * 2 + 1] = Math.round(clamp(order[idx] / 1.2, 0, 1) * 255);
      }
    }
  }
  return out;
}
