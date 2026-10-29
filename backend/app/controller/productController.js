import mongoose from "mongoose";
import Product from "../models/product.js";
import Brand, { toBrandNameKey } from "../models/brand.js";
import { getProductReviewState } from "./productRatingController.js";
import { handleResponse } from "../utils/helper.js";
import { slugify } from "../utils/slugify.js";
import getPagination from "../utils/pagination.js";
import Admin from "../models/admin.js";
import { emitNotificationEvent } from "../modules/notifications/notification.emitter.js";
import { NOTIFICATION_EVENTS } from "../modules/notifications/notification.constants.js";
import { emitPendingReviewUpdateToAdmins } from "../services/orderSocketEmitter.js";

async function getAdminIds() {
    const admins = await Admin.find().select("_id").lean();
    return (admins || []).map((a) => a?._id).filter(Boolean);
}
import {
  parseCustomerCoordinates,
  getNearbySellerIdsForCustomer,
} from "../services/customerVisibilityService.js";
import {
  enqueueProductIndex,
  enqueueProductRemoval,
} from "../services/searchSyncService.js";
import { buildKey, getOrSet, getTTL, invalidate } from "../services/cacheService.js";
import { uploadToCloudinary } from "../services/mediaService.js";
import logger from "../services/logger.js";
import {
  PRODUCT_APPROVAL_STATUS,
  getProductApprovalConfig,
  getApprovedOrLegacyFilter,
  getCustomerVisibleFilter,
  buildApprovalStatusFilter,
  normalizeProductModerationFields,
  sanitizeApprovalNote,
  resolveProductApprovalStatus,
} from "../services/productModerationService.js";
import { buildSearchRegex, escapeRegex } from "../utils/regex.js";
import { buildProductSearchFilter } from "../services/productSearchService.js";
import { computePurchaseGst } from "../utils/money.js";
import { parseAndValidateReturnPolicy } from "../validation/returnPolicyValidation.js";
import { decorateProductsWithDelivery, quoteCartDelivery } from "../services/deliveryQuoteService.js";
import { getOrCreateFinanceSettings } from "../services/finance/financeSettingsService.js";
import { dynamicSuffix, makeProductSku, fillBlankVariantSkus } from "../utils/sku.js";
import {
  buildProductRecommendations,
  enrichCatalogProducts,
  isValidObjectId,
} from "../services/productRecommendationService.js";

// Phase 3 P3-5: when search term is reasonably specific and the env flag
// is enabled, prefer Mongo's `name + tags` text index over case-insensitive
// regex. Default OFF — keeps existing substring-search semantics so the
// behavior of the customer-facing search bar is unchanged unless explicitly
// opted in by ops.
function isProductTextSearchEnabled() {
  return (
    String(process.env.PRODUCT_SEARCH_USE_TEXT || "false").toLowerCase() === "true"
  );
}

function buildProductListKey(queryParams) {
  const sorted = Object.keys(queryParams)
    .sort()
    .reduce((acc, k) => {
      acc[k] = String(queryParams[k] ?? "").trim().toLowerCase();
      return acc;
    }, {});
  return buildKey("catalog", "productList", JSON.stringify(sorted));
}

function isCustomerVisibilityRequest(req) {
  const role = String(req.user?.role || "").toLowerCase();
  // Admin and seller should not be subject to location filtering
  return !role || (role !== "admin" && role !== "seller" && role !== "delivery");
}

function parseSellerIdFilters({ sellerId, sellerIds }) {
  if (typeof sellerIds === "string" && sellerIds.trim()) {
    return sellerIds
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
      .map(String);
  }

  if (sellerId) {
    return [String(sellerId)];
  }

  return [];
}

/**
 * Returns a slug that is guaranteed to be unique in the Product collection.
 * Appends a fresh dynamic suffix on every call — collision-free in practice.
 * Falls back to another fresh suffix up to 5 times, then uses full timestamp.
 * Pass excludeId when updating so the product's own slug is not a false conflict.
 */
async function ensureUniqueSlug(baseSlug, excludeId = null) {
  for (let i = 0; i < 5; i++) {
    const candidate = `${baseSlug}-${dynamicSuffix().toLowerCase()}`;
    const filter = { slug: candidate };
    if (excludeId) filter._id = { $ne: excludeId };
    const exists = await Product.exists(filter).lean();
    if (!exists) return candidate;
  }
  return `${baseSlug}-${Date.now().toString(36)}`;
}

/**
 * Returns a top-level SKU that is guaranteed to be unique in the Product collection.
 * For auto-generated SKUs the dynamicSuffix already makes them unique;
 * for explicit (user-typed) SKUs we verify and regenerate if needed.
 * Pass excludeId when updating so the product's own SKU is not a false conflict.
 */
async function ensureUniqueSku(baseSku, excludeId = null) {
  let candidate = baseSku;
  for (let i = 0; i < 5; i++) {
    const filter = { sku: candidate };
    if (excludeId) filter._id = { $ne: excludeId };
    const exists = await Product.exists(filter).lean();
    if (!exists) return candidate;
    const prefix = baseSku.split("-")[0] || "ITEM";
    candidate = `${prefix}-${dynamicSuffix()}`;
  }
  return `${baseSku}-${Date.now().toString(36).toUpperCase()}`;
}

function parseJsonIfString(value) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function normalizeUrl(value) {
  const normalized = String(value || "").trim();
  if (!/^https?:\/\//i.test(normalized)) return "";
  return normalized;
}

function parseImageList(input) {
  const candidate = parseJsonIfString(input);
  if (Array.isArray(candidate)) {
    return candidate.map((item) => normalizeUrl(item)).filter(Boolean);
  }
  if (typeof candidate === "string" && candidate.includes(",")) {
    return candidate
      .split(",")
      .map((item) => normalizeUrl(item))
      .filter(Boolean);
  }
  const single = normalizeUrl(candidate);
  return single ? [single] : [];
}

// Barcode must be unique per seller (product-level and variant-level), and
// MRP must not be below the selling price.
async function assertItemMasterValid(productData, sellerId, excludeId = null) {
  const variantCodes = [];
  if (Array.isArray(productData.variants)) {
    productData.variants.forEach((v) => {
      const b = v?.barcode && String(v.barcode).trim();
      if (b) variantCodes.push(b);
    });
  }
  if (new Set(variantCodes).size !== variantCodes.length) {
    throw Object.assign(new Error("Duplicate barcode within product variants"), { statusCode: 400 });
  }
  // Stock, purchase bills and POS lines find a variant by SKU, so it must be unique.
  if (Array.isArray(productData.variants)) {
    const skus = productData.variants
      .map((v) => String(v?.sku || "").trim().toLowerCase())
      .filter(Boolean);
    if (new Set(skus).size !== skus.length) {
      throw Object.assign(new Error("Two variants have the same SKU"), { statusCode: 400 });
    }
  }

  const allUniqueCodes = new Set(variantCodes);
  if (productData.barcode && String(productData.barcode).trim()) {
    allUniqueCodes.add(String(productData.barcode).trim());
  }
  const codes = Array.from(allUniqueCodes);

  if (codes.length) {
    const clash = await Product.findOne({
      sellerId,
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
      $or: [{ barcode: { $in: codes } }, { "variants.barcode": { $in: codes } }],
    }).select("name").lean();
    if (clash) {
      throw Object.assign(new Error(`Barcode already used by "${clash.name}"`), { statusCode: 409 });
    }
  }
  const mrp = Number(productData.mrp);
  const sell = Number(productData.salePrice) > 0 ? Number(productData.salePrice) : Number(productData.price);
  if (mrp > 0 && sell > 0 && mrp < sell) {
    throw Object.assign(new Error("MRP cannot be lower than the selling price"), { statusCode: 400 });
  }
}

// Purchase-price GST: validate inputs and recompute the breakdown server-side
// (client-sent computed values are ignored). `existing` = current product on update.
const PURCHASE_GST_COMPUTED = ["purchaseBasePrice", "purchaseGstAmount", "purchaseFinalPrice"];
function applyPurchaseGst(productData, existing = null) {
  PURCHASE_GST_COMPUTED.forEach((k) => delete productData[k]);
  if (Array.isArray(productData.variants)) {
    productData.variants.forEach((v) => v && PURCHASE_GST_COMPUTED.forEach((k) => delete v[k]));
  }

  const touched =
    productData.purchaseCost !== undefined ||
    productData.gstPercent !== undefined ||
    productData.purchaseGstType !== undefined ||
    Array.isArray(productData.variants);
  if (existing && !touched) return;

  if (productData.purchaseGstType !== undefined) {
    const t = String(productData.purchaseGstType || "").trim().toUpperCase();
    if (t && !["INCLUSIVE", "EXCLUSIVE"].includes(t)) {
      throw Object.assign(new Error("GST type must be Inclusive or Exclusive"), { statusCode: 400 });
    }
    productData.purchaseGstType = t || "EXCLUSIVE";
  }
  if (productData.gstPercent === "") productData.gstPercent = 0;

  const type = productData.purchaseGstType ?? existing?.purchaseGstType ?? "EXCLUSIVE";
  const rate = productData.gstPercent ?? existing?.gstPercent ?? 0;

  // Validates rate (and throws 400 on negative / non-numeric) even when price is empty
  const top = computePurchaseGst(productData.purchaseCost ?? existing?.purchaseCost ?? 0, rate, type);
  if (productData.purchaseCost !== undefined && productData.purchaseCost !== "") {
    productData.purchaseCost = Number(productData.purchaseCost);
  }
  if (productData.gstPercent !== undefined) productData.gstPercent = Number(productData.gstPercent);
  productData.purchaseBasePrice = top.basePrice;
  productData.purchaseGstAmount = top.gstAmount;
  productData.purchaseFinalPrice = top.finalPrice;

  // Variants: recompute each one; on an update that only changed GST type/rate,
  // refresh the stored variants so their breakdown stays in sync.
  let variants = productData.variants;
  if (!Array.isArray(variants) && existing && Array.isArray(existing.variants) && existing.variants.length) {
    variants = existing.variants.map((v) => (typeof v.toObject === "function" ? v.toObject() : { ...v }));
    productData.variants = variants;
  }
  if (Array.isArray(variants)) {
    variants.forEach((v) => {
      if (!v || v.purchaseCost === undefined || v.purchaseCost === null || v.purchaseCost === "") return;
      const b = computePurchaseGst(v.purchaseCost, rate, type);
      v.purchaseCost = Number(v.purchaseCost);
      v.purchaseBasePrice = b.basePrice;
      v.purchaseGstAmount = b.gstAmount;
      v.purchaseFinalPrice = b.finalPrice;
    });
  }
}

// Seller delivery extras: empty means 0; negative, non-numeric or fractional minutes are rejected.
function applyDeliveryFields(productData) {
  const parse = (key, label, { integer = false } = {}) => {
    if (productData[key] === undefined) return;
    const raw = productData[key];
    if (raw === "" || raw === null) {
      productData[key] = 0;
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      throw Object.assign(new Error(label + " must be 0 or more"), { statusCode: 400 });
    }
    if (integer && !Number.isInteger(n)) {
      throw Object.assign(new Error(label + " must be whole minutes"), { statusCode: 400 });
    }
    productData[key] = integer ? n : Math.round(n * 100) / 100;
  };
  parse("productDeliveryFee", "Product delivery fee");
  parse("productDeliveryTimeMinutes", "Product delivery time", { integer: true });
}

// Expiry dates: empty means none; the product-level date is the default for
// variants that have no expiry of their own.
function applyExpiryDates(productData) {
  const parse = (raw, label) => {
    if (raw === "" || raw === null) return null;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) {
      throw Object.assign(new Error(label + " is not a valid date"), { statusCode: 400 });
    }
    return d;
  };
  if (productData.expiryDate !== undefined) {
    productData.expiryDate = parse(productData.expiryDate, "Expiry date");
  }
  if (Array.isArray(productData.variants)) {
    productData.variants.forEach((v, idx) => {
      if (!v || v.expiryDate === undefined) return;
      v.expiryDate = parse(v.expiryDate, `Variant #${idx + 1} expiry date`);
    });
  }
}

// Links the product to an admin-managed Brand and copies its name into
// `brand`. `brandId` (from the product form) wins; a bare `brand` name (bulk
// import, older clients) is matched to an active brand by name and otherwise
// kept as free text. An inactive brand is only accepted if the product
// already uses it.
async function applyBrandFields(productData, existing = null) {
  const hasBrandId = Object.prototype.hasOwnProperty.call(productData, "brandId");
  const hasBrand = Object.prototype.hasOwnProperty.call(productData, "brand");
  if (!hasBrandId && !hasBrand) return;

  const rawId = hasBrandId ? String(productData.brandId ?? "").trim() : "";
  if (hasBrandId && rawId && rawId !== "null" && rawId !== "undefined") {
    if (!mongoose.Types.ObjectId.isValid(rawId)) {
      throw Object.assign(new Error("Invalid brand"), { statusCode: 400 });
    }
    const brand = await Brand.findById(rawId).select("name status").lean();
    const keepsCurrent = existing?.brandId && String(existing.brandId) === rawId;
    if (!brand || (brand.status !== "active" && !keepsCurrent)) {
      throw Object.assign(new Error("Please select a brand from the list"), { statusCode: 400 });
    }
    productData.brandId = brand._id;
    productData.brand = brand.name;
    return;
  }

  const name = hasBrand ? String(productData.brand ?? "").trim() : "";
  if (!name) {
    productData.brandId = null;
    productData.brand = "";
    return;
  }
  const match = await Brand.findOne({ nameKey: toBrandNameKey(name), status: "active" })
    .select("name")
    .lean();
  productData.brandId = match ? match._id : null;
  productData.brand = match ? match.name : name;
}

function applyMediaFields(productData) {
  const explicitMainImage = normalizeUrl(productData.mainImage || productData.mainImageUrl);
  const galleryImages = parseImageList(productData.galleryImages);
  const genericImages = parseImageList(productData.images);

  const mergedGallery = [...galleryImages, ...genericImages].filter(Boolean);
  if (explicitMainImage) {
    productData.mainImage = explicitMainImage;
  } else if (mergedGallery.length > 0) {
    productData.mainImage = mergedGallery[0];
    mergedGallery.shift();
  } else {
    delete productData.mainImage;
  }

  if (mergedGallery.length > 0) {
    productData.galleryImages = mergedGallery;
  } else if (!Array.isArray(productData.galleryImages)) {
    productData.galleryImages = [];
  }
}

const RESTRICTED_MODERATION_FIELDS = [
  "approvalStatus",
  "approvalRequestedAt",
  "approvalReviewedAt",
  "approvalReviewedBy",
  "approvalNote",
  "lastSubmittedByRole",
];

function stripRestrictedModerationFields(payload = {}) {
  for (const field of RESTRICTED_MODERATION_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      delete payload[field];
    }
  }
}

function normalizeProductDocumentModeration(product) {
  if (!product) return product;
  return normalizeProductModerationFields(product);
}

function normalizeProductListModeration(items = []) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => normalizeProductDocumentModeration(item));
}

function buildSellerPendingModerationUpdate() {
  return {
    approvalStatus: PRODUCT_APPROVAL_STATUS.PENDING,
    approvalRequestedAt: new Date(),
    approvalReviewedAt: null,
    approvalReviewedBy: null,
    approvalNote: "",
    lastSubmittedByRole: "seller",
  };
}

function buildSellerDraftModerationUpdate() {
  return {
    approvalStatus: PRODUCT_APPROVAL_STATUS.DRAFT,
    approvalRequestedAt: null,
    approvalReviewedAt: null,
    approvalReviewedBy: null,
    approvalNote: "Missing product image. Upload photo to submit for admin approval.",
    lastSubmittedByRole: "seller",
  };
}

function buildSellerApprovedModerationUpdate() {
  return {
    approvalStatus: PRODUCT_APPROVAL_STATUS.APPROVED,
    approvalRequestedAt: null,
    approvalReviewedAt: null,
    approvalReviewedBy: null,
    approvalNote: "",
    lastSubmittedByRole: "seller",
  };
}

function buildAdminApprovedModerationUpdate(adminId, note = "") {
  return {
    approvalStatus: PRODUCT_APPROVAL_STATUS.APPROVED,
    approvalRequestedAt: null,
    approvalReviewedAt: new Date(),
    approvalReviewedBy: adminId || null,
    approvalNote: sanitizeApprovalNote(note),
    lastSubmittedByRole: "admin",
  };
}

function buildAdminRejectedModerationUpdate(adminId, note = "") {
  return {
    approvalStatus: PRODUCT_APPROVAL_STATUS.REJECTED,
    approvalRequestedAt: null,
    approvalReviewedAt: new Date(),
    approvalReviewedBy: adminId || null,
    approvalNote: sanitizeApprovalNote(note),
    lastSubmittedByRole: "admin",
  };
}

/* ===============================
   GET ALL PRODUCTS (Public/Admin)
================================ */
export const getProducts = async (req, res) => {
  try {
    const {
      search,
      category,
      subcategory,
      header,
      status,
      approvalStatus,
      sellerId,
      featured,
      categoryId,
      subcategoryId,
      headerId,
      categoryIds,
      sellerIds,
      sort,
      lat,
      lng,
    } = req.query;
    const enforceRadius = isCustomerVisibilityRequest(req);

    const query = {};
    // Regex search term, applied once the other filters are known (see below)
    let searchTerm = "";
    if (search) {
      const term = String(search).trim();
      if (term) {
        if (isProductTextSearchEnabled() && term.length >= 3) {
          query.$text = { $search: term };
        } else {
          searchTerm = term;
        }
      }
    }

    // Support both field names for flexibility (backward compatibility)
    const finalHeaderId = header || headerId;
    const finalCategoryId = category || categoryId;
    const finalSubcategoryId = subcategory || subcategoryId;

    const badId = [finalHeaderId, finalCategoryId, finalSubcategoryId].find(
      (value) => value && value !== "all" && !isValidObjectId(value),
    );
    if (badId) {
      return handleResponse(res, 400, `Invalid category id: ${String(badId).slice(0, 64)}`);
    }

    if (finalHeaderId && finalHeaderId !== "all") query.headerId = finalHeaderId;
    if (finalCategoryId && finalCategoryId !== "all") query.categoryId = finalCategoryId;
    if (finalSubcategoryId && finalSubcategoryId !== "all") query.subcategoryId = finalSubcategoryId;

    const requestedSellerIds = parseSellerIdFilters({ sellerId, sellerIds });
    const coords = parseCustomerCoordinates({ lat, lng });
    const shouldApplyLocationFilter = enforceRadius || coords.valid;
    if (enforceRadius && !coords.valid) {
      return handleResponse(
        res,
        400,
        "lat and lng are required for customer product visibility",
      );
    }
    if (shouldApplyLocationFilter) {
      const nearbySellerIds = await getNearbySellerIdsForCustomer(
        coords.lat,
        coords.lng,
      );

      if (!nearbySellerIds.length) {
        return handleResponse(res, 200, "No sellers found in your area", {
          items: [],
          page: 1,
          limit: 24,
          total: 0,
          totalPages: 1,
        });
      }

      const nearbySet = new Set(nearbySellerIds.map(String));
      const finalSellerIds = requestedSellerIds.length
        ? requestedSellerIds.filter((id) => nearbySet.has(String(id)))
        : nearbySellerIds;

      if (!finalSellerIds.length) {
        return handleResponse(res, 200, "No products available in your area", {
          items: [],
          page: 1,
          limit: 24,
          total: 0,
          totalPages: 1,
        });
      }

      query.sellerId = { $in: finalSellerIds };
    }

    if (categoryIds && typeof categoryIds === "string") {
      const ids = categoryIds
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id && id !== "all");
      if (ids.length) query.categoryId = { $in: ids };
    }
    // Multiple sellers: sellerIds=id1,id2 (or single sellerId)
    if (!query.sellerId) {
      if (sellerIds && typeof sellerIds === "string") {
        const ids = sellerIds
          .split(",")
          .map((id) => id.trim())
          .filter((id) => id && id !== "all");
        if (ids.length) query.sellerId = { $in: ids };
      } else if (sellerId) {
        query.sellerId = sellerId;
      }
    }

    if (featured !== undefined) query.isFeatured = featured === "true";
    // Brand listing: exact (case-insensitive) match on the product's brand field.
    const brandFilter = String(req.query.brand || "").trim();
    if (brandFilter) {
      query.brand = { $regex: `^\\s*${escapeRegex(brandFilter)}\\s*$`, $options: "i" };
    }
    if (String(req.query.inStock || "").toLowerCase() === "true") {
      query.stock = { $gt: 0 };
    }
    if (req.query.isReturnable !== undefined) {
      query["returnPolicy.isReturnable"] = String(req.query.isReturnable) === "true";
    } else if (req.query.returnPolicy !== undefined) {
      if (req.query.returnPolicy === "returnable") {
        query["returnPolicy.isReturnable"] = true;
      } else if (req.query.returnPolicy === "non-returnable") {
        query["returnPolicy.isReturnable"] = false;
      }
    }

    const toFinalQuery = (searchFilter) => {
      let finalQuery = searchFilter ? { $and: [{ ...query }, searchFilter] } : { ...query };
      if (enforceRadius) {
        finalQuery.status = "active";
        finalQuery = { $and: [finalQuery, getCustomerVisibleFilter()] };
      } else {
        if (status && status !== "all") {
          finalQuery.status = status;
        }
        if (approvalStatus && String(approvalStatus).trim().toLowerCase() !== "all") {
          const moderationFilter = buildApprovalStatusFilter(approvalStatus);
          if (Object.keys(moderationFilter).length > 0) {
            finalQuery = { $and: [finalQuery, moderationFilter] };
          }
        }
      }
      return finalQuery;
    };

    // Every search word (regex-escaped) must appear in the name, brand or tags;
    // doubled letters are optional and Hindi grocery names find English ones
    // and back. Category names ("spices") are only matched when no product
    // matches by name, so "milk" isn't buried under the rest of its category.
    let finalQuery = toFinalQuery(searchTerm ? await buildProductSearchFilter(searchTerm) : null);
    if (searchTerm && !(await Product.exists(finalQuery))) {
      finalQuery = toFinalQuery(await buildProductSearchFilter(searchTerm, { matchCategories: true }));
    }

    const { page, limit, skip } = getPagination(req, {
      defaultLimit: 24,
      maxLimit: 100,
    });

    const sortMap = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      "name-asc": { name: 1, createdAt: -1 },
      "name-desc": { name: -1, createdAt: -1 },
      "price-asc": { price: 1, createdAt: -1 },
      "price-desc": { price: -1, createdAt: -1 },
      "stock-asc": { stock: 1, createdAt: -1 },
      "stock-desc": { stock: -1, createdAt: -1 },
    };
    const sortQuery = sortMap[String(sort || "newest").toLowerCase()] || sortMap.newest;

    // In-stock products always come first and out-of-stock ones last, whatever the
    // chosen sort: page through the in-stock slice, then continue into the rest.
    const inStockQuery = { $and: [finalQuery, { stock: { $gt: 0 } }] };
    const outOfStockQuery = { $and: [finalQuery, { $or: [{ stock: { $lte: 0 } }, { stock: null }] }] };
    const findPage = (q, pageSkip, pageLimit) =>
      Product.find(q)
        .select(
          "name slug description sku price salePrice stock brand brandId weight mainImage galleryImages headerId categoryId subcategoryId sellerId status approvalStatus approvalRequestedAt approvalReviewedAt approvalReviewedBy approvalNote lastSubmittedByRole isFeatured variants productDeliveryFee productDeliveryTimeMinutes ratingAverage ratingCount createdAt",
        )
        // No .populate() — names resolved via cache-backed entityNameCache
        .sort(sortQuery)
        .skip(pageSkip)
        .limit(pageLimit)
        .lean();
    const fetchStockOrderedPage = async () => {
      const inStockCount = await Product.countDocuments(inStockQuery);
      const inStockItems = skip < inStockCount ? await findPage(inStockQuery, skip, limit) : [];
      const remaining = limit - inStockItems.length;
      const outOfStockItems =
        remaining > 0 ? await findPage(outOfStockQuery, Math.max(0, skip - inStockCount), remaining) : [];
      return [...inStockItems, ...outOfStockItems];
    };

    const fetchFn = async () => {
      const [rawProducts, total] = await Promise.all([
        fetchStockOrderedPage(),
        Product.countDocuments(finalQuery),
      ]);

      // Names resolved via cache-backed entityNameCache (same shape as .populate())
      const products = await enrichCatalogProducts(rawProducts);

      return {
        items: normalizeProductListModeration(products),
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      };
    };

    const role = String(req.user?.role || "").toLowerCase();
    const shouldCache = !role || (role !== "admin" && role !== "seller");

    const cached = shouldCache
      ? await getOrSet(buildProductListKey(req.query), fetchFn, getTTL("productList"))
      : await fetchFn();
    // Final delivery fee/time are added after the cache so admin/seller changes show at once.
    const result = { ...cached, items: await decorateProductsWithDelivery(cached?.items || []) };

    return handleResponse(res, 200, "Products fetched successfully", result);
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

/* ===============================
   GET SELLER PRODUCTS
================================ */
// Low stock: in stock and at/below the product's own alert level (default 5).
const LOW_STOCK_EXPR = {
  $and: [
    {
      $gt: [
        {
          $convert: {
            input: "$stock",
            to: "double",
            onError: 0,
            onNull: 0,
          },
        },
        0,
      ],
    },
    {
      $lte: [
        {
          $convert: {
            input: "$stock",
            to: "double",
            onError: 0,
            onNull: 0,
          },
        },
        {
          $let: {
            vars: {
              rawThreshold: {
                $convert: {
                  input: "$lowStockAlert",
                  to: "double",
                  onError: 0,
                  onNull: 0,
                },
              },
            },
            in: {
              $cond: [{ $gt: ["$$rawThreshold", 0] }, "$$rawThreshold", 5],
            },
          },
        },
      ],
    },
  ],
};

export const getSellerProducts = async (req, res) => {
  try {
    const sellerId = req.user.id;
    const { stockStatus, sort, approvalStatus, imageStatus, status, categoryId } = req.query;
    const { page, limit, skip } = getPagination(req, {
      defaultLimit: 20,
      maxLimit: 100,
    });

    const baseSellerQuery = { sellerId };
    const query = { ...baseSellerQuery };
    // Filters run server-side so pagination/total match what the seller filtered on.
    const extraConditions = [];
    if (stockStatus === "in") {
      query.stock = { $gt: 0 };
    } else if (stockStatus === "out") {
      extraConditions.push({ $or: [{ stock: { $lte: 0 } }, { stock: null }] });
    } else if (stockStatus === "low") {
      // In stock but at/below the product's own alert level (default 5) — same rule as the summary count.
      extraConditions.push({ stock: { $gt: 0 } }, { $expr: LOW_STOCK_EXPR });
    }
    if (status && String(status).toLowerCase() !== "all") query.status = String(status).toLowerCase();
    if (categoryId && String(categoryId) !== "all" && mongoose.isValidObjectId(categoryId)) {
      extraConditions.push({ $or: [{ headerId: categoryId }, { categoryId }, { subcategoryId: categoryId }] });
    }

    if (imageStatus === "with_image") {
      query.mainImage = { $exists: true, $nin: [null, ""] };
    } else if (imageStatus === "without_image") {
      query.$or = [{ mainImage: { $exists: false } }, { mainImage: null }, { mainImage: "" }];
    }

    if (approvalStatus && String(approvalStatus).trim().toLowerCase() !== "all") {
      const approvalFilter = buildApprovalStatusFilter(approvalStatus);
      if (Object.keys(approvalFilter).length > 0) {
        Object.assign(query, approvalFilter);
      }
    }

    if (extraConditions.length) query.$and = [...(query.$and || []), ...extraConditions];

    const searchTerm = String(req.query.search || "").trim();
    if (searchTerm) {
      const safe = buildSearchRegex(searchTerm, { anchored: false });
      query.$and = [
        ...(query.$and || []),
        {
          $or: [
            { name: safe },
            { sku: safe },
            { slug: safe },
            { barcode: safe },
            { "variants.sku": safe },
            { "variants.barcode": safe },
          ],
        },
      ];
    }

    if (req.query.isReturnable !== undefined) {
      query["returnPolicy.isReturnable"] = String(req.query.isReturnable) === "true";
    } else if (req.query.returnPolicy !== undefined) {
      if (req.query.returnPolicy === "returnable") {
        query["returnPolicy.isReturnable"] = true;
      } else if (req.query.returnPolicy === "non-returnable") {
        query["returnPolicy.isReturnable"] = false;
      }
    }

    const sortMap = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      "name-asc": { name: 1, createdAt: -1 },
      "name-desc": { name: -1, createdAt: -1 },
      "price-asc": { price: 1, createdAt: -1 },
      "price-desc": { price: -1, createdAt: -1 },
      "stock-asc": { stock: 1, createdAt: -1 },
      "stock-desc": { stock: -1, createdAt: -1 },
    };
    const sortQuery = sortMap[String(sort || "newest").toLowerCase()] || sortMap.newest;

    // In-stock products always come first and out-of-stock ones last, whatever the
    // chosen sort: page through the in-stock slice, then continue into the rest.
    const inStockQuery = { $and: [query, { stock: { $gt: 0 } }] };
    const outOfStockQuery = { $and: [query, { $or: [{ stock: { $lte: 0 } }, { stock: null }] }] };
    const findPage = (q, pageSkip, pageLimit) =>
      Product.find(q)
        .select(
          "name slug description sku barcode price salePrice stock lowStockAlert brand brandId weight mainImage galleryImages headerId categoryId subcategoryId sellerId status approvalStatus approvalRequestedAt approvalReviewedAt approvalReviewedBy approvalNote lastSubmittedByRole isFeatured variants returnPolicy createdAt purchaseCost gstPercent purchaseGstType productDeliveryFee productDeliveryTimeMinutes expiryDate shelfLife countryOfOrigin fssaiLicense tags",
        )
        .populate("headerId", "name")
        .populate("categoryId", "name")
        .populate("subcategoryId", "name")
        .populate("sellerId", "shopName")
        .sort(sortQuery)
        .skip(pageSkip)
        .limit(pageLimit)
        .lean();
    const fetchStockOrderedPage = async () => {
      const inStockCount = await Product.countDocuments(inStockQuery);
      const inStockItems = skip < inStockCount ? await findPage(inStockQuery, skip, limit) : [];
      const remaining = limit - inStockItems.length;
      const outOfStockItems =
        remaining > 0 ? await findPage(outOfStockQuery, Math.max(0, skip - inStockCount), remaining) : [];
      return [...inStockItems, ...outOfStockItems];
    };

    const [
      products,
      total,
      totalAll,
      activeCount,
      lowStockCount,
      outOfStockCount,
      pendingCount,
      approvedCount,
      rejectedCount,
      withImageCount,
      missingImageCount,
    ] = await Promise.all([
      fetchStockOrderedPage(),
      Product.countDocuments(query),
      Product.countDocuments(baseSellerQuery),
      Product.countDocuments({ ...baseSellerQuery, status: "active" }),
      Product.countDocuments({
        ...baseSellerQuery,
        $expr: LOW_STOCK_EXPR,
      }),
      Product.countDocuments({ ...baseSellerQuery, stock: 0 }),
      Product.countDocuments({
        ...baseSellerQuery,
        approvalStatus: PRODUCT_APPROVAL_STATUS.PENDING,
      }),
      Product.countDocuments({
        ...baseSellerQuery,
        $and: [
          { ...baseSellerQuery },
          buildApprovalStatusFilter(PRODUCT_APPROVAL_STATUS.APPROVED),
        ],
      }),
      Product.countDocuments({
        ...baseSellerQuery,
        approvalStatus: PRODUCT_APPROVAL_STATUS.REJECTED,
      }),
      Product.countDocuments({
        ...baseSellerQuery,
        mainImage: { $exists: true, $nin: [null, ""] },
      }),
      Product.countDocuments({
        ...baseSellerQuery,
        $or: [{ mainImage: { $exists: false } }, { mainImage: null }, { mainImage: "" }],
      }),
    ]);

    return handleResponse(res, 200, "Seller products fetched", {
      items: normalizeProductListModeration(products),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
      summary: {
        total: totalAll,
        active: activeCount,
        lowStock: lowStockCount,
        outOfStock: outOfStockCount,
        pending: pendingCount,
        approved: approvedCount,
        rejected: rejectedCount,
        withImage: withImageCount,
        missingImage: missingImageCount,
      },
    });
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

/* ===============================
   CREATE PRODUCT
================================ */
export const createProduct = async (req, res) => {
  try {
    const role = String(req.user?.role || "").toLowerCase();
    const productData = { ...req.body };
    stripRestrictedModerationFields(productData);

    if (role === "admin") {
      if (!productData.sellerId) {
        return handleResponse(res, 400, "sellerId is required for admin-created products");
      }
    } else {
      productData.sellerId = req.user.id;
    }

    // Handle multipart files (mainImage and galleryImages)
    const files = req.files || [];
    if (files.length > 0) {
      const galleryUrls = [];
      for (const file of files) {
        try {
          if (file.fieldname === "mainImage") {
            const url = await uploadToCloudinary(file.buffer, "products", {
              mimeType: file.mimetype,
              resourceType: "image",
            });
            productData.mainImage = url;
          } else if (file.fieldname === "galleryImages") {
            const url = await uploadToCloudinary(file.buffer, "products", {
              mimeType: file.mimetype,
              resourceType: "image",
            });
            galleryUrls.push(url);
          }
        } catch (err) {
          logger.error("Cloudinary upload failed", {
            scope: "createProduct",
            error: err,
          });
        }
      }
      if (galleryUrls.length > 0) {
        productData.galleryImages = galleryUrls;
      }
    }

    // Parse JSON fields if they come as strings from FormData
    if (typeof productData.variants === "string") {
      try {
        productData.variants = JSON.parse(productData.variants);
      } catch (e) {
        logger.error("Failed to parse variants JSON", {
          scope: "createProduct",
          error: e,
        });
      }
    }
    if (typeof productData.tags === "string" && productData.tags.startsWith("[")) {
      try {
        productData.tags = JSON.parse(productData.tags);
      } catch (e) {
        // Not JSON, keep as is
      }
    }

    if (!productData.name) {
      return handleResponse(res, 400, "Product name is required");
    }
    
    // Auto-generate slug and make it unique
    const rawSlug = (!productData.slug || productData.slug.trim() === "")
      ? slugify(productData.name)
      : slugify(productData.slug);
    productData.slug = await ensureUniqueSlug(rawSlug);

    productData.description =
      typeof productData.description === "string"
        ? productData.description.trim()
        : productData.description || "";

    applyMediaFields(productData);

    // Handle tags if string
    if (typeof productData.tags === "string") {
      productData.tags = productData.tags.split(",").map((tag) => tag.trim());
    }

    // Handle variants if string (multipart/form-data sends as string)
    if (typeof productData.variants === "string") {
      try {
        productData.variants = JSON.parse(productData.variants);
      } catch (e) {
        productData.variants = [];
      }
    }

    if (Array.isArray(productData.variants) && productData.variants.length > 0) {
      productData.variants = fillBlankVariantSkus(
        productData.variants.map((variant) => ({ ...variant })),
        productData.name,
      );

      const rawSku = (!productData.sku || String(productData.sku).trim() === "")
        ? (productData.variants[0]?.sku || makeProductSku(productData.name))
        : String(productData.sku).trim().toUpperCase();
      productData.sku = await ensureUniqueSku(rawSku);

      // Master stock is always the sum of all variant stocks
      productData.stock = productData.variants.reduce(
        (sum, v) => sum + Math.max(0, Number(v.stock) || 0),
        0
      );

      // Backfill top-level attributes from first variant for backwards compatibility
      const firstVar = productData.variants[0];
      if (firstVar.size && !productData.size) productData.size = firstVar.size;
      if (firstVar.colour && !productData.colour) productData.colour = firstVar.colour;
      if (firstVar.barcode && !productData.barcode) productData.barcode = firstVar.barcode;
      if (firstVar.purchaseCost !== undefined && productData.purchaseCost === undefined) {
        productData.purchaseCost = firstVar.purchaseCost;
      }
    } else {
      const rawSku = (!productData.sku || String(productData.sku).trim() === "")
        ? makeProductSku(productData.name)
        : String(productData.sku).trim().toUpperCase();
      productData.sku = await ensureUniqueSku(rawSku);
    }

    const { value: parsedReturnPolicy, error: returnPolicyError } =
      parseAndValidateReturnPolicy(productData.returnPolicy);
    if (returnPolicyError) {
      return handleResponse(res, 400, returnPolicyError);
    }
    productData.returnPolicy = parsedReturnPolicy;

    const effectiveMainImage = String(productData.mainImage || "").trim();
    const effectiveGallery = Array.isArray(productData.galleryImages)
      ? productData.galleryImages.filter(Boolean)
      : [];
    const hasImage = Boolean(effectiveMainImage || effectiveGallery.length > 0);

    let moderationUpdate = {};
    let successMessage = "Product created successfully";

    let isPendingApproval = false;
    if (role === "admin") {
      moderationUpdate = buildAdminApprovedModerationUpdate(req.user?.id || null);
    } else if (!hasImage) {
      // Products without image do not go to admin for approval (kept as draft for POS counter)
      moderationUpdate = buildSellerDraftModerationUpdate();
      successMessage = "Product created for POS counter. Upload photo to submit for online approval.";
    } else {
      const approvalConfig = await getProductApprovalConfig();
      if (approvalConfig.sellerCreateRequiresApproval) {
        moderationUpdate = buildSellerPendingModerationUpdate();
        successMessage = "Product submitted for admin approval";
        isPendingApproval = true;
      } else {
        moderationUpdate = buildSellerApprovedModerationUpdate();
      }
    }
    Object.assign(productData, moderationUpdate);

    try {
      applyPurchaseGst(productData);
      applyDeliveryFields(productData);
      applyExpiryDates(productData);
      await applyBrandFields(productData);
      await assertItemMasterValid(productData, req.user.id);
    } catch (e) {
      return handleResponse(res, e.statusCode || 400, e.message);
    }
    const product = await Product.create(productData);
    
    if (isPendingApproval && product && product._id) {
      try {
        const adminIds = await getAdminIds();
        emitNotificationEvent(NOTIFICATION_EVENTS.PRODUCT_MODERATION_REQUEST, {
          productId: product._id,
          productName: product.name,
          sellerId: req.user.id,
          adminIds,
          action: 'create'
        });
        emitPendingReviewUpdateToAdmins({
          type: "product",
          productId: product._id,
          action: "created",
        });
      } catch (e) {
        logger.error("Notification emission failed", { error: e });
      }
    }
    
    if (product && product._id) {
      // Enqueue search indexing asynchronously
      await enqueueProductIndex(product._id.toString());
      await invalidate(`cache:catalog:product:${product._id.toString()}`);
    }

    try {
      await invalidate(buildKey("catalog", "productList", "*"));
      await invalidate("cache:offersections:public:*");
    } catch (cacheErr) {
      logger.error("Cache invalidation error", {
        scope: "createProduct",
        error: cacheErr,
      });
    }

    return handleResponse(
      res,
      201,
      successMessage,
      normalizeProductDocumentModeration(product?.toObject?.() || product),
    );
  } catch (error) {
    logger.error("Create Product Error", { scope: "createProduct", error });
    if (error.code === 11000) {
      return handleResponse(res, 400, "Slug or SKU already exists");
    }
    return handleResponse(res, 500, error.message);
  }
};

/* ===============================
   UPDATE PRODUCT
================================ */
/**
 * Seller product edits never change stock (Stock Management does). Copies the
 * saved stock of each variant (matched by _id or SKU) onto the edit; newly
 * added variants keep the opening stock the seller entered. Master stock is
 * the sum of variant stocks.
 */
function keepSavedStock(productData, saved) {
  if (!Array.isArray(productData.variants) || productData.variants.length === 0) {
    productData.stock = Number(saved.stock || 0);
    return;
  }
  const savedVariants = Array.isArray(saved.variants) && saved.variants.length > 0
    ? saved.variants
    : // Legacy single-variant product: its stock lives on the product itself
      [{ sku: saved.sku, stock: saved.stock }];
  const sameSku = (a, b) =>
    a && b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

  productData.variants = productData.variants.map((variant) => {
    const existingVariant = savedVariants.find(
      (ev) =>
        (variant._id && ev._id && String(ev._id) === String(variant._id)) ||
        sameSku(variant.sku, ev.sku)
    );
    return {
      ...variant,
      stock: existingVariant
        ? Number(existingVariant.stock || 0)
        : Math.max(0, Number(variant.stock) || 0),
    };
  });
  productData.stock = productData.variants.reduce(
    (sum, v) => sum + Math.max(0, Number(v.stock) || 0),
    0
  );
}

export const updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const sellerId = req.user.id;
    const role = String(req.user.role || "").toLowerCase();
    const productData = { ...req.body };
    stripRestrictedModerationFields(productData);
    if (Object.prototype.hasOwnProperty.call(productData, "sellerId")) {
      delete productData.sellerId;
    }

    // Handle multipart files (mainImage and galleryImages)
    const files = req.files || [];
    if (files.length > 0) {
      const galleryUrls = [];
      for (const file of files) {
        try {
          if (file.fieldname === "mainImage") {
            const url = await uploadToCloudinary(file.buffer, "products", {
              mimeType: file.mimetype,
              resourceType: "image",
            });
            productData.mainImage = url;
          } else if (file.fieldname === "galleryImages") {
            const url = await uploadToCloudinary(file.buffer, "products", {
              mimeType: file.mimetype,
              resourceType: "image",
            });
            galleryUrls.push(url);
          }
        } catch (err) {
          logger.error("Cloudinary upload failed during update", {
            scope: "updateProduct",
            error: err,
          });
        }
      }
      if (galleryUrls.length > 0) {
        productData.galleryImages = galleryUrls;
      }
    }

    // Parse JSON fields
    if (typeof productData.variants === "string") {
      try {
        productData.variants = JSON.parse(productData.variants);
      } catch (e) {
        logger.error("Failed to parse variants JSON during update", {
          scope: "updateProduct",
          error: e,
        });
      }
    }
    if (typeof productData.tags === "string" && productData.tags.startsWith("[")) {
      try {
        productData.tags = JSON.parse(productData.tags);
      } catch (e) {
        // Not JSON, keep as is
      }
    }

    // Admin bypasses sellerId check
    const query = role === "admin" ? { _id: id } : { _id: id, sellerId };
    const product = await Product.findOne(query);

    if (!product) {
      return handleResponse(res, 404, "Product not found or unauthorized");
    }

    if (productData.name) {
      const rawSlug = (!productData.slug || productData.slug.trim() === "")
        ? slugify(productData.name)
        : slugify(productData.slug);
      productData.slug = await ensureUniqueSlug(rawSlug, product._id);
    }

    if (productData.description !== undefined) {
      productData.description =
        typeof productData.description === "string"
          ? productData.description.trim()
          : productData.description || "";
    }

    const skuBaseName = productData.name || product.name;

    applyMediaFields(productData);

    if (typeof productData.tags === "string") {
      productData.tags = productData.tags.split(",").map((tag) => tag.trim());
    }

    if (typeof productData.variants === "string") {
      try {
        productData.variants = JSON.parse(productData.variants);
      } catch (e) {
        // keep existing if invalid?
      }
    }

    if (Array.isArray(productData.variants) && productData.variants.length > 0) {
      productData.variants = fillBlankVariantSkus(
        productData.variants.map((variant) => ({ ...variant })),
        skuBaseName,
      );

      const rawSku = (!productData.sku || String(productData.sku).trim() === "")
        ? (productData.variants[0]?.sku || product.sku || makeProductSku(skuBaseName))
        : String(productData.sku).trim().toUpperCase();
      productData.sku = await ensureUniqueSku(rawSku, product._id);

      // Sellers cannot change inventory stock via product edit; stock is managed via Stock Management
      // Newly added variants (no match by _id/SKU) take the opening stock the seller entered.
      if (role === "seller") {
        keepSavedStock(productData, product);
      } else {
        // Master stock is always the sum of all variant stocks
        productData.stock = productData.variants.reduce(
          (sum, v) => sum + Math.max(0, Number(v.stock) || 0),
          0
        );
      }

      // Backfill top-level attributes from first variant for backwards compatibility
      const firstVar = productData.variants[0];
      if (firstVar.size !== undefined) productData.size = firstVar.size;
      if (firstVar.colour !== undefined) productData.colour = firstVar.colour;
      if (firstVar.barcode !== undefined) productData.barcode = firstVar.barcode;
      if (firstVar.purchaseCost !== undefined) productData.purchaseCost = firstVar.purchaseCost;
    } else if (role === "seller") {
      keepSavedStock(productData, product);
    }

    if (productData.returnPolicy !== undefined) {
      const { value: parsedReturnPolicy, error: returnPolicyError } =
        parseAndValidateReturnPolicy(productData.returnPolicy);
      if (returnPolicyError) {
        return handleResponse(res, 400, returnPolicyError);
      }
      productData.returnPolicy = parsedReturnPolicy;
    }

    const effectiveMainImage = String(
      productData.mainImage !== undefined ? productData.mainImage : product.mainImage || ""
    ).trim();
    const effectiveGallery = Array.isArray(productData.galleryImages)
      ? productData.galleryImages.filter(Boolean)
      : (Array.isArray(product.galleryImages) ? product.galleryImages.filter(Boolean) : []);
    const hasImage = Boolean(effectiveMainImage || effectiveGallery.length > 0);

    let moderationUpdate = {};
    let successMessage = "Product updated successfully";

    let isPendingApproval = false;
    if (role === "admin") {
      moderationUpdate = buildAdminApprovedModerationUpdate(req.user?.id || null);
    } else if (!hasImage) {
      // Products without image do not go to admin for approval
      moderationUpdate = buildSellerDraftModerationUpdate();
      successMessage = "Product updated. Upload photo to submit for online approval.";
    } else {
      const approvalConfig = await getProductApprovalConfig();
      // "Edits don't need re-approval" only applies to products an admin has
      // already approved. Draft, pending and rejected products must (re)enter
      // the moderation queue — otherwise one seller edit published them.
      const wasApproved =
        resolveProductApprovalStatus(product) === PRODUCT_APPROVAL_STATUS.APPROVED;
      if (approvalConfig.sellerEditRequiresApproval || !wasApproved) {
        moderationUpdate = buildSellerPendingModerationUpdate();
        successMessage = "Product submitted for admin approval";
        isPendingApproval = true;
      } else {
        moderationUpdate = buildSellerApprovedModerationUpdate();
      }
    }
    Object.assign(productData, moderationUpdate);

    try {
      applyPurchaseGst(productData, product);
      applyDeliveryFields(productData);
      applyExpiryDates(productData);
      await applyBrandFields(productData, product);
      await assertItemMasterValid(
        {
          ...productData,
          price: productData.price ?? product.price,
          salePrice: productData.salePrice ?? product.salePrice,
          mrp: productData.mrp ?? product.mrp,
        },
        product.sellerId,
        id,
      );
    } catch (e) {
      return handleResponse(res, e.statusCode || 400, e.message);
    }
    // Sellers cannot change stock here, but the update writes the stock read at
    // the start of the request. Guard on updatedAt so a sale, cancellation or
    // stock adjustment that lands meanwhile is merged in instead of overwritten.
    let updatedProduct = null;
    let current = product;
    for (let attempt = 0; attempt < 3 && current; attempt++) {
      if (role === "seller" && attempt > 0) keepSavedStock(productData, current);
      updatedProduct = await Product.findOneAndUpdate(
        role === "seller" ? { _id: id, updatedAt: current.updatedAt ?? null } : { _id: id },
        { $set: productData },
        { new: true, runValidators: true },
      );
      if (updatedProduct || role !== "seller") break;
      current = await Product.findOne(query);
    }
    if (!updatedProduct) {
      return current
        ? handleResponse(res, 409, "Stock for this product changed while saving. Please try again.")
        : handleResponse(res, 404, "Product not found or unauthorized");
    }
    
    if (isPendingApproval && updatedProduct) {
      try {
        const adminIds = await getAdminIds();
        emitNotificationEvent(NOTIFICATION_EVENTS.PRODUCT_MODERATION_REQUEST, {
          productId: updatedProduct._id,
          productName: updatedProduct.name,
          sellerId: req.user.id,
          adminIds,
          action: 'update'
        });
      } catch (e) {
        logger.error("Notification emission failed", { error: e });
      }
    }

    // Enqueue search indexing asynchronously
    await enqueueProductIndex(id);
    await invalidate(`cache:catalog:product:${id}`);

    try {
      await invalidate(buildKey("catalog", "productList", "*"));
      await invalidate("cache:offersections:public:*");
    } catch (cacheErr) {
      logger.error("Cache invalidation error", {
        scope: "updateProduct",
        error: cacheErr,
      });
    }

    return handleResponse(
      res,
      200,
      successMessage,
      normalizeProductDocumentModeration(updatedProduct?.toObject?.() || updatedProduct),
    );
  } catch (error) {
    logger.error("Update Product Error", { scope: "updateProduct", error });
    if (error.name === "ValidationError") {
      return handleResponse(
        res,
        400,
        Object.values(error.errors)
          .map((e) => e.message)
          .join(", "),
      );
    }
    if (error.name === "CastError") {
      return handleResponse(res, 400, `Invalid ${error.path}: ${error.value}`);
    }
    if (error.code === 11000) {
      return handleResponse(res, 400, "Slug or SKU already exists");
    }
    return handleResponse(res, 500, error.message);
  }
};

/* ===============================
   DELETE PRODUCT
================================ */
export const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const sellerId = req.user.id;
    const role = req.user.role;

    const query = role === "admin" ? { _id: id } : { _id: id, sellerId };
    const product = await Product.findOneAndDelete(query);

    if (!product) {
      return handleResponse(res, 404, "Product not found or unauthorized");
    }
    
    // Enqueue search index removal asynchronously
    await enqueueProductRemoval(id);
    await invalidate(`cache:catalog:product:${id}`);

    try {
      await invalidate(buildKey("catalog", "productList", "*"));
      await invalidate("cache:offersections:public:*");
    } catch (cacheErr) {
      logger.error("Cache invalidation error", {
        scope: "deleteProduct",
        error: cacheErr,
      });
    }

    return handleResponse(res, 200, "Product deleted successfully");
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

/* ===============================
   GET SINGLE PRODUCT
================================ */
// Accepts a product ObjectId or slug; returns the id, or null when nothing matches.
async function resolveProductId(idOrSlug) {
  const value = String(idOrSlug || "").trim();
  if (!value) return null;
  if (isValidObjectId(value)) return value;
  if (value.length > 200) return null;
  const found = await Product.findOne({ slug: value.toLowerCase() }).select("_id").lean();
  return found ? String(found._id) : null;
}

export const getProductById = async (req, res) => {
  try {
    const id = await resolveProductId(req.params.id);
    if (!id) {
      return handleResponse(res, 404, "Product not found");
    }
    const enforceRadius = isCustomerVisibilityRequest(req);

    let nearbySellerSet = null;
    const coords = parseCustomerCoordinates(req.query || {});
    if (enforceRadius) {
      if (!coords.valid) {
        return handleResponse(
          res,
          400,
          "lat and lng are required for customer product visibility",
        );
      }
      const nearbySellerIds = await getNearbySellerIdsForCustomer(
        coords.lat,
        coords.lng,
      );
      nearbySellerSet = new Set(nearbySellerIds.map(String));
    }

    const cacheKey = buildKey("catalog", "product", id);
    const product = await getOrSet(
      cacheKey,
      async () =>
        Product.findById(id)
          .select(
            "name slug description sku price salePrice mrp stock lowStockAlert brand brandId weight size tags shelfLife countryOfOrigin fssaiLicense returnPolicy ratingAverage ratingCount mainImage galleryImages headerId categoryId subcategoryId sellerId status approvalStatus approvalRequestedAt approvalReviewedAt approvalReviewedBy approvalNote lastSubmittedByRole isFeatured variants productDeliveryFee productDeliveryTimeMinutes createdAt",
          )
          .populate("headerId", "name")
          .populate("categoryId", "name")
          .populate("subcategoryId", "name")
          .populate("sellerId", "shopName")
          .lean(),
      getTTL("product"),
    );

    if (!product) {
      return handleResponse(res, 404, "Product not found");
    }

    if (enforceRadius) {
      const approvalState = resolveProductApprovalStatus(product);
      if (product.status !== "active" || approvalState !== PRODUCT_APPROVAL_STATUS.APPROVED) {
        return handleResponse(res, 404, "Product not found");
      }
    }

    if (enforceRadius) {
      const sellerIdForProduct = String(product?.sellerId?._id || product?.sellerId);
      if (!nearbySellerSet || !nearbySellerSet.has(sellerIdForProduct)) {
        return handleResponse(res, 404, "Product not available in your area");
      }
    }

    const payload = await decorateProductsWithDelivery(normalizeProductDocumentModeration(product));
    
    if (req.user) {
        // Reviews on the product page are order-item ratings (the same ones the
        // page lists and the rating summary counts), one per delivered order.
        const reviewState = await getProductReviewState(req.user.id, product._id);
        payload.hasPurchased = reviewState.hasPurchased;
        payload.hasReviewed = reviewState.hasReviewed;
        payload.pendingRatingOrderItemId = reviewState.pendingOrderItemId;
    }

    return handleResponse(
      res,
      200,
      "Product details fetched",
      payload,
    );
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

/* ===============================
   PRODUCT RECOMMENDATIONS (Public)
   Similar products, top products in the category, brands in the category
   and "people also bought" — one call for the product detail page.
================================ */
export const getProductRecommendations = async (req, res) => {
  try {
    const id = await resolveProductId(req.params.id);
    if (!id) {
      return handleResponse(res, 404, "Product not found");
    }

    const enforceRadius = isCustomerVisibilityRequest(req);
    const coords = parseCustomerCoordinates(req.query || {});
    if (enforceRadius && !coords.valid) {
      return handleResponse(res, 400, "lat and lng are required for customer product visibility");
    }

    const product = await Product.findById(id)
      .select("name brand brandId weight tags headerId categoryId subcategoryId sellerId status approvalStatus mainImage")
      .lean();
    const approvalState = product ? resolveProductApprovalStatus(product) : null;
    if (!product || product.status !== "active" || approvalState !== PRODUCT_APPROVAL_STATUS.APPROVED) {
      return handleResponse(res, 404, "Product not found");
    }

    const empty = {
      productId: id,
      similar: { items: [] },
      topInCategory: { basis: "none", scope: null, items: [] },
      brandsInCategory: { scope: null, items: [] },
      alsoBought: { source: "none", items: [] },
      errors: [],
    };

    let sellerIds = null;
    if (enforceRadius || coords.valid) {
      sellerIds = await getNearbySellerIdsForCustomer(coords.lat, coords.lng);
      if (!sellerIds.length) {
        return handleResponse(res, 200, "No sellers found in your area", empty);
      }
    }

    // Lives under the productList namespace, so every product write that
    // already clears product lists also clears these.
    const locationKey = coords.valid
      ? `${coords.lat.toFixed(4)}:${coords.lng.toFixed(4)}`
      : "any";
    const cacheKey = buildKey("catalog", "productList", `reco:${id}:${locationKey}`);
    const compute = () => buildProductRecommendations(product, { sellerIds });
    const result = await getOrSet(cacheKey, compute, getTTL("productList"));

    // Delivery fee/time added after the cache, as in the product list.
    const [similarItems, topItems, alsoBoughtItems] = await Promise.all([
      decorateProductsWithDelivery(result.similar.items),
      decorateProductsWithDelivery(result.topInCategory.items),
      decorateProductsWithDelivery(result.alsoBought.items),
    ]);

    return handleResponse(res, 200, "Product recommendations fetched", {
      ...result,
      similar: { ...result.similar, items: similarItems },
      topInCategory: { ...result.topInCategory, items: topItems },
      alsoBought: { ...result.alsoBought, items: alsoBoughtItems },
    });
  } catch (error) {
    logger.error("Product recommendations failed", { scope: "getProductRecommendations", error });
    return handleResponse(res, 500, "Could not load recommendations");
  }
};

/* ===============================
   ADMIN MODERATION LIST
================================ */
export const getModerationProducts = async (req, res) => {
  try {
    const {
      approvalStatus = "all",
      status = "all",
      search = "",
      sellerId,
      category,
      categoryId,
      subcategory,
      subcategoryId,
      header,
      headerId,
      sort = "newest",
    } = req.query;
    const { page, limit, skip } = getPagination(req, {
      defaultLimit: 25,
      maxLimit: 100,
    });

    const baseQuery = {};
    if (status && status !== "all") {
      baseQuery.status = status;
    }
    if (sellerId && sellerId !== "all") {
      baseQuery.sellerId = sellerId;
    }

    const finalHeaderId = header || headerId;
    const finalCategoryId = category || categoryId;
    const finalSubcategoryId = subcategory || subcategoryId;
    if (finalHeaderId && finalHeaderId !== "all") {
      baseQuery.headerId = finalHeaderId;
    }
    if (finalCategoryId && finalCategoryId !== "all") {
      baseQuery.categoryId = finalCategoryId;
    }
    if (finalSubcategoryId && finalSubcategoryId !== "all") {
      baseQuery.subcategoryId = finalSubcategoryId;
    }

    if (search && String(search).trim()) {
      const term = String(search).trim();
      if (isProductTextSearchEnabled() && term.length >= 3) {
        baseQuery.$text = { $search: term };
      } else {
        // P3-5: same substring semantics, now safely escaped.
        const safe = buildSearchRegex(term, { anchored: false });
        baseQuery.$or = [
          { name: safe },
          { slug: safe },
          { sku: safe },
          { "variants.sku": safe },
        ];
      }
    }

    const effectiveStockExpr = {
      $cond: {
        if: { $gt: [{ $size: { $ifNull: ["$variants", []] } }, 0] },
        then: {
          $sum: {
            $map: {
              input: "$variants",
              as: "v",
              in: { $convert: { input: "$$v.stock", to: "double", onError: 0, onNull: 0 } }
            }
          }
        },
        else: { $convert: { input: "$stock", to: "double", onError: 0, onNull: 0 } }
      }
    };

    const thresholdExpr = {
      $let: {
        vars: {
          rawThreshold: { $convert: { input: "$lowStockAlert", to: "double", onError: 0, onNull: 0 } }
        },
        in: { $cond: [{ $gt: ["$$rawThreshold", 0] }, "$$rawThreshold", 10] }
      }
    };

    const { stockStatus = "all" } = req.query;
    if (stockStatus !== "all") {
      if (stockStatus === "out") {
        baseQuery.$expr = { $eq: [effectiveStockExpr, 0] };
      } else if (stockStatus === "low") {
        baseQuery.$expr = {
          $and: [
            { $gt: [effectiveStockExpr, 0] },
            { $lte: [effectiveStockExpr, thresholdExpr] }
          ]
        };
      }
    }

    let moderatedQuery = { ...baseQuery };
    const approvalFilter = buildApprovalStatusFilter(approvalStatus);
    if (Object.keys(approvalFilter).length > 0) {
      moderatedQuery = { $and: [moderatedQuery, approvalFilter] };
    } else {
      moderatedQuery = { $and: [moderatedQuery, { approvalStatus: { $ne: PRODUCT_APPROVAL_STATUS.DRAFT } }] };
    }

    const sortMap = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      "name-asc": { name: 1, createdAt: -1 },
      "name-desc": { name: -1, createdAt: -1 },
      "price-asc": { price: 1, createdAt: -1 },
      "price-desc": { price: -1, createdAt: -1 },
    };
    const sortQuery = sortMap[String(sort || "newest").toLowerCase()] || sortMap.newest;

    // Compute base counts for stats cards, ignoring status/stock filters
    const baseStatsQuery = { ...baseQuery, approvalStatus: { $ne: PRODUCT_APPROVAL_STATUS.DRAFT } };
    delete baseStatsQuery.status;
    delete baseStatsQuery.$expr;

    const [items, total, allCount, pendingCount, approvedCount, rejectedCount, activeCount, lowStockCount, outOfStockCount] =
      await Promise.all([
        Product.find(moderatedQuery)
          .select(
            "name slug description sku price salePrice stock lowStockAlert brand brandId weight mainImage galleryImages headerId categoryId subcategoryId sellerId status approvalStatus approvalRequestedAt approvalReviewedAt approvalReviewedBy approvalNote lastSubmittedByRole isFeatured variants productDeliveryFee productDeliveryTimeMinutes createdAt",
          )
          .populate("headerId", "name")
          .populate("categoryId", "name")
          .populate("subcategoryId", "name")
          .populate("sellerId", "shopName name")
          .populate("approvalReviewedBy", "name email")
          .sort(sortQuery)
          .skip(skip)
          .limit(limit)
          .lean(),
        Product.countDocuments(moderatedQuery),
        Product.countDocuments(baseStatsQuery),
        Product.countDocuments({
          ...baseStatsQuery,
          approvalStatus: PRODUCT_APPROVAL_STATUS.PENDING,
        }),
        Product.countDocuments({
          $and: [
            { ...baseStatsQuery },
            buildApprovalStatusFilter(PRODUCT_APPROVAL_STATUS.APPROVED),
          ],
        }),
        Product.countDocuments({
          ...baseStatsQuery,
          approvalStatus: PRODUCT_APPROVAL_STATUS.REJECTED,
        }),
        Product.countDocuments({ ...baseStatsQuery, status: "active" }),
        Product.countDocuments({
          ...baseStatsQuery,
          $expr: {
            $and: [
              { $gt: [effectiveStockExpr, 0] },
              { $lte: [effectiveStockExpr, thresholdExpr] }
            ]
          }
        }),
        Product.countDocuments({ ...baseStatsQuery, $expr: { $eq: [effectiveStockExpr, 0] } }),
      ]);

    return handleResponse(res, 200, "Moderation products fetched", {
      items: normalizeProductListModeration(items),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
      counts: {
        all: allCount,
        pending: pendingCount,
        approved: approvedCount,
        rejected: rejectedCount,
        active: activeCount,
        lowStock: lowStockCount,
        outOfStock: outOfStockCount,
      },
    });
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

/* ===============================
   ADMIN MODERATION ACTIONS
================================ */
export const approveProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const note = req.body?.approvalNote ?? req.body?.note ?? "";
    const moderationUpdate = buildAdminApprovedModerationUpdate(
      req.user?.id || null,
      note,
    );

    const updated = await Product.findByIdAndUpdate(
      id,
      { $set: moderationUpdate },
      { new: true, runValidators: true },
    )
      .populate("headerId", "name")
      .populate("categoryId", "name")
      .populate("subcategoryId", "name")
      .populate("sellerId", "shopName name")
      .populate("approvalReviewedBy", "name email");

    if (!updated) {
      return handleResponse(res, 404, "Product not found");
    }

    await enqueueProductIndex(id);
    await invalidate(`cache:catalog:product:${id}`);
    await invalidate(buildKey("catalog", "productList", "*"));
    await invalidate("cache:offersections:public:*");

    emitPendingReviewUpdateToAdmins({
      type: "product",
      productId: id,
      action: "approved",
    });

    return handleResponse(
      res,
      200,
      "Product approved successfully",
      normalizeProductDocumentModeration(updated?.toObject?.() || updated),
    );
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

export const rejectProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const note = req.body?.approvalNote ?? req.body?.note ?? "";
    const moderationUpdate = buildAdminRejectedModerationUpdate(
      req.user?.id || null,
      note,
    );

    const updated = await Product.findByIdAndUpdate(
      id,
      { $set: moderationUpdate },
      { new: true, runValidators: true },
    )
      .populate("headerId", "name")
      .populate("categoryId", "name")
      .populate("subcategoryId", "name")
      .populate("sellerId", "shopName name")
      .populate("approvalReviewedBy", "name email");

    if (!updated) {
      return handleResponse(res, 404, "Product not found");
    }

    await enqueueProductIndex(id);
    await invalidate(`cache:catalog:product:${id}`);
    await invalidate(buildKey("catalog", "productList", "*"));
    await invalidate("cache:offersections:public:*");

    emitPendingReviewUpdateToAdmins({
      type: "product",
      productId: id,
      action: "rejected",
    });

    return handleResponse(
      res,
      200,
      "Product rejected successfully",
      normalizeProductDocumentModeration(updated?.toObject?.() || updated),
    );
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

/* ===============================
   CART DELIVERY QUOTE (public)
   Final delivery fee/time for a set of products before checkout.
================================ */
export const getDeliveryQuote = async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.productIds) ? req.body.productIds : [];
    const validIds = [...new Set(ids.map(String))]
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .slice(0, 200);
    const products = validIds.length
      ? await Product.find({ _id: { $in: validIds } })
          .select("_id sellerId productDeliveryFee productDeliveryTimeMinutes")
          .lean()
      : [];
    const settings = await getOrCreateFinanceSettings();
    return handleResponse(res, 200, "Delivery quote", quoteCartDelivery(products, settings));
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};
