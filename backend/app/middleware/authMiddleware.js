import jwt from "jsonwebtoken";
import handleResponse from "../utils/helper.js";
import Seller from "../models/seller.js";
import Delivery from "../models/delivery.js";

function extractJwtFromHeaders(req) {
  const authHeader = String(req.headers.authorization || "").trim();
  if (authHeader) {
    const parts = authHeader.split(/\s+/);
    if (parts.length >= 2 && /^bearer$/i.test(parts[0])) {
      return parts[1];
    }

    // Allow raw JWT in Authorization header for non-standard clients.
    // Still requires signature verification so it doesn't weaken auth.
    if (authHeader.split(".").length === 3) {
      return authHeader;
    }
  }

  const xAccessToken = String(req.headers["x-access-token"] || "").trim();
  if (xAccessToken && xAccessToken.split(".").length === 3) {
    return xAccessToken;
  }

  return null;
}

/* ===============================
   Verify Token
================================ */
export const verifyToken = (req, res, next) => {
  try {
    const token = extractJwtFromHeaders(req);

    if (!token) {
      return handleResponse(res, 401, "Unauthorized, token missing");
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = decoded; // { id, role }
    next();
  } catch (error) {
    return handleResponse(res, 401, "Invalid or expired token");
  }
};

/* ===============================
   Optional Verify Token (for public routes that need user context)
================================ */
export const optionalVerifyToken = (req, res, next) => {
  try {
    const token = extractJwtFromHeaders(req);

    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded; // { id, role }
      } catch (error) {
        // Token is invalid, but we don't block the request
        req.user = null;
      }
    }

    next();
  } catch (error) {
    // Don't block the request, just continue without user
    next();
  }
};

/* ===============================
   Role Based Access
================================ */
export const allowRoles = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return handleResponse(res, 403, "Access denied");
    }
    next();
  };
};

/* ===============================
   Ensure seller can access seller-only operational routes
================================ */
export const requireApprovedSeller = async (req, res, next) => {
  try {
    if (req.user?.role !== "seller") {
      return next();
    }

    const seller = await Seller.findById(req.user.id)
      .select("isVerified isActive applicationStatus rejectionReason")
      .lean();

    if (!seller) {
      return handleResponse(res, 401, "Seller account not found");
    }

    const applicationStatus =
      seller.applicationStatus || (seller.isVerified ? "approved" : "pending");
    const isApproved =
      seller.isVerified === true &&
      seller.isActive === true &&
      applicationStatus === "approved";

    if (!isApproved) {
      const message =
        applicationStatus === "rejected"
          ? "Seller application rejected. Please contact admin support."
          : "Seller account is pending admin approval.";

      return handleResponse(res, 403, message, {
        applicationStatus,
        isVerified: seller.isVerified === true,
        isActive: seller.isActive === true,
        rejectionReason: seller.rejectionReason || "",
      });
    }

    next();
  } catch (error) {
    return handleResponse(res, 500, "Unable to validate seller approval status");
  }
};

/* ===============================
   Ensure a rider may take new work (offers, accepts)
================================ */
/**
 * New work needs an approved, active rider who is online. Work already in
 * hand (pickup, delivery OTP, returns) is not gated here, so a rider who is
 * suspended or goes offline mid-delivery can still finish the parcel they hold.
 * `listOffline: true` answers an offline rider's offer list with an empty list
 * instead of an error, because the app polls it.
 */
export const requireAvailableRider = ({ listOffline = false } = {}) => async (req, res, next) => {
  try {
    if (req.user?.role !== "delivery") {
      return next();
    }

    const rider = await Delivery.findById(req.user.id)
      .select("isVerified isActive isOnline")
      .lean();

    if (!rider) {
      return handleResponse(res, 401, "Delivery partner account not found");
    }
    if (rider.isVerified !== true) {
      return handleResponse(res, 403, "Your account is pending admin approval.", {
        code: "RIDER_NOT_APPROVED",
      });
    }
    if (rider.isActive === false) {
      return handleResponse(res, 403, "Your account is suspended. Please contact support.", {
        code: "RIDER_SUSPENDED",
      });
    }
    if (rider.isOnline !== true) {
      if (listOffline) {
        return handleResponse(res, 200, "You are offline. Go online to see new orders.", []);
      }
      return handleResponse(res, 409, "You are offline. Go online to accept orders.", {
        code: "RIDER_OFFLINE",
      });
    }

    next();
  } catch (error) {
    return handleResponse(res, 500, "Unable to validate rider status");
  }
};
