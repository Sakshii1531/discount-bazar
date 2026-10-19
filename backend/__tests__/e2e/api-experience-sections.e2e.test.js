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

describe("brand showcase sections", () => {
  let A;
  let seller;
  let tree;
  let amul;
  let tata;
  let nestle;
  let hidden;
  beforeEach(async () => {
    const Brand = (await import("../../app/models/brand.js")).default;
    A = bearer("admin", (await fx.createAdmin())._id);
    seller = await fx.createSeller();
    tree = await fx.createCategoryTree();
    const mk = (name, extra = {}) =>
      Brand.create({ name, slug: name.toLowerCase().replace(/\s+/g, "-"), logo: `https://cdn.test/${name}.png`, ...extra });
    amul = await mk("Amul");
    tata = await mk("Tata Sampann");
    nestle = await mk("Nestle");
    hidden = await mk("Retired Co", { status: "inactive" });
    await fx.createProduct(seller, tree, { name: "Amul Butter", brand: "Amul", brandId: amul._id });
    await fx.createProduct(seller, tree, { name: "Tata Dal", brand: "Tata Sampann", brandId: tata._id });
    // Nestle exists only out of stock; Retired Co is inactive.
    await fx.createProduct(seller, tree, { name: "Maggi", brand: "Nestle", brandId: nestle._id, stock: 0 });
    await fx.createProduct(seller, tree, { name: "Old Thing", brand: "Retired Co", brandId: hidden._id });
  });

  const create = (config, extra = {}) =>
    request(app)
      .post("/api/admin/experience")
      .set("Authorization", A)
      .send({ pageType: "home", status: "active", displayType: "brands", title: "Top Brands", config, ...extra });
  const home = async (q = { lat: AT.lat, lng: AT.lng }) => {
    const res = await request(app).get("/api/experience").query({ pageType: "home", ...q });
    expect(res.status).toBe(200);
    return res.body.result || res.body.results;
  };

  it("validates the section", async () => {
    const noBrands = await create({ brandIds: [] });
    expect(noBrands.status).toBeGreaterThanOrEqual(400);
    expect(noBrands.body.message).toMatch(/at least one brand/i);
    const noTitle = await create({ brandIds: [String(amul._id)] }, { title: "" });
    expect(noTitle.status).toBeGreaterThanOrEqual(400);
  });

  it("saves layout settings and serves brand cards in the admin's order, limited to brands buyable nearby", async () => {
    const res = await create({
      brandIds: [String(tata._id), String(nestle._id), String(hidden._id), String(amul._id)],
      layout: "grid",
      rows: 2,
      maxItems: 10,
    });
    expect(res.status).toBe(201);
    expect(res.body.result.config.brands).toEqual(
      expect.objectContaining({ layout: "grid", rows: 2, maxItems: 10 }),
    );

    const [section] = await home();
    expect(section.displayType).toBe("brands");
    expect(section.brands).toEqual([
      { _id: String(tata._id), name: "Tata Sampann", slug: "tata-sampann", logo: "https://cdn.test/Tata Sampann.png" },
      { _id: String(amul._id), name: "Amul", slug: "amul", logo: "https://cdn.test/Amul.png" },
    ]);
  });

  it("caps cards at maxItems and forces a single row for the carousel", async () => {
    const res = await create({ brandIds: [String(amul._id), String(tata._id)], layout: "carousel", rows: 4, maxItems: 1 });
    expect(res.body.result.config.brands).toEqual(expect.objectContaining({ layout: "carousel", rows: 1 }));
    const [section] = await home();
    expect(section.brands.map((b) => b.name)).toEqual(["Amul"]);
  });

  it("drops the section where none of its brands are available, and still works without a location", async () => {
    await create({ brandIds: [String(amul._id), String(nestle._id)] });
    const far = await home({ lat: 28.6139, lng: 77.209 });
    expect(far.find((s) => s.displayType === "brands")).toBeUndefined();
    const noLocation = await home({});
    // Without a location every active selected brand is shown.
    expect(noLocation[0].brands.map((b) => b.name)).toEqual(["Amul", "Nestle"]);
  });

  it("reorders with the other sections", async () => {
    const banner = await request(app).post("/api/admin/experience").set("Authorization", A)
      .send({ pageType: "home", status: "active", displayType: "categories", title: "Cats", config: { categoryIds: [String(tree.category._id)] } });
    const brands = await create({ brandIds: [String(amul._id)] });
    const reorder = await request(app).put("/api/admin/experience/reorder").set("Authorization", A)
      .send({ items: [{ id: brands.body.result._id, order: 0 }, { id: banner.body.result._id, order: 1 }] });
    expect(reorder.status).toBe(200);
    const sections = await home();
    expect(sections.map((s) => s.displayType)).toEqual(["brands", "categories"]);
  });
});
