/**
 * API E2E — every coupon strategy stores only its own fields and is
 * enforced at checkout.
 */
import { jest } from "@jest/globals";
import request from "supertest";
import { startTestApp, stopTestApp } from "./helpers/testApp.js";
import { seedWorld } from "./helpers/world.js";
import { AT_CUSTOMER } from "./helpers/flows.js";
import * as fx from "./helpers/fixtures.js";
import Coupon from "../../app/models/coupon.js";

jest.setTimeout(180000);

let app;
let ctx;
let otherTree;
let otherCatProduct;
beforeAll(async () => {
  app = await startTestApp();
  ctx = await seedWorld();
  otherTree = await fx.createCategoryTree();
  otherCatProduct = await fx.createProduct(ctx.seller, otherTree, { name: "Shampoo", price: 200, salePrice: 200, stock: 50 });
});
afterAll(stopTestApp);

const DATES = { validFrom: "2026-01-01", validTill: "2099-01-01" };
const ADDRESS = { name: "Main Customer", address: "12 MG Road, Indore", city: "Indore", phone: "9999999999", location: AT_CUSTOMER };
const create = (body) => request(app).post("/api/admin/coupons").set("Authorization", ctx.auth.admin).send({ ...DATES, ...body });
const update = (id, body) => request(app).put(`/api/admin/coupons/${id}`).set("Authorization", ctx.auth.admin).send(body);
const preview = (items, couponCode) =>
  request(app).post("/api/orders/checkout/preview").set("Authorization", ctx.auth.customer).send({ items, address: ADDRESS, couponCode });
const milk = (quantity = 1) => ({ product: String(ctx.milk._id), quantity }); // ₹55 each

describe("saving each strategy", () => {
  it("free delivery needs no amount and stores none", async () => {
    const res = await create({ code: "SHIPFREE", couponType: "free_delivery", discountType: "percentage", discountValue: 40, maxDiscount: 99 });
    expect(res.status).toBe(201);
    expect(res.body.result).toMatchObject({ discountType: "free_delivery", discountValue: 0 });
    expect(res.body.result.maxDiscount ?? null).toBeNull();
  });

  it("a free-delivery kind on another strategy also drops the amount", async () => {
    const res = await create({ code: "BIGSHIP", couponType: "min_order_value", minOrderValue: 100, discountType: "free_delivery", discountValue: 25 });
    expect(res.status).toBe(201);
    expect(res.body.result).toMatchObject({ discountType: "free_delivery", discountValue: 0, minOrderValue: 100 });
  });

  it.each([
    ["percentage over 100", { code: "BAD1", discountType: "percentage", discountValue: 150 }, /between 1 and 100/],
    ["fixed without amount", { code: "BAD2", discountType: "fixed", discountValue: 0 }, /more than ₹0/],
    ["min order value without a minimum", { code: "BAD3", couponType: "min_order_value", discountType: "fixed", discountValue: 20 }, /minimum cart total/],
    ["bulk without item count", { code: "BAD4", couponType: "bulk_order", discountType: "percentage", discountValue: 5 }, /at least 2 items/],
    ["category without categories", { code: "BAD5", couponType: "category_based", discountType: "percentage", discountValue: 5 }, /at least one category/],
    ["VIP without spend", { code: "BAD6", couponType: "monthly_volume", discountType: "percentage", discountValue: 5 }, /monthly spend/],
    ["end before start", { code: "BAD7", discountType: "fixed", discountValue: 5, validFrom: "2026-05-01", validTill: "2026-04-01" }, /after the start date/],
    ["flat discount larger than the minimum", { code: "BAD8", couponType: "min_order_value", minOrderValue: 50, discountType: "fixed", discountValue: 80 }, /cannot be more than the minimum/],
  ])("rejects %s", async (_name, body, message) => {
    const res = await create(body);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(message);
  });

  it("clears fields that do not belong to the strategy", async () => {
    const res = await create({
      code: "PLAIN10",
      couponType: "generic",
      discountType: "fixed",
      discountValue: 10,
      maxDiscount: 500,
      minItems: 9,
      monthlyVolumeThreshold: 999,
      applicableCategories: [String(ctx.tree.header._id)],
      usedCount: 50,
    });
    expect(res.status).toBe(201);
    const saved = await Coupon.findById(res.body.result._id).lean();
    expect(saved).toMatchObject({ minItems: 0, applicableCategories: [], usedCount: 0 });
    expect(saved.maxDiscount ?? null).toBeNull();
    expect(saved.monthlyVolumeThreshold ?? null).toBeNull();
  });

  it("switching an existing coupon's strategy validates the whole coupon", async () => {
    const id = (await Coupon.findOne({ code: "PLAIN10" }).lean())._id;
    expect((await update(id, { couponType: "bulk_order" })).status).toBe(400);
    const ok = await update(id, { couponType: "bulk_order", minItems: 3 });
    expect(ok.status).toBe(200);
    expect(ok.body.result).toMatchObject({ couponType: "bulk_order", minItems: 3, discountValue: 10 });
  });
});

describe("each strategy is enforced at checkout", () => {
  beforeAll(async () => {
    await create({ code: "BULK3", couponType: "bulk_order", minItems: 3, discountType: "fixed", discountValue: 20 });
    await create({ code: "MOV100", couponType: "min_order_value", minOrderValue: 100, discountType: "percentage", discountValue: 10, maxDiscount: 5 });
    await create({ code: "CATDEAL", couponType: "category_based", applicableCategories: [String(otherTree.header._id)], discountType: "fixed", discountValue: 30 });
    await create({ code: "VIP5K", couponType: "monthly_volume", monthlyVolumeThreshold: 5000, discountType: "fixed", discountValue: 100 });
  });

  it("bulk order: needs the item count", async () => {
    expect((await preview([milk(2)], "BULK3")).status).toBe(400);
    const ok = await preview([milk(3)], "BULK3");
    expect(ok.status).toBe(200);
    expect(ok.body.result.breakdown.discountTotal).toBe(20);
  });

  it("minimum order value: needs the cart total, and the % is capped", async () => {
    expect((await preview([milk(1)], "MOV100")).status).toBe(400);
    const ok = await preview([milk(2)], "MOV100"); // ₹110 → 10% = 11, capped at 5
    expect(ok.status).toBe(200);
    expect(ok.body.result.breakdown.discountTotal).toBe(5);
  });

  it("category-based: only with a product from the chosen category", async () => {
    expect((await preview([milk(2)], "CATDEAL")).status).toBe(400);
    const ok = await preview([milk(1), { product: String(otherCatProduct._id), quantity: 1 }], "CATDEAL");
    expect(ok.status).toBe(200);
    expect(ok.body.result.breakdown.discountTotal).toBe(30);
  });

  it("VIP: refused for a customer below the monthly spend", async () => {
    const res = await preview([milk(2)], "VIP5K");
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/spent ₹5,000 this month. You have spent ₹0 so far — ₹5,000 more/);
  });

  it("free delivery: removes the delivery fee and gives no product discount", async () => {
    const res = await preview([milk(1)], "SHIPFREE");
    expect(res.status).toBe(200);
    expect(res.body.result.breakdown).toMatchObject({ deliveryFeeCharged: 0, discountTotal: 0 });
  });
});

describe("only one coupon per order", () => {
  let flat, ship;
  beforeAll(async () => {
    flat = (await create({ code: "FLAT50", couponType: "min_order_value", minOrderValue: 300, discountType: "fixed", discountValue: 50 })).body.result;
    ship = (await create({ code: "SHIP300", couponType: "min_order_value", minOrderValue: 300, discountType: "free_delivery" })).body.result;
  });
  const bigCart = () => [milk(6)]; // ₹330

  it("each coupon works on its own", async () => {
    const a = await preview(bigCart(), "FLAT50");
    expect(a.body.result.breakdown).toMatchObject({ discountTotal: 50 });
    expect(a.body.result.breakdown.deliveryFeeCharged).toBeGreaterThan(0);
    const b = await preview(bigCart(), "SHIP300");
    expect(b.body.result.breakdown).toMatchObject({ discountTotal: 0, deliveryFeeCharged: 0 });
  });

  it("sending two codes is rejected", async () => {
    const res = await request(app)
      .post("/api/orders/checkout/preview")
      .set("Authorization", ctx.auth.customer)
      .send({ items: bigCart(), address: ADDRESS, couponCode: ["FLAT50", "SHIP300"] });
    expect(res.status).toBe(400);
  });

  it("a code plus a different coupon id is rejected", async () => {
    const res = await request(app)
      .post("/api/orders/checkout/preview")
      .set("Authorization", ctx.auth.customer)
      .send({ items: bigCart(), address: ADDRESS, couponCode: "FLAT50", couponId: String(ship._id) });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Only one coupon/);
  });

  it("an order trying to combine two coupons is refused and uses neither", async () => {
    const res = await request(app)
      .post("/api/orders")
      .set("Authorization", ctx.auth.customer)
      .send({ items: bigCart(), address: ADDRESS, paymentMode: "COD", timeSlot: "now", couponCode: "SHIP300", couponId: String(flat._id) });
    expect(res.status).toBe(400);
    const used = await Coupon.find({ code: { $in: ["FLAT50", "SHIP300"] } }).lean();
    expect(used.map((c) => c.usedCount)).toEqual([0, 0]);
  });

  it("an order with one coupon records exactly that one", async () => {
    const res = await request(app)
      .post("/api/orders")
      .set("Authorization", ctx.auth.customer)
      .send({ items: bigCart(), address: ADDRESS, paymentMode: "COD", timeSlot: "now", couponCode: "SHIP300", couponId: String(ship._id) });
    expect(res.status).toBeLessThan(300);
    const used = await Coupon.find({ code: { $in: ["FLAT50", "SHIP300"] } }).lean();
    expect(Object.fromEntries(used.map((c) => [c.code, c.usedCount]))).toEqual({ FLAT50: 0, SHIP300: 1 });
  });
});

describe("customers are told the coupon's real condition", () => {
  beforeAll(async () => {
    // Same shape as the live BULKDEAL coupon: ₹10,000 monthly spend + ₹500 extra minimum.
    await create({ code: "BULKDEAL", couponType: "monthly_volume", monthlyVolumeThreshold: 10000, minOrderValue: 500, discountType: "percentage", discountValue: 4, maxDiscount: 1000 });
    await create({ code: "BULK40", couponType: "bulk_order", minItems: 40, minOrderValue: 300, discountType: "percentage", discountValue: 2 });
    await create({ code: "CATONLY", couponType: "category_based", applicableCategories: [String(otherTree.header._id)], minOrderValue: 1000, discountType: "fixed", discountValue: 30 });
  });

  it("VIP coupon explains the monthly spend first (not the ₹500 minimum)", async () => {
    const res = await preview([milk(1)], "BULKDEAL");
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/spent ₹10,000 this month/);
    expect(res.body.message).not.toMatch(/500/);
  });

  it("bulk coupon explains the item count first, with the cart's count", async () => {
    const res = await preview([milk(2)], "BULK40");
    expect(res.body.message).toBe("Add at least 40 items to use this coupon (your cart has 2)");
  });

  it("category coupon names the categories", async () => {
    const res = await preview([milk(2)], "CATONLY");
    expect(res.body.message).toBe(`This coupon works only with products from: ${otherTree.header.name}`);
  });

  it("the extra minimum is reported once the main condition is met, with the real numbers", async () => {
    const res = await preview([{ product: String(otherCatProduct._id), quantity: 1 }], "CATONLY");
    expect(res.body.message).toBe("Minimum order value should be ₹1,000 (your cart is ₹200)");
  });

  it("the customer coupon list carries every condition, with category names", async () => {
    const res = await request(app).get("/api/coupons").query({ status: "active" }).set("Authorization", ctx.auth.customer);
    const list = res.body.result || res.body.results;
    const vip = list.find((c) => c.code === "BULKDEAL");
    expect(vip).toMatchObject({ monthlyVolumeThreshold: 10000, minOrderValue: 500 });
    const cat = list.find((c) => c.code === "CATONLY");
    expect(cat.applicableCategories[0].name).toBe(otherTree.header.name);
  });
});
