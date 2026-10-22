/**
 * API E2E — checkout money integrity:
 *  - wallet money redeemed at checkout reduces what the customer still pays
 *    (cash collected / online charge); it must never be charged twice.
 *  - a client-supplied `discountTotal` without a coupon is ignored.
 */
import { jest } from "@jest/globals";
import request from "supertest";
import { startTestApp, stopTestApp } from "./helpers/testApp.js";
import { seedWorld } from "./helpers/world.js";
import { AT_CUSTOMER } from "./helpers/flows.js";
import Customer from "../../app/models/customer.js";
import Order from "../../app/models/order.js";

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
const milk = () => [{ product: String(ctx.milk._id), quantity: 2 }];
const previewTotal = async () =>
  (await request(app).post("/api/orders/checkout/preview").set("Authorization", ctx.auth.customer).send({ items: milk(), address: ADDRESS }))
    .body.result.breakdown.grandTotal;
const placeOrder = (body) =>
  request(app)
    .post("/api/orders")
    .set("Authorization", ctx.auth.customer)
    .send({ items: milk(), address: ADDRESS, timeSlot: "now", ...body });

describe("checkout money integrity", () => {
  it("subtracts the redeemed wallet amount from what is collected on COD", async () => {
    const total = await previewTotal();
    expect(total).toBeGreaterThan(20);

    const res = await placeOrder({ paymentMode: "COD", walletAmount: 20 });
    expect(res.status).toBe(201);

    const order = await Order.findOne({ orderId: res.body.result.order.orderId }).lean();
    expect(order.paymentBreakdown.grandTotal).toBe(total - 20);
    const customer = await Customer.findById(ctx.customer._id).lean();
    expect(customer.walletBalance).toBe(980);
  });

  it("ignores a discountTotal sent without a coupon", async () => {
    const total = await previewTotal();

    const res = await placeOrder({ paymentMode: "COD", discountTotal: total - 1 });
    expect(res.status).toBe(201);

    const order = await Order.findOne({ orderId: res.body.result.order.orderId }).lean();
    expect(order.paymentBreakdown.grandTotal).toBe(total);
    expect(Number(order.paymentBreakdown.discountTotal || 0)).toBe(0);
  });
});
