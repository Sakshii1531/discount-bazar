import Customer from "../models/customer.js";
import Transaction from "../models/transaction.js";
import LedgerEntry from "../models/ledgerEntry.js";
import Order from "../models/order.js";
import jwt from "jsonwebtoken";
import handleResponse from "../utils/helper.js";
import {
    issueCustomerOtp,
    sanitizeCustomer,
    verifyCustomerOtpCode,
} from "../services/otpAuthService.js";
import {
    sendLoginOtpSchema,
    sendSignupOtpSchema,
    validateSchema,
    verifyOtpSchema,
} from "../validation/customerAuthValidation.js";

const generateToken = (customer) =>
    jwt.sign(
        { id: customer._id, role: "customer" },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
    );

/* ===============================
   SIGNUP – Send OTP
================================ */
export const signupCustomer = async (req, res) => {
    try {
        const payload = validateSchema(sendSignupOtpSchema, req.body || {});

        await issueCustomerOtp({
            name: payload.name,
            rawPhone: payload.phone,
            flow: "signup",
            ipAddress: req.ip,
        });

        return handleResponse(res, 200, "If the number is eligible, OTP has been sent");
    } catch (error) {
        return handleResponse(res, error.statusCode || 500, error.message);
    }
};

/* ===============================
   LOGIN – Send OTP
================================ */
export const loginCustomer = async (req, res) => {
    try {
        const payload = validateSchema(sendLoginOtpSchema, req.body || {});

        await issueCustomerOtp({
            rawPhone: payload.phone,
            flow: "login",
            ipAddress: req.ip,
        });

        return handleResponse(res, 200, "If the number is eligible, OTP has been sent");
    } catch (error) {
        return handleResponse(res, error.statusCode || 500, error.message);
    }
};

/* ===============================
   VERIFY OTP – Login / Signup
================================ */
export const verifyCustomerOTP = async (req, res) => {
    try {
        const payload = validateSchema(verifyOtpSchema, req.body || {});
        const customer = await verifyCustomerOtpCode({
            rawPhone: payload.phone,
            otp: payload.otp,
            ipAddress: req.ip,
        });
        const token = generateToken(customer);

        return handleResponse(
            res,
            200,
            "Login successful",
            {
                token,
                customer: sanitizeCustomer(customer),
            }
        );
    } catch (error) {
        return handleResponse(res, error.statusCode || 500, error.message);
    }
};

/* ===============================
   GET PROFILE
================================ */
export const getCustomerProfile = async (req, res) => {
    try {
        const customer = await Customer.findById(req.user.id);
        if (!customer) {
            return handleResponse(res, 404, "Customer not found");
        }
        const obj = customer.toObject ? customer.toObject() : { ...customer };
        if (obj.walletBalance !== undefined && obj.walletBalance !== null) {
            obj.walletBalance = Math.floor(Number(obj.walletBalance || 0));
        }
        return handleResponse(res, 200, "Profile fetched successfully", obj);
    } catch (error) {
        return handleResponse(res, 500, error.message);
    }
};

/* ===============================
   UPDATE PROFILE
================================ */
export const updateCustomerProfile = async (req, res) => {
    try {
        const { name, email, addresses, profileImage, avatar, bio } = req.body;

        const customer = await Customer.findById(req.user.id);
        if (!customer) {
            return handleResponse(res, 404, "Customer not found");
        }

        if (name !== undefined) customer.name = name;
        if (email !== undefined) customer.email = email;
        if (addresses !== undefined) customer.addresses = addresses;
        if (profileImage !== undefined) {
            customer.profileImage = profileImage;
            customer.avatar = profileImage;
        } else if (avatar !== undefined) {
            customer.profileImage = avatar;
            customer.avatar = avatar;
        }
        if (bio !== undefined) customer.bio = bio;

        await customer.save();

        return handleResponse(res, 200, "Profile updated successfully", customer);
    } catch (error) {
        return handleResponse(res, 500, error.message);
    }
};

/* ===============================
   GET WALLET TRANSACTIONS
================================ */
export const getCustomerTransactions = async (req, res) => {
    try {
        const customerId = req.user.id;
        const { page = 1, limit = 50 } = req.query;
        const perPage = Math.min(100, Math.max(1, parseInt(limit, 10)));
        const pageNum = Math.max(1, parseInt(page, 10));

        const [ledgerEntries, legacyTxs, orders] = await Promise.all([
            LedgerEntry.find({ actorType: "CUSTOMER", actorId: customerId })
                .sort({ createdAt: -1 })
                .populate("orderId", "orderId")
                .lean(),
            Transaction.find({ user: customerId, userModel: "User" })
                .sort({ createdAt: -1 })
                .populate("order", "orderId")
                .lean(),
            Order.find({
                customer: customerId,
                $or: [
                    { "items.returnStatus": { $in: ["refund_completed", "requested", "approved"] } },
                    { "payment.method": "wallet" },
                    { walletAmount: { $gt: 0 } },
                ],
            })
                .sort({ createdAt: -1 })
                .lean(),
        ]);

        const combinedList = [];
        const seenKeys = new Set();

        const getDedupeKeys = (orderId, type, amount, ref) => {
            const keys = [];
            if (ref) keys.push(`ref:${String(ref).trim()}`);
            if (orderId && type && amount) {
                keys.push(`ord:${String(orderId).trim()}_${type}_${Math.round(Number(amount))}`);
            }
            return keys;
        };

        const isDuplicate = (keys) => {
            return keys.some((k) => seenKeys.has(k));
        };

        const registerKeys = (keys) => {
            keys.forEach((k) => seenKeys.add(k));
        };

        // 1. Ledger Entries (Canonical)
        for (const l of ledgerEntries) {
            const isCredit = l.direction === "CREDIT";
            let title = isCredit ? "Return Refund" : "Order Payment";
            if (l.type === "ADJUSTMENT") title = isCredit ? "Wallet Credit" : "Wallet Debit";
            if (l.ledgerDescription) title = l.ledgerDescription;

            const orderIdStr = l.orderId?.orderId || "";
            const typeStr = isCredit ? "credit" : "debit";
            const amtNum = Math.round(Math.abs(l.amount || 0));
            const refStr = l.transactionId || l.ledgerReference || String(l._id);

            const keys = getDedupeKeys(orderIdStr, typeStr, amtNum, refStr);
            if (isDuplicate(keys)) continue;
            registerKeys(keys);

            combinedList.push({
                _id: l._id,
                type: typeStr,
                title,
                amount: amtNum,
                date: l.createdAt,
                reference: refStr,
                orderId: orderIdStr,
            });
        }

        // 2. Legacy Transactions
        for (const t of legacyTxs) {
            const isCredit = t.type === "Refund" || t.type === "Wallet Refund" || t.type === "Bonus" || t.type === "Incentive";
            let title = t.type;
            if (t.type === "Refund" || t.type === "Wallet Refund") title = "Return Refund";
            if (t.type === "Wallet Payment" || t.type === "Order Payment") title = "Order Payment";

            const orderIdStr = t.order?.orderId || "";
            const typeStr = isCredit ? "credit" : "debit";
            const amtNum = Math.round(Math.abs(t.amount || 0));
            const refStr = t.reference || String(t._id);

            const keys = getDedupeKeys(orderIdStr, typeStr, amtNum, refStr);
            if (isDuplicate(keys)) continue;
            registerKeys(keys);

            combinedList.push({
                _id: t._id,
                type: typeStr,
                title,
                amount: amtNum,
                date: t.createdAt,
                reference: refStr,
                orderId: orderIdStr,
            });
        }

        // 3. Fallback for Orders with return refunds or wallet payments
        for (const o of orders) {
            const orderIdStr = o.orderId || String(o._id);

            // Return refunds check
            if (Array.isArray(o.items)) {
                for (const item of o.items) {
                    if (item.returnStatus === "refund_completed" || item.returnStatus === "approved") {
                        const refundRef = `REFUND-${o._id}-${item._id || item.name}`;
                        const refundAmt = Math.round(Number(item.price || 0) * Number(item.quantity || 1));
                        const keys = getDedupeKeys(orderIdStr, "credit", refundAmt, refundRef);

                        if (!isDuplicate(keys)) {
                            registerKeys(keys);
                            combinedList.push({
                                _id: `refund-${o._id}-${item._id || Math.random()}`,
                                type: "credit",
                                title: `Return Refund (${item.name || 'Item'})`,
                                amount: refundAmt,
                                date: item.returnedAt || o.updatedAt || o.createdAt,
                                reference: refundRef,
                                orderId: orderIdStr,
                            });
                        }
                    }
                }
            }

            // Wallet order payment check
            const isWalletPay = (o.payment?.method || "").toLowerCase() === "wallet" || Number(o.walletAmount || 0) > 0;
            if (isWalletPay) {
                const paidAmt = Math.round(Number(o.walletAmount || o.pricing?.total || o.payableAmount || 0));
                const walletRef = `WALLET-ORDER-${o._id}`;
                const keys = getDedupeKeys(orderIdStr, "debit", paidAmt, walletRef);

                if (paidAmt > 0 && !isDuplicate(keys)) {
                    registerKeys(keys);
                    combinedList.push({
                        _id: `payment-${o._id}`,
                        type: "debit",
                        title: "Order Payment",
                        amount: paidAmt,
                        date: o.createdAt,
                        reference: walletRef,
                        orderId: orderIdStr,
                    });
                }
            }
        }

        // Sort by date descending
        combinedList.sort((a, b) => new Date(b.date) - new Date(a.date));

        const total = combinedList.length;
        const skip = (pageNum - 1) * perPage;
        const paginatedItems = combinedList.slice(skip, skip + perPage);

        return handleResponse(res, 200, "Transactions fetched", {
            items: paginatedItems,
            total,
            page: pageNum,
            totalPages: Math.ceil(total / perPage) || 1,
        });
    } catch (error) {
        return handleResponse(res, 500, error.message);
    }
};
