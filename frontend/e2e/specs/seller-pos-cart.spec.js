/**
 * POS terminal: with many lines in the bill, the cart list scrolls inside the
 * bill panel and the totals / Checkout stay inside the box and on screen.
 */
import { test, expect, loginAs, data } from '../fixtures/test.js';

const MANY = 15;

function catalog(count = MANY) {
  const base = data.products[0];
  return Array.from({ length: count }, (_, i) => ({
    ...base,
    _id: `64b7f0c2a1b2c3d4e5f6${String(1000 + i).padStart(4, '0')}`,
    name: `POS Item ${i + 1}`,
    sku: `POS-${i + 1}`,
    barcode: `POS${i + 1}`,
    variants: [],
    stock: 50,
  }));
}

// Box of an element in viewport coordinates.
const box = (locator) => locator.evaluate((el) => {
  const r = el.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, vh: window.innerHeight };
});

async function fillCart(page, api, catalogSize = MANY) {
  Object.assign(api.state.orders[0], { status: 'confirmed', workflowStatus: 'SELLER_ACCEPTED' });
  const items = catalog(catalogSize);
  api.on('GET', /^\/seller\/pos\/catalog$/, () => ({ status: 200, json: { success: true, error: false, message: 'ok', results: items } }));
  await loginAs(page, 'seller');
  await page.goto('/seller/pos');
  for (const p of items.slice(0, MANY)) {
    await page.getByText(p.name, { exact: true }).first().click();
  }
  await expect(page.getByText(`${MANY} items`)).toBeVisible();
}

for (const height of [900, 700]) {
  test(`bill keeps Checkout inside the panel with ${MANY} lines (viewport ${height}px)`, async ({ page, api }) => {
    await page.setViewportSize({ width: 1366, height });
    await fillCart(page, api);
    const checkout = page.getByRole('button', { name: 'Checkout', exact: true });
    // The bill box (rounded-2xl card) that holds the cart panel.
    const panel = checkout.locator('xpath=ancestor::div[contains(concat(" ", @class, " "), " rounded-2xl ")][1]');
    const list = page.getByText('POS Item 1', { exact: true }).last()
      .locator('xpath=ancestor::div[contains(@class, "overflow-y-auto")][1]');
    // Scroll the page down so the sticky bill panel is pinned, as while billing.
    await panel.evaluate((el) => {
      for (let n = el.parentElement; n; n = n.parentElement) {
        if (n.scrollHeight > n.clientHeight && /(auto|scroll)/.test(getComputedStyle(n).overflowY)) n.scrollTop = n.scrollHeight;
      }
      window.scrollTo(0, document.documentElement.scrollHeight);
    });
    const p = await box(panel);
    const c = await box(checkout);
    expect(c.bottom, 'Checkout spills out of the bill panel').toBeLessThanOrEqual(p.bottom + 1);
    expect(c.bottom, 'Checkout is below the screen').toBeLessThanOrEqual(c.vh);
    expect(p.bottom, 'bill panel is taller than the screen').toBeLessThanOrEqual(p.vh);
    // Sticky: pinned below the fixed top bar, not scrolled away under it.
    expect(p.top, 'bill panel is hidden under the top bar').toBeGreaterThanOrEqual(64);
    expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight), 'cart list should scroll').toBe(true);

    // The last line is reachable by scrolling the cart list, and can be removed.
    const last = page.getByText(`POS Item ${MANY}`, { exact: true }).last();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    await expect(checkout).toBeInViewport();
    await checkout.click();
    await expect(page.getByText(/payment|pay/i).first()).toBeVisible();
  });
}

test('bill stays pinned on screen while scrolling a long product list', async ({ page, api }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await fillCart(page, api, 60);
  const checkout = page.getByRole('button', { name: 'Checkout', exact: true });
  const panel = checkout.locator('xpath=ancestor::div[contains(concat(" ", @class, " "), " rounded-2xl ")][1]');
  for (const fraction of [0.4, 0.8]) {
    await page.evaluate((f) => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * f), fraction);
    const p = await box(panel);
    expect(p.top, `bill scrolled under the top bar at ${fraction * 100}%`).toBeGreaterThanOrEqual(64);
    expect(p.bottom, `bill cut off at the bottom at ${fraction * 100}%`).toBeLessThanOrEqual(p.vh);
    await expect(checkout).toBeInViewport();
  }
});

// Many categories make a very wide chip row; it must scroll inside its own bar and
// never push the product grid or the bill past the right edge of the screen.
const CATEGORY_NAMES = ['Candies', 'Biscuits', 'Oral Care', 'Ghee & Butter', 'Cooking oil', 'Hair Care',
  'Dishwashing', 'Sugar & Salt', 'Baby Food', 'Bath & Body', 'Incense Sticks & Dhoop', 'Laundry',
  'Snacks & Namkeen', 'Tea & Coffee', 'Spices & Masala', 'Dry Fruits', 'Pickles', 'Frozen Food',
  'Cleaning Supplies', 'Personal Hygiene'];

for (const width of [1280, 1536, 1920]) {
  test(`nothing overflows to the right with many categories (${width}px wide)`, async ({ page, api }) => {
    await page.setViewportSize({ width, height: 900 });
    Object.assign(api.state.orders[0], { status: 'confirmed', workflowStatus: 'SELLER_ACCEPTED' });
    const items = catalog(30).map((p, i) => ({
      ...p,
      categoryId: { _id: `64b7f0c2a1b2c3d4e5f7${String(1000 + (i % CATEGORY_NAMES.length)).padStart(4, '0')}`, name: CATEGORY_NAMES[i % CATEGORY_NAMES.length] },
    }));
    api.on('GET', /^\/seller\/pos\/catalog$/, () => ({ status: 200, json: { success: true, error: false, message: 'ok', results: items } }));
    await loginAs(page, 'seller');
    await page.goto('/seller/pos');
    await expect(page.getByRole('button', { name: 'Personal Hygiene' })).toBeAttached();

    const checkout = page.getByRole('button', { name: 'Checkout', exact: true });
    const r = await checkout.locator('xpath=ancestor::div[contains(concat(" ", @class, " "), " rounded-2xl ")][1]').evaluate((el) => {
      const b = el.getBoundingClientRect();
      const grid = document.querySelector('.grid').getBoundingClientRect();
      const lastCard = [...document.querySelectorAll('button')].filter((x) => x.textContent.includes('POS Item')).map((x) => x.getBoundingClientRect().right);
      const bar = [...document.querySelectorAll('div')].find((d) => d.className.includes('overflow-x-auto') && d.textContent.startsWith('All'));
      return { billRight: b.right, billLeft: b.left, vw: document.documentElement.clientWidth, maxCardRight: Math.max(...lastCard), barScrolls: bar.scrollWidth > bar.clientWidth, barRight: bar.getBoundingClientRect().right };
    });
    expect(r.billRight, 'bill panel goes past the right edge').toBeLessThanOrEqual(r.vw);
    expect(r.maxCardRight, 'product cards go past the bill panel').toBeLessThanOrEqual(r.billLeft);
    expect(r.barRight, 'category bar goes past the bill panel').toBeLessThanOrEqual(r.billLeft);
    expect(r.barScrolls, 'category chips should scroll inside their bar').toBe(true);
    await expect(checkout).toBeInViewport();
  });
}

