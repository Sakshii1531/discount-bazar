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

/* ===============================
   ADJUST STOCK MANUALLY
================================ */
export const adjustStock = async (req, res) => {
    try {
        const { productId, variantSku, type, quantity, note } = req.body;
        const sellerId = req.user.id;

        const product = await Product.findOne({ _id: productId, sellerId });
        if (!product) {
            return handleResponse(res, 404, "Product not found or unauthorized");
        }

        const qtyChange = Math.abs(Number(quantity));
        if (isNaN(qtyChange) || qtyChange <= 0) {
            return handleResponse(res, 400, "Quantity must be a positive number");
        }

        const previousStock = Number(product.stock || 0);
        let targetVariant = null;

        if (Array.isArray(product.variants) && product.variants.length > 0) {
            if (variantSku) {
                targetVariant = product.variants.find(
                    (v) =>
                        String(v?.sku || "").trim().toLowerCase() === String(variantSku).trim().toLowerCase() ||
                        String(v?.name || "").trim().toLowerCase() === String(variantSku).trim().toLowerCase()
                );
            }

            // If not found by SKU and product only has 1 variant, default to that single variant
            if (!targetVariant && product.variants.length === 1) {
                targetVariant = product.variants[0];
            }

            if (targetVariant) {
                const prevVarStock = Number(targetVariant.stock || 0);
                const nextVarStock = type === 'Restock'
                    ? prevVarStock + qtyChange
                    : Math.max(0, prevVarStock - qtyChange);
                targetVariant.stock = nextVarStock;
            } else {
                // Default to first variant if multiple exist and none explicitly specified
                targetVariant = product.variants[0];
                const prevVarStock = Number(targetVariant.stock || 0);
                targetVariant.stock = type === 'Restock'
                    ? prevVarStock + qtyChange
                    : Math.max(0, prevVarStock - qtyChange);
            }

            // Recalculate master stock as sum of all variant stocks
            product.stock = product.variants.reduce(
                (sum, v) => sum + Math.max(0, Number(v.stock) || 0),
                0
            );
        } else {
            // Product without variants
            const finalStock = type === 'Restock' ? previousStock + qtyChange : Math.max(0, previousStock - qtyChange);
            product.stock = finalStock;
        }

        await product.save();

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
            quantity: type === 'Restock' ? qtyChange : -qtyChange,
            note: note ? `${note}${variantLabel}` : `Manual ${type} adjustment${variantLabel}`
        });

        await historyEntry.save();

        if (
            type !== 'Restock' &&
            qtyChange > 0 &&
            await isLowStockAlertsEnabled()
        ) {
            const lowStockAlert = createLowStockAlertCandidate({
                product,
                previousStock,
                currentStock: product.stock,
            });
            if (lowStockAlert) {
                emitNotificationEvent(NOTIFICATION_EVENTS.LOW_STOCK_ALERT, lowStockAlert);
            }
        }

        return handleResponse(res, 200, "Stock adjusted successfully", {
            newStock: product.stock,
            variants: product.variants,
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

        const history = await StockHistory.find({ seller: sellerId })
            .sort({ createdAt: -1 })
            .populate("product", "name sku mainImage");

        return handleResponse(res, 200, "Stock history fetched", history.map(item => ({
            id: item._id,
            productName: item.product?.name || "Deleted Product",
            sku: item.product?.sku || "N/A",
            type: item.type,
            quantity: item.quantity > 0 ? `+${item.quantity}` : `${item.quantity}`,
            date: item.createdAt.toISOString().split('T')[0],
            time: item.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            note: item.note
        })));

    } catch (error) {
        return handleResponse(res, 500, error.message);
    }
};
