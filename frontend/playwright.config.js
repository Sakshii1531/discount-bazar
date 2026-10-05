// Playwright E2E config. Boots the Vite dev server against a fake API host;
// every /api call is answered by the stubs in e2e/fixtures/mockApi.js so the
// suite is deterministic and needs no backend, database or third-party keys.
//
// To run against a real deployment instead (smoke only), set E2E_BASE_URL,
// e.g. E2E_BASE_URL=https://discountbazaar.co.in npx playwright test smoke
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT || 4317);
const externalBaseUrl = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: './e2e/specs',
  timeout: 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // One local retry: a heavily loaded laptop can starve the preview server;
  // a pass-on-retry is reported as "flaky" rather than hidden.
  retries: process.env.CI ? 2 : 1,
  // Lazy-loaded panels are CPU heavy; more workers just starve the preview server.
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : process.env.CI ? 2 : 3,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: externalBaseUrl || `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
    geolocation: { latitude: 22.7196, longitude: 75.8577 },
    permissions: ['geolocation'],
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] }, testIgnore: /admin|seller/ },
  ],
  webServer: externalBaseUrl
    ? undefined
    : {
        // Production build + preview: same bundle shape as the live site and no
        // dev-server dependency re-optimisation reloads mid-test.
        command: `npx vite build --outDir dist-e2e --emptyOutDir && npx vite preview --outDir dist-e2e --port ${PORT} --strictPort`,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: !!process.env.E2E_REUSE_SERVER,
        timeout: 600_000, // vite build can be slow on a busy machine
        env: {
          VITE_API_URL: 'http://api.e2e.test/api',
          VITE_GOOGLE_MAPS_API_KEY: '',
          VITE_FIREBASE_API_KEY: '',
          VITE_FIREBASE_PROJECT_ID: '',
        },
      },
});
