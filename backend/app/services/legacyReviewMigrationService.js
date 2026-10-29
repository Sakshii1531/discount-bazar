/**
 * Copies reviews from the legacy Review collection (written by the old
 * product-page form) into ProductRating, which the product page lists and
 * the rating summary counts.
 *
 * Each review is attached to the customer's oldest delivered, unreturned,
 * not-yet-rated order item for that product. Reviews with no such item (no
 * delivered purchase) are left alone. Approved and pending reviews become
 * ACTIVE, rejected ones HIDDEN. Migrated reviews are marked, so re-running
 * never creates a second rating.
 */
import Review from "../models/review.js";
import Order from "../models/order.js";
import ProductRating from "../models/productRating.js";
import { RATING_STATUSES } from "../constants/productRatingConstants.js";
import { rebuildProductRatingAggregate } from "../controller/productRatingController.js";

const isDelivered = (order) =>
  [order.orderStatus, order.status, order.workflowStatus].some((s) => String(s || "").toLowerCase() === "delivered");

async function findUnratedOrderItem(customerId, productId) {
  const orders = await Order.find({ customer: customerId, "items.product": productId })
    .select("items orderStatus status workflowStatus deliveredAt createdAt")
    .sort({ deliveredAt: 1, createdAt: 1 })
    .lean();
  const rated = new Set(
    (await ProductRating.find({ customerId, productId }).select("orderItemId").lean()).map((r) => String(r.orderItemId)),
  );
  for (const order of orders.filter(isDelivered)) {
    const item = (order.items || []).find(
      (i) =>
        String(i.product) === String(productId) &&
        i.returnStatus !== "completed" &&
        i.returnStatus !== "approved" &&
        !rated.has(String(i._id)),
    );
    if (item) return { order, item };
  }
  return null;
}

export async function migrateLegacyReviews({ apply = false, onReview } = {}) {
  const reviews = await Review.find({ migratedRatingId: null }).sort({ createdAt: 1 }).lean();
  const touchedProducts = new Set();
  let migrated = 0;
  let skipped = 0;

  for (const review of reviews) {
    const target = await findUnratedOrderItem(review.userId, review.productId);
    onReview?.({ review, target });
    if (!target) {
      skipped += 1;
      continue;
    }
    migrated += 1;
    if (!apply) continue;

    const rating = await ProductRating.create({
      orderId: target.order._id,
      orderItemId: target.item._id,
      customerId: review.userId,
      productId: review.productId,
      rating: review.rating,
      comment: String(review.comment || "").slice(0, 500),
      status: review.status === "rejected" ? RATING_STATUSES.HIDDEN : RATING_STATUSES.ACTIVE,
      isVerifiedPurchase: true,
      createdAt: review.createdAt,
    });
    await Review.updateOne({ _id: review._id }, { $set: { migratedRatingId: rating._id } });
    touchedProducts.add(String(review.productId));
  }

  for (const productId of touchedProducts) {
    await rebuildProductRatingAggregate(productId);
  }

  return { total: reviews.length, migrated, skipped };
}
