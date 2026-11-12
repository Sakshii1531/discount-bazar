/**
 * API E2E — when saving an uploaded photo fails, the product edit is refused
 * and nothing about the product changes (no photo is silently dropped).
 */
import { jest } from "@jest/globals";

// Uploads are written to this server's disk; make that write fail.
const uploadToCloudinary = jest.fn(async () => {
  throw new Error("EACCES: permission denied, open 'public/uploads/products/x.png'");
});
const stub = jest.fn();
jest.unstable_mockModule("../../app/services/mediaService.js", () => {
  const api = {
    createUploadIntent: stub,
    generateSignedUploadURL: stub,
    confirmUpload: stub,
    getMediaURL: stub,
    deleteMedia: stub,
    uploadToCloudinary,
    isSignedUploadsEnabled: () => false,
  };
  return { ...api, default: api };
});

const { default: request } = await import("supertest");
const { startTestApp, stopTestApp, clearDatabase, bearer } = await import("./helpers/testApp.js");
const fx = await import("./helpers/fixtures.js");
const { default: Product } = await import("../../app/models/product.js");

jest.setTimeout(120000);

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const COVER = "https://cdn.example.test/cover.jpg";
const G1 = "https://cdn.example.test/g1.jpg";
const G2 = "https://cdn.example.test/g2.jpg";
const G3 = "https://cdn.example.test/g3.jpg";

let app;
let auth;
let product;

beforeAll(async () => {
  app = await startTestApp();
});
beforeEach(async () => {
  const seller = await fx.createSeller();
  const tree = await fx.createCategoryTree();
  auth = bearer("seller", seller._id);
  product = await fx.createProduct(seller, tree, { mainImage: COVER, galleryImages: [G1, G2, G3] });
});
afterEach(clearDatabase);
afterAll(stopTestApp);

it("keeps the old photos when a gallery upload fails", async () => {
  const res = await request(app)
    .put(`/api/products/${product._id}`)
    .set("Authorization", auth)
    .field("description", "edited")
    .field("galleryLayout", JSON.stringify([G1, "new", G3]))
    .attach("galleryImages", PNG, { filename: "g.png", contentType: "image/png" });
  expect(res.status).toBeGreaterThanOrEqual(500);
  expect(res.body.message).toMatch(/upload/i);
  expect(uploadToCloudinary).toHaveBeenCalled();

  const doc = await Product.findById(product._id).lean();
  expect(doc.galleryImages).toEqual([G1, G2, G3]);
  expect(doc.mainImage).toBe(COVER);
  expect(doc.description).not.toBe("edited");
});

it("keeps the old cover when a cover upload fails", async () => {
  const res = await request(app)
    .put(`/api/products/${product._id}`)
    .set("Authorization", auth)
    .field("description", "edited")
    .attach("mainImage", PNG, { filename: "c.png", contentType: "image/png" });
  expect(res.status).toBeGreaterThanOrEqual(500);
  const doc = await Product.findById(product._id).lean();
  expect(doc.mainImage).toBe(COVER);
  expect(doc.description).not.toBe("edited");
});
