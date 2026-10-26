import { describe, expect, test } from 'vitest';
import { SLOT_DIMS, bakeEnvelope, bounds, buildShape, isClosedGesture, pathLength, prepareStroke, resample, smooth } from '../../src/clouds/shape';
import { type TestStrokeId, testStroke } from '../../src/clouds/testStrokes';

const ALL: TestStrokeId[] = ['wave', 'vertical', 'circle', 'arc', 'heart', 'squiggle', 'short', 'scribble', 'hook'];

const build = (id: TestStrokeId, seed = 11) => {
  const p = prepareStroke(testStroke(id))!;
  return buildShape(p.points, p.closed, seed);
};

describe('stroke processing', () => {
  test('resample produces evenly spaced, finite points that keep the endpoints', () => {
    const pts = resample(testStroke('squiggle'), 50);
    expect(pts).toHaveLength(50);
    expect(pts[0]).toEqual(testStroke('squiggle')[0]);
    const gaps = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y));
    const mean = gaps.reduce((a, b) => a + b) / gaps.length;
    for (const g of gaps) expect(Math.abs(g - mean)).toBeLessThan(mean * 0.35);
    for (const p of pts) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });

  test('smoothing is stable: repeated passes converge and keep endpoints', () => {
    const raw = testStroke('scribble');
    const once = smooth(raw, 1);
    const many = smooth(raw, 6);
    expect(many[0]).toEqual(raw[0]);
    expect(many[many.length - 1]).toEqual(raw[raw.length - 1]);
    expect(pathLength(many)).toBeLessThan(pathLength(once));
  });

  test('closed gestures are detected; open ones are not', () => {
    expect(isClosedGesture(testStroke('circle'))).toBe(true);
    expect(isClosedGesture(testStroke('heart'))).toBe(true);
    expect(isClosedGesture(testStroke('wave'))).toBe(false);
    expect(isClosedGesture(testStroke('arc'))).toBe(false);
  });

  test('rejects strokes that are too short or invalid', () => {
    expect(prepareStroke([{ x: 0, y: 0 }, { x: 0.05, y: 0 }])).toBeNull();
    expect(prepareStroke([{ x: 0, y: 0 }])).toBeNull();
    expect(prepareStroke([{ x: NaN, y: 0 }, { x: Infinity, y: 1 }])).toBeNull();
  });

  test('ignores NaN samples mixed into a valid stroke', () => {
    const pts = [...testStroke('wave')];
    pts.splice(10, 0, { x: NaN, y: NaN });
    const p = prepareStroke(pts)!;
    expect(p).not.toBeNull();
    for (const q of p.points) expect(Number.isFinite(q.x) && Number.isFinite(q.y)).toBe(true);
  });

  test('prepared strokes are centred on the cloud', () => {
    const p = prepareStroke(testStroke('wave').map((q) => ({ x: q.x + 40, y: q.y + 3 })))!;
    const b = bounds(p.points);
    expect(Math.abs((b.minX + b.maxX) / 2)).toBeLessThan(1e-9);
    expect(Math.abs((b.minY + b.maxY) / 2)).toBeLessThan(1e-9);
    expect(p.center.x).toBeCloseTo(40, 0);
  });
});

describe('gesture → volume', () => {
  test('same stroke and seed rebuild an identical cloud', () => {
    expect(build('hook', 42)).toEqual(build('hook', 42));
    expect(bakeEnvelope(build('heart', 3))).toEqual(bakeEnvelope(build('heart', 3)));
  });

  test('different seeds vary the detail but not the overall massing', () => {
    const a = build('wave', 1);
    const b = build('wave', 2);
    expect(a.lobes).not.toEqual(b.lobes);
    expect(Math.abs(a.half[0] - b.half[0]) / a.half[0]).toBeLessThan(0.25);
  });

  test('cloud proportions follow the gesture', () => {
    const wave = build('wave');
    const vertical = build('vertical');
    expect(wave.half[0] / wave.half[1]).toBeGreaterThan(1.6);
    expect(vertical.half[1] / vertical.half[0]).toBeGreaterThan(1.3);
  });

  test('a closed loop fills its interior with a denser cluster than an open arc', () => {
    const circle = build('circle');
    const arc = build('arc');
    expect(circle.closed).toBe(true);
    const env = bakeEnvelope(circle);
    const { x, y, z } = SLOT_DIMS;
    const centre = ((z / 2) * y + y / 2) * x + x / 2;
    expect(env[centre * 2]).toBeGreaterThan(200);
    const arcEnv = bakeEnvelope(arc);
    expect(arcEnv[centre * 2]).toBeLessThan(env[centre * 2]);
  });

  test('every reference gesture yields finite geometry inside its bounds', () => {
    for (const id of ALL) {
      const s = build(id);
      expect(s.lobes.length, id).toBeGreaterThan(3);
      for (const l of s.lobes) {
        for (const v of [l.x, l.y, l.z, l.r, l.t]) expect(Number.isFinite(v), id).toBe(true);
        expect(Math.abs(l.x) + l.r).toBeLessThanOrEqual(s.half[0] + 1e-6);
        expect(Math.abs(l.y) + l.r).toBeLessThanOrEqual(s.half[1] + 1e-6);
      }
      expect(s.baseY).toBeLessThan(0);
    }
  });

  test('baked envelope has the slot size, real coverage and a clear border', () => {
    const env = bakeEnvelope(build('squiggle'));
    const { x, y, z } = SLOT_DIMS;
    expect(env.length).toBe(x * y * z * 2);
    let covered = 0;
    for (let i = 0; i < env.length; i += 2) if (env[i] > 0) covered++;
    expect(covered / (x * y * z)).toBeGreaterThan(0.05);
    expect(covered / (x * y * z)).toBeLessThan(0.9);
    // corners of the box stay empty, so the volume never shows a hard box edge
    expect(env[0]).toBe(0);
    expect(env[(x * y * z - 1) * 2]).toBe(0);
  });
});
