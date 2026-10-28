/**
 * Seller product form: the Brand field lists admin-approved brands, and
 * recovers when the brands request fails (API restarting, network blip).
 */
import { test, expect, loginAs } from '../fixtures/test.js';

const BRANDS = {
  success: true,
  error: false,
  message: 'Brands fetched successfully',
  results: [
    { _id: '6ace26629d19e4c492b6e070', name: 'Amul', slug: 'amul', logo: '' },
    { _id: '6ace28a89d19e4c492b6e226', name: 'BIKANO', slug: 'bikano', logo: '' },
  ],
};

// Serve `failures` server errors first, then the brand list.
function brandsEndpoint(api, failures = 0) {
  let calls = 0;
  api.on('GET', /^\/brands$/, () => {
    calls += 1;
    return calls <= failures
      ? { status: 500, json: { success: false, error: true, message: 'Server restarting' } }
      : { status: 200, json: BRANDS };
  });
  return () => calls;
}

async function openAddProduct(page, api) {
  Object.assign(api.state.orders[0], { status: 'confirmed', workflowStatus: 'SELLER_ACCEPTED' });
  await loginAs(page, 'seller');
  await page.goto('/seller/products/add');
}

const brandTrigger = (page) => page.getByRole('button', { name: /select a brand|loading brands/i });

// Visible to a person: on screen and not covered/clipped by a parent (the option is
// the topmost element at its own centre). Playwright's toBeVisible() alone passes
// for an option hidden by an overflow-hidden modal.
async function expectOnScreen(locator) {
  await expect(locator).toBeVisible();
  const ok = await locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    if (r.height <= 0 || y < 0 || y > window.innerHeight) return false;
    const hit = document.elementFromPoint(x, y);
    return hit === el || el.contains(hit);
  });
  expect(ok, 'option is clipped or covered').toBe(true);
}

async function pickAmul(page, trigger = brandTrigger(page)) {
  await trigger.click();
  const amul = page.getByRole('button', { name: 'Amul', exact: true });
  await expectOnScreen(amul);
  await expectOnScreen(page.getByRole('button', { name: 'BIKANO', exact: true }));
  await amul.click();
  await expect(page.getByRole('button', { name: /^Amul/ })).toBeVisible();
}

test.describe('seller: product brand field', () => {
  test('lists approved brands and selects one', async ({ page, api }) => {
    brandsEndpoint(api);
    await openAddProduct(page, api);
    await expect(brandTrigger(page)).toHaveText(/Select a brand/);
    await pickAmul(page);
  });

  test('retries automatically when the first requests fail', async ({ page, api }) => {
    const calls = brandsEndpoint(api, 2);
    await openAddProduct(page, api);
    await expect(brandTrigger(page)).toHaveText(/Select a brand/);
    expect(calls()).toBe(3);
    await expect(page.getByText(/Couldn't load brands/)).toHaveCount(0);
    await pickAmul(page);
  });

  test('shows Retry when loading keeps failing, and recovers', async ({ page, api }) => {
    brandsEndpoint(api, 3);
    await openAddProduct(page, api);
    await expect(page.getByText(/Couldn't load brands/)).toBeVisible();
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByText(/Couldn't load brands/)).toHaveCount(0);
    await pickAmul(page);
  });

  test('edit product modal shows the brand list unclipped and saves the choice', async ({ page, api }) => {
    brandsEndpoint(api);
    Object.assign(api.state.orders[0], { status: 'confirmed', workflowStatus: 'SELLER_ACCEPTED' });
    await loginAs(page, 'seller');
    await page.goto('/seller/products');
    // Visible only: the page also renders a mobile card list, hidden on desktop.
    await expect(page.getByText('Fresh Milk').filter({ visible: true }).first()).toBeVisible();
    await page.locator('td button').first().click();
    const trigger = page.getByRole('button', { name: /select a brand/i });
    await trigger.scrollIntoViewIfNeeded();
    await pickAmul(page, trigger);

    await page.getByRole('button', { name: /save changes/i }).click();
    await expect.poll(() => api.calls.some((c) => c.method === 'PUT' && /^\/products\//.test(c.path))).toBe(true);
    const put = api.calls.find((c) => c.method === 'PUT' && /^\/products\//.test(c.path));
    const body = typeof put.body === 'string' ? put.body : JSON.stringify(put.body);
    expect(body).toContain('6ace26629d19e4c492b6e070');
  });

  test('opens upwards when the field is near the bottom of the screen', async ({ page, api }) => {
    brandsEndpoint(api);
    await page.setViewportSize({ width: 1280, height: 600 });
    await openAddProduct(page, api);
    const trigger = brandTrigger(page);
    await expect(trigger).toHaveText(/Select a brand/);
    // Put the field at the very bottom of the scrolling content area.
    await trigger.evaluate((el) => {
      const r = el.getBoundingClientRect();
      let scroller = el.parentElement;
      while (scroller && !(scroller.scrollHeight > scroller.clientHeight && /(auto|scroll)/.test(getComputedStyle(scroller).overflowY))) {
        scroller = scroller.parentElement;
      }
      (scroller || document.scrollingElement).scrollBy(0, r.bottom - window.innerHeight + 20);
    });
    await pickAmul(page, trigger);
  });
});
