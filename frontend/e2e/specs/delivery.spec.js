/**
 * Delivery partner app journeys: OTP login, dashboard, earnings, history,
 * COD cash, profile and sign-out.
 */
import { test, expect, loginAs, expectNoCrash, OTP, data } from '../fixtures/test.js';

const { profiles } = data;

async function requestOtp(page, phone) {
  await page.goto('/delivery/auth');
  await page.locator('input[type="tel"]').first().fill(phone);
  await page.getByRole('button', { name: /Login Now/i }).click();
}

async function fillOtp(page, otp) {
  for (let i = 0; i < otp.length; i += 1) await page.locator(`#otp-${i}`).fill(otp[i]);
}

test.describe('delivery: OTP login', () => {
  test('registered rider logs in and reaches the dashboard', async ({ page, api }) => {
    await requestOtp(page, profiles.delivery.phone);
    await expect.poll(() => api.callsTo('POST', /^\/delivery\/send-login-otp$/).length).toBe(1);

    await fillOtp(page, OTP);
    await page.getByRole('button', { name: /Verify & Login/i }).click();

    await expect(page).toHaveURL(/\/delivery\/dashboard/);
    expect(api.callsTo('POST', /^\/delivery\/verify-otp$/)[0].body).toEqual(
      expect.objectContaining({ phone: profiles.delivery.phone, otp: OTP }),
    );
    expect(await page.evaluate(() => localStorage.getItem('auth_delivery'))).toBeTruthy();
    await expectNoCrash(page, api);
  });

  test('unknown phone numbers are rejected', async ({ page }) => {
    await requestOtp(page, '9000000009');
    await expect(page.locator(`#otp-0`)).toHaveCount(0);
    await expect(page).toHaveURL(/\/delivery\/auth/);
  });

  test('wrong OTP keeps the rider on the auth screen', async ({ page }) => {
    await requestOtp(page, profiles.delivery.phone);
    await fillOtp(page, '0000');
    await page.getByRole('button', { name: /Verify & Login/i }).click();
    await expect(page).toHaveURL(/\/delivery\/auth/);
    expect(await page.evaluate(() => localStorage.getItem('auth_delivery'))).toBeNull();
  });

  test('guests are redirected to delivery login', async ({ page }) => {
    await page.goto('/delivery/earnings');
    await expect(page).toHaveURL(/\/delivery\/auth/);
  });
});

test.describe('delivery: app', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'delivery');
  });

  test('dashboard shows rider status and today stats', async ({ page, api }) => {
    await page.goto('/delivery/dashboard');
    await expect(page.getByText('E2E Rider').first()).toBeVisible();
    await expect(page.locator('body')).toContainText(/OFFLINE|ONLINE/i);
    await expect.poll(() => api.callsTo('GET', /^\/delivery\/stats$/).length).toBeGreaterThan(0);
  });

  test('bottom navigation moves between tabs', async ({ page }) => {
    await page.goto('/delivery/dashboard');
    await page.getByText('Earnings', { exact: true }).last().click();
    await expect(page).toHaveURL(/\/delivery\/earnings/);
    await page.getByText('History', { exact: true }).last().click();
    await expect(page).toHaveURL(/\/delivery\/history/);
    await page.getByText('Profile', { exact: true }).last().click();
    await expect(page).toHaveURL(/\/delivery\/profile/);
  });

  test('COD cash page loads the summary', async ({ page, api }) => {
    await page.goto('/delivery/cod-cash');
    await expect(page.getByText(/COD Cash/i).first()).toBeVisible();
    await expect.poll(() => api.callsTo('GET', /^\/delivery\/cod\/summary$/).length).toBeGreaterThan(0);
  });

  test('order history shows the empty state', async ({ page }) => {
    await page.goto('/delivery/history');
    await expect(page.getByText(/No Orders Found/i)).toBeVisible();
  });

  test('logout clears the rider session', async ({ page }) => {
    await page.goto('/delivery/profile');
    await page.getByRole('button', { name: /Logout/i }).click();
    await expect(page).toHaveURL(/\/delivery\/auth/);
    expect(await page.evaluate(() => localStorage.getItem('auth_delivery'))).toBeNull();
  });
});
