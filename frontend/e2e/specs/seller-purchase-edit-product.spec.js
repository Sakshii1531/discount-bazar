/**
 * Purchase bill → Edit product popup: a product with many variants is taller
 * than the screen; the popup must stay within it (header and Save visible) and
 * scroll its fields instead of being cut off at the top.
 */
import { test, expect, loginAs, data } from '../fixtures/test.js';

const product = {
  ...data.products[0],
  _id: '64b7f0c2a1b2c3d4e5f69001',
  name: 'Alpenliebe JUZT JELLY',
  gstPercent: 5,
  purchaseGstType: 'INCLUSIVE',
  variants: ['Jungle Land', 'Orange Bears', 'Cola Bottles', 'Fruity Bears', 'Fruity Salad'].map((name, i) => ({
    _id: `64b7f0c2a1b2c3d4e5f6910${i}`, name, sku: `ALPEN-00${i + 1}`, price: 10, salePrice: 10,
    purchaseCost: 8.75, barcode: `89013930268${i}`, stock: 8,
  })),
};

const box = (locator) => locator.evaluate((el) => {
  const r = el.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, vh: window.innerHeight };
});

for (const viewport of [{ width: 1366, height: 700 }, { width: 390, height: 760 }]) {
  test(`edit popup fits the screen and scrolls (${viewport.width}x${viewport.height})`, async ({ page, api }) => {
    await page.setViewportSize(viewport);
    Object.assign(api.state.orders[0], { status: 'confirmed', workflowStatus: 'SELLER_ACCEPTED' });
    api.on('GET', /^\/seller\/pos\/catalog$/, () => ({ status: 200, json: { success: true, error: false, message: 'ok', results: [product] } }));
    await loginAs(page, 'seller');
    await page.goto('/seller/business/purchases');

    await page.getByPlaceholder(/search name or scan barcode/i).first().click();
    await page.getByRole('button', { name: /Alpenliebe JUZT JELLY/ }).first().click();
    await page.locator('select').filter({ hasText: 'Choose variant' }).first().selectOption('ALPEN-001');
    // Highlighted: filled with the brand colour, readable text.
    const editBtn = page.getByRole('button', { name: `Edit ${product.name}` }).filter({ visible: true }).first();
    const look = await editBtn.evaluate((el) => {
      const probe = document.createElement('div');
      probe.style.backgroundColor = 'var(--primary)';
      document.body.appendChild(probe);
      const brand = getComputedStyle(probe).backgroundColor;
      probe.remove();
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, brand, color: cs.color };
    });
    expect(look.bg).toBe(look.brand);
    expect(look.color).not.toBe(look.bg);
    if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}-${viewport.width}.png` });
    await editBtn.click();

    const dialog = page.getByRole('dialog', { name: 'Edit Product' });
    await expect(dialog).toBeVisible();
    const d = await box(dialog);
    expect(d.top, 'popup cut off at the top').toBeGreaterThanOrEqual(0);
    expect(d.bottom, 'popup cut off at the bottom').toBeLessThanOrEqual(d.vh);

    await expect(dialog.getByRole('heading', { name: 'Edit Product' })).toBeInViewport();
    const save = dialog.getByRole('button', { name: 'Save Product' });
    await expect(save).toBeInViewport();

    // The last variant is reachable by scrolling the fields, and Save stays visible.
    const last = dialog.locator('input[value="Fruity Salad"]');
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    await last.fill('Fruity Salad 2');
    await expect(save).toBeInViewport();
    await expect(dialog.getByRole('heading', { name: 'Edit Product' })).toBeInViewport();
  });
}
