import handleResponse from "../utils/helper.js";
import * as ratingService from "../services/deliveryRatingService.js";

/**
 * GET /api/delivery-ratings/eligibility/:orderId
 * Check if customer is eligible to rate delivery partner for an order.
 */
export const checkRatingEligibility = async (req, res) => {
  try {
    const { orderId } = req.params;
    const customerId = req.user.id;

    const result = await ratingService.checkEligibility(orderId, customerId);
    return handleResponse(res, 200, "Rating eligibility checked", result);
  } catch (error) {
    console.error("Check Rating Eligibility Error:", error);
    return handleResponse(
      res,
      error.statusCode || 500,
      error.message || "Failed to check rating eligibility"
    );
  }
};

/**
 * POST /api/delivery-ratings
 * Submit a delivery partner rating.
 */
export const submitDeliveryRating = async (req, res) => {
  try {
    const { orderId, rating, feedbackTags, comment } = req.body;
    const customerId = req.user.id;

    const newRating = await ratingService.createRating({
      orderId,
      customerId,
      rating,
      feedbackTags,
      comment,
    });

    return handleResponse(res, 201, "Rating submitted successfully", newRating);
  } catch (error) {
    console.error("Submit Delivery Rating Error:", error);
    return handleResponse(
      res,
      error.statusCode || 500,
      error.message || "Failed to submit rating"
    );
  }
};

/**
 * GET /api/orders/:orderId/delivery-rating
 * Get customer's submitted rating for an order.
 */
export const getCustomerRatingForOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const customerId = req.user.id;

    const rating = await ratingService.getCustomerOrderRating(orderId, customerId);
    return handleResponse(res, 200, "Customer rating retrieved", { rating });
  } catch (error) {
    console.error("Get Customer Rating Error:", error);
    return handleResponse(
      res,
      error.statusCode || 500,
      error.message || "Failed to retrieve order rating"
    );
  }
};

/**
 * GET /api/delivery-partners/me/rating
 * Delivery Partner: Get aggregate rating summary.
 */
export const getPartnerRatingSummary = async (req, res) => {
  try {
    const partnerId = req.user.id;
    const summary = await ratingService.getPartnerRatingSummary(partnerId);
    return handleResponse(res, 200, "Partner rating summary retrieved", summary);
  } catch (error) {
    console.error("Get Partner Rating Summary Error:", error);
    return handleResponse(
      res,
      error.statusCode || 500,
      error.message || "Failed to retrieve rating summary"
    );
  }
};

/**
 * GET /api/delivery-partners/me/ratings
 * Delivery Partner: Get paginated customer feedback list (Anonymous).
 */
export const getPartnerRatingsList = async (req, res) => {
  try {
    const partnerId = req.user.id;
    const { page, limit } = req.query;

    const data = await ratingService.getPartnerRatingsList(partnerId, { page, limit });
    return handleResponse(res, 200, "Partner ratings list retrieved", data);
  } catch (error) {
    console.error("Get Partner Ratings List Error:", error);
    return handleResponse(
      res,
      error.statusCode || 500,
      error.message || "Failed to retrieve ratings list"
    );
  }
};

/**
 * GET /api/admin/delivery-ratings
 * Admin: Search and filter all delivery ratings.
 */
export const getAdminRatings = async (req, res) => {
  try {
    const { page, limit, rating, partnerId, status, search, isFlagged } = req.query;

    const data = await ratingService.getAdminRatings({
      page,
      limit,
      rating,
      partnerId,
      status,
      search,
      isFlagged,
    });
    return handleResponse(res, 200, "Admin ratings retrieved", data);
  } catch (error) {
    console.error("Get Admin Ratings Error:", error);
    return handleResponse(
      res,
      error.statusCode || 500,
      error.message || "Failed to retrieve admin ratings"
    );
  }
};

/**
 * GET /api/admin/delivery-ratings/:id
 * Admin: View single rating detail.
 */
export const getAdminRatingDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const rating = await ratingService.getAdminRatingDetail(id);
    return handleResponse(res, 200, "Rating detail retrieved", rating);
  } catch (error) {
    console.error("Get Admin Rating Detail Error:", error);
    return handleResponse(
      res,
      error.statusCode || 500,
      error.message || "Failed to retrieve rating detail"
    );
  }
};

/**
 * PATCH /api/admin/delivery-ratings/:id/status
 * Admin: Flag, Hide, Restore, or Remove a rating.
 */
export const moderateRatingStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body;
    const adminId = req.user.id;

    const updated = await ratingService.moderateRating(id, {
      status,
      reason,
      adminId,
    });

    return handleResponse(res, 200, `Rating status updated to ${status}`, updated);
  } catch (error) {
    console.error("Moderate Rating Error:", error);
    return handleResponse(
      res,
      error.statusCode || 500,
      error.message || "Failed to moderate rating"
    );
  }
};
