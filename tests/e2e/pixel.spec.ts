import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { drawPath, loop, openFresh, sample, settle, wave } from './helpers';
import { pngInfo } from './media';

test.describe('pixel-art style', () => {
  test('bands the real 3D render into a small palette, keeps lighting, and persists @cross', async ({ page }) => {
    const errors = await openFresh(page);
    await drawPath(page, wave(820, 380));
    await drawPath(page, loop(420, 300));
    await settle(page);
    const region = { x0: 0.2, y0: 0.2, x1: 0.8, y1: 0.6 };
    const real = await sample(page, region);
    await page.getByTestId('style-toggle').click();
    await expect(page.getByTestId('style-toggle')).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(600);
    const pixel = await sample(page, region);
    // a handful of flat tones instead of smooth gradients
    expect(pixel.distinctColors).toBeLessThan(real.distinctColors * 0.35);
    // still a blue sky with bright clouds lit by the same light
    expect(pixel.b).toBeGreaterThan(pixel.r + 15);
    expect(pixel.max).toBeGreaterThan(200);
    // and the light still changes it
    await page.keyboard.press('3');
    await page.waitForTimeout(2600);
    const golden = await sample(page, region);
    // (the pixel palette already warms noon highlights a little, so the step is smaller than in realistic mode)
    expect(golden.highlightWarmth).toBeGreaterThan(pixel.highlightWarmth * 1.04);
    expect(golden.r / golden.b).toBeGreaterThan((pixel.r / pixel.b) * 1.2);
    // persists across reloads; P toggles back
    await page.reload();
    await page.waitForFunction(() => (window.__sky?.engine.frames ?? 0) > 3);
    expect(await page.evaluate(() => window.__sky!.store.getState().style)).toBe('pixel');
    await page.keyboard.press('p');
    expect(await page.evaluate(() => window.__sky!.store.getState().style)).toBe('realistic');
    expect(errors).toEqual([]);
  });

  test('PNG export keeps the pixel grid', async ({ page }, info) => {
    await openFresh(page);
    await drawPath(page, wave(720, 380));
    await page.keyboard.press('p');
    await settle(page);
    await page.getByTestId('capture-button').click();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('capture-png').click()]);
    const path = join(info.outputDir, 'pixel.png');
    await dl.saveAs(path);
    const png = pngInfo(path);
    const dpr = await page.evaluate(() => Math.min(window.devicePixelRatio, 2));
    expect(png.width).toBe(Math.round(1440 * dpr));
    // flat colour blocks compress far better than the realistic render (~>200 kB)
    expect(png.bytes).toBeLessThan(200_000);
  });
});
