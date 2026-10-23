import express from "express";
import {
  adminApproveCancellation,
  adminCancelOrderController,
  adminCancellationReports,
  adminConfirmReturn,
  adminGetCancellation,
  adminGetCancellationPolicy,
  adminInspectReturn,
  adminListCancellations,
  adminRejectCancellation,
  adminResolveRefund,
  adminRetryRefund,
  adminReviewCancellation,
  adminUpdateCancellationPolicy,
  confirmReturnToStore,
  getOrderCancellation,
  getPublicCancellationPolicy,
  getRiderReturnTasks,
  getSellerCancellations,
  submitOrderCancellation,
  submitReturnInspection,
  withdrawOrderCancellation,
} from "../controller/orderCancellationController.js";
import { verifyToken, allowRoles, requireApprovedSeller } from "../middleware/authMiddleware.js";

// Mounted at /api/cancellations. Static segments are declared before the
// parameterised ones so "/admin/..." never matches "/:id/...".
const router = express.Router();

router.get("/policy", getPublicCancellationPolicy);

// Customer
router.get(
  "/orders/:orderId",
  verifyToken,
  allowRoles("customer", "user", "seller", "delivery", "admin"),
  requireApprovedSeller,
  getOrderCancellation,
);
router.post("/orders/:orderId", verifyToken, allowRoles("customer", "user"), submitOrderCancellation);
router.post("/orders/:orderId/withdraw", verifyToken, allowRoles("customer", "user"), withdrawOrderCancellation);

// Rider
router.get("/rider/returns", verifyToken, allowRoles("delivery"), getRiderReturnTasks);
router.post("/rider/returns/:id/confirm", verifyToken, allowRoles("delivery"), confirmReturnToStore);

// Seller
router.get("/seller", verifyToken, allowRoles("seller"), requireApprovedSeller, getSellerCancellations);
router.post("/seller/:id/inspection", verifyToken, allowRoles("seller"), requireApprovedSeller, submitReturnInspection);

// Super Admin
const admin = [verifyToken, allowRoles("admin")];
router.get("/admin/policy", ...admin, adminGetCancellationPolicy);
router.put("/admin/policy", ...admin, adminUpdateCancellationPolicy);
router.get("/admin/reports", ...admin, adminCancellationReports);
router.post("/admin/orders/:orderId/cancel", ...admin, adminCancelOrderController);
router.get("/admin", ...admin, adminListCancellations);
router.get("/admin/:id", ...admin, adminGetCancellation);
router.post("/admin/:id/review", ...admin, adminReviewCancellation);
router.post("/admin/:id/approve", ...admin, adminApproveCancellation);
router.post("/admin/:id/reject", ...admin, adminRejectCancellation);
router.post("/admin/:id/refund/retry", ...admin, adminRetryRefund);
router.post("/admin/:id/refund/resolve", ...admin, adminResolveRefund);
router.post("/admin/:id/return/confirm", ...admin, adminConfirmReturn);
router.post("/admin/:id/inspection", ...admin, adminInspectReturn);

export default router;
