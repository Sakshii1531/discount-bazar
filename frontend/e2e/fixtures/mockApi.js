/**
 * Stateful in-browser mock of the Discount Bazar REST API for Playwright.
 *
 * Every request whose path starts with /api/ is answered here (whatever the
 * host), so specs never touch a real backend. Third-party traffic (Google
 * Maps, Firebase, sockets, CDNs) is aborted to keep runs hermetic.
 *
 * Resolution order for each request:
 *   1. `api.on(...)` overrides registered by a spec
 *   2. stateful handlers below (auth, cart, wishlist, orders, approvals, ...)
 *   3. `recorded.json` — real backend responses for read-only endpoints,
 *      regenerated with `npm run record:e2e-fixtures` in /backend
 *   4. a generic empty-page fallback (logged in `api.unhandled`)
 *
 * Specs can read `api.calls` to assert which endpoints the UI hit.
 */
import * as D from './data.js';
import recorded from './recorded.json' with { type: 'json' };

const ok = (payload = {}, message = 'OK') => ({ status: 200, json: { success: true, error: false, message, ...payload } });
const fail = (status, message, result = {}) => ({ status, json: { success: false, error: true, message, result } });
const result = (value, message) => ok({ result: value }, message);
const results = (value, message) => ok({ results: value }, message);

export const OTP = '1234';
export const PASSWORDS = { seller: 'SellerPass123', admin: 'Str0ngPassword1' };

export function makeToken(role, id) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ id, role, iat: now, exp: now + 3600 })}.e2e-signature`;
}

function initialState() {
  return {
    cart: [],
    wishlist: [],
    orders: [structuredClone(D.order)],
    profiles: structuredClone(D.profiles),
    tickets: [],
    pendingSellers: structuredClone(recorded['/admin/sellers/pending'].result.items),
  };
}

const productById = (id) => D.products.find((p) => p._id === id);

function cartPayload(state) {
  return {
    _id: 'cart1',
    customerId: D.IDS.customer,
    items: state.cart.map((line) => ({ productId: productById(line.productId), quantity: line.quantity, variantSku: '' })),
  };
}

function recordedResponse(path, searchParams) {
  const normalized = path.replace(/[0-9a-f]{24}/g, ':productId');
  const verified = searchParams.get('verified');
  return (
    (verified != null && recorded[`${normalized}?verified=${verified}`]) ||
    recorded[normalized] ||
    null
  );
}

function buildRoutes(state) {
  const R = [];
  const on = (method, pattern, handler) => R.push({ method, pattern, handler });

  // ── Shared / public ─────────────────────────────────────────────────────
  on('GET', /^\/settings$/, () => result(D.settings));
  on('GET', /^\/settings\/check-serviceability$/, () => result({ serviceable: true }));
  on('GET', /^\/(admin\/)?categories$/, ({ query }) =>
    results(query.get('tree') === 'true' ? D.categoryTree : D.categories),
  );
  on('GET', /^\/experience$/, () => results([]));
  on('GET', /^\/experience\/hero$/, () => result({ banners: { items: [] }, categoryIds: [] }));
  on('GET', /^\/offer-sections$/, () => results([]));
  on('GET', /^\/offers$/, () => results([]));
  on('GET', /^\/coupons$/, () => results([]));
  on('POST', /^\/coupons\/validate$/, () => fail(400, 'Invalid coupon code'));
  on('GET', /^\/public\/faqs$/, ({ query }) => {
    const items = recorded['/admin/faqs'].result.items.filter(
      (f) => !query.get('category') || f.category === query.get('category'),
    );
    return result(D.paged(items));
  });
  on('GET', /^\/seller\/nearby$/, () => results([D.profiles.seller]));
  on('PUT', /^\/notifications\/(mark-all-read|[^/]+\/read)$/, () => result({}));
  on('POST', /^\/push\//, () => result({}));

  // ── Catalogue ───────────────────────────────────────────────────────────
  on('GET', /^\/products$/, ({ query }) => {
    const term = (query.get('search') || '').toLowerCase();
    const cat = query.get('categoryId') || query.get('category');
    const items = D.products.filter(
      (p) => (!term || p.name.toLowerCase().includes(term)) && (!cat || cat === 'all' || p.categoryId === cat),
    );
    return result(D.paged(items));
  });
  on('GET', /^\/products\/seller\/me$/, () => result(D.paged(D.products)));
  on('GET', /^\/products\/moderation$/, () => result(D.paged(D.products)));
  on('GET', /^\/products\/stock-history$/, () => result(D.paged([])));
  on('GET', /^\/products\/([0-9a-f]{24})$/, ({ match }) => {
    const p = productById(match[1]);
    return p ? result(p) : fail(404, 'Product not found');
  });
  on('GET', /^\/reviews\/product\/[^/]+$/, () => results([]));

  // ── Customer ────────────────────────────────────────────────────────────
  on('POST', /^\/customer\/send-(login|signup)-otp$/, () => result({}, 'If the number is eligible, OTP has been sent'));
  on('POST', /^\/customer\/verify-otp$/, ({ body }) =>
    body?.otp === OTP
      ? result({ token: makeToken('customer', D.IDS.customer), customer: state.profiles.customer }, 'Login successful')
      : fail(400, 'Invalid or expired OTP'),
  );
  on('GET', /^\/customer\/profile$/, () => result(state.profiles.customer));
  on('PUT', /^\/customer\/profile$/, ({ body }) => {
    Object.assign(state.profiles.customer, body || {});
    return result(state.profiles.customer, 'Profile updated successfully');
  });

  on('GET', /^\/cart$/, () => result(cartPayload(state)));
  on('POST', /^\/cart\/(add|replace)$/, ({ body, match }) => {
    if (match[1] === 'replace') state.cart = [];
    const line = state.cart.find((l) => l.productId === body.productId);
    if (line) line.quantity += Number(body.quantity || 1);
    else state.cart.push({ productId: body.productId, quantity: Number(body.quantity || 1) });
    return result(cartPayload(state), 'Item added to cart');
  });
  on('PUT', /^\/cart\/update$/, ({ body }) => {
    const line = state.cart.find((l) => l.productId === body.productId);
    if (!line) return fail(404, 'Product not in cart');
    line.quantity = Number(body.quantity);
    state.cart = state.cart.filter((l) => l.quantity > 0);
    return result(cartPayload(state));
  });
  on('DELETE', /^\/cart\/remove\/([^/]+)$/, ({ match }) => {
    state.cart = state.cart.filter((l) => l.productId !== match[1]);
    return result(cartPayload(state), 'Item removed from cart');
  });
  on('DELETE', /^\/cart\/clear$/, () => {
    state.cart = [];
    return result({}, 'Cart cleared successfully');
  });

  on('GET', /^\/wishlist$/, ({ query }) =>
    result({
      _id: 'wl1',
      products: query.get('idsOnly') === 'true' ? [...state.wishlist] : state.wishlist.map(productById),
    }),
  );
  on('POST', /^\/wishlist\/(toggle|add)$/, ({ body }) => {
    const has = state.wishlist.includes(body.productId);
    state.wishlist = has ? state.wishlist.filter((id) => id !== body.productId) : [...state.wishlist, body.productId];
    return result({ products: state.wishlist, added: !has });
  });
  on('DELETE', /^\/wishlist\/remove\/([^/]+)$/, ({ match }) => {
    state.wishlist = state.wishlist.filter((id) => id !== match[1]);
    return result({ products: state.wishlist });
  });

  on('GET', /^\/orders\/my-orders$/, () => result(D.paged(state.orders)));
  on('GET', /^\/orders\/details\/([^/]+)$/, ({ match }) => {
    const id = decodeURIComponent(match[1]);
    const order = state.orders.find((o) => o.orderId === id || o._id === id);
    return order ? result(order) : fail(404, 'Order not found');
  });
  on('POST', /^\/orders\/checkout\/preview$/, () =>
    result({ pricing: { subtotal: 110, deliveryFee: 20, handlingFee: 0, tax: 0, discount: 0, total: 130 }, breakdown: {} }),
  );
  on('POST', /^\/tickets\/create$/, ({ body }) => {
    const t = { _id: `t${state.tickets.length + 1}`, status: 'open', messages: [], createdAt: new Date().toISOString(), ...body };
    state.tickets.push(t);
    return { status: 201, json: { success: true, message: 'Ticket created successfully', result: t } };
  });
  on('GET', /^\/tickets\/my-tickets$/, () => results(state.tickets));

  // ── Seller ──────────────────────────────────────────────────────────────
  on('POST', /^\/seller\/login$/, ({ body }) => {
    const id = String(body?.emailOrPhone || '').toLowerCase();
    if (id === 'pending@e2e.test') {
      return fail(403, 'Your seller account is pending admin approval.', {
        applicationStatus: 'pending',
        isVerified: false,
        isActive: true,
        token: makeToken('seller', 'pend1'),
      });
    }
    if (id !== state.profiles.seller.email) return fail(404, 'Seller not found');
    if (body.password !== PASSWORDS.seller) return fail(401, 'Invalid credentials');
    return result({ token: makeToken('seller', D.IDS.seller), seller: state.profiles.seller }, 'Login successful');
  });
  on('GET', /^\/seller\/profile$/, () => result(state.profiles.seller));
  on('PUT', /^\/seller\/profile$/, ({ body }) => result(Object.assign(state.profiles.seller, body || {})));
  on('GET', /^\/orders\/seller-orders$/, () => result(D.paged(state.orders)));
  on('GET', /^\/orders\/seller-returns$/, () => result(D.paged([])));

  // ── Admin ───────────────────────────────────────────────────────────────
  on('POST', /^\/admin\/login$/, ({ body }) =>
    body?.email === state.profiles.admin.email && body?.password === PASSWORDS.admin
      ? result({ token: makeToken('admin', D.IDS.admin), admin: state.profiles.admin }, 'Login successful')
      : fail(401, 'Invalid credentials'),
  );
  on('GET', /^\/admin\/profile$/, () => result(state.profiles.admin));
  on('GET', /^\/admin\/pending-review-counts$/, () =>
    result({
      pendingSellers: state.pendingSellers.length,
      pendingDrivers: 0,
      pendingProducts: 0,
      pendingWithdrawals: 0,
      totalPending: state.pendingSellers.length,
    }),
  );
  on('GET', /^\/admin\/sellers$/, () => results([state.profiles.seller]));
  on('GET', /^\/admin\/sellers\/pending$/, () => result(D.paged(state.pendingSellers)));
  on('PATCH', /^\/admin\/sellers\/approve\/([^/]+)$/, ({ match }) => {
    state.pendingSellers = state.pendingSellers.filter((s) => s.id !== match[1]);
    return result({}, 'Seller application approved');
  });
  on('DELETE', /^\/admin\/sellers\/reject\/([^/]+)$/, ({ match }) => {
    state.pendingSellers = state.pendingSellers.filter((s) => s.id !== match[1]);
    return result({}, 'Seller application rejected');
  });
  on('GET', /^\/tickets\/admin\/all$/, () => result(D.paged(state.tickets)));

  // ── Delivery ────────────────────────────────────────────────────────────
  on('POST', /^\/delivery\/send-login-otp$/, ({ body }) =>
    String(body?.phone) === state.profiles.delivery.phone
      ? result({}, 'OTP sent successfully')
      : fail(404, 'Delivery partner not found'),
  );
  on('POST', /^\/delivery\/verify-otp$/, ({ body }) =>
    body?.otp === OTP
      ? result({ token: makeToken('delivery', D.IDS.delivery), delivery: state.profiles.delivery }, 'Login successful')
      : fail(400, 'Invalid or expired OTP'),
  );
  on('GET', /^\/delivery\/profile$/, () => result(state.profiles.delivery));
  on('POST', /^\/delivery\/location$/, () => result({}));
  on('GET', /^\/orders\/workflow\/[^/]+\/route$/, () => result({ polyline: null, distanceMeters: 0, durationSeconds: 0 }));

  return R;
}

export async function mockApi(page) {
  const api = {
    state: initialState(),
    calls: [],
    unhandled: [],
    pageErrors: [],
    overrides: [],
    on(method, pattern, handler) {
      this.overrides.unshift({ method, pattern, handler });
    },
    callsTo(method, pattern) {
      return this.calls.filter((c) => c.method === method && pattern.test(c.path));
    },
  };
  const routes = buildRoutes(api.state);

  page.on('pageerror', (err) => api.pageErrors.push(err.message));

  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname.startsWith('/api/')) {
      const path = url.pathname.slice(4);
      const method = request.method();
      if (method === 'OPTIONS') return route.fulfill({ status: 204 });
      let body = null;
      try {
        body = request.postDataJSON();
      } catch {
        body = request.postData();
      }
      api.calls.push({ method, path, query: Object.fromEntries(url.searchParams), body });

      for (const r of [...api.overrides, ...routes]) {
        if (r.method !== method) continue;
        const match = path.match(r.pattern);
        if (!match) continue;
        const res = await r.handler({ match, query: url.searchParams, body, state: api.state });
        return route.fulfill({ status: res.status, contentType: 'application/json', body: JSON.stringify(res.json) });
      }

      if (method === 'GET') {
        const hit = recordedResponse(path, url.searchParams);
        if (hit) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(hit) });
      }

      api.unhandled.push(`${method} ${path}`);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          error: false,
          message: 'OK (e2e fallback)',
          result: method === 'GET' ? D.paged([]) : {},
        }),
      });
    }

    // Keep the app's own assets; block everything else (maps, firebase, sockets, CDNs).
    const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (isLocal && !url.pathname.startsWith('/socket.io')) return route.continue();
    return route.abort();
  });

  return api;
}
