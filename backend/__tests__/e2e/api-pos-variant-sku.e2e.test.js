/**
 * API E2E — a POS line on a product with variants always settles on a real
 * variant SKU. Stock for such products lives on the variants (master stock is
 * re-summed from them after a sale), so a line without one used to sell
 * without reducing stock.
 */
import { jest } from "@jest/globals";
import request from "supertest";
import mongoose from "mongoose";
import { startTestApp, stopTestApp, clearDatabase, bearer } from "./helpers/testApp.js";
import * as fx from "./helpers/fixtures.js";
import Product from "../../app/models/product.js";
import Order from "../../app/models/order.js";
import { repairBlankVariantSkus } from "../../app/services/variantSkuRepairService.js";

jest.setTimeout(120000);

let app;
beforeAll(async () => {
  app = await startTestApp();
  await fx.ensureIndexes();
});
afterEach(clearDatabase);
afterAll(stopTestApp);

describe("POS variant SKU", () => {
  let S;
  let soap;
  let rice;
  let legacy;
  beforeEach(async () => {
    const seller = await fx.createSeller();
    const tree = await fx.createCategoryTree();
    S = bearer("seller", seller._id);
    soap = await fx.createProduct(seller, tree, {
      name: "Bath Soap",
      stock: 10,
      variants: [{ name: "Default", sku: "SOAP-1", price: 40, salePrice: 35, stock: 10 }],
    });
    rice = await fx.createProduct(seller, tree, {
      name: "Basmati Rice",
      stock: 30,
      variants: [
        { name: "1 kg", sku: "RICE-1KG", price: 120, salePrice: 110, stock: 20 },
        { name: "5 kg", sku: "RICE-5KG", price: 550, salePrice: 520, stock: 10 },
      ],
    });
    // Saved before variant SKUs were generated: two variants, no SKUs.
    // Written straight to the collection, as such old records sit in the
    // database (any save through the model now fills the SKUs in).
    legacy = await fx.createProduct(seller, tree, { name: "Old Tea", stock: 12 });
    await Product.collection.updateOne({ _id: legacy._id }, {
      $set: {
        variants: [
          { _id: new mongoose.Types.ObjectId(), name: "250 g", price: 90, salePrice: 90, stock: 6 },
          { _id: new mongoose.Types.ObjectId(), name: "500 g", sku: "  ", price: 170, salePrice: 170, stock: 6 },
        ],
      },
    });
  });

  let n = 0;
  const sell = (items) => request(app).post("/api/seller/pos/sale").set("Authorization", S)
    .set("Idempotency-Key", `e2e-pos-variant-sku-key-000000000000${String(++n).padStart(2, "0")}`)
    .send({ posPaymentMethod: "CASH", cashTendered: 100000, items });
  const stockOf = async (id) => {
    const p = await Product.findById(id).lean();
    return [p.stock, ...(p.variants || []).map((v) => v.stock)];
  };

  it("uses the lone variant when none is named, and reduces its stock", async () => {
    const res = await sell([{ productId: String(soap._id), quantity: 2, price: 35 }]);
    expect([200, 201]).toContain(res.status);
    const order = res.body.result.order || res.body.result;
    expect(order.items[0].variantSlot).toBe("SOAP-1");
    expect(await stockOf(soap._id)).toEqual([8, 8]);
  });

  it("matches a variant SKU case-insensitively and stores the saved SKU", async () => {
    const res = await sell([{ productId: String(rice._id), variantSku: "rice-5kg", quantity: 1, price: 520 }]);
    expect([200, 201]).toContain(res.status);
    const order = res.body.result.order || res.body.result;
    expect(order.items[0].variantSlot).toBe("RICE-5KG");
    expect(await stockOf(rice._id)).toEqual([29, 20, 9]);
  });

  it("rejects a line that names no variant on a multi-variant product", async () => {
    const res = await sell([{ productId: String(rice._id), quantity: 1, price: 110 }]);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/choose a variant/i);
    expect(await stockOf(rice._id)).toEqual([30, 20, 10]);
  });

  it("rejects an unknown variant SKU", async () => {
    const res = await sell([{ productId: String(rice._id), variantSku: "RICE-10KG", quantity: 1, price: 110 }]);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not found/i);
  });

  it("rejects a variant saved without a SKU instead of selling it without reducing stock", async () => {
    const res = await sell([{ productId: String(legacy._id), variantSku: "", quantity: 1, price: 90 }]);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/without a SKU/i);
    expect(await stockOf(legacy._id)).toEqual([12, 6, 6]);
  });

  it("the repair gives old variants SKUs, after which they sell and reduce their own stock", async () => {
    const preview = await repairBlankVariantSkus({ apply: false });
    expect(preview).toMatchObject({ products: 1, variants: 2 });
    expect((await Product.findById(legacy._id).lean()).variants.map((v) => v.sku ?? null)).toEqual([null, "  "]);

    expect(await repairBlankVariantSkus()).toMatchObject({ products: 1, variants: 2 });
    const repaired = await Product.findById(legacy._id).lean();
    const skus = repaired.variants.map((v) => v.sku);
    expect(skus.every((sku) => /^OLDTE-[A-Z0-9]{6}$/.test(sku))).toBe(true);
    expect(new Set(skus).size).toBe(2);
    expect(await repairBlankVariantSkus()).toMatchObject({ products: 0, variants: 0 });

    const res = await sell([{ productId: String(legacy._id), variantSku: skus[1], quantity: 2, price: 170 }]);
    expect([200, 201]).toContain(res.status);
    expect(await stockOf(legacy._id)).toEqual([10, 6, 4]);
  });

  it("any save through the model fills blank variant SKUs and keeps existing ones as stored", async () => {
    const doc = await Product.findById(rice._id);
    doc.variants.push({ name: "10 kg", price: 1000, salePrice: 990, stock: 1 });
    doc.variants[0].sku = "Rice-1kg";
    await doc.save();
    const saved = await Product.findById(rice._id).lean();
    expect(saved.variants.map((v) => v.sku).slice(0, 2)).toEqual(["Rice-1kg", "RICE-5KG"]);
    expect(saved.variants[2].sku).toMatch(/^BASMA-[A-Z0-9]{6}$/);
  });

  it("applies the same rules to lines added while editing a bill", async () => {
    const res = await sell([{ productId: String(soap._id), quantity: 1, price: 35 }]);
    const order = res.body.result.order || res.body.result;
    const edit = (items) => request(app).put(`/api/seller/pos/sales/${order.orderId}`).set("Authorization", S)
      .send({ posPaymentMethod: "CASH", reason: "Added rice", items });

    const bad = await edit([
      { productId: String(soap._id), variantSku: "SOAP-1", quantity: 1, price: 35 },
      { productId: String(rice._id), quantity: 1, price: 110 },
    ]);
    expect(bad.status).toBe(400);

    const ok = await edit([
      { productId: String(soap._id), variantSku: "SOAP-1", quantity: 1, price: 35 },
      { productId: String(rice._id), variantSku: "rice-1kg", quantity: 2, price: 110 },
    ]);
    expect(ok.status).toBe(200);
    const saved = await Order.findOne({ orderId: order.orderId }).lean();
    expect(saved.items.map((i) => [i.variantSlot, i.quantity])).toEqual([["SOAP-1", 1], ["RICE-1KG", 2]]);
    expect(await stockOf(rice._id)).toEqual([28, 18, 10]);
    expect(await stockOf(soap._id)).toEqual([9, 9]);
  });
});
