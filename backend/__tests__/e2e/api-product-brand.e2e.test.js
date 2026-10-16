/**
 * API E2E — product brand: the seller form's multipart create/update links a
 * product to an admin brand, and admin rename / deactivate / delete keep
 * products consistent.
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

describe("product brand", () => {
  let A;
  let S;
  let tree;
  let amul;
  let bikano;
  beforeEach(async () => {
    const admin = await fx.createAdmin();
    const seller = await fx.createSeller();
    tree = await fx.createCategoryTree();
    A = bearer("admin", admin._id);
    S = bearer("seller", seller._id);
    amul = (await request(app).post("/api/admin/brands").set("Authorization", A).send({ name: "Amul" })).body.result;
    bikano = (await request(app).post("/api/admin/brands").set("Authorization", A).send({ name: "Bikano" })).body.result;
  });

  // Same multipart shape as the seller Add Product form.
  const create = (brandId, brand) => request(app).post("/api/products").set("Authorization", S)
    .field("name", "Brand Test Milk").field("price", "60").field("salePrice", "0").field("stock", "0")
    .field("headerId", String(tree.header._id)).field("categoryId", String(tree.category._id))
    .field("subcategoryId", String(tree.subcategory._id)).field("status", "active")
    .field("brand", brand).field("brandId", brandId)
    .field("variants", JSON.stringify([{ name: "1L", sku: "", price: 60, salePrice: 0, stock: 0 }]));
  const update = (id, brandId, brand) => request(app).put(`/api/products/${id}`).set("Authorization", S)
    .field("brand", brand).field("brandId", brandId);
  const brandOf = async (id) => {
    const p = await Product.findById(id).lean();
    return { brand: p.brand, brandId: p.brandId ? String(p.brandId) : null };
  };

  it("lists only active brands publicly", async () => {
    await request(app).put(`/api/admin/brands/${bikano._id}`).set("Authorization", A).send({ status: "inactive" });
    const res = await request(app).get("/api/brands");
    expect(res.status).toBe(200);
    expect(res.body.results.map((b) => b.name)).toEqual(["Amul"]);
  });

  it("creates, changes and clears a product's brand", async () => {
    const c = await create(String(amul._id), "Amul");
    expect(c.status).toBe(201);
    const id = c.body.result._id;
    expect(await brandOf(id)).toEqual({ brand: "Amul", brandId: String(amul._id) });

    const list = await request(app).get("/api/products/seller/me").set("Authorization", S);
    const items = list.body.result?.items || list.body.results || [];
    expect(items.find((p) => String(p._id) === String(id))).toEqual(expect.objectContaining({ brand: "Amul" }));

    expect((await update(id, String(bikano._id), "Bikano")).status).toBe(200);
    expect(await brandOf(id)).toEqual({ brand: "Bikano", brandId: String(bikano._id) });

    expect((await update(id, "", "")).status).toBe(200);
    expect(await brandOf(id)).toEqual({ brand: "", brandId: null });
  });

  it("rejects unknown or inactive brands for new links", async () => {
    expect((await create("64b7f0c2a1b2c3d4e5f60718", "Ghost")).status).toBe(400);
    expect((await create("not-an-id", "Ghost")).status).toBe(400);
    await request(app).put(`/api/admin/brands/${bikano._id}`).set("Authorization", A).send({ status: "inactive" });
    expect((await create(String(bikano._id), "Bikano")).status).toBe(400);
  });

  it("keeps products in sync with admin rename, deactivate and delete", async () => {
    const id = (await create(String(amul._id), "Amul")).body.result._id;
    await request(app).put(`/api/admin/brands/${amul._id}`).set("Authorization", A).send({ name: "Amul India" });
    expect((await brandOf(id)).brand).toBe("Amul India");

    await request(app).put(`/api/admin/brands/${amul._id}`).set("Authorization", A).send({ status: "inactive" });
    // A product that already uses an inactive brand can still be saved with it.
    expect((await update(id, String(amul._id), "Amul India")).status).toBe(200);

    const del = await request(app).delete(`/api/admin/brands/${amul._id}`).set("Authorization", A);
    expect(del.status).toBe(409);
  });
});
