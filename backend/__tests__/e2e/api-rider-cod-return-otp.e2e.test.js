/**
 * API E2E — regressions for two rider flows that used to fail at runtime:
 *  - POST /api/delivery/cod/pay crashed with "reconcileCodCash is not defined".
 *  - POST /api/orders/workflow/:orderId/return-otp/request referenced an
 *    undefined `order`, so the customer never got the pickup OTP, and it did
 *    not check that the caller was the assigned return rider.
 */
import { jest } from "@jest/globals";
import request from "supertest";
import { startTestApp, stopTestApp, clearDatabase, bearer } from "./helpers/testApp.js";
import * as fx from "./helpers/fixtures.js";
import { seedWorld } from "./helpers/world.js";
import { createReturnableProduct, placeAndDeliverOrder, latestOtp, AT_CUSTOMER } from "./helpers/flows.js";
import Order from "../../app/models/order.js";

jest.setTimeout(180000);

let app;
let ctx;
beforeAll(async () => {
  app = await startTestApp();
});
beforeEach(async () => {
  ctx = await seedWorld();
});
afterEach(async () => {
  jest.restoreAllMocks();
  await clearDatabase();
});
afterAll(stopTestApp);

describe("rider submits collected COD cash", () => {
  it("settles the collected cash against the order", async () => {
    const orderId = await placeAndDeliverOrder(app, ctx, ctx.milk._id);
    const order = await Order.findOne({ orderId }).lean();

    const collect = await request(app)
      .post(`/api/orders/${order._id}/cod/mark-collected`)
      .set("Authorization", ctx.auth.delivery)
      .send({});
    expect([200, 409]).toContain(collect.status);

    const pending = Number(
      (await Order.findOne({ orderId }).lean()).paymentBreakdown?.codPendingAmount || 0,
    );
    expect(pending).toBeGreaterThan(0);

    const res = await request(app)
      .post("/api/delivery/cod/pay")
      .set("Authorization", ctx.auth.delivery)
      .send({});
    expect(res.status).toBe(200);

    const after = await Order.findOne({ orderId }).lean();
    expect(after.paymentBreakdown.codPendingAmount).toBe(0);
  });
});

describe("return pickup OTP", () => {
  async function returnAssignedToRider() {
    process.env.RETURN_ELIGIBILITY_DELAY_MINUTES = "0";
    process.env.RETURN_WINDOW_MINUTES = "10080";
    const shirt = await createReturnableProduct(ctx);
    const orderId = await placeAndDeliverOrder(app, ctx, shirt._id);
    const steps = [
      ["post", `/api/orders/${orderId}/returns`, ctx.auth.customer, { items: [{ itemIndex: 0, quantity: 1 }], reason: "Damaged Product" }],
      ["put", `/api/orders/returns/${orderId}/approve`, ctx.auth.seller, {}],
      ["put", `/api/orders/returns/${orderId}/assign-delivery`, ctx.auth.seller, { deliveryBoyId: String(ctx.rider._id) }],
      ["put", `/api/orders/returns/${orderId}/accept-pickup`, ctx.auth.delivery, {}],
    ];
    for (const [method, url, auth, body] of steps) {
      const res = await request(app)[method](url).set("Authorization", auth).send(body);
      expect(res.status).toBeLessThan(300);
    }
    return orderId;
  }

  it("notifies the customer without failing", async () => {
    const orderId = await returnAssignedToRider();
    const warn = jest.spyOn(console, "warn");

    const res = await request(app)
      .post(`/api/orders/workflow/${orderId}/return-otp/request`)
      .set("Authorization", ctx.auth.delivery)
      .send(AT_CUSTOMER);

    expect(res.status).toBe(200);
    expect(await latestOtp(orderId, "return_pickup")).toMatch(/^\d{4}$/);
    // The SMS step may warn (no gateway in tests); the socket step must not.
    const failures = warn.mock.calls.filter((args) =>
      String(args[0]).includes("[requestReturnPickupOtp] Notification failed"),
    );
    expect(failures).toEqual([]);
  });

  it("refuses a rider who is not assigned to the return", async () => {
    const orderId = await returnAssignedToRider();
    const stranger = await fx.createDelivery({ name: "Other Rider" });
    const strangerAuth = bearer("delivery", stranger._id);

    const requestRes = await request(app)
      .post(`/api/orders/workflow/${orderId}/return-otp/request`)
      .set("Authorization", strangerAuth)
      .send(AT_CUSTOMER);
    expect(requestRes.status).toBe(400);

    await request(app)
      .post(`/api/orders/workflow/${orderId}/return-otp/request`)
      .set("Authorization", ctx.auth.delivery)
      .send(AT_CUSTOMER);
    const otp = await latestOtp(orderId, "return_pickup");

    const verifyRes = await request(app)
      .post(`/api/orders/workflow/${orderId}/return-otp/verify`)
      .set("Authorization", strangerAuth)
      .send({ otp });
    expect(verifyRes.status).toBe(403);
    expect((await Order.findOne({ orderId }).lean()).returnStatus).toBe("return_pickup_assigned");
  });
});
