// Demo 3: real mouse/keyboard input recorded by the app's own recorder (UI hidden).
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const W = 1280, H = 720;
mkdirSync('artifacts/demo3', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1.5, acceptDownloads: true });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.addInitScript(() => { let a = 0xc10d; Math.random = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; });
await page.goto('http://localhost:5362/');
await page.evaluate(() => { localStorage.clear(); });
await page.reload();
await page.waitForFunction(() => (window.__sky?.engine.frames ?? 0) > 10);
await page.evaluate(() => { const s = window.__sky.store.getState(); s.setHour(18.2); window.__sky.engine.snapView(); });
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
await wait(500);

// 1. a heart → a flat-based cumulus
await draw((u) => { const t = u * Math.PI * 2; return [W * 0.5 + (16 * Math.sin(t) ** 3) * 7.5, H * 0.36 - (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * 7.5]; }, 1700);
await wait(2300);
// 2. the question-mark hook from the reference
await draw((u) => {
  if (u < 0.5) { const a = Math.PI * (1.05 - (u / 0.5) * 1.3); return [W * 0.2 + Math.cos(a) * 70, H * 0.3 - Math.sin(a) * 60]; }
  const v = (u - 0.5) / 0.5; return [W * 0.2 + 70 * Math.cos(-0.25 * Math.PI) - v * 40 + Math.sin(v * 3) * 10, H * 0.3 + 45 + v * 150];
}, 1500);
await wait(2000);
// 3. a long low wave
await draw((u) => [W * 0.62 + u * W * 0.3, H * 0.52 - Math.sin(u * Math.PI * 2.3) * 22 - u * 30], 1400);
await wait(2600);
// 4. look around: grab the sky and turn, then come back
await draw((u) => [W * 0.75 - u * 380, H * 0.5 + Math.sin(u * Math.PI) * 30], 1900, 'right');
await wait(700);
await draw((u) => [W * 0.35 + u * 380, H * 0.5 - Math.sin(u * Math.PI) * 20], 1700, 'right');
await wait(1200);
// 5. pull the heart close: real perspective, full detail
const r = await page.evaluate(() => { const e = window.__sky.engine; const c = window.__sky.store.getState().scene.clouds[0]; const q = e.screenRect(c); return [q.x + q.w / 2, q.y + q.h / 2]; });
await page.mouse.click(r[0], r[1]); // select
await wait(250);
await draw((u) => [r[0] + (W * 0.5 - r[0]) * u, r[1] + (H * 0.8 - r[1]) * u], 900); // drag it down
await wait(300);
await page.mouse.move(W * 0.5, H * 0.8);
for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, -30); await wait(70); }
await wait(250);
await page.keyboard.press('Escape');
await wait(2600);
// 6. blue hour, then moonlight, then back to gold
await page.keyboard.press('4');
await wait(2600);
await page.keyboard.press('5');
await wait(2700);
await page.keyboard.press('3');
await wait(3600);

const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('stop-recording').click()]);
await dl.saveAs('artifacts/demo3/raw.mp4');
console.log('saved', dl.suggestedFilename(), JSON.stringify(await page.evaluate(() => window.__sky.store.getState().scene.clouds.length)), 'clouds');
await browser.close();
