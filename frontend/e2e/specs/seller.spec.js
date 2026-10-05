/**
 * Seller panel journeys: password login, approval gate, dashboard, products,
 * orders, POS catalog and sign-out.
 */
import { test, expect, loginAs, expectNoCrash, PASSWORDS, data } from '../fixtures/test.js';

const { profiles } = data;

async function submitLogin(page, id, password) {
  await page.goto('/seller/auth');
  await page.getByPlaceholder('Email or Phone Number').fill(id);
  await page.getByPlaceholder('Enter your password').fill(password);
  await page.getByRole('button', { name: /ENTER DASHBOARD/i }).click();
}

test.describe('seller: login', () => {
  test('approved seller reaches the dashboard', async ({ page, api }) => {
    await submitLogin(page, profiles.seller.email, PASSWORDS.seller);
    await expect(page).toHaveURL(/\/seller\/?$/);
    await expect(page.locator('body')).toContainText(/SELLER PANEL/i);
    expect(api.callsTo('POST', /^\/seller\/login$/)[0].body).toEqual({
      emailOrPhone: profiles.seller.email,
      password: PASSWORDS.seller,
    });
    expect(await page.evaluate(() => localStorage.getItem('auth_seller'))).toBeTruthy();
    await expectNoCrash(page, api);
  });

  test('wrong password keeps the seller on the login page', async ({ page }) => {
    await submitLogin(page, profiles.seller.email, 'wrong-password');
    await expect(page).toHaveURL(/\/seller\/auth/);
    expect(await page.evaluate(() => localStorage.getItem('auth_seller'))).toBeNull();
  });

  test('pending application is sent to the approval screen', async ({ page }) => {
    await submitLogin(page, 'pending@e2e.test', 'anything');
    await expect(page).toHaveURL(/\/seller\/pending-approval/);
  });

  test('guests are redirected to seller login', async ({ page }) => {
    await page.goto('/seller/orders');
    await expect(page).toHaveURL(/\/seller\/auth/);
  });
});

test.describe('seller: incoming orders', () => {
  test('a new order pops up and can be accepted', async ({ page, api }) => {
    await loginAs(page, 'seller');
    await page.goto('/seller');
    await expect(page.getByText('New Order Received')).toBeVisible();
    await expect(page.getByText(`#${data.IDS.order}`)).toBeVisible();

    const before = api.calls.length;
    await page.getByRole('button', { name: /Accept Order/i }).click();
    await expect
      .poll(() =>
        api.calls
          .slice(before)
          .some((c) => c.method !== 'GET' && c.path.includes(data.IDS.order)),
      )
      .toBe(true);
  });
});

test.describe('seller: workspace', () => {
  test.beforeEach(async ({ page, api }) => {
    // An already-accepted order, so the incoming-order popup doesn't cover the page.
    Object.assign(api.state.orders[0], { status: 'confirmed', workflowStatus: 'SELLER_ACCEPTED' });
    await loginAs(page, 'seller');
  });

  test('products page lists the seller catalogue', async ({ page }) => {
    await page.goto('/seller/products');
    await expect(page.getByText('Fresh Milk').first()).toBeVisible();
    await expect(page.getByText('Brown Bread').first()).toBeVisible();
  });

  test('orders page lists incoming orders', async ({ page, api }) => {
    await page.goto('/seller/orders');
    await expect.poll(() => api.callsTo('GET', /^\/orders\/seller-orders$/).length).toBeGreaterThan(0);
    await expect(page.getByText('E2E Customer').filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText('#' + data.IDS.order).filter({ visible: true }).first()).toBeVisible();
  });

  test('add-product form loads categories', async ({ page, api }) => {
    await page.goto('/seller/products/add');
    await expect.poll(() => api.calls.some((c) => c.path === '/admin/categories' && c.query.tree === 'true')).toBe(true);
    await expectNoCrash(page, api);
  });

  test('inventory page loads stock', async ({ page, api }) => {
    await page.goto('/seller/inventory');
    await expect(page.getByText('Fresh Milk').first()).toBeVisible();
    await expectNoCrash(page, api);
  });

  test('POS terminal loads the sale catalogue', async ({ page, api }) => {
    await page.goto('/seller/pos');
    await expect.poll(() => api.callsTo('GET', /^\/seller\/pos\/catalog$/).length).toBeGreaterThan(0);
    await expect(page.getByText('Fresh Milk').first()).toBeVisible();
  });

  test('sidebar navigates between sections', async ({ page }) => {
    await page.goto('/seller');
    // The sidebar renders desktop + mobile copies of each link; click the visible one.
    const nav = (name) => page.getByRole('link', { name, exact: true }).filter({ visible: true }).first();
    await nav('Orders').click();
    await expect(page).toHaveURL(/\/seller\/orders/);
    await nav('Products').click();
    await expect(page).toHaveURL(/\/seller\/products/);
  });

  test('profile shows shop details', async ({ page }) => {
    await page.goto('/seller/profile');
    await expect(page.getByText('E2E Mart').first()).toBeVisible();
  });
});
