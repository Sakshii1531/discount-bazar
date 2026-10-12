import mongoose from "mongoose";
import Brand, { toBrandNameKey } from "../models/brand.js";
import Product from "../models/product.js";
import handleResponse from "../utils/helper.js";
import getPagination from "../utils/pagination.js";
import { slugify } from "../utils/slugify.js";
import { buildSearchRegex } from "../utils/regex.js";
import { buildKey, getOrSet, getTTL, invalidate } from "../services/cacheService.js";
import { uploadToCloudinary } from "../services/mediaService.js";
import logger from "../services/logger.js";

const ALLOWED_KEYS = ["name", "slug", "description", "status"];
const PUBLIC_FIELDS = "name slug logo";

function activeBrandsCacheKey() {
  return buildKey("catalog", "brands", "active");
}

async function invalidateBrandCaches({ productsChanged = false } = {}) {
  try {
    await invalidate(buildKey("catalog", "brands", "*"));
    if (productsChanged) {
      await invalidate(buildKey("catalog", "productList", "*"));
      await invalidate(buildKey("catalog", "product", "*"));
    }
  } catch (err) {
    logger.warn("[Brand] Cache invalidation failed", { error: err });
  }
}

function pickBrandFields(body = {}) {
  const data = {};
  for (const key of ALLOWED_KEYS) {
    if (Object.prototype.hasOwnProperty.call(body, key) && typeof body[key] === "string") {
      data[key] = body[key].trim();
    }
  }
  if (data.status && !["active", "inactive"].includes(data.status)) {
    delete data.status;
  }
  return data;
}

async function resolveLogo(req, data) {
  if (req.file) {
    data.logo = await uploadToCloudinary(req.file.buffer, "brands", {
      mimeType: req.file.mimetype,
      resourceType: "image",
    });
  } else if (typeof req.body.logo === "string") {
    const logo = req.body.logo.trim();
    if (logo === "" || /^https?:\/\//i.test(logo)) data.logo = logo;
  }
}

async function findDuplicate({ nameKey, slug, excludeId = null }) {
  const or = [];
  if (nameKey) or.push({ nameKey });
  if (slug) or.push({ slug });
  if (!or.length) return null;
  const query = { $or: or };
  if (excludeId) query._id = { $ne: excludeId };
  return Brand.findOne(query).select("name slug nameKey").lean();
}

function duplicateMessage(dup, nameKey) {
  return dup.nameKey === nameKey
    ? `A brand named "${dup.name}" already exists`
    : "The URL slug already exists; please use a unique name";
}

/* ===============================
   PUBLIC: ACTIVE BRANDS
   Used by the seller product form and the customer app.
================================ */
export const getActiveBrands = async (req, res) => {
  try {
    const brands = await getOrSet(
      activeBrandsCacheKey(),
      async () => Brand.find({ status: "active" }).select(PUBLIC_FIELDS).sort({ name: 1 }).lean(),
      getTTL("categories"),
    );
    return handleResponse(res, 200, "Brands fetched successfully", brands);
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

/* ===============================
   ADMIN: ALL BRANDS (paginated, with product counts)
================================ */
export const getAdminBrands = async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req, { defaultLimit: 25, maxLimit: 100 });
    const query = {};
    const search = String(req.query.search || "").trim();
    if (search) {
      const safe = buildSearchRegex(search, { anchored: false });
      query.$or = [{ name: safe }, { slug: safe }];
    }
    if (req.query.status === "active" || req.query.status === "inactive") {
      query.status = req.query.status;
    }

    const sortMap = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      "name-asc": { name: 1 },
      "name-desc": { name: -1 },
    };
    const sort = sortMap[req.query.sort] || sortMap["name-asc"];

    const [items, total] = await Promise.all([
      Brand.find(query).sort({ ...sort, _id: 1 }).skip(skip).limit(limit).lean(),
      Brand.countDocuments(query),
    ]);

    const counts = items.length
      ? await Product.aggregate([
          { $match: { brandId: { $in: items.map((b) => b._id) } } },
          { $group: { _id: "$brandId", count: { $sum: 1 } } },
        ])
      : [];
    const countById = new Map(counts.map((c) => [String(c._id), c.count]));

    return handleResponse(res, 200, "Brands fetched successfully", {
      items: items.map((b) => ({ ...b, productCount: countById.get(String(b._id)) || 0 })),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    });
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

/* ===============================
   CREATE BRAND
================================ */
export const createBrand = async (req, res) => {
  try {
    const data = pickBrandFields(req.body);
    if (!data.name) return handleResponse(res, 400, "Brand name is required");

    data.slug = slugify(data.slug || data.name);
    if (!data.slug) return handleResponse(res, 400, "Brand name must contain letters or numbers");

    const nameKey = toBrandNameKey(data.name);
    const dup = await findDuplicate({ nameKey, slug: data.slug });
    if (dup) return handleResponse(res, 400, duplicateMessage(dup, nameKey));

    try {
      await resolveLogo(req, data);
    } catch (err) {
      return handleResponse(res, 400, `Logo upload failed: ${err.message}`);
    }

    const brand = await Brand.create(data);
    await invalidateBrandCaches();
    return handleResponse(res, 201, "Brand created successfully", brand);
  } catch (error) {
    if (error.code === 11000) return handleResponse(res, 400, "A brand with this name or slug already exists");
    if (error?.name === "ValidationError") return handleResponse(res, 400, error.message);
    return handleResponse(res, 500, `Brand operation failed: ${error.message}`);
  }
};

/* ===============================
   UPDATE BRAND
   Renaming a brand rewrites the name copy on every linked product.
================================ */
export const updateBrand = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(String(id || ""))) {
      return handleResponse(res, 400, "Invalid brand ID");
    }

    const brand = await Brand.findById(id);
    if (!brand) return handleResponse(res, 404, "Brand not found");

    const data = pickBrandFields(req.body);
    if (Object.prototype.hasOwnProperty.call(data, "name") && !data.name) {
      return handleResponse(res, 400, "Brand name is required");
    }
    if (data.name || data.slug) {
      data.slug = slugify(data.slug || data.name || brand.slug);
    }

    const nameKey = data.name ? toBrandNameKey(data.name) : null;
    const dup = await findDuplicate({ nameKey, slug: data.slug, excludeId: brand._id });
    if (dup) return handleResponse(res, 400, duplicateMessage(dup, nameKey));

    try {
      await resolveLogo(req, data);
    } catch (err) {
      return handleResponse(res, 400, `Logo upload failed: ${err.message}`);
    }

    const previousName = brand.name;
    Object.assign(brand, data);
    await brand.save();

    const renamed = brand.name !== previousName;
    if (renamed) {
      await Product.updateMany({ brandId: brand._id }, { $set: { brand: brand.name } });
    }
    await invalidateBrandCaches({ productsChanged: renamed });

    return handleResponse(res, 200, "Brand updated successfully", brand);
  } catch (error) {
    if (error.code === 11000) return handleResponse(res, 400, "A brand with this name or slug already exists");
    if (error?.name === "ValidationError") return handleResponse(res, 400, error.message);
    return handleResponse(res, 500, `Brand operation failed: ${error.message}`);
  }
};

/* ===============================
   DELETE BRAND
   Blocked while products still use it; deactivate the brand instead.
================================ */
export const deleteBrand = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(String(id || ""))) {
      return handleResponse(res, 400, "Invalid brand ID");
    }

    const inUse = await Product.countDocuments({ brandId: id });
    if (inUse > 0) {
      return handleResponse(
        res,
        409,
        `This brand is used by ${inUse} product${inUse === 1 ? "" : "s"}. Mark it inactive instead of deleting it.`,
      );
    }

    const deleted = await Brand.findByIdAndDelete(id);
    if (!deleted) return handleResponse(res, 404, "Brand not found");

    await invalidateBrandCaches();
    return handleResponse(res, 200, "Brand deleted successfully");
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};
