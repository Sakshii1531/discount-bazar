/**
 * API E2E — "Edit This Bill" from a party ledger: correcting a posted bill
 * must move stock by the quantity difference and leave the party's ledger
 * balance exact, with no manual bookkeeping.
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
let milk;
let n = 0;
const key = () => `e2e-ledger-edit-key-${Date.now()}-${(n += 1)}`.padEnd(32, "0");
const stock = async (id) => (await Product.findById(id).lean()).stock;

beforeAll(async () => {
  app = await startTestApp();
  await fx.ensureIndexes();
});
afterAll(stopTestApp);
beforeEach(async () => {
  seller = await fx.createSeller();
  auth = bearer("seller", seller._id);
  milk = await fx.createProduct(seller, await fx.createCategoryTree(), { name: "Fresh Milk", price: 60, salePrice: 50, stock: 100 });
});
afterEach(clearDatabase);

const B = "/api/seller/business";
const ledgerOf = async (kind, id) => {
  const res = await request(app).get(`${B}/${kind}/${id}/ledger`).set("Authorization", auth);
  expect(res.status).toBe(200);
  return res.body.result;
};

describe("customer (udhaar) bill edit", () => {
  it("re-balances the customer ledger and stock when quantity, price or payment changes", async () => {
    const cust = await request(app).post(`${B}/customers`).set("Authorization", auth).send({ name: "Ravi", phone: "9876500011" });
    expect(cust.status).toBe(201);
    const customerId = cust.body.result._id;

    const sale = await request(app)
      .post("/api/seller/pos/sale")
      .set("Authorization", auth)
      .set("Idempotency-Key", key())
      .send({ items: [{ productId: String(milk._id), quantity: 2, price: 50 }], posPaymentMethod: "CREDIT", posCustomerId: customerId, amountPaid: 0 });
    expect([200, 201]).toContain(sale.status);
    const orderId = (sale.body.result.order || sale.body.result).orderId;
    expect(await stock(milk._id)).toBe(98);

    let ledger = await ledgerOf("customers", customerId);
    expect(ledger.balance).toBe(100);
    // The ledger row carries what the UI needs to open "Edit bill".
    expect(ledger.entries[0]).toEqual(expect.objectContaining({ kind: "SALE", refModel: "Order", refNo: orderId }));

    // Cashier scanned 2 instead of 3 and gave the wrong price.
    const edit = await request(app)
      .put(`/api/seller/pos/sales/${orderId}`)
      .set("Authorization", auth)
      .send({ items: [{ productId: String(milk._id), quantity: 3, price: 45 }], posPaymentMethod: "CREDIT", posCustomerId: customerId, amountPaid: 35, reason: "Wrong count" });
    expect(edit.status).toBe(200);
    expect(await stock(milk._id)).toBe(97);

    ledger = await ledgerOf("customers", customerId);
    // 3 x 45 = 135 on credit, 35 paid at billing -> 100 still owed; one SALE row only.
    expect(ledger.entries.filter((e) => e.kind === "SALE").map((e) => e.amount)).toEqual([135]);
    expect(ledger.balance).toBe(100);

    // Wrong payment method: it was actually paid in cash -> nothing owed.
    const toCash = await request(app)
      .put(`/api/seller/pos/sales/${orderId}`)
      .set("Authorization", auth)
      .send({ items: [{ productId: String(milk._id), quantity: 3, price: 45 }], posPaymentMethod: "CASH", reason: "Paid cash" });
    expect(toCash.status).toBe(200);
    ledger = await ledgerOf("customers", customerId);
    expect(ledger.entries).toEqual([]);
    expect(ledger.balance).toBe(0);
    expect(await stock(milk._id)).toBe(97);
  });
});

describe("supplier bill edit", () => {
  it("opens a confirmed bill for editing and reconciles stock and the supplier balance", async () => {
    const sup = await request(app).post(`${B}/suppliers`).set("Authorization", auth).send({ name: "Big Distributor", phone: "9876500022" });
    const supplierId = sup.body.result._id;
    const bill = await request(app)
      .post(`${B}/purchases`)
      .set("Authorization", auth)
      .send({ supplierId, billNo: "INV-9", items: [{ productId: String(milk._id), quantity: 10, cost: 30 }], amountPaid: 100, paymentMethod: "CASH", confirm: true });
    expect(bill.status).toBe(201);
    const billId = bill.body.result._id;
    if (bill.body.result.status !== "CONFIRMED") {
      expect((await request(app).post(`${B}/purchases/${billId}/confirm`).set("Authorization", auth)).status).toBe(200);
    }
    expect(await stock(milk._id)).toBe(110);
    let ledger = await ledgerOf("suppliers", supplierId);
    expect(ledger.balance).toBe(200); // 300 billed - 100 paid
    expect(ledger.entries.find((e) => e.kind === "PURCHASE")).toEqual(
      expect.objectContaining({ refModel: "PurchaseBill", refId: billId }),
    );

    // "Edit bill" from the ledger loads the bill…
    const opened = await request(app).get(`${B}/purchases/${billId}`).set("Authorization", auth);
    expect(opened.status).toBe(200);
    expect(opened.body.result.billNo).toBe("INV-9");

    // …and saving the correction (8 received, not 10) fixes stock and balance.
    const saved = await request(app)
      .put(`${B}/purchases/${billId}`)
      .set("Authorization", auth)
      .send({ supplierId, billNo: "INV-9", items: [{ productId: String(milk._id), quantity: 8, cost: 30 }], amountPaid: 100, paymentMethod: "CASH" });
    expect(saved.status).toBe(200);
    expect(await stock(milk._id)).toBe(108);
    ledger = await ledgerOf("suppliers", supplierId);
    expect(ledger.balance).toBe(140); // 240 billed - 100 paid
    expect(ledger.entries.filter((e) => e.kind === "PURCHASE").map((e) => e.amount)).toEqual([240]);
  });
});
