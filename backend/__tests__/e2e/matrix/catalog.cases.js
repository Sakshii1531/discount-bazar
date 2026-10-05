/**
 * Catalogue & marketing endpoints: products (customer browse, seller CRUD,
 * stock, admin moderation), offers, offer sections, experience studio,
 * coupons and FAQs (both /admin and /public mounts).
 */
import { expect } from "@jest/globals";
import Product from "../../../app/models/product.js";
import { listOf } from "../helpers/world.js";

const OID = "64b7f0c2a1b2c3d4e5f60718";
const near = (ctx) => ({ lat: ctx.location.lat, lng: ctx.location.lng });
const productFields = (ctx) => ({
  name: "Paneer 200g",
  price: 90,
  salePrice: 85,
  stock: 20,
  headerId: String(ctx.tree.header._id),
  categoryId: String(ctx.tree.category._id),
  subcategoryId: String(ctx.tree.subcategory._id),
});

export default [
  // ── Customer browsing ─────────────────────────────────────────────────────
  { route: "GET /api/products", name: "customers must send a location", optionalAuth: true, status: 400 },
  {
    route: "GET /api/products",
    query: near,
    check: (res, ctx) => {
      const names = listOf(res).map((p) => p.name);
      expect(names).toEqual(expect.arrayContaining(["Fresh Milk", "Brown Bread", "Other Rice"]));
      expect(res.body.result.total).toBe(3);
    },
  },
  {
    route: "GET /api/products",
    name: "search, seller filter and sorting",
    query: (ctx) => ({ ...near(ctx), search: "milk", sellerId: String(ctx.seller._id), sort: "price-asc" }),
    check: (res) => expect(listOf(res).map((p) => p.name)).toEqual(["Fresh Milk"]),
  },
  {
    route: "GET /api/products",
    name: "nothing outside the delivery radius",
    query: { lat: 28.6139, lng: 77.209 },
    check: (res) => expect(listOf(res)).toEqual([]),
  },
  {
    route: "GET /api/products/:id",
    params: (ctx) => ({ id: ctx.milk._id }),
    query: near,
    check: (res) => expect(res.body.result).toEqual(expect.objectContaining({ name: "Fresh Milk", price: 60, salePrice: 55 })),
  },
  { route: "GET /api/products/:id", name: "unknown product", params: { id: OID }, query: near, status: 404 },

  // ── Seller product management ─────────────────────────────────────────────
  {
    route: "POST /api/products",
    as: "seller",
    attach: { field: "mainImage" },
    body: productFields,
    status: 201,
    check: (res, ctx) => {
      expect(res.body.result).toEqual(expect.objectContaining({ name: "Paneer 200g", price: 90, stock: 20 }));
      expect(res.body.result.approvalStatus).toBe("pending");
      ctx.newProductId = res.body.result._id;
    },
  },
  { route: "POST /api/products", name: "pending sellers are blocked", as: "pendingSeller", body: productFields, status: 403 },
  { route: "POST /api/products", name: "customers are denied", as: "customer", body: productFields, status: 403 },
  {
    route: "GET /api/products",
    name: "unapproved products stay hidden from customers",
    query: near,
    check: (res) => expect(listOf(res).map((p) => p.name)).not.toContain("Paneer 200g"),
  },
  {
    route: "GET /api/products/seller/me",
    as: "seller",
    check: (res, ctx) => {
      const ids = listOf(res).map((p) => String(p._id));
      expect(ids).toContain(String(ctx.newProductId));
      expect(ids).not.toContain(String(ctx.otherProduct._id));
    },
  },
  {
    route: "PUT /api/products/:id",
    as: "seller",
    params: (ctx) => ({ id: ctx.newProductId }),
    body: { price: 95 },
    check: (res) => {
      expect(res.body.result.price).toBe(95);
      expect(res.body.result.approvalStatus).toBe("pending");
    },
  },
  {
    route: "PUT /api/products/:id",
    name: "another seller cannot edit it",
    as: "otherSeller",
    params: (ctx) => ({ id: ctx.newProductId }),
    body: { price: 1 },
    status: [403, 404],
  },

  // ── Admin moderation ──────────────────────────────────────────────────────
  {
    route: "GET /api/products/moderation",
    name: "a seller edit keeps an unapproved product in the pending queue",
    as: "admin",
    query: { approvalStatus: "pending" },
    check: (res, ctx) => expect(listOf(res).map((p) => String(p._id))).toContain(String(ctx.newProductId)),
  },
  {
    route: "GET /api/products",
    name: "…and still hidden from customers after the edit",
    query: near,
    check: (res) => expect(listOf(res).map((p) => p.name)).not.toContain("Paneer 200g"),
  },
  { route: "GET /api/products/moderation", name: "sellers are denied", as: "seller", status: 403 },
  {
    route: "PATCH /api/products/moderation/:id/approve",
    as: "admin",
    params: (ctx) => ({ id: ctx.newProductId }),
    body: {},
    check: (res) => expect(res.body.result.approvalStatus).toBe("approved"),
  },
  {
    route: "GET /api/products",
    name: "approved product is now visible",
    query: near,
    check: (res) => expect(listOf(res).map((p) => p.name)).toContain("Paneer 200g"),
  },
  {
    route: "PATCH /api/products/moderation/:id/reject",
    as: "admin",
    params: (ctx) => ({ id: ctx.newProductId }),
    body: { reason: "Blurry image" },
    check: (res) => expect(res.body.result.approvalStatus).toBe("rejected"),
  },
  { route: "PATCH /api/products/moderation/:id/approve", name: "unknown product", as: "admin", params: { id: OID }, body: {}, status: 404 },

  // ── Stock ─────────────────────────────────────────────────────────────────
  {
    route: "POST /api/products/adjust-stock",
    as: "seller",
    body: (ctx) => ({ productId: String(ctx.milk._id), type: "Restock", quantity: 10, note: "Morning delivery" }),
    check: async (res, ctx) => {
      expect((await Product.findById(ctx.milk._id).lean()).stock).toBe(110);
    },
  },
  {
    route: "POST /api/products/adjust-stock",
    name: "unknown adjustment types are rejected without touching stock",
    as: "seller",
    body: (ctx) => ({ productId: String(ctx.milk._id), type: "add", quantity: 5 }),
    status: 400,
    check: async (res, ctx) => {
      expect((await Product.findById(ctx.milk._id).lean()).stock).toBe(110);
    },
  },
  { route: "POST /api/products/adjust-stock", name: "validates quantity", as: "seller", body: (ctx) => ({ productId: String(ctx.milk._id), type: "Restock", quantity: 0 }), status: 400 },
  { route: "POST /api/products/adjust-stock", name: "cannot adjust another seller's stock", as: "seller", body: (ctx) => ({ productId: String(ctx.otherProduct._id), type: "Restock", quantity: 1 }), status: 404 },
  {
    route: "GET /api/products/stock-history",
    as: "seller",
    check: (res) => {
      const entries = listOf(res);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toEqual(expect.objectContaining({ type: "Restock", quantity: "+10", productName: "Fresh Milk", note: "Morning delivery" }));
    },
  },
  {
    route: "DELETE /api/products/:id",
    as: "seller",
    params: (ctx) => ({ id: ctx.newProductId }),
    check: async (res, ctx) => expect(await Product.findById(ctx.newProductId)).toBeNull(),
  },
  { route: "DELETE /api/products/:id", name: "another seller cannot delete", as: "otherSeller", params: (ctx) => ({ id: ctx.milk._id }), status: [403, 404] },

  // ── Offers ────────────────────────────────────────────────────────────────
  {
    route: "POST /api/admin-offers",
    as: "admin",
    body: { title: "Big Sale", description: "Up to 50% off" },
    status: 201,
    check: (res, ctx) => {
      expect(res.body.result).toEqual(expect.objectContaining({ title: "Big Sale", status: "active" }));
      ctx.offerId = res.body.result._id;
    },
  },
  {
    route: "POST /api/admin-offers",
    name: "second offer",
    as: "admin",
    body: { title: "Combo Deal" },
    status: 201,
    check: (res, ctx) => {
      ctx.offerId2 = res.body.result._id;
    },
  },
  { route: "POST /api/admin-offers", name: "requires a title", as: "admin", body: {}, status: 400 },
  { route: "POST /api/admin-offers", name: "sellers are denied", as: "seller", body: { title: "x" }, status: 403 },
  {
    route: "GET /api/admin-offers",
    as: "admin",
    check: (res) => expect(listOf(res).map((o) => o.title)).toEqual(expect.arrayContaining(["Big Sale", "Combo Deal"])),
  },
  {
    route: "PUT /api/admin-offers/reorder",
    as: "admin",
    body: (ctx) => ({ ids: [ctx.offerId2, ctx.offerId], orderedIds: [ctx.offerId2, ctx.offerId] }),
  },
  {
    route: "PUT /api/admin-offers/:id",
    as: "admin",
    params: (ctx) => ({ id: ctx.offerId }),
    body: { title: "Mega Sale" },
    check: (res) => expect(res.body.result.title).toBe("Mega Sale"),
  },
  {
    route: "GET /api/offers",
    check: (res) => expect(listOf(res).map((o) => o.title)).toContain("Mega Sale"),
  },
  {
    route: "DELETE /api/admin-offers/:id",
    as: "admin",
    params: (ctx) => ({ id: ctx.offerId2 }),
  },
  { route: "DELETE /api/admin-offers/:id", name: "unknown offer", as: "admin", params: { id: OID }, status: 404 },

  // ── Offer sections ────────────────────────────────────────────────────────
  { route: "POST /api/admin-offer-sections", name: "requires a category", as: "admin", body: { title: "Deals" }, status: 400 },
  {
    route: "POST /api/admin-offer-sections",
    as: "admin",
    body: (ctx) => ({ title: "Dairy deals", categoryIds: [String(ctx.tree.category._id)], productIds: [String(ctx.milk._id)] }),
    status: 201,
    check: (res, ctx) => {
      ctx.sectionId = res.body.result._id;
      expect(res.body.result.title).toBe("Dairy deals");
    },
  },
  {
    route: "GET /api/admin-offer-sections",
    as: "admin",
    check: (res, ctx) => expect(listOf(res).map((s) => String(s._id))).toContain(String(ctx.sectionId)),
  },
  {
    route: "PUT /api/admin-offer-sections/reorder",
    as: "admin",
    body: (ctx) => ({ ids: [ctx.sectionId], orderedIds: [ctx.sectionId] }),
  },
  {
    route: "PUT /api/admin-offer-sections/:id",
    as: "admin",
    params: (ctx) => ({ id: ctx.sectionId }),
    body: { title: "Dairy & bakery deals" },
    check: (res) => expect(res.body.result.title).toBe("Dairy & bakery deals"),
  },
  { route: "GET /api/offer-sections", name: "requires location", status: 400 },
  {
    route: "GET /api/offer-sections",
    query: near,
    check: (res) => expect(listOf(res).map((s) => s.title)).toContain("Dairy & bakery deals"),
  },
  {
    route: "DELETE /api/admin-offer-sections/:id",
    as: "admin",
    params: (ctx) => ({ id: ctx.sectionId }),
  },

  // ── Experience studio ─────────────────────────────────────────────────────
  {
    route: "POST /api/admin/experience",
    as: "admin",
    body: (ctx) => ({ pageType: "home", title: "Top picks", displayType: "products", config: { products: { productIds: [String(ctx.milk._id)] } } }),
    status: 201,
    check: (res, ctx) => {
      ctx.experienceId = res.body.result._id;
      expect(res.body.result).toEqual(expect.objectContaining({ pageType: "home", status: "active" }));
    },
  },
  {
    route: "POST /api/admin/experience",
    name: "second section",
    as: "admin",
    body: { pageType: "home", title: "Banners", displayType: "banners" },
    status: 201,
    check: (res, ctx) => {
      ctx.experienceId2 = res.body.result._id;
    },
  },
  {
    route: "GET /api/admin/experience",
    as: "admin",
    query: { pageType: "home" },
    check: (res) => expect(listOf(res).map((s) => s.title)).toEqual(expect.arrayContaining(["Top picks", "Banners"])),
  },
  {
    route: "PUT /api/admin/experience/reorder",
    as: "admin",
    body: (ctx) => ({ pageType: "home", ids: [ctx.experienceId2, ctx.experienceId], orderedIds: [ctx.experienceId2, ctx.experienceId] }),
  },
  {
    route: "PUT /api/admin/experience/:id",
    as: "admin",
    params: (ctx) => ({ id: ctx.experienceId }),
    body: { title: "Today's picks" },
    check: (res) => expect(res.body.result.title).toBe("Today's picks"),
  },
  {
    route: "GET /api/experience",
    query: { pageType: "home" },
    check: (res) => expect(listOf(res).map((s) => s.title)).toContain("Today's picks"),
  },
  {
    route: "DELETE /api/admin/experience/:id",
    as: "admin",
    params: (ctx) => ({ id: ctx.experienceId2 }),
  },
  {
    route: "PUT /api/admin/experience/hero",
    as: "admin",
    body: { pageType: "home", banners: { items: [{ imageUrl: "https://cdn.example.test/hero.png" }] }, categoryIds: [] },
    check: (res) => expect(res.body.result.banners.items[0].imageUrl).toBe("https://cdn.example.test/hero.png"),
  },
  {
    route: "GET /api/admin/experience/hero",
    as: "admin",
    query: { pageType: "home" },
    check: (res) => expect(res.body.result.banners.items).toHaveLength(1),
  },
  {
    route: "GET /api/experience/hero",
    query: { pageType: "home" },
    check: (res) => expect(res.body.result.banners.items[0].imageUrl).toBe("https://cdn.example.test/hero.png"),
  },
  {
    route: "POST /api/admin/experience/upload-banner",
    as: "admin",
    attach: { field: "image" },
    check: (res) => expect(res.body.result.url).toMatch(/\/uploads\/banners\/.+\.png$/),
  },

  // ── Coupons ───────────────────────────────────────────────────────────────
  {
    route: "POST /api/admin/coupons",
    as: "admin",
    body: { code: "SAVE10", discountType: "percentage", discountValue: 10, validFrom: "2026-01-01", validTill: "2099-01-01", minOrderValue: 50 },
    status: 201,
    check: (res, ctx) => {
      ctx.couponId = res.body.result._id;
      expect(res.body.result).toEqual(expect.objectContaining({ code: "SAVE10", discountValue: 10, usedCount: 0 }));
    },
  },
  {
    route: "POST /api/admin/coupons",
    name: "duplicate codes are rejected",
    as: "admin",
    body: { code: "SAVE10", discountValue: 5, validFrom: "2026-01-01", validTill: "2099-01-01" },
    status: [400, 409],
  },
  { route: "POST /api/admin/coupons", name: "customers are denied", as: "customer", body: { code: "FREE", discountValue: 100 }, status: 403 },
  {
    route: "GET /api/admin/coupons",
    as: "admin",
    check: (res) => expect(listOf(res).map((c) => c.code)).toContain("SAVE10"),
  },
  {
    route: "PUT /api/admin/coupons/:id",
    as: "admin",
    params: (ctx) => ({ id: ctx.couponId }),
    body: { discountValue: 15 },
    check: (res) => expect(res.body.result.discountValue).toBe(15),
  },
  {
    route: "GET /api/coupons",
    query: { status: "active" },
    check: (res) => expect(listOf(res).map((c) => c.code)).toContain("SAVE10"),
  },
  {
    route: "POST /api/coupons/validate",
    as: "customer",
    optionalAuth: true,
    body: (ctx) => ({ code: "SAVE10", cartTotal: 100000, items: [{ productId: String(ctx.milk._id), quantity: 2, price: 1 }] }),
    check: (res) => {
      // Discount is computed from server prices (2 × ₹55), not the client's numbers.
      expect(res.body.result.discountAmount).toBeCloseTo(16.5, 0);
    },
  },
  {
    route: "POST /api/coupons/validate",
    name: "below minimum order value",
    optionalAuth: true,
    body: (ctx) => ({ code: "SAVE10", cartTotal: 10, items: [{ productId: String(ctx.bread._id), quantity: 1 }] }),
    status: 400,
  },
  { route: "POST /api/coupons/validate", name: "unknown code", optionalAuth: true, body: { code: "NOPE", cartTotal: 100, items: [] }, status: [400, 404] },
  {
    route: "DELETE /api/admin/coupons/:id",
    as: "admin",
    params: (ctx) => ({ id: ctx.couponId }),
  },

  // ── FAQs (/admin and /public mounts share one router) ─────────────────────
  {
    route: "POST /api/admin/faqs",
    as: "admin",
    body: { question: "How fast is delivery?", answer: "12-15 minutes", category: "Customer" },
    status: 201,
    check: (res, ctx) => {
      ctx.faqId = res.body.result._id;
    },
  },
  { route: "POST /api/admin/faqs", name: "customers are denied", as: "customer", body: { question: "q", answer: "a", category: "Customer" }, status: 403 },
  { route: "POST /api/public/faqs", name: "the public mount is read-only for non-admins", as: "customer", body: { question: "q", answer: "a", category: "Customer" }, status: 403 },
  {
    route: "POST /api/public/faqs",
    name: "admins can also write through the public mount",
    as: "admin",
    body: { question: "Do you deliver at night?", answer: "Until 11pm", category: "Customer" },
    status: 201,
    check: (res, ctx) => {
      ctx.faqId2 = res.body.result._id;
    },
  },
  {
    route: "GET /api/public/faqs",
    query: { category: "Customer", status: "published" },
    check: (res) => expect(listOf(res).map((f) => f.question)).toEqual(expect.arrayContaining(["How fast is delivery?", "Do you deliver at night?"])),
  },
  { route: "GET /api/admin/faqs", check: (res) => expect(listOf(res).length).toBe(2) },
  { route: "GET /api/admin/faqs/:id", params: (ctx) => ({ id: ctx.faqId }) },
  { route: "GET /api/public/faqs/:id", params: (ctx) => ({ id: ctx.faqId }) },
  {
    route: "PUT /api/admin/faqs/:id",
    as: "admin",
    params: (ctx) => ({ id: ctx.faqId }),
    body: { answer: "Usually 12-15 minutes" },
    check: (res) => expect(res.body.result.answer).toBe("Usually 12-15 minutes"),
  },
  {
    route: "PUT /api/public/faqs/:id",
    as: "admin",
    params: (ctx) => ({ id: ctx.faqId2 }),
    body: { status: "draft" },
    check: (res) => expect(res.body.result.status).toBe("draft"),
  },
  { route: "DELETE /api/public/faqs/:id", as: "admin", params: (ctx) => ({ id: ctx.faqId2 }) },
  { route: "DELETE /api/admin/faqs/:id", as: "admin", params: (ctx) => ({ id: ctx.faqId }) },
];
