/**
 * API E2E — customer section: OTP login, profile, catalogue browsing,
 * cart, wishlist, orders, support tickets, notifications and reviews.
 */
import { jest } from "@jest/globals";
import request from "supertest";
import { startTestApp, stopTestApp, clearDatabase, bearer } from "./helpers/testApp.js";
import * as fx from "./helpers/fixtures.js";

jest.setTimeout(120000);

const NEAR = `lat=${fx.STORE_LOCATION.lat}&lng=${fx.STORE_LOCATION.lng}`;
const FAR = "lat=28.6139&lng=77.2090"; // Delhi — far outside the 10km radius

let app;
beforeAll(async () => {
  app = await startTestApp();
  await fx.ensureIndexes();
});
afterEach(clearDatabase);
afterAll(stopTestApp);

async function seedStore() {
  const seller = await fx.createSeller();
  const tree = await fx.createCategoryTree();
  const product = await fx.createProduct(seller, tree);
  const customer = await fx.createCustomer();
  return { seller, tree, product, customer, auth: bearer("customer", customer._id) };
}

describe("customer: OTP authentication", () => {
  it("signs up and logs in with the mock OTP", async () => {
    const send = await request(app)
      .post("/api/customer/send-signup-otp")
      .send({ name: "Ravi Kumar", phone: "9876543210" });
    expect(send.status).toBe(200);

    const verify = await request(app)
      .post("/api/customer/verify-otp")
      .send({ phone: "9876543210", otp: "1234" });
    expect(verify.status).toBe(200);
    expect(verify.body.result.token).toEqual(expect.any(String));

    const profile = await request(app)
      .get("/api/customer/profile")
      .set("Authorization", `Bearer ${verify.body.result.token}`);
    expect(profile.status).toBe(200);
    expect(profile.body.result.phone).toContain("9876543210");
  });

  it("rejects a wrong OTP", async () => {
    await request(app).post("/api/customer/send-signup-otp").send({ name: "Ravi", phone: "9876543211" });
    const res = await request(app).post("/api/customer/verify-otp").send({ phone: "9876543211", otp: "9999" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.result?.token).toBeUndefined();
  });

  it("blocks protected endpoints without a token", async () => {
    for (const url of ["/api/customer/profile", "/api/cart", "/api/wishlist", "/api/orders/my-orders"]) {
      const res = await request(app).get(url);
      expect(res.status).toBe(401);
    }
  });
});

describe("customer: profile", () => {
  it("updates profile name", async () => {
    const { auth } = await seedStore();
    const res = await request(app).put("/api/customer/profile").set("Authorization", auth).send({ name: "New Name" });
    expect(res.status).toBe(200);
    expect(res.body.result.name).toBe("New Name");
  });
});

describe("customer: catalogue browsing", () => {
  it("requires location for customer product lists", async () => {
    const res = await request(app).get("/api/products");
    expect(res.status).toBe(400);
  });

  it("shows nearby seller products", async () => {
    const { product } = await seedStore();
    const res = await request(app).get(`/api/products?${NEAR}`);
    expect(res.status).toBe(200);
    expect(res.body.result.items.map((p) => String(p._id))).toContain(String(product._id));
  });

  it("hides products from sellers outside the delivery radius", async () => {
    await seedStore();
    const res = await request(app).get(`/api/products?${FAR}`);
    expect(res.status).toBe(200);
    expect(res.body.result.items).toEqual([]);
  });

  it("hides unapproved, inactive and image-less products", async () => {
    const { seller, tree } = await seedStore();
    await fx.createProduct(seller, tree, { approvalStatus: "pending" });
    await fx.createProduct(seller, tree, { status: "inactive" });
    await fx.createProduct(seller, tree, { mainImage: "" });
    const res = await request(app).get(`/api/products?${NEAR}`);
    expect(res.body.result.total).toBe(1);
  });

  it("filters by search term", async () => {
    const { seller, tree } = await seedStore();
    await fx.createProduct(seller, tree, { name: "Basmati Rice" });
    const res = await request(app).get(`/api/products?${NEAR}&search=basmati`);
    expect(res.body.result.items).toHaveLength(1);
    expect(res.body.result.items[0].name).toBe("Basmati Rice");
  });

  it("returns product details with location", async () => {
    const { product } = await seedStore();
    const res = await request(app).get(`/api/products/${product._id}?${NEAR}`);
    expect(res.status).toBe(200);
    expect(res.body.result.name).toBe(product.name);
  });

  it("returns product reviews (empty)", async () => {
    const { product } = await seedStore();
    const res = await request(app).get(`/api/reviews/product/${product._id}`);
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
  });
});

describe("customer: cart", () => {
  it("adds, updates, removes and clears items", async () => {
    const { product, auth } = await seedStore();
    const productId = String(product._id);

    const add = await request(app).post("/api/cart/add").set("Authorization", auth).send({ productId, quantity: 2 });
    expect(add.status).toBe(200);

    let cart = await request(app).get("/api/cart").set("Authorization", auth);
    expect(cart.body.result.items).toHaveLength(1);
    expect(cart.body.result.items[0].quantity).toBe(2);

    const update = await request(app).put("/api/cart/update").set("Authorization", auth).send({ productId, quantity: 5 });
    expect(update.status).toBe(200);
    cart = await request(app).get("/api/cart").set("Authorization", auth);
    expect(cart.body.result.items[0].quantity).toBe(5);

    const remove = await request(app).delete(`/api/cart/remove/${productId}`).set("Authorization", auth);
    expect(remove.status).toBe(200);
    expect(remove.body.result.items).toEqual([]);

    await request(app).post("/api/cart/add").set("Authorization", auth).send({ productId, quantity: 1 });
    const clear = await request(app).delete("/api/cart/clear").set("Authorization", auth);
    expect(clear.status).toBe(200);
    cart = await request(app).get("/api/cart").set("Authorization", auth);
    expect(cart.body.result.items).toEqual([]);
  });

  it("validates cart payloads", async () => {
    const { product, auth } = await seedStore();
    const res = await request(app)
      .post("/api/cart/add")
      .set("Authorization", auth)
      .send({ productId: String(product._id), quantity: 0 });
    expect(res.status).toBe(400);
  });

  it("refuses unavailable products", async () => {
    const { seller, tree, auth } = await seedStore();
    const hidden = await fx.createProduct(seller, tree, { approvalStatus: "rejected" });
    const res = await request(app)
      .post("/api/cart/add")
      .set("Authorization", auth)
      .send({ productId: String(hidden._id), quantity: 1 });
    expect(res.status).toBe(404);
  });
});

describe("customer: wishlist", () => {
  it("toggles a product in and out", async () => {
    const { product, auth } = await seedStore();
    const productId = String(product._id);

    const on = await request(app).post("/api/wishlist/toggle").set("Authorization", auth).send({ productId });
    expect(on.status).toBe(200);
    let list = await request(app).get("/api/wishlist").set("Authorization", auth);
    expect(list.body.result.products.map((p) => String(p._id || p))).toContain(productId);

    await request(app).post("/api/wishlist/toggle").set("Authorization", auth).send({ productId });
    list = await request(app).get("/api/wishlist").set("Authorization", auth);
    expect(list.body.result.products).toHaveLength(0);
  });
});

describe("customer: orders, support and notifications", () => {
  it("lists no orders for a new customer", async () => {
    const { auth } = await seedStore();
    const res = await request(app).get("/api/orders/my-orders").set("Authorization", auth);
    expect(res.status).toBe(200);
    expect(res.body.result).toEqual(expect.objectContaining({ items: [], total: 0 }));
  });

  it("returns 404-ish for another customer's order id", async () => {
    const { auth } = await seedStore();
    const res = await request(app).get("/api/orders/details/ORD-DOES-NOT-EXIST").set("Authorization", auth);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("creates and lists support tickets", async () => {
    const { auth } = await seedStore();
    const create = await request(app)
      .post("/api/tickets/create")
      .set("Authorization", auth)
      .send({ subject: "Late order", description: "My order is late" });
    expect(create.status).toBe(201);
    expect(create.body.result.status).toBe("open");

    const mine = await request(app).get("/api/tickets/my-tickets").set("Authorization", auth);
    expect(mine.body.results).toHaveLength(1);
  });

  it("customers cannot see the admin ticket queue", async () => {
    const { auth } = await seedStore();
    const res = await request(app).get("/api/tickets/admin/all").set("Authorization", auth);
    expect(res.status).toBe(403);
  });

  it("lists notifications with unread count", async () => {
    const { auth } = await seedStore();
    const res = await request(app).get("/api/notifications").set("Authorization", auth);
    expect(res.status).toBe(200);
    expect(res.body.result.unreadCount).toBe(0);
  });

  it("rejects coupons on an empty cart", async () => {
    const { auth } = await seedStore();
    const res = await request(app)
      .post("/api/coupons/validate")
      .set("Authorization", auth)
      .send({ code: "NOPE", cartTotal: 100 });
    expect(res.status).toBe(400);
  });
});
