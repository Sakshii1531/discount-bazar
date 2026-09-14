import mongoose from "mongoose";
import ProductRating from "../models/productRating.js";
import Order from "../models/order.js";
import Product from "../models/product.js";
import handleResponse from "../utils/helper.js";
import getPagination from "../utils/pagination.js";
import { WORKFLOW_STATUS } from "../constants/orderWorkflow.js";
import {
  RATING_STATUSES,
  ALL_PRODUCT_FEEDBACK_TAGS,
  POSITIVE_FEEDBACK_TAGS,
  NEGATIVE_FEEDBACK_TAGS,
  RATING_WINDOW_DAYS,
} from "../constants/productRatingConstants.js";

/**
 * Check if order is in DELIVERED status
 */
const isOrderDelivered = (order) => {
  const workflowStatus = order.orderStatus || "";
  const legacyStatus = order.status || "";
  return (
    workflowStatus === WORKFLOW_STATUS.DELIVERED ||
    workflowStatus.toLowerCase() === "delivered" ||
    legacyStatus.toLowerCase() === "delivered"
  );
};

/**
 * Get delivery timestamp from order
 */
const getOrderDeliveredAt = (order) => {
  if (order.deliveredAt && !isNaN(new Date(order.deliveredAt).getTime())) {
    return new Date(order.deliveredAt);
  }
  return new Date(order.updatedAt || Date.now());
};

/**
 * Calculate if rating window (7 days) is still active
 */
const isWithinRatingWindow = (deliveredAt) => {
  const diffMs = Date.now() - deliveredAt.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays <= RATING_WINDOW_DAYS;
};

/**
 * Safely update Product Aggregate rating stats atomically
 */
const updateProductAggregate = async (productId, deltaCount, deltaSum, deltaDist, session = null) => {
  const queryOptions = session ? { session } : {};
  const product = await Product.findById(productId, null, queryOptions);
  if (!product) return;

  const currentSum = Math.max(0, (product.ratingSum || 0) + deltaSum);
  const currentCount = Math.max(0, (product.ratingCount || 0) + deltaCount);
  const newAverage = currentCount > 0 ? Number((currentSum / currentCount).toFixed(2)) : 0;

  const dist = { ...(product.ratingDistribution || { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }) };
  for (const [star, count] of Object.entries(deltaDist)) {
    dist[star] = Math.max(0, (dist[star] || 0) + Number(count));
  }

  await Product.findByIdAndUpdate(
    productId,
    {
      $set: {
        ratingSum: currentSum,
        ratingCount: currentCount,
        ratingAverage: newAverage,
        ratingDistribution: dist,
      },
    },
    queryOptions
  );
};

/**
 * Developer / Admin utility to completely rebuild Product aggregate from ACTIVE ProductRating documents
 */
export const rebuildProductRatingAggregate = async (productId, session = null) => {
  const queryOptions = session ? { session } : {};
  const activeRatings = await ProductRating.find(
    { productId, status: RATING_STATUSES.ACTIVE },
    null,
    queryOptions
  ).lean();

  let ratingSum = 0;
  const ratingCount = activeRatings.length;
  const ratingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

  for (const r of activeRatings) {
    ratingSum += r.rating;
    if (ratingDistribution[r.rating] !== undefined) {
      ratingDistribution[r.rating] += 1;
    }
  }

  const ratingAverage = ratingCount > 0 ? Number((ratingSum / ratingCount).toFixed(2)) : 0;

  await Product.findByIdAndUpdate(
    productId,
    {
      $set: {
        ratingSum,
        ratingCount,
        ratingAverage,
        ratingDistribution,
      },
    },
    queryOptions
  );

  return { ratingSum, ratingCount, ratingAverage, ratingDistribution };
};

/**
 * GET /api/product-ratings/eligibility/:orderId
 * Customer check for rateable items in an order
 */
export const getEligibility = async (req, res) => {
  try {
    const { orderId } = req.params;
    const customerId = req.user.id;

    if (!mongoose.Types.ObjectId.isValid(orderId) && typeof orderId !== "string") {
      return handleResponse(res, 400, "Invalid order ID");
    }

    const order = await Order.findOne({
      $or: [{ _id: mongoose.Types.ObjectId.isValid(orderId) ? orderId : null }, { orderId: orderId }],
      customer: customerId,
    });

    if (!order) {
      return handleResponse(res, 404, "Order not found or access denied");
    }

    const delivered = isOrderDelivered(order);
    const deliveredAt = getOrderDeliveredAt(order);
    const withinWindow = delivered && isWithinRatingWindow(deliveredAt);

    // Fetch all existing ratings submitted by customer for this order
    const existingRatings = await ProductRating.find({
      orderId: order._id,
      customerId,
    }).lean();

    const ratedItemMap = new Map(
      existingRatings.map((r) => [r.orderItemId.toString(), r])
    );

    const items = (order.items || []).map((item) => {
      const isReturned = item.returnStatus === "completed" || item.returnStatus === "approved";
      const existing = ratedItemMap.get(item._id.toString());
      const alreadyRated = Boolean(existing);
      const isEligible = delivered && withinWindow && !isReturned && !alreadyRated;

      return {
        orderItemId: item._id,
        productId: item.product,
        productName: item.name,
        image: item.image,
        variantSlot: item.variantSlot,
        price: item.price,
        quantity: item.quantity,
        isReturned,
        alreadyRated,
        existingRating: existing
          ? {
              rating: existing.rating,
              feedbackTags: existing.feedbackTags,
              comment: existing.comment,
              createdAt: existing.createdAt,
            }
          : null,
        eligible: isEligible,
      };
    });

    const isOrderEligible = delivered && withinWindow && items.some((i) => i.eligible);

    return handleResponse(res, 200, "Eligibility retrieved successfully", {
      orderId: order._id,
      customOrderId: order.orderId,
      delivered,
      deliveredAt,
      withinRatingWindow: withinWindow,
      eligible: isOrderEligible,
      items,
    });
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

/**
 * POST /api/product-ratings
 * Submit rating for a specific orderItem
 */
export const submitProductRating = async (req, res) => {
  let session = null;
  try {
    const { orderItemId, rating, feedbackTags = [], comment = "" } = req.body;
    const customerId = req.user.id;

    if (!orderItemId || !mongoose.Types.ObjectId.isValid(orderItemId)) {
      return handleResponse(res, 400, "Valid orderItemId is required");
    }

    const numericRating = Number(rating);
    if (!Number.isInteger(numericRating) || numericRating < 1 || numericRating > 5) {
      return handleResponse(res, 400, "Rating must be an integer between 1 and 5");
    }

    // Validate feedback tags
    const validTags = Array.isArray(feedbackTags)
      ? feedbackTags.filter((t) => ALL_PRODUCT_FEEDBACK_TAGS.includes(t))
      : [];

    const sanitizedComment = typeof comment === "string" ? comment.trim().slice(0, 500) : "";

    // Find Order containing this orderItem belonging to customer
    const order = await Order.findOne({
      customer: customerId,
      "items._id": orderItemId,
    });

    if (!order) {
      return handleResponse(res, 403, "Order item not found or unauthorized");
    }

    if (!isOrderDelivered(order)) {
      return handleResponse(res, 400, "Product rating is only available for delivered orders");
    }

    const deliveredAt = getOrderDeliveredAt(order);
    if (!isWithinRatingWindow(deliveredAt)) {
      return handleResponse(res, 410, "Rating window of 7 days has expired for this order");
    }

    const targetItem = order.items.id(orderItemId);
    if (!targetItem) {
      return handleResponse(res, 404, "Order item not found in order");
    }

    if (targetItem.returnStatus === "completed" || targetItem.returnStatus === "approved") {
      return handleResponse(res, 400, "Cannot rate returned or refunded items");
    }

    // Canonical Product ID derived from OrderItem
    const productId = targetItem.product;

    // Check duplicate rating before creation
    const existing = await ProductRating.findOne({
      orderItemId,
      customerId,
    });

    if (existing) {
      return handleResponse(res, 409, "You have already rated this product item", existing);
    }

    try {
      session = await mongoose.startSession();
      session.startTransaction();
    } catch (sErr) {
      session = null;
    }

    // Create rating
    const newRating = new ProductRating({
      orderId: order._id,
      orderItemId,
      customerId,
      productId,
      rating: numericRating,
      feedbackTags: validTags,
      comment: sanitizedComment,
      status: RATING_STATUSES.ACTIVE,
      isVerifiedPurchase: true,
    });

    await newRating.save(session ? { session } : {});

    // Update Product Aggregate Rating Stats
    await updateProductAggregate(productId, 1, numericRating, { [numericRating]: 1 }, session);

    if (session) {
      await session.commitTransaction();
      session.endSession();
    }

    return handleResponse(res, 201, "Product rating submitted successfully", newRating);
  } catch (error) {
    if (session) {
      try {
        await session.abortTransaction();
        session.endSession();
      } catch (e) {}
    }
    if (error.code === 11000) {
      const existing = await ProductRating.findOne({
        orderItemId: req.body?.orderItemId,
        customerId: req.user?.id,
      }).lean();
      return handleResponse(res, 200, "Duplicate request resolved using existing rating", existing);
    }
    return handleResponse(res, 500, error.message);
  }
};

/**
 * GET /api/orders/:orderId/product-ratings
 * Fetch ratings for an order
 */
export const getOrderProductRatings = async (req, res) => {
  try {
    const { orderId } = req.params;
    const customerId = req.user.id;

    const order = await Order.findOne({
      $or: [{ _id: mongoose.Types.ObjectId.isValid(orderId) ? orderId : null }, { orderId: orderId }],
      customer: customerId,
    });

    if (!order) {
      return handleResponse(res, 404, "Order not found or access denied");
    }

    const ratings = await ProductRating.find({
      orderId: order._id,
      customerId,
    }).lean();

    return handleResponse(res, 200, "Order product ratings retrieved successfully", ratings);
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

/**
 * GET /api/products/:productId/ratings
 * Public reviews list for a product (ACTIVE ratings only)
 */
export const getProductRatings = async (req, res) => {
  try {
    const { productId } = req.params;
    const { rating, sort } = req.query;
    const { page, limit, skip } = getPagination(req, { defaultLimit: 10, maxLimit: 50 });

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return handleResponse(res, 400, "Invalid product ID");
    }

    const query = {
      productId,
      status: RATING_STATUSES.ACTIVE,
    };

    if (rating && !isNaN(Number(rating))) {
      query.rating = Number(rating);
    }

    let sortOptions = { createdAt: -1 };
    if (sort === "highest") {
      sortOptions = { rating: -1, createdAt: -1 };
    } else if (sort === "lowest") {
      sortOptions = { rating: 1, createdAt: -1 };
    }

    const [items, total] = await Promise.all([
      ProductRating.find(query)
        .populate("customerId", "name")
        .sort(sortOptions)
        .skip(skip)
        .limit(limit)
        .lean(),
      ProductRating.countDocuments(query),
    ]);

    const formattedReviews = items.map((r) => {
      const fullCustomerName = r.customerId?.name || "Verified Customer";

      return {
        id: r._id,
        rating: r.rating,
        feedbackTags: r.feedbackTags || [],
        comment: r.comment,
        isVerifiedPurchase: r.isVerifiedPurchase,
        customerName: fullCustomerName,
        createdAt: r.createdAt,
      };
    });

    return handleResponse(res, 200, "Product reviews fetched successfully", {
      items: formattedReviews,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    });
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

/**
 * GET /api/products/:productId/rating-summary
 * Rating breakdown and average for a product
 */
export const getProductRatingSummary = async (req, res) => {
  try {
    const { productId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return handleResponse(res, 400, "Invalid product ID");
    }

    const product = await Product.findById(productId, "ratingAverage ratingCount ratingSum ratingDistribution").lean();
    if (!product) {
      return handleResponse(res, 404, "Product not found");
    }

    return handleResponse(res, 200, "Product rating summary fetched successfully", {
      average: product.ratingAverage || 0,
      count: product.ratingCount || 0,
      sum: product.ratingSum || 0,
      distribution: product.ratingDistribution || { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    });
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

/**
 * GET /api/product-ratings/admin
 * Admin list with filters & pagination
 */
export const getAdminProductRatings = async (req, res) => {
  try {
    const { status, rating, search, page: reqPage, limit: reqLimit } = req.query;
    const { page, limit, skip } = getPagination(req, { defaultLimit: 25, maxLimit: 100 });

    const query = {};

    if (status && Object.values(RATING_STATUSES).includes(status)) {
      query.status = status;
    }

    if (rating && !isNaN(Number(rating))) {
      query.rating = Number(rating);
    }

    if (search) {
      query.$or = [
        { comment: { $regex: search, $options: "i" } },
        { flagReason: { $regex: search, $options: "i" } },
      ];
    }

    const [items, total] = await Promise.all([
      ProductRating.find(query)
        .populate("customerId", "name email phone")
        .populate("productId", "name mainImage")
        .populate("orderId", "orderId")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ProductRating.countDocuments(query),
    ]);

    const formattedItems = items.map((r) => ({
      id: r._id,
      orderId: r.orderId?.orderId || r.orderId?._id || "N/A",
      customer: r.customerId?.name || "Customer",
      customerEmail: r.customerId?.email || "",
      customerPhone: r.customerId?.phone || "",
      productName: r.productId?.name || "Deleted Product",
      productImage: r.productId?.mainImage || "",
      productId: r.productId?._id,
      rating: r.rating,
      feedbackTags: r.feedbackTags || [],
      comment: r.comment,
      status: r.status,
      isVerifiedPurchase: r.isVerifiedPurchase,
      isFlagged: r.isFlagged,
      flagReason: r.flagReason,
      moderatedAt: r.moderatedAt,
      createdAt: r.createdAt,
    }));

    return handleResponse(res, 200, "Admin product ratings fetched successfully", {
      items: formattedItems,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    });
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

/**
 * PATCH /api/product-ratings/admin/:id/status
 * Admin moderation status update with atomic aggregate synchronization
 */
export const updateRatingStatus = async (req, res) => {
  let session = null;
  try {
    const { id } = req.params;
    const { status, moderationReason = "" } = req.body;
    const adminId = req.user.id;

    if (!Object.values(RATING_STATUSES).includes(status)) {
      return handleResponse(res, 400, "Invalid rating status");
    }

    const ratingDoc = await ProductRating.findById(id);
    if (!ratingDoc) {
      return handleResponse(res, 404, "Product rating not found");
    }

    const oldStatus = ratingDoc.status;
    const newStatus = status;

    if (oldStatus === newStatus) {
      return handleResponse(res, 200, "Status unchanged", ratingDoc);
    }

    try {
      session = await mongoose.startSession();
      session.startTransaction();
    } catch (sErr) {
      session = null;
    }

    ratingDoc.status = newStatus;
    ratingDoc.moderatedBy = adminId;
    ratingDoc.moderatedAt = new Date();
    ratingDoc.moderationReason = moderationReason;

    await ratingDoc.save(session ? { session } : {});

    // Atomic aggregate adjustment on Product: ONLY ACTIVE ratings are included in aggregates (Req 16)
    const wasActive = oldStatus === RATING_STATUSES.ACTIVE;
    const isActiveNow = newStatus === RATING_STATUSES.ACTIVE;

    if (wasActive && !isActiveNow) {
      // Rating removed from active count
      await updateProductAggregate(
        ratingDoc.productId,
        -1,
        -ratingDoc.rating,
        { [ratingDoc.rating]: -1 },
        session
      );
    } else if (!wasActive && isActiveNow) {
      // Rating restored to active count
      await updateProductAggregate(
        ratingDoc.productId,
        1,
        ratingDoc.rating,
        { [ratingDoc.rating]: 1 },
        session
      );
    }

    if (session) {
      await session.commitTransaction();
      session.endSession();
    }

    return handleResponse(res, 200, `Rating status updated to ${newStatus} successfully`, ratingDoc);
  } catch (error) {
    if (session) {
      try {
        await session.abortTransaction();
        session.endSession();
      } catch (e) {}
    }
    return handleResponse(res, 500, error.message);
  }
};
