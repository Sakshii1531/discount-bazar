/**
 * API E2E — storefront "Create Sections" (experience sections): with the
 * customer's location, product sections come back with their products
 * resolved server-side, so they no longer depend on which 20 products the
 * home page happened to load (the cause of sections appearing/disappearing).
 */
import { jest } from "@jest/globals";
import request from "supertest";
import { startTestApp, stopTestApp, clearDatabase, bearer } from "./helpers/testApp.js";
import * as fx from "./helpers/fixtures.js";
import Category from "../../app/models/category.js";

jest.setTimeout(120000);

let app;
beforeAll(async () => {
  app = await startTestApp();
  await fx.ensureIndexes();
});
afterEach(clearDatabase);
afterAll(stopTestApp);

const AT = fx.STORE_LOCATION;
const FAR = { lat: 28.6139, lng: 77.209 }; // Delhi, outside the seller's radius

describe("experience sections resolve their products per location", () => {
  let A;
  let seller;
  let grocery;
  let baby;
  let diapers;
  let wipes;
  beforeEach(async () => {
    A = bearer("admin", (await fx.createAdmin())._id);
    seller = await fx.createSeller();
    grocery = await fx.createCategoryTree();
    baby = await Category.create({ name: "Baby Care", slug: "baby-care", type: "category", parentId: grocery.header._id });
    diapers = await Category.create({ name: "Diapers", slug: "diapers", type: "subcategory", parentId: baby._id });
    wipes = await Category.create({ name: "Wipes", slug: "wipes", type: "subcategory", parentId: baby._id });
  });

  const babyTree = (sub) => ({ header: grocery.header, category: baby, subcategory: sub });
  const createSection = (body) => request(app).post("/api/admin/experience").set("Authorization", A).send({ pageType: "home", status: "active", ...body });
  const homeSections = async (at = AT) => {
    const res = await request(app).get("/api/experience").query({ pageType: "home", lat: at.lat, lng: at.lng });
    expect(res.status).toBe(200);
    return res.body.result || res.body.results;
  };
  const productsOf = (sections, title) => sections.find((s) => s.title === title)?.products;

  it("returns the section's products even when 20+ newer products exist (the original bug)", async () => {
    const d1 = await fx.createProduct(seller, babyTree(diapers), { name: "Pampers M" });
    const d2 = await fx.createProduct(seller, babyTree(diapers), { name: "Huggies L" });
    // Newer unrelated products push the diapers out of the home page's newest-20 list.
    for (let i = 0; i < 25; i += 1) await fx.createProduct(seller, grocery, { name: `Milk ${i}` });

    const pool = await request(app).get("/api/products").query({ limit: 20, lat: AT.lat, lng: AT.lng });
    const poolIds = (pool.body.result.items || []).map((p) => String(p._id));
    expect(poolIds).not.toContain(String(d1._id));

    expect((await createSection({
      displayType: "products", title: "Diaper Deals",
      config: { categoryIds: [String(baby._id)], subcategoryIds: [String(diapers._id)], rows: 3, columns: 3 },
    })).status).toBe(201);

    const products = productsOf(await homeSections(), "Diaper Deals");
    expect(products.map((p) => p.name).sort()).toEqual(["Huggies L", "Pampers M"]);
    expect(products[0]).toEqual(expect.objectContaining({ price: expect.any(Number), mainImage: expect.any(String) }));
    expect(String(d2._id)).toBeTruthy();
  });

  it("includes a whole category when none of its subcategories were picked", async () => {
    await fx.createProduct(seller, babyTree(wipes), { name: "Baby Wipes" });
    await fx.createProduct(seller, grocery, { name: "Toned Milk" });
    await fx.createProduct(seller, grocery, { name: "Other Milk", subcategoryId: (await Category.create({ name: "Curd", slug: "curd", type: "subcategory", parentId: grocery.category._id }))._id });
    await createSection({
      displayType: "products", title: "Mixed",
      // Baby Care narrowed to Diapers (none stocked); Dairy taken whole.
      config: { categoryIds: [String(baby._id), String(grocery.category._id)], subcategoryIds: [String(diapers._id)], rows: 2, columns: 3 },
    });
    const names = productsOf(await homeSections(), "Mixed").map((p) => p.name).sort();
    expect(names).toEqual(["Other Milk", "Toned Milk"]);
  });

  it("keeps curated product order and drops unapproved, inactive and far-away products", async () => {
    const far = await fx.createSeller({ location: { type: "Point", coordinates: [FAR.lng, FAR.lat] } });
    const a = await fx.createProduct(seller, grocery, { name: "A" });
    const b = await fx.createProduct(seller, grocery, { name: "B" });
    const pending = await fx.createProduct(seller, grocery, { name: "Pending", approvalStatus: "pending" });
    const off = await fx.createProduct(seller, grocery, { name: "Off", status: "inactive" });
    const remote = await fx.createProduct(far, grocery, { name: "Remote" });
    await createSection({
      displayType: "products", title: "Picks",
      config: { productIds: [b, pending, a, off, remote].map((p) => String(p._id)), rows: 1, columns: 2 },
    });
    expect(productsOf(await homeSections(), "Picks").map((p) => p.name)).toEqual(["B", "A"]);
    expect(productsOf(await homeSections(FAR), "Picks").map((p) => p.name)).toEqual(["Remote"]);
  });

  it("reflects admin and seller changes immediately", async () => {
    await createSection({ displayType: "products", title: "Diaper Deals", config: { categoryIds: [String(baby._id)], subcategoryIds: [], rows: 2, columns: 2 } });
    expect(productsOf(await homeSections(), "Diaper Deals")).toEqual([]);

    // Seller adds a matching product through the API (invalidates product caches).
    const S = bearer("seller", seller._id);
    const created = await request(app).post("/api/products").set("Authorization", S)
      .field("name", "Mamy Poko").field("price", "500").field("salePrice", "450").field("stock", "5")
      .field("headerId", String(grocery.header._id)).field("categoryId", String(baby._id))
      .field("subcategoryId", String(diapers._id)).field("status", "active")
      .field("variants", JSON.stringify([{ name: "M", sku: "", price: 500, salePrice: 450, stock: 5 }]));
    expect(created.status).toBe(201);
    const { default: Product } = await import("../../app/models/product.js");
    await Product.updateOne({ _id: created.body.result._id }, { approvalStatus: "approved", mainImage: "https://res.cloudinary.com/demo/image/upload/d.jpg" });
    expect(productsOf(await homeSections(), "Diaper Deals").map((p) => p.name)).toEqual(["Mamy Poko"]);

    // Admin turns the section off: it disappears at once.
    const id = (await homeSections()).find((s) => s.title === "Diaper Deals")._id;
    expect((await request(app).put(`/api/admin/experience/${id}`).set("Authorization", A).send({ status: "inactive" })).status).toBe(200);
    expect((await homeSections()).find((s) => s.title === "Diaper Deals")).toBeUndefined();
  });

  it("still returns plain sections without a location (older clients)", async () => {
    await createSection({ displayType: "products", title: "Diaper Deals", config: { categoryIds: [String(baby._id)], subcategoryIds: [], rows: 2, columns: 2 } });
    const res = await request(app).get("/api/experience").query({ pageType: "home" });
    expect(res.status).toBe(200);
    const section = (res.body.result || res.body.results).find((s) => s.title === "Diaper Deals");
    expect(section).toBeDefined();
    expect(section.products).toBeUndefined();
  });
});
