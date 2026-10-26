import type { CloudShape } from '../clouds/shape';
import { type Vec3, add, dot, length, scale, sub } from '../math/vec';

import type { CloudDoc } from '../state/scene';

/** Lobes are shrunk slightly: the noise erodes their outer shell. */
const LOBE_HIT_SCALE = 0.82;

/** World direction/offset → a cloud's shape space (undo yaw and scale). */
export function toShapeSpace(c: Pick<CloudDoc, 'yaw' | 'scale'>, v: Vec3): Vec3 {
  const cs = Math.cos(c.yaw);
  const sn = Math.sin(c.yaw);
  return [(cs * v[0] - sn * v[2]) / c.scale, v[1] / c.scale, (sn * v[0] + cs * v[2]) / c.scale];
}

/**
 * Distance along a world ray to a cloud's lobes, or null. Works on the
 * gesture lobes rather than the noisy rendered density, so hits are
 * stable and forgiving.
 */
export function rayHitCloud(origin: Vec3, dir: Vec3, c: CloudDoc, shape: CloudShape, center: Vec3 = c.position): number | null {
  const o = toShapeSpace(c, sub(origin, center));
  const d = toShapeSpace(c, dir);
  const a = dot(d, d);
  let best: number | null = null;
  for (const l of shape.lobes) {
    const oc = sub(o, [l.x, l.y, l.z]);
    const r = l.r * LOBE_HIT_SCALE;
    const b = dot(oc, d);
    const cc = dot(oc, oc) - r * r;
    const disc = b * b - a * cc;
    if (disc < 0) continue;
    const t = (-b - Math.sqrt(disc)) / a;
    const tt = t > 0 ? t : (-b + Math.sqrt(disc)) / a;
    if (tt > 0 && (best === null || tt < best)) best = tt;
  }
  return best;
}

export interface CloudPick {
  readonly id: string;
  readonly t: number;
  readonly point: Vec3;
}

export function pickCloud(
  origin: Vec3,
  dir: Vec3,
  clouds: readonly CloudDoc[],
  shapeOf: (c: CloudDoc) => CloudShape,
  centerOf: (c: CloudDoc) => Vec3 = (c) => c.position,
): CloudPick | null {
  let best: CloudPick | null = null;
  for (const c of clouds) {
    const t = rayHitCloud(origin, dir, c, shapeOf(c), centerOf(c));
    if (t !== null && (!best || t < best.t)) best = { id: c.id, t, point: add(origin, scale(dir, t)) };
  }
  return best;
}

/** Distance from the camera to a cloud's centre. */
export const cloudDistance = (camPos: Vec3, c: Pick<CloudDoc, 'position'>): number => length(sub(c.position, camPos));

/**
 * Move a cloud to a new distance from the camera, keeping its altitude and
 * bearing: like a real cloud receding, it sinks toward the horizon as it shrinks.
 */
export function moveToDistance(camPos: Vec3, position: Vec3, distance: number): Vec3 {
  const dx = position[0] - camPos[0];
  const dz = position[2] - camPos[2];
  const dy = position[1] - camPos[1];
  const horiz = Math.hypot(dx, dz) || 1e-6;
  const targetH = Math.sqrt(Math.max(distance * distance - dy * dy, 0.25));
  const k = targetH / horiz;
  return [camPos[0] + dx * k, position[1], camPos[2] + dz * k];
}

/** World-space extent of the visible cloud (lobes shrunk by the noise erosion), in km. */
export function cloudExtent(c: Pick<CloudDoc, 'scale'>, shape: CloudShape): { w: number; h: number; d: number } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const l of shape.lobes) {
    const r = l.r * LOBE_HIT_SCALE;
    minX = Math.min(minX, l.x - r); maxX = Math.max(maxX, l.x + r);
    minY = Math.min(minY, Math.max(l.y - r, shape.baseY)); maxY = Math.max(maxY, l.y + r);
    minZ = Math.min(minZ, l.z - r); maxZ = Math.max(maxZ, l.z + r);
  }
  return { w: (maxX - minX) * c.scale, h: (maxY - minY) * c.scale, d: (maxZ - minZ) * c.scale };
}
