import { type Point2, prepareStroke, shapeHalfAfterBuild } from '../clouds/shape';
import { type Vec3, add, dot, scale, sub } from '../math/vec';
import { type Camera, horizontalForward, intersectPlane, rayDirection } from '../renderer/camera';
import type { CloudDoc } from '../state/scene';

/** New clouds are drawn onto a vertical plane this far (km, horizontally) in front of the camera. */
export const DRAW_DISTANCE_KM = 9;
/** Lowest allowed cloud base above the ground (km). */
export const MIN_BASE_KM = 0.35;

export interface DrawPlane {
  readonly origin: Vec3;
  readonly normal: Vec3;
  readonly right: Vec3;
}

export function drawPlane(cam: Camera, distance = DRAW_DISTANCE_KM): DrawPlane {
  const normal = horizontalForward(cam);
  const origin: Vec3 = [cam.position[0] + normal[0] * distance, 0, cam.position[2] + normal[2] * distance];
  const right: Vec3 = [-normal[2], 0, normal[0]];
  return { origin, normal, right };
}

/** NDC (-1..1, y up) → 2D point on the drawing plane (x along plane right, y = world altitude). */
export function ndcToPlane(cam: Camera, plane: DrawPlane, ndcX: number, ndcY: number): Point2 | null {
  const dir = rayDirection(cam, ndcX, ndcY);
  const hit = intersectPlane(cam.position, dir, plane.origin, plane.normal);
  if (!hit) return null;
  return { x: dot(sub(hit, plane.origin), plane.right), y: hit[1] };
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
  const { baseY } = shapeHalfAfterBuild(prepared.points, prepared.closed, seed);
  const altitude = Math.max(prepared.center.y, MIN_BASE_KM - baseY);
  const position = add(add(plane.origin, scale(plane.right, prepared.center.x)), [0, altitude, 0]);
  return {
    ok: true,
    cloud: { seed, stroke: prepared.points, closed: prepared.closed, position, scale: 1, yaw: 0 },
  };
}
