# Testing Discount Bazar

There are four test layers. None of them need a real database, Redis, SMS
gateway, payment gateway, Google Maps key or Firebase project.

| Layer | Tool | Location | Command |
| --- | --- | --- | --- |
| Backend unit | Jest | `backend/__tests__/unit/` | `cd backend && npm run test:unit` |
| Backend API E2E | Jest + Supertest + in-memory MongoDB | `backend/__tests__/e2e/` | `cd backend && npm run test:e2e` |
| Frontend unit / component | Jest + React Testing Library (jsdom) | `frontend/src/__tests__/` | `cd frontend && npm test` |
| Frontend browser E2E | Playwright (Chromium) | `frontend/e2e/` | `cd frontend && npm run test:e2e` |

`npm test` in `backend/` runs every backend suite, including the older
`__tests__/*.test.js` files that existed before this suite.

## First-time setup

```bash
cd backend  && npm install
cd frontend && npm install && npx playwright install chromium
```

The first backend E2E run downloads a MongoDB binary (about 100 MB) for
`mongodb-memory-server`, and later runs reuse it.

## What each layer covers

### Backend unit tests (`backend/__tests__/unit`)
- **utils**: money/GST maths, phone normalisation, slugs, regex escaping,
  SMS/OTP helpers, return windows and eligibility, order-id lookups, geo distance.
- **validation**: every Joi schema in `app/validation/`, grouped by section
  (admin auth, customer, cart, wishlist, orders, payments, finance, maps, seller,
  products, return policy, POS, delivery, ratings, support, wallet).
- **middleware**: JWT auth (Bearer, raw and `x-access-token`), role guards, the
  seller approval gate, `validate()`, and the 404/error handlers.
- **services**: the order workflow state machine, payment status transitions,
  POS payment resolution (cash/card/credit/split), the rider location throttle,
  and the finance CSV export.

### Backend API E2E (`backend/__tests__/e2e`)
These tests boot the real Express route tree against an in-memory MongoDB
**replica set** (order placement uses transactions, as on Atlas) with seeded
admin, seller, rider, customer, category and product data.

The harness is hermetic. It blanks every integration secret before the app
loads (several modules call `dotenv.config()`, which would otherwise read
`backend/.env`), blocks all outbound network traffic except localhost, deletes
any files uploaded to `public/uploads`, and removes its temporary database
folder afterwards.

**Endpoint matrix: all 280 API endpoints.** Each module lists its cases in
`__tests__/e2e/matrix/<module>.cases.js`. A case gives the route, the role
that calls it, the body, the expected status, and checks on the response data
and on the resulting database state. Cases run in order against a real order
life-cycle:

| Spec | Covers |
| --- | --- |
| `api-matrix-platform` | health/metrics, settings, categories (public and `/admin` mounts), maps, media uploads, generic OTP, push tokens, notifications |
| `api-matrix-customer` | OTP auth, profile, transactions, cart (single-seller rule), wishlist, support tickets |
| `api-matrix-catalog` | product browse/search/radius, seller product CRUD, stock adjustments, admin moderation, offers, offer sections, experience studio, coupons, FAQs |
| `api-matrix-orders` | checkout preview → COD order → seller accepts → rider accepts → pickup → delivery OTP → delivered → COD reconcile; cancel, re-order, skip, legacy `/orders/place` |
| `api-matrix-returns-feedback` | full return chain (request → approve → assign → pickup OTP → in transit → drop OTP → QC), rejection, reviews, product ratings, delivery ratings |
| `api-matrix-payments` | Razorpay order creation, idempotency, status, signature verification, webhooks (real HMAC with test secrets; only gateway network calls are faked) |
| `api-matrix-seller` | email/phone verification, sign-up, login, password reset, profile/stats/wallet, POS sale/edit/return (incl. idempotent retries), business books (parties, purchases, payments, expenses, cash register, reports) |
| `api-matrix-delivery` | rider registration/login OTP, profile, stats, earnings, wallet, withdrawals, COD cash, live location, history |
| `api-matrix-admin` | login/profile/password, dashboard, finance (summary, ledger, payouts, CSV export), settings, customers, seller & rider approval, rider cash settlement, wallet, withdrawals |

Two guards keep the matrix honest:
- `api-matrix-coverage` reads the live route table and fails if any endpoint
  has no case, or if a case names an endpoint that doesn't exist.
- `api-matrix-auth-guard` calls every protected endpoint (235 of them) with no
  token and requires HTTP 401.

Earlier hand-written suites:
- `api-public`: health, settings, categories, FAQs, offers, experience, 404s.
- `api-customer`: OTP signup/login, profile, location-based catalogue, cart,
  wishlist, orders, tickets, notifications, coupons.
- `api-seller`: login, approval gate, dashboard stats, earnings, own products,
  role isolation.
- `api-delivery`: OTP login, profile, stats, earnings, COD, role isolation.
- `api-admin`: login, user and seller management, the seller approval flow,
  tickets, settings, categories, role isolation.
- `api-security`: forged and `alg=none` JWTs, and admin-only coupon/FAQ writes.
- `api-otp-security`: signup OTPs cannot be used to sign in to an existing account.

### Frontend unit tests (`frontend/src/__tests__/unit`)
- **core**: token/auth storage, the storage manager (TTL, schema wipe, logout
  cleanup), the active-role store, axios token selection and the 401/offline
  interceptors, request de-duplication, API base URL resolution (localhost, LAN
  and production domain), image utils, the geocode cache, and the
  `ProtectedRoute`/`RoleGuard` guards.
- **shared**: currency and GST formatting, order status mapping, route geometry,
  the shared hooks (`useDebounce`, `useFilters`, `usePagination`, `useApiState`,
  `useConfirmDialog`) and UI components.
- **customer / seller / admin / delivery**: every API service method in each
  section, plus each section's own utilities (header theme, order identifiers,
  POS/business APIs, admin order filters, rider location cache, handled-offer store).

### Frontend browser E2E (`frontend/e2e`)
Playwright builds the app (`vite build`), serves it with `vite preview` on port
4317 and answers every `/api/*` call from `e2e/fixtures/mockApi.js`:
- Stateful handlers cover login, cart, wishlist, orders and approvals.
- `e2e/fixtures/recorded.json` holds real backend responses for read-only
  endpoints.

Specs:
- `pages-smoke`: every routed page in all five areas (public, customer,
  seller, admin, delivery) renders inside its layout with no error boundary.
- `customer`: OTP login (including a wrong OTP and the redirect back), home,
  categories, search, product detail, add to cart, checkout, wishlist, orders,
  profile edit, sign out, support.
- `seller`: password login, wrong password, pending approval, products,
  orders, add product, inventory, POS, navigation, profile.
- `admin`: login, dashboard, approving a pending seller, customers, sellers,
  FAQs, orders, product moderation, navigation.
- `delivery`: OTP login (unknown phone, wrong OTP), dashboard, tab navigation,
  COD, history, logout.
- `access-control`: guests redirected to the right login, cross-portal
  blocking, expired tokens, unknown routes.

Useful commands:

```bash
npm run test:e2e                          # all specs, desktop + mobile projects
npx playwright test customer              # one spec file
npx playwright test --project desktop-chromium
npm run test:e2e:ui                       # interactive UI mode
npx playwright show-report                # last HTML report (CI)
E2E_WORKERS=1 npx playwright test         # on a slow machine
```

If you change a backend response shape, refresh the recorded fixtures:

```bash
cd backend
CAPTURE_E2E_FIXTURES=1 npm run record:e2e-fixtures          # bash
$env:CAPTURE_E2E_FIXTURES=1; npm run record:e2e-fixtures   # PowerShell
```

## Bugs found by the tests (all fixed)

Each fix has a regression test.

**Security**
1. Customer signup OTPs were forced to a fixed code, even for phone numbers that
   already had an account, so anyone could sign in to any customer account.
2. Six hard-coded phone numbers always got a fixed OTP and skipped the OTP rate
   limits (customer, rider, seller and generic OTP services).
3. Coupon and FAQ create/update/delete had no authentication.
4. `/coupons/validate` trusted a `customerId` from the request body for the cart
   lookup and per-user limits; it now uses the signed-in customer.
5. Any customer could reply to another customer's support ticket, and could make
   a reply appear to come from "Support Team" by sending `isAdmin: true`.
6. One seller edit published a pending or rejected product without admin approval.

**Money & stock**
7. POS sales with a repeated `Idempotency-Key` were billed twice when Redis is
   disabled (stock deducted twice).
8. COD reconciliation crashed (500) for every valid amount, so admins could not
   settle a rider's cash per order.
9. Admins could record a cash settlement larger than the rider held, driving the
   rider's balance negative.
10. Stock adjustments with an unknown type changed the stock, then failed to write
    the history record (500).
11. The rider could request the delivery OTP from anywhere: the proximity check was
    commented out. Set `DELIVERY_OTP_SKIP_PROXIMITY=true` to bypass it for field
    testing.
12. First-time finance settings were created outside the order transaction.
13. `verify-online` could never succeed with Razorpay (the signature was dropped).
14. `subtractMoney()` added instead of subtracting.

**Wrong status codes / validation**
15. Malformed ids returned 500 across the API; they are now 400 "Invalid id".
16. Rejected PhonePe webhooks returned 500 (which makes the gateway retry).
17. Empty support tickets, invalid ticket/review statuses, an out-of-range rider
    location, seller sign-up without verification, and deleting a missing category
    returned 500 or 200 instead of 400/404.
18. Frontend: `getJSON()` returned `null` instead of the fallback for corrupted
    storage, and the rider OTP boxes started pre-filled.

**Experience Studio / hero banners**
19. Banner title and subtitle were saved but never shown on the storefront, and
    banner links were ignored (banners were not clickable). Banners now show a
    caption and open the linked header, category, subcategory, product or URL.
    The admin picks the target from dropdowns and product search instead of
    typing a slug/ID, and hero banners can be linked too
    (`src/__tests__/unit/customer/bannerLinks.test.jsx`).

## Delivery fee and delivery time (global + product)

`api-delivery-fee.e2e.test.js` covers the feature end to end:
- admin settings (global fee, global time, zero-time message, partial updates);
- seller values (negative fee or fractional minutes are rejected);
- listing, detail and cart quote;
- checkout preview;
- the order snapshot, which is unchanged by later edits;
- bulk CSV import.

`unit/services/deliveryQuote.test.js` covers the calculation rules:
- final value = global + product;
- a total fee of 0 is free delivery;
- a total time of 0 shows the admin's message;
- in a cart, the highest product fee and the slowest product time are used (plus the global values);
- across sellers, fees add up and the delivery time is the slowest seller's.

## Disk space

Each backend E2E suite starts a small MongoDB replica set (about 300 MB while it
runs). Jest is capped at 2 workers and the harness deletes the data afterwards.
If tests fail with "available disk space ... is less than required", free some
space on C:.
