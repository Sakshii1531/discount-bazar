import express from "express";
import multer from "multer";
import {
    getActiveBrands,
    getAdminBrands,
    createBrand,
    updateBrand,
    deleteBrand,
} from "../controller/brandController.js";
import { verifyToken, allowRoles } from "../middleware/authMiddleware.js";
import handleResponse from "../utils/helper.js";

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        if (/^image\//.test(file.mimetype)) return cb(null, true);
        cb(new Error("Brand logo must be an image"));
    },
});

// Rejects oversized/non-image logos with a 400 instead of a 500.
const uploadLogo = (req, res, next) => {
    upload.single("logo")(req, res, (err) => {
        if (!err) return next();
        const message = err.code === "LIMIT_FILE_SIZE" ? "Brand logo must be 2 MB or smaller" : err.message;
        return handleResponse(res, 400, message);
    });
};

// Public: active brands only (seller product form, customer app).
export const publicBrandRouter = express.Router();
publicBrandRouter.get("/", getActiveBrands);

// Admin: full brand management.
export const adminBrandRouter = express.Router();
adminBrandRouter.use(verifyToken, allowRoles("admin"));
adminBrandRouter.get("/", getAdminBrands);
adminBrandRouter.post("/", uploadLogo, createBrand);
adminBrandRouter.put("/:id", uploadLogo, updateBrand);
adminBrandRouter.delete("/:id", deleteBrand);
