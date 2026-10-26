/**
 * Render spike / regression harness. Deterministic scenes via URL params:
 *   ?hour=12.5 | ?preset=golden   &shapes=wave,heart   &quality=high   &seed=7
 */
import { PRESETS, computeAtmosphere } from './atmosphere/timeOfDay';
import { Renderer, type Quality, type RenderCloud } from './renderer/Renderer';
import { bakeEnvelope, buildShape, prepareStroke } from './clouds/shape';
import { type TestStrokeId, testStroke } from './clouds/testStrokes';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const hud = document.getElementById('hud')!;
const dpr = Math.min(window.devicePixelRatio || 1, 2);
function syncSize() {
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

const preset = PRESETS.find((p) => p.id === params.get('preset'));
let hour = Number(params.get('hour') ?? preset?.hour ?? 12.5);
const quality = (params.get('quality') as Quality) || 'balanced';
const shapes = (params.get('shapes') ?? 'hook').split(',') as TestStrokeId[];
const seed = Number(params.get('seed') ?? 7);
const dist = Number(params.get('dist') ?? 9);

const renderer = new Renderer(canvas, quality);
const clouds: RenderCloud[] = shapes.map((id, i) => {
  const prepared = prepareStroke(testStroke(id, Number(params.get('size') ?? 2.6)))!;
  const shape = buildShape(prepared.points, prepared.closed, seed + i);
  const n = shapes.length;
  const x = (i - (n - 1) / 2) * 3.4;
  return {
    id: `c${i}`,
    shapeKey: `${id}-${seed + i}`,
    envelope: () => bakeEnvelope(shape),
    position: [x, 2.4, -dist],
    scale: 1,
    yaw: 0,
    half: shape.half,
    growth: Number(params.get('growth') ?? 1),
    seed: seed + i,
    density: 1,
  };
});

let frames = 0;
let last = performance.now();
let fpsAcc = 0;
const t0 = performance.now();
function loop(now: number) {
  syncSize();
  const dt = now - last;
  last = now;
  fpsAcc = fpsAcc * 0.95 + dt * 0.05;
  if (params.has('animate')) hour = 5.6 + (((now - t0) / 1000) * 0.6) % 17.5;
  const stats = renderer.render({ clouds, atmosphere: computeAtmosphere(hour), changed: params.has('animate'), time: now / 1000 });
  frames++;
  hud.textContent = `hour ${hour.toFixed(2)} · ${stats.renderWidth}×${stats.renderHeight} · ${(1000 / fpsAcc).toFixed(0)} fps · ${fpsAcc.toFixed(1)} ms · acc ${stats.accumulated}`;
  (window as unknown as { __spike: unknown }).__spike = { frames, ms: fpsAcc, stats };
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
