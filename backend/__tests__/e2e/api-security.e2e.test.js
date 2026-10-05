/**
 * API E2E — access-control checks on admin-managed resources.
 *
 * Coupon and FAQ admin endpoints used to be open to anyone (fixed: routes
 * now require verifyToken + allowRoles("admin")). These tests guard that.
 */
import { jest } from "@jest/globals";
import request from "supertest";
import { startTestApp, stopTestApp, clearDatabase, bearer } from "./helpers/testApp.js";

jest.setTimeout(120000);

let app;
beforeAll(async () => {
  app = await startTestApp();
});
afterEach(clearDatabase);
afterAll(stopTestApp);

const coupon = () => ({
  code: `E2E${Date.now()}`,
  discountType: "percentage",
  discountValue: 100,
  validFrom: new Date().toISOString(),
  validTill: new Date(Date.now() + 86400000).toISOString(),
});
const faq = { question: "Is this safe?", answer: "No", category: "Customer" };
const customerAuth = bearer("customer", "64b7f0c2a1b2c3d4e5f60718");

describe("security: coupons", () => {
  it("anonymous users cannot create coupons", async () => {
    const res = await request(app).post("/api/admin/coupons").send(coupon());
    expect(res.status).toBe(401);
  });

  it("customers cannot create coupons", async () => {
    const res = await request(app).post("/api/admin/coupons").set("Authorization", customerAuth).send(coupon());
    expect(res.status).toBe(403);
  });

  it("admins can create coupons", async () => {
    const res = await request(app)
      .post("/api/admin/coupons")
      .set("Authorization", bearer("admin", "64b7f0c2a1b2c3d4e5f60718"))
      .send(coupon());
    expect(res.status).toBe(201);
  });
});

describe("security: FAQs", () => {
  it("anonymous users cannot create FAQs via /admin/faqs", async () => {
    const res = await request(app).post("/api/admin/faqs").send(faq);
    expect(res.status).toBe(401);
  });

  it("anonymous users cannot create FAQs via /public/faqs", async () => {
    const res = await request(app).post("/api/public/faqs").send(faq);
    expect(res.status).toBe(401);
  });
});

describe("security: JWT handling", () => {
  it("rejects tokens signed with a different secret", async () => {
    const jwt = (await import("jsonwebtoken")).default;
    const forged = jwt.sign({ id: "x", role: "admin" }, "attacker-secret");
    const res = await request(app).get("/api/admin/users").set("Authorization", `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  it("rejects alg=none tokens", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify({ id: "x", role: "admin" })).toString("base64url");
    const res = await request(app).get("/api/admin/users").set("Authorization", `Bearer ${header}.${body}.`);
    expect(res.status).toBe(401);
  });
});
