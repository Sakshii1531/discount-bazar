/**
 * Admin brand colours (Settings → Branding) theme every panel: live preview
 * while editing, validation, save, revert on leave, and no default-colour flash
 * on the next load.
 */
import { test, expect, loginAs, asGuest, data } from '../fixtures/test.js';

const GREEN = '#08f7a7';
const RED = '#e41d07';
const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

// Stateful /settings so a save is what later requests return.
function settingsStore(api, initial = {}, { delayMs = 0 } = {}) {
  const state = { ...data.settings, primaryColor: GREEN, secondaryColor: RED, ...initial };
  api.on('GET', /^\/settings$/, async () => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    return { status: 200, json: { success: true, error: false, message: 'ok', result: { ...state } } };
  });
  api.on('PUT', /^\/settings$/, ({ body }) => {
    Object.assign(state, body);
    return { status: 200, json: { success: true, error: false, message: 'Settings updated', result: { ...state } } };
  });
  return state;
}

const rootVar = (page, name) =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
const styleOf = (locator, prop) => locator.evaluate((el, p) => getComputedStyle(el)[p], prop);

test.describe('brand colours', () => {
  test('seller POS uses the saved primary and secondary colours with readable text', async ({ page, api }) => {
    settingsStore(api);
    Object.assign(api.state.orders[0], { status: 'confirmed', workflowStatus: 'SELLER_ACCEPTED' });
    await loginAs(page, 'seller');
    await page.goto('/seller/pos');
    await expect.poll(() => rootVar(page, '--primary')).toBe(GREEN);

    const checkout = page.getByRole('button', { name: 'Checkout', exact: true });
    expect(await styleOf(checkout, 'backgroundColor')).toBe(rgb(GREEN));
    expect(await styleOf(checkout, 'color')).toBe('rgb(0, 0, 0)'); // dark text on bright green

    const hold = page.getByRole('button', { name: /Hold/ });
    expect(await styleOf(hold, 'backgroundColor')).toBe(rgb(RED));
    expect(await styleOf(hold, 'color')).toBe('rgb(255, 255, 255)'); // white text on red
  });

  test('admin settings preview live, validate, save, and stay readable', async ({ page, api }) => {
    const saved = settingsStore(api);
    await loginAs(page, 'admin');
    await page.goto('/admin/settings');
    await page.getByRole('button', { name: 'Branding' }).click();
    const primary = page.locator('#settings-primaryColor');
    await expect(primary).toHaveValue(GREEN);

    // The black Save button keeps white text even with a light brand colour.
    const saveBtn = page.getByRole('button', { name: /save/i }).first();
    expect(await styleOf(saveBtn, 'color')).toBe('rgb(255, 255, 255)');

    await primary.fill('#ff6600');
    await expect.poll(() => rootVar(page, '--primary')).toBe('#ff6600');

    await primary.fill('#12');
    await expect(page.getByText('Enter a hex colour like #08f7a7 or #0f8.')).toBeVisible();
    const putsBefore = api.callsTo('PUT', /^\/settings$/).length;
    await saveBtn.click();
    await page.waitForTimeout(500);
    expect(api.callsTo('PUT', /^\/settings$/).length).toBe(putsBefore);

    await primary.fill('#0F8');
    await saveBtn.click();
    await expect.poll(() => api.callsTo('PUT', /^\/settings$/).length).toBe(putsBefore + 1);
    expect(api.callsTo('PUT', /^\/settings$/).at(-1).body.primaryColor).toBe('#00ff88');
    expect(saved.primaryColor).toBe('#00ff88');
    await expect.poll(() => rootVar(page, '--primary')).toBe('#00ff88');
  });

  test('leaving settings without saving restores the saved colours', async ({ page, api }) => {
    settingsStore(api);
    await loginAs(page, 'admin');
    await page.goto('/admin/settings');
    await page.getByRole('button', { name: 'Branding' }).click();
    await page.locator('#settings-primaryColor').fill('#123456');
    await expect.poll(() => rootVar(page, '--primary')).toBe('#123456');

    await page.getByRole('link', { name: 'Dashboard', exact: true }).filter({ visible: true }).first().click();
    await expect(page).not.toHaveURL(/settings/);
    await expect.poll(() => rootVar(page, '--primary')).toBe(GREEN);
    expect(api.callsTo('PUT', /^\/settings$/)).toHaveLength(0);
  });

  test('the next load shows the brand colour before /settings answers', async ({ page, api }) => {
    settingsStore(api, {}, { delayMs: 4000 });
    await asGuest(page);
    // First visit: settings arrive and the colours are remembered.
    await page.goto('/');
    await expect.poll(() => rootVar(page, '--primary'), { timeout: 15000 }).toBe(GREEN);

    // Second visit: /settings is slow, but the remembered colour is applied at start-up.
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    expect(await rootVar(page, '--primary')).toBe(GREEN);
  });

  test('customer header follows the brand colour (no fixed teal)', async ({ page, api }) => {
    settingsStore(api);
    await asGuest(page);
    await page.goto('/');
    await expect.poll(() => rootVar(page, '--primary')).toBe(GREEN);
    await page.waitForTimeout(1500);
    const teal = await page.evaluate(() =>
      [...document.querySelectorAll('header, header *, [style*="gradient"]')].some((el) => {
        const cs = getComputedStyle(el);
        return `${cs.backgroundImage} ${cs.backgroundColor}`.includes('rgb(14, 116, 144)');
      }),
    );
    expect(teal, 'old fixed teal header colour still used').toBe(false);
  });
});

// With a light brand colour, no white text may sit on the brand background
// (it must use --primary-foreground, which turns dark for light colours).
const CONTRAST_ROUTES = [
  ['guest', '/'], ['seller', '/seller'], ['seller', '/seller/pos'], ['seller', '/seller/products'],
  ['seller', '/seller/business'], ['admin', '/admin'], ['admin', '/admin/settings'], ['delivery', '/delivery'],
];
for (const [role, path] of CONTRAST_ROUTES) {
  test(`no white text on the light brand colour: ${role} ${path}`, async ({ page, api }) => {
    settingsStore(api);
    Object.assign(api.state.orders[0], { status: 'confirmed', workflowStatus: 'SELLER_ACCEPTED' });
    if (role === 'guest') await asGuest(page); else await loginAs(page, role);
    await page.goto(path);
    await expect.poll(() => rootVar(page, '--primary')).toBe(GREEN);
    await page.waitForTimeout(2500);
    const offenders = await page.evaluate((brand) => {
      const out = new Set();
      for (const el of document.querySelectorAll('body *')) {
        if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || !el.getClientRects().length || !/^rgba?\(255, 255, 255/.test(cs.color)) continue;
        for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
          const b = getComputedStyle(n).backgroundColor;
          if (b && b !== 'rgba(0, 0, 0, 0)' && b !== 'transparent') {
            if (b.startsWith(brand.slice(0, -1))) out.add(`"${el.textContent.trim().slice(0, 40)}" <${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 80)}">`);
            break;
          }
        }
      }
      return [...out];
    }, rgb(GREEN));
    expect(offenders).toEqual([]);
  });
}
