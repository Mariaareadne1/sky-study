import type { Page } from '@playwright/test';

export interface PixelStats {
  r: number;
  g: number;
  b: number;
  max: number;
  nonFinite: number;
  highlightWarmth: number;
  distinctColors: number;
  glError: number;
}

export async function openFresh(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  // deterministic cloud seeds: the same gestures build the same clouds every run
  await page.addInitScript(() => {
    let a = 0x5eed;
    Math.random = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  });
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => (window.__sky?.engine.frames ?? 0) > 5);
  return errors;
}

export const clouds = (page: Page) =>
  page.evaluate(() => window.__sky!.store.getState().scene.clouds.map((c) => ({ id: c.id, position: [...c.position], scale: c.scale, seed: c.seed, stroke: c.stroke.length })));

export const storeState = (page: Page) =>
  page.evaluate(() => {
    const s = window.__sky!.store.getState();
    return { selectedId: s.selectedId, hour: s.scene.hour, past: s.past.length, future: s.future.length, tool: s.tool, uiHidden: s.uiHidden };
  });

export const sample = (page: Page, region?: { x0: number; y0: number; x1: number; y1: number }) =>
  page.evaluate((r) => window.__sky!.engine.sample(r), region) as Promise<PixelStats>;

export async function drawPath(page: Page, pts: [number, number][], steps = 3) {
  await page.mouse.move(pts[0][0], pts[0][1]);
  await page.mouse.down();
  for (const [x, y] of pts.slice(1)) await page.mouse.move(x, y, { steps });
  await page.mouse.up();
}

export function wave(cx: number, cy: number, width = 480, amp = 40, n = 36): [number, number][] {
  return Array.from({ length: n }, (_, i) => {
    const u = i / (n - 1);
    return [cx - width / 2 + u * width, cy - Math.sin(u * Math.PI * 2.2) * amp - u * amp * 0.6];
  });
}

export function loop(cx: number, cy: number, r = 110, n = 56): [number, number][] {
  return Array.from({ length: n }, (_, i) => {
    const t = (i / (n - 1)) * Math.PI * 2;
    return [cx + Math.sin(t) * r, cy - Math.cos(t) * r * 0.85];
  });
}

/** Wait until every cloud has finished forming. */
export const settle = (page: Page, ms = 3800) => page.waitForTimeout(ms);

export const screenRect = (page: Page, index = 0) =>
  page.evaluate((i) => {
    const e = window.__sky!.engine;
    const c = window.__sky!.store.getState().scene.clouds[i];
    const r = e.screenRect(c)!;
    return { x: r.x, y: r.y, w: r.w, h: r.h, cx: r.x + r.w / 2, cy: r.y + r.h / 2 };
  }, index);
