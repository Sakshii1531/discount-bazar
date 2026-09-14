import mongoose from "mongoose";
import Seller from "../models/seller.js";
import jwt from "jsonwebtoken";
import handleResponse from "../utils/helper.js";
import {
    issueSellerVerificationOtp,
    verifySellerOtpCode,
    verifySellerVerificationToken,
    issueSellerResetOtp,
    verifySellerResetOtpCode,
} from "../services/sellerVerificationService.js";
import { uploadToCloudinary } from "../services/mediaService.js";
import Admin from "../models/admin.js";
import { emitNotificationEvent } from "../modules/notifications/notification.emitter.js";
import { NOTIFICATION_EVENTS } from "../modules/notifications/notification.constants.js";
import { emitPendingReviewUpdateToAdmins } from "../services/orderSocketEmitter.js";

/* ===============================
   Utils
================================ */

const generateToken = (seller) =>
    jwt.sign({ id: seller._id, role: "seller" }, process.env.JWT_SECRET, {
        expiresIn: "7d",
    });

const SELLER_DOCUMENT_FIELDS = {
    tradeLicense: "Trade License",
    gstCertificate: "GST Certificate",
    idProof: "ID Proof",
};

const REQUIRED_SELLER_DOCUMENT_FIELDS = Object.keys(SELLER_DOCUMENT_FIELDS);

const parseDocumentsPayload = (documents) => {
    if (!documents) {
        return {};
    }

    if (typeof documents === "string") {
        try {
            return JSON.parse(documents);
        } catch {
            return {};
        }
    }

    if (typeof documents === "object") {
        return documents;
    }

    return {};
};

const isValidUploadedDocumentReference = (value) => {
    const normalized = String(value || "").trim();
    return /^https?:\/\//i.test(normalized);
};

const resolveSellerDocuments = (body = {}, parsedDocuments = {}) => {
    const resolved = { ...(parsedDocuments || {}) };

    const directFields = {
        tradeLicense: body.tradeLicenseUrl || body.tradeLicense,
        gstCertificate: body.gstCertificateUrl || body.gstCertificate,
        idProof: body.idProofUrl || body.idProof,
    };

    for (const [field, candidate] of Object.entries(directFields)) {
        const normalized = String(candidate || "").trim();
        if (normalized && /^https?:\/\//i.test(normalized)) {
            resolved[field] = normalized;
        }
    }

    return resolved;
};

const getMissingRequiredSellerDocuments = (documents = {}) =>
    REQUIRED_SELLER_DOCUMENT_FIELDS.filter(
        (fieldName) => !isValidUploadedDocumentReference(documents[fieldName]),
    );

/* ===============================
   SELLER SIGNUP
================================ */
export const signupSeller = async (req, res) => {
    try {
        const {
            name,
            email,
            phone,
            password,
            emailVerificationToken,
            phoneVerificationToken,
            shopName,
            category,
            description,
            address,
            locality,
            pincode,
            city,
            state,
            documents,
            lat,
            lng,
            radius
        } = req.body || {};

        // 1. Handle file uploads if they exist in req.files (multipart form)
        const documentFiles = req.files || [];
        const uploadedDocs = {};

        if (Array.isArray(documentFiles) && documentFiles.length > 0) {
            for (const file of documentFiles) {
                try {
                    const fieldName = file.fieldname;
                    if (fieldName && REQUIRED_SELLER_DOCUMENT_FIELDS.includes(fieldName)) {
                        const url = await uploadToCloudinary(file.buffer, "docs", {
                            mimeType: file.mimetype,
                        });
                        uploadedDocs[fieldName] = url;
                    }
                } catch (err) {
                    console.error("Failed to upload document to Cloudinary", err);
                }
            }
        }

        // Merge uploaded document URLs into body for resolveSellerDocuments
        const augmentedBody = {
            ...req.body,
            ...uploadedDocs
        };

        const parsedLat = lat !== undefined ? Number(lat) : undefined;
        const parsedLng = lng !== undefined ? Number(lng) : undefined;
        const parsedRadius = radius !== undefined ? Number(radius) : undefined;

        if (!name || !email || !phone || !password || !shopName) {
            return handleResponse(res, 400, "All fields are required");
        }

        verifySellerVerificationToken({
            channel: "email",
            rawValue: email,
            token: emailVerificationToken,
        });
        verifySellerVerificationToken({
            channel: "phone",
            rawValue: phone,
            token: phoneVerificationToken,
        });

        // Validate coordinates and radius if provided
        if (lat !== undefined && (!Number.isFinite(parsedLat) || parsedLat < -90 || parsedLat > 90)) {
            return handleResponse(res, 400, "Invalid latitude");
        }
        if (lng !== undefined && (!Number.isFinite(parsedLng) || parsedLng < -180 || parsedLng > 180)) {
            return handleResponse(res, 400, "Invalid longitude");
        }
        if (radius !== undefined && (!Number.isFinite(parsedRadius) || parsedRadius < 1 || parsedRadius > 100)) {
            return handleResponse(res, 400, "Radius must be between 1 and 100 km");
        }

        let seller = await Seller.findOne({ $or: [{ email }, { phone }] });

        if (seller) {
            return handleResponse(res, 400, "Seller with this email or phone already exists");
        }

        const parsedDocuments = parseDocumentsPayload(documents);
        const sellerDocuments = resolveSellerDocuments(augmentedBody, parsedDocuments);
        const missingRequiredDocuments = getMissingRequiredSellerDocuments(
            sellerDocuments || {}
        );

        if (missingRequiredDocuments.length > 0) {
            const readableMissing = missingRequiredDocuments
                .map((field) => SELLER_DOCUMENT_FIELDS[field] || field)
                .join(", ");
            return handleResponse(
                res,
                400,
                `All required documents must be uploaded: ${readableMissing}`
            );
        }

        const sellerData = {
            name,
            email,
            phone,
            password,
            shopName,
            category,
            description,
            address,
            locality,
            pincode,
            city,
            state,
            documents: sellerDocuments,
            applicationStatus: "pending",
            isVerified: false,
            emailVerified: true,
            phoneVerified: true,
            isActive: false,
        };

        if (parsedLat !== undefined && parsedLng !== undefined) {
            sellerData.location = {
                type: "Point",
                coordinates: [parsedLng, parsedLat],
            };
        }

        if (parsedRadius !== undefined) {
            sellerData.serviceRadius = parsedRadius;
        }

        seller = await Seller.create(sellerData);

        try {
            const admins = await Admin.find().select("_id").lean();
            const adminIds = (admins || []).map((a) => a?._id).filter(Boolean);
            emitNotificationEvent(NOTIFICATION_EVENTS.NEW_SELLER_REGISTRATION, {
                sellerId: seller._id,
                shopName: seller.shopName,
                name: seller.name,
                adminIds,
            });
            emitPendingReviewUpdateToAdmins({ type: "seller", sellerId: seller._id });
        } catch (notifErr) {
            console.error("Failed to notify admins of new seller registration:", notifErr.message);
        }

        const token = generateToken(seller);

        return handleResponse(res, 201, "Seller registered successfully", {
            seller,
            token,
            applicationStatus: "pending",
            requiresApproval: true,
        });
    } catch (error) {
        return handleResponse(res, 500, error.message);
    }
};

export const sendSellerSignupOtp = async (req, res) => {
    try {
        const { channel, email, phone, value } = req.body || {};
        const targetValue =
            channel === "email"
                ? email || value
                : channel === "phone"
                    ? phone || value
                    : value;

        const result = await issueSellerVerificationOtp({
            channel,
            rawValue: targetValue,
            ipAddress: req.ip,
        });

        return handleResponse(res, 200, "OTP sent successfully", result);
    } catch (error) {
        return handleResponse(res, error.statusCode || 500, error.message);
    }
};

export const verifySellerSignupOtp = async (req, res) => {
    try {
        const { channel, email, phone, value, otp } = req.body || {};
        const targetValue =
            channel === "email"
                ? email || value
                : channel === "phone"
                    ? phone || value
                    : value;

        const result = await verifySellerOtpCode({
            channel,
            rawValue: targetValue,
            otp,
            ipAddress: req.ip,
        });

        return handleResponse(res, 200, "OTP verified successfully", result);
    } catch (error) {
        return handleResponse(res, error.statusCode || 500, error.message);
    }
};

/* ===============================
   SELLER LOGIN
================================ */
export const loginSeller = async (req, res) => {
    try {
        const { email, phone, emailOrPhone, password } = req.body;
        const identifier = emailOrPhone || email || phone;

        if (!identifier || !password) {
            return handleResponse(res, 400, "Email/Phone and password are required");
        }

        // Include password for comparison
        const query = identifier.includes("@") 
            ? { email: identifier.toLowerCase() } 
            : { phone: identifier.replace(/\D/g, "") };

        const seller = await Seller.findOne(query).select("+password");

        if (!seller) {
            return handleResponse(res, 404, "Seller not found");
        }

        const isMatch = await seller.comparePassword(password);

        if (!isMatch) {
            return handleResponse(res, 401, "Invalid credentials");
        }

        const applicationStatus =
            seller.applicationStatus || (seller.isVerified ? "approved" : "pending");
        const isApproved =
            seller.isVerified === true &&
            seller.isActive === true &&
            applicationStatus === "approved";

        if (!isApproved) {
            const approvalMessage =
                applicationStatus === "rejected"
                    ? "Your seller application was rejected. Please contact support."
                    : "Your seller account is pending admin approval.";

            return handleResponse(res, 403, approvalMessage, {
                applicationStatus,
                isVerified: seller.isVerified === true,
                isActive: seller.isActive === true,
                rejectionReason: seller.rejectionReason || "",
                sellerId: seller._id,
                token: generateToken(seller),
            });
        }

        seller.lastLogin = new Date();
        await seller.save();

        const token = generateToken(seller);

        return handleResponse(res, 200, "Login successful", {
            token,
            seller,
        });
    } catch (error) {
        return handleResponse(res, 500, error.message);
    }
};


/* ===============================
   SELLER FORGOT PASSWORD
================================ */

export const sendSellerResetOtp = async (req, res) => {
    try {
        const { channel, rawValue } = req.body;
        if (!channel || !rawValue) {
            return handleResponse(res, 400, "Channel and target value are required");
        }

        const ipAddress = req.ip || req.connection.remoteAddress;
        const result = await issueSellerResetOtp({ channel, rawValue, ipAddress });
        
        return handleResponse(res, 200, "Reset OTP sent successfully", result);
    } catch (error) {
        return handleResponse(res, error.statusCode || 500, error.message);
    }
};

export const verifySellerResetOtp = async (req, res) => {
    try {
        const { channel, rawValue, otp } = req.body;
        if (!channel || !rawValue || !otp) {
            return handleResponse(res, 400, "Channel, target, and OTP are required");
        }

        const ipAddress = req.ip || req.connection.remoteAddress;
        const result = await verifySellerResetOtpCode({ channel, rawValue, otp, ipAddress });
        
        return handleResponse(res, 200, "OTP verified successfully", result);
    } catch (error) {
        return handleResponse(res, error.statusCode || 500, error.message);
    }
};

export const resetSellerPassword = async (req, res) => {
    try {
        const { channel, rawValue, token, newPassword } = req.body;
        
        if (!newPassword || newPassword.length < 8) {
            return handleResponse(res, 400, "Password must be at least 8 characters long");
        }

        // Verify the token
        verifySellerVerificationToken({ channel, rawValue, token, purpose: "seller_reset" });

        // Find the seller
        const query = channel === "email" ? { email: rawValue.toLowerCase() } : { phone: rawValue };
        const seller = await Seller.findOne(query);

        if (!seller) {
            return handleResponse(res, 404, "Seller not found");
        }

        // Update password (pre-save hook will hash it)
        seller.password = newPassword;
        await seller.save();

        return handleResponse(res, 200, "Password reset successfully");
    } catch (error) {
        return handleResponse(res, error.statusCode || 500, error.message);
    }
};

/* ===============================
   SELLER CHECK EXISTS
================================ */
export const checkSellerExists = async (req, res) => {
    try {
        const { email, phone } = req.body;
        const query = [];
        if (email) query.push({ email: email.toLowerCase() });
        if (phone) query.push({ phone: phone.replace(/\D/g, "") });

        if (query.length === 0) {
            return handleResponse(res, 400, "Email or phone is required");
        }

        const seller = await Seller.findOne({ $or: query }).select("_id").lean();
        
        return handleResponse(res, 200, "Check completed", { exists: !!seller });
    } catch (error) {
        return handleResponse(res, 500, error.message);
    }
};

export const checkSellerApplicationStatus = async (req, res) => {
    try {
        const sellerId = req.user?.id || req.query.sellerId;
        if (!sellerId || !mongoose.Types.ObjectId.isValid(sellerId)) {
            return handleResponse(res, 400, "Valid Seller ID or authorization token is required");
        }

        const seller = await Seller.findById(sellerId).select(
            "name email phone shopName isVerified isActive applicationStatus rejectionReason"
        );

        if (!seller) {
            return handleResponse(res, 404, "Seller not found");
        }

        const applicationStatus =
            seller.applicationStatus || (seller.isVerified ? "approved" : "pending");
        const isApproved =
            seller.isVerified === true &&
            seller.isActive !== false &&
            (applicationStatus === "approved" || seller.isVerified === true);

        const token = generateToken(seller);

        return handleResponse(res, 200, "Application status fetched successfully", {
            isApproved,
            applicationStatus,
            rejectionReason: seller.rejectionReason || "",
            seller,
            token,
        });
    } catch (error) {
        return handleResponse(res, 500, error.message);
    }
};

