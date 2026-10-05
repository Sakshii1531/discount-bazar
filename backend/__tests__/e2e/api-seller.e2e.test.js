/**
 * API E2E — seller panel: login & approval gate, profile, dashboard stats,
 * earnings, product listing and role isolation.
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

describe("seller: login", () => {
  it("logs in an approved seller", async () => {
    const seller = await fx.createSeller();
    const res = await request(app).post("/api/seller/login").send({ email: seller.email, password: seller.plainPassword });
    expect(res.status).toBe(200);
    expect(res.body.result.token).toEqual(expect.any(String));
  });

  it("rejects wrong passwords", async () => {
    const seller = await fx.createSeller();
    const res = await request(app).post("/api/seller/login").send({ email: seller.email, password: "wrong" });
    expect(res.status).toBe(401);
    expect(res.body.result?.token).toBeUndefined();
  });

  it("returns 404 for unknown sellers", async () => {
    const res = await request(app).post("/api/seller/login").send({ email: "ghost@test.com", password: "x" });
    expect(res.status).toBe(404);
  });

  it("returns 400 when credentials are missing", async () => {
    const res = await request(app).post("/api/seller/login").send({});
    expect(res.status).toBe(400);
  });

  it("holds pending sellers at the approval gate", async () => {
    const seller = await fx.createSeller({ isVerified: false, applicationStatus: "pending" });
    const res = await request(app).post("/api/seller/login").send({ email: seller.email, password: seller.plainPassword });
    expect(res.status).toBe(403);
    expect(res.body.result.applicationStatus).toBe("pending");
  });

  it("explains rejection", async () => {
    const seller = await fx.createSeller({
      isVerified: false,
      applicationStatus: "rejected",
      rejectionReason: "Invalid GST",
    });
    const res = await request(app).post("/api/seller/login").send({ email: seller.email, password: seller.plainPassword });
    expect(res.status).toBe(403);
    expect(res.body.result.applicationStatus).toBe("rejected");
  });
});

describe("seller: dashboard", () => {
  let seller;
  let auth;
  beforeEach(async () => {
    seller = await fx.createSeller();
    auth = bearer("seller", seller._id);
  });

  it("fetches profile without password", async () => {
    const res = await request(app).get("/api/seller/profile").set("Authorization", auth);
    expect(res.status).toBe(200);
    expect(res.body.result.shopName).toBe("Test Mart");
    expect(res.body.result.password).toBeUndefined();
  });

  it("fetches stats overview", async () => {
    const res = await request(app).get("/api/seller/stats").set("Authorization", auth);
    expect(res.status).toBe(200);
    expect(res.body.result.overview).toEqual(expect.objectContaining({ totalOrders: "0" }));
  });

  it("fetches earnings balances", async () => {
    const res = await request(app).get("/api/seller/earnings").set("Authorization", auth);
    expect(res.status).toBe(200);
    expect(res.body.result.balances.availableBalance).toBe(0);
  });

  it("lists only its own products", async () => {
    const tree = await fx.createCategoryTree();
    const mine = await fx.createProduct(seller, tree);
    const other = await fx.createSeller();
    await fx.createProduct(other, tree);
    const res = await request(app).get("/api/products/seller/me").set("Authorization", auth);
    expect(res.status).toBe(200);
    expect(res.body.result.items.map((p) => String(p._id))).toEqual([String(mine._id)]);
  });

  it("pending sellers cannot reach product management", async () => {
    const pending = await fx.createSeller({ isVerified: false, applicationStatus: "pending" });
    const res = await request(app)
      .get("/api/products/seller/me")
      .set("Authorization", bearer("seller", pending._id));
    expect(res.status).toBe(403);
  });
});

describe("seller: role isolation", () => {
  it.each(["customer", "delivery"])("%s tokens cannot call seller endpoints", async (role) => {
    const res = await request(app).get("/api/seller/stats").set("Authorization", bearer(role, "64b7f0c2a1b2c3d4e5f60718"));
    expect(res.status).toBe(403);
  });

  it("seller tokens cannot call admin endpoints", async () => {
    const seller = await fx.createSeller();
    const res = await request(app).get("/api/admin/users").set("Authorization", bearer("seller", seller._id));
    expect(res.status).toBe(403);
  });
});
