/**
 * API E2E — a seller can replace and delete a saved product's cover and gallery
 * photos, and edits that do not touch photos leave them alone.
 */
import fs from "fs";
import path from "path";
import { jest } from "@jest/globals";
import request from "supertest";
import { startTestApp, stopTestApp, clearDatabase, bearer } from "./helpers/testApp.js";
import * as fx from "./helpers/fixtures.js";
import Product from "../../app/models/product.js";

jest.setTimeout(120000);

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const COVER = "https://cdn.example.test/cover.jpg";
const G1 = "https://cdn.example.test/g1.jpg";
const G2 = "https://cdn.example.test/g2.jpg";
const G3 = "https://cdn.example.test/g3.jpg";
const UPLOADED = /\/uploads\/products\/.+\.png$/;

let app;
let auth;
let product;
const uploaded = [];

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
afterAll(async () => {
  for (const url of uploaded) {
    // Uploads are saved as /uploads/... paths (older ones as absolute URLs).
    const pathname = /^https?:\/\//i.test(url) ? new URL(url).pathname : url;
    const file = path.join(process.cwd(), "public", pathname);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  await stopTestApp();
});

const saveForm = async ({ fields = {}, cover, gallery = [] }) => {
  let req = request(app).put(`/api/products/${product._id}`).set("Authorization", auth);
  for (const [key, value] of Object.entries(fields)) req = req.field(key, value);
  // A multipart form with no parts is not parseable, so always send one field.
  req = req.field("description", "edited");
  if (cover) req = req.attach("mainImage", cover, { filename: "cover.png", contentType: "image/png" });
  gallery.forEach((buffer, i) => {
    req = req.attach("galleryImages", buffer, { filename: `g${i}.png`, contentType: "image/png" });
  });
  return req;
};

const saved = async () => {
  const doc = await Product.findById(product._id).lean();
  [doc.mainImage, ...(doc.galleryImages || [])].forEach((url) => {
    if (UPLOADED.test(url || "")) uploaded.push(url);
  });
  return doc;
};

describe("edits that do not touch photos", () => {
  it("keep the gallery when a JSON edit changes something else", async () => {
    await request(app)
      .put(`/api/products/${product._id}`)
      .set("Authorization", auth)
      .send({ price: 70, salePrice: 65 })
      .expect(200);
    const doc = await saved();
    expect(doc.galleryImages).toEqual([G1, G2, G3]);
    expect(doc.mainImage).toBe(COVER);
    expect(doc.price).toBe(70);
  });

  it("keep the photos when the edit form saves with none changed", async () => {
    expect((await saveForm({})).status).toBe(200);
    const doc = await saved();
    expect(doc.galleryImages).toEqual([G1, G2, G3]);
    expect(doc.mainImage).toBe(COVER);
  });
});

describe("adding photos", () => {
  it("adds a gallery photo without touching the cover or the others", async () => {
    const res = await saveForm({ gallery: [PNG] });
    expect(res.status).toBe(200);
    const doc = await saved();
    expect(doc.mainImage).toBe(COVER);
    expect(doc.galleryImages.slice(0, 3)).toEqual([G1, G2, G3]);
    expect(doc.galleryImages[3]).toMatch(UPLOADED);
  });

  it("refuses a fifth gallery photo and changes nothing", async () => {
    const res = await saveForm({ gallery: [PNG, PNG] });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await saved()).galleryImages).toEqual([G1, G2, G3]);
  });
});

// Upload failures: see api-product-images-upload-failure.e2e.test.js
describe("replacing photos", () => {
  it("replaces the cover and leaves the gallery", async () => {
    const res = await saveForm({ cover: PNG });
    expect(res.status).toBe(200);
    const doc = await saved();
    expect(doc.mainImage).toMatch(UPLOADED);
    expect(doc.galleryImages).toEqual([G1, G2, G3]);
  });

  it("replaces a gallery photo in the same position", async () => {
    const res = await saveForm({ fields: { galleryLayout: JSON.stringify([G1, "new", G3]) }, gallery: [PNG] });
    expect(res.status).toBe(200);
    const doc = await saved();
    expect(doc.galleryImages[0]).toBe(G1);
    expect(doc.galleryImages[1]).toMatch(UPLOADED);
    expect(doc.galleryImages[2]).toBe(G3);
    expect(doc.mainImage).toBe(COVER);
  });
});

describe("adding the first photo to a draft product", () => {
  it("saves the uploaded cover and submits the product for approval", async () => {
    await Product.updateOne(
      { _id: product._id },
      { $set: { mainImage: "", galleryImages: [], approvalStatus: "draft" } },
    );
    const res = await saveForm({ cover: PNG });
    expect(res.status).toBe(200);
    expect(res.body.result.mainImage).toMatch(/^\/uploads\/products\/.+\.png$/);
    const doc = await saved();
    expect(doc.mainImage).toMatch(UPLOADED);
    expect(doc.approvalStatus).not.toBe("draft");
    const file = path.join(process.cwd(), "public", doc.mainImage);
    expect(fs.existsSync(file)).toBe(true);
  });
});

describe("deleting photos", () => {
  it("deletes one gallery photo", async () => {
    const res = await saveForm({ fields: { galleryLayout: JSON.stringify([G1, G3]) } });
    expect(res.status).toBe(200);
    const doc = await saved();
    expect(doc.galleryImages).toEqual([G1, G3]);
    expect(doc.mainImage).toBe(COVER);
  });

  it("deletes every gallery photo", async () => {
    await saveForm({ fields: { galleryLayout: "[]" } });
    const doc = await saved();
    expect(doc.galleryImages).toEqual([]);
    expect(doc.mainImage).toBe(COVER);
  });

  it("promotes the first gallery photo when the cover is deleted", async () => {
    const res = await saveForm({ fields: { removeMainImage: "true" } });
    expect(res.status).toBe(200);
    const doc = await saved();
    expect(doc.mainImage).toBe(G1);
    expect(doc.galleryImages).toEqual([G2, G3]);
  });

  it("takes the product offline as a draft when every photo is deleted", async () => {
    const res = await saveForm({ fields: { removeMainImage: "true", galleryLayout: "[]" } });
    expect(res.status).toBe(200);
    const doc = await saved();
    expect(doc.mainImage).toBeFalsy();
    expect(doc.galleryImages).toEqual([]);
    expect(doc.approvalStatus).toBe("draft");
  });

  it("does not let a seller add outside URLs through the layout", async () => {
    await saveForm({ fields: { galleryLayout: JSON.stringify([G1, "https://evil.example/x.jpg"]) } });
    expect((await saved()).galleryImages).toEqual([G1]);
  });
});

describe("other sellers", () => {
  it("cannot change this seller's photos", async () => {
    const other = await fx.createSeller();
    const res = await request(app)
      .put(`/api/products/${product._id}`)
      .set("Authorization", bearer("seller", other._id))
      .field("removeMainImage", "true")
      .field("galleryLayout", "[]");
    expect(res.status).toBe(404);
    expect((await saved()).galleryImages).toEqual([G1, G2, G3]);
  });
});
