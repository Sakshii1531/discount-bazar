import mongoose from "mongoose";
import Product from "../models/product.js";
import Category from "../models/category.js";
import Brand from "../models/brand.js";
import { getNearbySellerIdsForCustomer } from "./customerVisibilityService.js";
import { getCustomerVisibleFilter, normalizeProductModerationFields } from "./productModerationService.js";
import { enrichCatalogProducts } from "./productRecommendationService.js";

// Same fields as the public product list, so cards render identically.
const PRODUCT_FIELDS =
  "name slug description sku price salePrice stock brand brandId weight mainImage galleryImages headerId categoryId subcategoryId sellerId status approvalStatus isFeatured variants productDeliveryFee productDeliveryTimeMinutes ratingAverage ratingCount createdAt";

// A scrollable row lazy-loads on the client; cap what one section can pull.
const MAX_SCROLLABLE_PRODUCTS = 60;

const toIds = (list) =>
  (Array.isArray(list) ? list : [])
    .map((id) => String(id?._id || id || ""))
    .filter((id) => mongoose.Types.ObjectId.isValid(id));

/**
 * Category filter for a filter-driven product section. A selected category
 * contributes its selected subcategories when any were picked, otherwise the
 * whole category; subcategories picked without their category still count.
 */
async function buildCategoryFilter(categoryIds, subcategoryIds) {
  if (!categoryIds.length && !subcategoryIds.length) return {};
  const subs = subcategoryIds.length
    ? await Category.find({ _id: { $in: subcategoryIds } }).select("_id parentId").lean()
    : [];
  const narrowed = new Set(subs.map((s) => String(s.parentId || "")));
  const wholeCategories = categoryIds.filter((id) => !narrowed.has(id));

  const or = [];
  if (subcategoryIds.length) or.push({ subcategoryId: { $in: subcategoryIds } });
  if (wholeCategories.length) or.push({ categoryId: { $in: wholeCategories } });
  return or.length === 1 ? or[0] : { $or: or };
}

async function resolveProductSection(section, sellerIds) {
  const cfg = section.config?.products || {};
  const productIds = toIds(cfg.productIds);
  const base = { status: "active", sellerId: { $in: sellerIds }, ...getCustomerVisibleFilter() };

  let products;
  if (productIds.length) {
    // Curated list: keep the admin's order.
    const found = await Product.find({ ...base, _id: { $in: productIds } }).select(PRODUCT_FIELDS).lean();
    const byId = new Map(found.map((p) => [String(p._id), p]));
    products = productIds.map((id) => byId.get(id)).filter(Boolean);
  } else {
    const limit = cfg.singleRowScrollable
      ? MAX_SCROLLABLE_PRODUCTS
      : Math.max(1, Number(cfg.rows) || 1) * Math.max(1, Number(cfg.columns) || 2);
    const categoryFilter = await buildCategoryFilter(toIds(cfg.categoryIds), toIds(cfg.subcategoryIds));
    const findNewest = (stockFilter, max) =>
      Product.find({ $and: [base, categoryFilter, stockFilter] })
        .select(PRODUCT_FIELDS)
        .sort({ createdAt: -1 })
        .limit(max)
        .lean();
    // In-stock products fill the section first; out-of-stock ones only top it up.
    const inStock = await findNewest({ stock: { $gt: 0 } }, limit);
    const outOfStock =
      inStock.length < limit
        ? await findNewest({ $or: [{ stock: { $lte: 0 } }, { stock: null }] }, limit - inStock.length)
        : [];
    products = [...inStock, ...outOfStock];
  }
  // Curated lists keep the admin's order within each group; out-of-stock still go last.
  const isInStock = (p) => Number(p.stock) > 0;
  products = [...products.filter(isInStock), ...products.filter((p) => !isInStock(p))];
  const enriched = await enrichCatalogProducts(products);
  return enriched.map((p) => normalizeProductModerationFields(p));
}

/**
 * Attaches `products` (customer-visible, from sellers serving the location) to
 * every product section, so the storefront renders exactly what the section
 * selects instead of filtering whatever products the page happened to load.
 */
export async function resolveExperienceSectionProducts(sections = [], { lat, lng }) {
  const productSections = sections.filter((s) => s?.displayType === "products");
  const brandSections = sections.filter((s) => s?.displayType === "brands");
  if (!productSections.length && !brandSections.length) return sections;

  const sellerIds = await getNearbySellerIdsForCustomer(lat, lng);
  const resolved = new Map();
  await Promise.all(
    productSections.map(async (s) => {
      resolved.set(String(s._id), sellerIds.length ? await resolveProductSection(s, sellerIds) : []);
    }),
  );
  const available = brandSections.length ? await availableBrandKeys(sellerIds) : null;

  return sections.map((s) => {
    if (s?.displayType === "products") return { ...s, products: resolved.get(String(s._id)) || [] };
    if (s?.displayType === "brands") {
      // Only brands this customer can actually buy (in stock, nearby store).
      return { ...s, availableBrandKeys: available ? [...available] : [] };
    }
    return s;
  });
}

const brandKey = (name) => String(name || "").trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Name keys of brands with at least one customer-visible, in-stock product
 * from a store serving this location. Products are matched to brands by name
 * (the same rule the brand listing page uses).
 */
async function availableBrandKeys(sellerIds) {
  if (!sellerIds.length) return new Set();
  const names = await Product.distinct("brand", {
    status: "active",
    sellerId: { $in: sellerIds },
    ...getCustomerVisibleFilter(),
    brand: { $nin: [null, ""] },
    $or: [{ stock: { $gt: 0 } }, { "variants.stock": { $gt: 0 } }],
  });
  return new Set(names.map(brandKey).filter(Boolean));
}

/**
 * Replaces each brand section's ids with displayable cards (name, slug, logo)
 * in the order the admin chose: active brands only, filtered to what is
 * available at the customer's location when that is known, capped at
 * `maxItems`. A section with nothing to show is dropped rather than rendered
 * empty.
 */
export async function attachBrandCards(sections = []) {
  const brandSections = (sections || []).filter((s) => s?.displayType === "brands");
  if (!brandSections.length) return sections;

  const ids = [...new Set(brandSections.flatMap((s) => toIds(s.config?.brands?.brandIds)))];
  const docs = ids.length
    ? await Brand.find({ _id: { $in: ids }, status: "active" }).select("name slug logo").lean()
    : [];
  const byId = new Map(docs.map((b) => [String(b._id), b]));

  return sections
    .map((s) => {
      if (s?.displayType !== "brands") return s;
      const cfg = s.config?.brands || {};
      const availability = Array.isArray(s.availableBrandKeys) ? new Set(s.availableBrandKeys) : null;
      let cards = toIds(cfg.brandIds)
        .map((id) => byId.get(id))
        .filter(Boolean)
        .filter((b) => !availability || availability.has(brandKey(b.name)))
        .map((b) => ({ _id: String(b._id), name: b.name, slug: b.slug, logo: b.logo || "" }));
      if (Number(cfg.maxItems) > 0) cards = cards.slice(0, Number(cfg.maxItems));
      const { availableBrandKeys: _drop, ...rest } = s;
      return { ...rest, brands: cards };
    })
    .filter((s) => s?.displayType !== "brands" || s.brands.length > 0);
}
