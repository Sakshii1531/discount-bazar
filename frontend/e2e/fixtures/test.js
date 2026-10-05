/**
 * Shared Playwright test object for Discount Bazar E2E specs.
 *
 *   import { test, expect, loginAs } from '../fixtures/test.js';
 *
 *   test('...', async ({ page, api }) => {
 *     await loginAs(page, 'seller');
 *     await page.goto('/seller');
 *   });
 */
import { test as base, expect } from '@playwright/test';
import { mockApi, makeToken } from './mockApi.js';
import { IDS, LOCATION } from './data.js';

export { expect };
export { OTP, PASSWORDS } from './mockApi.js';
export * as data from './data.js';

const STORAGE_SCHEMA_KEY = 'turbocart:storage_schema_version';
const STORAGE_SCHEMA_VERSION = '2';

/**
 * Seeds localStorage before any app script runs. The app wipes every known
 * key on first load unless the storage-schema marker is present, so we set
 * that marker first.
 */
async function seedStorage(page, entries) {
  await page.addInitScript(
    ([schemaKey, schemaVersion, kv]) => {
      try {
        if (window.sessionStorage.getItem('__e2e_seeded__')) return;
        window.localStorage.setItem(schemaKey, schemaVersion);
        for (const [k, v] of kv) window.localStorage.setItem(k, v);
        window.sessionStorage.setItem('__e2e_seeded__', '1');
      } catch {
        /* storage unavailable */
      }
    },
    [STORAGE_SCHEMA_KEY, STORAGE_SCHEMA_VERSION, entries],
  );
}

const locationEntry = () => {
  const now = Date.now();
  return [
    'location_v2',
    JSON.stringify({
      __env: 1,
      ts: now,
      exp: now + 24 * 3600 * 1000,
      data: {
        address: '12 MG Road, Indore',
        city: 'Indore',
        state: 'Madhya Pradesh',
        pincode: '452001',
        latitude: LOCATION.lat,
        longitude: LOCATION.lng,
        time: '12-15 mins',
      },
    }),
  ];
};

/** Pre-authenticate a portal role (customer | seller | admin | delivery). */
export async function loginAs(page, role) {
  const entries = [locationEntry(), [`auth_${role}`, makeToken(role, IDS[role])]];
  await seedStorage(page, entries);
}

/** Anonymous visitor with a saved delivery location (so the storefront loads products). */
export async function asGuest(page) {
  await seedStorage(page, [locationEntry()]);
}

/** Fails if either error boundary is on screen or an uncaught error was thrown. */
export async function expectNoCrash(page, api) {
  // RootErrorBoundary renders <h1>Oops!</h1>; ErrorBoundary renders <h1>Something went wrong</h1>.
  await expect(page.getByRole('heading', { name: 'Oops!', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Something went wrong', exact: true })).toHaveCount(0);
  if (api) expect(api.pageErrors, `uncaught page errors on ${page.url()}`).toEqual([]);
}

/** Waits until the page shows real content (not just a full-screen loader). */
export async function expectRendered(page, minChars = 40) {
  await expect
    .poll(async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim().length, {
      message: `page ${page.url()} never rendered content`,
    })
    .toBeGreaterThan(minChars);
}

export const test = base.extend({
  // auto: every test gets the mock, even if it never references `api`,
  // so no request can leak to a real (or non-existent) backend.
  api: [async ({ page }, use, testInfo) => {
    const api = await mockApi(page);
    await use(api);
    if (api.unhandled.length) {
      await testInfo.attach('unhandled-api-calls', {
        body: [...new Set(api.unhandled)].join('\n'),
        contentType: 'text/plain',
      });
    }
  }, { auto: true }],
});
