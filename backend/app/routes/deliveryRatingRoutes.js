import express from "express";
import { verifyToken, allowRoles } from "../middleware/authMiddleware.js";
import validate from "../middleware/validate.js";
import {
  validateCreateRating,
  validateModerationStatus,
} from "../validation/deliveryRatingValidation.js";
import * as ratingController from "../controller/deliveryRatingController.js";

const router = express.Router();

/* ===============================
   Customer Rating Routes
================================ */
router.get(
  "/delivery-ratings/eligibility/:orderId",
  verifyToken,
  allowRoles("customer"),
  ratingController.checkRatingEligibility
);

router.post(
  "/delivery-ratings",
  verifyToken,
  allowRoles("customer"),
  validate(validateCreateRating),
  ratingController.submitDeliveryRating
);

router.get(
  "/orders/:orderId/delivery-rating",
  verifyToken,
  allowRoles("customer"),
  ratingController.getCustomerRatingForOrder
);

/* ===============================
   Delivery Partner Rating Routes
================================ */
router.get(
  "/delivery-partners/me/rating",
  verifyToken,
  allowRoles("delivery"),
  ratingController.getPartnerRatingSummary
);

router.get(
  "/delivery-partners/me/ratings",
  verifyToken,
  allowRoles("delivery"),
  ratingController.getPartnerRatingsList
);

/* ===============================
   Admin Moderation Routes
================================ */
router.get(
  "/admin/delivery-ratings",
  verifyToken,
  allowRoles("admin"),
  ratingController.getAdminRatings
);

router.get(
  "/admin/delivery-ratings/:id",
  verifyToken,
  allowRoles("admin"),
  ratingController.getAdminRatingDetail
);

router.patch(
  "/admin/delivery-ratings/:id/status",
  verifyToken,
  allowRoles("admin"),
  validate(validateModerationStatus),
  ratingController.moderateRatingStatus
);

export default router;
