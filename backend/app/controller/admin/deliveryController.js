import Delivery from "../../models/delivery.js";
import Order from "../../models/order.js";
import Transaction from "../../models/transaction.js";
import Wallet from "../../models/wallet.js";
import handleResponse from "../../utils/helper.js";
import getPagination from "../../utils/pagination.js";
import {
  emitPendingReviewUpdateToAdmins,
  emitDeliveryApproved,
} from "../../services/orderSocketEmitter.js";

export const getDeliveryPartners = async (req, res) => {
  try {
    const { status, verified, search } = req.query;
    const query = {};

    if (status === "online") {
      query.isOnline = true;
    } else if (status === "offline") {
      query.isOnline = false;
    }

    if (verified === "true") {
      query.isVerified = true;
    } else if (verified === "false") {
      query.isVerified = false;
    }

    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim(), "i");
      query.$or = [
        { name: searchRegex },
        { phone: searchRegex },
        { email: searchRegex },
        { currentArea: searchRegex },
        { address: searchRegex },
      ];
    }

    const { page, limit, skip } = getPagination(req, {
      defaultLimit: 25,
      maxLimit: 200,
    });

    const [deliveryPartners, total] = await Promise.all([
      Delivery.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Delivery.countDocuments(query),
    ]);

    const riderIds = deliveryPartners.map((p) => p._id);

    // 1. Deliveries: Total delivered orders count per rider
    const deliveredStats = await Order.aggregate([
      {
        $match: {
          deliveryBoy: { $in: riderIds },
          status: "delivered",
        },
      },
      {
        $group: {
          _id: "$deliveryBoy",
          count: { $sum: 1 },
        },
      },
    ]);
    const deliveredCountMap = {};
    for (const d of deliveredStats) {
      deliveredCountMap[String(d._id)] = d.count;
    }

    // 2. Earnings:
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    // Today settled earnings from Transaction
    const todayTxStats = await Transaction.aggregate([
      {
        $match: {
          user: { $in: riderIds },
          userModel: "Delivery",
          status: "Settled",
          type: { $in: ["Delivery Earning", "Incentive", "Bonus"] },
          createdAt: { $gte: startOfToday },
        },
      },
      {
        $group: {
          _id: "$user",
          todayEarnings: { $sum: "$amount" },
        },
      },
    ]);
    const todayEarningsMap = {};
    for (const t of todayTxStats) {
      todayEarningsMap[String(t._id)] = t.todayEarnings;
    }

    // Today delivered orders payout fallback
    const todayOrdersStats = await Order.aggregate([
      {
        $match: {
          deliveryBoy: { $in: riderIds },
          status: "delivered",
          updatedAt: { $gte: startOfToday },
        },
      },
      {
        $group: {
          _id: "$deliveryBoy",
          orderEarnings: {
            $sum: {
              $ifNull: [
                "$paymentBreakdown.riderPayoutTotal",
                { $ifNull: ["$pricing.deliveryFee", 0] },
              ],
            },
          },
        },
      },
    ]);
    for (const o of todayOrdersStats) {
      const key = String(o._id);
      todayEarningsMap[key] = Math.max(
        todayEarningsMap[key] || 0,
        o.orderEarnings || 0
      );
    }

    // 3. Wallets / Total settled earnings
    const wallets = await Wallet.find({
      ownerType: "DELIVERY_PARTNER",
      ownerId: { $in: riderIds },
    })
      .select("ownerId availableBalance")
      .lean();
    const walletBalanceMap = {};
    for (const w of wallets) {
      walletBalanceMap[String(w.ownerId)] = w.availableBalance;
    }

    const totalTxStats = await Transaction.aggregate([
      {
        $match: {
          user: { $in: riderIds },
          userModel: "Delivery",
          status: "Settled",
          type: { $in: ["Delivery Earning", "Incentive", "Bonus"] },
        },
      },
      {
        $group: {
          _id: "$user",
          totalEarnings: { $sum: "$amount" },
        },
      },
    ]);
    const allTimeEarningsMap = {};
    for (const t of totalTxStats) {
      allTimeEarningsMap[String(t._id)] = t.totalEarnings;
    }

    const allTimeOrdersStats = await Order.aggregate([
      {
        $match: {
          deliveryBoy: { $in: riderIds },
          status: "delivered",
        },
      },
      {
        $group: {
          _id: "$deliveryBoy",
          orderEarnings: {
            $sum: {
              $ifNull: [
                "$paymentBreakdown.riderPayoutTotal",
                { $ifNull: ["$pricing.deliveryFee", 0] },
              ],
            },
          },
        },
      },
    ]);
    for (const o of allTimeOrdersStats) {
      const key = String(o._id);
      allTimeEarningsMap[key] = Math.max(
        allTimeEarningsMap[key] || 0,
        o.orderEarnings || 0
      );
    }

    // Enrich delivery partner records
    const enrichedDeliveryPartners = deliveryPartners.map((rider) => {
      const idStr = String(rider._id);
      const totalDeliveredOrders = deliveredCountMap[idStr] || 0;
      const todayEarnings = Math.round((todayEarningsMap[idStr] || 0) * 100) / 100;
      const walletBalance =
        walletBalanceMap[idStr] != null
          ? walletBalanceMap[idStr]
          : Math.round((allTimeEarningsMap[idStr] || 0) * 100) / 100;

      let location = rider.currentArea?.trim();
      if (!location) {
        location = rider.address?.trim();
      }
      if (!location && Array.isArray(rider.location?.coordinates)) {
        const [lng, lat] = rider.location.coordinates;
        if ((lng && lng !== 0) || (lat && lat !== 0)) {
          location = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
        }
      }
      if (!location) {
        location = "Unassigned";
      }

      return {
        ...rider,
        totalDeliveredOrders,
        totalOrders: totalDeliveredOrders,
        deliveredOrdersCount: totalDeliveredOrders,
        todayEarnings,
        walletBalance,
        wallet: walletBalance,
        earnings: walletBalance,
        currentArea: location,
        locationName: location,
      };
    });

    return handleResponse(res, 200, "Delivery partners fetched successfully", {
      items: enrichedDeliveryPartners,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    });
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

export const approveDeliveryPartner = async (req, res) => {
  try {
    const { id } = req.params;
    const rider = await Delivery.findByIdAndUpdate(
      id,
      { isVerified: true },
      { new: true },
    );

    if (!rider) {
      return handleResponse(res, 404, "Rider not found");
    }

    try {
      emitDeliveryApproved(id, rider);
    } catch (e) {
      console.error("Failed to emit delivery approved event:", e.message);
    }

    try {
      emitPendingReviewUpdateToAdmins({ type: "delivery", action: "approved", riderId: id });
    } catch (e) {
      console.error("Failed to emit pending update on rider approval:", e.message);
    }

    return handleResponse(res, 200, "Rider approved successfully", rider);
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

export const rejectDeliveryPartner = async (req, res) => {
  try {
    const { id } = req.params;
    const rider = await Delivery.findByIdAndDelete(id);

    if (!rider) {
      return handleResponse(res, 404, "Rider not found");
    }

    try {
      emitPendingReviewUpdateToAdmins({ type: "delivery", action: "rejected", riderId: id });
    } catch (e) {
      console.error("Failed to emit pending update on rider rejection:", e.message);
    }

    return handleResponse(
      res,
      200,
      "Rider application rejected and removed",
    );
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

export const getActiveFleet = async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req, {
      defaultLimit: 25,
      maxLimit: 200,
    });

    const query = {
      deliveryBoy: { $ne: null },
      status: {
        $in: ["confirmed", "packed", "shipped", "out_for_delivery"],
      },
    };

    const [activeOrders, total] = await Promise.all([
      Order.find(query)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("deliveryBoy", "name phone documents vehicleType")
        .populate("seller", "shopName address name")
        .populate("customer", "name phone")
        .lean(),
      Order.countDocuments(query),
    ]);

    const fleetData = activeOrders.map((order) => ({
      id: order.orderId,
      status:
        order.status === "out_for_delivery"
          ? "On the Way"
          : order.status === "packed"
            ? "At Pickup"
            : order.status === "shipped"
              ? "In Transit"
              : "Assigned",
      deliveryBoy: {
        name: order.deliveryBoy?.name || "Unknown",
        phone: order.deliveryBoy?.phone || "N/A",
        id: order.deliveryBoy?._id || "N/A",
        vehicle: order.deliveryBoy?.vehicleType || "N/A",
        image:
          order.deliveryBoy?.documents?.profileImage ||
          "https://via.placeholder.com/200",
      },
      seller: {
        name: order.seller?.shopName || order.seller?.name || "Unknown",
      },
      customer: {
        name: order.customer?.name || "Guest",
        phone: order.customer?.phone || "N/A",
      },
      lastUpdate: order.updatedAt,
    }));

    return handleResponse(res, 200, "Active fleet fetched successfully", {
      items: fleetData,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    });
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

export const updateDeliveryPartner = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      phone,
      email,
      vehicle,
      vehicleType,
      vehicleNum,
      vehicleNumber,
      location,
      currentArea,
      address,
      isOnline,
      isVerified,
    } = req.body;

    const updateData = {};
    if (name) updateData.name = name.trim();
    if (phone) updateData.phone = phone.trim();
    if (email !== undefined) updateData.email = email ? email.trim() : "";

    const vType = vehicleType || vehicle;
    if (vType) {
      const lower = vType.toLowerCase();
      updateData.vehicleType = lower.includes("cycle")
        ? "cycle"
        : lower.includes("scooter")
        ? "scooter"
        : "bike";
    }

    const vNum = vehicleNumber || vehicleNum;
    if (vNum !== undefined) updateData.vehicleNumber = vNum.trim();

    const loc = location || currentArea || address;
    if (loc !== undefined && loc !== null) {
      updateData.currentArea = loc.trim();
      updateData.address = loc.trim();
    }

    if (typeof isOnline === "boolean") updateData.isOnline = isOnline;
    if (typeof isVerified === "boolean") updateData.isVerified = isVerified;

    const rider = await Delivery.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: false }
    );

    if (!rider) {
      return handleResponse(res, 404, "Rider not found");
    }

    return handleResponse(res, 200, "Rider updated successfully", rider);
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

export const createDeliveryPartner = async (req, res) => {
  try {
    const {
      name,
      phone,
      email,
      vehicle,
      vehicleType,
      vehicleNum,
      vehicleNumber,
      location,
      currentArea,
      address,
    } = req.body;

    if (!name || !phone) {
      return handleResponse(res, 400, "Name and phone are required");
    }

    const existing = await Delivery.findOne({ phone: phone.trim() });
    if (existing) {
      return handleResponse(
        res,
        400,
        "A delivery partner with this phone number already exists"
      );
    }

    const vType = vehicleType || vehicle;
    let normalizedVehicle = "bike";
    if (vType) {
      const lower = vType.toLowerCase();
      normalizedVehicle = lower.includes("cycle")
        ? "cycle"
        : lower.includes("scooter")
        ? "scooter"
        : "bike";
    }

    const loc = (location || currentArea || address || "").trim();

    const rider = await Delivery.create({
      name: name.trim(),
      phone: phone.trim(),
      email: email ? email.trim() : undefined,
      vehicleType: normalizedVehicle,
      vehicleNumber: (vehicleNumber || vehicleNum || "").trim(),
      currentArea: loc,
      address: loc,
      isVerified: true,
      isOnline: true,
    });

    return handleResponse(res, 201, "Delivery partner created successfully", rider);
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

