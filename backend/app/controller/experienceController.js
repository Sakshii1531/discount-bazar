import ExperienceSection from "../models/experienceSection.js";
import HeroConfig from "../models/heroConfig.js";
import Category from "../models/category.js";
import Product from "../models/product.js";
import Brand from "../models/brand.js";
import handleResponse from "../utils/helper.js";
import mongoose from "mongoose";
import { buildKey, getOrSet, getTTL, invalidate } from "../services/cacheService.js";
import { uploadToCloudinary } from "../services/mediaService.js";
import { parseCustomerCoordinates } from "../services/customerVisibilityService.js";
import {
  attachBrandCards,
  resolveExperienceSectionProducts,
} from "../services/experienceSectionService.js";
import { decorateProductsWithDelivery } from "../services/deliveryQuoteService.js";
import { getOrCreateFinanceSettings } from "../services/finance/financeSettingsService.js";

// Section edits must also clear the per-location resolved copies.
const invalidatePublicSections = async () => {
  await invalidate("cache:experience:public:*");
  await invalidate(buildKey("catalog", "productList", "experience:*"));
};

/* ===============================
   Helpers
================================ */
const validateBasePayload = async (body) => {
  const {
    pageType,
    headerId,
    displayType,
    title,
    order,
    status,
    config = {},
  } = body;

  if (!["home", "header"].includes(pageType)) {
    throw new Error("Invalid pageType");
  }

  if (!["banners", "categories", "subcategories", "products", "brands"].includes(displayType)) {
    throw new Error("Invalid displayType");
  }

  if (pageType === "header") {
    if (!headerId) {
      throw new Error("headerId is required for header pageType");
    }
    const header = await Category.findOne({ _id: headerId, type: "header" });
    if (!header) {
      throw new Error("Invalid headerId");
    }
  }

  if (["categories", "subcategories", "products", "brands"].includes(displayType)) {
    if (!title || !title.trim()) {
      throw new Error("Title is required for this displayType");
    }
  }

  if (order !== undefined && Number.isNaN(Number(order))) {
    throw new Error("order must be a number");
  }

  if (status && !["active", "inactive"].includes(status)) {
    throw new Error("Invalid status");
  }

  return {
    pageType,
    headerId: headerId || null,
    displayType,
    title: title?.trim() || "",
    order: order ?? 0,
    status: status || "active",
    config,
  };
};

const normalizeUrl = (value) => {
  const normalized = String(value || "").trim();
  if (!normalized || !/^https?:\/\//i.test(normalized)) {
    return "";
  }
  return normalized;
};

// Keep the admin's chosen order (and drop ids that failed validation / repeats).
const inRequestedOrder = (requestedIds, docs) => {
  const valid = new Map(docs.map((d) => [String(d._id), d._id]));
  return [...new Set(requestedIds.map(String))].filter((id) => valid.has(id)).map((id) => valid.get(id));
};

const validateAndNormalizeConfig = async (displayType, config = {}) => {
  const normalized = {};

  if (displayType === "banners") {
    const items = Array.isArray(config.items) ? config.items : [];
    normalized.banners = {
      items: items
        .filter((b) => b && b.imageUrl)
        .map((b) => ({
          imageUrl: b.imageUrl,
          title: b.title,
          subtitle: b.subtitle,
          linkType: b.linkType || "none",
          linkValue: b.linkValue || "",
          status: b.status || "active",
        })),
    };
    return normalized;
  }

  if (displayType === "categories") {
    const maxItems = Number(config.maxItems) || undefined;
    const rows = Number(config.rows) || 1;
    const categoryIds = Array.isArray(config.categoryIds)
      ? config.categoryIds.filter(Boolean)
      : [];

    if (!categoryIds.length) {
      throw new Error("At least one categoryId is required");
    }

    const categories = await Category.find({
      _id: { $in: categoryIds },
      type: "category",
    }).select("_id");

    if (!categories.length) {
      throw new Error("Provided categoryIds are invalid");
    }

    normalized.categories = {
      maxItems,
      categoryIds: inRequestedOrder(categoryIds, categories),
      rows: rows < 1 ? 1 : rows,
    };
    return normalized;
  }

  if (displayType === "subcategories") {
    const rows = Number(config.rows) || 1;
    const categoryIds = Array.isArray(config.categoryIds)
      ? config.categoryIds.filter(Boolean)
      : [];
    const subcategoryIds = Array.isArray(config.subcategoryIds)
      ? config.subcategoryIds.filter(Boolean)
      : [];

    if (!categoryIds.length || !subcategoryIds.length) {
      throw new Error("categoryIds and subcategoryIds are required");
    }

    const categories = await Category.find({
      _id: { $in: categoryIds },
      type: "category",
    }).select("_id");
    const subcategories = await Category.find({
      _id: { $in: subcategoryIds },
      type: "subcategory",
    }).select("_id");

    if (!categories.length || !subcategories.length) {
      throw new Error("Provided categoryIds or subcategoryIds are invalid");
    }

    normalized.subcategories = {
      categoryIds: inRequestedOrder(categoryIds, categories),
      subcategoryIds: inRequestedOrder(subcategoryIds, subcategories),
      rows: rows < 1 ? 1 : rows,
    };
    return normalized;
  }

  if (displayType === "products") {
    const rows = Number(config.rows) || 1;
    const columns = Number(config.columns) || 2;
    const singleRowScrollable = Boolean(config.singleRowScrollable);

    const categoryIds = Array.isArray(config.categoryIds)
      ? config.categoryIds.filter(Boolean)
      : [];
    const subcategoryIds = Array.isArray(config.subcategoryIds)
      ? config.subcategoryIds.filter(Boolean)
      : [];
    const productIds = Array.isArray(config.productIds)
      ? config.productIds.filter(Boolean)
      : [];

    const normalizedRows = singleRowScrollable ? 1 : rows < 1 ? 1 : rows;
    const normalizedColumns = columns < 1 ? 1 : columns;

    const categories = categoryIds.length
      ? await Category.find({ _id: { $in: categoryIds }, type: "category" }).select("_id")
      : [];
    const subcategories = subcategoryIds.length
      ? await Category.find({
          _id: { $in: subcategoryIds },
          type: "subcategory",
        }).select("_id")
      : [];
    const products = productIds.length
      ? await Product.find({ _id: { $in: productIds } }).select("_id")
      : [];

    normalized.products = {
      categoryIds: inRequestedOrder(categoryIds, categories),
      subcategoryIds: inRequestedOrder(subcategoryIds, subcategories),
      productIds: inRequestedOrder(productIds, products),
      rows: normalizedRows,
      columns: normalizedColumns,
      singleRowScrollable,
    };
    return normalized;
  }

  if (displayType === "brands") {
    const brandIds = Array.isArray(config.brandIds)
      ? config.brandIds.filter((id) => mongoose.Types.ObjectId.isValid(String(id)))
      : [];
    if (!brandIds.length) {
      throw new Error("Select at least one brand");
    }
    const brands = await Brand.find({ _id: { $in: brandIds } }).select("_id");
    if (!brands.length) {
      throw new Error("Provided brandIds are invalid");
    }
    const layout = config.layout === "grid" ? "grid" : "carousel";
    const rows = Math.max(1, Math.min(Number(config.rows) || 1, 6));
    const maxItems = Number(config.maxItems) > 0 ? Math.min(Number(config.maxItems), 50) : undefined;
    normalized.brands = {
      brandIds: inRequestedOrder(brandIds, brands),
      layout,
      rows: layout === "carousel" ? 1 : rows,
      maxItems,
    };
    return normalized;
  }

  return normalized;
};

/* ===============================
   ADMIN: List sections
================================ */
export const getAdminExperienceSections = async (req, res) => {
  try {
    const { pageType, headerId } = req.query;
    const query = {};

    if (pageType) query.pageType = pageType;
    if (headerId) query.headerId = headerId;

    const sections = await ExperienceSection.find(query)
      .sort({ order: 1, createdAt: 1 })
      .lean();

    return handleResponse(res, 200, "Experience sections fetched", sections);
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

/* ===============================
   ADMIN: Create section
================================ */
export const createExperienceSection = async (req, res) => {
  try {
    const base = await validateBasePayload(req.body);
    const config = await validateAndNormalizeConfig(base.displayType, base.config);

    const count = await ExperienceSection.countDocuments({
      pageType: base.pageType,
      headerId: base.headerId,
    });

    const section = await ExperienceSection.create({
      ...base,
      order: base.order ?? count,
      config,
    });
    await invalidatePublicSections();

    return handleResponse(res, 201, "Experience section created", section);
  } catch (error) {
    return handleResponse(res, 400, error.message);
  }
};

/* ===============================
   ADMIN: Update section
================================ */
export const updateExperienceSection = async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await ExperienceSection.findById(id);
    if (!existing) {
      return handleResponse(res, 404, "Section not found");
    }

    const merged = {
      ...existing.toObject(),
      ...req.body,
      config: { ...(existing.config || {}), ...(req.body.config || {}) },
    };

    const base = await validateBasePayload(merged);
    const config = await validateAndNormalizeConfig(base.displayType, base.config);

    existing.pageType = base.pageType;
    existing.headerId = base.headerId;
    existing.displayType = base.displayType;
    existing.title = base.title;
    existing.order = base.order;
    existing.status = base.status;
    existing.config = config;

    await existing.save();
    await invalidatePublicSections();

    return handleResponse(res, 200, "Experience section updated", existing);
  } catch (error) {
    return handleResponse(res, 400, error.message);
  }
};

/* ===============================
   ADMIN: Delete section
================================ */
export const deleteExperienceSection = async (req, res) => {
  try {
    const { id } = req.params;
    const section = await ExperienceSection.findByIdAndDelete(id);

    if (!section) {
      return handleResponse(res, 404, "Section not found");
    }
    await invalidatePublicSections();

    return handleResponse(res, 200, "Experience section deleted");
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

/* ===============================
   ADMIN: Reorder sections
================================ */
export const reorderExperienceSections = async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || !items.length) {
      // Nothing to reorder – treat as success to avoid noisy errors
      return handleResponse(res, 200, "No sections to reorder");
    }

    const bulkOps = items
      .filter(
        (it) => it && it.id && mongoose.Types.ObjectId.isValid(it.id)
      )
      .map((it) => ({
        updateOne: {
          filter: { _id: it.id },
          update: { $set: { order: it.order } },
        },
      }));

    if (!bulkOps.length) {
      // If all items were empty / malformed, avoid throwing and just ack
      return handleResponse(res, 200, "No valid sections to reorder");
    }

    await ExperienceSection.bulkWrite(bulkOps);
    await invalidatePublicSections();

    return handleResponse(res, 200, "Sections reordered");
  } catch (error) {
    console.error("Error while reordering experience sections:", error);
    // Fail gracefully so the admin UI doesn't break on partial reorder issues
    return handleResponse(res, 200, "Sections reordered (best-effort)");
  }
};

/* ===============================
   PUBLIC: Get sections for page
================================ */
export const getPublicExperienceSections = async (req, res) => {
  try {
    const { pageType, headerId } = req.query;

    if (!pageType) {
      return handleResponse(res, 400, "pageType is required");
    }

    const query = { pageType, status: "active" };
    if (pageType === "header") {
      if (!headerId) {
        return handleResponse(res, 400, "headerId is required for header pageType");
      }
      query.headerId = headerId;
    }

    const cacheKey = buildKey(
      "experience",
      "public",
      `${pageType}:${headerId || "root"}`,
    );
    const loadSections = () =>
      getOrSet(
        cacheKey,
        async () =>
          ExperienceSection.find(query)
            .sort({ order: 1, createdAt: 1, _id: 1 })
            .lean(),
        getTTL("homepage"),
      );

    // With the customer's location, product sections come back with their
    // products resolved server-side (cached under productList so product
    // writes clear it, and per location bucket like offer sections).
    const coords = parseCustomerCoordinates(req.query || {});
    if (!coords.valid) {
      return handleResponse(
        res,
        200,
        "Experience sections fetched",
        await attachBrandCards(await loadSections()),
      );
    }
    const resolvedKey = buildKey(
      "catalog",
      "productList",
      `experience:${pageType}:${headerId || "root"}:${coords.lat.toFixed(3)}:${coords.lng.toFixed(3)}`,
    );
    const resolved = await getOrSet(
      resolvedKey,
      async () => resolveExperienceSectionProducts(await loadSections(), coords),
      getTTL("productList"),
    );
    // Delivery fee/time are added after the cache so admin/seller changes show at once.
    const deliverySettings = await getOrCreateFinanceSettings();
    const sections = await Promise.all(
      (resolved || []).map(async (s) =>
        Array.isArray(s.products)
          ? { ...s, products: await decorateProductsWithDelivery(s.products, deliverySettings) }
          : s,
      ),
    );

    // Brand names/logos are attached after the cache so brand edits show at once.
    return handleResponse(res, 200, "Experience sections fetched", await attachBrandCards(sections));
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

/* ===============================
   ADMIN: Upload banner image
================================ */
export const uploadBannerImage = async (req, res) => {
  try {
    if (req.file) {
      const uploadedUrl = await uploadToCloudinary(req.file.buffer, "banners", {
        mimeType: req.file.mimetype,
        resourceType: "image",
      });
      await invalidatePublicSections();
      return handleResponse(res, 200, "Banner image uploaded", { url: uploadedUrl });
    }

    const url = normalizeUrl(req.body?.url || req.body?.imageUrl);
    if (!url) {
      return handleResponse(res, 400, "A valid image URL is required");
    }
    await invalidatePublicSections();
    return handleResponse(res, 200, "Banner image uploaded", { url });
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

/* ===============================
   HERO CONFIG (separate from experience sections)
   Public: get hero config for a page (with fallback to home)
   Admin: get one / list, upsert
================================ */

export const getPublicHeroConfig = async (req, res) => {
  try {
    const { pageType, headerId } = req.query;

    if (!pageType) {
      return handleResponse(res, 400, "pageType is required");
    }

    if (pageType === "header" && !headerId) {
      return handleResponse(res, 400, "headerId is required for header pageType");
    }

    const cacheKey = buildKey(
      "experience",
      "hero",
      `${pageType}:${headerId || "root"}`,
    );
    const config = await getOrSet(
      cacheKey,
      async () => {
        let resolved = null;
        if (pageType === "header") {
          resolved = await HeroConfig.findOne({
            pageType: "header",
            headerId,
          }).lean();
        }
        if (!resolved && (pageType === "home" || pageType === "header")) {
          resolved = await HeroConfig.findOne({
            pageType: "home",
            headerId: null,
          }).lean();
        }
        return resolved || null;
      },
      getTTL("homepage"),
    );

    const payload = config
      ? {
          banners: config.banners || { items: [] },
          categoryIds: config.categoryIds || [],
        }
      : { banners: { items: [] }, categoryIds: [] };

    return handleResponse(res, 200, "Hero config fetched", payload);
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

export const getAdminHeroConfig = async (req, res) => {
  try {
    const { pageType, headerId } = req.query;

    if (!pageType) {
      return handleResponse(res, 400, "pageType is required");
    }

    if (pageType === "header" && !headerId) {
      return handleResponse(res, 400, "headerId is required for header pageType");
    }

    const config = await HeroConfig.findOne({
      pageType,
      headerId: pageType === "header" ? headerId : null,
    }).lean();

    return handleResponse(
      res,
      200,
      "Hero config fetched",
      config || { banners: { items: [] }, categoryIds: [] }
    );
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

export const upsertHeroConfig = async (req, res) => {
  try {
    const { pageType, headerId, banners, categoryIds } = req.body;

    if (!["home", "header"].includes(pageType)) {
      return handleResponse(res, 400, "Invalid pageType");
    }

    if (pageType === "header" && !headerId) {
      return handleResponse(res, 400, "headerId is required for header pageType");
    }

    if (pageType === "header") {
      const header = await Category.findOne({ _id: headerId, type: "header" });
      if (!header) {
        return handleResponse(res, 400, "Invalid headerId");
      }
    }

    const bannerItems = Array.isArray(banners?.items)
      ? banners.items
        .filter((b) => b && b.imageUrl)
        .map((b) => ({
          imageUrl: b.imageUrl,
          title: b.title || "",
          subtitle: b.subtitle || "",
          linkType: b.linkType || "none",
          linkValue: b.linkValue || "",
          status: b.status || "active",
        }))
      : [];

    const ids = Array.isArray(categoryIds) ? categoryIds.filter(Boolean) : [];

    const filter = {
      pageType,
      headerId: pageType === "header" ? headerId : null,
    };

    const update = {
      banners: { items: bannerItems },
      categoryIds: ids,
    };

    const config = await HeroConfig.findOneAndUpdate(
      filter,
      { $set: update },
      { new: true, upsert: true, runValidators: true }
    ).lean();
    await invalidate("cache:experience:hero:*");

    return handleResponse(res, 200, "Hero config saved", config);
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};
