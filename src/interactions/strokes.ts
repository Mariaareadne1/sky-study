import type { Point2 } from '../clouds/shape';

/**
 * Live and fading strokes, in CSS pixels. Kept outside React so the SVG
 * overlay and the recording compositor read the same data every frame.
 */
export interface LiveStroke {
  readonly id: number;
  readonly points: Point2[];
  /** performance.now() when the pointer was released; null while drawing. */
  releasedAt: number | null;
  /** True when the stroke became a cloud (fades slowly); false = rejected (fades fast). */
  accepted: boolean;
}

export const STROKE_HOLD_MS = 700;
export const STROKE_FADE_MS = 1100;
const REJECT_FADE_MS = 380;

let nextId = 1;
const strokes: LiveStroke[] = [];

export function beginStroke(p: Point2): LiveStroke {
  const s: LiveStroke = { id: nextId++, points: [p], releasedAt: null, accepted: false };
  strokes.push(s);
  return s;
}

export function addPoint(s: LiveStroke, p: Point2) {
  const last = s.points[s.points.length - 1];
  if (last && Math.hypot(p.x - last.x, p.y - last.y) < 1.2) return;
  s.points.push(p);
}

export function releaseStroke(s: LiveStroke, accepted: boolean, now: number) {
  s.releasedAt = now;
  s.accepted = accepted;
}

export function strokeOpacity(s: LiveStroke, now: number): number {
  if (s.releasedAt === null) return 1;
  const t = now - s.releasedAt;
  if (!s.accepted) return Math.max(0, 1 - t / REJECT_FADE_MS);
  if (t < STROKE_HOLD_MS) return 1;
  return Math.max(0, 1 - (t - STROKE_HOLD_MS) / STROKE_FADE_MS);
}

/** Visible strokes; prunes finished ones. */
export function liveStrokes(now: number): readonly LiveStroke[] {
  for (let i = strokes.length - 1; i >= 0; i--) if (strokeOpacity(strokes[i], now) <= 0) strokes.splice(i, 1);
  return strokes;
}

export function clearStrokes() {
  strokes.length = 0;
}

/** Smooth SVG path through the samples (quadratic curves through midpoints). */
export function strokePath(pts: readonly Point2[]): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M${pts[0].x},${pts[0].y}l0.01,0`;
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    d += `Q${pts[i].x.toFixed(1)},${pts[i].y.toFixed(1)} ${mx.toFixed(1)},${my.toFixed(1)}`;
  }
  const last = pts[pts.length - 1];
  return `${d}L${last.x.toFixed(1)},${last.y.toFixed(1)}`;
}

/** Same stroke, drawn into a 2D canvas (used when recording video). */
export function drawStrokes(ctx: CanvasRenderingContext2D, now: number, pxScale: number) {
  for (const s of liveStrokes(now)) {
    const a = strokeOpacity(s, now);
    if (a <= 0 || s.points.length === 0) continue;
    ctx.save();
    ctx.globalAlpha = a * 0.95;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2 * pxScale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(new Path2D(strokePath(s.points.map((p) => ({ x: p.x * pxScale, y: p.y * pxScale })))));
    ctx.restore();
  }
}
