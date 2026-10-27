// Free-flight review with real keyboard/mouse input.
import { chromium } from '@playwright/test';
const W = 1280, H = 720;
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
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
const view = () => page.evaluate(() => { const v = window.__sky.store.getState().view; return Object.fromEntries(Object.entries(v).map(([k, n]) => [k, +n.toFixed(2)])); });
const hold = async (key, ms) => { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); };
await page.mouse.move(W / 2, H * 0.9);
await page.screenshot({ path: 'artifacts/fly/0-start.png' });
await hold('w', 3500);
await page.waitForTimeout(800);
console.log('after W 3.5s', JSON.stringify(await view()));
await page.screenshot({ path: 'artifacts/fly/1-forward.png' });
await hold('a', 1500);
await page.waitForTimeout(800);
await page.screenshot({ path: 'artifacts/fly/2-strafe.png' });
// turn to look back at the clouds with a right-drag
await page.mouse.move(W * 0.3, H * 0.5);
await page.mouse.down({ button: 'right' });
await page.mouse.move(W * 0.75, H * 0.5, { steps: 10 });
await page.mouse.up({ button: 'right' });
await page.waitForTimeout(1200);
await page.screenshot({ path: 'artifacts/fly/3-turned.png' });
// rise and look down
await page.keyboard.down('Shift'); await hold('e', 2500); await page.keyboard.up('Shift');
for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+ArrowDown');
await page.waitForTimeout(1600);
console.log('after rise', JSON.stringify(await view()));
await page.screenshot({ path: 'artifacts/fly/4-above.png' });
// reset, then glide straight into the left cloud with the wheel over empty sky near it
await page.keyboard.press('r');
await page.waitForTimeout(2200);
await page.mouse.move(W * 0.3, H * 0.62);
for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, -60); await page.waitForTimeout(30); }
await page.waitForTimeout(1200);
console.log('after glide', JSON.stringify(await view()));
await page.screenshot({ path: 'artifacts/fly/5-glide.png' });
await browser.close();
