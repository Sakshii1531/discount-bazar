/**
 * API E2E — product discovery: brand listing, slug lookups, and the product
 * detail recommendation sections (similar, top in category, brands in
 * category, people also bought).
 */
import { jest } from "@jest/globals";
import mongoose from "mongoose";
import request from "supertest";
import { startTestApp, stopTestApp, clearDatabase } from "./helpers/testApp.js";
import * as fx from "./helpers/fixtures.js";
import Category from "../../app/models/category.js";
import Order from "../../app/models/order.js";
import { WORKFLOW_STATUS } from "../../app/constants/orderWorkflow.js";

jest.setTimeout(120000);

let app;
beforeAll(async () => {
  app = await startTestApp();
  await fx.ensureIndexes();
});
afterEach(clearDatabase);
afterAll(stopTestApp);

const near = { lat: fx.STORE_LOCATION.lat, lng: fx.STORE_LOCATION.lng };
const far = { lat: 28.6139, lng: 77.209 };
// No seller serves this point.
const nowhere = { lat: 19.076, lng: 72.8777 };
let orderSeq = 0;

async function seedCatalog() {
  const seller = await fx.createSeller();
  const farSeller = await fx.createSeller({
    location: { type: "Point", coordinates: [far.lng, far.lat] },
  });
  const header = await Category.create({ name: "Grocery", slug: `grocery-${Date.now()}`, type: "header" });
  const oils = await Category.create({ name: "Oil & Ghee", slug: `oils-${Date.now()}`, type: "category", parentId: header._id });
  const flours = await Category.create({ name: "Atta & Flours", slug: `flours-${Date.now()}`, type: "category", parentId: header._id });
  const mustard = await Category.create({ name: "Mustard Oil", slug: `mustard-${Date.now()}`, type: "subcategory", parentId: oils._id });
  const refined = await Category.create({ name: "Refined Oil", slug: `refined-${Date.now()}`, type: "subcategory", parentId: oils._id });
  const atta = await Category.create({ name: "Atta", slug: `atta-${Date.now()}`, type: "subcategory", parentId: flours._id });

  const inTree = (cat, sub) => ({ header: header.toObject(), category: cat.toObject(), subcategory: sub.toObject() });
  const mustardTree = inTree(oils, mustard);

  const products = {
    fortuneMustard: await fx.createProduct(seller, mustardTree, {
      name: "Fortune Kachi Ghani Mustard Oil", brand: "Fortune", weight: "1 L", tags: ["mustard oil"],
      shelfLife: "9 months", returnPolicy: { isReturnable: false, returnWindowDays: 0 },
    }),
    dharaMustard: await fx.createProduct(seller, mustardTree, { name: "Dhara Kachi Ghani Mustard Oil", brand: "Dhara", weight: "1 L", tags: ["mustard oil"] }),
    tataMustardOos: await fx.createProduct(seller, mustardTree, { name: "Tata Mustard Oil", brand: "Tata", stock: 0 }),
    inactiveMustard: await fx.createProduct(seller, mustardTree, { name: "Old Mustard Oil", brand: "Engine", status: "inactive" }),
    pendingMustard: await fx.createProduct(seller, mustardTree, { name: "Pending Mustard Oil", brand: "Pending", approvalStatus: "pending" }),
    farMustard: await fx.createProduct(farSeller, mustardTree, { name: "Far Mustard Oil", brand: "Faraway" }),
    fortuneSoy: await fx.createProduct(seller, inTree(oils, refined), { name: "Fortune Soya Health Refined Oil", brand: " fortune ", tags: ["refined oil"] }),
    fortunePlus: await fx.createProduct(seller, inTree(oils, refined), { name: "Fortune Plus Rice Bran Oil", brand: "Fortune Plus" }),
    atta: await fx.createProduct(seller, inTree(flours, atta), { name: "Aashirvaad Atta", brand: "Aashirvaad" }),
    besan: await fx.createProduct(seller, inTree(flours, atta), { name: "Rajdhani Besan", brand: "Rajdhani" }),
  };
  return { seller, header, oils, mustard, products };
}

async function order(customer, seller, items, overrides = {}) {
  orderSeq += 1;
  return Order.create({
    orderId: `ORD-DISC-${Date.now()}-${orderSeq}`,
    customer: customer._id,
    seller: seller._id,
    items: items.map(([product, quantity = 1]) => ({
      product: product._id,
      name: product.name,
      quantity,
      price: 100,
    })),
    address: {
      type: "Home",
      name: "Home",
      address: "1 Test Road",
      city: "Indore",
      phone: "9999999999",
      location: { lat: near.lat, lng: near.lng },
    },
    payment: { method: "cash", status: "completed" },
    pricing: { subtotal: 100, deliveryFee: 0, gst: 0, tip: 0, total: 100 },
    status: "delivered",
    workflowStatus: WORKFLOW_STATUS.DELIVERED,
    workflowVersion: 2,
    ...overrides,
  });
}

const names = (items) => items.map((p) => p.name);

describe("brand and slug lookups", () => {
  it("GET /api/products?brand= matches the brand field exactly, ignoring case and spaces", async () => {
    const { products } = await seedCatalog();
    const res = await request(app).get("/api/products").query({ ...near, brand: "FORTUNE" });
    expect(res.status).toBe(200);
    expect(names(res.body.result.items).sort()).toEqual(
      [products.fortuneMustard.name, products.fortuneSoy.name].sort(),
    );
    // "Fortune Plus" is a different brand, not a text match on "Fortune".
    expect(names(res.body.result.items)).not.toContain(products.fortunePlus.name);
  });

  it("GET /api/products?inStock=true hides out-of-stock products", async () => {
    const { mustard, products } = await seedCatalog();
    const all = await request(app).get("/api/products").query({ ...near, subcategoryId: String(mustard._id) });
    expect(names(all.body.result.items)).toContain(products.tataMustardOos.name);
    const inStock = await request(app)
      .get("/api/products")
      .query({ ...near, subcategoryId: String(mustard._id), inStock: "true" });
    expect(names(inStock.body.result.items)).not.toContain(products.tataMustardOos.name);
  });

  it("GET /api/products rejects malformed category ids instead of failing with 500", async () => {
    const res = await request(app).get("/api/products").query({ ...near, categoryId: "not-an-id" });
    expect(res.status).toBe(400);
  });

  it("GET /api/products/:id accepts a slug, returns detail fields, and 404s on bad ids", async () => {
    const { products } = await seedCatalog();
    const bySlug = await request(app).get(`/api/products/${products.fortuneMustard.slug}`).query(near);
    expect(bySlug.status).toBe(200);
    expect(String(bySlug.body.result._id)).toBe(String(products.fortuneMustard._id));
    expect(bySlug.body.result).toEqual(
      expect.objectContaining({ shelfLife: "9 months", brand: "Fortune", returnPolicy: expect.objectContaining({ isReturnable: false }) }),
    );

    expect((await request(app).get("/api/products/no-such-product").query(near)).status).toBe(404);
  });

  it("GET /api/categories?tree=true exposes category status for the storefront", async () => {
    await seedCatalog();
    const res = await request(app).get("/api/categories").query({ tree: "true" });
    expect(res.status).toBe(200);
    const header = res.body.results.find((h) => h.name === "Grocery");
    expect(header.children[0]).toEqual(expect.objectContaining({ status: "active" }));
  });
});

describe("GET /api/products/:id/recommendations", () => {
  it("requires a customer location and a real product", async () => {
    const { products } = await seedCatalog();
    expect((await request(app).get(`/api/products/${products.fortuneMustard._id}/recommendations`)).status).toBe(400);
    expect(
      (await request(app).get(`/api/products/${new mongoose.Types.ObjectId()}/recommendations`).query(near)).status,
    ).toBe(404);
    expect(
      (await request(app).get(`/api/products/${products.pendingMustard._id}/recommendations`).query(near)).status,
    ).toBe(404);
  });

  it("returns empty sections outside the delivery area", async () => {
    const { products } = await seedCatalog();
    const res = await request(app).get(`/api/products/${products.fortuneMustard._id}/recommendations`).query(nowhere);
    expect(res.status).toBe(200);
    expect(res.body.result.similar.items).toEqual([]);
    expect(res.body.result.alsoBought.items).toEqual([]);
  });

  it("builds every section from catalogue and delivered-order data", async () => {
    const { seller, products } = await seedCatalog();
    const [c1, c2, c3] = await Promise.all([fx.createCustomer(), fx.createCustomer(), fx.createCustomer()]);
    const { fortuneMustard, dharaMustard, atta, besan } = products;

    // Atta was bought with Fortune mustard oil by two different customers.
    await order(c1, seller, [[fortuneMustard], [atta]]);
    await order(c2, seller, [[fortuneMustard], [atta]]);
    // Besan only once: below the co-purchase threshold.
    await order(c3, seller, [[fortuneMustard], [besan]]);
    // Cancelled orders never count, however many there are.
    for (const c of [c1, c2, c3]) {
      await order(c, seller, [[fortuneMustard], [besan]], { status: "cancelled", workflowStatus: WORKFLOW_STATUS.CANCELLED });
    }
    // Dhara mustard oil is the best seller of the category.
    await order(c1, seller, [[dharaMustard, 5]]);

    const res = await request(app).get(`/api/products/${fortuneMustard._id}/recommendations`).query(near);
    expect(res.status).toBe(200);
    const r = res.body.result;
    expect(r.errors).toEqual([]);

    const ineligible = [
      fortuneMustard, products.tataMustardOos, products.inactiveMustard, products.pendingMustard, products.farMustard,
    ].map((p) => p.name);

    // Similar: same subcategory first, never the product itself or ineligible items.
    expect(names(r.similar.items)[0]).toBe(dharaMustard.name);
    for (const n of ineligible) expect(names(r.similar.items)).not.toContain(n);
    expect(new Set(names(r.similar.items)).size).toBe(r.similar.items.length);

    // Top products: ranked by delivered units.
    expect(r.topInCategory.basis).toBe("sales");
    expect(r.topInCategory.scope).toEqual(expect.objectContaining({ type: "category", name: "Oil & Ghee" }));
    expect(names(r.topInCategory.items)[0]).toBe(dharaMustard.name);
    for (const n of ineligible) expect(names(r.topInCategory.items)).not.toContain(n);

    // Brands: only brands with eligible products in the subcategory.
    expect(r.brandsInCategory.scope).toEqual(expect.objectContaining({ type: "subcategory", name: "Mustard Oil" }));
    expect(r.brandsInCategory.items.map((b) => b.name).sort()).toEqual(["Dhara", "Fortune"]);

    // People also bought: verified co-purchases only.
    expect(r.alsoBought.source).toBe("co_purchase");
    expect(names(r.alsoBought.items)).toEqual([atta.name]);

    // Public payload carries no order or customer data.
    const raw = JSON.stringify(res.body);
    for (const c of [c1, c2, c3]) expect(raw).not.toContain(String(c._id));
    expect(raw).not.toContain("purchaseCost");
  });

  it("falls back to related categories, clearly labelled, without order history", async () => {
    const { products } = await seedCatalog();
    const res = await request(app).get(`/api/products/${products.dharaMustard._id}/recommendations`).query(near);
    expect(res.status).toBe(200);
    const r = res.body.result;
    expect(r.alsoBought.source).toBe("related_category");
    expect(r.topInCategory.basis).toBe("catalog");
    expect(names(r.alsoBought.items)).not.toContain(products.dharaMustard.name);
    // No overlap with the Similar section.
    const similar = new Set(names(r.similar.items));
    expect(names(r.alsoBought.items).filter((n) => similar.has(n))).toEqual([]);
  });
});
