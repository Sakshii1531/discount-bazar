/**
 * API E2E — order cancellation flow: eligibility per stage, atomic commit,
 * exactly-once stock / refund, post-pickup request → approval → return →
 * inspection, rejection, withdrawal, delivered-while-pending, admin manual
 * cancellation and policy configuration.
 */
import { jest } from "@jest/globals";
import request from "supertest";
import { startTestApp, stopTestApp, clearDatabase, bearer } from "./helpers/testApp.js";
import * as fx from "./helpers/fixtures.js";
import Order from "../../app/models/order.js";
import Product from "../../app/models/product.js";
import OrderCancellation from "../../app/models/orderCancellation.js";
import LedgerEntry from "../../app/models/ledgerEntry.js";
import Wallet from "../../app/models/wallet.js";
import Ticket from "../../app/models/ticket.js";
import { creditWallet } from "../../app/services/finance/walletService.js";
import { clearCancellationPolicyCache } from "../../app/services/cancellation/cancellationPolicyService.js";
import {
  onLatePaymentCapture,
  onOrderDelivered,
} from "../../app/services/cancellation/orderCancellationService.js";

jest.setTimeout(180000);

let app;
let n = 0;
let customer;
let seller;
let rider;
let adminUser;
let product;
let auth;

const STOCK = 50;

/**
 * An order that took `quantity` units at placement (stock already deducted,
 * as placement does).
 */
async function makeOrder({ quantity = 3, ...overrides } = {}) {
  n += 1;
  await Product.updateOne({ _id: product._id }, { $inc: { stock: -quantity } });
  const order = await Order.create({
    orderId: `ORDCXL${Date.now()}${n}`,
    customer: customer._id,
    seller: seller._id,
    items: [{ product: product._id, name: product.name, quantity, price: 55 }],
    address: { name: "Asha", address: "12 MG Road", city: "Indore", phone: "9876500001" },
    workflowVersion: 2,
    workflowStatus: "SELLER_PENDING",
    status: "pending",
    paymentMode: "COD",
    paymentStatus: "PENDING_CASH_COLLECTION",
    stockReservation: { status: "COMMITTED", reservedAt: new Date() },
    pricing: { subtotal: 165, deliveryFee: 30, platformFee: 5, total: 200 },
    paymentBreakdown: {
      productSubtotal: 165,
      deliveryFeeCharged: 30,
      handlingFeeCharged: 5,
      grandTotal: 200,
      walletNettedInGrandTotal: true,
    },
    ...overrides,
  });
  return order.toObject();
}

const stockNow = async () => (await Product.findById(product._id).lean()).stock;
const customerWalletBalance = async () =>
  (await Wallet.findOne({ ownerType: "CUSTOMER", ownerId: customer._id }).lean())?.availableBalance || 0;

const view = (orderId, who = auth.customer) =>
  request(app).get(`/api/cancellations/orders/${orderId}`).set("Authorization", who);
const submit = (orderId, body, who = auth.customer) =>
  request(app).post(`/api/cancellations/orders/${orderId}`).set("Authorization", who).send(body);
const adminPost = (path, body = {}) =>
  request(app).post(`/api/cancellations/admin${path}`).set("Authorization", auth.admin).send(body);

beforeAll(async () => {
  app = await startTestApp();
  await fx.ensureIndexes();
  await Promise.all([OrderCancellation.init(), LedgerEntry.init(), Wallet.init(), Order.init()]);
});
afterAll(stopTestApp);
beforeEach(async () => {
  clearCancellationPolicyCache();
  customer = await fx.createCustomer();
  seller = await fx.createSeller({ shopName: "Main Mart" });
  rider = await fx.createDelivery();
  adminUser = await fx.createAdmin();
  const tree = await fx.createCategoryTree();
  product = await fx.createProduct(seller, tree, { stock: STOCK });
  auth = {
    customer: bearer("customer", customer._id),
    seller: bearer("seller", seller._id),
    rider: bearer("delivery", rider._id),
    admin: bearer("admin", adminUser._id),
  };
});
afterEach(clearDatabase);

describe("pre-pickup self-cancellation", () => {
  it("shows eligibility, cancels, restores stock exactly once and needs no refund for unpaid COD", async () => {
    const order = await makeOrder({ quantity: 3 });
    expect(await stockNow()).toBe(STOCK - 3);

    const before = await view(order.orderId);
    expect(before.status).toBe(200);
    expect(before.headers["cache-control"]).toBe("no-store");
    expect(before.body.result.eligibility).toEqual(
      expect.objectContaining({ action: "SELF_CANCEL", canSelfCancel: true, stage: "PENDING_ACCEPTANCE" }),
    );
    expect(before.body.result.reasons.map((r) => r.code)).toContain("PLACED_BY_MISTAKE");

    const res = await submit(order.orderId, { mode: "CANCEL", reasonCode: "PLACED_BY_MISTAKE" });
    expect(res.status).toBe(201);
    expect(res.body.result.cancellation).toEqual(
      expect.objectContaining({ status: "CANCELLED", reasonCode: "PLACED_BY_MISTAKE" }),
    );
    expect(res.body.result.cancellation.refund.status).toBe("NOT_REQUIRED");
    expect(res.body.result.cancellation.inventory.status).toBe("RESTORED");

    const saved = await Order.findById(order._id).lean();
    expect(saved.status).toBe("cancelled");
    expect(saved.workflowStatus).toBe("CANCELLED");
    expect(saved.cancelledBy).toBe("customer");
    expect(saved.stockReservation.status).toBe("RELEASED");
    expect(await stockNow()).toBe(STOCK);

    // Repeat from "another device": existing result, nothing runs again.
    const again = await submit(order.orderId, { mode: "CANCEL", reasonCode: "OTHER" });
    expect(again.status).toBe(200);
    expect(again.body.result.duplicate).toBe(true);
    expect(await stockNow()).toBe(STOCK);
    expect(await OrderCancellation.countDocuments({ order: order._id })).toBe(1);

    const record = await OrderCancellation.findOne({ order: order._id }).lean();
    expect(record.auditLog.map((a) => a.action)).toEqual(
      expect.arrayContaining(["ORDER_CANCELLED", "INVENTORY_RESTORED", "REFUND_PLANNED"]),
    );
    expect(record.notifications.map((x) => x.event)).toContain("ORDER_CANCELLED");
    expect(record.notifications.every((x) => x.status === "SENT")).toBe(true);
  });

  it("concurrent submits cancel once and restore stock once", async () => {
    const order = await makeOrder({ quantity: 4 });
    const results = await Promise.all([
      submit(order.orderId, { mode: "CANCEL", reasonCode: "MODIFY_ORDER" }),
      submit(order.orderId, { mode: "CANCEL", reasonCode: "MODIFY_ORDER" }),
      submit(order.orderId, { mode: "CANCEL", reasonCode: "MODIFY_ORDER" }),
    ]);
    expect(results.every((r) => [200, 201].includes(r.status))).toBe(true);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await stockNow()).toBe(STOCK);
    expect(await OrderCancellation.countDocuments({ order: order._id })).toBe(1);
  });

  it("validates the reason and allows optional details for Other", async () => {
    const order = await makeOrder();
    expect((await submit(order.orderId, { mode: "CANCEL", reasonCode: "BOGUS" })).status).toBe(400);
    const res = await submit(order.orderId, { mode: "CANCEL", reasonCode: "OTHER", reasonText: "Ordered twice" });
    expect(res.status).toBe(201);
    expect(res.body.result.cancellation.reasonText).toBe("Ordered twice");
  });

  it("refunds a wallet redemption to the wallet exactly once", async () => {
    const order = await makeOrder({
      paymentBreakdown: { productSubtotal: 165, deliveryFeeCharged: 30, grandTotal: 160, walletAmount: 40, walletNettedInGrandTotal: true },
      pricing: { subtotal: 165, deliveryFee: 30, total: 160, walletAmount: 40 },
    });
    const res = await submit(order.orderId, { mode: "CANCEL", reasonCode: "BETTER_PRICE" });
    expect(res.status).toBe(201);
    expect(res.body.result.cancellation.refund).toEqual(
      expect.objectContaining({ status: "SUCCESSFUL", amount: 40, paidWallet: 40, paidGateway: 0 }),
    );
    expect(await customerWalletBalance()).toBe(40);

    // Re-running processing (reconcile job / retry) never pays twice.
    const { processCancellation } = await import("../../app/services/cancellation/orderCancellationService.js");
    const record = await OrderCancellation.findOne({ order: order._id });
    await processCancellation(record._id);
    expect(await customerWalletBalance()).toBe(40);
  });

  it("refunds a captured online payment and marks the order refunded", async () => {
    await creditWallet({ ownerType: "ADMIN", ownerId: null, amount: 1000 });
    const order = await makeOrder({
      paymentMode: "ONLINE",
      paymentStatus: "PAID",
      financeFlags: { onlinePaymentCaptured: true },
    });
    const res = await submit(order.orderId, { mode: "CANCEL", reasonCode: "PAYMENT_ISSUE" });
    expect(res.status).toBe(201);
    const refund = res.body.result.cancellation.refund;
    expect(refund.status).toBe("SUCCESSFUL");
    expect(refund.amount).toBe(200);
    expect(refund.allocations).toEqual([expect.objectContaining({ source: "GATEWAY", destination: "WALLET", amount: 200, status: "SUCCESSFUL" })]);
    expect(await customerWalletBalance()).toBe(200);
    const saved = await Order.findById(order._id).lean();
    expect(saved.paymentStatus).toBe("REFUNDED");
    expect(saved.financeFlags.onlineRefundApplied).toBe(true);
    expect(saved.cancellation.refundStatus).toBe("SUCCESSFUL");
  });

  it("applies configured fees after acceptance and blocks a disabled stage", async () => {
    await creditWallet({ ownerType: "ADMIN", ownerId: null, amount: 1000 });
    const put = await request(app)
      .put("/api/cancellations/admin/policy")
      .set("Authorization", auth.admin)
      .send({ cancellationFeeAfterAcceptance: 15, refundDeliveryFeeBeforePickup: false, selfCancelStages: { RIDER_ASSIGNED: false } });
    expect(put.status).toBe(200);
    expect(put.body.result.policy.selfCancelStages.RIDER_ASSIGNED).toBe(false);
    expect(put.body.result.policy.selfCancelStages.PENDING_ACCEPTANCE).toBe(true);

    const accepted = await makeOrder({
      workflowStatus: "DELIVERY_SEARCH",
      status: "confirmed",
      paymentMode: "ONLINE",
      paymentStatus: "PAID",
      financeFlags: { onlinePaymentCaptured: true },
    });
    const preview = (await view(accepted.orderId)).body.result.eligibility;
    expect(preview.refundPreview.deductions).toEqual(expect.objectContaining({ deliveryFee: 30, cancellationFee: 15, total: 45 }));
    expect(preview.refundPreview.refundable).toBe(155);
    expect(preview.specialConditions.join(" ")).toMatch(/Delivery fee/);

    const res = await submit(accepted.orderId, { mode: "CANCEL", reasonCode: "DELIVERY_TOO_LONG" });
    expect(res.status).toBe(201);
    expect(res.body.result.cancellation.refund.amount).toBe(155);

    const assigned = await makeOrder({ workflowStatus: "DELIVERY_ASSIGNED", status: "confirmed", deliveryBoy: rider._id });
    const blocked = await submit(assigned.orderId, { mode: "CANCEL", reasonCode: "OTHER" });
    expect(blocked.status).toBe(409);
    expect(blocked.body.result.eligibility.action).toBe("CONTACT_SUPPORT");
    expect((await Order.findById(assigned._id).lean()).status).toBe("confirmed");
  });

  it("an accepted rider is told to stop, and a cancelled order can no longer be accepted", async () => {
    const assigned = await makeOrder({ workflowStatus: "DELIVERY_ASSIGNED", status: "confirmed", deliveryBoy: rider._id });
    const res = await submit(assigned.orderId, { mode: "CANCEL", reasonCode: "INCORRECT_ADDRESS" });
    expect(res.status).toBe(201);
    const record = await OrderCancellation.findOne({ order: assigned._id }).lean();
    expect(record.notifications.map((x) => x.event)).toContain("RIDER_STOP_PICKUP");

    const searching = await makeOrder({ workflowStatus: "DELIVERY_SEARCH", status: "confirmed" });
    await submit(searching.orderId, { mode: "CANCEL", reasonCode: "OTHER" });
    const accept = await request(app).put(`/api/orders/accept/${searching.orderId}`).set("Authorization", auth.rider);
    expect(accept.status).toBe(409);
    expect((await Order.findById(searching._id).lean()).deliveryBoy).toBeUndefined();
  });

  it("pickup committed first turns a direct cancel into a request", async () => {
    const order = await makeOrder({ workflowStatus: "PICKUP_READY", status: "confirmed", deliveryBoy: rider._id });
    // Rider confirms pickup between the customer opening the popup and confirming.
    await Order.updateOne({ _id: order._id }, { $set: { workflowStatus: "OUT_FOR_DELIVERY", status: "out_for_delivery", pickupConfirmedAt: new Date() } });
    const res = await submit(order.orderId, { mode: "CANCEL", reasonCode: "OTHER" });
    expect(res.status).toBe(409);
    expect(res.body.result.code).toBe("REQUEST_REQUIRED");
    expect((await Order.findById(order._id).lean()).status).toBe("out_for_delivery");
    expect(await stockNow()).toBe(STOCK - 3);
  });
});

describe("post-pickup cancellation request", () => {
  async function pickedUp(overrides = {}) {
    return makeOrder({
      workflowStatus: "OUT_FOR_DELIVERY",
      status: "out_for_delivery",
      deliveryBoy: rider._id,
      pickupConfirmedAt: new Date(),
      ...overrides,
    });
  }

  it("request → approve → rider return → store inspection restores only sellable units", async () => {
    const order = await pickedUp({ quantity: 3 });
    const eligibility = (await view(order.orderId)).body.result.eligibility;
    expect(eligibility).toEqual(expect.objectContaining({ action: "REQUEST", canRequest: true, canSelfCancel: false }));

    const req1 = await submit(order.orderId, { mode: "REQUEST", reasonCode: "DELIVERY_TOO_LONG" });
    expect(req1.status).toBe(201);
    expect(req1.body.result.cancellation.status).toBe("REQUESTED");
    // The order is NOT cancelled while under review.
    expect((await Order.findById(order._id).lean()).status).toBe("out_for_delivery");
    const record = await OrderCancellation.findOne({ order: order._id }).lean();
    expect(record.notifications.map((x) => x.event)).toContain("CANCELLATION_REQUESTED");

    const list = await request(app).get("/api/cancellations/admin?status=REQUESTED").set("Authorization", auth.admin);
    expect(list.status).toBe(200);
    expect(list.body.result.items.map((i) => i.orderId)).toContain(order.orderId);

    const approved = await adminPost(`/${record._id}/approve`, { note: "Customer unreachable" });
    expect(approved.status).toBe(200);
    expect(approved.body.result).toEqual(expect.objectContaining({ status: "APPROVED" }));
    expect(approved.body.result.returnLeg.status).toBe("RETURN_TO_STORE");
    expect(approved.body.result.inventory.status).toBe("AWAITING_RETURN");
    expect(approved.body.result.notifications.map((x) => x.event)).toEqual(
      expect.arrayContaining(["CANCELLATION_APPROVED", "RIDER_RETURN_PARCEL"]),
    );
    const cancelledOrder = await Order.findById(order._id).lean();
    expect(cancelledOrder.status).toBe("cancelled");
    // Parcel is with the rider: nothing back on sale yet.
    expect(await stockNow()).toBe(STOCK - 3);

    // Delivery OTP can no longer complete the order.
    const otp = await request(app)
      .post(`/api/orders/workflow/${order.orderId}/otp/verify`)
      .set("Authorization", auth.rider)
      .send({ code: "1234" });
    expect(otp.status).toBeGreaterThanOrEqual(400);

    const tasks = await request(app).get("/api/cancellations/rider/returns").set("Authorization", auth.rider);
    expect(tasks.body.result.items.map((t) => t.orderId)).toEqual([order.orderId]);

    // Seller cannot inspect before the parcel is back.
    const early = await request(app)
      .post(`/api/cancellations/seller/${record._id}/inspection`)
      .set("Authorization", auth.seller)
      .send({ items: [{ itemIndex: 0, sellableQty: 3 }] });
    expect(early.status).toBe(409);

    const ret = await request(app)
      .post(`/api/cancellations/rider/returns/${record._id}/confirm`)
      .set("Authorization", auth.rider)
      .send({ note: "Handed to counter" });
    expect(ret.status).toBe(200);
    expect(ret.body.result.returnLeg.status).toBe("RETURNED_TO_STORE");

    const sellerList = await request(app).get("/api/cancellations/seller").set("Authorization", auth.seller);
    expect(sellerList.body.result.awaitingInspection.map((c) => c.orderId)).toContain(order.orderId);

    const bad = await request(app)
      .post(`/api/cancellations/seller/${record._id}/inspection`)
      .set("Authorization", auth.seller)
      .send({ items: [{ itemIndex: 0, sellableQty: 2 }] });
    expect(bad.status).toBe(400);

    const inspect = await request(app)
      .post(`/api/cancellations/seller/${record._id}/inspection`)
      .set("Authorization", auth.seller)
      .send({ items: [{ itemIndex: 0, sellableQty: 2, damagedQty: 1 }], note: "One pack torn" });
    expect(inspect.status).toBe(200);
    expect(inspect.body.result.inventory.status).toBe("INSPECTED");
    expect(await stockNow()).toBe(STOCK - 1);

    // Inspecting again changes nothing.
    await request(app)
      .post(`/api/cancellations/seller/${record._id}/inspection`)
      .set("Authorization", auth.seller)
      .send({ items: [{ itemIndex: 0, sellableQty: 3 }] });
    expect(await stockNow()).toBe(STOCK - 1);

    const final = await OrderCancellation.findById(record._id).lean();
    expect(final.refund.status).toBe("NOT_REQUIRED"); // unpaid COD
    expect(final.settlement.cod.status).toBe("NOT_REQUIRED");
    expect(final.settlement.seller.status).toBe("NOT_REQUIRED");
  });

  it("rejection needs a reason and leaves the order on its way", async () => {
    const order = await pickedUp();
    await submit(order.orderId, { mode: "REQUEST", reasonCode: "BETTER_PRICE" });
    const record = await OrderCancellation.findOne({ order: order._id }).lean();
    expect((await adminPost(`/${record._id}/reject`, {})).status).toBe(400);
    const rejected = await adminPost(`/${record._id}/reject`, { reason: "Rider is at your door" });
    expect(rejected.status).toBe(200);
    expect(rejected.body.result.status).toBe("REJECTED");
    expect((await Order.findById(order._id).lean()).status).toBe("out_for_delivery");
    const customerView = (await view(order.orderId)).body.result;
    expect(customerView.cancellation.decisionNote).toBe("Rider is at your door");
    expect(customerView.eligibility.action).toBe("CONTACT_SUPPORT");
    // A decided request cannot be approved afterwards.
    expect((await adminPost(`/${record._id}/approve`)).status).toBe(409);
  });

  it("can be withdrawn while pending, not after approval", async () => {
    const order = await pickedUp();
    await submit(order.orderId, { mode: "REQUEST", reasonCode: "OTHER" });
    const w = await request(app).post(`/api/cancellations/orders/${order.orderId}/withdraw`).set("Authorization", auth.customer);
    expect(w.status).toBe(200);
    expect(w.body.result.cancellation.status).toBe("WITHDRAWN");

    // A new request reuses the same record.
    expect((await submit(order.orderId, { mode: "REQUEST", reasonCode: "OTHER" })).status).toBe(201);
    const record = await OrderCancellation.findOne({ order: order._id }).lean();
    await adminPost(`/${record._id}/approve`);
    const late = await request(app).post(`/api/cancellations/orders/${order.orderId}/withdraw`).set("Authorization", auth.customer);
    expect(late.status).toBe(409);
    expect(await OrderCancellation.countDocuments({ order: order._id })).toBe(1);
  });

  it("a request still pending at delivery moves to the dispute workflow", async () => {
    const order = await pickedUp();
    await submit(order.orderId, { mode: "REQUEST", reasonCode: "OTHER" });
    await Order.updateOne({ _id: order._id }, { $set: { workflowStatus: "DELIVERED", status: "delivered", deliveredAt: new Date() } });
    const record = await OrderCancellation.findOne({ order: order._id }).lean();

    const approve = await adminPost(`/${record._id}/approve`);
    expect(approve.status).toBe(409);
    expect(approve.body.result.code).toBe("TRANSFERRED");
    const after = await OrderCancellation.findById(record._id).lean();
    expect(after.status).toBe("TRANSFERRED");
    expect(after.disputeTicket).toBeTruthy();
    expect(await Ticket.countDocuments({ _id: after.disputeTicket })).toBe(1);
    expect((await Order.findById(order._id).lean()).status).toBe("delivered");

    // The delivery hook is idempotent.
    await onOrderDelivered(order._id);
    expect(await Ticket.countDocuments({})).toBe(1);
  });
});

describe("terminal states, admin cancellation, late payments", () => {
  it("delivered and cancelled orders are never cancelled again", async () => {
    const delivered = await makeOrder({ workflowStatus: "DELIVERED", status: "delivered", deliveredAt: new Date() });
    const e = (await view(delivered.orderId)).body.result.eligibility;
    expect(e.action).toBe("POST_DELIVERY");
    expect((await submit(delivered.orderId, { mode: "CANCEL", reasonCode: "OTHER" })).status).toBe(409);
    const adminTry = await request(app)
      .post(`/api/cancellations/admin/orders/${delivered.orderId}/cancel`)
      .set("Authorization", auth.admin)
      .send({ reason: "test" });
    expect(adminTry.status).toBe(409);
    expect((await Order.findById(delivered._id).lean()).status).toBe("delivered");
  });

  it("admin manual cancellation requires a reason, refunds in full and is audited", async () => {
    await creditWallet({ ownerType: "ADMIN", ownerId: null, amount: 1000 });
    await request(app).put("/api/cancellations/admin/policy").set("Authorization", auth.admin).send({ cancellationFeeAfterAcceptance: 20 });
    const order = await makeOrder({
      workflowStatus: "DELIVERY_ASSIGNED",
      status: "confirmed",
      deliveryBoy: rider._id,
      paymentMode: "ONLINE",
      paymentStatus: "PAID",
      financeFlags: { onlinePaymentCaptured: true },
    });
    const noReason = await request(app)
      .post(`/api/cancellations/admin/orders/${order.orderId}/cancel`)
      .set("Authorization", auth.admin)
      .send({});
    expect(noReason.status).toBe(400);

    const legacyStatusRoute = await request(app)
      .put(`/api/orders/status/${order.orderId}`)
      .set("Authorization", auth.admin)
      .send({ status: "cancelled" });
    expect(legacyStatusRoute.status).toBe(400);

    const res = await request(app)
      .post(`/api/cancellations/admin/orders/${order.orderId}/cancel`)
      .set("Authorization", auth.admin)
      .send({ reason: "Store closed unexpectedly" });
    expect(res.status).toBe(200);
    expect(res.body.result.type).toBe("ADMIN");
    expect(res.body.result.refund.amount).toBe(200);
    const audit = res.body.result.auditLog.find((a) => a.action === "ORDER_CANCELLED");
    expect(audit).toEqual(expect.objectContaining({ actorRole: "admin", orderStatusBefore: "DELIVERY_ASSIGNED", orderStatusAfter: "CANCELLED" }));
    expect(String(audit.actorId)).toBe(String(adminUser._id));
    expect(await stockNow()).toBe(STOCK);

    const again = await request(app)
      .post(`/api/cancellations/admin/orders/${order.orderId}/cancel`)
      .set("Authorization", auth.admin)
      .send({ reason: "again" });
    expect(again.status).toBe(409);
    expect(await customerWalletBalance()).toBe(200);

    const reports = await request(app).get("/api/cancellations/admin/reports").set("Authorization", auth.admin);
    expect(reports.status).toBe(200);
    expect(reports.body.result.total).toBe(1);
    expect(reports.body.result.byType.ADMIN).toBe(1);
  });

  it("a payment captured after cancellation is refunded without reactivating the order", async () => {
    await creditWallet({ ownerType: "ADMIN", ownerId: null, amount: 1000 });
    const order = await makeOrder({
      workflowStatus: "CREATED",
      status: "pending",
      paymentMode: "ONLINE",
      paymentStatus: "CREATED",
      stockReservation: { status: "RESERVED", reservedAt: new Date() },
    });
    const res = await submit(order.orderId, { mode: "CANCEL", reasonCode: "PAYMENT_ISSUE" });
    expect(res.status).toBe(201);
    expect(res.body.result.cancellation.refund.status).toBe("NOT_REQUIRED");

    // Late webhook: the gateway did take the money.
    const { handleOnlineOrderFinance } = await import("../../app/services/finance/orderFinanceService.js");
    await handleOnlineOrderFinance(order._id, { transactionId: "pay_late" });
    await onLatePaymentCapture(order._id);
    await onLatePaymentCapture(order._id); // repeated webhook

    const record = await OrderCancellation.findOne({ order: order._id }).lean();
    expect(record.refund.status).toBe("SUCCESSFUL");
    expect(record.refund.allocations).toEqual([expect.objectContaining({ source: "GATEWAY", amount: 200, status: "SUCCESSFUL" })]);
    expect(await customerWalletBalance()).toBe(200);
    const saved = await Order.findById(order._id).lean();
    expect(saved.status).toBe("cancelled");
    expect(saved.workflowStatus).toBe("CANCELLED");
  });

  it("a cancelled order cannot be reactivated through the status route, and riders cannot cancel", async () => {
    const order = await makeOrder();
    await submit(order.orderId, { mode: "CANCEL", reasonCode: "OTHER" });
    for (const status of ["confirmed", "delivered", "pending"]) {
      const res = await request(app)
        .put(`/api/orders/status/${order.orderId}`)
        .set("Authorization", auth.admin)
        .send({ status });
      expect(res.status).toBe(409);
    }
    const saved = await Order.findById(order._id).lean();
    expect(saved.status).toBe("cancelled");
    expect(saved.workflowStatus).toBe("CANCELLED");

    const assigned = await makeOrder({ workflowStatus: "DELIVERY_ASSIGNED", status: "confirmed", deliveryBoy: rider._id });
    const riderCancel = await request(app)
      .put(`/api/orders/status/${assigned.orderId}`)
      .set("Authorization", auth.rider)
      .send({ status: "cancelled" });
    expect(riderCancel.status).toBe(403);
    expect((await Order.findById(assigned._id).lean()).status).toBe("confirmed");
    expect(await stockNow()).toBe(STOCK - 3);
  });

  it("the customer list carries backend eligibility", async () => {
    const order = await makeOrder();
    const res = await request(app).get("/api/orders/my-orders").set("Authorization", auth.customer);
    const row = res.body.result.items.find((o) => o.orderId === order.orderId);
    expect(row.cancellationEligibility).toEqual(expect.objectContaining({ action: "SELF_CANCEL", canSelfCancel: true }));
  });

  it("only the owner can see or cancel an order", async () => {
    const order = await makeOrder();
    const other = await fx.createCustomer();
    const who = bearer("customer", other._id);
    expect((await view(order.orderId, who)).status).toBe(404);
    expect((await submit(order.orderId, { mode: "CANCEL", reasonCode: "OTHER" }, who)).status).toBe(404);
    expect((await request(app).get("/api/cancellations/admin").set("Authorization", auth.customer)).status).toBe(403);
  });
});
