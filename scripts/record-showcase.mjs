// Records the in-app showcase (real systems, UI hidden) and builds a contact sheet.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ffmpeg = require('ffmpeg-static');
const out = 'artifacts/showcase';
mkdirSync(out, { recursive: true });
const W = Number(process.env.W ?? 1440), H = Number(process.env.H ?? 900);
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: Number(process.env.DPR ?? 1), acceptDownloads: true });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(process.env.URL ?? 'http://localhost:5362/');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => (window.__sky?.engine.frames ?? 0) > 10);
await page.getByTestId('capture-button').click();
const t0 = Date.now();
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 60000 }),
  page.getByRole('menuitem', { name: 'Record showcase' }).click(),
]);
const file = `${out}/showcase.${download.suggestedFilename().split('.').pop()}`;
await download.saveAs(file);
console.log('saved', file, ((Date.now() - t0) / 1000).toFixed(1), 's');
const times = (process.env.TIMES ?? '0.5,1.5,2.4,3.2,4.5,6.5,8,9.5,11,12.5,14,15.5,17.5,19.5,21.5,23.5').split(',');
const inputs = times.flatMap((t) => ['-ss', t, '-i', file]);
const filter = times.map((_, i) => `[${i}:v]scale=480:-2,drawtext=text='${times[i]}s':x=8:y=8:fontcolor=white:fontsize=18[v${i}]`).join(';');
try {
  execFileSync(ffmpeg, ['-v', 'error', '-y', ...inputs, '-filter_complex', `${filter};${times.map((_, i) => `[v${i}]`).join('')}xstack=inputs=${times.length}:layout=${times.map((_, i) => `${(i % 4) ? Array.from({ length: i % 4 }, () => 'w0').join('+') : '0'}_${Math.floor(i / 4) ? Array.from({ length: Math.floor(i / 4) }, () => 'h0').join('+') : '0'}`).join('|')}`, '-frames:v', '1', `${out}/contact.png`]);
} catch (e) {
  // drawtext may be missing from the static build; fall back to no labels
  const f2 = times.map((_, i) => `[${i}:v]scale=480:-2[v${i}]`).join(';');
  execFileSync(ffmpeg, ['-v', 'error', '-y', ...inputs, '-filter_complex', `${f2};${times.map((_, i) => `[v${i}]`).join('')}xstack=inputs=${times.length}:layout=${times.map((_, i) => `${(i % 4) ? Array.from({ length: i % 4 }, () => 'w0').join('+') : '0'}_${Math.floor(i / 4) ? Array.from({ length: Math.floor(i / 4) }, () => 'h0').join('+') : '0'}`).join('|')}`, '-frames:v', '1', `${out}/contact.png`]);
}
console.log('contact sheet', `${out}/contact.png`);
await browser.close();
