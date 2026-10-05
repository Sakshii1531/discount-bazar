/**
 * API E2E — delivery partner app: OTP login, profile, stats, earnings,
 * COD summary and role isolation.
 */
import { jest } from "@jest/globals";
import request from "supertest";
import { startTestApp, stopTestApp, clearDatabase, bearer } from "./helpers/testApp.js";
import * as fx from "./helpers/fixtures.js";

jest.setTimeout(120000);

let app;
beforeAll(async () => {
  app = await startTestApp();
  await fx.ensureIndexes();
});
afterEach(clearDatabase);
afterAll(stopTestApp);

describe("delivery: OTP login", () => {
  it("logs in a registered rider with the mock OTP", async () => {
    const rider = await fx.createDelivery();
    const send = await request(app).post("/api/delivery/send-login-otp").send({ phone: rider.phone });
    expect(send.status).toBe(200);
    const verify = await request(app).post("/api/delivery/verify-otp").send({ phone: rider.phone, otp: "1234" });
    expect(verify.status).toBe(200);
    expect(verify.body.result.token).toEqual(expect.any(String));
  });

  it("rejects unknown riders", async () => {
    const res = await request(app).post("/api/delivery/send-login-otp").send({ phone: "7000000000" });
    expect(res.status).toBe(404);
  });

  it("rejects wrong or missing OTP", async () => {
    const rider = await fx.createDelivery();
    await request(app).post("/api/delivery/send-login-otp").send({ phone: rider.phone });
    const wrong = await request(app).post("/api/delivery/verify-otp").send({ phone: rider.phone, otp: "0000" });
    expect(wrong.status).toBe(400);
    const missing = await request(app).post("/api/delivery/verify-otp").send({ phone: rider.phone });
    expect(missing.status).toBe(400);
  });
});

describe("delivery: dashboard", () => {
  let rider;
  let auth;
  beforeEach(async () => {
    rider = await fx.createDelivery();
    auth = bearer("delivery", rider._id);
  });

  it("fetches profile", async () => {
    const res = await request(app).get("/api/delivery/profile").set("Authorization", auth);
    expect(res.status).toBe(200);
    expect(res.body.result.name).toBe("Test Rider");
  });

  it("fetches today's stats", async () => {
    const res = await request(app).get("/api/delivery/stats").set("Authorization", auth);
    expect(res.status).toBe(200);
    expect(res.body.result).toEqual(expect.objectContaining({ today: 0, deliveries: 0 }));
  });

  it("fetches earnings", async () => {
    const res = await request(app).get("/api/delivery/earnings").set("Authorization", auth);
    expect(res.status).toBe(200);
    expect(res.body.result.totalEarnings).toBe(0);
  });

  it("fetches COD cash summary", async () => {
    const res = await request(app).get("/api/delivery/cod/summary").set("Authorization", auth);
    expect(res.status).toBe(200);
  });

  it("requires auth for profile", async () => {
    const res = await request(app).get("/api/delivery/profile");
    expect(res.status).toBe(401);
  });

  it("customers cannot read rider COD data", async () => {
    const res = await request(app)
      .get("/api/delivery/cod/summary")
      .set("Authorization", bearer("customer", rider._id));
    expect(res.status).toBe(403);
  });
});
