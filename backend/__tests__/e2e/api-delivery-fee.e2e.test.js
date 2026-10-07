/**
 * API E2E — delivery fee and delivery time = global (admin) + product (seller).
 *
 * Walks the feature end to end through the real routes: admin settings,
 * seller product values (form + bulk import), storefront listing/detail,
 * cart quote, checkout preview, and the order snapshot that must not change
 * when admin/seller values change later.
 */
import { jest } from "@jest/globals";
import request from "supertest";
import { startTestApp, stopTestApp } from "./helpers/testApp.js";
import { seedWorld } from "./helpers/world.js";
import { AT_CUSTOMER } from "./helpers/flows.js";
import Order from "../../app/models/order.js";
import Product from "../../app/models/product.js";
import * as fx from "./helpers/fixtures.js";

jest.setTimeout(180000);

let app;
let ctx;
beforeAll(async () => {
  app = await startTestApp();
  ctx = await seedWorld();
});
afterAll(stopTestApp);

const ADDRESS = { name: "Main Customer", address: "12 MG Road, Indore", city: "Indore", phone: "9999999999", location: AT_CUSTOMER };

const setDelivery = (body) =>
  request(app).put("/api/admin/settings/delivery").set("Authorization", ctx.auth.admin).send(body);
const setProductDelivery = (productId, body, auth = ctx.auth.seller) =>
  request(app).put(`/api/products/${productId}`).set("Authorization", auth).send(body);
const listProducts = () =>
  request(app).get("/api/products").query({ lat: AT_CUSTOMER.lat, lng: AT_CUSTOMER.lng, limit: 50 });
const findIn = (res, id) => (res.body.result.items || []).find((p) => String(p._id) === String(id));
const preview = (items) =>
  request(app)
    .post("/api/orders/checkout/preview")
    .set("Authorization", ctx.auth.customer)
    .send({ items, address: ADDRESS });

describe("admin global delivery settings", () => {
  it("saves global fee, time and the zero-time message", async () => {
    const res = await setDelivery({
      deliveryPricingMode: "fixed_price",
      fixedDeliveryFee: 10,
      globalDeliveryTimeMinutes: 15,
      zeroDeliveryTimeMessage: "Same Day Delivery",
    });
    expect(res.status).toBe(200);
    const got = await request(app).get("/api/admin/settings/delivery").set("Authorization", ctx.auth.admin);
    expect(got.body.result).toMatchObject({
      fixedDeliveryFee: 10,
      globalDeliveryTimeMinutes: 15,
      zeroDeliveryTimeMessage: "Same Day Delivery",
    });
  });

  it("public settings report the same global time checkout uses (seller preview)", async () => {
    const res = await request(app).get("/api/settings");
    expect(res.body.result).toMatchObject({ globalDeliveryTimeMinutes: 15, zeroDeliveryTimeMessage: "Same Day Delivery" });
  });

  it("keeps fields that a partial update leaves out", async () => {
    expect((await setDelivery({ codEnabled: true })).status).toBe(200);
    const got = await request(app).get("/api/admin/settings/delivery").set("Authorization", ctx.auth.admin);
    expect(got.body.result).toMatchObject({ fixedDeliveryFee: 10, globalDeliveryTimeMinutes: 15, deliveryPricingMode: "fixed_price" });
  });

  it("rejects negative or fractional global time", async () => {
    expect((await setDelivery({ globalDeliveryTimeMinutes: -5 })).status).toBe(400);
    expect((await setDelivery({ globalDeliveryTimeMinutes: 2.5 })).status).toBe(400);
  });
});

describe("seller product delivery values", () => {
  it("saves the product's extra fee and time", async () => {
    const res = await setProductDelivery(ctx.milk._id, { productDeliveryFee: 20, productDeliveryTimeMinutes: 20 });
    expect(res.status).toBe(200);
    const saved = await Product.findById(ctx.milk._id).lean();
    expect(saved).toMatchObject({ productDeliveryFee: 20, productDeliveryTimeMinutes: 20 });
  });

  it("rejects negative fees and fractional minutes", async () => {
    expect((await setProductDelivery(ctx.milk._id, { productDeliveryFee: -1 })).status).toBe(400);
    expect((await setProductDelivery(ctx.milk._id, { productDeliveryTimeMinutes: 7.5 })).status).toBe(400);
    expect((await setProductDelivery(ctx.milk._id, { productDeliveryTimeMinutes: -3 })).status).toBe(400);
    const saved = await Product.findById(ctx.milk._id).lean();
    expect(saved).toMatchObject({ productDeliveryFee: 20, productDeliveryTimeMinutes: 20 });
  });
});

describe("customer sees final values", () => {
  it("listing shows global + product values (₹10+₹20, 15+20 mins)", async () => {
    const res = await listProducts();
    expect(res.status).toBe(200);
    expect(findIn(res, ctx.milk._id)).toMatchObject({ finalDeliveryFee: 30, deliveryTime: "35 mins", isFreeDelivery: false });
    // Bread has no product values: global only.
    expect(findIn(res, ctx.bread._id)).toMatchObject({ finalDeliveryFee: 10, deliveryTime: "15 mins" });
  });

  it("product detail shows the same final values", async () => {
    const res = await request(app)
      .get(`/api/products/${ctx.milk._id}`)
      .query({ lat: AT_CUSTOMER.lat, lng: AT_CUSTOMER.lng });
    expect(res.status).toBe(200);
    expect(res.body.result).toMatchObject({ finalDeliveryFee: 30, finalDeliveryTimeMinutes: 35, deliveryTime: "35 mins" });
  });

  it("cart quote adds product fees once and uses the slowest time", async () => {
    const res = await request(app)
      .post("/api/products/delivery-quote")
      .send({ productIds: [String(ctx.milk._id), String(ctx.bread._id), "not-an-id"] });
    expect(res.status).toBe(200);
    expect(res.body.result).toMatchObject({ deliveryFee: 30, deliveryTimeMinutes: 35, deliveryTime: "35 mins", estimated: false });
  });

  it("cart quote is per seller across sellers", async () => {
    await setProductDelivery(ctx.otherProduct._id, { productDeliveryTimeMinutes: 40 }, ctx.auth.otherSeller);
    const res = await request(app)
      .post("/api/products/delivery-quote")
      .send({ productIds: [String(ctx.milk._id), String(ctx.otherProduct._id)] });
    expect(res.body.result.sellers).toHaveLength(2);
    // ₹30 (main seller) + ₹10 (other seller global only); ETA = slowest seller (15+40).
    expect(res.body.result).toMatchObject({ deliveryFee: 40, deliveryTimeMinutes: 55 });
  });

  it("checkout preview charges the same fee and returns the delivery time", async () => {
    const res = await preview([
      { product: String(ctx.milk._id), quantity: 2 },
      { product: String(ctx.bread._id), quantity: 1 },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.result.breakdown).toMatchObject({
      deliveryFeeCharged: 30,
      globalDeliveryFee: 10,
      productDeliveryFeeTotal: 20,
      deliveryTimeMinutes: 35,
      deliveryTimeLabel: "35 mins",
      isFreeDelivery: false,
    });
  });
});

describe("cart with several products that have their own delivery values", () => {
  it("charges global + the highest product fee and global + the slowest product time", async () => {
    // ₹20/10 min, ₹30/20 min, ₹40/30 min with global ₹10 / 15 min → ₹50 and 45 mins (not ₹100 / 75 mins)
    const made = [];
    for (const [fee, mins] of [[20, 10], [30, 20], [40, 30]]) {
      made.push(await fx.createProduct(ctx.seller, ctx.tree, { productDeliveryFee: fee, productDeliveryTimeMinutes: mins }));
    }
    const res = await preview(made.map((p) => ({ product: String(p._id), quantity: 2 })));
    expect(res.status).toBe(200);
    expect(res.body.result.breakdown).toMatchObject({
      deliveryFeeCharged: 50,
      globalDeliveryFee: 10,
      productDeliveryFeeTotal: 40,
      deliveryTimeMinutes: 45,
      deliveryTimeLabel: "45 mins",
    });
    const quote = await request(app).post("/api/products/delivery-quote").send({ productIds: made.map((p) => String(p._id)) });
    expect(quote.body.result).toMatchObject({ deliveryFee: 50, deliveryTimeMinutes: 45 });
  });
});

describe("order snapshot", () => {
  let orderId;

  it("stores the calculated fee and time on the order", async () => {
    const res = await request(app)
      .post("/api/orders")
      .set("Authorization", ctx.auth.customer)
      .send({
        items: [
          { product: String(ctx.milk._id), quantity: 1 },
          { product: String(ctx.bread._id), quantity: 1 },
        ],
        address: ADDRESS,
        paymentMode: "COD",
        timeSlot: "now",
      });
    expect(res.status).toBeLessThan(300);
    orderId = res.body.result.order.orderId;
    const order = await Order.findOne({ orderId }).lean();
    expect(order.paymentBreakdown).toMatchObject({
      deliveryFeeCharged: 30,
      globalDeliveryFee: 10,
      productDeliveryFeeTotal: 20,
      globalDeliveryTimeMinutes: 15,
      deliveryTimeMinutes: 35,
      deliveryTimeLabel: "35 mins",
      isFreeDelivery: false,
    });
    const milkLine = order.paymentBreakdown.lineItems.find((l) => String(l.productId) === String(ctx.milk._id));
    expect(milkLine).toMatchObject({ productDeliveryFee: 20, productDeliveryTimeMinutes: 20 });
  });

  it("order details API returns the promised delivery time for the tracking screen", async () => {
    const res = await request(app).get(`/api/orders/details/${orderId}`).set("Authorization", ctx.auth.customer);
    expect(res.status).toBe(200);
    const o = res.body.result.order || res.body.result;
    expect(o.paymentBreakdown).toMatchObject({ deliveryTimeMinutes: 35, deliveryTimeLabel: "35 mins" });
    expect(o.createdAt).toBeTruthy();
  });

  it("is not changed by later admin or seller edits", async () => {
    await setDelivery({ fixedDeliveryFee: 99, globalDeliveryTimeMinutes: 90 });
    await setProductDelivery(ctx.milk._id, { productDeliveryFee: 0, productDeliveryTimeMinutes: 0 });
    const order = await Order.findOne({ orderId }).lean();
    expect(order.paymentBreakdown).toMatchObject({ deliveryFeeCharged: 30, deliveryTimeMinutes: 35, deliveryTimeLabel: "35 mins" });
  });
});

describe("zero values", () => {
  it("free delivery and the admin's message when everything is 0", async () => {
    await setDelivery({ fixedDeliveryFee: 0, globalDeliveryTimeMinutes: 0 });
    const res = await listProducts();
    expect(findIn(res, ctx.milk._id)).toMatchObject({ finalDeliveryFee: 0, isFreeDelivery: true, deliveryTime: "Same Day Delivery" });
    const p = await preview([{ product: String(ctx.milk._id), quantity: 1 }]);
    expect(p.body.result.breakdown).toMatchObject({ deliveryFeeCharged: 0, isFreeDelivery: true, deliveryTimeLabel: "Same Day Delivery" });
  });

  it("only the product's values apply when the global values are 0", async () => {
    await setProductDelivery(ctx.milk._id, { productDeliveryFee: 25, productDeliveryTimeMinutes: 30 });
    const res = await listProducts();
    expect(findIn(res, ctx.milk._id)).toMatchObject({ finalDeliveryFee: 25, deliveryTime: "30 mins" });
  });
});

describe("bulk product upload", () => {
  const upload = (rows, auth = ctx.auth.seller) =>
    request(app).post("/api/products/bulk-upload").set("Authorization", auth).send({ rows });

  it("creates new products with delivery values and updates existing ones by SKU", async () => {
    const milk = await Product.findById(ctx.milk._id).lean();
    const res = await upload([
      {
        name: "Bulk Tea",
        sku: "BULK-TEA-1",
        category: ctx.tree.category.name,
        subcategory: ctx.tree.subcategory.name,
        price: "100",
        salePrice: "90",
        stock: "12",
        "Product Delivery Fee": "15",
        productDeliveryTimeMinutes: "25",
      },
      { sku: milk.sku, productDeliveryFee: "5", productDeliveryTimeMinutes: "10" },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.result.summary).toEqual({ total: 2, created: 1, updated: 1, failed: 0 });

    const tea = await Product.findOne({ sku: "BULK-TEA-1" }).lean();
    expect(tea).toMatchObject({
      name: "Bulk Tea",
      price: 100,
      stock: 12,
      productDeliveryFee: 15,
      productDeliveryTimeMinutes: 25,
      sellerId: ctx.seller._id,
    });
    expect(String(tea.categoryId)).toBe(String(ctx.tree.category._id));
    expect(String(tea.headerId)).toBe(String(ctx.tree.header._id));

    const updatedMilk = await Product.findById(ctx.milk._id).lean();
    expect(updatedMilk).toMatchObject({ productDeliveryFee: 5, productDeliveryTimeMinutes: 10, price: milk.price });
  });

  it("reports bad rows without stopping the import", async () => {
    const res = await upload([
      { name: "Neg Fee", category: ctx.tree.category.name, price: "10", productDeliveryFee: "-4" },
      { name: "Half Minute", category: ctx.tree.category.name, price: "10", productDeliveryTimeMinutes: "1.5" },
      { name: "No Category", price: "10" },
      { name: "Ok Row", category: ctx.tree.category.name, subcategory: ctx.tree.subcategory.name, price: "10" },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.result.summary).toMatchObject({ created: 1, failed: 3 });
    const errors = res.body.result.results.filter((r) => r.status === "error");
    expect(errors.map((r) => r.row)).toEqual([2, 3, 4]);
    expect(errors[0].errors.join(" ")).toMatch(/delivery fee/i);
    expect(errors[1].errors.join(" ")).toMatch(/whole minutes/i);
    expect(errors[2].errors.join(" ")).toMatch(/category is required/i);
    expect(await Product.countDocuments({ name: "Neg Fee" })).toBe(0);
  });

  it("only lets sellers import, and only into their own catalogue", async () => {
    expect((await upload([{ name: "X" }], ctx.auth.customer)).status).toBe(403);
    const milk = await Product.findById(ctx.milk._id).lean();
    // Another seller using this SKU creates their own product instead of editing ours.
    const res = await upload(
      [{ sku: milk.sku, name: "Other Seller Copy", category: ctx.tree.category.name, subcategory: ctx.tree.subcategory.name, price: "10", productDeliveryFee: "1" }],
      ctx.auth.otherSeller,
    );
    expect(res.body.result.results[0].status).not.toBe("updated");
    expect((await Product.findById(ctx.milk._id).lean()).productDeliveryFee).toBe(5);
  });

  it("rejects empty and oversized imports", async () => {
    expect((await upload([])).status).toBe(400);
    expect((await upload(Array.from({ length: 501 }, () => ({ name: "x" })))).status).toBe(400);
  });
});
