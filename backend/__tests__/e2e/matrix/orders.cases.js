/**
 * Order endpoints, exercised as a real life-cycle on a replica-set DB:
 *   checkout preview → COD order → seller accepts → rider accepts → arrives
 *   → picks up → delivery OTP → delivered → COD collected/reconciled,
 * plus cancellation, re-order, the legacy /orders/place flow, seller views
 * and role isolation. Returns, ratings and payments live in their own files
 * but reuse helpers from here.
 */
import { expect } from "@jest/globals";
import OrderOtp from "../../../app/models/orderOtp.js";
import Order from "../../../app/models/order.js";
import { listOf } from "../helpers/world.js";

export const AT_CUSTOMER = { lat: 22.7196, lng: 75.8577 };

export const orderPayload = (ctx, productId = ctx.milk._id, extra = {}) => ({
  items: [{ product: String(productId), quantity: 2 }],
  address: {
    name: "Main Customer",
    address: "12 MG Road, Indore",
    city: "Indore",
    phone: "9999999999",
    location: AT_CUSTOMER,
  },
  paymentMode: "COD",
  timeSlot: "now",
  ...extra,
});

export const latestOtp = async (orderId, type = "delivery") =>
  (await OrderOtp.findOne({ orderId, type, consumedAt: null }).sort({ createdAt: -1 }).lean())?.code;

const oid = (ctx) => ({ orderId: ctx.orderId });
const id = (ctx) => ({ id: ctx.orderId });

export default [
  // ── Checkout ──────────────────────────────────────────────────────────────
  {
    route: "POST /api/orders/checkout/preview",
    as: "customer",
    body: (ctx) => orderPayload(ctx),
    check: (res) => {
      const b = res.body.result.breakdown;
      expect(b.productSubtotal).toBe(110); // 2 × ₹55
      expect(b.grandTotal).toBe(b.productSubtotal + b.deliveryFeeCharged + b.handlingFeeCharged);
      expect(res.body.result.paymentMode).toBe("COD");
    },
  },
  { route: "POST /api/orders/checkout/preview", name: "validates items", as: "customer", body: { items: [], address: {} }, status: 400 },
  { route: "POST /api/orders/checkout/preview", name: "sellers are denied", as: "seller", body: (ctx) => orderPayload(ctx), status: 403 },
  {
    route: "POST /api/orders",
    as: "customer",
    body: (ctx) => orderPayload(ctx),
    status: 201,
    check: async (res, ctx) => {
      const order = res.body.result.order;
      expect(order.orderId).toMatch(/^ORD-/);
      expect(String(order.seller)).toBe(String(ctx.seller._id));
      expect(order.items[0]).toEqual(expect.objectContaining({ name: "Fresh Milk", quantity: 2, price: 55 }));
      ctx.orderId = order.orderId;
      ctx.orderMongoId = order._id;
    },
  },
  {
    route: "POST /api/orders",
    name: "rejects out-of-stock quantities",
    as: "customer",
    body: (ctx) => ({ ...orderPayload(ctx), items: [{ product: String(ctx.milk._id), quantity: 5000 }] }),
    status: [400, 409],
  },
  {
    route: "GET /api/orders/my-orders",
    as: "customer",
    check: (res, ctx) => expect(listOf(res).map((o) => o.orderId)).toContain(ctx.orderId),
  },
  {
    route: "GET /api/orders/my-orders",
    name: "other customers see none of it",
    as: "otherCustomer",
    check: (res, ctx) => expect(listOf(res).map((o) => o.orderId)).not.toContain(ctx.orderId),
  },
  {
    route: "GET /api/orders/details/:orderId",
    as: "customer",
    params: oid,
    check: (res, ctx) => expect(res.body.result.orderId).toBe(ctx.orderId),
  },
  { route: "GET /api/orders/details/:orderId", name: "another customer cannot read it", as: "otherCustomer", params: oid, status: [403, 404] },

  // ── Seller acceptance ─────────────────────────────────────────────────────
  {
    route: "GET /api/orders/seller-orders",
    as: "seller",
    check: (res, ctx) => {
      expect(listOf(res).map((o) => o.orderId)).toContain(ctx.orderId);
      expect(res.body.result.summary.totalOrders).toBeGreaterThanOrEqual(1);
    },
  },
  {
    route: "GET /api/orders/seller-orders",
    name: "other sellers don't see it",
    as: "otherSeller",
    check: (res, ctx) => expect(listOf(res).map((o) => o.orderId)).not.toContain(ctx.orderId),
  },
  { route: "GET /api/orders/seller-orders", name: "pending sellers are blocked", as: "pendingSeller", status: 403 },
  {
    route: "PUT /api/orders/status/:orderId",
    name: "another seller cannot accept it",
    as: "otherSeller",
    params: oid,
    body: { status: "confirmed" },
    status: [403, 404],
  },
  {
    route: "PUT /api/orders/status/:orderId",
    as: "seller",
    params: oid,
    body: { status: "confirmed" },
    check: (res) => expect(res.body.message).toMatch(/accepted|updated/i),
  },

  // ── Rider ─────────────────────────────────────────────────────────────────
  {
    route: "GET /api/orders/available",
    as: "delivery",
    check: (res, ctx) => expect(listOf(res).map((o) => o.orderId)).toContain(ctx.orderId),
  },
  { route: "GET /api/orders/available", name: "customers are denied", as: "customer", status: 403 },
  {
    route: "PUT /api/orders/accept/:orderId",
    as: "delivery",
    params: oid,
    check: async (res, ctx) => {
      const order = await Order.findOne({ orderId: ctx.orderId }).lean();
      expect(String(order.deliveryBoy)).toBe(String(ctx.rider._id));
    },
  },
  {
    route: "PUT /api/orders/accept/:orderId",
    name: "accepting again is idempotent for the same rider",
    as: "delivery",
    params: oid,
    check: (res) => expect(res.body.message).toBe("Already accepted"),
  },
  {
    route: "PUT /api/orders/accept/:orderId",
    name: "another rider cannot take an assigned order",
    as: "pendingDelivery",
    params: oid,
    status: [400, 403, 409],
  },
  {
    route: "POST /api/orders/workflow/:orderId/pickup/ready",
    as: "delivery",
    params: oid,
    body: AT_CUSTOMER,
    check: (res) => expect(res.body.message).toMatch(/Arrived/i),
  },
  {
    route: "POST /api/orders/workflow/:orderId/pickup/confirm",
    as: "delivery",
    params: oid,
    body: AT_CUSTOMER,
    check: (res) => expect(res.body.message).toMatch(/Pickup confirmed/i),
  },
  {
    route: "POST /api/orders/workflow/:orderId/rider/advance-ui",
    as: "delivery",
    params: oid,
    body: {},
  },
  {
    route: "GET /api/orders/workflow/:orderId/route",
    as: "customer",
    params: oid,
    query: { phase: "delivery", originLat: AT_CUSTOMER.lat, originLng: AT_CUSTOMER.lng },
    // Without a Google key the service falls back to a straight line or reports maps unavailable.
    status: [200, 503],
  },
  {
    route: "POST /api/orders/workflow/:orderId/otp/request",
    name: "rider must be near the customer",
    as: "delivery",
    params: oid,
    body: { lat: 23.2599, lng: 77.4126 },
    status: 403,
    check: (res) => expect(JSON.stringify(res.body)).toContain("PROXIMITY_OUT_OF_RANGE"),
  },
  {
    route: "POST /api/orders/workflow/:orderId/otp/request",
    as: "delivery",
    params: oid,
    body: AT_CUSTOMER,
    check: async (res, ctx) => {
      expect(res.body.result.attemptsRemaining).toBe(3);
      ctx.deliveryOtp = await latestOtp(ctx.orderId);
      expect(ctx.deliveryOtp).toMatch(/^\d{4}$/);
    },
  },
  {
    route: "POST /api/orders/workflow/:orderId/otp/verify",
    name: "rejects a wrong code",
    as: "delivery",
    params: oid,
    body: (ctx) => ({ otp: ctx.deliveryOtp === "0000" ? "1111" : "0000", ...AT_CUSTOMER }),
    status: [400, 401, 403, 422],
    check: (res) => expect(res.body.result.error.code).toBe("OTP_MISMATCH"),
  },
  {
    route: "POST /api/orders/workflow/:orderId/otp/verify",
    as: "delivery",
    params: oid,
    body: (ctx) => ({ otp: ctx.deliveryOtp, ...AT_CUSTOMER }),
    check: async (res, ctx) => {
      const order = await Order.findOne({ orderId: ctx.orderId }).lean();
      expect(order.status).toBe("delivered");
    },
  },

  // ── Settlement ────────────────────────────────────────────────────────────
  {
    route: "POST /api/orders/:id/delivered",
    name: "is idempotent once delivered",
    as: "delivery",
    params: id,
    body: {},
    status: [200, 409],
  },
  {
    route: "POST /api/orders/:id/cod/mark-collected",
    as: "delivery",
    params: id,
    body: {},
    status: [200, 409],
  },
  { route: "POST /api/orders/:id/cod/mark-collected", name: "customers are denied", as: "customer", params: id, body: {}, status: 403 },
  {
    route: "POST /api/orders/:id/cod/reconcile",
    name: "amount above the pending COD is rejected",
    as: "admin",
    params: id,
    body: { amount: 999999 },
    status: 400,
  },
  {
    route: "POST /api/orders/:id/cod/reconcile",
    as: "admin",
    params: id,
    before: async (ctx) => {
      const order = await Order.findOne({ orderId: ctx.orderId }).lean();
      ctx.codPending = Number(order.paymentBreakdown?.codPendingAmount || 0);
    },
    body: (ctx) => ({ amount: ctx.codPending || 0.01 }),
    check: (res, ctx) => {
      expect(ctx.codPending).toBeGreaterThan(0);
      expect(res.body.result.paymentBreakdown.codPendingAmount).toBe(0);
      expect(res.body.result.paymentStatus).toBe("COD_RECONCILED");
    },
  },
  { route: "POST /api/orders/:id/cod/reconcile", name: "validates amount", as: "admin", params: id, body: {}, status: 400 },

  // ── Cancellation & re-order ───────────────────────────────────────────────
  {
    route: "POST /api/orders",
    name: "second order (to cancel)",
    as: "customer",
    body: (ctx) => orderPayload(ctx, ctx.bread._id),
    status: 201,
    check: (res, ctx) => {
      ctx.cancelOrderId = res.body.result.order.orderId;
    },
  },
  {
    route: "PUT /api/orders/cancel/:orderId",
    name: "another customer cannot cancel it",
    as: "otherCustomer",
    params: (ctx) => ({ orderId: ctx.cancelOrderId }),
    body: { reason: "not mine" },
    status: [403, 404],
  },
  {
    route: "PUT /api/orders/cancel/:orderId",
    as: "customer",
    params: (ctx) => ({ orderId: ctx.cancelOrderId }),
    body: { reason: "Changed my mind" },
    check: async (res, ctx) => {
      const order = await Order.findOne({ orderId: ctx.cancelOrderId }).lean();
      expect(order.status).toBe("cancelled");
    },
  },
  {
    route: "PUT /api/orders/cancel/:orderId",
    name: "delivered orders cannot be cancelled",
    as: "customer",
    params: oid,
    body: { reason: "too late" },
    status: [400, 409],
  },
  {
    route: "POST /api/orders/:orderId/reorder",
    as: "customer",
    params: oid,
    check: (res) => expect(JSON.stringify(res.body.result)).toContain("Fresh Milk"),
  },
  { route: "POST /api/orders/:orderId/reorder", name: "unknown order", as: "customer", params: { orderId: "ORD-NOPE0000" }, status: 404 },

  // ── Skip & legacy placement ───────────────────────────────────────────────
  {
    route: "POST /api/orders",
    name: "third order (for rider skip)",
    as: "customer",
    body: (ctx) => orderPayload(ctx, ctx.bread._id),
    status: 201,
    check: (res, ctx) => {
      ctx.skipOrderId = res.body.result.order.orderId;
    },
  },
  {
    route: "PUT /api/orders/skip/:orderId",
    as: "delivery",
    params: (ctx) => ({ orderId: ctx.skipOrderId }),
    body: { reason: "Too far" },
    status: [200, 400, 409],
  },
  {
    route: "POST /api/orders/place",
    name: "legacy cart checkout",
    as: "customer",
    before: async (ctx) => {
      const Cart = (await import("../../../app/models/cart.js")).default;
      await Cart.updateOne(
        { customerId: ctx.customer._id },
        { $set: { items: [{ productId: ctx.bread._id, quantity: 1 }] } },
        { upsert: true },
      );
    },
    body: (ctx) => ({
      address: {
        name: "Main Customer",
        address: "12 MG Road, Indore",
        city: "Indore",
        phone: "9999999999",
        location: AT_CUSTOMER,
      },
      paymentMode: "COD",
      items: [{ product: String(ctx.bread._id), quantity: 1 }],
    }),
    status: [200, 201],
    check: (res) => expect(JSON.stringify(res.body.result)).toMatch(/ORD-/),
  },
];
