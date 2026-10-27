import { expect, test } from '@playwright/test';
import { clouds, drawPath, loop, openFresh, sample, screenRect, settle, wave } from './helpers';
import { devices } from '@playwright/test';

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

  test('fly freely: keys move through the world, the Look tool turns, R resets', async ({ page }) => {
    await openFresh(page);
    await drawPath(page, wave(720, 380));
    await settle(page);
    const r0 = await screenRect(page);
    await page.mouse.move(720, 800); // keep the cursor off the cloud
    await page.keyboard.down('w');
    await page.waitForTimeout(2500);
    await page.keyboard.up('w');
    await page.waitForTimeout(800);
    let v = await view(page);
    expect(v.z).toBeLessThan(-1.2); // flew forward (toward -Z)
    const r1 = await screenRect(page);
    expect(r1.w).toBeGreaterThan(r0.w * 1.15); // the cloud looms larger as you approach
    const alt0 = v.altitude;
    await page.keyboard.down('e');
    await page.waitForTimeout(1200);
    await page.keyboard.up('e');
    v = await view(page);
    expect(v.altitude).toBeGreaterThan(alt0 + 0.3);
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowUp');
    v = await view(page);
    expect(v.yaw).toBeGreaterThan(0.05);
    await page.getByTestId('tool-look').click();
    await page.mouse.move(700, 400);
    await page.mouse.down();
    await page.mouse.move(700, 600, { steps: 6 });
    await page.mouse.up();
    expect((await view(page)).pitch).toBeGreaterThan(v.pitch + 0.15); // ≈ fov × 200/900 px
    expect(await clouds(page)).toHaveLength(1); // Look never draws
    await expect(page.getByTestId('reset-view')).toBeVisible();
    await page.keyboard.press('r');
    v = await view(page);
    expect([v.x, v.z, v.altitude]).toEqual([0, 0, 1]);
    await expect(page.getByTestId('reset-view')).toHaveCount(0);
  });

  test('scrolling on empty sky glides along the view; on a cloud it pushes the cloud', async ({ page }) => {
    await openFresh(page);
    await drawPath(page, wave(720, 380));
    await settle(page, 1500);
    const before = (await clouds(page))[0].position;
    await page.mouse.move(200, 700);
    for (let i = 0; i < 10; i++) await page.mouse.wheel(0, -100);
    await page.waitForTimeout(300);
    const v = await view(page);
    expect(v.z).toBeLessThan(-0.3);
    expect((await clouds(page))[0].position).toEqual(before); // the cloud didn't move
  });

  test('Above: a top-down sky over a dark sea, footprint drawing, and the view survives reload @cross', async ({ page }) => {
    await openFresh(page);
    const eyeLow = await sample(page, { x0: 0, y0: 0.8, x1: 1, y1: 1 });
    await page.evaluate(() => window.__sky!.store.getState().setView({ pitch: -0.87, altitude: 11 }));
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

  test.describe('touch', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { defaultBrowserType: _browser, ...phone } = devices['iPhone 13'];
    test.use(phone);
    test('the move pad flies the camera on touch screens', async ({ page }) => {
      await openFresh(page);
      const pad = page.getByTestId('pad-forward');
      await expect(pad).toBeVisible();
      const box = (await pad.boundingBox())!;
      const cdp = await page.context().newCDPSession(page);
      const pt = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt] });
      await page.waitForTimeout(1500);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(300);
      const z1 = (await view(page)).z;
      expect(z1).toBeLessThan(-0.5);
      await page.waitForTimeout(500);
      expect((await view(page)).z).toBeCloseTo(z1, 3); // stops when released
    });
  });
});
