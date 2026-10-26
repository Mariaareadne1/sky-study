import { defineConfig, devices } from '@playwright/test';

/**
 * E2E runs against the Vite dev server by default; E2E_PROD=1 builds and
 * serves the production bundle. Chromium uses ANGLE/Metal so the real
 * raymarcher runs on the GPU (SwiftShader would take seconds per frame).
 */
const prod = process.env.E2E_PROD === '1';
const port = prod ? 5363 : 5362;
const gpuArgs = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
    launchOptions: { args: gpuArgs },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, launchOptions: { args: gpuArgs } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } }, grep: /@cross/ },
  ],
  webServer: {
    command: prod ? 'npm run build && npm run preview' : 'npm run dev',
    port,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
