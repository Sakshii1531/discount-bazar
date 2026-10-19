/**
 * API E2E — rider active assignments (resume / restore after back, background
 * or relaunch) and the optional one-active-order rule.
 */
import { jest } from "@jest/globals";
import request from "supertest";
import { startTestApp, stopTestApp, clearDatabase, bearer } from "./helpers/testApp.js";
import * as fx from "./helpers/fixtures.js";
import Order from "../../app/models/order.js";

jest.setTimeout(120000);

let app;
let n = 0;
let customer;
let seller;
let rider;
let rider2;
let auth;

async function makeOrder(overrides = {}) {
  n += 1;
  const order = await Order.create({
    orderId: `ORDACT${Date.now()}${n}`,
    customer: customer._id,
    seller: seller._id,
    items: [{ product: seller._id, name: "Milk", quantity: 1, price: 50 }],
    address: { name: "Asha", address: "12 MG Road", city: "Indore", phone: "9876500001" },
    workflowVersion: 2,
    workflowStatus: "DELIVERY_SEARCH",
    status: "confirmed",
    ...overrides,
  });
  return order.toObject();
}

const active = (who) => request(app).get("/api/delivery/active-orders").set("Authorization", who);

beforeAll(async () => {
  app = await startTestApp();
  await fx.ensureIndexes();
});
afterAll(stopTestApp);
beforeEach(async () => {
  customer = await fx.createCustomer();
  seller = await fx.createSeller({ shopName: "Main Mart", address: "1 Market St" });
  rider = await fx.createDelivery();
  rider2 = await fx.createDelivery();
  auth = { rider: bearer("delivery", rider._id), rider2: bearer("delivery", rider2._id) };
});
afterEach(async () => {
  delete process.env.RIDER_MAX_ACTIVE_ORDERS;
  await clearDatabase();
});

describe("GET /api/delivery/active-orders", () => {
  it("lists only the rider's in-progress orders, with the stage to restore", async () => {
    const toStore = await makeOrder({ deliveryBoy: rider._id, workflowStatus: "DELIVERY_ASSIGNED", assignedAt: new Date() });
    const atStore = await makeOrder({ deliveryBoy: rider._id, workflowStatus: "PICKUP_READY" });
    const enRoute = await makeOrder({ deliveryBoy: rider._id, workflowStatus: "OUT_FOR_DELIVERY", deliveryRiderStep: 3 });
    const atDoor = await makeOrder({ deliveryBoy: rider._id, workflowStatus: "OUT_FOR_DELIVERY", deliveryRiderStep: 4 });
    // Never active:
    await makeOrder({ deliveryBoy: rider._id, workflowStatus: "DELIVERED", status: "delivered" });
    await makeOrder({ deliveryBoy: rider._id, workflowStatus: "CANCELLED", status: "cancelled" });
    await makeOrder({ deliveryBoy: rider2._id, workflowStatus: "DELIVERY_ASSIGNED" });
    await makeOrder(); // unassigned offer

    const res = await active(auth.rider);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const byId = Object.fromEntries(res.body.result.orders.map((o) => [o.orderId, o]));
    expect(Object.keys(byId).sort()).toEqual([toStore, atStore, enRoute, atDoor].map((o) => o.orderId).sort());
    expect(byId[toStore.orderId]).toEqual(
      expect.objectContaining({
        kind: "delivery",
        stage: "HEADING_TO_STORE",
        store: { name: "Main Mart", address: "1 Market St" },
        customer: { name: "Asha", address: "12 MG Road, Indore" },
        resumePath: `/delivery/order-details/${toStore.orderId}`,
      }),
    );
    expect(byId[atStore.orderId].stage).toBe("AT_STORE");
    expect(byId[enRoute.orderId]).toEqual(expect.objectContaining({ stage: "HEADING_TO_CUSTOMER", store: null }));
    expect(byId[atDoor.orderId].stage).toBe("AT_CUSTOMER");
    // No phone numbers in the list.
    expect(JSON.stringify(res.body.result)).not.toContain("9876500001");
    expect(res.body.result.canAcceptMore).toBe(true);
  });

  it("includes accepted return legs and handles legacy orders", async () => {
    const ret = await makeOrder({
      workflowStatus: "DELIVERED",
      status: "delivered",
      returnStatus: "return_in_transit",
      returnDeliveryBoy: rider._id,
    });
    const legacy = await makeOrder({ workflowVersion: 1, workflowStatus: undefined, status: "out_for_delivery", deliveryBoy: rider._id });
    const res = await active(auth.rider);
    const byId = Object.fromEntries(res.body.result.orders.map((o) => [o.orderId, o]));
    expect(byId[ret.orderId]).toEqual(expect.objectContaining({ kind: "return", stage: "RETURN_TO_STORE" }));
    expect(byId[legacy.orderId]).toEqual(expect.objectContaining({ kind: "delivery", stage: "HEADING_TO_CUSTOMER" }));
  });

  it("drops an order the moment it is reassigned, cancelled or completed", async () => {
    const order = await makeOrder({ deliveryBoy: rider._id, workflowStatus: "DELIVERY_ASSIGNED" });
    expect((await active(auth.rider)).body.result.orders).toHaveLength(1);

    await Order.updateOne({ _id: order._id }, { $set: { deliveryBoy: rider2._id }, $inc: { assignmentVersion: 1 } });
    expect((await active(auth.rider)).body.result.orders).toEqual([]);
    expect((await active(auth.rider2)).body.result.orders.map((o) => o.orderId)).toEqual([order.orderId]);

    await Order.updateOne({ _id: order._id }, { $set: { workflowStatus: "CANCELLED", status: "cancelled" } });
    expect((await active(auth.rider2)).body.result.orders).toEqual([]);
  });

  it("is read-only — listing and reopening never change the order", async () => {
    const order = await makeOrder({ deliveryBoy: rider._id, workflowStatus: "PICKUP_READY", deliveryRiderStep: 2 });
    const before = await Order.findById(order._id).lean();
    await active(auth.rider);
    await active(auth.rider);
    await request(app).get(`/api/orders/details/${order.orderId}`).set("Authorization", auth.rider);
    const after = await Order.findById(order._id).lean();
    expect(after.workflowStatus).toBe(before.workflowStatus);
    expect(after.deliveryRiderStep).toBe(before.deliveryRiderStep);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });

  it("persists 'arrived at customer' so a relaunch restores the completion step", async () => {
    const order = await makeOrder({ deliveryBoy: rider._id, workflowStatus: "OUT_FOR_DELIVERY", deliveryRiderStep: 3 });
    const adv = await request(app)
      .post(`/api/orders/workflow/${order.orderId}/rider/advance-ui`)
      .set("Authorization", auth.rider);
    expect(adv.status).toBe(200);
    // Repeating it is harmless.
    await request(app).post(`/api/orders/workflow/${order.orderId}/rider/advance-ui`).set("Authorization", auth.rider);
    const res = await active(auth.rider);
    expect(res.body.result.orders[0].stage).toBe("AT_CUSTOMER");
    expect((await Order.findById(order._id).lean()).workflowStatus).toBe("OUT_FOR_DELIVERY");
  });
});

describe("one-active-order rule (RIDER_MAX_ACTIVE_ORDERS=1)", () => {
  it("refuses a second acceptance but keeps idempotent re-accepts working", async () => {
    process.env.RIDER_MAX_ACTIVE_ORDERS = "1";
    const first = await makeOrder();
    const second = await makeOrder();

    const ok = await request(app).put(`/api/orders/accept/${first.orderId}`).set("Authorization", auth.rider);
    expect(ok.status).toBe(200);
    const state = await active(auth.rider);
    expect(state.body.result).toEqual(expect.objectContaining({ maxActiveOrders: 1, canAcceptMore: false }));

    // Re-accepting the same order (lost response) is not blocked.
    const again = await request(app).put(`/api/orders/accept/${first.orderId}`).set("Authorization", auth.rider);
    expect(again.status).toBe(200);

    const blocked = await request(app).put(`/api/orders/accept/${second.orderId}`).set("Authorization", auth.rider);
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toMatch(/finish your current delivery/i);
    expect((await Order.findById(second._id).lean()).deliveryBoy).toBeFalsy();

    // Once the first order is finished, the rider can take the next one.
    await Order.updateOne({ _id: first._id }, { $set: { workflowStatus: "DELIVERED", status: "delivered" } });
    const next = await request(app).put(`/api/orders/accept/${second.orderId}`).set("Authorization", auth.rider);
    expect(next.status).toBe(200);
  });

  it("does nothing when no limit is configured (current behaviour)", async () => {
    const a = await makeOrder();
    const b = await makeOrder();
    expect((await request(app).put(`/api/orders/accept/${a.orderId}`).set("Authorization", auth.rider)).status).toBe(200);
    expect((await request(app).put(`/api/orders/accept/${b.orderId}`).set("Authorization", auth.rider)).status).toBe(200);
    expect((await active(auth.rider)).body.result.orders).toHaveLength(2);
  });
});
