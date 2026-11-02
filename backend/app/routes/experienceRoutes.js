import express from "express";
import multer from "multer";
import {
  getAdminExperienceSections,
  createExperienceSection,
  updateExperienceSection,
  deleteExperienceSection,
  reorderExperienceSections,
  getPublicExperienceSections,
  uploadBannerImage,
  getBannerUploadConfig,
  getPublicHeroConfig,
  getAdminHeroConfig,
  upsertHeroConfig,
} from "../controller/experienceController.js";
import { verifyToken, allowRoles } from "../middleware/authMiddleware.js";
import { getBannerMediaConfig } from "../services/bannerMediaService.js";
import handleResponse from "../utils/helper.js";

const router = express.Router();

// The upload field stays "image" for images and videos alike. This cap only
// stops oversized bodies; the per-type limits are checked by the controller.
const receiveBannerFile = (req, res, next) => {
  const { maxImageBytes, maxVideoBytes } = getBannerMediaConfig();
  const fileSize = Math.max(maxImageBytes, maxVideoBytes);
  multer({ storage: multer.memoryStorage(), limits: { fileSize } }).single("image")(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") {
      const maxMb = Number((fileSize / (1024 * 1024)).toFixed(2));
      return handleResponse(res, 400, `File is too large. The maximum size is ${maxMb} MB.`);
    }
    return handleResponse(res, 400, err.message);
  });
};

// Admin routes (protected)
router.get(
  "/admin/experience",
  verifyToken,
  allowRoles("admin"),
  getAdminExperienceSections
);

router.post(
  "/admin/experience",
  verifyToken,
  allowRoles("admin"),
  createExperienceSection
);

// Specific routes MUST come before generic parameterized route /admin/experience/:id
router.put(
  "/admin/experience/reorder",
  verifyToken,
  allowRoles("admin"),
  reorderExperienceSections
);

router.get(
  "/admin/experience/banner-upload-config",
  verifyToken,
  allowRoles("admin"),
  getBannerUploadConfig
);

// Admin hero config (separate from experience sections) - before :id so "hero" is not matched as id
router.get(
  "/admin/experience/hero",
  verifyToken,
  allowRoles("admin"),
  getAdminHeroConfig
);
router.put(
  "/admin/experience/hero",
  verifyToken,
  allowRoles("admin"),
  upsertHeroConfig
);

router.put(
  "/admin/experience/:id",
  verifyToken,
  allowRoles("admin"),
  updateExperienceSection
);

router.delete(
  "/admin/experience/:id",
  verifyToken,
  allowRoles("admin"),
  deleteExperienceSection
);

router.post(
  "/admin/experience/upload-banner",
  verifyToken,
  allowRoles("admin"),
  receiveBannerFile,
  uploadBannerImage
);

// Public routes
router.get("/experience", getPublicExperienceSections);
router.get("/experience/hero", getPublicHeroConfig);

export default router;
