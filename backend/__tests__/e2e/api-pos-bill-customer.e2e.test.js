/**
 * API E2E — a POS bill for a selected ledger customer carries that customer's
 * name/phone (Sales History, return lookup, receipts) instead of "Walk-in".
 */
import { jest } from "@jest/globals";
import request from "supertest";
import { startTestApp, stopTestApp, clearDatabase, bearer } from "./helpers/testApp.js";
import * as fx from "./helpers/fixtures.js";

jest.setTimeout(120000);

let app;
let auth;
let milk;
let ravi;
let sita;
let n = 0;
const key = () => `e2e-pos-bill-customer-${Date.now()}-${(n += 1)}`.padEnd(32, "0");
const B = "/api/seller/business";

beforeAll(async () => {
  app = await startTestApp();
  await fx.ensureIndexes();
});
afterAll(stopTestApp);
beforeEach(async () => {
  const seller = await fx.createSeller();
  auth = bearer("seller", seller._id);
  milk = await fx.createProduct(seller, await fx.createCategoryTree(), { name: "Fresh Milk", price: 60, salePrice: 50, stock: 100 });
  const add = async (name, phone) => (await request(app).post(`${B}/customers`).set("Authorization", auth).send({ name, phone })).body.result;
  ravi = await add("Ravi Kumar", "9876500011");
  sita = await add("Sita Devi", "9876500022");
});
afterEach(clearDatabase);

const sell = (body) =>
  request(app)
    .post("/api/seller/pos/sale")
    .set("Authorization", auth)
    .set("Idempotency-Key", key())
    .send({ items: [{ productId: String(milk._id), quantity: 1, price: 50 }], posPaymentMethod: "CASH", ...body });
const orderOf = (res) => res.body.result.order || res.body.result;
const salesHistory = async () => (await request(app).get("/api/seller/pos/sales").set("Authorization", auth)).body.result.items;

describe("POS bill customer", () => {
  it("a bill for a selected customer stores their name and phone", async () => {
    const res = await sell({ posCustomerId: ravi._id });
    expect([200, 201]).toContain(res.status);
    expect(orderOf(res).walkInCustomer).toMatchObject({ name: "Ravi Kumar", phone: "9876500011" });

    const [row] = await salesHistory();
    expect(row.walkInCustomer).toMatchObject({ name: "Ravi Kumar" });
    expect(row.posCustomer).toMatchObject({ _id: ravi._id, name: "Ravi Kumar", phone: "9876500011" });

    const lookup = await request(app).get(`/api/seller/pos/returns/order/${orderOf(res).orderId}`).set("Authorization", auth);
    expect(lookup.body.result.order.posCustomer).toMatchObject({ name: "Ravi Kumar" });
  });

  it("details the cashier typed are kept; blank ones come from the customer", async () => {
    const res = await sell({ posCustomerId: ravi._id, walkInCustomer: { name: "Ravi (shop)", phone: "" } });
    expect(orderOf(res).walkInCustomer).toMatchObject({ name: "Ravi (shop)", phone: "9876500011" });
  });

  it("a plain walk-in sale stays a walk-in", async () => {
    const res = await sell({});
    expect(orderOf(res).walkInCustomer?.name || "").toBe("");
    const [row] = await salesHistory();
    expect(row.posCustomer ?? null).toBeNull();
  });

  it("re-linking a bill to another customer on edit updates the printed name", async () => {
    const res = await sell({ posCustomerId: ravi._id });
    const orderId = orderOf(res).orderId;
    const edit = await request(app)
      .put(`/api/seller/pos/sales/${orderId}`)
      .set("Authorization", auth)
      .send({ items: [{ productId: String(milk._id), quantity: 1, price: 50 }], posCustomerId: sita._id, reason: "Wrong customer" });
    expect(edit.status).toBe(200);
    const [row] = await salesHistory();
    expect(row.walkInCustomer).toMatchObject({ name: "Sita Devi", phone: "9876500022" });
    expect(row.posCustomer).toMatchObject({ name: "Sita Devi" });
  });
});
