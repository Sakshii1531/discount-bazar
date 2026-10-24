import Product from "../models/product.js";
import Order from "../models/order.js";
import PosCustomer from "../models/posCustomer.js";
import handleResponse from "../utils/helper.js";
import { getPagination } from "../utils/pagination.js";
import { getSellerTz, dateRangeFilter } from "../services/businessTime.js";
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

    // In-stock items first (by name), out-of-stock ones only fill what is left of the
    // 500 cap — so a large catalog never drops sellable items in favour of sold-out ones.
    const LIMIT = 500;
    const find = (extra, limit) =>
      Product.find({ $and: [...conditions, extra] })
        .select("name sku barcode gstPercent mrp size colour mainImage price salePrice stock lowStockAlert categoryId subcategoryId headerId variants purchaseCost purchaseGstType")
        .populate("categoryId", "name")
        .sort({ name: 1 })
        .limit(limit)
        .lean();
    const inStock = { $or: [{ stock: { $gt: 0 } }, { "variants.stock": { $gt: 0 } }] };
    const inStockItems = await find(inStock, LIMIT);
    const products =
      inStockItems.length < LIMIT ? [...inStockItems, ...(await find({ $nor: [inStock] }, LIMIT - inStockItems.length))] : inStockItems;

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
    // Optional business-day range (from/to or startDate/endDate, seller timezone).
    const range = dateRangeFilter(req.query, await getSellerTz(sellerId));
    if (range) query.createdAt = range;
    const trimmedSearch = String(req.query.search || "").trim();
    if (trimmedSearch) {
      const regex = new RegExp(trimmedSearch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      query.$or = [
        { orderId: regex },
        { "walkInCustomer.name": regex },
        { "walkInCustomer.phone": regex },
      ];
      // Udhaar bills may be linked only to a ledger customer (no walk-in name typed)
      const ledgerCustomers = await PosCustomer.find({ seller: sellerId, $or: [{ name: regex }, { phone: regex }] })
        .select("_id")
        .limit(200)
        .lean();
      if (ledgerCustomers.length) query.$or.push({ posCustomer: { $in: ledgerCustomers.map((c) => c._id) } });
    }

    const [items, total] = await Promise.all([
      // posCustomer comes back as { _id, name, phone } so bills linked to a
      // ledger customer show their name rather than "Walk-in".
      Order.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).populate("posCustomer", "name phone").lean(),
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

    const createdAt = dateRangeFilter(req.query, await getSellerTz(sellerId));
    const result = await listPosReturnsService({ sellerId, page, limit, createdAt });
    return handleResponse(res, 200, "POS returns fetched", result);
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};
