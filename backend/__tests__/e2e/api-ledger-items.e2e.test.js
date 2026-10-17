/**
 * API E2E — party ledger statement carries the item lines of each bill:
 * supplier purchase bills / purchase returns and customer credit sales /
 * sale returns, with variant names resolved; payments carry none.
 */
import { jest } from "@jest/globals";
import request from "supertest";
import { startTestApp, stopTestApp, clearDatabase, bearer } from "./helpers/testApp.js";
import * as fx from "./helpers/fixtures.js";

jest.setTimeout(120000);

let app;
beforeAll(async () => {
  app = await startTestApp();
  await fx.ensureIndexes();
});
afterEach(clearDatabase);
afterAll(stopTestApp);

const B = "/api/seller/business";

describe("ledger statement item details", () => {
  let S;
  let oil;
  let bread;
  beforeEach(async () => {
    const seller = await fx.createSeller();
    const tree = await fx.createCategoryTree();
    S = bearer("seller", seller._id);
    oil = await fx.createProduct(seller, tree, {
      name: "Sunflower Oil",
      stock: 50,
      variants: [
        { name: "1 Litre", sku: "OIL-1L", price: 150, salePrice: 140, stock: 30, purchaseCost: 110 },
        { name: "5 Litre", sku: "OIL-5L", price: 700, salePrice: 0, stock: 20, purchaseCost: 520 },
      ],
    });
    bread = await fx.createProduct(seller, tree, { name: "Brown Bread", stock: 40 });
  });

  const post = (path, body, headers = {}) => request(app).post(`${B}${path}`).set("Authorization", S).set(headers).send(body);
  const ledger = async (kind, id) => {
    const res = await request(app).get(`${B}/${kind}/${id}/ledger`).set("Authorization", S);
    expect(res.status).toBe(200);
    return res.body.result || res.body.data;
  };

  it("shows purchased and returned products in the supplier ledger", async () => {
    const supplierId = (await post("/suppliers", { name: "Oil Depot" })).body.result._id;
    const bill = await post("/purchases", {
      supplierId, billNo: "OD-1", amountPaid: 500, paymentMethod: "CASH",
      items: [
        { productId: String(oil._id), variantSku: "OIL-5L", quantity: 4, cost: 520, gstPercent: 5 },
        { productId: String(bread._id), quantity: 10, cost: 25 },
      ],
    });
    expect(bill.status).toBe(201);
    expect((await request(app).post(`${B}/purchases/${bill.body.result._id}/confirm`).set("Authorization", S)).status).toBe(200);
    const ret = await post("/purchase-returns", {
      supplierId, purchaseBillId: bill.body.result._id, reason: "Leaking",
      items: [{ productId: String(oil._id), variantSku: "OIL-5L", quantity: 1, cost: 520, gstPercent: 5 }],
    });
    expect(ret.status).toBe(201);

    const { entries } = await ledger("suppliers", supplierId);
    const purchase = entries.find((e) => e.kind === "PURCHASE");
    expect(purchase.items).toEqual([
      expect.objectContaining({ name: "Sunflower Oil", variant: "5 Litre", quantity: 4, rate: 520, gstPercent: 5 }),
      expect.objectContaining({ name: "Brown Bread", variant: "", quantity: 10, rate: 25 }),
    ]);
    expect(purchase.items[1].amount).toBe(250);

    const payment = entries.find((e) => e.kind === "PAYMENT");
    expect(payment.items).toEqual([]);

    const pr = entries.find((e) => e.kind === "PURCHASE_RETURN");
    expect(pr.items).toEqual([expect.objectContaining({ name: "Sunflower Oil", variant: "5 Litre", quantity: 1, rate: 520 })]);
  });

  it("shows sold and returned products in the customer ledger", async () => {
    const customerId = (await post("/customers", { name: "Sharma Ji", phone: "9000022222" })).body.result._id;
    const sale = await request(app).post("/api/seller/pos/sale").set("Authorization", S)
      .set("Idempotency-Key", "e2e-ledger-items-credit-sale-key-000001")
      .send({
        posPaymentMethod: "CREDIT", posCustomerId: customerId,
        items: [
          { productId: String(oil._id), variantSku: "OIL-1L", quantity: 3, price: 140 },
          { productId: String(bread._id), quantity: 2, price: 45 },
        ],
      });
    expect([200, 201]).toContain(sale.status);
    const order = sale.body.result.order || sale.body.result;

    const ret = await request(app).post("/api/seller/pos/returns").set("Authorization", S).send({
      orderId: order.orderId, refundMethod: "CREDIT",
      items: [{ productId: String(oil._id), variantSlot: "OIL-1L", quantity: 1, condition: "good" }],
    });
    expect([200, 201]).toContain(ret.status);

    const { entries } = await ledger("customers", customerId);
    const saleRow = entries.find((e) => e.kind === "SALE");
    expect(saleRow.refNo).toBe(order.orderId);
    expect(saleRow.items).toEqual([
      expect.objectContaining({ variant: "1 Litre", quantity: 3, rate: 140, amount: 420 }),
      expect.objectContaining({ name: "Brown Bread", quantity: 2, rate: 45, amount: 90 }),
    ]);
    expect(saleRow.items[0].name).toMatch(/Sunflower Oil/);

    const retRow = entries.find((e) => e.kind === "SALE_RETURN");
    expect(retRow.items).toEqual([expect.objectContaining({ variant: "1 Litre", quantity: 1, rate: 140, amount: 140 })]);
  });
});
