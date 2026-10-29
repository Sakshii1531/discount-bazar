/**
 * API E2E — seller panel stock, order and cash-register integrity
 * (seller test plan sections 2, 3, 5, 6, 7 and 13). Each case is a
 * regression test for a bug found while working through the plan.
 */
import { jest } from "@jest/globals";
import request from "supertest";
import { startTestApp, stopTestApp, clearDatabase, bearer } from "./helpers/testApp.js";
import * as fx from "./helpers/fixtures.js";
import Product from "../../app/models/product.js";
import Order from "../../app/models/order.js";
import StockHistory from "../../app/models/stockHistory.js";
import Expense from "../../app/models/expense.js";
import CashDay from "../../app/models/cashDay.js";
import PartyLedgerEntry from "../../app/models/partyLedgerEntry.js";
import { releaseReservedStockForOrder } from "../../app/services/stockService.js";

jest.setTimeout(120000);

let app;
let seller;
let auth;
let tree;
let customer;
let seq = 0;

beforeAll(async () => {
  app = await startTestApp();
  await fx.ensureIndexes();
});
afterAll(stopTestApp);
beforeEach(async () => {
  seller = await fx.createSeller();
  auth = bearer("seller", seller._id);
  tree = await fx.createCategoryTree();
  customer = await fx.createCustomer();
});
afterEach(async () => {
  jest.restoreAllMocks();
  await clearDatabase();
});

const stockOf = async (id) => (await Product.findById(id).lean()).stock;
const adjust = (body) => request(app).post("/api/products/adjust-stock").set("Authorization", auth).send(body);

async function makeOrder(product, overrides = {}) {
  seq += 1;
  const order = await Order.create({
    orderId: `ORDSI${Date.now()}${seq}`,
    customer: customer._id,
    seller: seller._id,
    items: [{ product: product._id, name: product.name, quantity: 2, price: 50 }],
    address: { name: "Asha", address: "12 MG Road", city: "Indore", phone: "9999999999" },
    workflowVersion: 2,
    workflowStatus: "SELLER_PENDING",
    status: "pending",
    sellerPendingExpiresAt: new Date(Date.now() + 3600000),
    paymentMode: "COD",
    paymentStatus: "PENDING_CASH_COLLECTION",
    stockReservation: { status: "COMMITTED", reservedAt: new Date() },
    pricing: { subtotal: 100, total: 100 },
    paymentBreakdown: { productSubtotal: 100, grandTotal: 100 },
    ...overrides,
  });
  return order.toObject();
}

describe("manual stock adjustment", () => {
  it("refuses a correction larger than the stock instead of clamping it to 0", async () => {
    const p = await fx.createProduct(seller, tree, { stock: 2 });
    const res = await adjust({ productId: String(p._id), type: "Correction", quantity: 5 });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/only 2 in stock/);
    expect(await stockOf(p._id)).toBe(2);
    expect(await StockHistory.countDocuments({ product: p._id })).toBe(0);
  });

  it("does not lose concurrent adjustments (each one is an atomic $inc)", async () => {
    const p = await fx.createProduct(seller, tree, { stock: 10 });
    const results = await Promise.all(
      Array.from({ length: 8 }, () => adjust({ productId: String(p._id), type: "Restock", quantity: 1 })),
    );
    results.forEach((r) => expect(r.status).toBe(200));
    expect(await stockOf(p._id)).toBe(18);
    const logged = await StockHistory.find({ product: p._id }).lean();
    expect(logged.reduce((s, h) => s + h.quantity, 0)).toBe(8);
  });

  it("requires the variant on a multi-variant product and keeps master stock = sum of variants", async () => {
    const p = await fx.createProduct(seller, tree, {
      stock: 8,
      variants: [
        { name: "500 g", sku: "TEA-500", price: 50, stock: 5 },
        { name: "1 kg", sku: "TEA-1K", price: 90, stock: 3 },
      ],
    });
    const blind = await adjust({ productId: String(p._id), type: "Restock", quantity: 4 });
    expect(blind.status).toBe(400);
    expect(await stockOf(p._id)).toBe(8);

    const ok = await adjust({ productId: String(p._id), variantSku: "tea-1k", type: "Restock", quantity: 4 });
    expect(ok.status).toBe(200);
    const saved = await Product.findById(p._id).lean();
    expect(saved.variants.map((v) => v.stock)).toEqual([5, 7]);
    expect(saved.stock).toBe(12);
  });

  it("starts an untracked variant's stock from 0", async () => {
    const p = await fx.createProduct(seller, tree, {
      stock: 0,
      variants: [{ name: "Loose", sku: "RICE-L", price: 40, stock: null }],
    });
    const res = await adjust({ productId: String(p._id), variantSku: "RICE-L", type: "Restock", quantity: 6 });
    expect(res.status).toBe(200);
    expect(await stockOf(p._id)).toBe(6);
  });
});

describe("seller product edit", () => {
  it("keeps a sale that lands while the edit is being saved", async () => {
    const p = await fx.createProduct(seller, tree, { stock: 10 });
    const original = Product.findOneAndUpdate.bind(Product);
    let sold = false;
    jest.spyOn(Product, "findOneAndUpdate").mockImplementation(function (filter, update, ...rest) {
      if (!sold && update?.$set?.name === "Renamed Milk") {
        sold = true;
        // A POS sale of 3 commits between the edit's read and its write.
        return Product.updateOne({ _id: p._id }, { $inc: { stock: -3 } }).then(() =>
          original(filter, update, ...rest),
        );
      }
      return original(filter, update, ...rest);
    });

    const res = await request(app).put(`/api/products/${p._id}`).set("Authorization", auth).send({ name: "Renamed Milk" });
    expect(res.status).toBe(200);
    const saved = await Product.findById(p._id).lean();
    expect(saved.name).toBe("Renamed Milk");
    expect(saved.stock).toBe(7);
  });
});

describe("stock release on cancellation", () => {
  it("restores stock exactly once when two cancellations race", async () => {
    const p = await fx.createProduct(seller, tree, { stock: 10 });
    const order = await makeOrder(p);
    const [a, b] = await Promise.all([Order.findById(order._id), Order.findById(order._id)]);
    const released = await Promise.all([
      releaseReservedStockForOrder(a, { reason: "Cancelled" }),
      releaseReservedStockForOrder(b, { reason: "Cancelled" }),
    ]);
    expect(released.filter(Boolean)).toHaveLength(1);
    expect(await stockOf(p._id)).toBe(12);
    expect(await StockHistory.countDocuments({ order: order._id, type: "Release" })).toBe(1);
  });
});

describe("seller order acceptance", () => {
  const accept = (orderId, as = auth) =>
    request(app).put(`/api/orders/status/${orderId}`).set("Authorization", as).send({ status: "confirmed" });

  it("cannot accept an online order whose payment has not been captured", async () => {
    const p = await fx.createProduct(seller, tree);
    const order = await makeOrder(p, {
      workflowStatus: "CREATED",
      paymentMode: "ONLINE",
      paymentStatus: "CREATED",
      stockReservation: { status: "RESERVED", reservedAt: new Date() },
    });
    const res = await accept(order.orderId);
    expect(res.status).toBe(409);
    const fresh = await Order.findById(order._id).lean();
    expect(fresh.workflowStatus).toBe("CREATED");
    expect(fresh.status).toBe("pending");
  });

  it("re-accepting an order that already has a rider does not restart the rider search", async () => {
    const p = await fx.createProduct(seller, tree);
    const rider = await fx.createDelivery();
    const order = await makeOrder(p, { workflowStatus: "DELIVERY_ASSIGNED", status: "confirmed", deliveryBoy: rider._id });
    const res = await accept(order.orderId);
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/already accepted/i);
    const fresh = await Order.findById(order._id).lean();
    expect(fresh.workflowStatus).toBe("DELIVERY_ASSIGNED");
    expect(String(fresh.deliveryBoy)).toBe(String(rider._id));
  });

  it("another seller cannot touch the order", async () => {
    const p = await fx.createProduct(seller, tree);
    const order = await makeOrder(p);
    const other = await fx.createSeller();
    const res = await accept(order.orderId, bearer("seller", other._id));
    expect(res.status).toBe(403);
    expect((await Order.findById(order._id).lean()).workflowStatus).toBe("SELLER_PENDING");
  });
});

describe("seller revenue", () => {
  it("does not count an unpaid online order as revenue", async () => {
    const p = await fx.createProduct(seller, tree);
    await makeOrder(p, { workflowStatus: "DELIVERED", status: "delivered" });
    await makeOrder(p, {
      workflowStatus: "CREATED",
      paymentMode: "ONLINE",
      paymentStatus: "CREATED",
      pricing: { subtotal: 500, total: 500 },
    });
    const earnings = await request(app).get("/api/seller/earnings").set("Authorization", auth);
    expect(earnings.status).toBe(200);
    expect(earnings.body.result.balances.totalRevenue).toBe(100);

    const stats = await request(app).get("/api/seller/stats").set("Authorization", auth);
    expect(stats.status).toBe(200);
    expect(stats.body.result.overview.totalSales).toBe("₹100");
    expect(stats.body.result.overview.totalOrders).toBe("1");
  });
});

describe("cash register", () => {
  const B = "/api/seller/business";
  const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

  it("does not let a closed day's expense be deleted, and 404s an unknown expense", async () => {
    const add = await request(app).post(`${B}/expenses`).set("Authorization", auth).send({ category: "Rent", amount: 500, method: "CASH" });
    expect(add.status).toBe(201);
    const expenseId = add.body.result._id;

    const close = await request(app).post(`${B}/cash-register/close`).set("Authorization", auth).send({ dateKey: today() });
    expect(close.status).toBe(200);

    const del = await request(app).delete(`${B}/expenses/${expenseId}`).set("Authorization", auth);
    expect(del.status).toBe(423);
    expect(await Expense.countDocuments({ _id: expenseId })).toBe(1);

    const missing = await request(app).delete(`${B}/expenses/${"a".repeat(24)}`).set("Authorization", auth);
    expect(missing.status).toBe(404);
  });

  it("refuses to re-close a closed day and records every close/reopen", async () => {
    const dateKey = today();
    const close = (counted) =>
      request(app).post(`${B}/cash-register/close`).set("Authorization", auth).send({ dateKey, countedClosingCash: counted });

    expect((await close(1200)).status).toBe(200);
    const again = await close(50);
    expect(again.status).toBe(409);
    expect((await CashDay.findOne({ seller: seller._id, dateKey }).lean()).countedClosingCash).toBe(1200);

    const reopen = (body) => request(app).post(`${B}/cash-register/reopen`).set("Authorization", auth).send({ dateKey, ...body });
    expect((await reopen({})).status).toBe(400);
    expect((await reopen({ reason: "Recount the drawer" })).status).toBe(200);
    expect((await reopen({ reason: "Again" })).status).toBe(409);
    expect((await close(1300)).status).toBe(200);

    const day = await CashDay.findOne({ seller: seller._id, dateKey }).lean();
    expect(day.history.map((h) => [h.action, h.countedClosingCash ?? null, h.reason || ""])).toEqual([
      ["CLOSED", 1200, ""],
      ["REOPENED", null, "Recount the drawer"],
      ["CLOSED", 1300, ""],
    ]);
  });
});

describe("POS GST after discount", () => {
  let n = 0;
  const key = () => `e2e-seller-gst-${Date.now()}-${(n += 1)}`.padEnd(32, "0");
  const sell = (body) =>
    request(app).post("/api/seller/pos/sale").set("Authorization", auth).set("Idempotency-Key", key()).send(body);
  const preview = (body) => request(app).post("/api/seller/pos/sale/preview").set("Authorization", auth).send(body);

  it("taxes the discounted amount on an exclusive-GST bill", async () => {
    const p = await fx.createProduct(seller, tree, { price: 100, stock: 5, gstPercent: 18 });
    const body = { items: [{ productId: String(p._id), quantity: 1, price: 100 }], discount: 10, isTaxInclusive: false };

    const pre = await preview(body);
    expect(pre.status).toBe(200);
    expect(pre.body.result).toEqual(expect.objectContaining({ taxTotal: 16.2, grandTotal: 106.2, discountTotal: 10 }));

    const sale = await sell({ ...body, posPaymentMethod: "CARD" });
    expect([200, 201]).toContain(sale.status);
    const pb = sale.body.result.order.paymentBreakdown;
    expect(pb.taxTotal).toBe(16.2);
    expect(pb.grandTotal).toBe(106.2);
  });

  it("shows the GST inside the discounted price on an inclusive bill", async () => {
    const p = await fx.createProduct(seller, tree, { price: 100, stock: 5, gstPercent: 18 });
    const sale = await sell({
      items: [{ productId: String(p._id), quantity: 1, price: 100 }],
      discount: 10,
      posPaymentMethod: "CASH",
    });
    expect([200, 201]).toContain(sale.status);
    const pb = sale.body.result.order.paymentBreakdown;
    expect(pb.grandTotal).toBe(90);
    expect(pb.taxTotal).toBe(13.73);
  });
});

describe("udhaar payments", () => {
  const B = "/api/seller/business";
  let n = 0;
  const key = () => `e2e-seller-udh-${Date.now()}-${(n += 1)}`.padEnd(32, "0");

  async function creditSale(amount) {
    const p = await fx.createProduct(seller, tree, { price: amount, stock: 5 });
    const cust = await request(app).post(`${B}/customers`).set("Authorization", auth).send({ name: "Ravi", phone: "9876500044" });
    expect(cust.status).toBe(201);
    const sale = await request(app)
      .post("/api/seller/pos/sale")
      .set("Authorization", auth)
      .set("Idempotency-Key", key())
      .send({ items: [{ productId: String(p._id), quantity: 1, price: amount }], posPaymentMethod: "CREDIT", posCustomerId: cust.body.result._id });
    expect([200, 201]).toContain(sale.status);
    return cust.body.result._id;
  }
  const pay = (partyId, amount, clientRef) =>
    request(app).post(`${B}/payments`).set("Authorization", auth).send({ partyType: "CUSTOMER", partyId, amount, method: "CASH", clientRef });
  const balance = async (partyId) =>
    (await request(app).get(`${B}/customers/${partyId}/ledger`).set("Authorization", auth)).body.result.balance;

  it("refuses a payment larger than the udhaar due", async () => {
    const cust = await creditSale(300);
    const res = await pay(cust, 400);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/300/);
    expect(await balance(cust)).toBe(300);
  });

  it("records a resubmitted payment once", async () => {
    const cust = await creditSale(300);
    const ref = "pay-ref-0001";
    const [a, b] = await Promise.all([pay(cust, 100, ref), pay(cust, 100, ref)]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(String(a.body.result._id)).toBe(String(b.body.result._id));
    expect((await pay(cust, 100, ref)).status).toBe(201);
    expect(await PartyLedgerEntry.countDocuments({ party: cust, kind: "PAYMENT" })).toBe(1);
    expect(await balance(cust)).toBe(200);

    // Paying off the rest brings the balance to zero.
    expect((await pay(cust, 200, "pay-ref-0002")).status).toBe(201);
    expect(await balance(cust)).toBe(0);
  });
});

describe("purchase bill ledger", () => {
  const B = "/api/seller/business";

  it("keeps the original entries and reverses them when a bill is edited or cancelled", async () => {
    const p = await fx.createProduct(seller, tree, { stock: 0 });
    const sup = await request(app).post(`${B}/suppliers`).set("Authorization", auth).send({ name: "Kirana Wholesale" });
    expect(sup.status).toBe(201);
    const supplierId = sup.body.result._id;
    const bill = await request(app).post(`${B}/purchases`).set("Authorization", auth).send({
      supplierId, billNo: "PB-1", items: [{ productId: String(p._id), quantity: 10, cost: 20 }],
      amountPaid: 50, paymentMethod: "CASH", confirm: true,
    });
    expect(bill.status).toBe(201);
    const billId = bill.body.result._id;
    const supplierBalance = async () =>
      (await request(app).get(`${B}/suppliers/${supplierId}/ledger`).set("Authorization", auth)).body.result.balance;
    expect(await supplierBalance()).toBe(150);

    const edit = await request(app).put(`${B}/purchases/${billId}`).set("Authorization", auth).send({
      supplierId, billNo: "PB-1", items: [{ productId: String(p._id), quantity: 12, cost: 20 }], amountPaid: 50, paymentMethod: "CASH",
    });
    expect(edit.status).toBe(200);
    expect(await supplierBalance()).toBe(190);
    const afterEdit = await PartyLedgerEntry.find({ refId: billId }).lean();
    // 2 originals (voided) + 2 reversals (voided) + 2 live entries for the edited bill
    expect(afterEdit).toHaveLength(6);
    expect(afterEdit.filter((e) => !e.voided).map((e) => [e.kind, e.amount]).sort()).toEqual([["PAYMENT", 50], ["PURCHASE", 240]]);
    expect(afterEdit.filter((e) => e.reverses)).toHaveLength(2);

    // The cash book counts the supplier payment once.
    const paid = await request(app).get(`${B}/accounts/payments`).set("Authorization", auth);
    expect(paid.status).toBe(200);
    const supplierRows = paid.body.result.rows.filter((r) => r.type === "Supplier Payment");
    expect(supplierRows.map((r) => r.amount)).toEqual([50]);
    expect(paid.body.result.totals.byType["Supplier Payment"]).toBe(50);

    const cancel = await request(app).post(`${B}/purchases/${billId}/cancel`).set("Authorization", auth);
    expect(cancel.status).toBe(200);
    expect(await supplierBalance()).toBe(0);
    expect(await PartyLedgerEntry.countDocuments({ refId: billId })).toBe(8);
  });
});
