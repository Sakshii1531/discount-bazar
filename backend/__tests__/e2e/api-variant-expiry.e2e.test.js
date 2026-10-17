/**
 * API E2E — per-variant expiry: the seller form's multipart create/update stores
 * an expiry date on each variant (falling back to the product's default), the
 * seller list returns it for the edit modal, and the expiry report lists one row
 * per variant.
 */
import { jest } from "@jest/globals";
import request from "supertest";
import { startTestApp, stopTestApp, clearDatabase, bearer } from "./helpers/testApp.js";
import * as fx from "./helpers/fixtures.js";
import Product from "../../app/models/product.js";

jest.setTimeout(120000);

let app;
beforeAll(async () => {
  app = await startTestApp();
  await fx.ensureIndexes();
});
afterEach(clearDatabase);
afterAll(stopTestApp);

const dayKey = (offsetDays) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

describe("per-variant expiry dates", () => {
  let S;
  let tree;
  beforeEach(async () => {
    const seller = await fx.createSeller();
    tree = await fx.createCategoryTree();
    S = bearer("seller", seller._id);
  });

  const EXPIRED = dayKey(-10);
  const SOON = dayKey(3);
  const DEFAULT = dayKey(60);

  // Same multipart shape as the seller Add Product form.
  const create = (variants, expiryDate = DEFAULT) => {
    const req = request(app).post("/api/products").set("Authorization", S)
      .field("name", "Expiry Test Milk").field("price", "60").field("salePrice", "0").field("stock", "0")
      .field("headerId", String(tree.header._id)).field("categoryId", String(tree.category._id))
      .field("subcategoryId", String(tree.subcategory._id)).field("status", "active")
      .field("variants", JSON.stringify(variants));
    return expiryDate === null ? req : req.field("expiryDate", expiryDate);
  };
  const report = async () => {
    const res = await request(app).get("/api/seller/business/reports/expiry").set("Authorization", S);
    expect(res.status).toBe(200);
    return res.body.result || res.body.data;
  };

  it("stores each variant's own expiry and falls back to the product default in the report", async () => {
    const c = await create([
      { name: "500ml", sku: "MILK-500", price: 30, salePrice: 0, stock: 4, expiryDate: SOON },
      { name: "1L", sku: "MILK-1L", price: 60, salePrice: 55, stock: 2, expiryDate: EXPIRED },
      { name: "2L", sku: "MILK-2L", price: 110, salePrice: 0, stock: 1, expiryDate: "" },
    ]);
    expect(c.status).toBe(201);
    const id = c.body.result._id;

    const saved = await Product.findById(id).lean();
    expect(ymd(saved.expiryDate)).toBe(DEFAULT);
    expect(saved.variants.map((v) => ymd(v.expiryDate))).toEqual([SOON, EXPIRED, null]);

    const { rows, totals } = await report();
    expect(rows.map((r) => [r.variantName, r.sku, ymd(r.expiryDate), r.status, r.stock])).toEqual([
      ["1L", "MILK-1L", EXPIRED, "EXPIRED", 2],
      ["500ml", "MILK-500", SOON, "NEXT_7_DAYS", 4],
      ["2L", "MILK-2L", DEFAULT, "SAFE", 1],
    ]);
    expect(new Set(rows.map((r) => r.rowKey)).size).toBe(3);
    expect(rows[0].price).toBe(55);
    expect(totals).toEqual(expect.objectContaining({ count: 3, expired: 1, next7Days: 1 }));
  });

  it("lists a variant expiry even when the product has no default", async () => {
    const c = await create([
      { name: "A", sku: "NODEF-A", price: 10, stock: 1, expiryDate: SOON },
      { name: "B", sku: "NODEF-B", price: 10, stock: 1 },
    ], null);
    expect(c.status).toBe(201);
    const { rows } = await report();
    expect(rows.map((r) => r.sku)).toEqual(["NODEF-A"]);
  });

  it("returns variant expiry in the seller list and updates it on edit, keeping stock", async () => {
    const c = await create([
      { name: "500ml", sku: "EDIT-500", price: 30, stock: 4, expiryDate: SOON },
      { name: "1L", sku: "EDIT-1L", price: 60, stock: 2 },
    ]);
    const id = c.body.result._id;

    const list = await request(app).get("/api/products/seller/me").set("Authorization", S);
    const items = list.body.result?.items || list.body.results || [];
    const item = items.find((p) => String(p._id) === String(id));
    expect(ymd(item.expiryDate)).toBe(DEFAULT);
    expect(item.variants.map((v) => ymd(v.expiryDate))).toEqual([SOON, null]);

    // As the edit modal sends it: dates as YYYY-MM-DD, "" to clear.
    const variants = item.variants.map((v) => ({
      ...v,
      expiryDate: v.sku === "EDIT-500" ? "" : EXPIRED,
      stock: 999,
    }));
    const u = await request(app).put(`/api/products/${id}`).set("Authorization", S)
      .field("expiryDate", DEFAULT)
      .field("variants", JSON.stringify(variants));
    expect(u.status).toBe(200);

    const after = await Product.findById(id).lean();
    expect(after.variants.map((v) => [v.sku, ymd(v.expiryDate), v.stock])).toEqual([
      ["EDIT-500", null, 4],
      ["EDIT-1L", EXPIRED, 2],
    ]);
  });

  it("rejects an invalid variant expiry date", async () => {
    const c = await create([{ name: "X", sku: "BAD-X", price: 10, stock: 1, expiryDate: "not-a-date" }]);
    expect(c.status).toBe(400);
    expect(c.body.message).toMatch(/Variant #1 expiry date/);
  });
});
