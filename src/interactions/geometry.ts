import { type Orientation, type Point2, prepareStroke, shapeHalfAfterBuild } from '../clouds/shape';
import { type Vec3, add, dot, scale, sub } from '../math/vec';
import { type Camera, horizontalForward, intersectPlane, rayDirection } from '../renderer/camera';
import { DEG } from '../math/vec';
import type { CloudDoc } from '../state/scene';

/** New clouds are drawn onto a vertical plane this far (km, horizontally) in front of the camera. */
export const DRAW_DISTANCE_KM = 9;
/** Lowest allowed cloud base above the ground (km). */
export const MIN_BASE_KM = 0.35;

/** Looking down from at least this high, strokes are drawn as cloud footprints. */
export const TOP_DOWN_MIN_ALTITUDE_KM = 4;
export const TOP_DOWN_PITCH = -22 * DEG;
/** Altitude of the horizontal drawing plane (a typical cumulus base). */
export const FOOTPRINT_ALTITUDE_KM = 2.2;

export interface DrawPlane {
  readonly orientation: Orientation;
  readonly origin: Vec3;
  readonly normal: Vec3;
  /** In-plane axes: right maps to stroke x; `along` maps to stroke y. */
  readonly right: Vec3;
  readonly along: Vec3;
}

export function drawPlane(cam: Camera, distance = DRAW_DISTANCE_KM): DrawPlane {
  const fwd = horizontalForward(cam);
  const right: Vec3 = [-fwd[2], 0, fwd[0]];
  const topDown = cam.position[1] >= TOP_DOWN_MIN_ALTITUDE_KM && cam.forward[1] < Math.sin(TOP_DOWN_PITCH);
  if (topDown) {
    return { orientation: 'horizontal', origin: [cam.position[0], FOOTPRINT_ALTITUDE_KM, cam.position[2]], normal: [0, 1, 0], right, along: fwd };
  }
  const origin: Vec3 = [cam.position[0] + fwd[0] * distance, 0, cam.position[2] + fwd[2] * distance];
  return { orientation: 'vertical', origin, normal: fwd, right, along: [0, 1, 0] };
}

/** NDC (-1..1, y up) → 2D point on the drawing plane (stroke space, km). */
export function ndcToPlane(cam: Camera, plane: DrawPlane, ndcX: number, ndcY: number): Point2 | null {
  const dir = rayDirection(cam, ndcX, ndcY);
  const hit = intersectPlane(cam.position, dir, plane.origin, plane.normal);
  if (!hit) return null;
  const rel = sub(hit, plane.origin);
  return { x: dot(rel, plane.right), y: plane.orientation === 'vertical' ? hit[1] : dot(rel, plane.along) };
}

/** Cloud yaw so its local frame faces the camera (local −z = camera's horizontal forward). */
export function facingYaw(cam: Camera): number {
  const f = horizontalForward(cam);
  return -Math.atan2(f[0], -f[2]);
}

export type StrokeResult =
  | { ok: true; cloud: Omit<CloudDoc, 'id' | 'order'> }
  | { ok: false; reason: 'too-short' | 'off-plane' };

/** Turn screen-space stroke samples (NDC) into a new cloud document. */
export function strokeToCloud(cam: Camera, ndc: readonly Point2[], seed: number): StrokeResult {
  const plane = drawPlane(cam);
  const pts: Point2[] = [];
  for (const p of ndc) {
    const q = ndcToPlane(cam, plane, p.x, p.y);
    if (q) pts.push(q);
  }
  if (pts.length < 2) return { ok: false, reason: 'off-plane' };
  const prepared = prepareStroke(pts);
  if (!prepared) return { ok: false, reason: 'too-short' };
  const orientation = plane.orientation;
  const { baseY } = shapeHalfAfterBuild(prepared.points, prepared.closed, seed, orientation);
  const yaw = facingYaw(cam);
  if (orientation === 'horizontal') {
    const c = add(add(plane.origin, scale(plane.right, prepared.center.x)), scale(plane.along, prepared.center.y));
    const position: Vec3 = [c[0], Math.max(FOOTPRINT_ALTITUDE_KM, MIN_BASE_KM - baseY), c[2]];
    return { ok: true, cloud: { seed, stroke: prepared.points, closed: prepared.closed, orientation, position, scale: 1, yaw } };
  }
  const altitude = Math.max(prepared.center.y, MIN_BASE_KM - baseY);
  const position = add(add(plane.origin, scale(plane.right, prepared.center.x)), [0, altitude, 0]);
  return {
    ok: true,
    cloud: { seed, stroke: prepared.points, closed: prepared.closed, position, scale: 1, yaw },
  };
}
