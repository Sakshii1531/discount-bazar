import mongoose from "mongoose";
import Delivery from "../models/delivery.js";
import Admin from "../models/admin.js";
import jwt from "jsonwebtoken";
import handleResponse from "../utils/helper.js";
import { sendSmsIndiaHubOtp } from "../services/smsIndiaHubService.js";
import { generateOTP, useRealSMS } from "../utils/otp.js";
import { uploadToCloudinary } from "../services/mediaService.js";
import { clearRiderPresence } from "../services/firebaseService.js";
import { emitNotificationEvent } from "../modules/notifications/notification.service.js";
import { NOTIFICATION_EVENTS } from "../modules/notifications/notification.constants.js";
import { emitPendingReviewUpdateToAdmins } from "../services/orderSocketEmitter.js";
import { updateDeliveryPartnerAggregates } from "../services/deliveryRatingService.js";
import { countRiderActiveOrders } from "../services/delivery/riderActiveOrdersService.js";

const RIDER_OTP_MAX_FAILED_ATTEMPTS = () =>
    parseInt(process.env.OTP_MAX_FAILED_ATTEMPTS || "5", 10);
const RIDER_OTP_LOCKOUT_MINUTES = () =>
    parseInt(process.env.OTP_LOCKOUT_MINUTES || "15", 10);

const generateToken = (delivery) =>
    jwt.sign(
        { id: delivery._id, role: "delivery" },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
    );

/* ===============================
   SIGNUP – Send OTP
================================ */
export const signupDelivery = async (req, res) => {
    try {
        const {
            name, phone, vehicleType,
            email, address, currentArea, vehicleNumber,
            drivingLicenseNumber,
            accountHolder, accountNumber, ifsc,
            dob, bloodGroup
        } = req.body;

        if (!name || !phone) {
            return handleResponse(res, 400, "Name and phone are required");
        }

        let delivery = await Delivery.findOne({ phone });

        if (delivery && delivery.isVerified) {
            return handleResponse(res, 400, "Delivery partner already exists");
        }

        let otp = generateOTP();

        let aadharUrl = delivery?.documents?.aadhar || "";
        let panUrl = delivery?.documents?.pan || "";
        let dlUrl = delivery?.documents?.drivingLicense || "";
        let profileImageUrl = delivery?.profileImage || "";

        // Handle File Uploads via Multer
        if (req.files && Array.isArray(req.files)) {
            for (const file of req.files) {
                if (file.fieldname === "profileImage") {
                    profileImageUrl = await uploadToCloudinary(file.buffer, "delivery/profiles");
                } else if (file.fieldname === "aadhar") {
                    aadharUrl = await uploadToCloudinary(file.buffer, "delivery/documents");
                } else if (file.fieldname === "pan") {
                    panUrl = await uploadToCloudinary(file.buffer, "delivery/documents");
                } else if (file.fieldname === "dl") {
                    dlUrl = await uploadToCloudinary(file.buffer, "delivery/documents");
                }
            }
        }

        const normalizedAadhar = String(req.body?.aadharUrl || req.body?.aadhar || "").trim();
        const normalizedPan = String(req.body?.panUrl || req.body?.pan || "").trim();
        const normalizedDl = String(
          req.body?.drivingLicenseUrl || req.body?.dlUrl || req.body?.dl || "",
        ).trim();
        const normalizedProfileImage = String(req.body?.profileImageUrl || req.body?.profileImage || "").trim();

        if (/^https?:\/\//i.test(normalizedAadhar)) aadharUrl = normalizedAadhar;
        if (/^https?:\/\//i.test(normalizedPan)) panUrl = normalizedPan;
        if (/^https?:\/\//i.test(normalizedDl)) dlUrl = normalizedDl;
        if (/^https?:\/\//i.test(normalizedProfileImage)) profileImageUrl = normalizedProfileImage;

        const deliveryData = {
            name,
            phone,
            vehicleType,
            email,
            address,
            currentArea,
            vehicleNumber,
            drivingLicenseNumber,
            accountHolder,
            accountNumber,
            ifsc,
            dob,
            bloodGroup,
            profileImage: profileImageUrl,
            documents: {
                aadhar: aadharUrl,
                pan: panUrl,
                drivingLicense: dlUrl,
            },
            otp,
            otpExpiry: Date.now() + 5 * 60 * 1000,
        };

        if (!delivery) {
            delivery = await Delivery.create(deliveryData);
        } else {
            Object.assign(delivery, deliveryData);
            await delivery.save();
        }

        if (useRealSMS()) {
            try {
                await sendSmsIndiaHubOtp({ phone, otp });
            } catch (smsError) {
                console.error("[sms] Delivery SMS dispatch failed:", smsError.message);
                if (process.env.NODE_ENV === "production") {
                    throw smsError;
                }
            }
        }

        return handleResponse(res, 200, "OTP sent successfully");
    } catch (error) {
        return handleResponse(res, 500, error.message);
    }
};

/* ===============================
   LOGIN – Send OTP
================================ */
export const loginDelivery = async (req, res) => {
    try {
        const { phone } = req.body;

        if (!phone) {
            return handleResponse(res, 400, "Phone number is required");
        }

        const delivery = await Delivery.findOne({ phone });

        if (!delivery) {
            return handleResponse(res, 404, "Delivery partner not found");
        }
        if (!delivery.isVerified) {
            // Anyone can type a phone number here: never return the rider's record.
            return handleResponse(res, 403, "Your application is still pending admin approval", {
                pendingApproval: true,
                deliveryId: delivery._id,
            });
        }

        let otp = generateOTP();

        delivery.otp = otp;
        delivery.otpExpiry = Date.now() + 5 * 60 * 1000;
        await delivery.save();

        if (useRealSMS()) {
            try {
                await sendSmsIndiaHubOtp({ phone, otp });
            } catch (smsError) {
                console.error("[sms] Delivery SMS dispatch failed:", smsError.message);
                if (process.env.NODE_ENV === "production") {
                    throw smsError;
                }
            }
        }

        return handleResponse(res, 200, "OTP sent successfully");
    } catch (error) {
        console.error("loginDelivery Error:", error);
        return handleResponse(res, 500, error.message, { stack: error.stack });
    }
};

/* ===============================
   VERIFY OTP
================================ */
export const verifyDeliveryOTP = async (req, res) => {
    try {
        const { phone, otp } = req.body;

        // Strings only: an object such as { "$ne": null } would otherwise act as
        // a query operator and match any rider with an unexpired code.
        if (!phone || !otp || typeof phone !== "string" || !["string", "number"].includes(typeof otp)) {
            return handleResponse(res, 400, "Phone and OTP are required");
        }

        const delivery = await Delivery.findOne({ phone: phone.trim() }).select(
            "+otp +otpExpiry +otpFailedAttempts +otpLockedUntil",
        );
        if (!delivery) {
            return handleResponse(res, 400, "Invalid or expired OTP");
        }

        const now = Date.now();
        if (delivery.otpLockedUntil && delivery.otpLockedUntil.getTime() > now) {
            return handleResponse(res, 423, "Too many failed attempts. Please try again later.");
        }

        const codeMatches =
            Boolean(delivery.otp) &&
            delivery.otpExpiry &&
            delivery.otpExpiry.getTime() > now &&
            delivery.otp === String(otp).trim();

        if (!codeMatches) {
            // Atomic count, so parallel guesses cannot slip past the limit.
            const counted = await Delivery.findOneAndUpdate(
                { _id: delivery._id },
                { $inc: { otpFailedAttempts: 1 } },
                { new: true },
            ).select("+otpFailedAttempts");
            if ((counted?.otpFailedAttempts || 0) >= RIDER_OTP_MAX_FAILED_ATTEMPTS()) {
                // Lock, and burn the code so it cannot be guessed after the lock.
                await Delivery.updateOne(
                    { _id: delivery._id },
                    {
                        $set: {
                            otpLockedUntil: new Date(now + RIDER_OTP_LOCKOUT_MINUTES() * 60 * 1000),
                            otpFailedAttempts: 0,
                        },
                        $unset: { otp: 1, otpExpiry: 1 },
                    },
                );
                return handleResponse(res, 423, "Too many failed attempts. Please try again later.");
            }
            return handleResponse(res, 400, "Invalid or expired OTP");
        }

        delivery.otpFailedAttempts = 0;
        delivery.otpLockedUntil = undefined;

        if (!delivery.isVerified) {
            // New signup OTP verification
            delivery.otp = undefined;
            delivery.otpExpiry = undefined;
            await delivery.save();

            try {
                const admins = await Admin.find().select("_id").lean();
                const adminIds = (admins || []).map((a) => a?._id).filter(Boolean);
                emitNotificationEvent(NOTIFICATION_EVENTS.NEW_DELIVERY_REGISTRATION, {
                    deliveryId: delivery._id,
                    name: delivery.name,
                    phone: delivery.phone,
                    adminIds,
                });
                emitPendingReviewUpdateToAdmins({ type: "delivery", deliveryId: delivery._id });
            } catch (notifErr) {
                console.error("Failed to notify admins of new delivery registration:", notifErr.message);
            }

            const token = generateToken(delivery);

            return handleResponse(res, 200, "Phone verified successfully", {
                pendingApproval: true,
                deliveryId: delivery._id,
                delivery,
                token,
            });
        }

        delivery.isOnline = true; // Auto-activate delivery boy on login
        delivery.otp = undefined;
        delivery.otpExpiry = undefined;
        delivery.lastLogin = new Date();

        await delivery.save();

        const token = generateToken(delivery);

        return handleResponse(res, 200, "Login successful", {
            token,
            delivery,
        });
    } catch (error) {
        return handleResponse(res, 500, error.message);
    }
};

/* ===============================
   GET PROFILE
================================ */
export const getDeliveryProfile = async (req, res) => {
    try {
        if (req.user?.id) {
            await updateDeliveryPartnerAggregates(req.user.id).catch(() => {});
        }
        const delivery = await Delivery.findById(req.user.id);
        if (!delivery) {
            return handleResponse(res, 404, "Delivery partner not found");
        }
        return handleResponse(res, 200, "Profile fetched successfully", delivery);
    } catch (error) {
        return handleResponse(res, 500, error.message);
    }
};

/* ===============================
   UPDATE PROFILE
================================ */
export const updateDeliveryProfile = async (req, res) => {
    try {
        const { name, vehicleType, vehicleNumber, drivingLicenseNumber, currentArea, isOnline, profileImage, email, address, dob, bloodGroup, accountHolder, accountNumber, ifsc } = req.body;

        const delivery = await Delivery.findById(req.user.id);
        if (!delivery) {
            return handleResponse(res, 404, "Delivery partner not found");
        }

        if (name !== undefined) delivery.name = name;
        if (vehicleType !== undefined) delivery.vehicleType = vehicleType;
        if (vehicleNumber !== undefined) delivery.vehicleNumber = vehicleNumber;
        if (drivingLicenseNumber !== undefined) delivery.drivingLicenseNumber = drivingLicenseNumber;
        if (currentArea !== undefined) delivery.currentArea = currentArea;
        if (profileImage !== undefined) delivery.profileImage = profileImage;
        if (email !== undefined) delivery.email = email;
        if (address !== undefined) delivery.address = address;
        if (dob !== undefined) delivery.dob = dob;
        if (bloodGroup !== undefined) delivery.bloodGroup = bloodGroup;
        if (accountHolder !== undefined) delivery.accountHolder = accountHolder;
        if (accountNumber !== undefined) delivery.accountNumber = accountNumber;
        if (ifsc !== undefined) delivery.ifsc = ifsc;

        // Capture going-offline transition before the save so we know whether
        // to drop the rider's realtime presence nodes after the write.
        const wasOnline = delivery.isOnline === true;
        const willGoOffline =
            typeof isOnline !== 'undefined' && isOnline === false && wasOnline;
        if (typeof isOnline !== 'undefined') delivery.isOnline = isOnline;

        await delivery.save();

        // Fire-and-forget — never blocks the HTTP response. A failed cleanup
        // is also safe: the scheduled sweep job will pick it up on TTL.
        if (willGoOffline) {
            // Offline stops new offers only. Parcels already accepted stay
            // assigned, and live tracking for them must keep running.
            const activeOrders = await countRiderActiveOrders(delivery._id);
            if (activeOrders > 0) {
                const result = delivery.toJSON();
                result.activeOrders = activeOrders;
                return handleResponse(
                    res,
                    200,
                    `You are offline for new orders. Finish your ${activeOrders} active ${activeOrders === 1 ? "delivery" : "deliveries"}; they stay assigned to you.`,
                    result,
                );
            }
            clearRiderPresence(String(delivery._id)).catch(() => {});
        }

        return handleResponse(res, 200, "Profile updated successfully", delivery);
    } catch (error) {
        return handleResponse(res, 500, error.message);
    }
};

export const checkDeliveryApplicationStatus = async (req, res) => {
    try {
        // A token is issued only to the signed-in rider asking about their own
        // account. A lookup by phone or id is public and returns approval only.
        const self = req.user?.role === "delivery" ? req.user.id : null;
        const deliveryId = self || req.query.deliveryId;
        const phone = req.query.phone;

        let query = null;
        if (deliveryId && mongoose.Types.ObjectId.isValid(deliveryId)) {
            query = { _id: deliveryId };
        } else if (phone) {
            query = { phone: phone.replace(/\D/g, "") };
        } else if (deliveryId) {
            query = { phone: String(deliveryId).replace(/\D/g, "") };
        } else {
            return handleResponse(res, 400, "Delivery ID, phone, or auth token is required");
        }

        const delivery = await Delivery.findOne(query).select(
            "name phone email vehicleType isVerified isOnline"
        );

        if (!delivery) {
            return handleResponse(res, 404, "Delivery partner not found");
        }

        const isApproved = delivery.isVerified === true;
        if (!self || String(delivery._id) !== String(self)) {
            return handleResponse(res, 200, "Application status fetched successfully", { isApproved });
        }

        return handleResponse(res, 200, "Application status fetched successfully", {
            isApproved,
            delivery,
            token: generateToken(delivery),
        });
    } catch (error) {
        return handleResponse(res, 500, error.message);
    }
};

