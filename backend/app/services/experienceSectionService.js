import mongoose from "mongoose";
import Product from "../models/product.js";
import Category from "../models/category.js";
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
    products = await Product.find({ $and: [base, categoryFilter] })
      .select(PRODUCT_FIELDS)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  }
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
  if (!productSections.length) return sections;

  const sellerIds = await getNearbySellerIdsForCustomer(lat, lng);
  const resolved = new Map();
  await Promise.all(
    productSections.map(async (s) => {
      resolved.set(String(s._id), sellerIds.length ? await resolveProductSection(s, sellerIds) : []);
    }),
  );
  return sections.map((s) => (s?.displayType === "products" ? { ...s, products: resolved.get(String(s._id)) || [] } : s));
}
