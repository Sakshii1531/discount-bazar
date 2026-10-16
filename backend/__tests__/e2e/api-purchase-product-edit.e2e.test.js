/**
 * API E2E — editing a product from a purchase-bill line (PurchaseProductEditModal):
 * the partial JSON update it sends must change only the edited fields, keep stock,
 * keep untouched variant fields, recompute the purchase GST breakdown and leave the
 * product in the purchase/POS catalog.
 */
import { jest } from "@jest/globals";
import request from "supertest";
import { startTestApp, stopTestApp, clearDatabase, bearer } from "./helpers/testApp.js";
import * as fx from "./helpers/fixtures.js";
import { listOf } from "./helpers/world.js";
import Product from "../../app/models/product.js";

jest.setTimeout(120000);

let app;
beforeAll(async () => {
  app = await startTestApp();
  await fx.ensureIndexes();
});
afterEach(clearDatabase);
afterAll(stopTestApp);

describe("edit product from a purchase bill line", () => {
  let seller;
  let tree;
  let auth;
  beforeEach(async () => {
    seller = await fx.createSeller();
    tree = await fx.createCategoryTree();
    auth = bearer("seller", seller._id);
  });

  const edit = (id, body) => request(app).put(`/api/products/${id}`).set("Authorization", auth).send(body);
  const catalog = () => request(app).get("/api/seller/pos/catalog").set("Authorization", auth);

  it("updates a simple product's prices, cost and GST without touching stock or slug", async () => {
    const p = await fx.createProduct(seller, tree, { stock: 7, mrp: 70, purchaseCost: 40, gstPercent: 5, barcode: "8900001" });
    const res = await edit(p._id, {
      gstPercent: 18, purchaseGstType: "INCLUSIVE", mrp: 80,
      price: 75, salePrice: 70, barcode: "8900002", purchaseCost: 59,
    });
    expect(res.status).toBe(200);
    const after = await Product.findById(p._id).lean();
    expect(after).toEqual(expect.objectContaining({
      stock: 7, mrp: 80, price: 75, salePrice: 70, barcode: "8900002",
      purchaseCost: 59, gstPercent: 18, purchaseGstType: "INCLUSIVE",
      purchaseBasePrice: 50, purchaseGstAmount: 9, purchaseFinalPrice: 59,
      name: p.name, slug: p.slug,
    }));
  });

  it("updates variants, keeping their stock and untouched fields", async () => {
    const p = await fx.createProduct(seller, tree, {
      stock: 8,
      variants: [
        { name: "1L", sku: "OIL-1L", price: 100, salePrice: 95, stock: 5, barcode: "111", size: "1L", colour: "", purchaseCost: 80 },
        { name: "2L", sku: "OIL-2L", price: 190, salePrice: 0, stock: 3, barcode: "222", size: "2L", colour: "", purchaseCost: 150 },
      ],
    });
    const orig = (await Product.findById(p._id).lean()).variants;
    const res = await edit(p._id, {
      gstPercent: 5, purchaseGstType: "EXCLUSIVE", mrp: 0,
      variants: orig.map((v) => (v.sku === "OIL-2L"
        ? { ...v, name: "2 Litre", price: 200, salePrice: 180, barcode: "333", purchaseCost: 160, stock: 999 }
        : { ...v, stock: 999 })),
    });
    expect(res.status).toBe(200);
    const after = await Product.findById(p._id).lean();
    const v1 = after.variants.find((v) => v.sku === "OIL-1L");
    const v2 = after.variants.find((v) => v.sku === "OIL-2L");
    expect(after.stock).toBe(8);
    expect(v1).toEqual(expect.objectContaining({ stock: 5, price: 100, salePrice: 95, barcode: "111", size: "1L", purchaseCost: 80 }));
    expect(v2).toEqual(expect.objectContaining({ name: "2 Litre", stock: 3, price: 200, salePrice: 180, barcode: "333", size: "2L", purchaseCost: 160 }));
    expect(v2.purchaseGstAmount).toBe(8);
    expect(v2.purchaseFinalPrice).toBe(168);
  });

  it("changes the name (and slug) only when a name is sent", async () => {
    const p = await fx.createProduct(seller, tree);
    const res = await edit(p._id, { name: "Toned Milk 500ml", gstPercent: 0, purchaseGstType: "EXCLUSIVE", mrp: 0, price: 60, salePrice: 55 });
    expect(res.status).toBe(200);
    const after = await Product.findById(p._id).lean();
    expect(after.name).toBe("Toned Milk 500ml");
    expect(after.slug).toMatch(/^toned-milk-500ml/);
  });

  it("rejects a barcode used by another product", async () => {
    await fx.createProduct(seller, tree, { barcode: "DUPE-1" });
    const p = await fx.createProduct(seller, tree);
    const res = await edit(p._id, { gstPercent: 0, purchaseGstType: "EXCLUSIVE", mrp: 0, price: 60, salePrice: 55, barcode: "DUPE-1" });
    expect(res.status).toBe(409);
  });

  it("rejects an MRP below the selling price", async () => {
    const p = await fx.createProduct(seller, tree);
    const res = await edit(p._id, { gstPercent: 0, purchaseGstType: "EXCLUSIVE", mrp: 50, price: 60, salePrice: 0 });
    expect(res.status).toBe(400);
  });

  it("does not let a seller edit another seller's product", async () => {
    const other = await fx.createSeller({ email: "other-seller@test.com", phone: "9000000098" });
    const p = await fx.createProduct(other, tree);
    const res = await edit(p._id, { gstPercent: 0, purchaseGstType: "EXCLUSIVE", mrp: 0, price: 60 });
    expect(res.status).toBe(404);
  });

  it("keeps the edited product in the purchase catalog", async () => {
    const p = await fx.createProduct(seller, tree, { purchaseCost: 10 });
    await edit(p._id, { gstPercent: 12, purchaseGstType: "EXCLUSIVE", mrp: 0, price: 60, salePrice: 55, purchaseCost: 12 });
    const res = await catalog();
    expect(res.status).toBe(200);
    const row = listOf(res).find((x) => String(x._id) === String(p._id));
    expect(row).toEqual(expect.objectContaining({ purchaseCost: 12, gstPercent: 12 }));
  });
});
