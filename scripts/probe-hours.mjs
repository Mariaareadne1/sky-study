import { chromium } from '@playwright/test';
const W = 1280, H = 720;
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.addInitScript(() => { let a = 0x51de; Math.random = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; });
await page.goto('http://localhost:5362/');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => (window.__sky?.engine.frames ?? 0) > 10);
async function draw(pts) { await page.mouse.move(...pts[0]); await page.mouse.down(); for (const p of pts.slice(1)) await page.mouse.move(p[0], p[1], { steps: 2 }); await page.mouse.up(); }
await draw(Array.from({ length: 50 }, (_, i) => { const t = (i / 49) * Math.PI * 2; return [W * 0.33 + Math.sin(t) * 105, H * 0.34 - Math.cos(t) * 75]; }));
await draw(Array.from({ length: 30 }, (_, i) => { const u = i / 29; return [W * 0.55 + u * W * 0.3, H * 0.42 - Math.sin(u * Math.PI * 2.1) * 26]; }));
await page.waitForTimeout(3800);
await page.keyboard.press('h');
for (const h of [18.8, 19.05, 19.3]) {
  for (const [name, v] of [['eye', { yaw: 0, pitch: 0.26, altitude: 1 }], ['above', { yaw: 0.05, pitch: -0.5, altitude: 9 }]]) {
    await page.evaluate(([hh, vv]) => { const s = window.__sky.store.getState(); s.setHour(hh); s.setView(vv); window.__sky.engine.snapView(); }, [h, v]);
    await page.waitForTimeout(2600);
    await page.screenshot({ path: `artifacts/demo5/probe-${h}-${name}.png` });
  }
}
await browser.close();
