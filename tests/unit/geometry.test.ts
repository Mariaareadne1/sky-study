import { describe, expect, test } from 'vitest';
import { buildShape, prepareStroke } from '../../src/clouds/shape';
import { testStroke } from '../../src/clouds/testStrokes';
import { DRAW_DISTANCE_KM, MIN_BASE_KM, drawPlane, ndcToPlane, strokeToCloud } from '../../src/interactions/geometry';
import { cloudDistance, moveToDistance, pickCloud, rayHitCloud } from '../../src/interactions/picking';
import { type Vec3, length, sub } from '../../src/math/vec';
import { createCamera, project, rayDirection } from '../../src/renderer/camera';
import type { CloudDoc } from '../../src/state/scene';

const cam = createCamera(16 / 10);

function cloudAt(position: Vec3, scale = 1, seed = 5): { doc: CloudDoc; shape: ReturnType<typeof buildShape> } {
  const p = prepareStroke(testStroke('wave'))!;
  const doc: CloudDoc = { id: `c${seed}`, seed, stroke: p.points, closed: p.closed, position, scale, yaw: 0, order: 0 };
  return { doc, shape: buildShape(p.points, p.closed, seed) };
}

describe('camera', () => {
  test('ray direction and projection are inverses', () => {
    for (const [x, y] of [[0, 0], [0.5, -0.3], [-0.9, 0.8]]) {
      const d = rayDirection(cam, x, y);
      const p = project(cam, [cam.position[0] + d[0] * 7, cam.position[1] + d[1] * 7, cam.position[2] + d[2] * 7])!;
      expect(p.x).toBeCloseTo(x, 6);
      expect(p.y).toBeCloseTo(y, 6);
    }
  });

  test('points behind the camera do not project', () => {
    expect(project(cam, [0, 1, 5])).toBeNull();
  });
});

describe('drawing plane', () => {
  test('screen points land on a vertical plane at the drawing distance', () => {
    const plane = drawPlane(cam);
    expect(-plane.origin[2]).toBeCloseTo(DRAW_DISTANCE_KM, 6);
    const centre = ndcToPlane(cam, plane, 0, 0)!;
    expect(centre.x).toBeCloseTo(0, 6);
    expect(centre.y).toBeGreaterThan(cam.position[1]);
    const right = ndcToPlane(cam, plane, 0.5, 0)!;
    expect(right.x).toBeGreaterThan(0);
  });

  test('aspect changes (resize) keep NDC → plane mapping consistent', () => {
    const wide = createCamera(2.2);
    const narrow = createCamera(0.6);
    const a = ndcToPlane(wide, drawPlane(wide), 0, 0.4)!;
    const b = ndcToPlane(narrow, drawPlane(narrow), 0, 0.4)!;
    expect(a.y).toBeCloseTo(b.y, 6); // vertical FOV is fixed
    expect(ndcToPlane(wide, drawPlane(wide), 1, 0)!.x).toBeGreaterThan(ndcToPlane(narrow, drawPlane(narrow), 1, 0)!.x);
  });

  test('a stroke becomes a cloud centred where it was drawn, above the ground', () => {
    const ndc = Array.from({ length: 30 }, (_, i) => ({ x: -0.3 + (i / 29) * 0.6, y: 0.2 + Math.sin(i / 4) * 0.05 }));
    const res = strokeToCloud(cam, ndc, 9);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const p = project(cam, res.cloud.position)!;
    expect(Math.abs(p.x)).toBeLessThan(0.05);
    expect(p.y).toBeGreaterThan(0.1);
    const shape = buildShape(res.cloud.stroke, res.cloud.closed, res.cloud.seed);
    expect(res.cloud.position[1] + shape.baseY).toBeGreaterThanOrEqual(MIN_BASE_KM - 1e-9);
  });

  test('a stroke drawn below the horizon is lifted above the ground', () => {
    const ndc = Array.from({ length: 30 }, (_, i) => ({ x: -0.3 + (i / 29) * 0.6, y: -0.8 }));
    const res = strokeToCloud(cam, ndc, 9);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const shape = buildShape(res.cloud.stroke, res.cloud.closed, res.cloud.seed);
    expect(res.cloud.position[1] + shape.baseY).toBeGreaterThanOrEqual(MIN_BASE_KM - 1e-9);
  });

  test('a tiny stroke is rejected', () => {
    const res = strokeToCloud(cam, [{ x: 0, y: 0.2 }, { x: 0.001, y: 0.2 }], 1);
    expect(res).toEqual({ ok: false, reason: 'too-short' });
  });
});

describe('picking and perspective', () => {
  test('a ray through the cloud centre hits; a ray beside it misses', () => {
    const { doc, shape } = cloudAt([0, 3, -9]);
    const toCentre = sub(doc.position, cam.position);
    const dir = toCentre.map((v) => v / length(toCentre)) as unknown as Vec3;
    expect(rayHitCloud(cam.position, dir, doc, shape)).not.toBeNull();
    expect(rayHitCloud(cam.position, [0, 1, 0], doc, shape)).toBeNull();
  });

  test('the nearer of two overlapping clouds is picked', () => {
    const near = cloudAt([0, 3, -8], 1, 1);
    const far = cloudAt([0, 3.9, -18], 1, 2);
    const shapes = new Map([[near.doc.id, near.shape], [far.doc.id, far.shape]]);
    const toNear = sub(near.doc.position, cam.position);
    const dir = toNear.map((v) => v / length(toNear)) as unknown as Vec3;
    expect(pickCloud(cam.position, dir, [far.doc, near.doc], (c) => shapes.get(c.id)!)?.id).toBe(near.doc.id);
  });

  test('moving farther keeps altitude and shrinks the projected size', () => {
    const { doc, shape } = cloudAt([1, 3, -9]);
    const width = (pos: Vec3) => {
      const halfW = shape.half[0] * doc.scale;
      const a = project(cam, [pos[0] - halfW, pos[1], pos[2]])!;
      const b = project(cam, [pos[0] + halfW, pos[1], pos[2]])!;
      return b.x - a.x;
    };
    const far = moveToDistance(cam.position, doc.position, 20);
    expect(far[1]).toBe(doc.position[1]);
    expect(cloudDistance(cam.position, { position: far })).toBeCloseTo(20, 6);
    const ratio = width(far) / width(doc.position);
    expect(ratio).toBeLessThan(0.55);
    expect(ratio).toBeGreaterThan(0.35);
  });

  test('scale is independent of distance', () => {
    const big = cloudAt([0, 3, -18], 2);
    const small = cloudAt([0, 3, -9], 1);
    expect(big.doc.position[2]).not.toBe(small.doc.position[2]);
    expect(big.doc.scale).toBe(2);
    expect(big.shape).toEqual(small.shape); // same gesture & seed: geometry identical; only the transform differs
  });
});
