/**
 * Seller panel endpoints: email/phone verification + sign-up, login,
 * password reset, profile/stats/earnings/wallet, the POS terminal (sale,
 * edit, return) and the business books (parties, purchases, payments,
 * expenses, cash register, dashboard, accounts, reports).
 */
import { expect } from "@jest/globals";
import { MOCK_OTP } from "../../../app/utils/otp.js";
import Product from "../../../app/models/product.js";
import PartyLedgerEntry from "../../../app/models/partyLedgerEntry.js";
import { listOf } from "../helpers/world.js";

const OID = "64b7f0c2a1b2c3d4e5f60718";
const NEW_EMAIL = "newshop@e2e.test";
const NEW_PHONE = "9811100011";
const DOCS = {
  tradeLicense: "https://cdn.example.test/trade.pdf",
  gstCertificate: "https://cdn.example.test/gst.pdf",
  idProof: "https://cdn.example.test/id.pdf",
};
const posKey = (n) => `e2e-pos-sale-idempotency-key-0000000${n}`;
const today = () => new Date().toISOString().slice(0, 10);
const stockOf = async (id) => (await Product.findById(id).lean()).stock;

export default [
  // ── Sign-up with verified email + phone ──────────────────────────────────
  { route: "POST /api/seller/check-exists", body: (ctx) => ({ email: ctx.seller.email }), check: (res) => expect(res.body.result.exists).toBe(true) },
  { route: "POST /api/seller/check-exists", name: "new email", body: { email: NEW_EMAIL }, check: (res) => expect(res.body.result.exists).toBe(false) },
  {
    route: "POST /api/seller/verification/send-otp",
    body: { channel: "email", value: NEW_EMAIL },
    check: (res) => expect(res.body.result).toEqual(expect.objectContaining({ sent: true, channel: "email", maskedTarget: "ne***@e2e.test" })),
  },
  { route: "POST /api/seller/verification/send-otp", name: "phone channel", body: { channel: "phone", value: NEW_PHONE } },
  { route: "POST /api/seller/verification/send-otp", name: "validates channel", body: { channel: "fax", value: "x" }, status: 400 },
  {
    route: "POST /api/seller/verification/verify-otp",
    name: "rejects a wrong code",
    body: { channel: "email", value: NEW_EMAIL, otp: MOCK_OTP === "0000" ? "1111" : "0000" },
    status: 400,
  },
  {
    route: "POST /api/seller/verification/verify-otp",
    body: { channel: "email", value: NEW_EMAIL, otp: MOCK_OTP },
    check: (res, ctx) => {
      ctx.emailToken = res.body.result.token || res.body.result.verificationToken;
      expect(ctx.emailToken).toEqual(expect.any(String));
    },
  },
  {
    route: "POST /api/seller/verification/verify-otp",
    name: "phone",
    body: { channel: "phone", value: NEW_PHONE, otp: MOCK_OTP },
    check: (res, ctx) => {
      ctx.phoneToken = res.body.result.token || res.body.result.verificationToken;
      expect(ctx.phoneToken).toEqual(expect.any(String));
    },
  },
  {
    route: "POST /api/seller/signup",
    name: "requires verification tokens",
    body: { name: "New Shop Owner", email: NEW_EMAIL, phone: NEW_PHONE, password: "ShopPass123", shopName: "New Shop" },
    status: 400,
  },
  {
    route: "POST /api/seller/signup",
    body: (ctx) => ({
      name: "New Shop Owner",
      email: NEW_EMAIL,
      phone: NEW_PHONE,
      password: "ShopPass123",
      shopName: "New Shop",
      address: "5 Vijay Nagar",
      city: "Indore",
      state: "Madhya Pradesh",
      pincode: "452010",
      lat: ctx.location.lat,
      lng: ctx.location.lng,
      radius: 5,
      documents: DOCS,
      emailVerificationToken: ctx.emailToken,
      phoneVerificationToken: ctx.phoneToken,
    }),
    status: [200, 201],
    check: (res) => expect(JSON.stringify(res.body.result)).toMatch(/pending/),
  },
  {
    route: "POST /api/seller/login",
    name: "a fresh applicant waits for approval",
    body: { emailOrPhone: NEW_EMAIL, password: "ShopPass123" },
    status: 403,
    check: (res) => expect(res.body.result.applicationStatus).toBe("pending"),
  },
  {
    route: "GET /api/seller/application-status",
    as: "pendingSeller",
    optionalAuth: true,
    check: (res) => expect(res.body.result).toEqual(expect.objectContaining({ isApproved: false, applicationStatus: "pending" })),
  },

  // ── Login & password reset ────────────────────────────────────────────────
  { route: "POST /api/seller/login", body: (ctx) => ({ emailOrPhone: ctx.seller.email, password: ctx.seller.plainPassword }), check: (res) => expect(res.body.result.token).toEqual(expect.any(String)) },
  { route: "POST /api/seller/login", name: "wrong password", body: (ctx) => ({ emailOrPhone: ctx.seller.email, password: "nope" }), status: 401 },
  { route: "POST /api/seller/forgot-password/send-otp", body: (ctx) => ({ channel: "email", rawValue: ctx.seller.email }) },
  {
    route: "POST /api/seller/forgot-password/verify-otp",
    body: (ctx) => ({ channel: "email", rawValue: ctx.seller.email, otp: MOCK_OTP }),
    check: (res, ctx) => {
      ctx.resetToken = res.body.result.verificationToken;
      expect(ctx.resetToken).toEqual(expect.any(String));
    },
  },
  {
    route: "POST /api/seller/reset-password",
    name: "rejects a forged token",
    body: (ctx) => ({ channel: "email", rawValue: ctx.seller.email, token: "forged", newPassword: "BrandNew12345" }),
    status: 400,
  },
  {
    route: "POST /api/seller/reset-password",
    body: (ctx) => ({ channel: "email", rawValue: ctx.seller.email, token: ctx.resetToken, newPassword: "BrandNew12345" }),
  },
  {
    route: "POST /api/seller/login",
    name: "logs in with the new password",
    body: (ctx) => ({ emailOrPhone: ctx.seller.email, password: "BrandNew12345" }),
  },

  // ── Profile, stats, money ─────────────────────────────────────────────────
  {
    route: "GET /api/seller/nearby",
    query: (ctx) => ({ lat: ctx.location.lat, lng: ctx.location.lng }),
    check: (res, ctx) => {
      const ids = listOf(res).map((s) => String(s._id));
      expect(ids).toContain(String(ctx.seller._id));
      expect(ids).not.toContain(String(ctx.pendingSeller._id));
      expect(JSON.stringify(res.body)).not.toMatch(/"password"/);
    },
  },
  {
    route: "GET /api/seller/profile",
    as: "seller",
    check: (res) => {
      expect(res.body.result.shopName).toBe("Main Mart");
      expect(res.body.result.password).toBeUndefined();
    },
  },
  {
    route: "PUT /api/seller/profile",
    as: "seller",
    body: { shopName: "Main Mart Express", radius: 8 }, // the seller app sends `radius`
    check: (res) => expect(res.body.result).toEqual(expect.objectContaining({ shopName: "Main Mart Express", serviceRadius: 8 })),
  },
  { route: "GET /api/seller/stats", as: "seller", query: { range: "daily" }, check: (res) => expect(res.body.result.overview).toBeDefined() },
  { route: "GET /api/seller/earnings", as: "seller", check: (res) => expect(res.body.result.balances.availableBalance).toBe(0) },
  { route: "GET /api/seller/wallet/summary", as: "seller", check: (res) => expect(res.body.result).toEqual(expect.objectContaining({ availableBalance: 0 })) },
  {
    route: "POST /api/seller/request-withdrawal",
    name: "cannot withdraw more than the balance",
    as: "seller",
    body: { amount: 100 },
    status: 400,
    check: (res) => expect(res.body.message).toMatch(/Insufficient balance/),
  },

  // ── POS terminal ──────────────────────────────────────────────────────────
  {
    route: "GET /api/seller/pos/catalog",
    as: "seller",
    check: (res, ctx) => {
      const ids = listOf(res).map((p) => String(p._id));
      expect(ids).toEqual(expect.arrayContaining([String(ctx.milk._id), String(ctx.bread._id)]));
      expect(ids).not.toContain(String(ctx.otherProduct._id));
    },
  },
  { route: "GET /api/seller/pos/catalog", name: "pending sellers are blocked", as: "pendingSeller", status: 403 },
  {
    route: "POST /api/seller/pos/sale/preview",
    as: "seller",
    body: (ctx) => ({ items: [{ productId: String(ctx.milk._id), quantity: 2, price: 55 }], discount: 10 }),
    check: (res) => expect(res.body.result).toEqual(expect.objectContaining({ subtotal: 110, grandTotal: 100 })),
  },
  {
    route: "POST /api/seller/pos/sale",
    name: "requires an idempotency key",
    as: "seller",
    body: (ctx) => ({ items: [{ productId: String(ctx.milk._id), quantity: 1, price: 55 }], posPaymentMethod: "CASH" }),
    status: 400,
  },
  {
    route: "POST /api/seller/pos/sale",
    name: "cash below the bill is refused",
    as: "seller",
    headers: { "Idempotency-Key": posKey(0) },
    body: (ctx) => ({ items: [{ productId: String(ctx.milk._id), quantity: 2, price: 55 }], posPaymentMethod: "CASH", cashTendered: 50 }),
    status: 400,
  },
  {
    route: "POST /api/seller/pos/sale",
    as: "seller",
    headers: { "Idempotency-Key": posKey(1) },
    before: async (ctx) => {
      ctx.milkStockBeforeSale = await stockOf(ctx.milk._id);
    },
    body: (ctx) => ({ items: [{ productId: String(ctx.milk._id), quantity: 2, price: 55 }], posPaymentMethod: "CASH", cashTendered: 200 }),
    status: [200, 201],
    check: async (res, ctx) => {
      const order = res.body.result.order || res.body.result;
      ctx.posOrderId = order.orderId;
      expect(ctx.posOrderId).toBeTruthy();
      expect(await stockOf(ctx.milk._id)).toBe(ctx.milkStockBeforeSale - 2);
    },
  },
  {
    route: "POST /api/seller/pos/sale",
    name: "replaying the same key does not sell twice",
    as: "seller",
    headers: { "Idempotency-Key": posKey(1) },
    body: (ctx) => ({ items: [{ productId: String(ctx.milk._id), quantity: 2, price: 55 }], posPaymentMethod: "CASH", cashTendered: 200 }),
    status: [200, 201, 409],
    check: async (res, ctx) => expect(await stockOf(ctx.milk._id)).toBe(ctx.milkStockBeforeSale - 2),
  },
  {
    route: "GET /api/seller/pos/sales",
    as: "seller",
    check: (res, ctx) => expect(listOf(res).map((o) => o.orderId)).toContain(ctx.posOrderId),
  },
  {
    route: "PUT /api/seller/pos/sales/:orderId",
    as: "seller",
    params: (ctx) => ({ orderId: ctx.posOrderId }),
    body: (ctx) => ({ items: [{ productId: String(ctx.milk._id), quantity: 3, price: 55 }], posPaymentMethod: "CASH", reason: "Customer added one" }),
    check: async (res, ctx) => expect(await stockOf(ctx.milk._id)).toBe(ctx.milkStockBeforeSale - 3),
  },
  {
    route: "GET /api/seller/pos/returns/order/:orderId",
    as: "seller",
    params: (ctx) => ({ orderId: ctx.posOrderId }),
    check: (res) => expect(JSON.stringify(res.body.result)).toContain("Fresh Milk"),
  },
  { route: "GET /api/seller/pos/returns/order/:orderId", name: "unknown bill", as: "seller", params: { orderId: "POS-NOPE" }, status: 404 },
  {
    route: "POST /api/seller/pos/returns",
    as: "seller",
    body: (ctx) => ({ orderId: ctx.posOrderId, items: [{ productId: String(ctx.milk._id), quantity: 1, condition: "good" }], refundMethod: "CASH", reason: "Leaking pack" }),
    status: [200, 201],
    check: async (res, ctx) => expect(await stockOf(ctx.milk._id)).toBe(ctx.milkStockBeforeSale - 2),
  },
  {
    route: "POST /api/seller/pos/returns",
    name: "cannot return more than was sold",
    as: "seller",
    body: (ctx) => ({ orderId: ctx.posOrderId, items: [{ productId: String(ctx.milk._id), quantity: 99, condition: "good" }], refundMethod: "CASH" }),
    status: 400,
  },
  {
    route: "GET /api/seller/pos/returns",
    as: "seller",
    check: (res) => expect(listOf(res)).toHaveLength(1),
  },

  // ── Business books: settings & parties ───────────────────────────────────
  { route: "GET /api/seller/business/settings", as: "seller", check: (res) => expect(res.body.result.timezone).toBe("Asia/Kolkata") },
  { route: "PUT /api/seller/business/settings", as: "seller", body: { timezone: "Asia/Kolkata" } },
  { route: "PUT /api/seller/business/settings", name: "validates timezone", as: "seller", body: {}, status: 400 },
  {
    route: "POST /api/seller/business/suppliers",
    as: "seller",
    body: { name: "Amul Distributor", phone: "9000011111", gstin: "23ABCDE1234F1Z5" },
    status: 201,
    check: (res, ctx) => {
      ctx.supplierId = res.body.result._id;
    },
  },
  { route: "POST /api/seller/business/suppliers", name: "requires a name", as: "seller", body: { phone: "1" }, status: 400 },
  { route: "PUT /api/seller/business/suppliers/:id", as: "seller", params: (ctx) => ({ id: ctx.supplierId }), body: { name: "Amul Distributors Pvt" }, check: (res) => expect(res.body.result.name).toBe("Amul Distributors Pvt") },
  { route: "GET /api/seller/business/suppliers", as: "seller", check: (res) => expect(listOf(res).map((s) => s.name)).toContain("Amul Distributors Pvt") },
  {
    route: "POST /api/seller/business/customers",
    as: "seller",
    body: { name: "Sharma Ji", phone: "9000022222" },
    status: 201,
    check: (res, ctx) => {
      ctx.posCustomerId = res.body.result._id;
    },
  },
  { route: "PUT /api/seller/business/customers/:id", as: "seller", params: (ctx) => ({ id: ctx.posCustomerId }), body: { name: "Sharma Ji (Shop 4)" } },
  { route: "GET /api/seller/business/customers", as: "seller", check: (res) => expect(listOf(res).map((c) => c.name)).toContain("Sharma Ji (Shop 4)") },

  // ── Purchases ─────────────────────────────────────────────────────────────
  {
    route: "POST /api/seller/business/purchases",
    as: "seller",
    body: (ctx) => ({ supplierId: ctx.supplierId, billNo: "B-101", items: [{ productId: String(ctx.bread._id), quantity: 10, cost: 30 }], amountPaid: 100, paymentMethod: "CASH" }),
    status: 201,
    before: async (ctx) => {
      ctx.breadStockBefore = await stockOf(ctx.bread._id);
    },
    check: async (res, ctx) => {
      ctx.purchaseId = res.body.result._id;
      // Saved as a draft: stock only moves on confirm.
      expect(await stockOf(ctx.bread._id)).toBe(ctx.breadStockBefore);
    },
  },
  {
    route: "PUT /api/seller/business/purchases/:id",
    as: "seller",
    params: (ctx) => ({ id: ctx.purchaseId }),
    body: (ctx) => ({ supplierId: ctx.supplierId, billNo: "B-101", items: [{ productId: String(ctx.bread._id), quantity: 12, cost: 30 }], amountPaid: 100, paymentMethod: "CASH" }),
  },
  {
    route: "POST /api/seller/business/purchases/:id/confirm",
    as: "seller",
    params: (ctx) => ({ id: ctx.purchaseId }),
    check: async (res, ctx) => expect(await stockOf(ctx.bread._id)).toBe(ctx.breadStockBefore + 12),
  },
  { route: "POST /api/seller/business/purchases/:id/confirm", name: "cannot confirm twice", as: "seller", params: (ctx) => ({ id: ctx.purchaseId }), status: [400, 409] },
  {
    route: "POST /api/seller/business/purchase-returns",
    as: "seller",
    body: (ctx) => ({ supplierId: ctx.supplierId, purchaseBillId: ctx.purchaseId, items: [{ productId: String(ctx.bread._id), quantity: 2, cost: 30 }], reason: "Stale" }),
    status: 201,
    check: async (res, ctx) => expect(await stockOf(ctx.bread._id)).toBe(ctx.breadStockBefore + 10),
  },
  {
    route: "POST /api/seller/business/purchases",
    name: "second bill (to cancel)",
    as: "seller",
    body: (ctx) => ({ supplierId: ctx.supplierId, billNo: "B-102", items: [{ productId: String(ctx.bread._id), quantity: 5, cost: 30 }] }),
    status: 201,
    check: (res, ctx) => {
      ctx.purchaseId2 = res.body.result._id;
    },
  },
  { route: "POST /api/seller/business/purchases/:id/cancel", as: "seller", params: (ctx) => ({ id: ctx.purchaseId2 }) },
  { route: "GET /api/seller/business/purchases", as: "seller", check: (res) => expect(listOf(res).map((b) => b.billNo)).toEqual(expect.arrayContaining(["B-101", "B-102"])) },
  { route: "POST /api/seller/business/purchases", name: "validates line items", as: "seller", body: (ctx) => ({ supplierId: ctx.supplierId, billNo: "X", items: [] }), status: 400 },
  {
    route: "POST /api/seller/business/purchases",
    name: "saves and confirms a bill without a supplier",
    as: "seller",
    body: (ctx) => ({ supplierId: null, billNo: "NS-1", items: [{ productId: String(ctx.bread._id), quantity: 4, cost: 25 }], amountPaid: 60, paymentMethod: "CASH", confirm: true }),
    status: 201,
    before: async (ctx) => {
      ctx.breadBeforeNoSupplier = await stockOf(ctx.bread._id);
    },
    check: async (res, ctx) => {
      ctx.noSupplierBillId = res.body.result._id;
      expect(res.body.result.supplier).toBeNull();
      expect(res.body.result.status).toBe("CONFIRMED");
      expect(await stockOf(ctx.bread._id)).toBe(ctx.breadBeforeNoSupplier + 4);
      // Only the payment is recorded (cash out); nobody is owed the unpaid part.
      const rows = await PartyLedgerEntry.find({ refId: res.body.result._id }).lean();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual(expect.objectContaining({ kind: "PAYMENT", amount: 60, party: null }));
    },
  },
  {
    route: "POST /api/seller/business/purchases",
    name: "an empty supplier string also means no supplier",
    as: "seller",
    body: (ctx) => ({ supplierId: "", billNo: "NS-2", items: [{ productId: String(ctx.bread._id), quantity: 1, cost: 25 }] }),
    status: 201,
    check: (res) => expect(res.body.result.supplier).toBeNull(),
  },
  {
    route: "POST /api/seller/business/purchases",
    name: "rejects a supplier that is not the seller's",
    as: "seller",
    body: (ctx) => ({ supplierId: "64b000000000000000000000", billNo: "NS-3", items: [{ productId: String(ctx.bread._id), quantity: 1, cost: 25 }] }),
    status: 404,
  },
  {
    route: "PUT /api/seller/business/purchases/:id",
    name: "a supplier can be added to a bill later",
    as: "seller",
    params: (ctx) => ({ id: ctx.noSupplierBillId }),
    body: (ctx) => ({ supplierId: ctx.supplierId, billNo: "NS-1", items: [{ productId: String(ctx.bread._id), quantity: 4, cost: 25 }], amountPaid: 60, paymentMethod: "CASH" }),
    check: async (res, ctx) => {
      expect(String(res.body.result.supplier)).toBe(String(ctx.supplierId));
      const rows = await PartyLedgerEntry.find({ refId: ctx.noSupplierBillId }).lean();
      expect(rows.map((r) => r.kind).sort()).toEqual(["PAYMENT", "PURCHASE"]);
    },
  },
  {
    route: "PUT /api/seller/business/purchases/:id",
    name: "the supplier can be removed again",
    as: "seller",
    params: (ctx) => ({ id: ctx.noSupplierBillId }),
    body: (ctx) => ({ supplierId: null, billNo: "NS-1", items: [{ productId: String(ctx.bread._id), quantity: 4, cost: 25 }], amountPaid: 60, paymentMethod: "CASH" }),
    check: async (res, ctx) => {
      expect(res.body.result.supplier).toBeNull();
      const rows = await PartyLedgerEntry.find({ refId: ctx.noSupplierBillId }).lean();
      expect(rows.map((r) => r.kind)).toEqual(["PAYMENT"]);
    },
  },
  {
    route: "POST /api/seller/business/purchase-returns",
    name: "returns stock from a bill without a supplier",
    as: "seller",
    body: (ctx) => ({ supplierId: null, purchaseBillId: ctx.noSupplierBillId, items: [{ productId: String(ctx.bread._id), quantity: 1, cost: 25 }], reason: "Damaged" }),
    status: 201,
    check: async (res, ctx) => {
      expect(res.body.result.supplier).toBeNull();
      expect(await stockOf(ctx.bread._id)).toBe(ctx.breadBeforeNoSupplier + 3);
    },
  },
  {
    route: "GET /api/seller/business/reports/:type",
    name: "purchase report labels bills without a supplier",
    as: "seller",
    params: { type: "purchases" },
    check: (res) => {
      const row = (res.body.result.rows || []).find((r) => r.billNo === "NS-1");
      expect(row).toEqual(expect.objectContaining({ supplier: "No supplier", paid: 60 }));
    },
  },
  {
    route: "GET /api/seller/business/accounts/:view",
    name: "payments list includes the no-supplier payment",
    as: "seller",
    params: { view: "payments" },
    check: (res) => expect(JSON.stringify(res.body.result)).toContain("No supplier"),
  },

  // ── Payments, ledgers, expenses, cash ─────────────────────────────────────
  {
    route: "POST /api/seller/business/payments",
    as: "seller",
    body: (ctx) => ({ partyType: "SUPPLIER", partyId: ctx.supplierId, amount: 50, method: "UPI" }),
    status: 201,
  },
  { route: "POST /api/seller/business/payments", name: "validates amount", as: "seller", body: (ctx) => ({ partyType: "SUPPLIER", partyId: ctx.supplierId, amount: 0 }), status: 400 },
  {
    route: "GET /api/seller/business/suppliers/:id/ledger",
    as: "seller",
    params: (ctx) => ({ id: ctx.supplierId }),
    check: (res) => expect(JSON.stringify(res.body.result)).toContain("B-101"),
  },
  { route: "GET /api/seller/business/customers/:id/ledger", as: "seller", params: (ctx) => ({ id: ctx.posCustomerId }) },
  {
    route: "POST /api/seller/business/expenses",
    as: "seller",
    body: { category: "Electricity", amount: 500, method: "CASH", note: "October bill" },
    status: 201,
    check: (res, ctx) => {
      ctx.expenseId = res.body.result._id;
    },
  },
  { route: "DELETE /api/seller/business/expenses/:id", as: "seller", params: (ctx) => ({ id: ctx.expenseId }) },
  { route: "POST /api/seller/business/cash-entries", as: "seller", body: { direction: "IN", amount: 1000, note: "Owner top-up" }, status: 201 },
  { route: "POST /api/seller/business/cash-entries", name: "validates direction", as: "seller", body: { direction: "SIDEWAYS", amount: 1 }, status: 400 },
  { route: "PUT /api/seller/business/cash-register/opening", as: "seller", body: () => ({ dateKey: today(), openingCash: 2000 }) },
  {
    route: "GET /api/seller/business/cash-register/today",
    as: "seller",
    query: () => ({ date: today() }),
    check: (res) => expect(res.body.result).toEqual(expect.objectContaining({ openingCash: 2000, manualCashIn: 1000 })),
  },
  {
    route: "POST /api/seller/business/cash-register/close",
    as: "seller",
    body: () => ({ dateKey: today(), countedClosingCash: 3000 }),
    check: (res) => expect(JSON.stringify(res.body.result)).toMatch(/"closed":true/),
  },
  { route: "POST /api/seller/business/cash-register/reopen", as: "seller", body: () => ({ dateKey: today() }) },
  { route: "GET /api/seller/business/dashboard", as: "seller", check: (res) => expect(res.body.result).toEqual(expect.objectContaining({ salesCount: expect.any(Number), stockUnits: expect.any(Number) })) },
  { route: "GET /api/seller/business/accounts/:view", as: "seller", params: { view: "payments" }, check: (res) => expect(JSON.stringify(res.body.result)).toContain("UPI") },
  { route: "GET /api/seller/business/accounts/:view", name: "received", as: "seller", params: { view: "received" } },
  { route: "GET /api/seller/business/accounts/:view", name: "unknown view", as: "seller", params: { view: "bogus" }, status: 404 },
  ...[
    "sales",
    "purchases",
    "purchase-returns",
    "sale-returns",
    "stock",
    "customer-ledger",
    "supplier-ledger",
    "day-book",
    "cash-register",
    "expenses",
    "pnl",
    "low-stock",
    "expiry",
  ].map((type) => ({ route: "GET /api/seller/business/reports/:type", name: type, as: "seller", params: { type } })),
  { route: "GET /api/seller/business/reports/:type", name: "unknown report", as: "seller", params: { type: "bogus" }, status: 404 },
  { route: "GET /api/seller/business/dashboard", name: "customers are denied", as: "customer", status: 403 },
  { route: "DELETE /api/seller/business/expenses/:id", name: "malformed id", as: "seller", params: { id: "not-an-id" }, status: [400, 404] },
  {
    route: "GET /api/seller/business/suppliers/:id/ledger",
    name: "unknown supplier has an empty ledger",
    as: "seller",
    params: { id: OID },
    check: (res) => expect(res.body.result).toEqual({ entries: [], balance: 0 }),
  },
  {
    route: "POST /api/seller/reset-password",
    name: "missing token gets a reset-specific message",
    body: (ctx) => ({ channel: "email", rawValue: ctx.seller.email, newPassword: "Another12345" }),
    status: 400,
    check: (res) => expect(res.body.message).toMatch(/before resetting the password/),
  },
];
