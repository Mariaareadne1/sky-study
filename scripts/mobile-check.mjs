import { chromium, devices } from '@playwright/test';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ ...devices['iPhone 13'] , defaultBrowserType: undefined });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto('http://localhost:5362/');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => (window.__sky?.engine.frames ?? 0) > 5);
await page.screenshot({ path: 'artifacts/app/mobile-empty.png' });
// draw with a real touch pointer stream via CDP
const cdp = await ctx.newCDPSession(page);
const pts = Array.from({ length: 30 }, (_, i) => { const u = i / 29; return { x: 70 + u * 250, y: 300 - Math.sin(u * Math.PI * 2) * 30 }; });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pts[0]] });
for (const p of pts.slice(1)) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [p] }); await page.waitForTimeout(12); }
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await page.waitForTimeout(4000);
const n = await page.evaluate(() => window.__sky.store.getState().scene.clouds.length);
console.log('clouds after touch draw:', n);
// tap to select
const r = await page.evaluate(() => { const e = window.__sky.engine; const c = window.__sky.store.getState().scene.clouds[0]; return e.screenRect(c); });
if (r) {
  await page.touchscreen.tap(r.x + r.w / 2, r.y + r.h / 2);
  await page.waitForTimeout(300);
}
console.log('selected:', await page.evaluate(() => window.__sky.store.getState().selectedId));
await page.screenshot({ path: 'artifacts/app/mobile-selected.png' });
await browser.close();
