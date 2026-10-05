/**
 * Cross-portal access control: each role only reaches its own panel, and
 * guests are bounced to the right login screen.
 */
import { test, expect, loginAs, asGuest } from '../fixtures/test.js';

test.describe('access control', () => {
  for (const [path, login] of [
    ['/orders', /\/login/],
    ['/profile', /\/login/],
    ['/checkout', /\/login/],
    ['/seller/products', /\/seller\/auth/],
    ['/admin/settings', /\/admin\/auth/],
    ['/delivery/dashboard', /\/delivery\/auth/],
  ]) {
    test(`guest visiting ${path} is sent to login`, async ({ page }) => {
      await asGuest(page);
      await page.goto(path);
      await expect(page).toHaveURL(login);
    });
  }

  test('a customer session cannot open the admin panel', async ({ page }) => {
    await loginAs(page, 'customer');
    await page.goto('/admin/customers');
    await expect(page).not.toHaveURL(/\/admin\/customers/);
  });

  test('a seller session cannot open the admin panel', async ({ page }) => {
    await loginAs(page, 'seller');
    await page.goto('/admin/customers');
    await expect(page).not.toHaveURL(/\/admin\/customers/);
  });

  test('an expired token is treated as logged out', async ({ page }) => {
    await page.addInitScript(() => {
      const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
      const expired = `${b64({ alg: 'HS256' })}.${b64({ id: 'x', role: 'admin', exp: 1 })}.sig`;
      localStorage.setItem('turbocart:storage_schema_version', '2');
      localStorage.setItem('auth_admin', expired);
    });
    await page.goto('/admin/customers');
    await expect(page).toHaveURL(/\/admin\/auth/);
  });

  test('unknown routes fall back to the storefront', async ({ page }) => {
    await asGuest(page);
    await page.goto('/this/route/does/not/exist');
    await expect(page).toHaveURL((url) => url.pathname === '/');
  });
});
