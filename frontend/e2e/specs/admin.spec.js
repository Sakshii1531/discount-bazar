/**
 * Admin panel journeys: login, dashboard, seller approvals, customers,
 * FAQs, orders and navigation.
 */
import { test, expect, loginAs, expectNoCrash, PASSWORDS, data } from '../fixtures/test.js';

const { IDS, profiles } = data;

async function submitLogin(page, email, password) {
  await page.goto('/admin/auth');
  await page.getByPlaceholder('Username or email').fill(email);
  await page.getByPlaceholder('Password').fill(password);
  await page.getByRole('button', { name: /Login Now/i }).click();
}

test.describe('admin: login', () => {
  test('valid credentials open the admin dashboard', async ({ page, api }) => {
    await submitLogin(page, profiles.admin.email, PASSWORDS.admin);
    await expect(page).toHaveURL(/\/admin\/?$/);
    await expect(page.locator('body')).toContainText(/ADMIN CENTER/i);
    expect(await page.evaluate(() => localStorage.getItem('auth_admin'))).toBeTruthy();
    await expectNoCrash(page, api);
  });

  test('invalid credentials are rejected', async ({ page }) => {
    await submitLogin(page, profiles.admin.email, 'not-the-password');
    await expect(page).toHaveURL(/\/admin\/auth/);
    expect(await page.evaluate(() => localStorage.getItem('auth_admin'))).toBeNull();
  });

  test('guests are redirected to admin login', async ({ page }) => {
    await page.goto('/admin/customers');
    await expect(page).toHaveURL(/\/admin\/auth/);
  });
});

test.describe('admin: management', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'admin');
  });

  test('dashboard loads platform stats', async ({ page, api }) => {
    await page.goto('/admin');
    await expect.poll(() => api.callsTo('GET', /^\/admin\/stats$/).length).toBeGreaterThan(0);
    await expectNoCrash(page, api);
  });

  test('a pending seller with documents can be approved', async ({ page, api }) => {
    const pending = api.state.pendingSellers[0];
    pending.documents = ['Trade License'];
    await page.goto('/admin/sellers/pending');
    await expect(page.getByText(pending.shopName).first()).toBeVisible();

    await page.getByRole('button', { name: 'REVIEW' }).first().click();
    await page.getByRole('button', { name: /APPROVE SELLER/i }).click();

    await expect.poll(() => api.callsTo('PATCH', /^\/admin\/sellers\/approve\//).length).toBe(1);
    expect(api.callsTo('PATCH', /^\/admin\/sellers\/approve\//)[0].path).toBe(`/admin/sellers/approve/${pending.id}`);
    await expect(page.getByText(pending.shopName)).toHaveCount(0);
  });

  test('an application without documents cannot be approved', async ({ page }) => {
    await page.goto('/admin/sellers/pending');
    await page.getByRole('button', { name: 'REVIEW' }).first().click();
    await expect(page.getByRole('button', { name: /REJECT APPLICATION/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /APPROVE SELLER/i })).toHaveCount(0);
    await expect(page.getByTitle('Quick Approve')).toHaveCount(0);
  });

  test('customers list shows registered customers', async ({ page }) => {
    await page.goto('/admin/customers');
    await expect(page.getByText('E2E Customer').first()).toBeVisible();
  });

  test('active sellers list shows approved shops', async ({ page }) => {
    await page.goto('/admin/sellers/active');
    await expect(page.getByText('E2E Mart').first()).toBeVisible();
  });

  test('FAQ manager lists FAQs', async ({ page }) => {
    await page.goto('/admin/faqs');
    await expect(page.getByText('How fast is delivery?').first()).toBeVisible();
  });

  test('orders list shows orders', async ({ page }) => {
    await page.goto('/admin/orders/all');
    await expect(page.getByText(IDS.order).first()).toBeVisible();
  });

  test('product moderation lists products', async ({ page }) => {
    await page.goto('/admin/products');
    await expect(page.getByText('Fresh Milk').first()).toBeVisible();
  });

  test('sidebar navigation works', async ({ page }) => {
    await page.goto('/admin');
    await page.getByRole('link', { name: 'Customers', exact: true }).first().click();
    await expect(page).toHaveURL(/\/admin\/customers/);
    await page.getByRole('link', { name: 'FAQs', exact: true }).first().click();
    await expect(page).toHaveURL(/\/admin\/faqs/);
  });
});
