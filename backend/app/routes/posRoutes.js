import express from "express";
import {
  getPosCatalog,
  createPosSale,
  previewPosSale,
  getPosSales,
  getPosOrderForReturn,
  createPosReturn,
  getPosReturns,
  editPosSale,
} from "../controller/posController.js";
import { verifyToken, allowRoles, requireApprovedSeller } from "../middleware/authMiddleware.js";
import { validate } from "../middleware/validate.js";
import {
  createPosSaleSchema,
  createPosReturnSchema,
  editPosSaleSchema,
  previewPosSaleSchema,
} from "../validation/posValidation.js";

const router = express.Router();

router.get("/catalog", verifyToken, allowRoles("seller"), requireApprovedSeller, getPosCatalog);
router.post(
  "/sale",
  verifyToken,
  allowRoles("seller"),
  requireApprovedSeller,
  validate(createPosSaleSchema),
  createPosSale,
);
router.post(
  "/sale/preview",
  verifyToken,
  allowRoles("seller"),
  requireApprovedSeller,
  validate(previewPosSaleSchema),
  previewPosSale,
);
router.put(
  "/sales/:orderId",
  verifyToken,
  allowRoles("seller"),
  requireApprovedSeller,
  validate(editPosSaleSchema),
  editPosSale,
);
router.get("/sales", verifyToken, allowRoles("seller"), requireApprovedSeller, getPosSales);

router.get(
  "/returns/order/:orderId",
  verifyToken,
  allowRoles("seller"),
  requireApprovedSeller,
  getPosOrderForReturn,
);
router.post(
  "/returns",
  verifyToken,
  allowRoles("seller"),
  requireApprovedSeller,
  validate(createPosReturnSchema),
  createPosReturn,
);
router.get("/returns", verifyToken, allowRoles("seller"), requireApprovedSeller, getPosReturns);

export default router;
