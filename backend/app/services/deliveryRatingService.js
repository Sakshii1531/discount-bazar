import mongoose from "mongoose";
import Order from "../models/order.js";
import Delivery from "../models/delivery.js";
import DeliveryRating from "../models/deliveryRating.js";
import Notification from "../models/notification.js";
import {
  RATING_STATUSES,
  RATING_WINDOW_DAYS,
  POSITIVE_FEEDBACK_TAGS,
  NEGATIVE_FEEDBACK_TAGS,
} from "../constants/deliveryRatingConstants.js";

/**
 * Check if a customer is eligible to rate a delivery partner for an order.
 */
export const checkEligibility = async (orderId, customerId) => {
  let order;

  if (mongoose.Types.ObjectId.isValid(orderId)) {
    order = await Order.findOne({
      _id: orderId,
      customer: customerId,
    })
      .populate("deliveryBoy", "name profileImage vehicleType")
      .populate("deliveryPartner", "name profileImage vehicleType")
      .lean();
  } else {
    order = await Order.findOne({
      orderId: orderId,
      customer: customerId,
    })
      .populate("deliveryBoy", "name profileImage vehicleType")
      .populate("deliveryPartner", "name profileImage vehicleType")
      .lean();
  }

  if (!order) {
    return { eligible: false, reason: "ORDER_NOT_FOUND" };
  }

  const isDelivered =
    String(order.status || "").toLowerCase() === "delivered" ||
    String(order.workflowStatus || "").toUpperCase() === "DELIVERED";

  if (!isDelivered) {
    return { eligible: false, reason: "ORDER_NOT_DELIVERED" };
  }

  const partner = order.deliveryBoy || order.deliveryPartner;
  if (!partner || !partner._id) {
    return { eligible: false, reason: "MISSING_DELIVERY_PARTNER" };
  }

  // Check 7-day window
  const deliveredDate = order.deliveredAt || order.updatedAt || order.createdAt;
  const daysSinceDelivery = (Date.now() - new Date(deliveredDate).getTime()) / (1000 * 60 * 60 * 24);

  if (daysSinceDelivery > RATING_WINDOW_DAYS) {
    return { eligible: false, reason: "RATING_WINDOW_EXPIRED" };
  }

  // Check if rating already exists
  const existingRating = await DeliveryRating.findOne({
    orderId: order._id,
    customerId: customerId,
  }).lean();

  if (existingRating) {
    return {
      eligible: false,
      hasRated: true,
      existingRating: {
        id: existingRating._id,
        rating: existingRating.rating,
        feedbackTags: existingRating.feedbackTags,
        comment: existingRating.comment,
        createdAt: existingRating.createdAt,
      },
    };
  }

  return {
    eligible: true,
    hasRated: false,
    orderObjectId: order._id,
    deliveryPartner: {
      id: partner._id,
      name: partner.name,
      profileImage: partner.profileImage || null,
      vehicleType: partner.vehicleType || "bike",
    },
  };
};

/**
 * Submit a delivery partner rating.
 */
export const createRating = async ({ orderId, customerId, rating, feedbackTags = [], comment = "" }) => {
  const eligibility = await checkEligibility(orderId, customerId);

  if (!eligibility.eligible) {
    if (eligibility.hasRated) {
      const err = new Error("You have already submitted a rating for this order.");
      err.statusCode = 409;
      throw err;
    }
    const err = new Error(`Order is not eligible for rating: ${eligibility.reason}`);
    err.statusCode = 400;
    throw err;
  }

  const deliveryPartnerId = eligibility.deliveryPartner.id;
  const orderObjectId = eligibility.orderObjectId;

  // Validate positive vs negative tags
  const allowedTags = rating >= 4 ? POSITIVE_FEEDBACK_TAGS : NEGATIVE_FEEDBACK_TAGS;
  const filteredTags = feedbackTags.filter((tag) => allowedTags.includes(tag));

  // Save DeliveryRating document
  let newRating;
  try {
    newRating = await DeliveryRating.create({
      orderId: orderObjectId,
      customerId,
      deliveryPartnerId,
      rating,
      feedbackTags: filteredTags,
      comment: String(comment || "").trim(),
      status: RATING_STATUSES.ACTIVE,
    });
  } catch (error) {
    if (error.code === 11000) {
      const err = new Error("You have already submitted a rating for this order.");
      err.statusCode = 409;
      throw err;
    }
    throw error;
  }

  // Atomically update Delivery Partner rating aggregates
  await updateDeliveryPartnerAggregates(deliveryPartnerId);

  // Send 5-star in-app notification to delivery partner (anonymous)
  if (rating === 5) {
    try {
      await Notification.create({
        recipient: deliveryPartnerId,
        recipientModel: "Delivery",
        title: "New 5-Star Customer Rating! ⭐",
        message: "You received a new 5-star customer rating! Keep up the great work.",
        body: "You received a new 5-star customer rating! Keep up the great work.",
        type: "alert",
        channel: "in_app",
        data: {
          ratingId: newRating._id,
          rating: 5,
        },
      });
    } catch (notifErr) {
      console.error("Failed to create partner 5-star rating notification:", notifErr);
    }
  }

  return {
    id: newRating._id,
    orderId: newRating.orderId,
    rating: newRating.rating,
    feedbackTags: newRating.feedbackTags,
    comment: newRating.comment,
    createdAt: newRating.createdAt,
  };
};

/**
 * Get rating for a specific customer order.
 */
export const getCustomerOrderRating = async (orderId, customerId) => {
  let orderObjectId = orderId;
  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    const order = await Order.findOne({ orderId, customer: customerId }).select("_id").lean();
    if (!order) return null;
    orderObjectId = order._id;
  }

  const rating = await DeliveryRating.findOne({
    orderId: orderObjectId,
    customerId,
  }).lean();

  if (!rating) return null;

  return {
    id: rating._id,
    rating: rating.rating,
    feedbackTags: rating.feedbackTags,
    comment: rating.comment,
    status: rating.status,
    createdAt: rating.createdAt,
  };
};

/**
 * Get delivery partner aggregate rating summary.
 */
export const getPartnerRatingSummary = async (deliveryPartnerId) => {
  if (deliveryPartnerId) {
    await updateDeliveryPartnerAggregates(deliveryPartnerId).catch(() => {});
  }
  const partner = await Delivery.findById(deliveryPartnerId)
    .select("ratingAverage ratingCount ratingSum ratingDistribution name vehicleType profileImage")
    .lean();

  if (!partner) {
    const err = new Error("Delivery partner not found");
    err.statusCode = 404;
    throw err;
  }

  return {
    partnerId: partner._id,
    name: partner.name,
    vehicleType: partner.vehicleType,
    profileImage: partner.profileImage || null,
    ratingAverage: Number((partner.ratingAverage || 0).toFixed(2)),
    ratingCount: partner.ratingCount || 0,
    ratingSum: partner.ratingSum || 0,
    ratingDistribution: partner.ratingDistribution || {
      1: 0,
      2: 0,
      3: 0,
      4: 0,
      5: 0,
    },
  };
};

/**
 * Get paginated customer feedback for a delivery partner (Anonymous customer).
 */
export const getPartnerRatingsList = async (deliveryPartnerId, { page = 1, limit = 20 }) => {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (pageNum - 1) * limitNum;

  const filter = {
    deliveryPartnerId,
    status: RATING_STATUSES.ACTIVE,
  };

  const [items, total] = await Promise.all([
    DeliveryRating.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .select("rating feedbackTags comment createdAt")
      .lean(),
    DeliveryRating.countDocuments(filter),
  ]);

  const formattedItems = items.map((r) => ({
    id: r._id,
    rating: r.rating,
    feedbackTags: r.feedbackTags || [],
    comment: r.comment || "",
    customerName: "Anonymous customer",
    createdAt: r.createdAt,
  }));

  return {
    items: formattedItems,
    page: pageNum,
    limit: limitNum,
    total,
    totalPages: Math.ceil(total / limitNum) || 1,
  };
};

/**
 * Admin search, filter, and paginate delivery ratings.
 */
export const getAdminRatings = async ({
  page = 1,
  limit = 20,
  rating,
  partnerId,
  status,
  search,
  isFlagged,
}) => {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (pageNum - 1) * limitNum;

  const query = {};

  if (rating && !isNaN(rating)) {
    query.rating = Number(rating);
  }

  if (partnerId && mongoose.Types.ObjectId.isValid(partnerId)) {
    query.deliveryPartnerId = partnerId;
  }

  if (status && Object.values(RATING_STATUSES).includes(status)) {
    query.status = status;
  }

  if (isFlagged === "true" || isFlagged === true) {
    query.isFlagged = true;
  }

  // Search by orderId string or customer name/partner name if needed
  if (search && String(search).trim()) {
    const trimmed = String(search).trim();
    if (mongoose.Types.ObjectId.isValid(trimmed)) {
      query.$or = [{ _id: trimmed }, { orderId: trimmed }, { deliveryPartnerId: trimmed }];
    }
  }

  const [items, total, statsAggregation] = await Promise.all([
    DeliveryRating.find(query)
      .populate("deliveryPartnerId", "name phone vehicleType vehicleNumber")
      .populate("customerId", "name phone email")
      .populate("orderId", "orderId status deliveredAt createdAt")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
    DeliveryRating.countDocuments(query),
    DeliveryRating.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          avgRating: { $avg: "$rating" },
        },
      },
    ]),
  ]);

  // Overall distribution metrics for admin
  const distributionAgg = await DeliveryRating.aggregate([
    { $match: { status: RATING_STATUSES.ACTIVE } },
    { $group: { _id: "$rating", count: { $sum: 1 } } },
  ]);

  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  distributionAgg.forEach((d) => {
    if (distribution[d._id] !== undefined) {
      distribution[d._id] = d.count;
    }
  });

  const totalActive = Object.values(distribution).reduce((a, b) => a + b, 0);
  const sumActive = Object.entries(distribution).reduce((sum, [stars, cnt]) => sum + Number(stars) * cnt, 0);
  const overallAvg = totalActive > 0 ? Number((sumActive / totalActive).toFixed(2)) : 0;

  const flaggedCount = await DeliveryRating.countDocuments({ isFlagged: true });

  return {
    items,
    page: pageNum,
    limit: limitNum,
    total,
    totalPages: Math.ceil(total / limitNum) || 1,
    metrics: {
      totalRatings: totalActive,
      overallAverage: overallAvg,
      flaggedCount,
      distribution,
    },
  };
};

/**
 * Admin view rating detail.
 */
export const getAdminRatingDetail = async (ratingId) => {
  const rating = await DeliveryRating.findById(ratingId)
    .populate("deliveryPartnerId", "name phone email vehicleType vehicleNumber ratingAverage ratingCount")
    .populate("customerId", "name phone email")
    .populate("orderId", "orderId status pricing paymentBreakdown address deliveredAt createdAt")
    .populate("moderatedBy", "name email")
    .lean();

  if (!rating) {
    const err = new Error("Delivery rating not found");
    err.statusCode = 404;
    throw err;
  }

  return rating;
};

/**
 * Admin moderation: Flag, Hide, Restore, or Remove a rating.
 */
export const moderateRating = async (ratingId, { status, reason, adminId }) => {
  const rating = await DeliveryRating.findById(ratingId);

  if (!rating) {
    const err = new Error("Delivery rating not found");
    err.statusCode = 404;
    throw err;
  }

  const oldStatus = rating.status;
  const newStatus = status;

  rating.status = newStatus;
  rating.moderatedBy = adminId;
  rating.moderatedAt = new Date();
  rating.moderationReason = String(reason || "").trim();

  if (newStatus === RATING_STATUSES.FLAGGED) {
    rating.isFlagged = true;
    rating.flagReason = String(reason || "").trim();
  } else {
    rating.isFlagged = false;
  }

  await rating.save();

  // If active state changed (e.g. ACTIVE -> HIDDEN/REMOVED or HIDDEN/REMOVED -> ACTIVE), update rider aggregates
  const wasActive = oldStatus === RATING_STATUSES.ACTIVE || oldStatus === RATING_STATUSES.FLAGGED;
  const isActiveNow = newStatus === RATING_STATUSES.ACTIVE || newStatus === RATING_STATUSES.FLAGGED;

  if (wasActive !== isActiveNow) {
    await updateDeliveryPartnerAggregates(rating.deliveryPartnerId);
  }

  return rating;
};

/**
 * Re-calculate and update delivery partner rating aggregates accurately based on ACTIVE & FLAGGED ratings.
 */
export const updateDeliveryPartnerAggregates = async (deliveryPartnerId) => {
  const stats = await DeliveryRating.aggregate([
    {
      $match: {
        deliveryPartnerId: new mongoose.Types.ObjectId(deliveryPartnerId),
        status: { $in: [RATING_STATUSES.ACTIVE, RATING_STATUSES.FLAGGED] },
      },
    },
    {
      $group: {
        _id: "$rating",
        count: { $sum: 1 },
      },
    },
  ]);

  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let ratingCount = 0;
  let ratingSum = 0;

  stats.forEach((row) => {
    const star = row._id;
    const cnt = row.count;
    if (distribution[star] !== undefined) {
      distribution[star] = cnt;
    }
    ratingCount += cnt;
    ratingSum += star * cnt;
  });

  const ratingAverage = ratingCount > 0 ? Number((ratingSum / ratingCount).toFixed(2)) : 0;

  await Delivery.findByIdAndUpdate(deliveryPartnerId, {
    $set: {
      ratingCount,
      ratingSum,
      ratingAverage,
      ratingDistribution: distribution,
    },
  });
};
