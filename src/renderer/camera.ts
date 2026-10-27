import { type Vec3, DEG, add, cross, dot, normalize, scale, sub } from '../math/vec';

/**
 * Observer camera. World units are kilometres, +Y up. The camera flies freely:
 * a position (x, altitude, z) and a direction given by yaw (0 = -Z, positive
 * toward +X) and pitch. There is no roll.
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
export const PITCH_MIN = -82 * DEG;
export const PITCH_MAX = 75 * DEG;
export const ALTITUDE_MIN = 0.05;
export const ALTITUDE_MAX = 16;
/** How far the camera may roam horizontally from the origin (km). */
export const ROAM_RADIUS_KM = 60;

export interface View {
  /** Horizontal position (km). */
  readonly x: number;
  readonly z: number;
  /** Radians; 0 looks along -Z, positive turns toward +X. */
  readonly yaw: number;
  /** Radians above the horizon (negative looks down). */
  readonly pitch: number;
  /** Camera altitude in km. */
  readonly altitude: number;
}

export const DEFAULT_VIEW: View = { x: 0, z: 0, yaw: 0, pitch: CAMERA_PITCH, altitude: CAMERA_ALTITUDE_KM };

export function clampView(v: View): View {
  const twoPi = Math.PI * 2;
  let yaw = v.yaw % twoPi;
  if (yaw > Math.PI) yaw -= twoPi;
  if (yaw < -Math.PI) yaw += twoPi;
  const fin = (n: number) => (Number.isFinite(n) ? n : 0);
  let x = fin(v.x);
  let z = fin(v.z);
  const r = Math.hypot(x, z);
  if (r > ROAM_RADIUS_KM) {
    x *= ROAM_RADIUS_KM / r;
    z *= ROAM_RADIUS_KM / r;
  }
  return {
    x,
    z,
    yaw: Number.isFinite(yaw) ? yaw : 0,
    pitch: Math.min(PITCH_MAX, Math.max(PITCH_MIN, Number.isFinite(v.pitch) ? v.pitch : CAMERA_PITCH)),
    altitude: Math.min(ALTITUDE_MAX, Math.max(ALTITUDE_MIN, Number.isFinite(v.altitude) ? v.altitude : CAMERA_ALTITUDE_KM)),
  };
}

export function createCamera(aspect: number, view: View = DEFAULT_VIEW, fovY = CAMERA_FOV_Y): Camera {
  const { yaw, pitch, altitude } = view;
  const x = Number.isFinite(view.x) ? view.x : 0;
  const z = Number.isFinite(view.z) ? view.z : 0;
  const forward = normalize([Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)]);
  const right = normalize(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  return { position: [x, altitude, z], forward, right, up, fovY, aspect };
}

/** Cloud yaw that makes a cloud's local frame face a camera with this view yaw. */
export const yawFacing = (viewYaw: number): number => -viewYaw;

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
