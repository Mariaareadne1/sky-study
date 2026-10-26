import { expect, test } from '@playwright/test';
import { clouds, drawPath, loop, openFresh, sample, screenRect, settle, wave } from './helpers';

const view = (page: import('@playwright/test').Page) => page.evaluate(() => ({ ...window.__sky!.store.getState().view, shown: window.__sky!.engine.view }));

test.describe('perspective', () => {
  test('right-drag looks around; clouds stay put in the world and remain pickable', async ({ page }) => {
    const errors = await openFresh(page);
    await drawPath(page, wave(720, 380));
    await settle(page);
    const before = await screenRect(page);
    const worldBefore = (await clouds(page))[0].position;
    await page.mouse.move(900, 450);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(650, 470, { steps: 8 });
    await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(1500);
    const v = await view(page);
    expect(v.yaw).toBeGreaterThan(0.2); // dragging the sky left turns the view right
    const after = await screenRect(page);
    expect(after.cx).toBeLessThan(before.cx - 150); // the cloud slid left on screen…
    expect((await clouds(page))[0].position).toEqual(worldBefore); // …but didn't move in the world
    await page.mouse.click(after.cx, after.cy);
    await expect(page.getByTestId('selection-bar')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('arrow keys and the Look tool turn the view', async ({ page }) => {
    await openFresh(page);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowUp');
    let v = await view(page);
    expect(v.yaw).toBeGreaterThan(0.05);
    expect(v.pitch).toBeGreaterThan(0.3);
    await page.getByTestId('tool-look').click();
    await page.mouse.move(700, 400);
    await page.mouse.down();
    await page.mouse.move(700, 600, { steps: 6 });
    await page.mouse.up();
    v = await view(page);
    expect(v.pitch).toBeGreaterThan(0.5);
    expect(await clouds(page)).toHaveLength(0); // Look never draws
  });

  test('Above: a top-down sky over a dark sea, footprint drawing, and the view survives reload @cross', async ({ page }) => {
    await openFresh(page);
    const eyeLow = await sample(page, { x0: 0, y0: 0.8, x1: 1, y1: 1 });
    await page.getByTestId('view-above').click();
    await page.waitForFunction(() => window.__sky!.engine.view.altitude > 10.5, null, { timeout: 15000 });
    await page.waitForTimeout(600);
    const above = await sample(page, { x0: 0, y0: 0.4, x1: 1, y1: 1 });
    // looking down at open water: darker and bluer than the low haze at eye level
    expect(above.r + above.g + above.b).toBeLessThan(eyeLow.r + eyeLow.g + eyeLow.b);
    expect(above.b).toBeGreaterThan(above.r + 25);
    await drawPath(page, loop(1000, 560, 130));
    await settle(page);
    const docs = await page.evaluate(() => window.__sky!.store.getState().scene.clouds);
    expect(docs).toHaveLength(1);
    expect(docs[0].orientation).toBe('horizontal');
    const r = await screenRect(page);
    expect(Math.abs(r.cx - 1000)).toBeLessThan(110);
    await page.waitForTimeout(600);
    await page.reload();
    await page.waitForFunction(() => (window.__sky?.engine.frames ?? 0) > 3);
    const v = await view(page);
    expect(v.altitude).toBeCloseTo(11, 1);
    expect(v.shown.altitude).toBeCloseTo(11, 1); // restored instantly, not animated from eye level
  });
});
