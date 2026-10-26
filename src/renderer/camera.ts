import { type Vec3, DEG, add, cross, dot, normalize, scale, sub } from '../math/vec';

/**
 * Fixed observer camera. World units are kilometres, +Y up, the camera looks
 * along -Z (pitched slightly up) from a viewpoint above the ground.
 */
export interface Camera {
  readonly position: Vec3;
  readonly forward: Vec3;
  readonly right: Vec3;
  readonly up: Vec3;
  /** Vertical field of view, radians. */
  readonly fovY: number;
  readonly aspect: number;
}

export const CAMERA_ALTITUDE_KM = 1.0;
export const CAMERA_PITCH = 15 * DEG;
export const CAMERA_FOV_Y = 50 * DEG;

export function createCamera(aspect: number, pitch = CAMERA_PITCH, fovY = CAMERA_FOV_Y): Camera {
  const forward = normalize([0, Math.sin(pitch), -Math.cos(pitch)]);
  const right = normalize(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  return { position: [0, CAMERA_ALTITUDE_KM, 0], forward, right, up, fovY, aspect };
}

/** Normalised device coordinates (-1..1, y up) → world-space ray direction. */
export function rayDirection(cam: Camera, ndcX: number, ndcY: number): Vec3 {
  const th = Math.tan(cam.fovY / 2);
  return normalize(add(add(cam.forward, scale(cam.right, ndcX * th * cam.aspect)), scale(cam.up, ndcY * th)));
}

/** World point → NDC (x, y) and view depth along forward. Returns null when behind the camera. */
export function project(cam: Camera, p: Vec3): { x: number; y: number; depth: number } | null {
  const rel = sub(p, cam.position);
  const depth = dot(rel, cam.forward);
  if (depth <= 1e-6) return null;
  const th = Math.tan(cam.fovY / 2);
  return {
    x: dot(rel, cam.right) / (depth * th * cam.aspect),
    y: dot(rel, cam.up) / (depth * th),
    depth,
  };
}

/** Intersect a ray with the plane through `point` having normal `normal`. */
export function intersectPlane(origin: Vec3, dir: Vec3, point: Vec3, normal: Vec3): Vec3 | null {
  const denom = dot(dir, normal);
  if (Math.abs(denom) < 1e-8) return null;
  const t = dot(sub(point, origin), normal) / denom;
  if (t <= 0) return null;
  return add(origin, scale(dir, t));
}

/** Horizontal forward direction (the normal of vertical drawing planes facing the camera). */
export function horizontalForward(cam: Camera): Vec3 {
  return normalize([cam.forward[0], 0, cam.forward[2]]);
}
