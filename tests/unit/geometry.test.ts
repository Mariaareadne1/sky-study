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

describe('changing perspective', () => {
  test('clamping keeps a free-flying camera sane', async () => {
    const { clampView, ROAM_RADIUS_KM } = await import('../../src/renderer/camera');
    const v = clampView({ x: 500, z: -500, yaw: 7, pitch: -3, altitude: 999 });
    expect(Math.abs(v.yaw)).toBeLessThanOrEqual(Math.PI);
    expect(v.pitch).toBeGreaterThan(-Math.PI / 2);
    expect(v.altitude).toBeLessThanOrEqual(16);
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(ROAM_RADIUS_KM, 6);
    expect(clampView({ x: NaN, z: 1, yaw: 0, pitch: 0, altitude: 1 }).x).toBe(0);
  });

  test('flight moves relative to the facing direction and scales with altitude', async () => {
    const { stepFlight, glide } = await import('../../src/interactions/flight');
    const base = { x: 0, z: 0, yaw: 0, pitch: 0, altitude: 1 };
    const fwd = stepFlight(base, 1000, new Set(['forward'] as const), false)!;
    expect(fwd.z).toBeLessThan(0); // facing -Z
    expect(fwd.x).toBeCloseTo(0, 9);
    const turned = stepFlight({ ...base, yaw: Math.PI / 2 }, 1000, new Set(['forward'] as const), false)!;
    expect(turned.x).toBeGreaterThan(0); // facing +X
    const right = stepFlight(base, 1000, new Set(['right'] as const), false)!;
    expect(right.x).toBeGreaterThan(0);
    const up = stepFlight(base, 1000, new Set(['up'] as const), false)!;
    expect(up.altitude).toBeGreaterThan(1);
    const high = stepFlight({ ...base, altitude: 9 }, 1000, new Set(['forward'] as const), false)!;
    expect(Math.abs(high.z)).toBeGreaterThan(Math.abs(fwd.z) * 2);
    const fast = stepFlight(base, 1000, new Set(['forward'] as const), true)!;
    expect(Math.abs(fast.z)).toBeCloseTo(Math.abs(fwd.z) * 3, 6);
    expect(stepFlight(base, 16, new Set(), false)).toBeNull();
    // glide follows pitch: looking down descends
    expect(glide({ ...base, pitch: -0.5 }, 1).altitude).toBeLessThan(1);
  });

  test('a camera that has flown away still draws clouds in front of it', () => {
    const cam = createCamera(1.6, { x: 12, z: -20, yaw: 1.2, pitch: 0.2, altitude: 1.5 });
    const ndc = Array.from({ length: 30 }, (_, i) => ({ x: -0.3 + (i / 29) * 0.6, y: 0.15 }));
    const res = strokeToCloud(cam, ndc, 3);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const p = project(cam, res.cloud.position)!;
    expect(Math.abs(p.x)).toBeLessThan(0.05);
    expect(p.depth).toBeGreaterThan(5);
  });

  test('a turned camera draws on a plane facing it, and the cloud lands under the stroke', () => {
    const view = { x: 0, z: 0, yaw: 0.8, pitch: 0.2, altitude: 1 };
    const cam = createCamera(1.6, view);
    const ndc = Array.from({ length: 30 }, (_, i) => ({ x: -0.3 + (i / 29) * 0.6, y: 0.15 + Math.sin(i / 4) * 0.05 }));
    const res = strokeToCloud(cam, ndc, 4);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const p = project(cam, res.cloud.position)!;
    expect(Math.abs(p.x)).toBeLessThan(0.05);
    expect(res.cloud.yaw).toBeCloseTo(-0.8, 6);
    // the drawn stroke's direction maps onto the camera's right axis
    const { doc, shape } = { doc: { ...res.cloud, id: 't', order: 0 }, shape: buildShape(res.cloud.stroke, res.cloud.closed, res.cloud.seed) };
    const toCentre = sub(doc.position, cam.position);
    const dir = toCentre.map((v) => v / length(toCentre)) as unknown as Vec3;
    expect(rayHitCloud(cam.position, dir, doc, shape)).not.toBeNull();
  });

  test('looking down from above, a stroke becomes a horizontal footprint', () => {
    const cam = createCamera(1.6, { x: 0, z: 0, yaw: 0, pitch: -0.87, altitude: 11 });
    const ndc = Array.from({ length: 60 }, (_, i) => {
      const t = (i / 59) * Math.PI * 2;
      return { x: Math.sin(t) * 0.35, y: Math.cos(t) * 0.12 };
    });
    const res = strokeToCloud(cam, ndc, 8);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.cloud.orientation).toBe('horizontal');
    expect(res.cloud.position[1]).toBeCloseTo(2.2, 1);
    const shape = buildShape(res.cloud.stroke, res.cloud.closed, res.cloud.seed, 'horizontal');
    // wide footprint, comparatively shallow but still a 3D mass
    expect(shape.half[0]).toBeGreaterThan(shape.half[1]);
    expect(shape.half[1]).toBeGreaterThan(0.2);
    // the cloud sits where the stroke was drawn
    const p = project(cam, res.cloud.position)!;
    expect(Math.abs(p.x)).toBeLessThan(0.08);
  });
});
