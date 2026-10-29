import Product from "../models/product.js";
import StockHistory from "../models/stockHistory.js";
import handleResponse from "../utils/helper.js";
import { emitNotificationEvent } from "../modules/notifications/notification.emitter.js";
import { NOTIFICATION_EVENTS } from "../modules/notifications/notification.constants.js";
import {
    createLowStockAlertCandidate,
    isLowStockAlertsEnabled,
} from "../services/lowStockAlertService.js";
import { invalidate } from "../services/cacheService.js";
import { getSellerTz, dateKeyOf, dateRangeFilter } from "../services/businessTime.js";

/* ===============================
   ADJUST STOCK MANUALLY
================================ */
export const adjustStock = async (req, res) => {
    try {
        const { productId, variantSku, type, quantity, note } = req.body;
        const sellerId = req.user.id;

        // Validate before touching stock: an unknown type used to decrement the
        // product, save it, and only then fail on the StockHistory enum (500),
        // leaving stock changed with no audit record.
        if (!["Restock", "Correction"].includes(type)) {
            return handleResponse(res, 400, "type must be Restock or Correction");
        }

        const product = await Product.findOne({ _id: productId, sellerId });
        if (!product) {
            return handleResponse(res, 404, "Product not found or unauthorized");
        }

        const qtyChange = Math.abs(Number(quantity));
        if (!Number.isInteger(qtyChange) || qtyChange <= 0) {
            return handleResponse(res, 400, "Quantity must be a positive whole number");
        }

        const delta = type === 'Restock' ? qtyChange : -qtyChange;
        const variants = Array.isArray(product.variants) ? product.variants : [];
        let targetVariant = null;

        if (variants.length > 0) {
            const wanted = String(variantSku || "").trim().toLowerCase();
            targetVariant = wanted
                ? variants.find(
                    (v) =>
                        String(v?.sku || "").trim().toLowerCase() === wanted ||
                        String(v?.name || "").trim().toLowerCase() === wanted
                )
                : variants.length === 1
                    ? variants[0]
                    : null;
            // Never guess: adjusting the first variant instead silently moved the wrong stock.
            if (!targetVariant) {
                return handleResponse(res, 400, wanted ? "Variant not found on this product" : "Choose the variant to adjust");
            }
        }

        // One atomic $inc against the live document. Saving values computed from an
        // earlier read used to overwrite sales made in between, and a correction larger
        // than the stock was clamped to 0 while history logged the full amount.
        const filter = { _id: productId, sellerId };
        let update = { $inc: { stock: delta } };
        if (targetVariant) {
            filter.variants = {
                $elemMatch: { _id: targetVariant._id, ...(delta < 0 ? { stock: { $gte: qtyChange } } : {}) },
            };
            update = { $inc: { stock: delta, "variants.$.stock": delta } };
        } else if (delta < 0) {
            filter.stock = { $gte: qtyChange };
        }
        if (targetVariant && typeof targetVariant.stock !== "number") {
            // $inc cannot start from null: an untracked variant counts from 0.
            await Product.updateOne(
                { _id: productId, variants: { $elemMatch: { _id: targetVariant._id, stock: { $not: { $type: "number" } } } } },
                { $set: { "variants.$.stock": 0 } },
            );
        }
        const updated = await Product.findOneAndUpdate(filter, update, { new: true });
        if (!updated) {
            const live = await Product.findById(productId).select("stock variants").lean();
            const liveVariant = targetVariant
                ? (live?.variants || []).find((v) => String(v._id) === String(targetVariant._id))
                : null;
            const available = Math.max(0, Number((targetVariant ? liveVariant?.stock : live?.stock) || 0));
            return handleResponse(res, 409, `Cannot remove ${qtyChange} unit(s): only ${available} in stock`);
        }

        // Self-heal: master stock is the sum of variant stocks (same as order placement).
        if (updated.variants.length > 0) {
            const variantStockSum = updated.variants.reduce(
                (sum, v) => sum + Math.max(0, Number(v.stock) || 0),
                0
            );
            if (updated.stock !== variantStockSum) {
                updated.stock = variantStockSum;
                await Product.updateOne({ _id: updated._id }, { $set: { stock: variantStockSum } });
            }
        }
        const previousStock = Number(updated.stock || 0) - delta;

        // Invalidate cache so customers immediately see updated stock
        try {
            await invalidate(`cache:catalog:product:${productId}`);
            await invalidate(`cache:catalog:products`);
        } catch (_) {}

        // 2. Create History Entry
        const variantLabel = targetVariant ? ` [${targetVariant.name || targetVariant.sku}]` : "";
        const historyEntry = new StockHistory({
            product: productId,
            seller: sellerId,
            type, // Restock, Correction
            quantity: delta,
            note: note ? `${note}${variantLabel}` : `Manual ${type} adjustment${variantLabel}`
        });

        await historyEntry.save();

        if (
            type !== 'Restock' &&
            qtyChange > 0 &&
            await isLowStockAlertsEnabled()
        ) {
            const lowStockAlert = createLowStockAlertCandidate({
                product: updated,
                previousStock,
                currentStock: updated.stock,
            });
            if (lowStockAlert) {
                emitNotificationEvent(NOTIFICATION_EVENTS.LOW_STOCK_ALERT, lowStockAlert);
            }
        }

        return handleResponse(res, 200, "Stock adjusted successfully", {
            newStock: updated.stock,
            variants: updated.variants,
            historyEntry
        });

    } catch (error) {
        return handleResponse(res, 500, error.message);
    }
};

/* ===============================
   GET STOCK HISTORY LOG
================================ */
export const getStockHistory = async (req, res) => {
    try {
        const sellerId = req.user.id;
        const tz = await getSellerTz(sellerId);

        // Optional ?from&to (or startDate&endDate) business-day range.
        const query = { seller: sellerId };
        const range = dateRangeFilter(req.query, tz);
        if (range) query.createdAt = range;

        const history = await StockHistory.find(query)
            .sort({ createdAt: -1 })
            .populate("product", "name sku mainImage");

        return handleResponse(res, 200, "Stock history fetched", history.map(item => ({
            id: item._id,
            productName: item.product?.name || "Deleted Product",
            sku: item.product?.sku || "N/A",
            type: item.type,
            quantity: item.quantity > 0 ? `+${item.quantity}` : `${item.quantity}`,
            date: dateKeyOf(item.createdAt, tz),
            time: item.createdAt.toLocaleTimeString("en-IN", { timeZone: tz, hour: '2-digit', minute: '2-digit' }),
            note: item.note
        })));

    } catch (error) {
        return handleResponse(res, 500, error.message);
    }
};
