import express from "express";
import {
    listCoupons,
    createCoupon,
    updateCoupon,
    deleteCoupon,
    validateCoupon,
} from "../controller/couponController.js";
import { verifyToken, optionalVerifyToken, allowRoles } from "../middleware/authMiddleware.js";

const router = express.Router();

// Admin management
router.get("/admin/coupons", verifyToken, allowRoles("admin"), listCoupons);
router.post("/admin/coupons", verifyToken, allowRoles("admin"), createCoupon);
router.put("/admin/coupons/:id", verifyToken, allowRoles("admin"), updateCoupon);
router.delete("/admin/coupons/:id", verifyToken, allowRoles("admin"), deleteCoupon);

// Customer‑facing (token optional: guests can check a code, signed-in
// customers get their per-user limits applied).
router.post("/coupons/validate", optionalVerifyToken, validateCoupon);
router.get("/coupons", listCoupons);

export default router;
