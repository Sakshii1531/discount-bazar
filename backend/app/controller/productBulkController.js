/**
 * Seller bulk product import (rows parsed from a CSV/Excel sheet by the client).
 *
 * Each row goes through the normal createProduct / updateProduct handlers so the
 * same rules apply as in the product form (SKU, moderation, GST, delivery fee/time
 * validation, ...). A row whose SKU matches one of the seller's products updates
 * that product; otherwise a new product is created.
 *
 * Updates only change the columns that are filled in, and never price or stock
 * (stock changes go through stock adjustments / purchase bills).
 */
import mongoose from "mongoose";
import Product from "../models/product.js";
import Category from "../models/category.js";
import handleResponse from "../utils/helper.js";
import { createProduct, updateProduct } from "./productController.js";

export const BULK_MAX_ROWS = 500;

const str = (v) => (v === undefined || v === null ? "" : String(v).trim());

// Lower-case, strip spaces/underscores so "Product Delivery Fee" == "productdeliveryfee".
const normKey = (k) => String(k || "").toLowerCase().replace(/[^a-z0-9]/g, "");

const COLUMN_ALIASES = {
  name: ["name", "productname"],
  sku: ["sku"],
  description: ["description"],
  brand: ["brand"],
  weight: ["weight", "unit", "variant", "variantname"],
  price: ["price", "mrp"],
  salePrice: ["saleprice", "sellingprice"],
  stock: ["stock", "quantity", "qty"],
  barcode: ["barcode"],
  purchaseCost: ["purchasecost", "costprice"],
  gstPercent: ["gstpercent", "gst"],
  header: ["header", "headercategory"],
  category: ["category"],
  subcategory: ["subcategory"],
  imageUrl: ["imageurl", "image", "mainimage"],
  status: ["status"],
  productDeliveryFee: ["productdeliveryfee", "deliveryfee"],
  productDeliveryTimeMinutes: [
    "productdeliverytimeminutes",
    "productdeliverytime",
    "deliverytimeminutes",
    "deliverytime",
  ],
};

export function mapRowColumns(row = {}) {
  const byKey = new Map(Object.entries(row || {}).map(([k, v]) => [normKey(k), v]));
  const out = {};
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const hit = aliases.find((a) => byKey.has(a));
    if (hit !== undefined) out[field] = str(byKey.get(hit));
  }
  return out;
}

/** Resolve header/category/subcategory given as ids or names (case-insensitive). */
async function buildCategoryResolver() {
  const all = await Category.find({}).select("_id name type parentId").lean();
  const byId = new Map(all.map((c) => [String(c._id), c]));
  const find = (value, type, parentId = null) => {
    const v = str(value);
    if (!v) return null;
    if (mongoose.Types.ObjectId.isValid(v) && byId.get(v)?.type === type) return byId.get(v);
    const lower = v.toLowerCase();
    const matches = all.filter(
      (c) =>
        c.type === type &&
        String(c.name || "").trim().toLowerCase() === lower &&
        (!parentId || String(c.parentId) === String(parentId)),
    );
    return matches[0] || null;
  };
  return { byId, find };
}

function resolveCategories(cols, resolver) {
  const errors = [];
  let header = resolver.find(cols.header, "header");
  let category = resolver.find(cols.category, "category", header?._id);
  if (cols.category && !category) errors.push(`Category "${cols.category}" not found`);
  if (cols.header && !header) errors.push(`Header "${cols.header}" not found`);
  if (category && !header && category.parentId) header = resolver.byId.get(String(category.parentId)) || null;
  let subcategory = null;
  if (cols.subcategory) {
    subcategory = resolver.find(cols.subcategory, "subcategory", category?._id);
    if (!subcategory) errors.push(`Subcategory "${cols.subcategory}" not found`);
    else if (!category && subcategory.parentId) {
      category = resolver.byId.get(String(subcategory.parentId)) || null;
      if (category && !header && category.parentId) header = resolver.byId.get(String(category.parentId)) || null;
    }
  }
  return { header, category, subcategory, errors };
}

/** Calls an Express handler in-process and returns { status, body }. */
function runHandler(handler, req) {
  return new Promise((resolve) => {
    let status = 200;
    const res = {
      status(code) {
        status = code;
        return res;
      },
      json(body) {
        resolve({ status, body });
        return res;
      },
      send(body) {
        resolve({ status, body });
        return res;
      },
    };
    Promise.resolve(handler(req, res)).catch((error) =>
      resolve({ status: 500, body: { message: error.message } }),
    );
  });
}

const nonNegative = (value, label, errors, { integer = false } = {}) => {
  if (value === "" || value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    errors.push(`${label} must be a number of 0 or more`);
    return undefined;
  }
  if (integer && !Number.isInteger(n)) {
    errors.push(`${label} must be whole minutes`);
    return undefined;
  }
  return n;
};

export const bulkUploadProducts = async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
    if (!rows || rows.length === 0) {
      return handleResponse(res, 400, "No rows to import");
    }
    if (rows.length > BULK_MAX_ROWS) {
      return handleResponse(res, 400, `You can import up to ${BULK_MAX_ROWS} rows at a time`);
    }

    const sellerId = req.user.id;
    const resolver = await buildCategoryResolver();
    const results = [];

    for (let i = 0; i < rows.length; i += 1) {
      const rowNumber = i + 2; // row 1 is the header line in the sheet
      const cols = mapRowColumns(rows[i]);
      const errors = [];

      const fee = nonNegative(cols.productDeliveryFee, "Product delivery fee", errors);
      const minutes = nonNegative(cols.productDeliveryTimeMinutes, "Product delivery time", errors, { integer: true });
      const price = nonNegative(cols.price, "Price", errors);
      const salePrice = nonNegative(cols.salePrice, "Sale price", errors);
      const stock = nonNegative(cols.stock, "Stock", errors, { integer: true });
      const purchaseCost = nonNegative(cols.purchaseCost, "Purchase cost", errors);
      const gstPercent = nonNegative(cols.gstPercent, "GST %", errors);
      if (cols.status && !["active", "inactive"].includes(cols.status.toLowerCase())) {
        errors.push('Status must be "active" or "inactive"');
      }

      const existing = cols.sku
        ? await Product.findOne({ sellerId, sku: cols.sku.toUpperCase() }).select("_id").lean()
        : null;

      const cats = resolveCategories(cols, resolver);
      errors.push(...cats.errors);

      if (!existing) {
        if (!cols.name) errors.push("Name is required");
        if (price === undefined || price <= 0) errors.push("Price is required");
        if (!cats.category) errors.push("Category is required");
        if (!cats.subcategory && !cols.subcategory) errors.push("Subcategory is required");
      }

      if (errors.length) {
        results.push({ row: rowNumber, sku: cols.sku || "", name: cols.name || "", status: "error", errors });
        continue;
      }

      const body = {};
      if (cols.name) body.name = cols.name;
      if (cols.description) body.description = cols.description;
      if (cols.brand) body.brand = cols.brand;
      if (cols.weight) body.weight = cols.weight;
      if (cols.status) body.status = cols.status.toLowerCase();
      if (gstPercent !== undefined) body.gstPercent = gstPercent;
      if (fee !== undefined) body.productDeliveryFee = fee;
      if (minutes !== undefined) body.productDeliveryTimeMinutes = minutes;
      if (cols.imageUrl) body.mainImage = cols.imageUrl;
      if (cats.header) body.headerId = String(cats.header._id);
      if (cats.category) body.categoryId = String(cats.category._id);
      if (cats.subcategory) body.subcategoryId = String(cats.subcategory._id);

      let outcome;
      if (existing) {
        outcome = await runHandler(updateProduct, {
          params: { id: String(existing._id) },
          body,
          files: [],
          user: req.user,
          query: {},
        });
      } else {
        const sale = salePrice && salePrice < price ? salePrice : 0;
        Object.assign(body, {
          price,
          salePrice: sale,
          stock: stock ?? 0,
          status: body.status || "active",
          variants: [
            {
              name: cols.weight || "Standard",
              price,
              salePrice: sale || price,
              stock: stock ?? 0,
              ...(cols.sku ? { sku: cols.sku } : {}),
              ...(cols.barcode ? { barcode: cols.barcode } : {}),
              ...(purchaseCost !== undefined ? { purchaseCost } : {}),
            },
          ],
        });
        if (cols.sku) body.sku = cols.sku;
        if (cols.barcode) body.barcode = cols.barcode;
        if (purchaseCost !== undefined) body.purchaseCost = purchaseCost;
        outcome = await runHandler(createProduct, { body, files: [], user: req.user, query: {} });
      }

      const ok = outcome.status >= 200 && outcome.status < 300;
      const saved = outcome.body?.result || outcome.body?.data || {};
      results.push({
        row: rowNumber,
        sku: saved.sku || cols.sku || "",
        name: saved.name || cols.name || "",
        status: ok ? (existing ? "updated" : "created") : "error",
        productId: ok ? saved._id || (existing ? String(existing._id) : undefined) : undefined,
        ...(ok ? {} : { errors: [outcome.body?.message || "Could not save this row"] }),
      });
    }

    const summary = {
      total: results.length,
      created: results.filter((r) => r.status === "created").length,
      updated: results.filter((r) => r.status === "updated").length,
      failed: results.filter((r) => r.status === "error").length,
    };
    return handleResponse(res, 200, "Bulk import finished", { summary, results });
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};
