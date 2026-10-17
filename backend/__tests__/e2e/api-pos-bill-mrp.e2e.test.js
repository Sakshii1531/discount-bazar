/**
 * API E2E — POS bill lines snapshot the unit MRP (variant price, else product
 * mrp/price, never below the selling price) so the receipt can print it next
 * to the selling price; editing a bill keeps it.
 */
import { jest } from "@jest/globals";
import request from "supertest";
import { startTestApp, stopTestApp, clearDatabase, bearer } from "./helpers/testApp.js";
import * as fx from "./helpers/fixtures.js";
import Order from "../../app/models/order.js";

jest.setTimeout(120000);

let app;
beforeAll(async () => {
  app = await startTestApp();
  await fx.ensureIndexes();
});
afterEach(clearDatabase);
afterAll(stopTestApp);

describe("POS bill MRP", () => {
  let S;
  let oil;
  let bread;
  let jam;
  beforeEach(async () => {
    const seller = await fx.createSeller();
    const tree = await fx.createCategoryTree();
    S = bearer("seller", seller._id);
    oil = await fx.createProduct(seller, tree, {
      name: "Sunflower Oil",
      stock: 50,
      variants: [
        { name: "1 Litre", sku: "OIL-1L", price: 150, salePrice: 140, stock: 30 },
        { name: "5 Litre", sku: "OIL-5L", price: 700, salePrice: 650, stock: 20 },
      ],
    });
    bread = await fx.createProduct(seller, tree, { name: "Brown Bread", price: 50, salePrice: 45, mrp: 55, stock: 40 });
    jam = await fx.createProduct(seller, tree, { name: "Mixed Jam", price: 120, salePrice: 0, mrp: 0, stock: 10 });
  });

  const sell = (key, items) => request(app).post("/api/seller/pos/sale").set("Authorization", S)
    .set("Idempotency-Key", `e2e-pos-bill-mrp-key-0000000000000${key}`)
    .send({ posPaymentMethod: "CASH", cashTendered: 100000, items });

  it("stores each line's MRP and returns it with the order", async () => {
    const res = await sell(1, [
      { productId: String(oil._id), variantSku: "OIL-5L", quantity: 1, price: 650 },
      { productId: String(bread._id), quantity: 2, price: 45 },
      { productId: String(jam._id), quantity: 1, price: 110 },
      // Cashier charged above the listed MRP: MRP is never printed below the price.
      { productId: String(oil._id), variantSku: "OIL-1L", quantity: 1, price: 160 },
    ]);
    expect([200, 201]).toContain(res.status);
    const order = res.body.result.order || res.body.result;
    expect(order.items.map((i) => [i.variantSlot || "", i.price, i.mrp])).toEqual([
      ["OIL-5L", 650, 700],
      ["", 45, 55],
      ["", 110, 120],
      ["OIL-1L", 160, 160],
    ]);
  });

  it("keeps MRP on bill lines after an edit", async () => {
    const res = await sell(2, [{ productId: String(bread._id), quantity: 1, price: 45 }]);
    const order = res.body.result.order || res.body.result;
    const edit = await request(app).put(`/api/seller/pos/sales/${order.orderId}`).set("Authorization", S).send({
      posPaymentMethod: "CASH", reason: "Added oil",
      items: [
        { productId: String(bread._id), quantity: 1, price: 45 },
        { productId: String(oil._id), variantSku: "OIL-1L", quantity: 2, price: 140 },
      ],
    });
    expect(edit.status).toBe(200);
    const saved = await Order.findOne({ orderId: order.orderId }).lean();
    expect(saved.items.map((i) => [i.variantSlot || "", i.mrp])).toEqual([["", 55], ["OIL-1L", 150]]);
  });
});
