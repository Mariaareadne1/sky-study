import { expect, test } from '@playwright/test';
import { clouds, drawPath, openFresh, sample, screenRect, wave } from './helpers';

/**
 * Long-session stability: many clouds, edits, light changes, resizes,
 * hide/show, reloads and repeated captures. Checks console/GL errors,
 * frame progress, image validity and that frame rate doesn't degrade.
 */
test('long session stays stable @soak', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = await openFresh(page);
  const fps = () =>
    page.evaluate(async () => {
      const e = window.__sky!.engine;
      const f0 = e.frames;
      const t0 = performance.now();
      await new Promise((r) => setTimeout(r, 2000));
      return ((e.frames - f0) / (performance.now() - t0)) * 1000;
    });

  // draw 20 gestures: the 17th onward must be refused with a message, not dropped silently
  const spots = Array.from({ length: 20 }, (_, i) => [200 + (i % 5) * 260, 170 + Math.floor(i / 5) * 120] as const);
  for (const [i, [x, y]] of spots.entries()) {
    await drawPath(page, wave(x, y, 200, 25, 16), 2);
    if (i === 16) await expect(page.getByTestId('toast')).toContainText('holds 16 clouds');
  }
  expect(await clouds(page)).toHaveLength(16);
  await page.waitForTimeout(4000);
  const fpsStart = await fps();

  // move several clouds, delete several
  await page.keyboard.press('v');
  for (let i = 0; i < 5; i++) {
    const r = await screenRect(page, i);
    await page.mouse.move(r.cx, r.cy);
    await page.mouse.down();
    await page.mouse.move(r.cx + 40, r.cy + 30, { steps: 5 });
    await page.mouse.up();
    await page.mouse.wheel(0, 150);
  }
  for (let i = 0; i < 4; i++) {
    const r = await screenRect(page, 0);
    await page.mouse.click(r.cx, r.cy);
    await page.keyboard.press('Delete');
  }
  expect(await clouds(page)).toHaveLength(12);

  // cycle the light repeatedly, including mid-transition interruptions
  for (let round = 0; round < 3; round++) {
    for (const k of ['1', '2', '3', '4', '5']) {
      await page.keyboard.press(k);
      await page.waitForTimeout(round === 1 ? 250 : 900);
    }
  }

  // resize, hide/show UI
  for (const [w, h] of [[1024, 700], [1600, 1000], [800, 900], [1440, 900]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(400);
    await page.keyboard.press('h');
    await page.keyboard.press('h');
  }

  // repeated captures
  for (let i = 0; i < 3; i++) {
    await page.getByTestId('capture-button').click();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('capture-png').click()]);
    expect(dl.suggestedFilename()).toMatch(/\.png$/);
  }

  // reload restores the same sky
  const before = await clouds(page);
  await page.reload();
  await page.waitForFunction(() => (window.__sky?.engine.frames ?? 0) > 5);
  expect(await clouds(page)).toEqual(before);
  await page.keyboard.press('2');
  await page.waitForTimeout(4000);
  const fpsEnd = await fps();

  const img = await sample(page);
  expect(img.glError).toBe(0);
  expect(img.nonFinite).toBe(0);
  expect(img.b).toBeGreaterThan(40);
  // no gradual degradation: the end-of-session frame rate is comparable
  console.log(`fps start ${fpsStart.toFixed(1)} (16 clouds), end ${fpsEnd.toFixed(1)} (12 clouds)`);
  expect(fpsEnd).toBeGreaterThan(fpsStart * 0.7);
  // selection still works after everything
  const r = await screenRect(page, 0);
  await page.keyboard.press('v');
  await page.mouse.click(r.cx, r.cy);
  await expect(page.getByTestId('selection-bar')).toBeVisible();
  expect(errors).toEqual([]);
});
