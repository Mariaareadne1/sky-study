// Pixel-art style review: same scene across times of day and views.
import { chromium } from '@playwright/test';
const W = 1280, H = 720;
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: Number(process.env.DPR ?? 1) });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text()); });
await page.addInitScript(() => { let a = 0x51de; Math.random = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; });
await page.goto('http://localhost:5362/');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => (window.__sky?.engine.frames ?? 0) > 10);
async function draw(pts) { await page.mouse.move(...pts[0]); await page.mouse.down(); for (const p of pts.slice(1)) await page.mouse.move(p[0], p[1], { steps: 2 }); await page.mouse.up(); }
await draw(Array.from({ length: 50 }, (_, i) => { const t = (i / 49) * Math.PI * 2; return [W * 0.3 + Math.sin(t) * 115, H * 0.36 - Math.cos(t) * 85]; }));
await draw(Array.from({ length: 30 }, (_, i) => { const u = i / 29; return [W * 0.55 + u * W * 0.32, H * 0.45 - Math.sin(u * Math.PI * 2.1) * 26]; }));
await page.waitForTimeout(3800);
await page.keyboard.press('p');
await page.keyboard.press('h');
const shots = (process.env.SHOTS ?? 'noon:12.5:eye,golden:18.2:eye,dusk:19.05:eye,night:22.5:eye,above:12.5:above,abovedusk:19.05:above').split(',');
for (const s of shots) {
  const [name, h, v] = s.split(':');
  const view = v === 'above' ? { yaw: 0.05, pitch: -0.5, altitude: 9 } : { yaw: 0, pitch: 0.26, altitude: 1 };
  await page.evaluate(([hh, vv]) => { const st = window.__sky.store.getState(); st.setHour(hh); st.setView(vv); window.__sky.engine.snapView(); }, [Number(h), view]);
  await page.waitForTimeout(2400);
  await page.screenshot({ path: `artifacts/pixel/${name}.png` });
}
console.log(JSON.stringify(await page.evaluate(() => ({ style: window.__sky.store.getState().style, scale: window.__sky.engine.renderer.renderScale }))));
await browser.close();
