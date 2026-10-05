/**
 * API E2E — public storefront endpoints (no login required).
 */
import { jest } from "@jest/globals";
import request from "supertest";
import { startTestApp, stopTestApp, clearDatabase } from "./helpers/testApp.js";
import * as fx from "./helpers/fixtures.js";

jest.setTimeout(120000);

let app;
beforeAll(async () => {
  app = await startTestApp();
  await fx.ensureIndexes();
});
afterEach(clearDatabase);
afterAll(stopTestApp);

describe("public API", () => {
  it("GET /health reports UP", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.result.status).toBe("UP");
  });

  it("unknown /api routes return standardized 404", async () => {
    const res = await request(app).get("/api/definitely-not-a-route");
    expect(res.status).toBe(404);
    expect(res.body).toEqual(
      expect.objectContaining({ success: false, message: "Route not found" }),
    );
    expect(res.body.result.code).toBe("ROUTE_NOT_FOUND");
  });

  it("GET /api/settings returns public store settings with defaults", async () => {
    const res = await request(app).get("/api/settings");
    expect(res.status).toBe(200);
    expect(res.body.result).toEqual(
      expect.objectContaining({ currencyCode: "INR", currencySymbol: "₹" }),
    );
  });

  it("GET /api/categories lists seeded categories", async () => {
    const tree = await fx.createCategoryTree();
    const res = await request(app).get("/api/categories");
    expect(res.status).toBe(200);
    const ids = res.body.results.map((c) => String(c._id));
    expect(ids).toEqual(expect.arrayContaining([String(tree.category._id)]));
  });

  it("GET /api/public/faqs returns paginated FAQs", async () => {
    const res = await request(app).get("/api/public/faqs");
    expect(res.status).toBe(200);
    expect(res.body.result).toEqual(expect.objectContaining({ items: [], page: 1, total: 0 }));
  });

  it("GET /api/offers and /api/coupons list empty collections", async () => {
    expect((await request(app).get("/api/offers")).body.results).toEqual([]);
    expect((await request(app).get("/api/coupons")).body.results).toEqual([]);
  });

  it("GET /api/experience requires pageType", async () => {
    const missing = await request(app).get("/api/experience");
    expect(missing.status).toBe(400);
    expect(missing.body.message).toBe("pageType is required");
    const ok = await request(app).get("/api/experience?pageType=home");
    expect(ok.status).toBe(200);
    expect(ok.body.results).toEqual([]);
  });

  it("GET /api/experience/hero returns hero config", async () => {
    const res = await request(app).get("/api/experience/hero?pageType=home");
    expect(res.status).toBe(200);
    expect(res.body.result).toEqual(expect.objectContaining({ banners: expect.any(Object) }));
  });

  it("GET /api/offer-sections requires customer location", async () => {
    const res = await request(app).get("/api/offer-sections");
    expect(res.status).toBe(400);
  });

  it("GET /api/settings/check-serviceability answers for a pincode", async () => {
    const res = await request(app).get("/api/settings/check-serviceability?pincode=452001");
    expect(res.status).toBe(200);
    expect(typeof res.body.result.serviceable).toBe("boolean");
  });

  it("GET /api/seller/nearby finds sellers around a location", async () => {
    const seller = await fx.createSeller();
    const near = await request(app).get(
      `/api/seller/nearby?lat=${fx.STORE_LOCATION.lat}&lng=${fx.STORE_LOCATION.lng}`,
    );
    expect(near.status).toBe(200);
    expect(near.body.results.map((s) => String(s._id))).toContain(String(seller._id));
    expect(near.body.results[0].password).toBeUndefined();
  });
});
