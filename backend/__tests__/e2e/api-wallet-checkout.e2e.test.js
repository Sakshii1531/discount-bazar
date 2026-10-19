/**
 * API E2E — an order fully paid from the wallet ("WALLET", as checkout sends
 * it) is accepted even when COD/online are switched off, but WALLET can't be
 * used for an order the wallet doesn't cover.
 */
import { jest } from "@jest/globals";
import request from "supertest";
import { startTestApp, stopTestApp } from "./helpers/testApp.js";
import { seedWorld } from "./helpers/world.js";
import { AT_CUSTOMER } from "./helpers/flows.js";
import Customer from "../../app/models/customer.js";

jest.setTimeout(180000);

let app;
let ctx;
beforeAll(async () => {
  app = await startTestApp();
  ctx = await seedWorld();
  await Customer.updateOne({ _id: ctx.customer._id }, { $set: { walletBalance: 1000 } });
});
afterAll(stopTestApp);

const ADDRESS = { name: "Main Customer", address: "12 MG Road, Indore", city: "Indore", phone: "9999999999", location: AT_CUSTOMER };
const bread = () => [{ product: String(ctx.bread._id), quantity: 1 }];
const orderTotal = async () =>
  (await request(app).post("/api/orders/checkout/preview").set("Authorization", ctx.auth.customer).send({ items: bread(), address: ADDRESS }))
    .body.result.breakdown.grandTotal;
const placeOrder = (body) =>
  request(app)
    .post("/api/orders")
    .set("Authorization", ctx.auth.customer)
    .send({ items: bread(), address: ADDRESS, timeSlot: "now", ...body });

describe("wallet-paid checkout", () => {
  it("accepts a WALLET order the wallet covers, even with COD off", async () => {
    const off = await request(app).put("/api/admin/settings/delivery").set("Authorization", ctx.auth.admin).send({ codEnabled: false });
    expect(off.status).toBe(200);

    const total = await orderTotal();
    const res = await placeOrder({ paymentMode: "WALLET", walletAmount: total });
    expect(res.status).toBe(201);
    expect(res.body.result.order.paymentMode).toBe("WALLET");
  });

  it("refuses WALLET when the wallet amount does not cover the order", async () => {
    const total = await orderTotal();
    const res = await placeOrder({ paymentMode: "WALLET", walletAmount: Math.max(1, total - 10) });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/wallet balance does not cover this order/);
  });

  it("still refuses a COD order while COD is off", async () => {
    const res = await placeOrder({ paymentMode: "COD" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Cash on Delivery is currently unavailable/);
  });
});
