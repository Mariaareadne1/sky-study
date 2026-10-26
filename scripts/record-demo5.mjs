// Demo 3: real mouse/keyboard input recorded by the app's own recorder (UI hidden).
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const W = 1280, H = 720;
mkdirSync('artifacts/demo5', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1.5, acceptDownloads: true });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.addInitScript(() => { let a = 0x51de; Math.random = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; });
await page.goto('http://localhost:5362/');
await page.evaluate(() => { localStorage.clear(); });
await page.reload();
await page.waitForFunction(() => (window.__sky?.engine.frames ?? 0) > 10);
await page.evaluate(() => { const s = window.__sky.store.getState(); s.setHour(19.05); window.__sky.engine.snapView(); });
await page.waitForTimeout(2200);
const wait = (ms) => page.waitForTimeout(ms);

// hand-like drawing: eased progress, ~60 samples/s
async function draw(path, ms, button = 'left') {
  const n = Math.round(ms / 16);
  const p0 = path(0);
  await page.mouse.move(p0[0], p0[1]);
  await page.mouse.down({ button });
  for (let i = 1; i <= n; i++) {
    const u = i / n;
    const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
    const [x, y] = path(e);
    await page.mouse.move(x, y);
    await wait(6);
  }
  await page.mouse.up({ button });
}

await page.getByTestId('capture-button').click();
await page.getByRole('menuitem', { name: /Record clip/ }).click();
await wait(300);

// two quick gestures in pink twilight
await draw((u) => { const t = u * Math.PI * 2; return [W * 0.33 + Math.sin(t) * 105 + u * 12, H * 0.34 - Math.cos(t) * 75]; }, 1100);
await wait(500);
await draw((u) => [W * 0.55 + u * W * 0.3, H * 0.42 - Math.sin(u * Math.PI * 2.1) * 26 - u * 24], 1000);
await wait(2400);
// rise above the clouds
await page.evaluate(() => window.__sky.store.getState().setView({ yaw: 0.05, pitch: -0.5, altitude: 9 }));
await wait(2300);
// draw a cloud from above: the stroke is its footprint on the sea
await draw((u) => { const t = u * Math.PI * 2; return [W * 0.5 + Math.sin(t) * 120 + Math.sin(t * 3) * 10, H * 0.74 - Math.cos(t) * 55]; }, 1200);
await wait(2600);
// the light shifts: twilight back through golden hour to bright noon; shadows appear on the sea
await page.evaluate(() => window.__sky.store.getState().setHour(12.5));
await wait(3000);
// glide back down to eye level
await page.evaluate(() => window.__sky.store.getState().setView({ yaw: 0, pitch: 0.26, altitude: 1 }));
await wait(2500);

const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('stop-recording').click()]);
await dl.saveAs('artifacts/demo5/raw.mp4');
console.log('saved', dl.suggestedFilename(), JSON.stringify(await page.evaluate(() => window.__sky.store.getState().scene.clouds.length)), 'clouds');
await browser.close();
