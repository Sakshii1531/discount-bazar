/**
 * Customer storefront journeys: OTP login, browsing, search, product detail,
 * cart, wishlist, orders, profile and sign-out.
 */
import { test, expect, loginAs, asGuest, expectNoCrash, OTP, data } from '../fixtures/test.js';

const { IDS } = data;

async function enterOtp(page, otp) {
  const boxes = page.locator('input[type="tel"][maxlength="1"]');
  await expect(boxes).toHaveCount(4);
  for (let i = 0; i < otp.length; i += 1) await boxes.nth(i).fill(otp[i]);
}

test.describe('customer: OTP login', () => {
  test('logs in with phone + OTP and lands on the storefront', async ({ page, api }) => {
    await asGuest(page);
    await page.goto('/login');
    await page.getByPlaceholder('Mobile Number').fill('9876543210');
    await page.getByRole('button', { name: /Continue/ }).click();

    await expect.poll(() => api.callsTo('POST', /^\/customer\/send-login-otp$/).length).toBe(1);
    expect(api.callsTo('POST', /^\/customer\/send-login-otp$/)[0].body.phone).toContain('9876543210');

    await enterOtp(page, OTP);
    await page.getByRole('button', { name: /^Enter / }).click();

    await expect(page).not.toHaveURL(/\/login/);
    const token = await page.evaluate(() => localStorage.getItem('auth_customer'));
    expect(token).toBeTruthy();
    await expectNoCrash(page, api);
  });

  test('rejects a wrong OTP and stays on the login page', async ({ page, api }) => {
    await asGuest(page);
    await page.goto('/login');
    await page.getByPlaceholder('Mobile Number').fill('9876543210');
    await page.getByRole('button', { name: /Continue/ }).click();
    await enterOtp(page, '9999');
    await page.getByRole('button', { name: /^Enter / }).click();

    await expect.poll(() => api.callsTo('POST', /^\/customer\/verify-otp$/).length).toBe(1);
    await expect(page).toHaveURL(/\/login/);
    expect(await page.evaluate(() => localStorage.getItem('auth_customer'))).toBeNull();
  });

  test('protected pages redirect guests to login and back after signing in', async ({ page }) => {
    await asGuest(page);
    await page.goto('/orders');
    await expect(page).toHaveURL(/\/login/);

    await page.getByPlaceholder('Mobile Number').fill('9876543210');
    await page.getByRole('button', { name: /Continue/ }).click();
    await enterOtp(page, OTP);
    await page.getByRole('button', { name: /^Enter / }).click();

    await expect(page).toHaveURL(/\/orders$/);
    await expect(page.getByText(IDS.order).filter({ visible: true }).first()).toBeVisible();
  });
});

test.describe('customer: browsing', () => {
  test('home lists nearby products', async ({ page, api }) => {
    await asGuest(page);
    await page.goto('/');
    await expect(page.getByText('Fresh Milk').filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText('Basmati Rice').filter({ visible: true }).first()).toBeVisible();
    const productCall = api.callsTo('GET', /^\/products$/)[0];
    expect(Number(productCall.query.lat)).toBeCloseTo(data.LOCATION.lat, 3);
    expect(Number(productCall.query.lng)).toBeCloseTo(data.LOCATION.lng, 3);
  });

  test('categories page shows the category tree', async ({ page }) => {
    await asGuest(page);
    await page.goto('/categories');
    await expect(page.getByText('Dairy & Breads').filter({ visible: true }).first()).toBeVisible();
  });

  test('search narrows products by name', async ({ page }) => {
    await asGuest(page);
    await page.goto('/search');
    await page.getByPlaceholder('Search items, categories...').fill('rice');
    await expect(page.getByText('Basmati Rice').filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText('Brown Bread')).toHaveCount(0);
  });

  test('product detail shows price and details', async ({ page }) => {
    await asGuest(page);
    await page.goto(`/product/${IDS.milk}`);
    await expect(page.getByText('Fresh Milk').filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText(/₹\s*55/).filter({ visible: true }).first()).toBeVisible();
  });

  test('unknown product shows a friendly unavailable state', async ({ page, api }) => {
    await asGuest(page);
    await page.goto('/product/64b7f0c2a1b2c3d4e5f6ffff');
    await expect(page.getByText(/unavailable|couldn't load/i).filter({ visible: true }).first()).toBeVisible();
    await expectNoCrash(page, api);
  });
});

test.describe('customer: cart & wishlist', () => {
  test('adds a product to the cart from the product page', async ({ page, api }) => {
    await loginAs(page, 'customer');
    await page.goto(`/product/${IDS.milk}`);
    await page.getByRole('button', { name: /ADD TO CART/i }).first().click();

    await expect.poll(() => api.callsTo('POST', /^\/cart\/add$/).length).toBeGreaterThan(0);
    expect(api.callsTo('POST', /^\/cart\/add$/)[0].body).toEqual(
      expect.objectContaining({ productId: IDS.milk, quantity: 1 }),
    );
    expect(api.state.cart).toEqual([{ productId: IDS.milk, quantity: 1 }]);
  });

  test('checkout shows items already in the cart', async ({ page, api }) => {
    api.state.cart = [{ productId: IDS.bread, quantity: 2 }];
    await loginAs(page, 'customer');
    await page.goto('/checkout');
    await expect(page.getByText('Brown Bread').filter({ visible: true }).first()).toBeVisible();
    await expectNoCrash(page, api);
  });

  test('wishlist page lists saved products', async ({ page }) => {
    await loginAs(page, 'customer');
    await page.goto('/wishlist');
    await expect(page.getByText(/No items in wishlist/i)).toBeVisible();
  });

  test('wishlist shows previously saved items', async ({ page, api }) => {
    api.state.wishlist = [IDS.rice];
    await loginAs(page, 'customer');
    await page.goto('/wishlist');
    await expect(page.getByText('Basmati Rice').filter({ visible: true }).first()).toBeVisible();
  });
});

test.describe('customer: account', () => {
  test('orders list links to order details', async ({ page }) => {
    await loginAs(page, 'customer');
    await page.goto('/orders');
    await expect(page.getByText(IDS.order).filter({ visible: true }).first()).toBeVisible();
    await page.getByText(IDS.order).first().click();
    await expect(page).toHaveURL(new RegExp(`/orders/${IDS.order}`));
    await expect(page.getByText('Fresh Milk').filter({ visible: true }).first()).toBeVisible();
  });

  test('profile shows the signed-in customer', async ({ page }) => {
    await loginAs(page, 'customer');
    await page.goto('/profile');
    await expect(page.getByText('E2E Customer').filter({ visible: true }).first()).toBeVisible();
  });

  test('edits the profile name', async ({ page, api }) => {
    await loginAs(page, 'customer');
    await page.goto('/profile/edit');
    const name = page.locator('input[name="name"]');
    await expect(name).toHaveValue('E2E Customer');
    await name.fill('Renamed Customer');
    await page.getByRole('button', { name: /Save Changes/i }).click();
    await expect.poll(() => api.callsTo('PUT', /^\/customer\/profile$/).length).toBe(1);
    expect(api.callsTo('PUT', /^\/customer\/profile$/)[0].body.name).toBe('Renamed Customer');
  });

  test('signs out and clears the session', async ({ page }) => {
    await loginAs(page, 'customer');
    await page.goto('/profile');
    await page.getByRole('button', { name: /Sign out/i }).first().click();
    await page.getByRole('button', { name: /Sign out|Yes|Logout/i }).last().click();
    await expect(page).toHaveURL(/\/login/);
    expect(await page.evaluate(() => localStorage.getItem('auth_customer'))).toBeNull();
  });

  test('support page shows FAQs', async ({ page }) => {
    await loginAs(page, 'customer');
    await page.goto('/support');
    await expect(page.getByText('How fast is delivery?')).toBeVisible();
  });
});
