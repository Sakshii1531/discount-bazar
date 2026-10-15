/**
 * API E2E — purchase bills and GST type: bill totals follow each line's
 * incl./excl. GST choice, and confirming a bill writes the cost back to the
 * product in the product's own GST convention (with a fresh breakdown).
 */
import { jest } from "@jest/globals";
import request from "supertest";
import { startTestApp, stopTestApp, clearDatabase, bearer } from "./helpers/testApp.js";
import * as fx from "./helpers/fixtures.js";
import Product from "../../app/models/product.js";
import Order from "../../app/models/order.js";
import PartyLedgerEntry from "../../app/models/partyLedgerEntry.js";

jest.setTimeout(120000);

let billSeq = 0;
const nextBillNo = () => `B-${++billSeq}`;

let app;
beforeAll(async () => {
  app = await startTestApp();
  await fx.ensureIndexes();
});
afterEach(clearDatabase);
afterAll(stopTestApp);

describe("purchase bill GST type", () => {
  let seller;
  let tree;
  let auth;
  beforeEach(async () => {
    seller = await fx.createSeller();
    tree = await fx.createCategoryTree();
    auth = bearer("seller", seller._id);
  });

  const saveBill = (items, extra = {}) =>
    request(app).post("/api/seller/business/purchases").set("Authorization", auth)
      .send({ billNo: nextBillNo(), items, confirm: true, ...extra });

  it("prices inclusive and exclusive lines correctly", async () => {
    const p = await fx.createProduct(seller, tree, { gstPercent: 18 });
    const res = await saveBill([
      { productId: String(p._id), quantity: 2, cost: 118, gstPercent: 18, purchaseGstType: "INCLUSIVE" },
      { productId: String(p._id), quantity: 1, cost: 100, gstPercent: 18, purchaseGstType: "EXCLUSIVE" },
    ]);
    expect(res.status).toBe(201);
    const bill = res.body.result;
    expect(bill.subtotal).toBe(300);
    expect(bill.gstTotal).toBe(54);
    expect(bill.total).toBe(354);
    expect(bill.items.map((i) => i.purchaseGstType)).toEqual(["INCLUSIVE", "EXCLUSIVE"]);
  });

  it("converts an inclusive line onto an exclusive product", async () => {
    const p = await fx.createProduct(seller, tree, { gstPercent: 18, purchaseGstType: "EXCLUSIVE", purchaseCost: 50 });
    const res = await saveBill([{ productId: String(p._id), quantity: 1, cost: 118, gstPercent: 18, purchaseGstType: "INCLUSIVE" }]);
    expect(res.status).toBe(201);
    const after = await Product.findById(p._id).lean();
    expect(after.purchaseGstType).toBe("EXCLUSIVE");
    expect(after.purchaseCost).toBe(100);
    expect(after.purchaseBasePrice).toBe(100);
    expect(after.purchaseGstAmount).toBe(18);
    expect(after.purchaseFinalPrice).toBe(118);
  });

  it("converts an exclusive line onto an inclusive product", async () => {
    const p = await fx.createProduct(seller, tree, { gstPercent: 18, purchaseGstType: "INCLUSIVE", purchaseCost: 50 });
    const res = await saveBill([{ productId: String(p._id), quantity: 3, cost: 100, gstPercent: 18, purchaseGstType: "EXCLUSIVE" }]);
    expect(res.status).toBe(201);
    const after = await Product.findById(p._id).lean();
    expect(after.purchaseGstType).toBe("INCLUSIVE");
    expect(after.purchaseCost).toBe(118);
    expect(after.purchaseBasePrice).toBe(100);
    expect(after.purchaseFinalPrice).toBe(118);
  });

  it("keeps the cost as entered when the line matches the product", async () => {
    const p = await fx.createProduct(seller, tree, { gstPercent: 5, purchaseGstType: "EXCLUSIVE" });
    await saveBill([{ productId: String(p._id), quantity: 1, cost: 40, gstPercent: 5, purchaseGstType: "EXCLUSIVE" }]);
    const after = await Product.findById(p._id).lean();
    expect(after.purchaseCost).toBe(40);
    expect(after.purchaseGstAmount).toBe(2);
    expect(after.purchaseFinalPrice).toBe(42);
  });

  it("updates the variant's cost and breakdown", async () => {
    const p = await fx.createProduct(seller, tree, {
      gstPercent: 18,
      purchaseGstType: "EXCLUSIVE",
      variants: [
        { name: "1L", sku: "V-1L", price: 60, stock: 5, purchaseCost: 10 },
        { name: "2L", sku: "V-2L", price: 110, stock: 5, purchaseCost: 20 },
      ],
    });
    const res = await saveBill([
      { productId: String(p._id), variantSku: "V-2L", quantity: 1, cost: 236, gstPercent: 18, purchaseGstType: "INCLUSIVE" },
    ]);
    expect(res.status).toBe(201);
    const after = await Product.findById(p._id).lean();
    const v2 = after.variants.find((v) => v.sku === "V-2L");
    const v1 = after.variants.find((v) => v.sku === "V-1L");
    expect(v2.purchaseCost).toBe(200);
    expect(v2.purchaseBasePrice).toBe(200);
    expect(v2.purchaseGstAmount).toBe(36);
    expect(v2.purchaseFinalPrice).toBe(236);
    expect(v1.purchaseCost).toBe(10);
  });

  it("applies the conversion when a confirmed bill is edited", async () => {
    const p = await fx.createProduct(seller, tree, { gstPercent: 18, purchaseGstType: "EXCLUSIVE" });
    const created = await saveBill([{ productId: String(p._id), quantity: 1, cost: 100, gstPercent: 18, purchaseGstType: "EXCLUSIVE" }]);
    const res = await request(app).put(`/api/seller/business/purchases/${created.body.result._id}`).set("Authorization", auth)
      .send({ billNo: "B-EDIT", items: [{ productId: String(p._id), quantity: 1, cost: 59, gstPercent: 18, purchaseGstType: "INCLUSIVE" }] });
    expect(res.status).toBe(200);
    const after = await Product.findById(p._id).lean();
    expect(after.purchaseCost).toBe(50);
    expect(after.purchaseFinalPrice).toBe(59);
  });

  it("rejects an unknown GST type", async () => {
    const p = await fx.createProduct(seller, tree);
    const res = await saveBill([{ productId: String(p._id), quantity: 1, cost: 10, purchaseGstType: "BOTH" }]);
    expect(res.status).toBe(400);
  });
});

describe("purchase returns follow the bill's GST type", () => {
  let seller;
  let tree;
  let auth;
  let product;
  beforeEach(async () => {
    seller = await fx.createSeller();
    tree = await fx.createCategoryTree();
    auth = bearer("seller", seller._id);
    product = await fx.createProduct(seller, tree, { gstPercent: 18, stock: 0 });
  });

  const bill = (purchaseGstType, cost, confirm = true) =>
    request(app).post("/api/seller/business/purchases").set("Authorization", auth)
      .send({ billNo: nextBillNo(), confirm, items: [{ productId: String(product._id), quantity: 5, cost, gstPercent: 18, purchaseGstType }] });
  const ret = (billId, extra = {}) =>
    request(app).post("/api/seller/business/purchase-returns").set("Authorization", auth)
      .send({ purchaseBillId: billId, items: [{ productId: String(product._id), quantity: 1, cost: extra.cost ?? 118, ...extra.item }] });

  it("saves an inclusive bill as inclusive and returns it at the inclusive price", async () => {
    const b = await bill("INCLUSIVE", 118);
    expect(b.body.result.items[0].purchaseGstType).toBe("INCLUSIVE");
    expect(b.body.result.total).toBe(590);
    // Client omits GST fields (as the old screen did): the bill's basis is used.
    const r = await ret(b.body.result._id);
    expect(r.status).toBe(201);
    expect(r.body.result.items[0].purchaseGstType).toBe("INCLUSIVE");
    expect(r.body.result.items[0].gstPercent).toBe(18);
    expect(r.body.result.total).toBe(118);
  });

  it("returns an exclusive bill line with GST added", async () => {
    const b = await bill("EXCLUSIVE", 100);
    const r = await ret(b.body.result._id, { cost: 100, item: { purchaseGstType: "INCLUSIVE", gstPercent: 0 } });
    expect(r.status).toBe(201);
    expect(r.body.result.items[0].purchaseGstType).toBe("EXCLUSIVE");
    expect(r.body.result.total).toBe(118);
  });

  it("refuses returns against a draft bill or for items not on the bill", async () => {
    const draft = await bill("INCLUSIVE", 118, false);
    expect((await ret(draft.body.result._id)).status).toBe(409);

    const b = await bill("INCLUSIVE", 118);
    const other = await fx.createProduct(seller, tree, { stock: 5 });
    const r = await request(app).post("/api/seller/business/purchase-returns").set("Authorization", auth)
      .send({ purchaseBillId: b.body.result._id, items: [{ productId: String(other._id), quantity: 1, cost: 10 }] });
    expect(r.status).toBe(400);
  });

  it("does not accept another seller's bill", async () => {
    const b = await bill("INCLUSIVE", 118);
    const intruder = await fx.createSeller({ email: "other-seller@test.com", phone: "9000000099" });
    const r = await request(app).post("/api/seller/business/purchase-returns").set("Authorization", bearer("seller", intruder._id))
      .send({ purchaseBillId: b.body.result._id, items: [{ productId: String(product._id), quantity: 1, cost: 118 }] });
    expect(r.status).toBe(404);
  });
});

describe("cost excl. GST in POS snapshots and reports", () => {
  let seller;
  let tree;
  let auth;
  beforeEach(async () => {
    seller = await fx.createSeller();
    tree = await fx.createCategoryTree();
    auth = bearer("seller", seller._id);
  });

  const report = (type) => request(app).get(`/api/seller/business/reports/${type}`).set("Authorization", auth);

  it("snapshots the pre-GST cost on a POS sale and uses it in P&L", async () => {
    const incl = await fx.createProduct(seller, tree, { purchaseCost: 118, gstPercent: 18, purchaseGstType: "INCLUSIVE", stock: 10 });
    const excl = await fx.createProduct(seller, tree, { purchaseCost: 100, gstPercent: 18, purchaseGstType: "EXCLUSIVE", stock: 10 });
    const sale = await request(app).post("/api/seller/pos/sale").set("Authorization", auth)
      .set("Idempotency-Key", "e2e-purchase-gst-pos-sale-key-000000001")
      .send({
        items: [
          { productId: String(incl._id), quantity: 1, price: 150 },
          { productId: String(excl._id), quantity: 1, price: 150 },
        ],
        posPaymentMethod: "CASH",
        cashTendered: 300,
      });
    expect([200, 201]).toContain(sale.status);

    const order = await Order.findOne({ seller: seller._id }).lean();
    expect(order.items.map((i) => i.costPrice)).toEqual([100, 100]);

    const pnl = await report("pnl");
    expect(pnl.status).toBe(200);
    expect(pnl.body.result.totals.costOfGoodsSold).toBe(200);
  });

  it("values stock at the pre-GST cost", async () => {
    await fx.createProduct(seller, tree, { purchaseCost: 118, gstPercent: 18, purchaseGstType: "INCLUSIVE", stock: 3 });
    await fx.createProduct(seller, tree, { purchaseCost: 100, gstPercent: 18, purchaseGstType: "EXCLUSIVE", stock: 2 });
    const res = await report("stock");
    expect(res.status).toBe(200);
    expect(res.body.result.totals.value).toBe(500);
  });
});

describe("purchase bill integrity", () => {
  let seller;
  let tree;
  let auth;
  let product;
  let supplierId;
  beforeEach(async () => {
    seller = await fx.createSeller();
    tree = await fx.createCategoryTree();
    auth = bearer("seller", seller._id);
    product = await fx.createProduct(seller, tree, { gstPercent: 0, stock: 0 });
    const s = await request(app).post("/api/seller/business/suppliers").set("Authorization", auth).send({ name: "Wholesaler" });
    supplierId = s.body.result._id;
  });

  const post = (path, body) => request(app).post(`/api/seller/business${path}`).set("Authorization", auth).send(body);
  const put = (path, body) => request(app).put(`/api/seller/business${path}`).set("Authorization", auth).send(body);
  const line = (quantity, extra = {}) => ({ productId: String(product._id), quantity, cost: 10, ...extra });
  const stock = async (id = product._id) => (await Product.findById(id).lean()).stock;
  const supplierBalance = async () => (await PartyLedgerEntry.find({ party: supplierId }).lean())
    .reduce((s, e) => s + e.amount * e.effect, 0);

  it("caps returns at the billed quantity, across several returns", async () => {
    const b = await post("/purchases", { supplierId, billNo: "INV-1", confirm: true, items: [line(5)] });
    const id = b.body.result._id;
    expect((await post("/purchase-returns", { purchaseBillId: id, items: [line(3)] })).status).toBe(201);
    const over = await post("/purchase-returns", { purchaseBillId: id, items: [line(3)] });
    expect(over.status).toBe(409);
    expect(over.body.message).toMatch(/Only 2 unit/);
    expect((await post("/purchase-returns", { purchaseBillId: id, items: [line(2)] })).status).toBe(201);
    expect((await post("/purchase-returns", { purchaseBillId: id, items: [line(1)] })).status).toBe(409);
    expect(await stock()).toBe(0);
  });

  it("books the return to the bill's supplier", async () => {
    const b = await post("/purchases", { supplierId, billNo: "INV-2", confirm: true, items: [line(4)] });
    const r = await post("/purchase-returns", { purchaseBillId: b.body.result._id, supplierId: null, items: [line(1)] });
    expect(r.status).toBe(201);
    expect(String(r.body.result.supplier)).toBe(String(supplierId));
    expect(await supplierBalance()).toBe(30);
  });

  it("refuses to cancel a bill that has returns", async () => {
    const b = await post("/purchases", { supplierId, billNo: "INV-3", confirm: true, items: [line(5)] });
    await post("/purchase-returns", { purchaseBillId: b.body.result._id, items: [line(2)] });
    const c = await post(`/purchases/${b.body.result._id}/cancel`, {});
    expect(c.status).toBe(409);
    expect(await stock()).toBe(3);
    expect(await supplierBalance()).toBe(30);
  });

  it("cancels a bill without returns and reverses stock and dues", async () => {
    const b = await post("/purchases", { supplierId, billNo: "INV-4", confirm: true, items: [line(5)] });
    expect((await post(`/purchases/${b.body.result._id}/cancel`, {})).status).toBe(200);
    expect(await stock()).toBe(0);
    expect(await supplierBalance()).toBe(0);
  });

  it("won't edit a confirmed bill below the returned quantity", async () => {
    const b = await post("/purchases", { supplierId, billNo: "INV-5", confirm: true, items: [line(5)] });
    const id = b.body.result._id;
    await post("/purchase-returns", { purchaseBillId: id, items: [line(3)] });
    expect((await put(`/purchases/${id}`, { supplierId, billNo: "INV-5", items: [line(2)] })).status).toBe(409);
    const ok = await put(`/purchases/${id}`, { supplierId, billNo: "INV-5", items: [line(4)] });
    expect(ok.status).toBe(200);
    expect(await stock()).toBe(1);
  });

  it("rejects a duplicate bill number for the same supplier", async () => {
    expect((await post("/purchases", { supplierId, billNo: "DUP-1", items: [line(1)] })).status).toBe(201);
    expect((await post("/purchases", { supplierId, billNo: "DUP-1", items: [line(1)] })).status).toBe(409);
    // Different supplier (none) may reuse the number.
    expect((await post("/purchases", { billNo: "DUP-1", items: [line(1)] })).status).toBe(201);
    // Editing another bill onto the same number is refused too.
    const other = await post("/purchases", { supplierId, billNo: "DUP-2", items: [line(1)] });
    expect((await put(`/purchases/${other.body.result._id}`, { supplierId, billNo: "DUP-1", items: [line(1)] })).status).toBe(409);
    // Saving a bill under its own number is fine.
    expect((await put(`/purchases/${other.body.result._id}`, { supplierId, billNo: "DUP-2", items: [line(2)] })).status).toBe(200);
  });

  it("allows reusing the number of a cancelled bill", async () => {
    const b = await post("/purchases", { supplierId, billNo: "RE-1", items: [line(1)] });
    await post(`/purchases/${b.body.result._id}/cancel`, {});
    expect((await post("/purchases", { supplierId, billNo: "RE-1", items: [line(1)] })).status).toBe(201);
  });

  it("books a single-variant product on its variant stock", async () => {
    const p = await fx.createProduct(seller, tree, { stock: 0, variants: [{ name: "Only", sku: "ONE-1", price: 10, stock: 0 }] });
    const b = await post("/purchases", { billNo: "SV-1", confirm: true, items: [{ productId: String(p._id), quantity: 4, cost: 5 }] });
    expect(b.status).toBe(201);
    expect(b.body.result.items[0].variantSku).toBe("ONE-1");
    const after = await Product.findById(p._id).lean();
    expect(after.stock).toBe(4);
    expect(after.variants[0].stock).toBe(4);
  });
});
