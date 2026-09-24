import Product from "../models/product.js";
import Order from "../models/order.js";
import handleResponse from "../utils/helper.js";
import { getPagination } from "../utils/pagination.js";
import { getSellerTz, dayStart, dayEnd } from "../services/businessTime.js";
import { editPosSale as editPosSaleService } from "../services/posEditService.js";
import {
  createPosSale as createPosSaleService,
  previewPosSale as previewPosSaleService,
} from "../services/posSaleService.js";
import {
  getPosOrderForReturn as getPosOrderForReturnService,
  createPosReturn as createPosReturnService,
  listPosReturns as listPosReturnsService,
} from "../services/posReturnService.js";

/* ===============================
   GET POS CATALOG (search/category-filtered product picker)
================================ */
export const getPosCatalog = async (req, res) => {
  try {
    const sellerId = req.user.id;
    const { search, categoryId } = req.query;

    const conditions = [{ sellerId }, { status: "active" }];

    if (categoryId) {
      conditions.push({
        $or: [{ categoryId }, { subcategoryId: categoryId }, { headerId: categoryId }],
      });
    }

    const trimmedSearch = String(search || "").trim();
    if (trimmedSearch) {
      const regex = new RegExp(trimmedSearch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      conditions.push({ $or: [{ name: regex }, { sku: regex }, { barcode: regex }, { "variants.barcode": regex }, { "variants.sku": regex }] });
    }

    const products = await Product.find({ $and: conditions })
      .select("name sku barcode gstPercent mrp size colour mainImage price salePrice stock lowStockAlert categoryId subcategoryId headerId variants")
      .populate("categoryId", "name")
      .sort({ name: 1 })
      .limit(500)
      .lean();

    return handleResponse(res, 200, "POS catalog fetched", products);
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

/* ===============================
   CREATE POS SALE (walk-in counter checkout)
================================ */
export const createPosSale = async (req, res) => {
  try {
    const sellerId = req.user.id;
    const idempotencyKey = String(
      req.headers["idempotency-key"] || req.headers["Idempotency-Key"] || "",
    ).trim();

    if (!idempotencyKey) {
      return handleResponse(res, 400, "Idempotency-Key header is required");
    }

    const result = await createPosSaleService({
      sellerId,
      payload: req.body,
      idempotencyKey,
    });

    return handleResponse(
      res,
      result.duplicate ? 200 : 201,
      result.duplicate ? "Sale already recorded" : "POS sale recorded",
      result,
    );
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

/* ===============================
   PREVIEW POS SALE TOTALS (coupon + discount → amount due, no writes)
================================ */
export const previewPosSale = async (req, res) => {
  try {
    const result = await previewPosSaleService({ sellerId: req.user.id, payload: req.body });
    return handleResponse(res, 200, "POS totals computed", result);
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

/* ===============================
   GET POS SALES (walk-in sales log)
================================ */
export const getPosSales = async (req, res) => {
  try {
    const sellerId = req.user.id;
    const { page, limit, skip } = getPagination(req, { defaultLimit: 25, maxLimit: 100 });

    const query = { seller: sellerId, orderSource: "POS" };
    // Optional business-day range (YYYY-MM-DD, seller timezone).
    const { from, to } = req.query;
    const isKey = (k) => /^\d{4}-\d{2}-\d{2}$/.test(String(k || ""));
    if (isKey(from) || isKey(to)) {
      const tz = await getSellerTz(sellerId);
      query.createdAt = {};
      if (isKey(from)) query.createdAt.$gte = dayStart(from, tz);
      if (isKey(to)) query.createdAt.$lte = dayEnd(to, tz);
    }
    const trimmedSearch = String(req.query.search || "").trim();
    if (trimmedSearch) {
      const regex = new RegExp(trimmedSearch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      query.$or = [
        { orderId: regex },
        { "walkInCustomer.name": regex },
        { "walkInCustomer.phone": regex },
      ];
    }

    const [items, total] = await Promise.all([
      Order.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Order.countDocuments(query),
    ]);

    return handleResponse(res, 200, "POS sales fetched", {
      items,
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
   EDIT POS SALE (audited, owner-only, open business day, no returns)
================================ */
export const editPosSale = async (req, res) => {
  try {
    const result = await editPosSaleService({
      sellerId: req.user.id,
      orderId: req.params.orderId,
      payload: req.body,
      actorId: req.user.id,
    });
    return handleResponse(res, 200, "Bill updated", result);
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

/* ===============================
   GET POS ORDER FOR RETURN (lookup by orderId, with returnable qty per line)
================================ */
export const getPosOrderForReturn = async (req, res) => {
  try {
    const sellerId = req.user.id;
    const { orderId } = req.params;

    const result = await getPosOrderForReturnService({ sellerId, orderId });
    return handleResponse(res, 200, "POS order fetched", result);
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

/* ===============================
   CREATE POS RETURN (walk-in counter return/refund)
================================ */
export const createPosReturn = async (req, res) => {
  try {
    const sellerId = req.user.id;
    const { orderId, items, refundMethod, reason, notes } = req.body;

    const result = await createPosReturnService({
      sellerId,
      orderId,
      items,
      refundMethod,
      reason,
      notes,
    });

    return handleResponse(res, 201, "Return recorded", result);
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

/* ===============================
   GET POS RETURNS (return/refund log)
================================ */
export const getPosReturns = async (req, res) => {
  try {
    const sellerId = req.user.id;
    const { page, limit } = getPagination(req, { defaultLimit: 25, maxLimit: 100 });

    const result = await listPosReturnsService({ sellerId, page, limit });
    return handleResponse(res, 200, "POS returns fetched", result);
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};
