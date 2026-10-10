import mongoose from "mongoose";
import Product from "../models/product.js";
import Order from "../models/order.js";
import { WORKFLOW_STATUS } from "../constants/orderWorkflow.js";
import { getCustomerVisibleFilter } from "./productModerationService.js";
import { resolveCategoryName, resolveSellerName } from "./entityNameCache.js";

/**
 * Product-detail recommendation sections (Similar products, Top products in
 * this category, Brands in this category, People also bought).
 *
 * Everything here is derived from existing data: the category tree stored on
 * each product (headerId > categoryId > subcategoryId), the product's own
 * `brand` field, its `tags`, and successfully delivered order items. Customer
 * eligibility is the same rule every storefront listing uses (active,
 * approved, has an image, sold by a seller that serves the customer).
 */

export const SECTION_LIMIT = 12;
export const BRAND_LIMIT = 20;

// Candidate pool sizes keep every query bounded.
const SIMILAR_POOL = 80;
const CATEGORY_POOL = 200;
const RELATED_POOL = 60;

// Only sales from this window count towards "Top products".
export const POPULARITY_WINDOW_DAYS = 180;
// How many recent orders containing the product are scanned for co-purchases.
const CO_PURCHASE_ORDER_SCAN = 1000;
// A pair must appear in at least this many separate orders from at least this
// many different customers before it is shown as "People also bought". The
// customer threshold also stops one shopper's basket from being revealed.
export const MIN_CO_PURCHASE_ORDERS = 2;
export const MIN_CO_PURCHASE_CUSTOMERS = 2;

// Orders whose return was accepted are not treated as successful purchases.
const RETURNED_ORDER_STATUSES = ["returned", "qc_passed", "refund_completed"];

// Fields a customer-facing product card needs. Variant purchase costs and
// moderation internals are deliberately left out.
export const CUSTOMER_CARD_FIELDS = [
  "name",
  "slug",
  "price",
  "salePrice",
  "stock",
  "brand",
  "weight",
  "mainImage",
  "galleryImages",
  "headerId",
  "categoryId",
  "subcategoryId",
  "sellerId",
  "status",
  "isFeatured",
  "tags",
  "ratingAverage",
  "ratingCount",
  "productDeliveryFee",
  "productDeliveryTimeMinutes",
  "createdAt",
  "variants.name",
  "variants.size",
  "variants.colour",
  "variants.price",
  "variants.salePrice",
  "variants.stock",
  "variants.sku",
].join(" ");

const STOP_WORDS = new Set([
  "and", "the", "with", "for", "of", "in", "a", "an", "pack", "combo", "new",
  "g", "gm", "gms", "kg", "ml", "l", "ltr", "pcs", "pc", "x",
]);

export function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(String(value || "")) &&
    /^[a-f0-9]{24}$/i.test(String(value || ""));
}

function toId(value) {
  if (!value) return null;
  const raw = value?._id || value;
  return isValidObjectId(raw) ? String(raw) : null;
}

export function normalizeBrand(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Lower-case word tokens from a product name, without sizes and filler words. */
export function nameTokens(name) {
  return new Set(
    String(name || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1 && !STOP_WORDS.has(t) && !/^\d+(\.\d+)?$/.test(t)),
  );
}

function tagSet(tags) {
  return new Set(
    (Array.isArray(tags) ? tags : [])
      .map((t) => String(t || "").trim().toLowerCase())
      .filter(Boolean),
  );
}

function overlap(a, b) {
  let count = 0;
  for (const item of a) if (b.has(item)) count += 1;
  return count;
}

/** Same item listed by several sellers (or twice) is shown once. */
function listingKey(p) {
  return [
    String(p.name || "").trim().toLowerCase(),
    String(p.weight || "").trim().toLowerCase(),
    normalizeBrand(p.brand),
  ].join("|");
}

function dedupeListings(products, seen = new Set()) {
  const out = [];
  for (const p of products) {
    const idKey = `id:${String(p._id)}`;
    const key = listingKey(p);
    if (seen.has(idKey) || seen.has(key)) continue;
    seen.add(idKey);
    seen.add(key);
    out.push(p);
  }
  return out;
}

/**
 * Mongo filter for products a customer may see and buy. `sellerIds` is the
 * list of sellers that serve the customer's location (null = no location
 * restriction, used for admin/seller previews).
 */
export function buildEligibleProductFilter({ sellerIds = null, inStockOnly = true } = {}) {
  const base = { status: "active" };
  // ObjectIds (not strings) so the filter also works inside aggregations.
  if (Array.isArray(sellerIds)) {
    base.sellerId = {
      $in: sellerIds.filter(isValidObjectId).map((id) => new mongoose.Types.ObjectId(String(id))),
    };
  }
  if (inStockOnly) base.stock = { $gt: 0 };
  return { $and: [base, getCustomerVisibleFilter()] };
}

/** Orders that count as a completed purchase. */
export function buildSuccessfulOrderFilter() {
  return {
    $and: [
      {
        $or: [
          { workflowStatus: WORKFLOW_STATUS.DELIVERED },
          { orderStatus: { $regex: /^delivered$/i } },
          { status: { $regex: /^delivered$/i } },
        ],
      },
      { returnStatus: { $nin: RETURNED_ORDER_STATUSES } },
    ],
  };
}

/**
 * Replace category/seller ids with `{ _id, name }` objects (cache-backed name
 * lookups, no populate) — the shape storefront product lists already use.
 */
export async function enrichCatalogProducts(rawProducts = []) {
  const categoryIdSet = new Set();
  const sellerIdSet = new Set();
  for (const p of rawProducts) {
    if (p.headerId) categoryIdSet.add(String(p.headerId));
    if (p.categoryId) categoryIdSet.add(String(p.categoryId));
    if (p.subcategoryId) categoryIdSet.add(String(p.subcategoryId));
    if (p.sellerId) sellerIdSet.add(String(p.sellerId));
  }

  const [categoryEntries, sellerEntries] = await Promise.all([
    Promise.all([...categoryIdSet].map(async (id) => [id, await resolveCategoryName(id)])),
    Promise.all([...sellerIdSet].map(async (id) => [id, await resolveSellerName(id)])),
  ]);
  const nameMap = Object.fromEntries([...categoryEntries, ...sellerEntries]);

  return rawProducts.map((p) => ({
    ...p,
    headerId: p.headerId ? { _id: p.headerId, name: nameMap[String(p.headerId)] ?? null } : null,
    categoryId: p.categoryId ? { _id: p.categoryId, name: nameMap[String(p.categoryId)] ?? null } : null,
    subcategoryId: p.subcategoryId
      ? { _id: p.subcategoryId, name: nameMap[String(p.subcategoryId)] ?? null }
      : null,
    sellerId: p.sellerId ? { _id: p.sellerId, shopName: nameMap[String(p.sellerId)] ?? null } : null,
  }));
}

function findEligible(filter, extra, { limit, sort = { createdAt: -1, _id: -1 } }) {
  return Product.find({ $and: [filter, extra] })
    .select(CUSTOMER_CARD_FIELDS)
    .sort(sort)
    .limit(limit)
    .lean();
}

/* ── Similar products ─────────────────────────────────────────────────────── */

/**
 * Same subcategory first (same product type), then products elsewhere in the
 * category that share tags or name words. Other brands rank above the same
 * brand so the section is not just one brand's catalogue.
 */
export async function getSimilarProducts(product, eligibleFilter, limit = SECTION_LIMIT) {
  const subcategoryId = toId(product.subcategoryId);
  const categoryId = toId(product.categoryId);
  if (!subcategoryId && !categoryId) return [];

  const excludeSelf = { _id: { $ne: product._id } };
  const [sameSub, sameCategory] = await Promise.all([
    subcategoryId
      ? findEligible(eligibleFilter, { ...excludeSelf, subcategoryId }, { limit: SIMILAR_POOL })
      : [],
    categoryId
      ? findEligible(
          eligibleFilter,
          { ...excludeSelf, categoryId, ...(subcategoryId ? { subcategoryId: { $ne: subcategoryId } } : {}) },
          { limit: SIMILAR_POOL },
        )
      : [],
  ]);

  const baseTokens = nameTokens(product.name);
  const baseTags = tagSet(product.tags);
  const baseBrand = normalizeBrand(product.brand);

  const score = (p, sameSubcategory) => {
    const tagHits = overlap(baseTags, tagSet(p.tags));
    const wordHits = overlap(baseTokens, nameTokens(p.name));
    const brand = normalizeBrand(p.brand);
    return {
      p,
      sameSubcategory,
      relevance: tagHits * 3 + wordHits * 2,
      otherBrand: Boolean(baseBrand && brand && brand !== baseBrand) || (!baseBrand && Boolean(brand)),
    };
  };

  const scored = [
    ...sameSub.map((p) => score(p, true)),
    // Outside the subcategory a product must share something meaningful.
    ...sameCategory.map((p) => score(p, false)).filter((s) => s.relevance > 0),
  ];

  scored.sort(
    (a, b) =>
      Number(b.sameSubcategory) - Number(a.sameSubcategory) ||
      b.relevance - a.relevance ||
      Number(b.otherBrand) - Number(a.otherBrand) ||
      (Number(b.p.ratingCount) || 0) - (Number(a.p.ratingCount) || 0) ||
      String(a.p._id).localeCompare(String(b.p._id)),
  );

  const seen = new Set([`id:${String(product._id)}`, listingKey(product)]);
  return dedupeListings(scored.map((s) => s.p), seen).slice(0, limit);
}

/* ── Top products in this category ────────────────────────────────────────── */

/**
 * Ranks eligible products of the product's category by units sold in
 * delivered orders over the last POPULARITY_WINDOW_DAYS. Products without
 * sales follow in a declared fallback order (admin "featured" flag, rating
 * count, newest). `basis` is "sales" only when the first item really sold.
 */
export async function getTopProductsInCategory(product, eligibleFilter, limit = SECTION_LIMIT) {
  const categoryId = toId(product.categoryId);
  const subcategoryId = toId(product.subcategoryId);
  const scope = categoryId
    ? { type: "category", id: categoryId }
    : subcategoryId
      ? { type: "subcategory", id: subcategoryId }
      : null;
  if (!scope) return { basis: "none", scope: null, items: [] };

  const candidates = await findEligible(
    eligibleFilter,
    { _id: { $ne: product._id }, [`${scope.type}Id`]: scope.id },
    { limit: CATEGORY_POOL },
  );
  scope.name = await resolveCategoryName(scope.id);
  if (!candidates.length) return { basis: "none", scope, items: [] };

  const since = new Date(Date.now() - POPULARITY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const candidateIds = candidates.map((p) => p._id);
  const sales = await Order.aggregate([
    {
      $match: {
        $and: [
          { "items.product": { $in: candidateIds } },
          { createdAt: { $gte: since } },
          buildSuccessfulOrderFilter(),
        ],
      },
    },
    { $unwind: "$items" },
    {
      $match: {
        "items.product": { $in: candidateIds },
        "items.returnStatus": { $ne: "completed" },
      },
    },
    {
      $group: {
        _id: "$items.product",
        units: { $sum: "$items.quantity" },
        orders: { $addToSet: "$_id" },
      },
    },
    { $project: { units: 1, orders: { $size: "$orders" } } },
  ]);

  const salesById = new Map(sales.map((s) => [String(s._id), s]));
  const ranked = [...candidates].sort((a, b) => {
    const sa = salesById.get(String(a._id));
    const sb = salesById.get(String(b._id));
    return (
      (sb?.units || 0) - (sa?.units || 0) ||
      (sb?.orders || 0) - (sa?.orders || 0) ||
      Number(Boolean(b.isFeatured)) - Number(Boolean(a.isFeatured)) ||
      (Number(b.ratingCount) || 0) - (Number(a.ratingCount) || 0) ||
      new Date(b.createdAt || 0) - new Date(a.createdAt || 0) ||
      String(a._id).localeCompare(String(b._id))
    );
  });

  const items = dedupeListings(ranked, new Set([`id:${String(product._id)}`])).slice(0, limit);
  const basis = items.length && salesById.has(String(items[0]._id)) ? "sales" : "catalog";
  return { basis, scope, items };
}

/* ── Brands in this category ──────────────────────────────────────────────── */

async function brandsFor(eligibleFilter, match) {
  const rows = await Product.aggregate([
    { $match: { $and: [eligibleFilter, match, { brand: { $type: "string", $nin: ["", null] } }] } },
    { $project: { brand: { $trim: { input: "$brand" } } } },
    { $match: { brand: { $ne: "" } } },
    { $group: { _id: { key: { $toLower: "$brand" }, label: "$brand" }, count: { $sum: 1 } } },
    { $sort: { count: -1, "_id.label": 1 } },
    // One row per brand; the most used spelling becomes the display name.
    {
      $group: {
        _id: "$_id.key",
        name: { $first: "$_id.label" },
        productCount: { $sum: "$count" },
      },
    },
    { $sort: { productCount: -1, name: 1 } },
    { $limit: BRAND_LIMIT },
  ]);
  return rows.map((r) => ({ name: r.name, productCount: r.productCount }));
}

/**
 * Brands with at least one eligible product next to this one. Uses the
 * subcategory (e.g. Mustard Oil) and widens to the category when the
 * subcategory has fewer than two brands.
 */
export async function getBrandsInCategory(product, eligibleFilter) {
  const subcategoryId = toId(product.subcategoryId);
  const categoryId = toId(product.categoryId);

  if (subcategoryId) {
    const brands = await brandsFor(eligibleFilter, { subcategoryId: new mongoose.Types.ObjectId(subcategoryId) });
    if (brands.length >= 2 || !categoryId) {
      return {
        scope: { type: "subcategory", id: subcategoryId, name: await resolveCategoryName(subcategoryId) },
        items: brands,
      };
    }
  }
  if (!categoryId) return { scope: null, items: [] };
  return {
    scope: { type: "category", id: categoryId, name: await resolveCategoryName(categoryId) },
    items: await brandsFor(eligibleFilter, { categoryId: new mongoose.Types.ObjectId(categoryId) }),
  };
}

/* ── People also bought ───────────────────────────────────────────────────── */

/**
 * Products that appear in the same delivered orders as this one. Only
 * aggregate counts are used; nothing about individual orders or customers
 * leaves this function.
 */
export async function getCoPurchasedProductIds(productId) {
  const productObjectId = new mongoose.Types.ObjectId(String(productId));
  const rows = await Order.aggregate([
    { $match: { $and: [{ "items.product": productObjectId }, buildSuccessfulOrderFilter()] } },
    { $sort: { createdAt: -1 } },
    { $limit: CO_PURCHASE_ORDER_SCAN },
    { $project: { customer: 1, createdAt: 1, items: { product: 1, returnStatus: 1 } } },
    { $unwind: "$items" },
    { $match: { "items.product": { $ne: productObjectId }, "items.returnStatus": { $ne: "completed" } } },
    {
      $group: {
        _id: "$items.product",
        orders: { $addToSet: "$_id" },
        customers: { $addToSet: "$customer" },
        lastBoughtAt: { $max: "$createdAt" },
      },
    },
    {
      $project: {
        orders: { $size: "$orders" },
        customers: { $size: "$customers" },
        lastBoughtAt: 1,
      },
    },
    {
      $match: {
        orders: { $gte: MIN_CO_PURCHASE_ORDERS },
        customers: { $gte: MIN_CO_PURCHASE_CUSTOMERS },
      },
    },
    { $sort: { orders: -1, customers: -1, lastBoughtAt: -1, _id: 1 } },
    { $limit: SECTION_LIMIT * 4 },
  ]);
  return rows.map((r) => r._id);
}

/**
 * `source` tells the client which title to use: "co_purchase" is verified
 * order data; "related_category" is a declared fallback (other subcategories
 * of the same department) shown when there is not enough order history.
 */
export async function getAlsoBought(product, eligibleFilter, { exclude = new Set(), limit = SECTION_LIMIT } = {}) {
  const coIds = await getCoPurchasedProductIds(product._id);
  if (coIds.length) {
    const found = await findEligible(eligibleFilter, { _id: { $in: coIds } }, { limit: coIds.length });
    const byId = new Map(found.map((p) => [String(p._id), p]));
    const ordered = coIds.map((id) => byId.get(String(id))).filter(Boolean);
    const items = dedupeListings(ordered, new Set([`id:${String(product._id)}`, ...exclude])).slice(0, limit);
    if (items.length) return { source: "co_purchase", items };
  }

  const headerId = toId(product.headerId);
  const categoryId = toId(product.categoryId);
  const subcategoryId = toId(product.subcategoryId);
  const scope = headerId ? { headerId } : categoryId ? { categoryId } : null;
  if (!scope) return { source: "none", items: [] };

  const related = await findEligible(
    eligibleFilter,
    {
      ...scope,
      _id: { $ne: product._id },
      ...(subcategoryId ? { subcategoryId: { $ne: subcategoryId } } : {}),
    },
    { limit: RELATED_POOL, sort: { isFeatured: -1, ratingCount: -1, createdAt: -1, _id: -1 } },
  );
  // Prefer other categories of the department (complements, not substitutes).
  const ranked = [...related].sort(
    (a, b) =>
      Number(String(b.categoryId) !== String(categoryId)) - Number(String(a.categoryId) !== String(categoryId)),
  );
  const items = dedupeListings(ranked, new Set([`id:${String(product._id)}`, listingKey(product), ...exclude])).slice(0, limit);
  return { source: items.length ? "related_category" : "none", items };
}

/* ── All sections ─────────────────────────────────────────────────────────── */

async function settle(name, fn, fallback, errors) {
  try {
    return await fn();
  } catch (error) {
    errors.push(name);
    return fallback;
  }
}

/**
 * Computes every section independently; a failing section comes back empty
 * and is listed in `errors`, the others are unaffected.
 */
export async function buildProductRecommendations(product, { sellerIds = null } = {}) {
  const eligibleFilter = buildEligibleProductFilter({ sellerIds, inStockOnly: true });
  const errors = [];

  const [similar, topInCategory, brandsInCategory] = await Promise.all([
    settle("similar", () => getSimilarProducts(product, eligibleFilter), [], errors),
    settle("topInCategory", () => getTopProductsInCategory(product, eligibleFilter), { basis: "none", scope: null, items: [] }, errors),
    settle("brandsInCategory", () => getBrandsInCategory(product, eligibleFilter), { scope: null, items: [] }, errors),
  ]);

  // "People also bought" should not repeat what "Similar products" shows.
  const shownAsSimilar = new Set(similar.flatMap((p) => [`id:${String(p._id)}`, listingKey(p)]));
  const alsoBought = await settle(
    "alsoBought",
    () => getAlsoBought(product, eligibleFilter, { exclude: shownAsSimilar }),
    { source: "none", items: [] },
    errors,
  );

  const [similarItems, topItems, alsoBoughtItems] = await Promise.all([
    enrichCatalogProducts(similar),
    enrichCatalogProducts(topInCategory.items),
    enrichCatalogProducts(alsoBought.items),
  ]);

  return {
    productId: String(product._id),
    similar: { items: similarItems },
    topInCategory: { ...topInCategory, items: topItems },
    brandsInCategory,
    alsoBought: { ...alsoBought, items: alsoBoughtItems },
    errors,
  };
}
