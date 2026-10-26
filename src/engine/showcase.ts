import type { Point2 } from '../clouds/shape';
import { strokeToCloud } from '../interactions/geometry';
import { cloudDistance, moveToDistance } from '../interactions/picking';
import { addPoint, beginStroke, releaseStroke } from '../interactions/strokes';
import { PRESETS } from '../atmosphere/timeOfDay';
import { emptyScene } from '../state/scene';
import { useSky } from '../state/store';
import type { Engine } from './Engine';
import { easeOutCubic } from './Engine';

/**
 * A ~24 s scripted demo that drives the *real* application: synthetic pointer
 * strokes go through the same stroke → cloud pipeline, moves go through the
 * store, and lighting changes use the same presets as the UI.
 */

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = window.setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      window.clearTimeout(t);
      reject(new DOMException('aborted', 'AbortError'));
    });
  });

const frame = () => new Promise<number>((r) => requestAnimationFrame(r));

const hourOf = (id: string) => PRESETS.find((p) => p.id === id)!.hour;

/** Draw a path (fractions of the viewport) over `ms`, then turn it into a cloud. */
async function drawGesture(engine: Engine, path: (u: number) => Point2, ms: number, seed: number, signal: AbortSignal) {
  const { width, height } = engine.size;
  const toPx = (p: Point2) => ({ x: p.x * width, y: p.y * height });
  const stroke = beginStroke(toPx(path(0)));
  const t0 = performance.now();
  for (;;) {
    if (signal.aborted) throw new DOMException('aborted', 'AbortError');
    const now = await frame();
    const u = Math.min(1, (now - t0) / ms);
    // ease the pen like a hand: accelerate, cruise, settle
    const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
    const steps = 6;
    for (let k = 1; k <= steps; k++) addPoint(stroke, toPx(path(e * (k / steps) + (1 - k / steps) * Math.max(0, e - 0.02))));
    if (u >= 1) break;
  }
  const ndc = stroke.points.map((p) => ({ x: (p.x / width) * 2 - 1, y: 1 - (p.y / height) * 2 }));
  const res = strokeToCloud(engine.camera, ndc, seed);
  const st = useSky.getState();
  if (!res.ok) {
    releaseStroke(stroke, false, performance.now());
    return null;
  }
  const id = `showcase-${seed}`;
  const order = Math.max(0, ...st.scene.clouds.map((c) => c.order)) + 1;
  const ok = st.addCloud({ ...res.cloud, id, order }, performance.now());
  releaseStroke(stroke, ok, performance.now());
  return ok ? id : null;
}

export async function runShowcase(engine: Engine, signal: AbortSignal): Promise<void> {
  const st = useSky.getState();
  st.apply(() => emptyScene(hourOf('noon')));
  st.select(null);
  st.setUiHidden(true);
  try {
    await wait(900, signal);
    // 1. a small curved line → first cloud
    const a = await drawGesture(
      engine,
      (u) => ({ x: 0.56 + u * 0.2, y: 0.47 - Math.sin(u * Math.PI) * 0.09 + u * 0.02 }),
      1500,
      20251,
      signal,
    );
    await wait(3000, signal);
    // 2. a larger, looping gesture → a different silhouette
    await drawGesture(
      engine,
      (u) => {
        const t = u * Math.PI * 2;
        return { x: 0.3 + Math.sin(t) * 0.11 + u * 0.03, y: 0.42 - Math.cos(t) * 0.1 + Math.sin(t * 2) * 0.012 };
      },
      2100,
      77001,
      signal,
    );
    await wait(2200, signal);
    // 3. push the first cloud far away — perspective shrinks it
    if (a) {
      const c = useSky.getState().scene.clouds.find((x) => x.id === a);
      if (c) {
        const cam = engine.camera.position;
        const d0 = cloudDistance(cam, c);
        const d1 = d0 * 2.3;
        useSky.getState().begin();
        const t0 = performance.now();
        for (;;) {
          if (signal.aborted) throw new DOMException('aborted', 'AbortError');
          const now = await frame();
          const u = easeOutCubic((now - t0) / 2600);
          const p = moveToDistance(cam, c.position, d0 + (d1 - d0) * u);
          useSky.getState().updateCloud(a, { position: [p[0] + u * 1.2, p[1] + u * 1.4, p[2]] });
          if (u >= 1) break;
        }
        useSky.getState().end();
      }
    }
    await wait(700, signal);
    // 4. light: golden hour → blue hour → moonlight → back to golden
    useSky.getState().setHour(hourOf('golden'));
    await wait(3600, signal);
    useSky.getState().setHour(hourOf('dusk'));
    await wait(2600, signal);
    useSky.getState().setHour(hourOf('night'));
    await wait(3000, signal);
    useSky.getState().setHour(hourOf('golden'));
    await wait(3200, signal);
  } finally {
    useSky.getState().setUiHidden(false);
  }
}
