/**
 * API E2E — admin can switch Online payment / Cash on Delivery on and off,
 * and the server enforces it (not just the checkout screen).
 */
import { jest } from "@jest/globals";
import request from "supertest";
import { startTestApp, stopTestApp } from "./helpers/testApp.js";
import { seedWorld } from "./helpers/world.js";
import { AT_CUSTOMER } from "./helpers/flows.js";

jest.setTimeout(180000);

let app;
let ctx;
beforeAll(async () => {
  app = await startTestApp();
  ctx = await seedWorld();
});
afterAll(stopTestApp);

const ADDRESS = { name: "Main Customer", address: "12 MG Road, Indore", city: "Indore", phone: "9999999999", location: AT_CUSTOMER };

const setMethods = (body) =>
  request(app).put("/api/admin/settings/delivery").set("Authorization", ctx.auth.admin).send(body);
const placeOrder = (paymentMode) =>
  request(app)
    .post("/api/orders")
    .set("Authorization", ctx.auth.customer)
    .send({ items: [{ product: String(ctx.bread._id), quantity: 1 }], address: ADDRESS, paymentMode, timeSlot: "now" });

describe("payment method switches", () => {
  it("both methods are on by default", async () => {
    const res = await request(app).get("/api/settings");
    expect(res.body.result).toMatchObject({ onlineEnabled: true, codEnabled: true });
  });

  it("admin turns online payment off and the storefront sees it", async () => {
    expect((await setMethods({ onlineEnabled: false })).status).toBe(200);
    const pub = await request(app).get("/api/settings");
    expect(pub.body.result.onlineEnabled).toBe(false);
  });

  it("online orders are refused while it is off, COD still works", async () => {
    const online = await placeOrder("ONLINE");
    expect(online.status).toBe(400);
    expect(online.body.message).toMatch(/Online payment is currently unavailable/);

    const cod = await placeOrder("COD");
    expect(cod.status).toBeLessThan(300);
  });

  it("no new online payment can be started while it is off", async () => {
    const res = await request(app)
      .post("/api/payments/create-order")
      .set("Authorization", ctx.auth.customer)
      .send({ orderRef: "any-order" });
    expect(res.status).toBe(400);
  });

  it("both methods cannot be switched off", async () => {
    const res = await setMethods({ codEnabled: false });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/at least one payment method/i);
    const viaPlatform = await request(app)
      .put("/api/admin/settings/platform")
      .set("Authorization", ctx.auth.admin)
      .send({ codEnabled: false });
    expect(viaPlatform.status).toBe(400);
  });

  it("turning online back on allows online orders again; COD can then be turned off", async () => {
    expect((await setMethods({ onlineEnabled: true, codEnabled: false })).status).toBe(200);
    const online = await placeOrder("ONLINE");
    expect(online.status).toBeLessThan(300);
    const cod = await placeOrder("COD");
    expect(cod.status).toBe(400);
    expect(cod.body.message).toMatch(/Cash on Delivery is currently unavailable/);
    await setMethods({ codEnabled: true });
  });
});
