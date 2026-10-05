/**
 * Admin panel endpoints on a marketplace with one genuinely delivered COD
 * order: auth & profile, dashboard stats, finance (summary, ledger, payouts,
 * CSV export), platform & delivery settings, customers, sellers (approval),
 * riders (approval), rider cash collection, wallet, withdrawals.
 */
import { expect } from "@jest/globals";
import Seller from "../../../app/models/seller.js";
import Delivery from "../../../app/models/delivery.js";
import Transaction from "../../../app/models/transaction.js";
import { placeAndDeliverOrder } from "../helpers/flows.js";
import { listOf } from "../helpers/world.js";

const OID = "64b7f0c2a1b2c3d4e5f60718";

export async function seed(ctx, app) {
  ctx.deliveredOrder = await placeAndDeliverOrder(app, ctx, ctx.milk._id);
  ctx.extraPendingSeller = await Seller.create({
    name: "Reject Me",
    email: `reject-${Date.now()}@test.com`,
    phone: "8999999999",
    password: "SellerPass123",
    shopName: "Rejectable Store",
    isVerified: false,
    applicationStatus: "pending",
  });
  ctx.extraPendingRider = await Delivery.create({ name: "Reject Rider", phone: "7999999999", isVerified: false });
}

export default [
  // ── Auth & profile ────────────────────────────────────────────────────────
  {
    route: "POST /api/admin/login",
    body: (ctx) => ({ email: ctx.admin.email, password: ctx.admin.plainPassword }),
    check: (res, ctx) => {
      expect(res.body.result.token).toEqual(expect.any(String));
      expect(res.body.result.admin.email).toBe(ctx.admin.email);
      expect(res.body.result.admin.password).toBeUndefined();
    },
  },
  { route: "POST /api/admin/login", name: "wrong password", body: (ctx) => ({ email: ctx.admin.email, password: "nope" }), status: 401 },
  { route: "POST /api/admin/login", name: "validates input", body: { email: "not-an-email" }, status: 400 },
  { route: "POST /api/admin/signup", name: "public signup is disabled", body: { name: "Mallory", email: "m@test.com", password: "Str0ngPassword1" }, status: 403 },
  { route: "POST /api/admin/bootstrap", name: "refused when not configured", body: { name: "Mallory", email: "m@test.com", password: "Str0ngPassword1" }, status: [403, 503] },
  { route: "GET /api/admin/profile", as: "admin", check: (res, ctx) => expect(res.body.result.email).toBe(ctx.admin.email) },
  { route: "PUT /api/admin/profile", as: "admin", body: { name: "Chief Admin" }, check: (res) => expect(res.body.result.name).toBe("Chief Admin") },
  {
    route: "PUT /api/admin/profile/password",
    name: "requires the current password",
    as: "admin",
    body: { currentPassword: "wrong", newPassword: "An0therStrongPass" },
    status: [400, 401],
  },
  {
    route: "PUT /api/admin/profile/password",
    as: "admin",
    body: (ctx) => ({ currentPassword: ctx.admin.plainPassword, newPassword: "An0therStrongPass" }),
  },
  {
    route: "POST /api/admin/login",
    name: "the new password works",
    body: (ctx) => ({ email: ctx.admin.email, password: "An0therStrongPass" }),
  },

  // ── Dashboard & finance ───────────────────────────────────────────────────
  {
    route: "GET /api/admin/stats",
    as: "admin",
    check: (res) => expect(res.body.result.overview).toEqual(expect.objectContaining({ totalOrders: 1, totalRevenue: 85 })),
  },
  { route: "GET /api/admin/dashboard", as: "admin", envelope: false, check: (res) => expect(res.body.success).toBe(true) },
  { route: "GET /api/admin/stats", name: "sellers are denied", as: "seller", status: 403 },
  {
    route: "GET /api/admin/pending-review-counts",
    as: "admin",
    check: (res) => expect(res.body.result).toEqual(expect.objectContaining({ pendingSellers: 2, pendingDrivers: 2 })),
  },
  {
    route: "GET /api/admin/finance/summary",
    as: "admin",
    check: (res) => expect(res.body.result).toEqual(expect.objectContaining({ sellerPendingPayouts: 55, deliveryPendingPayouts: 30 })),
  },
  {
    route: "GET /api/admin/finance/ledger",
    as: "admin",
    check: (res, ctx) => expect(JSON.stringify(listOf(res))).toContain(ctx.deliveredOrder),
  },
  {
    route: "GET /api/admin/finance/payouts",
    as: "admin",
    check: (res) => expect(listOf(res).map((p) => p.payoutType).sort()).toEqual(["DELIVERY_PARTNER", "SELLER"]),
  },
  {
    route: "POST /api/admin/finance/payouts/process",
    as: "admin",
    body: { payoutType: "SELLER" },
    check: (res) => expect(res.body.result).toEqual(expect.objectContaining({ completed: 1, failed: 0 })),
  },
  { route: "POST /api/admin/finance/payouts/process", name: "validates payoutType", as: "admin", body: { payoutType: "BANK" }, status: 400 },
  {
    route: "GET /api/admin/finance/export-statement",
    as: "admin",
    envelope: false,
    check: (res, ctx) => {
      expect(res.headers["content-type"]).toMatch(/text\/csv/);
      expect(res.text.split("\n")[0]).toMatch(/^Transaction ID,Date,Type/);
      expect(res.text).toContain(ctx.deliveredOrder);
    },
  },

  // ── Settings ──────────────────────────────────────────────────────────────
  { route: "GET /api/admin/settings/platform", as: "admin", check: (res) => expect(res.body.result.productApproval).toBeDefined() },
  {
    route: "PUT /api/admin/settings/platform",
    as: "admin",
    body: { supportPhone: "+911234567890" },
    check: (res) => expect(res.body.result.supportPhone).toBe("+911234567890"),
  },
  { route: "GET /api/admin/settings/delivery", as: "admin", check: (res) => expect(res.body.result.customerBaseDeliveryFee).toBe(30) },
  {
    route: "PUT /api/admin/settings/delivery",
    as: "admin",
    body: { customerBaseDeliveryFee: 25 },
    check: (res) => expect(res.body.result.customerBaseDeliveryFee).toBe(25),
  },
  { route: "PUT /api/admin/settings/delivery", name: "validates values", as: "admin", body: { globalTaxRate: 150 }, status: 400 },

  // ── Customers ─────────────────────────────────────────────────────────────
  {
    route: "GET /api/admin/users",
    as: "admin",
    check: (res, ctx) => {
      const main = listOf(res).find((u) => String(u._id) === String(ctx.customer._id));
      expect(main).toEqual(expect.objectContaining({ totalOrders: 1, totalSpent: 85 }));
    },
  },
  {
    route: "POST /api/admin/users",
    as: "admin",
    body: { name: "Walk In", phone: "9833300033" },
    status: 201,
    check: (res) => expect(res.body.result.phone).toBe("+919833300033"),
  },
  { route: "POST /api/admin/users", name: "duplicate phone", as: "admin", body: { name: "Again", phone: "9833300033" }, status: [400, 409] },
  { route: "GET /api/admin/users/:id", as: "admin", params: (ctx) => ({ id: ctx.customer._id }), check: (res) => expect(res.body.result.totalOrders).toBe(1) },
  { route: "GET /api/admin/users/:id", name: "unknown customer", as: "admin", params: { id: OID }, status: 404 },

  // ── Sellers ───────────────────────────────────────────────────────────────
  { route: "GET /api/admin/sellers", as: "admin", check: (res) => expect(listOf(res).length).toBe(4) },
  { route: "GET /api/admin/sellers/active", as: "admin", check: (res) => expect(listOf(res).map((s) => s.shopName)).toEqual(expect.arrayContaining(["Main Mart", "Other Mart"])) },
  { route: "GET /api/admin/sellers/locations", as: "admin", check: (res) => expect(listOf(res).map((s) => s.shopName)).toContain("Main Mart") },
  {
    route: "GET /api/admin/sellers/pending",
    as: "admin",
    check: (res) => expect(listOf(res).map((s) => s.shopName).sort()).toEqual(["Pending Kirana", "Rejectable Store"]),
  },
  {
    route: "PATCH /api/admin/sellers/approve/:id",
    as: "admin",
    params: (ctx) => ({ id: ctx.pendingSeller._id }),
    check: async (res, ctx) => {
      const s = await Seller.findById(ctx.pendingSeller._id).lean();
      expect(s).toEqual(expect.objectContaining({ isVerified: true, applicationStatus: "approved" }));
    },
  },
  {
    route: "DELETE /api/admin/sellers/reject/:id",
    as: "admin",
    params: (ctx) => ({ id: ctx.extraPendingSeller._id }),
    body: { reason: "Documents unreadable" },
    check: async (res, ctx) => {
      const s = await Seller.findById(ctx.extraPendingSeller._id).lean();
      expect(s === null || s.applicationStatus === "rejected").toBe(true);
    },
  },
  { route: "PATCH /api/admin/sellers/approve/:id", name: "unknown seller", as: "admin", params: { id: OID }, status: 404 },

  // ── Riders ────────────────────────────────────────────────────────────────
  { route: "GET /api/admin/delivery-partners", as: "admin", query: { verified: "false" }, check: (res) => expect(listOf(res).map((d) => d.name).sort()).toEqual(["Pending Rider", "Reject Rider"]) },
  {
    route: "POST /api/admin/delivery-partners",
    as: "admin",
    body: { name: "Admin Rider", phone: "9844400044", vehicleType: "bike" },
    status: 201,
    check: (res, ctx) => {
      ctx.adminRiderId = res.body.result._id;
      expect(res.body.result.isVerified).toBe(true);
    },
  },
  { route: "POST /api/admin/delivery-partners", name: "requires name/phone", as: "admin", body: {}, status: 400 },
  {
    route: "PUT /api/admin/delivery-partners/:id",
    as: "admin",
    params: (ctx) => ({ id: ctx.adminRiderId }),
    body: { vehicleNumber: "MP09ZZ0001" },
    check: (res) => expect(res.body.result.vehicleNumber).toBe("MP09ZZ0001"),
  },
  {
    route: "PATCH /api/admin/delivery-partners/approve/:id",
    as: "admin",
    params: (ctx) => ({ id: ctx.pendingRider._id }),
    check: (res) => expect(res.body.result.isVerified).toBe(true),
  },
  {
    route: "DELETE /api/admin/delivery-partners/reject/:id",
    as: "admin",
    params: (ctx) => ({ id: ctx.extraPendingRider._id }),
  },
  { route: "GET /api/admin/active-fleet", as: "admin", check: (res) => expect(Array.isArray(listOf(res))).toBe(true) },

  // ── Rider cash ────────────────────────────────────────────────────────────
  {
    route: "GET /api/admin/delivery-cash",
    as: "admin",
    check: (res, ctx) => {
      const rider = listOf(res).find((r) => String(r._id) === String(ctx.rider._id));
      expect(rider.currentCash).toBe(85);
    },
  },
  {
    route: "GET /api/admin/rider-cash-details/:id",
    as: "admin",
    params: (ctx) => ({ id: ctx.rider._id }),
    check: (res, ctx) => expect(listOf(res)).toEqual([expect.objectContaining({ id: ctx.deliveredOrder, amount: 85 })]),
  },
  { route: "POST /api/admin/delivery-cash/:id/remind", as: "admin", params: (ctx) => ({ id: ctx.rider._id }), check: (res) => expect(res.body.result.currentCash).toBe(85) },
  {
    route: "POST /api/admin/settle-cash",
    name: "cannot settle more than the rider holds",
    as: "admin",
    body: (ctx) => ({ riderId: String(ctx.rider._id), amount: 1000 }),
    status: 400,
  },
  { route: "POST /api/admin/settle-cash", name: "validates amount", as: "admin", body: (ctx) => ({ riderId: String(ctx.rider._id), amount: 0 }), status: 400 },
  {
    route: "POST /api/admin/settle-cash",
    as: "admin",
    body: (ctx) => ({ riderId: String(ctx.rider._id), amount: 10 }),
    status: 201,
    check: (res) => expect(res.body.result.amount).toBe(-10),
  },
  {
    route: "POST /api/admin/bulk-settle-cash",
    as: "admin",
    body: (ctx) => ({ riderIds: [String(ctx.rider._id)] }),
    check: (res) => expect(res.body.result).toEqual(expect.objectContaining({ count: 1, totalAmount: 75 })),
  },
  {
    route: "GET /api/admin/cash-history",
    as: "admin",
    check: (res) => expect(listOf(res).map((h) => h.amount).sort((a, b) => a - b)).toEqual([10, 75]),
  },
  {
    route: "GET /api/admin/delivery-cash",
    name: "rider owes nothing after settlement",
    as: "admin",
    check: (res, ctx) => expect(listOf(res).find((r) => String(r._id) === String(ctx.rider._id)).currentCash).toBe(0),
  },

  // ── Wallet, transactions & withdrawals ───────────────────────────────────
  { route: "GET /api/admin/wallet-data", as: "admin", check: (res) => expect(res.body.result.stats.totalPlatformEarning).toBe(85) },
  {
    route: "GET /api/admin/delivery-transactions",
    as: "admin",
    check: (res, ctx) => {
      const items = listOf(res);
      expect(items.length).toBeGreaterThan(0);
      ctx.deliveryTxnId = items[0]._id;
    },
  },
  { route: "PUT /api/admin/transactions/:id/settle", as: "admin", params: (ctx) => ({ id: ctx.deliveryTxnId }) },
  { route: "PUT /api/admin/transactions/:id/settle", name: "unknown transaction", as: "admin", params: { id: OID }, status: 404 },
  { route: "PUT /api/admin/transactions/bulk-settle-delivery", as: "admin", body: {} },
  { route: "GET /api/admin/seller-transactions", as: "admin", check: (res, ctx) => expect(JSON.stringify(listOf(res))).toContain(ctx.deliveredOrder) },
  {
    route: "POST /api/seller/request-withdrawal",
    name: "seller withdraws the settled payout",
    as: "seller",
    body: { amount: 50 },
    status: [200, 201],
  },
  {
    route: "GET /api/admin/seller-withdrawals",
    as: "admin",
    check: (res, ctx) => {
      const items = listOf(res);
      expect(items).toHaveLength(1);
      ctx.withdrawalId = items[0]._id || items[0].id;
    },
  },
  { route: "GET /api/admin/delivery-withdrawals", as: "admin", check: (res) => expect(listOf(res)).toEqual([]) },
  { route: "PUT /api/admin/withdrawals/:id", name: "validates status", as: "admin", params: (ctx) => ({ id: ctx.withdrawalId }), body: { status: "Yes" }, status: 400 },
  {
    route: "PUT /api/admin/withdrawals/:id",
    as: "admin",
    params: (ctx) => ({ id: ctx.withdrawalId }),
    body: { status: "Settled" },
    check: async (res, ctx) => {
      const txn = await Transaction.findById(ctx.withdrawalId).lean();
      expect(txn.status).toBe("Settled");
    },
  },
  { route: "PUT /api/admin/withdrawals/:id", name: "unknown withdrawal", as: "admin", params: { id: OID }, body: { status: "Settled" }, status: 404 },
];
