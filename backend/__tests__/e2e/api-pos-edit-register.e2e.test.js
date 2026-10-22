/**
 * API E2E — POS "Edit bill" loaded into the register, and in-stock-first
 * catalog ordering. The register needs each bill line's GST and live shelf
 * stock; saving re-writes customer details and moves stock by the difference.
 */
import { jest } from "@jest/globals";
import request from "supertest";
import { startTestApp, stopTestApp, clearDatabase, bearer } from "./helpers/testApp.js";
import * as fx from "./helpers/fixtures.js";
import Product from "../../app/models/product.js";

jest.setTimeout(120000);

let app;
let seller;
let auth;
let tree;
let n = 0;
const key = () => `e2e-pos-edit-reg-${Date.now()}-${(n += 1)}`.padEnd(32, "0");
const stock = async (id) => (await Product.findById(id).lean()).stock;

beforeAll(async () => {
  app = await startTestApp();
  await fx.ensureIndexes();
});
afterAll(stopTestApp);
beforeEach(async () => {
  seller = await fx.createSeller();
  auth = bearer("seller", seller._id);
  tree = await fx.createCategoryTree();
});
afterEach(clearDatabase);

const sell = (body) =>
  request(app).post("/api/seller/pos/sale").set("Authorization", auth).set("Idempotency-Key", key()).send(body);

describe("in-stock first ordering", () => {
  it("lists out-of-stock products after every in-stock one (POS catalog and product list)", async () => {
    await fx.createProduct(seller, tree, { name: "Apple", price: 10, stock: 0 });
    await fx.createProduct(seller, tree, { name: "Banana", price: 10, stock: 5 });
    await fx.createProduct(seller, tree, { name: "Cherry", price: 10, stock: 0 });
    await fx.createProduct(seller, tree, { name: "Date", price: 10, stock: 3 });

    const catalog = await request(app).get("/api/seller/pos/catalog").set("Authorization", auth);
    expect(catalog.status).toBe(200);
    expect(catalog.body.results.map((p) => p.name)).toEqual(["Banana", "Date", "Apple", "Cherry"]);

    // Paginated list: page 1 holds the in-stock slice, page 2 continues into out-of-stock.
    const page1 = await request(app).get("/api/products/seller/me").query({ sort: "name-asc", page: 1, limit: 3 }).set("Authorization", auth);
    const page2 = await request(app).get("/api/products/seller/me").query({ sort: "name-asc", page: 2, limit: 3 }).set("Authorization", auth);
    expect(page1.status).toBe(200);
    expect(page1.body.result.items.map((p) => p.name)).toEqual(["Banana", "Date", "Apple"]);
    expect(page2.body.result.items.map((p) => p.name)).toEqual(["Cherry"]);
    expect(page1.body.result.total).toBe(4);
  });
});

describe("edit bill in the register", () => {
  it("returns line GST + shelf stock, then saves new lines, customer details and stock", async () => {
    const tea = await fx.createProduct(seller, tree, { name: "Tea", price: 100, stock: 10, gstPercent: 5 });
    const sale = await sell({
      items: [{ productId: String(tea._id), quantity: 2, price: 100 }],
      posPaymentMethod: "CASH",
      walkInCustomer: { name: "Asha", phone: "9876500033" },
    });
    expect([200, 201]).toContain(sale.status);
    const orderId = (sale.body.result.order || sale.body.result).orderId;
    expect(await stock(tea._id)).toBe(8);

    const opened = await request(app).get(`/api/seller/pos/returns/order/${orderId}`).set("Authorization", auth);
    expect(opened.status).toBe(200);
    expect(opened.body.result.items[0]).toEqual(expect.objectContaining({ quantity: 2, gstPercent: 5, availableStock: 8 }));

    const edit = await request(app)
      .put(`/api/seller/pos/sales/${orderId}`)
      .set("Authorization", auth)
      .send({
        items: [{ productId: String(tea._id), quantity: 5, price: 100 }],
        posPaymentMethod: "CASH",
        posCustomerId: "",
        cashTendered: 500,
        walkInCustomer: { name: "Asha Rani", phone: "9876500044" },
        reason: "Customer took more",
      });
    expect(edit.status).toBe(200);
    const order = edit.body.result.order;
    expect(order.paymentBreakdown.grandTotal).toBe(500);
    expect(order.walkInCustomer).toEqual(expect.objectContaining({ name: "Asha Rani", phone: "9876500044" }));
    expect(order.posCashTendered).toBe(500);
    expect(await stock(tea._id)).toBe(5);
  });

  it("keeps a tax-exclusive bill's effective rate when no tax is sent", async () => {
    const rice = await fx.createProduct(seller, tree, { name: "Rice", price: 100, stock: 20 });
    const sale = await sell({
      items: [{ productId: String(rice._id), quantity: 1, price: 100 }],
      posPaymentMethod: "CASH",
      isTaxInclusive: false,
      taxPercent: 10,
    });
    const orderId = (sale.body.result.order || sale.body.result).orderId;
    expect((sale.body.result.order || sale.body.result).paymentBreakdown.grandTotal).toBe(110);

    const edit = await request(app)
      .put(`/api/seller/pos/sales/${orderId}`)
      .set("Authorization", auth)
      .send({ items: [{ productId: String(rice._id), quantity: 3, price: 100 }], isTaxInclusive: false });
    expect(edit.status).toBe(200);
    // 300 + 10% — not the stale ₹10 of the original bill
    expect(edit.body.result.order.paymentBreakdown.taxTotal).toBe(30);
    expect(edit.body.result.order.paymentBreakdown.grandTotal).toBe(330);
  });
});

describe("audit regressions", () => {
  it("filters stock status on the server so later pages are reachable", async () => {
    for (const [name, stock] of [["A", 5], ["B", 0], ["C", 2], ["D", 0], ["E", 50]]) {
      await fx.createProduct(seller, tree, { name, price: 10, stock, lowStockAlert: 5 });
    }
    const out = await request(app).get("/api/products/seller/me").query({ stockStatus: "out", limit: 20 }).set("Authorization", auth);
    expect(out.status).toBe(200);
    expect(out.body.result.items.map((p) => p.name).sort()).toEqual(["B", "D"]);
    expect(out.body.result.total).toBe(2);
    const low = await request(app).get("/api/products/seller/me").query({ stockStatus: "low", limit: 20 }).set("Authorization", auth);
    expect(low.body.result.items.map((p) => p.name).sort()).toEqual(["A", "C"]);
  });

  it("refunds the GST collected on a tax-exclusive bill", async () => {
    const oil = await fx.createProduct(seller, tree, { name: "Oil", price: 100, stock: 10 });
    const sale = await sell({
      items: [{ productId: String(oil._id), quantity: 1, price: 100 }],
      posPaymentMethod: "CASH",
      isTaxInclusive: false,
      taxPercent: 10,
    });
    const orderId = (sale.body.result.order || sale.body.result).orderId;
    const ret = await request(app)
      .post("/api/seller/pos/returns")
      .set("Authorization", auth)
      .send({ orderId, items: [{ productId: String(oil._id), quantity: 1, condition: "good" }], refundMethod: "CASH" });
    expect([200, 201]).toContain(ret.status);
    const refund = (ret.body.result.return || ret.body.result).refundTotal;
    expect(refund).toBe(110);
  });

  it("rejects linking an edited bill to another seller's customer", async () => {
    const other = await fx.createSeller();
    const foreign = await request(app).post("/api/seller/business/customers").set("Authorization", bearer("seller", other._id)).send({ name: "Not Mine" });
    const soap = await fx.createProduct(seller, tree, { name: "Soap", price: 20, stock: 10 });
    const sale = await sell({ items: [{ productId: String(soap._id), quantity: 1, price: 20 }], posPaymentMethod: "CASH" });
    const orderId = (sale.body.result.order || sale.body.result).orderId;
    const edit = await request(app)
      .put(`/api/seller/pos/sales/${orderId}`)
      .set("Authorization", auth)
      .send({ items: [{ productId: String(soap._id), quantity: 1, price: 20 }], posPaymentMethod: "CASH", posCustomerId: foreign.body.result._id });
    expect(edit.status).toBe(404);
  });
});
