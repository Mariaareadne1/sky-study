// GPU benchmark of the real renderer: N deterministic clouds at several quality levels.
import { chromium } from '@playwright/test';
const DPR = Number(process.env.DPR ?? 2);
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: DPR });
await page.goto(process.env.URL ?? 'http://localhost:5362/');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => (window.__sky?.engine.frames ?? 0) > 5);
const gpu = await page.evaluate(() => { const gl = window.__sky.engine.renderer.gl; const ext = gl.getExtension('WEBGL_debug_renderer_info'); return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); });
console.log('GPU:', gpu, '| DPR', DPR, '| viewport 1440x900');
const W = 1440, H = 900;
async function draw(pts) {
  await page.mouse.move(pts[0][0], pts[0][1]); await page.mouse.down();
  for (const [x, y] of pts.slice(1)) await page.mouse.move(x, y, { steps: 2 });
  await page.mouse.up();
}
const layout = [[0.25, 0.25], [0.6, 0.3], [0.45, 0.45], [0.8, 0.22], [0.15, 0.5], [0.7, 0.55], [0.35, 0.15], [0.9, 0.45], [0.5, 0.2], [0.2, 0.35], [0.65, 0.12], [0.85, 0.6], [0.3, 0.58], [0.55, 0.62], [0.1, 0.18], [0.75, 0.38]];
let n = 0;
for (const count of [1, 4, 8, 16]) {
  while (n < count) {
    const [cx, cy] = layout[n];
    await draw(Array.from({ length: 24 }, (_, i) => { const u = i / 23; return [W * cx - 150 + u * 300, H * cy - Math.sin(u * Math.PI * 2) * 30]; }));
    n++;
  }
  await page.waitForTimeout(3800);
  if (process.env.ABOVE) { await page.evaluate(() => { window.__sky.store.getState().setView({ yaw: 0, pitch: -0.87, altitude: 11 }); window.__sky.engine.snapView(); }); await page.waitForTimeout(300); }
  for (const [label, scale, q] of [['reduced', 0.36, 'reduced'], ['balanced', 0.5, 'balanced'], ['high', 0.72, 'high']]) {
    const r = await page.evaluate(([s, qq]) => window.__sky.engine.benchmark(40, s, qq), [scale, q]);
    console.log(`${String(count).padStart(2)} clouds | ${label.padEnd(8)} | ${r.renderWidth}x${r.renderHeight} (canvas ${r.canvas.join('x')}) | mean ${r.mean.toFixed(1)} ms | median ${r.median.toFixed(1)} | p90 ${r.p90.toFixed(1)}`);
  }
}
const live = await page.evaluate(async () => { const e = window.__sky.engine; const f0 = e.frames; const t0 = performance.now(); await new Promise((r) => setTimeout(r, 3000)); return { fps: ((e.frames - f0) / (performance.now() - t0)) * 1000, scale: e.renderer.renderScale, quality: e.renderer.quality }; });
console.log('live loop (auto quality, 16 clouds):', JSON.stringify(live));
await browser.close();
