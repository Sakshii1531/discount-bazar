import express from "express";
import {
  createPaymentOrder,
  verifyPaymentStatus,
  handlePhonePeWebhook,
  verifyRazorpayPayment,
  handleRazorpayWebhook,
} from "../controller/paymentController.js";
import { verifyToken } from "../middleware/authMiddleware.js";
import { paymentRouteRateLimiter } from "../middleware/securityMiddlewares.js";

const paymentRoute = express.Router();

/**
 * Initiate an online payment order for a specific CheckoutGroupId or OrderId.
 * Auth: Required (Customer paying for their own order)
 */
paymentRoute.post(
  "/create-order",
  verifyToken,
  paymentRouteRateLimiter,
  createPaymentOrder,
);

/**
 * Verify payment status from client side (after redirect back from PhonePe).
 * Auth: Required
 */
paymentRoute.get(
  "/status/:id",
  verifyToken,
  paymentRouteRateLimiter,
  verifyPaymentStatus,
);

/**
 * PhonePe Server-to-Server Webhook.
 * Auth: None (Internal verification via x-verify / authorization header)
 */
paymentRoute.post(
  "/webhook/phonepe",
  express.raw({ type: "application/json" }), // SDK needs raw body for verification
  handlePhonePeWebhook,
);

/**
 * Verify Razorpay payment signature from client side (modal callback).
 * Auth: Required
 */
paymentRoute.post(
  "/verify-razorpay",
  verifyToken,
  paymentRouteRateLimiter,
  verifyRazorpayPayment,
);

/**
 * Razorpay Server-to-Server Webhook.
 * Auth: None (Internal verification via x-razorpay-signature header)
 */
paymentRoute.post(
  "/webhook/razorpay",
  express.raw({ type: "application/json" }), // SDK needs raw body for signature verification
  handleRazorpayWebhook,
);

export default paymentRoute;

