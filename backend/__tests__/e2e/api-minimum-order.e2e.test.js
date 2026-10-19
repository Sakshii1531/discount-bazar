/**
 * API E2E — the admin-configured minimum order value is enforced by the
 * server on the eligible single-seller merchandise subtotal (after product
 * and coupon discounts, before delivery/fees/tax).
 */
import { jest } from "@jest/globals";
import request from "supertest";
import { startTestApp, stopTestApp } from "./helpers/testApp.js";
import { seedWorld } from "./helpers/world.js";
import { AT_CUSTOMER } from "./helpers/flows.js";
import Order from "../../app/models/order.js";

jest.setTimeout(180000);

let app;
let ctx;
beforeAll(async () => {
  app = await startTestApp();
  ctx = await seedWorld({ minOrderValue: 99 });
});
afterAll(stopTestApp);

const ADDRESS = { name: "Main Customer", address: "12 MG Road, Indore", city: "Indore", phone: "9999999999", location: AT_CUSTOMER };
const bread = (quantity = 1) => ({ product: String(ctx.bread._id), quantity }); // ₹45 each (MRP ₹50)
const milk = (quantity = 1) => ({ product: String(ctx.milk._id), quantity }); // ₹55 each (MRP ₹60)
const setMinimum = (body, auth = ctx.auth.admin) =>
  request(app).put("/api/admin/settings/delivery").set("Authorization", auth).send(body);
const preview = (items, extra = {}) =>
  request(app).post("/api/orders/checkout/preview").set("Authorization", ctx.auth.customer).send({ items, address: ADDRESS, ...extra });
const placeOrder = (items, { idempotencyKey, ...extra } = {}) => {
  const req = request(app).post("/api/orders").set("Authorization", ctx.auth.customer);
  if (idempotencyKey) req.set("Idempotency-Key", idempotencyKey);
  return req.send({ items, address: ADDRESS, paymentMode: "COD", timeSlot: "now", ...extra });
};

describe("configuration", () => {
  it("the storefront reads the live minimum from public settings", async () => {
    const res = await request(app).get("/api/settings");
    expect(res.body.result).toMatchObject({ minOrderValue: 99, minOrderValueAfterCoupon: true });
  });

  it("only an admin can change it, and invalid values are refused", async () => {
    expect((await setMinimum({ minOrderValue: 150 }, ctx.auth.customer)).status).toBe(403);
    expect((await setMinimum({ minOrderValue: -1 })).status).toBe(400);
    expect((await setMinimum({ minOrderValue: "abc" })).status).toBe(400);
    expect((await setMinimum({ minOrderValue: 99 })).status).toBe(200);
  });
});

describe("checkout preview reports the remaining amount", () => {
  it.each([
    [1, 45, 54],
    [2, 90, 9],
  ])("%i bread → eligible ₹%i, add ₹%i more", async (quantity, eligibleSubtotal, remainingAmount) => {
    const res = await preview([bread(quantity)]);
    expect(res.status).toBe(200);
    expect(res.body.result.minimumOrder).toEqual({ minOrderValue: 99, eligibleSubtotal, remainingAmount, isMet: false });
  });

  it("delivery charges do not count towards the minimum", async () => {
    const res = await preview([bread(2)]);
    expect(res.body.result.breakdown.grandTotal).toBeGreaterThanOrEqual(99);
    expect(res.body.result.minimumOrder.isMet).toBe(false);
  });

  it("is met once the eligible subtotal reaches the minimum", async () => {
    const res = await preview([bread(1), milk(1)]);
    expect(res.body.result.minimumOrder).toEqual({ minOrderValue: 99, eligibleSubtotal: 100, remainingAmount: 0, isMet: true });
  });
});

describe("placing an order", () => {
  it("is refused below the minimum with the amounts to show the customer", async () => {
    const res = await placeOrder([bread(2)]);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Add ₹9 more to place your order.");
    expect(res.body.result).toEqual({ code: "MIN_ORDER_VALUE_NOT_MET", minOrderValue: 99, eligibleSubtotal: 90, remainingAmount: 9 });
  });

  it("ignores client-sent prices and uses server pricing", async () => {
    const res = await placeOrder([{ ...bread(2), price: 500 }]);
    expect(res.status).toBe(400);
    expect(res.body.result.eligibleSubtotal).toBe(90);
  });

  it("a coupon's merchandise discount lowers the eligible subtotal", async () => {
    const coupon = await request(app)
      .post("/api/admin/coupons")
      .set("Authorization", ctx.auth.admin)
      .send({ code: "TENOFF", couponType: "generic", discountType: "fixed", discountValue: 10, validFrom: "2026-01-01", validTill: "2099-01-01" });
    expect(coupon.status).toBe(201);
    const res = await placeOrder([bread(1), milk(1)], { couponCode: "TENOFF" }); // ₹100 − ₹10 = ₹90
    expect(res.status).toBe(400);
    expect(res.body.result).toMatchObject({ eligibleSubtotal: 90, remainingAmount: 9 });

    expect((await setMinimum({ minOrderValueAfterCoupon: false })).status).toBe(200);
    const ignored = await preview([bread(1), milk(1)], { couponCode: "TENOFF" });
    expect(ignored.body.result.minimumOrder).toMatchObject({ eligibleSubtotal: 100, isMet: true });
    expect((await setMinimum({ minOrderValueAfterCoupon: true })).status).toBe(200);
  });

  it("is accepted at or above the minimum", async () => {
    const res = await placeOrder([bread(1), milk(1)]);
    expect(res.status).toBe(201);
  });

  it("a refused request can be retried with the same idempotency key, without duplicates", async () => {
    const idempotencyKey = "min-order-retry-0001-abcdef-0123456789ab";
    expect((await placeOrder([bread(1)], { idempotencyKey })).status).toBe(400);

    expect((await setMinimum({ minOrderValue: 40 })).status).toBe(200);
    const first = await placeOrder([bread(1)], { idempotencyKey });
    expect(first.status).toBe(201);
    const retry = await placeOrder([bread(1)], { idempotencyKey });
    expect(retry.status).toBe(200);
    expect(retry.body.result.order.orderId).toBe(first.body.result.order.orderId);
    expect(await Order.countDocuments({ "placement.idempotencyKey": idempotencyKey })).toBeLessThanOrEqual(1);
  });

  it("raising the minimum later does not touch orders already placed", async () => {
    const before = await Order.countDocuments({ customer: ctx.customer._id });
    expect((await setMinimum({ minOrderValue: 500 })).status).toBe(200);
    expect(await Order.countDocuments({ customer: ctx.customer._id })).toBe(before);
    const res = await placeOrder([bread(1), milk(1)]);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Add ₹400 more to place your order.");
  });
});
