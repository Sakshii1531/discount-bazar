import express from "express";
import {
  getEligibility,
  submitProductRating,
  getOrderProductRatings,
  getProductRatings,
  getProductRatingSummary,
  getAdminProductRatings,
  updateRatingStatus,
} from "../controller/productRatingController.js";
import {
  verifyToken,
  allowRoles,
  optionalVerifyToken,
} from "../middleware/authMiddleware.js";

const router = express.Router();

// Public routes
router.get("/products/:productId/ratings", optionalVerifyToken, getProductRatings);
router.get("/products/:productId/rating-summary", getProductRatingSummary);

// Authenticated Customer routes
router.get("/eligibility/:orderId", verifyToken, getEligibility);
router.post("/", verifyToken, submitProductRating);
router.get("/orders/:orderId", verifyToken, getOrderProductRatings);

// Admin Moderation routes
router.get("/admin", verifyToken, allowRoles("admin"), getAdminProductRatings);
router.patch("/admin/:id/status", verifyToken, allowRoles("admin"), updateRatingStatus);

export default router;
