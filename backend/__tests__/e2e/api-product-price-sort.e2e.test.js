/**
 * API E2E — price sorting on the product listing follows the price the customer
 * sees (sale price when discounted, otherwise MRP), not the MRP.
 */
import { jest } from "@jest/globals";
import request from "supertest";
import { startTestApp, stopTestApp, clearDatabase } from "./helpers/testApp.js";
import * as fx from "./helpers/fixtures.js";

jest.setTimeout(120000);

let app;
beforeAll(async () => {
  app = await startTestApp();
  await fx.ensureIndexes();
});
afterEach(clearDatabase);
afterAll(stopTestApp);

describe("product price sort", () => {
  let seller;
  beforeEach(async () => {
    seller = await fx.createSeller();
    const tree = await fx.createCategoryTree();
    // MRP order: Lotion < Shampoo < Oil < Soap; selling-price order: Soap < Lotion < Shampoo < Oil
    await fx.createProduct(seller, tree, { name: "Shampoo", price: 899, salePrice: 600, stock: 10 });
    await fx.createProduct(seller, tree, { name: "Oil", price: 986, salePrice: 700, stock: 10 });
    await fx.createProduct(seller, tree, { name: "Soap", price: 1075, salePrice: 549, stock: 10 });
    await fx.createProduct(seller, tree, { name: "Lotion", price: 580, salePrice: 0, stock: 10 });
    await fx.createProduct(seller, tree, { name: "Sold Out Cream", price: 100, salePrice: 50, stock: 0 });
  });

  const names = async (query) => {
    const res = await request(app).get("/api/products").query({ lat: fx.STORE_LOCATION.lat, lng: fx.STORE_LOCATION.lng, sellerId: String(seller._id), ...query });
    expect(res.status).toBe(200);
    return (res.body.result.items || []).map((p) => p.name);
  };

  it("sorts low to high by selling price, out-of-stock last", async () => {
    expect(await names({ sort: "price-asc" })).toEqual(["Soap", "Lotion", "Shampoo", "Oil", "Sold Out Cream"]);
  });

  it("sorts high to low by selling price", async () => {
    expect(await names({ sort: "price-desc" })).toEqual(["Oil", "Shampoo", "Lotion", "Soap", "Sold Out Cream"]);
  });

  it("keeps the order across pages", async () => {
    const first = await names({ sort: "price-asc", page: 1, limit: 2 });
    const second = await names({ sort: "price-asc", page: 2, limit: 2 });
    const third = await names({ sort: "price-asc", page: 3, limit: 2 });
    expect([...first, ...second, ...third]).toEqual(["Soap", "Lotion", "Shampoo", "Oil", "Sold Out Cream"]);
  });
});
