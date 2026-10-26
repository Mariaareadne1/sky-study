// Drive the real app with trusted mouse input and save screenshots.
// usage: node scripts/app-check.mjs [scenario]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const scenario = process.argv[2] ?? 'draw';
const W = 1440, H = 900;
const out = 'artifacts/app';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('console:', m.type(), m.text().slice(0, 300)); });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(process.env.URL ?? 'http://localhost:5362/');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => window.__sky);
await page.waitForTimeout(800);

async function draw(points, steps = 4) {
  await page.mouse.move(points[0][0], points[0][1]);
  await page.mouse.down();
  for (const [x, y] of points.slice(1)) await page.mouse.move(x, y, { steps });
  await page.mouse.up();
}
const wave = Array.from({ length: 40 }, (_, i) => { const u = i / 39; return [W * 0.32 + u * W * 0.36, H * 0.42 - Math.sin(u * Math.PI * 2.2) * 40 - u * 30]; });
const loop = Array.from({ length: 60 }, (_, i) => { const t = (i / 59) * Math.PI * 2; return [W * 0.24 + Math.sin(t) * 120, H * 0.3 - Math.cos(t) * 100]; });

const state = () => page.evaluate(() => { const s = window.__sky.store.getState(); return { clouds: s.scene.clouds.map((c) => ({ id: c.id, pos: c.position.map((v) => +v.toFixed(2)), scale: c.scale, closed: c.closed })), selected: s.selectedId, past: s.past.length, toast: s.toast?.text }; });

if (scenario === 'draw') {
  await draw(wave);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/form-0250.png` });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/form-0950.png` });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/form-2150.png` });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/form-done.png` });
  await draw(loop);
  await page.waitForTimeout(4500);
  await page.screenshot({ path: `${out}/two-clouds.png` });
  console.log(JSON.stringify(await state()));
}
if (scenario === 'manip') {
  await draw(wave);
  await page.waitForTimeout(3600);
  const rect = async () => page.evaluate(() => { const e = window.__sky.engine; const c = window.__sky.store.getState().scene.clouds[0]; const r = e.screenRect(c); return { x: r.x, y: r.y, w: r.w, h: r.h }; });
  const r0 = await rect();
  const cx = r0.x + r0.w / 2, cy = r0.y + r0.h / 2;
  // tap to select (draw tool), then drag the selected cloud
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(150);
  console.log('after tap', JSON.stringify(await state()));
  await page.screenshot({ path: `${out}/selected.png` });
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 260, cy + 60, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  const r1 = await rect();
  console.log('dragged', JSON.stringify({ dx: (r1.x + r1.w / 2) - cx, dy: (r1.y + r1.h / 2) - cy, w0: r0.w, w1: r1.w }));
  // scroll: push it away
  await page.mouse.move(r1.x + r1.w / 2, r1.y + r1.h / 2);
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(30); }
  await page.waitForTimeout(500);
  const r2 = await rect();
  console.log('pushed away', JSON.stringify({ w1: r1.w, w2: r2.w, ratio: r2.w / r1.w }));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/pushed.png` });
  console.log('state', JSON.stringify(await state()));
  await page.keyboard.press('Meta+z');
  await page.waitForTimeout(100);
  const r3 = await rect();
  console.log('undo depth', JSON.stringify({ w3: r3.w, matchesBefore: Math.abs(r3.w - r1.w) < 1 }));
  await page.keyboard.press('3');
  await page.waitForTimeout(2600);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/golden.png` });
  console.log('hour', await page.evaluate(() => [window.__sky.store.getState().scene.hour, window.__sky.engine.hour]));
}
await browser.close();
