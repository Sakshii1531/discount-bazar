/**
 * Order cancellation endpoints: customer eligibility / cancel / request /
 * withdraw, admin review / approve / reject / manual cancel / refunds /
 * reports / policy, rider return confirmation and seller inspection.
 */
import { expect } from "@jest/globals";
import Order from "../../../app/models/order.js";

let seq = 0;
async function makeOrder(ctx, overrides = {}) {
  seq += 1;
  const order = await Order.create({
    orderId: `ORDMXC${Date.now()}${seq}`,
    customer: ctx.customer._id,
    seller: ctx.seller._id,
    items: [{ product: ctx.milk._id, name: ctx.milk.name, quantity: 1, price: 55 }],
    address: { name: "Main Customer", address: "12 MG Road", city: "Indore", phone: "9999999999" },
    workflowVersion: 2,
    workflowStatus: "SELLER_PENDING",
    status: "pending",
    paymentMode: "COD",
    paymentStatus: "PENDING_CASH_COLLECTION",
    stockReservation: { status: "COMMITTED", reservedAt: new Date() },
    pricing: { subtotal: 55, total: 55 },
    paymentBreakdown: { productSubtotal: 55, grandTotal: 55, walletNettedInGrandTotal: true },
    ...overrides,
  });
  return order.toObject();
}

const pickedUp = (ctx) => ({
  workflowStatus: "OUT_FOR_DELIVERY",
  status: "out_for_delivery",
  deliveryBoy: ctx.rider._id,
  pickupConfirmedAt: new Date(),
});

export async function seed(ctx) {
  ctx.cxlPre = await makeOrder(ctx);
  ctx.cxlPost = await makeOrder(ctx, pickedUp(ctx));
  ctx.cxlReject = await makeOrder(ctx, pickedUp(ctx));
  ctx.cxlAdmin = await makeOrder(ctx, pickedUp(ctx));
  ctx.cxlAdminPre = await makeOrder(ctx, { workflowStatus: "DELIVERY_SEARCH", status: "confirmed" });
}

const recordId = (key) => (ctx) => ({ id: ctx[key] });
const reason = { mode: "REQUEST", reasonCode: "DELIVERY_TOO_LONG" };

export default [
  {
    route: "GET /api/cancellations/policy",
    check: (res) => expect(res.body.result.reasons).toHaveLength(8),
  },
  {
    route: "GET /api/cancellations/orders/:orderId",
    as: "customer",
    params: (ctx) => ({ orderId: ctx.cxlPre.orderId }),
    check: (res) => expect(res.body.result.eligibility.action).toBe("SELF_CANCEL"),
  },
  {
    route: "GET /api/cancellations/orders/:orderId",
    name: "another customer cannot see it",
    as: "otherCustomer",
    params: (ctx) => ({ orderId: ctx.cxlPre.orderId }),
    status: 404,
  },
  {
    route: "POST /api/cancellations/orders/:orderId",
    as: "customer",
    params: (ctx) => ({ orderId: ctx.cxlPre.orderId }),
    body: { mode: "CANCEL", reasonCode: "PLACED_BY_MISTAKE" },
    status: 201,
    check: (res) => expect(res.body.result.cancellation.status).toBe("CANCELLED"),
  },
  {
    route: "POST /api/cancellations/orders/:orderId",
    name: "repeat returns the existing result",
    as: "customer",
    params: (ctx) => ({ orderId: ctx.cxlPre.orderId }),
    body: { mode: "CANCEL", reasonCode: "PLACED_BY_MISTAKE" },
    check: (res) => expect(res.body.result.duplicate).toBe(true),
  },
  {
    route: "POST /api/cancellations/orders/:orderId",
    name: "after pickup only a request is possible",
    as: "customer",
    params: (ctx) => ({ orderId: ctx.cxlPost.orderId }),
    body: { mode: "CANCEL", reasonCode: "OTHER" },
    status: 409,
  },
  {
    route: "POST /api/cancellations/orders/:orderId",
    name: "request after pickup",
    as: "customer",
    params: (ctx) => ({ orderId: ctx.cxlPost.orderId }),
    body: reason,
    status: 201,
    check: (res, ctx) => {
      expect(res.body.result.cancellation.status).toBe("REQUESTED");
      ctx.cxlPostId = res.body.result.cancellation.id;
    },
  },
  {
    route: "POST /api/cancellations/orders/:orderId/withdraw",
    as: "customer",
    params: (ctx) => ({ orderId: ctx.cxlPost.orderId }),
    check: (res) => expect(res.body.result.cancellation.status).toBe("WITHDRAWN"),
  },
  {
    route: "POST /api/cancellations/orders/:orderId",
    name: "request again after withdrawing",
    as: "customer",
    params: (ctx) => ({ orderId: ctx.cxlPost.orderId }),
    body: reason,
    status: 201,
  },
  {
    route: "GET /api/cancellations/admin",
    as: "admin",
    query: { status: "REQUESTED" },
    check: (res, ctx) => expect(res.body.result.items.map((i) => i.orderId)).toContain(ctx.cxlPost.orderId),
  },
  { route: "GET /api/cancellations/admin", name: "customers are denied", as: "customer", status: 403 },
  {
    route: "GET /api/cancellations/admin/:id",
    as: "admin",
    params: recordId("cxlPostId"),
    check: (res) => expect(res.body.result.auditLog.length).toBeGreaterThan(0),
  },
  {
    route: "POST /api/cancellations/admin/:id/review",
    as: "admin",
    params: recordId("cxlPostId"),
    check: (res) => expect(res.body.result.status).toBe("UNDER_REVIEW"),
  },
  {
    route: "POST /api/cancellations/admin/:id/approve",
    as: "admin",
    params: recordId("cxlPostId"),
    body: { note: "Approved in matrix" },
    check: (res) => {
      expect(res.body.result.status).toBe("APPROVED");
      expect(res.body.result.returnLeg.status).toBe("RETURN_TO_STORE");
    },
  },
  {
    route: "GET /api/cancellations/rider/returns",
    as: "delivery",
    check: (res, ctx) => expect(res.body.result.items.map((t) => t.orderId)).toContain(ctx.cxlPost.orderId),
  },
  {
    route: "POST /api/cancellations/rider/returns/:id/confirm",
    as: "delivery",
    params: recordId("cxlPostId"),
    check: (res) => expect(res.body.result.returnLeg.status).toBe("RETURNED_TO_STORE"),
  },
  {
    route: "GET /api/cancellations/seller",
    as: "seller",
    check: (res, ctx) =>
      expect(res.body.result.awaitingInspection.map((c) => c.orderId)).toContain(ctx.cxlPost.orderId),
  },
  {
    route: "POST /api/cancellations/seller/:id/inspection",
    as: "seller",
    params: recordId("cxlPostId"),
    body: { items: [{ itemIndex: 0, sellableQty: 1 }] },
    check: (res) => expect(res.body.result.inventory.status).toBe("INSPECTED"),
  },
  {
    route: "POST /api/cancellations/seller/:id/inspection",
    name: "another seller cannot inspect",
    as: "otherSeller",
    params: recordId("cxlPostId"),
    body: { items: [{ itemIndex: 0, sellableQty: 1 }] },
    status: 404,
  },
  {
    route: "POST /api/cancellations/admin/:id/reject",
    as: "admin",
    before: async (ctx) => {
      const { submitCustomerCancellation } = await import("../../../app/services/cancellation/orderCancellationService.js");
      const { record } = await submitCustomerCancellation({
        customerId: ctx.customer._id,
        orderParam: ctx.cxlReject.orderId,
        mode: "REQUEST",
        reasonCode: "OTHER",
      });
      ctx.cxlRejectId = String(record._id);
    },
    params: recordId("cxlRejectId"),
    body: { reason: "Rider is at your door" },
    check: (res) => expect(res.body.result.status).toBe("REJECTED"),
  },
  {
    route: "POST /api/cancellations/admin/orders/:orderId/cancel",
    name: "reason is mandatory",
    as: "admin",
    params: (ctx) => ({ orderId: ctx.cxlAdmin.orderId }),
    body: {},
    status: 400,
  },
  {
    route: "POST /api/cancellations/admin/orders/:orderId/cancel",
    as: "admin",
    params: (ctx) => ({ orderId: ctx.cxlAdmin.orderId }),
    body: { reason: "Customer called support" },
    check: (res, ctx) => {
      expect(res.body.result.status).toBe("APPROVED");
      ctx.cxlAdminId = res.body.result.id;
    },
  },
  {
    route: "POST /api/cancellations/admin/:id/return/confirm",
    as: "admin",
    params: recordId("cxlAdminId"),
    check: (res) => expect(res.body.result.returnLeg.status).toBe("RETURNED_TO_STORE"),
  },
  {
    route: "POST /api/cancellations/admin/:id/inspection",
    as: "admin",
    params: recordId("cxlAdminId"),
    body: { items: [{ itemIndex: 0, sellableQty: 0, damagedQty: 1 }] },
    check: (res) => expect(res.body.result.inventory.status).toBe("INSPECTED"),
  },
  {
    route: "POST /api/cancellations/admin/:id/refund/retry",
    name: "only failed refunds can be retried",
    as: "admin",
    params: recordId("cxlAdminId"),
    status: 409,
  },
  {
    route: "POST /api/cancellations/admin/:id/refund/resolve",
    name: "a note is required",
    as: "admin",
    params: recordId("cxlAdminId"),
    body: {},
    status: 400,
  },
  {
    route: "GET /api/cancellations/admin/reports",
    as: "admin",
    check: (res) => expect(res.body.result.total).toBeGreaterThanOrEqual(3),
  },
  {
    route: "GET /api/cancellations/admin/policy",
    as: "admin",
    check: (res) => expect(res.body.result.policy.selfCancelEnabled).toBe(true),
  },
  {
    route: "PUT /api/cancellations/admin/policy",
    as: "admin",
    body: { selfCancelStages: { ACCEPTED: false } },
    check: (res) => expect(res.body.result.policy.selfCancelStages.ACCEPTED).toBe(false),
  },
  {
    route: "POST /api/cancellations/orders/:orderId",
    name: "disabled stage points to support",
    as: "customer",
    params: (ctx) => ({ orderId: ctx.cxlAdminPre.orderId }),
    body: { mode: "CANCEL", reasonCode: "OTHER" },
    status: 409,
    check: (res) => expect(res.body.result.eligibility.action).toBe("CONTACT_SUPPORT"),
  },
];
