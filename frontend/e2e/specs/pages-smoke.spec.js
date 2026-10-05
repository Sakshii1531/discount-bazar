/**
 * Every routed page in every section renders without hitting the error
 * boundary or throwing uncaught errors, and stays on its own URL (i.e. the
 * auth guards accept a valid session).
 */
import { test, expect, loginAs, asGuest, expectNoCrash, expectRendered, data } from '../fixtures/test.js';

const { IDS } = data;

// `layout` is text every page of that panel shows (sidebar / bottom nav), proving
// the authenticated shell rendered rather than a redirect or loader.
const SECTIONS = {
  public: {
    role: null,
    layout: null,
    pages: {
      '/': /Grocery|Fresh Milk/,
      '/categories': /Categories/,
      '/category/dairy-breads': null,
      [`/product/${IDS.milk}`]: /Fresh Milk/,
      '/search': null,
      '/offers': /Offers/,
      '/shop-by-store': null,
      '/about': /About Us/,
      '/terms': /Terms/,
      '/privacy': /Privacy Policy/,
      '/payment-status': /PAYMENT/i,
      '/login': /Welcome Back/i,
      '/seller/auth': /Seller Login/i,
      '/admin/auth': /Login/,
      '/delivery/auth': /Partner Login/i,
      '/delivery/terms': null,
    },
  },
  customer: {
    role: 'customer',
    layout: null,
    pages: {
      '/profile': /My Profile/,
      '/profile/edit': /Edit Profile/,
      '/orders': /My Orders/,
      [`/orders/${IDS.order}`]: /ORD-E2E-1001|Fresh Milk/,
      '/transactions': /Transaction/,
      '/wishlist': /Wishlist/,
      '/addresses': /Addresses/,
      '/wallet': /Wallet/,
      '/notifications': /Notifications/,
      '/support': /Help & Support/,
      '/settings': /Settings/,
      '/checkout': null,
      '/chat': null,
    },
  },
  seller: {
    role: 'seller',
    layout: /SELLER PANEL/i,
    pages: {
      '/seller': null,
      '/seller/products': null,
      '/seller/products/add': null,
      '/seller/inventory': null,
      '/seller/orders': null,
      '/seller/returns': null,
      '/seller/tracking': null,
      '/seller/analytics': null,
      '/seller/transactions': null,
      '/seller/earnings': null,
      '/seller/withdrawals': null,
      '/seller/profile': null,
      '/seller/pos': null,
      '/seller/pos/sales': null,
      '/seller/pos/returns': null,
      '/seller/business': null,
      '/seller/business/purchases': null,
      '/seller/business/ledgers': null,
      '/seller/business/cash': null,
      '/seller/business/reports': null,
    },
  },
  admin: {
    role: 'admin',
    layout: /ADMIN CENTER/i,
    pages: {
      '/admin': null,
      '/admin/categories/hierarchy': null,
      '/admin/categories/header': null,
      '/admin/categories/level2': null,
      '/admin/categories/sub': null,
      '/admin/products': null,
      '/admin/experience-studio': null,
      '/admin/hero-categories': null,
      '/admin/notifications': null,
      '/admin/coupons': null,
      '/admin/offer-sections': null,
      '/admin/support-tickets': null,
      '/admin/moderation': null,
      '/admin/sellers/active': null,
      '/admin/sellers/pending': null,
      '/admin/seller-locations': null,
      '/admin/delivery-boys/active': null,
      '/admin/delivery-boys/pending': null,
      '/admin/delivery-ratings': null,
      '/admin/tracking': null,
      '/admin/delivery-funds': null,
      '/admin/wallet': null,
      '/admin/withdrawals': null,
      '/admin/seller-transactions': null,
      '/admin/cash-collection': null,
      '/admin/customers': null,
      '/admin/faqs': null,
      '/admin/orders/all': null,
      '/admin/orders/pending': null,
      '/admin/orders/delivered': null,
      '/admin/returns': null,
      '/admin/billing': null,
      '/admin/settings': null,
      '/admin/profile': null,
    },
  },
  delivery: {
    role: 'delivery',
    layout: null,
    pages: {
      '/delivery/dashboard': /ONLINE|OFFLINE/i,
      [`/delivery/order-details/${IDS.order}`]: null,
      '/delivery/earnings': /Earnings/,
      '/delivery/cod-cash': /COD Cash/,
      '/delivery/history': /Order History/,
      '/delivery/profile': /My Profile/,
      '/delivery/profile/ratings': null,
      '/delivery/profile/personal-details': null,
      '/delivery/profile/vehicle-info': null,
      '/delivery/profile/bank-account': null,
      '/delivery/profile/documents': null,
      '/delivery/profile/settings': null,
      '/delivery/profile/help-support': null,
      '/delivery/profile/withdrawals': /Money Request/,
      '/delivery/notifications': null,
    },
  },
};

for (const [section, { role, layout, pages }] of Object.entries(SECTIONS)) {
  test.describe(`${section} pages render`, () => {
    for (const [path, expectedText] of Object.entries(pages)) {
      test(`${path}`, async ({ page, api }) => {
        if (role) await loginAs(page, role);
        else await asGuest(page);

        await page.goto(path);

        const expectedPath = new URL(path, 'http://x').pathname;
        await expect(page).toHaveURL((url) => url.pathname === expectedPath);
        await expectRendered(page);
        if (layout) await expect(page.locator('body')).toContainText(layout);
        if (expectedText) await expect(page.locator('body')).toContainText(expectedText);
        await expectNoCrash(page, api);
      });
    }
  });
}
