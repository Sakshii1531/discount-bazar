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
- `api-rider-integrity`: rider sign-in and approval status, approval/suspension/
  online gating, offer acceptance races, the hand-over OTP (leaks, attempt
  limits, retries, the `/delivered` shortcut), COD reconcile, withdrawals
  (balance, double taps, bank details), history tabs.

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

**Customer search and reviews**
20. Changing the search keyword kept the previous keyword's products and count on
    screen until the new search returned; a search of only spaces showed
    "No items found". Search showed at most 100 results; it now pages with
    "Load more" and shows the real total (`e2e/specs/customer.spec.js`).
21. Search missed common variants: "chili" did not find "Chilli", "Lal Mirch" did
    not find "Red Chilli Powder", and category names ("spices") matched nothing.
    `services/productSearchService.js` makes doubled letters optional, searches
    Hindi grocery names alongside English ones (and back), and, when no product
    name matches, matches header, category and subcategory names (`api-product-discovery`,
    `unit/services/productSearch.test.js`).
22. Reviews written on the product page went to the legacy `Review` collection,
    which the page never listed and the rating never counted, and allowed only
    one review per product ever, so a repeat purchase could not be reviewed. The
    form now rates the newest delivered, unrated order item (one review per
    product per delivered order). `scripts/migrate-legacy-reviews.js` moves
    existing legacy reviews across (`api-product-review-repeat`).

**Seller panel: stock, orders and cash register** (`api-seller-integrity`)
23. Manual stock adjustments read the product, changed it in memory and saved
    it, so a sale made in between was lost. A correction larger than the stock was
    clamped to 0 while the history logged the full amount, and on a product with
    several variants an adjustment with no variant changed the first one. Each
    adjustment is now one atomic update. Over-removal returns 409, and a variant is
    required.
24. Editing a product (name, price, images) wrote back the stock read at the
    start of the request. That undid any online order, POS sale or cancellation
    that landed while the edit was saving. The save is now guarded on `updatedAt`
    and merges in the live stock.
25. The older stock-release path (seller reject, timeouts, failed payments)
    could restore stock twice when two cancellations ran at once, and failed on
    variants with no stock counter. It now uses the cancellation service's atomic
    release, which runs once per order.
26. When a seller's accept failed, the endpoint fell back to a plain status save.
    That let a seller accept an online order before its payment was captured. It
    also sent an order that already had a rider back to `DELIVERY_SEARCH`, which
    started a second rider search. Accept now goes only through the atomic path.
27. Seller dashboard and earnings counted online orders still waiting for
    payment (`CREATED`) as sales.
28. Expenses on a closed business day could be deleted, which changed the
    finalized cash closing. Deleting a missing expense returned success.
29. Closing an already-closed day overwrote its counted cash. Re-closing now
    returns 409. Reopening a day that is open returns 409. Every close and reopen
    is kept in `CashDay.history`. Reopening needs a reason, which is saved there.
30. POS bills worked out GST before the discount, so ₹100 at 18% exclusive GST
    less ₹10 came to ₹108 instead of ₹106.20. On inclusive bills the total was
    right but the GST shown was too high (₹15.25 instead of ₹13.73). A discount
    now lowers the taxable value: the sale, its preview and bill edits share
    `services/posTax.js`, and the checkout screen scales the register's GST to the
    discounted amount. A tax amount the cashier types is used as entered.
31. Udhaar payments could be recorded twice by a double click or a retry, and a
    customer could pay more than they owed. The payment form now sends a
    `clientRef` key, so a resubmission returns the first entry, and paying more
    than is due returns 409.
32. Editing or cancelling a purchase bill or a POS credit bill deleted its ledger
    entries. They are now kept and marked `voided`, with a voided reversing entry
    (`reverses`) written beside each. Balances net out, the statement shows the
    trail (marked "voided" / "reversal"), and cash reports skip voided pairs, so
    payments are not counted twice.

**Rider app** (`api-rider-integrity`)
33. `GET /delivery/application-status?phone=` needed no sign-in and returned a
    signed rider token, so anyone who knew a rider's number could act as that
    rider. A public lookup now returns only `isApproved`, and only the signed-in
    rider gets a token. A pending rider's login response no longer includes the
    rider record (bank account, documents).
34. Rider OTP sign-in passed the request body straight into the query, so
    `{"otp": {"$ne": null}}` signed in any rider with an unexpired code. There was
    also no limit on wrong codes. Inputs must now be strings, and 5 wrong codes
    lock sign-in for 15 minutes and void the code (`OTP_MAX_FAILED_ATTEMPTS`,
    `OTP_LOCKOUT_MINUTES`).
35. Pending, suspended and offline riders could see offers and accept orders. The
    approval flag was checked only at sign-in, but a pending rider still got a
    token, and offers went to unapproved riders by default. Offers, accepts and
    return pickups now need an approved, active, online rider. An admin can
    suspend a rider (`isActive: false`), which also takes them offline. Pickup and
    hand-over stay open, so a rider who is suspended mid-trip can still deliver
    the parcel they hold.
36. A rider could accept an order before the seller had accepted it, including an
    online order still awaiting payment. Accept now needs the order to be looking
    for a rider (`DELIVERY_SEARCH`).
37. Order details sent the plaintext delivery OTP to the assigned rider (and the
    seller), so the rider could complete the hand-over without the customer. The
    code now goes only to the customer and admins.
38. `POST /orders/:id/delivered` let the assigned rider (or any rider, when the
    order had none yet) mark an order delivered with no OTP and log the COD
    cash as collected. It also worked on cancelled orders and left
    `workflowStatus` behind. A rider can now only re-run settlement after the OTP
    has completed the delivery. A cancelled order cannot be settled, and an
    admin override also sets `workflowStatus: DELIVERED`.
39. A rider could call `POST /orders/:id/cod/reconcile` on their own order, which
    clears their COD liability and credits the admin wallet with no cash handed
    over. Reconcile is now admin-only.
40. Wrong delivery-OTP guesses sent in parallel could go past the 3-attempt limit,
    and the same correct code sent twice in parallel was used twice. A retry
    after a lost response got a 409 even though the order was delivered. The
    attempt count and the use of the code are now atomic, and a retry by the same
    rider returns the completed delivery. The OTP can no longer be requested
    before pickup.
41. The withdrawal check added up every settled rider transaction, including COD
    cash collections, so a rider holding ₹500 of customer cash could withdraw it
    as earnings. The earnings screen counted only the newest 200 transactions.
    Both now use one sum over all earnings less withdrawals. Withdrawals are also
    serialized per rider and accept an `Idempotency-Key`, so a double tap creates
    one request. A non-numeric amount and missing or invalid bank details are
    rejected.
42. The history's Cancelled tab listed return orders, and the Returns tab
    showed everything. Finished orders in history no longer carry customer phone
    numbers, and riders viewing an offer they have not accepted no longer see
    the customer's phone or email.
43. Going offline during a delivery cleared the rider's live-tracking presence,
    so the customer's map stopped updating. The order stays assigned and tracked,
    and the response tells the rider how many deliveries they still have.

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
