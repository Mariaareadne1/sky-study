import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { drawPath, openFresh, settle, wave } from './helpers';
import { meanFrameColor, pngInfo, probeVideo } from './media';

test.describe('capture & export', () => {
  test('saves a real PNG of the rendered sky at screen size and 2×', async ({ page }, info) => {
    const errors = await openFresh(page);
    await drawPath(page, wave(720, 380));
    await settle(page);
    const dpr = await page.evaluate(() => Math.min(window.devicePixelRatio, 2));
    for (const [id, mult] of [['capture-png', 1], ['capture-png-2x', 2]] as const) {
      await page.getByTestId('capture-button').click();
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId(id).click()]);
      expect(download.suggestedFilename()).toMatch(/^sky-study-\d{8}-\d{6}\.png$/);
      const path = join(info.outputDir, `${id}.png`);
      await download.saveAs(path);
      const png = pngInfo(path);
      expect(png.width).toBe(Math.round(1440 * dpr * mult));
      expect(png.height).toBe(Math.round(900 * dpr * mult));
      // a rendered sky with a cloud compresses to a substantial file, unlike a blank frame
      expect(png.bytes).toBeGreaterThan(200_000);
    }
    await expect(page.getByTestId('toast')).toContainText('PNG');
    expect(errors).toEqual([]);
  });

  test('records a playable clip of the canvas, including the drawing line', async ({ page }, info) => {
    await openFresh(page);
    const mime = await page.evaluate(() => {
      const c = ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1.4d002a', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
      return c.find((m) => MediaRecorder.isTypeSupported(m)) ?? null;
    });
    test.skip(!mime, 'MediaRecorder unsupported in this browser');
    await page.getByTestId('capture-button').click();
    await page.getByRole('menuitem', { name: /Record clip/ }).click();
    await expect(page.getByTestId('stop-recording')).toBeVisible();
    await page.waitForTimeout(500);
    await drawPath(page, wave(720, 380), 6);
    await page.waitForTimeout(3500);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('stop-recording').click()]);
    const ext = mime!.startsWith('video/mp4') ? 'mp4' : 'webm';
    expect(download.suggestedFilename().endsWith(`.${ext}`)).toBe(true);
    const path = join(info.outputDir, `clip.${ext}`);
    await download.saveAs(path);
    const v = probeVideo(path);
    console.log('recorded', mime, JSON.stringify(v));
    expect(v.format).toContain(ext === 'mp4' ? 'mp4' : 'webm');
    expect(['h264', 'vp9', 'vp8']).toContain(v.codec);
    expect(v.width % 2).toBe(0);
    expect(v.width).toBeGreaterThanOrEqual(1440);
    expect(v.frames).toBeGreaterThan(60);
    expect(v.duration).toBeGreaterThan(3);
    // decoded frames contain the sky: blue dominates
    const [r, , b] = meanFrameColor(path, 1);
    expect(b).toBeGreaterThan(r + 10);
  });
});
