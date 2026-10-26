// Render spike scenes headlessly (real GPU via ANGLE/Metal) and save PNGs to artifacts/.
// usage: node scripts/shoot.mjs name "query" [name "query" ...]   (env: W, H, WAIT, CLIP=x,y,w,h)
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const W = Number(process.env.W ?? 1440);
const H = Number(process.env.H ?? 900);
const WAIT = Number(process.env.WAIT ?? 60);
const base = process.env.BASE ?? 'http://localhost:5362/spike.html';
const outDir = process.env.OUT ?? 'artifacts/spike';
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error') console.error('console:', m.text()); });
page.on('pageerror', (e) => console.error('pageerror:', e.message));
for (let i = 0; i < args.length; i += 2) {
  const [name, query] = [args[i], args[i + 1]];
  await page.goto(`${base}?${query}`);
  await page.waitForFunction((n) => (window.__spike?.frames ?? 0) > n, WAIT, { timeout: 60000 });
  const info = await page.evaluate(() => window.__spike);
  const clip = process.env.CLIP ? (([x, y, w, h]) => ({ x, y, width: w, height: h }))(process.env.CLIP.split(',').map(Number)) : undefined;
  await page.screenshot({ path: `${outDir}/${name}.png`, clip });
  console.log(name, JSON.stringify({ ms: info.ms?.toFixed(2), ...info.stats }));
}
await browser.close();
