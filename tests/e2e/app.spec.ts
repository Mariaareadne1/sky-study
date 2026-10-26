import { expect, test } from '@playwright/test';
import { clouds, drawPath, loop, openFresh, sample, screenRect, settle, storeState, wave } from './helpers';

test.describe('Sky Study', () => {
  test('opens to a rendered sky with a quiet prompt @cross', async ({ page }) => {
    const errors = await openFresh(page);
    await expect(page.getByTestId('hint')).toHaveText('Draw something in the sky.');
    const top = await sample(page, { x0: 0, y0: 0, x1: 1, y1: 0.3 });
    expect(top.glError).toBe(0);
    // a real blue sky, not a blank framebuffer
    expect(top.b).toBeGreaterThan(top.r + 15);
    expect(top.b).toBeGreaterThan(60);
    expect(errors).toEqual([]);
  });

  test('drawing a line forms a volumetric cloud where it was drawn @cross', async ({ page }) => {
    const errors = await openFresh(page);
    const region = { x0: 0.36, y0: 0.32, x1: 0.64, y1: 0.48 };
    const before = await sample(page, region);
    await drawPath(page, wave(720, 360));
    await expect.poll(async () => (await clouds(page)).length).toBe(1);
    await expect(page.getByTestId('hint')).toHaveCount(0);
    await settle(page);
    const after = await sample(page, region);
    // the cloud is brighter and much less saturated than the blue sky behind it
    const sat = (s: { r: number; b: number }) => s.b - s.r;
    expect(after.r).toBeGreaterThan(before.r + 25);
    expect(sat(after)).toBeLessThan(sat(before) * 0.6);
    // tone mapping keeps whites below clipping on average
    expect(after.max).toBeLessThan(256);
    const r = await screenRect(page);
    expect(Math.abs(r.cx - 720)).toBeLessThan(60);
    expect(Math.abs(r.cy - 360)).toBeLessThan(90);
    expect(errors).toEqual([]);
  });

  test('a short tap does not create a cloud; a tiny line explains why', async ({ page }) => {
    await openFresh(page);
    await page.mouse.click(700, 300);
    expect(await clouds(page)).toHaveLength(0);
  });

  test('select, drag without jumping, push away, and undo', async ({ page }) => {
    await openFresh(page);
    await drawPath(page, wave(720, 380));
    await settle(page);
    const r0 = await screenRect(page);
    await page.mouse.click(r0.cx, r0.cy);
    await expect(page.getByTestId('selection-bar')).toBeVisible();
    expect((await storeState(page)).selectedId).not.toBeNull();

    // drag: the cloud follows the pointer and keeps the grab offset
    const grabX = r0.cx + 40, grabY = r0.cy + 10;
    await page.mouse.move(grabX, grabY);
    await page.mouse.down();
    await page.mouse.move(grabX - 120, grabY + 20, { steps: 4 });
    const mid = await screenRect(page);
    expect(Math.abs(mid.cx - (r0.cx - 120))).toBeLessThan(20); // no jump at the start of the drag
    await page.mouse.move(grabX - 300, grabY + 60, { steps: 10 });
    await page.mouse.up();
    const r1 = await screenRect(page);
    expect(Math.abs(r1.cx - (r0.cx - 300))).toBeLessThan(25);
    expect(Math.abs(r1.cy - (r0.cy + 60))).toBeLessThan(25);
    // drift is tiny and bounded; the size is unchanged by a same-depth drag
    expect(Math.abs(r1.w - r0.w) / r0.w).toBeLessThan(0.12);

    // scroll pushes it away: real perspective makes it smaller
    await page.mouse.move(r1.cx, r1.cy);
    for (let i = 0; i < 5; i++) await page.mouse.wheel(0, 100);
    await page.waitForTimeout(500);
    const r2 = await screenRect(page);
    expect(r2.w).toBeLessThan(r1.w * 0.65);
    const s = await storeState(page);
    expect(s.past).toBe(3); // draw, drag, depth — one step each

    await page.keyboard.press('Meta+z');
    const r3 = await screenRect(page);
    expect(Math.abs(r3.w - r1.w)).toBeLessThan(r1.w * 0.05);
    await page.keyboard.press('Meta+Shift+z');
    const r4 = await screenRect(page);
    expect(Math.abs(r4.w - r2.w)).toBeLessThan(r2.w * 0.05);
  });

  test('depth and size sliders change the projected size independently', async ({ page }) => {
    await openFresh(page);
    await drawPath(page, wave(720, 380));
    await settle(page, 1200);
    const r0 = await screenRect(page);
    await page.mouse.click(r0.cx, r0.cy);
    const depth = page.getByTestId('depth-slider');
    await depth.focus();
    for (let i = 0; i < 60; i++) await page.keyboard.press('ArrowRight');
    const far = await screenRect(page);
    expect(far.w).toBeLessThan(r0.w * 0.85);
    const scale = page.getByTestId('scale-slider');
    await scale.focus();
    for (let i = 0; i < 60; i++) await page.keyboard.press('ArrowRight');
    const bigger = await screenRect(page);
    expect(bigger.w).toBeGreaterThan(far.w * 1.2);
    const [c] = await clouds(page);
    expect(c.scale).toBeGreaterThan(1.2);
  });

  test('time of day relights the clouds, not just the background @cross', async ({ page }) => {
    await openFresh(page);
    await drawPath(page, wave(720, 380));
    await settle(page);
    const cloudRegion = { x0: 0.42, y0: 0.36, x1: 0.58, y1: 0.48 };
    const noon = await sample(page, cloudRegion);
    await page.getByTestId('preset-golden').click();
    await page.waitForTimeout(2600);
    const golden = await sample(page, cloudRegion);
    expect((await storeState(page)).hour).toBeCloseTo(18.2, 2);
    // the cloud itself changes: its lit highlights turn warm, its shadows stay cooler
    expect(golden.highlightWarmth).toBeGreaterThan(noon.highlightWarmth * 1.15);
    expect(golden.highlightWarmth).toBeGreaterThan(golden.r / golden.b);
    await page.keyboard.press('5');
    await page.waitForTimeout(2600);
    const night = await sample(page, cloudRegion);
    expect(night.r + night.g + night.b).toBeLessThan((noon.r + noon.g + noon.b) * 0.7);
    expect(night.b).toBeGreaterThan(night.r);
  });

  test('a continuous time slider changes the light gradually', async ({ page }) => {
    await openFresh(page);
    const slider = page.getByTestId('time-slider');
    await slider.focus();
    const readings: number[] = [];
    for (let k = 0; k < 4; k++) {
      for (let i = 0; i < 25; i++) await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(1900);
      const s = await sample(page, { x0: 0, y0: 0.5, x1: 1, y1: 0.75 });
      readings.push(s.r / Math.max(1, s.b));
    }
    expect((await storeState(page)).hour).toBeGreaterThan(16);
    // the low sky warms steadily toward evening
    expect(readings[3]).toBeGreaterThan(readings[0]);
  });

  test('multiple clouds coexist; nearer clouds occlude farther ones', async ({ page }) => {
    await openFresh(page);
    await drawPath(page, wave(560, 360));
    await drawPath(page, loop(980, 320));
    await settle(page);
    expect(await clouds(page)).toHaveLength(2);
    // push the second far behind the first and line them up
    const rB = await screenRect(page, 1);
    await page.mouse.click(rB.cx, rB.cy);
    const depth = page.getByTestId('depth-slider');
    await depth.focus();
    for (let i = 0; i < 80; i++) await page.keyboard.press('ArrowRight');
    const st = await page.evaluate(() => {
      const s = window.__sky!.store.getState();
      const [a, b] = s.scene.clouds;
      return { a: [...a.position], b: [...b.position] };
    });
    expect(Math.hypot(st.b[0], st.b[2])).toBeGreaterThan(Math.hypot(st.a[0], st.a[2]) * 1.5);
    const near = await screenRect(page, 0);
    // clicking the overlapping area picks the near cloud
    await page.keyboard.press('Escape');
    await page.mouse.click(near.cx, near.cy);
    const sel = (await storeState(page)).selectedId;
    expect(sel).toBe((await clouds(page))[0].id);
  });

  test('delete, duplicate, clear all, undo and redo', async ({ page }) => {
    await openFresh(page);
    await drawPath(page, wave(720, 380));
    await settle(page, 600);
    const r = await screenRect(page);
    await page.mouse.click(r.cx, r.cy);
    await page.getByRole('button', { name: 'Duplicate cloud' }).click();
    expect(await clouds(page)).toHaveLength(2);
    const [a, b] = await clouds(page);
    expect(a.seed).toBe(b.seed); // a duplicate is the same cloud, not a re-roll
    await page.keyboard.press('Backspace');
    expect(await clouds(page)).toHaveLength(1);
    await page.getByTestId('clear-all').click();
    expect(await clouds(page)).toHaveLength(0);
    await page.getByTestId('undo').click();
    expect(await clouds(page)).toHaveLength(1);
    await page.getByTestId('redo').click();
    expect(await clouds(page)).toHaveLength(0);
  });

  test('the sky persists across reloads without changing any cloud', async ({ page }) => {
    await openFresh(page);
    await drawPath(page, wave(600, 360));
    await drawPath(page, loop(1000, 330));
    await page.getByTestId('preset-dawn').click();
    await settle(page, 600);
    const before = await clouds(page);
    const shapesBefore = await page.evaluate(() => window.__sky!.store.getState().scene.clouds.map((c) => JSON.stringify(c.stroke)));
    await page.reload();
    await page.waitForFunction(() => (window.__sky?.engine.frames ?? 0) > 3);
    expect(await clouds(page)).toEqual(before);
    const shapesAfter = await page.evaluate(() => window.__sky!.store.getState().scene.clouds.map((c) => JSON.stringify(c.stroke)));
    expect(shapesAfter).toEqual(shapesBefore);
    expect((await storeState(page)).hour).toBeCloseTo(6.35, 2);
  });

  test('corrupt saved data is reported and the app still opens', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('sky-study/scene/v1', '{"version":1,"hour":"noon"'));
    await page.reload();
    await expect(page.getByTestId('toast')).toContainText('Couldn’t restore');
    await expect(page.getByTestId('hint')).toBeVisible();
  });

  test('keyboard: tools, hide UI, presets', async ({ page }) => {
    await openFresh(page);
    await page.keyboard.press('v');
    expect((await storeState(page)).tool).toBe('move');
    await page.keyboard.press('d');
    expect((await storeState(page)).tool).toBe('draw');
    await page.keyboard.press('h');
    await expect(page.getByTestId('tool-draw')).toHaveCount(0);
    await page.keyboard.press('h');
    await expect(page.getByTestId('tool-draw')).toBeVisible();
    await page.keyboard.press('4');
    expect((await storeState(page)).hour).toBeCloseTo(19.45, 2);
  });
});
