/**
 * Purchase bill → Edit product → Add variant, end to end: the new variant is
 * saved (no stock, server SKU), shows up in the bill line's variant list, and
 * can be bought on the bill. Also: validation, removing an unsaved row, and
 * giving a product without variants its first ones.
 */
import { test, expect, loginAs, data } from '../fixtures/test.js';

const multi = () => ({
  ...data.products[0],
  _id: '64b7f0c2a1b2c3d4e5f69101',
  name: 'Alpenliebe JUZT JELLY',
  sku: 'ALPEN-001',
  gstPercent: 5,
  purchaseGstType: 'INCLUSIVE',
  stock: 24,
  variants: ['Jungle Land', 'Orange Bears'].map((name, i) => ({
    _id: `64b7f0c2a1b2c3d4e5f6920${i}`, name, sku: `ALPEN-00${i + 1}`, price: 10, salePrice: 10,
    purchaseCost: 8.75, barcode: `89013930268${i}`, stock: 12,
  })),
});

const single = () => ({
  ...data.products[0],
  _id: '64b7f0c2a1b2c3d4e5f69102',
  name: 'Toned Milk',
  sku: 'MILK-STD',
  price: 30, salePrice: 28, purchaseCost: 25, barcode: '8900500',
  stock: 7,
  variants: [],
});

// Catalog + product update that behave like the backend for a seller.
function catalogServer(api, products) {
  const state = { products, puts: [] };
  api.on('GET', /^\/seller\/pos\/catalog$/, () => ({ status: 200, json: { success: true, error: false, message: 'ok', results: state.products } }));
  api.on('PUT', /^\/products\/([^/]+)$/, ({ match, body }) => {
    state.puts.push(body);
    const p = state.products.find((x) => x._id === match[1]);
    if (body.variants) {
      p.variants = body.variants.map((v, i) => {
        const saved = (p.variants || []).find((o) => o.sku === v.sku) || (v.sku === p.sku ? { stock: p.stock } : null);
        return { ...v, sku: v.sku || `ALPEN-NEW${i}`, stock: saved ? saved.stock : Number(v.stock) || 0 };
      });
      p.stock = p.variants.reduce((s, v) => s + v.stock, 0);
    }
    return { status: 200, json: { success: true, error: false, message: 'Product updated successfully', result: p } };
  });
  return state;
}

async function openEditor(page, api, product, variantSku) {
  Object.assign(api.state.orders[0], { status: 'confirmed', workflowStatus: 'SELLER_ACCEPTED' });
  await loginAs(page, 'seller');
  await page.goto('/seller/business/purchases');
  await page.getByPlaceholder(/search name or scan barcode/i).first().click();
  await page.getByRole('button', { name: new RegExp(product.name) }).first().click();
  if (variantSku) await page.locator('select').filter({ hasText: 'Choose variant' }).first().selectOption(variantSku);
  await page.getByRole('button', { name: `Edit ${product.name}` }).filter({ visible: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Edit Product' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('purchase bill: add variant from the edit popup', () => {
  test('adds a variant, then buys it on the bill', async ({ page, api }) => {
    const product = multi();
    const server = catalogServer(api, [product]);
    const dialog = await openEditor(page, api, product, 'ALPEN-001');

    await dialog.getByRole('button', { name: 'Add variant' }).click();
    const row = dialog.getByTestId('new-variant');
    await expect(row).toHaveCount(1);
    const name = row.getByLabel('New variant name');
    await expect(name).toBeFocused();
    // Prices start from the variant above.
    await expect(row.locator('input[type="number"]').first()).toHaveValue('10');
    await name.fill('Mango Bites');
    const nums = row.locator('input[type="number"]');
    await nums.nth(0).fill('12');
    await nums.nth(1).fill('11');
    await nums.nth(2).fill('9.45');
    await expect(row.getByText('Stock: 0 (add on this bill)')).toBeVisible();

    await dialog.getByRole('button', { name: 'Save Product' }).click();
    await expect(dialog).toBeHidden();
    expect(server.puts).toHaveLength(1);
    const sent = server.puts[0].variants;
    expect(sent.map((v) => v.sku)).toEqual(['ALPEN-001', 'ALPEN-002', '']);
    expect(sent[2]).toEqual(expect.objectContaining({ name: 'Mango Bites', price: 12, salePrice: 11, purchaseCost: 9.45, stock: 0 }));
    // Saved variants are sent whole (stock left to the server).
    expect(sent[0]).toEqual(expect.objectContaining({ name: 'Jungle Land', barcode: '890139302680', _id: product.variants[0]._id }));

    // The new variant is in the line's variant list and can be bought.
    const variantSelect = page.locator('select').filter({ hasText: 'Mango Bites' }).first();
    await variantSelect.selectOption({ label: 'Mango Bites' });
    await page.getByPlaceholder('Qty purchased').first().fill('6');
    await page.getByPlaceholder('E.G. INV-9042').fill('INV-77');
    await page.getByRole('button', { name: /Save & Confirm/ }).click();
    await expect.poll(() => api.callsTo('POST', /^\/seller\/business\/purchases$/).length).toBe(1);
    const bill = api.callsTo('POST', /^\/seller\/business\/purchases$/)[0].body;
    expect(bill.confirm).toBe(true);
    expect(bill.items).toEqual([expect.objectContaining({ productId: product._id, variantSku: 'ALPEN-NEW2', quantity: 6 })]);
  });

  test('validates new variants and lets an unsaved row be removed', async ({ page, api }) => {
    const product = multi();
    const server = catalogServer(api, [product]);
    const dialog = await openEditor(page, api, product, 'ALPEN-001');
    const save = dialog.getByRole('button', { name: 'Save Product' });

    await dialog.getByRole('button', { name: 'Add variant' }).click();
    await save.click();
    await expect(page.getByText('Give every new variant a name')).toBeVisible();

    await dialog.getByLabel('New variant name').fill('jungle land');
    await save.click();
    await expect(page.getByText('Two variants are named "jungle land"')).toBeVisible();

    await dialog.getByLabel('New variant name').fill('Cola Bottles');
    await dialog.getByLabel('New variant SKU').fill('alpen-002');
    await save.click();
    await expect(page.getByText('Two variants have the SKU "ALPEN-002"')).toBeVisible();
    expect(server.puts).toHaveLength(0);

    await dialog.getByRole('button', { name: 'Remove new variant' }).click();
    await expect(dialog.getByTestId('new-variant')).toHaveCount(0);
    await expect(dialog.getByTestId('variant')).toHaveCount(2);
  });

  test('gives a product without variants its first variants, keeping its stock', async ({ page, api }) => {
    const product = single();
    const server = catalogServer(api, [product]);
    const dialog = await openEditor(page, api, product);

    await dialog.getByRole('button', { name: /Add variant/ }).click();
    await expect(dialog.getByTestId('variant')).toHaveCount(1); // the product itself, as variant 1
    await expect(dialog.getByText('SKU: MILK-STD')).toBeVisible();
    await dialog.getByLabel('New variant name').fill('1 Litre');
    await dialog.getByRole('button', { name: 'Save Product' }).click();
    await expect(dialog).toBeHidden();

    const sent = server.puts[0].variants;
    expect(sent[0]).toEqual(expect.objectContaining({ sku: 'MILK-STD', name: 'Standard', price: 30, salePrice: 28, barcode: '8900500', purchaseCost: 25, stock: 7 }));
    expect(sent[1]).toEqual(expect.objectContaining({ sku: '', name: '1 Litre', price: 30, stock: 0 }));
    // The bill line now points at variant 1 instead of asking for a variant.
    await expect(page.locator('select').filter({ hasText: '1 Litre' }).first()).toHaveValue('MILK-STD');
  });
});
