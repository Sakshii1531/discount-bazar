import mongoose from "mongoose";
import OrderCancellation from "../../models/orderCancellation.js";
import Order from "../../models/order.js";
import {
  CANCELLATION_STATUS,
  REFUND_STATUS,
  cancellationReasonLabel,
} from "../../constants/cancellation.js";
import { escapeRegex } from "../../utils/regex.js";
import { cancellationView } from "./orderCancellationService.js";
import { serviceError } from "./cancellationRecordHelpers.js";

function dateRange(from, to) {
  const range = {};
  if (from) {
    const d = new Date(from);
    if (!Number.isNaN(d.getTime())) range.$gte = d;
  }
  if (to) {
    const d = new Date(to);
    if (!Number.isNaN(d.getTime())) {
      // Inclusive end-of-day for date-only inputs.
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(to))) d.setHours(23, 59, 59, 999);
      range.$lte = d;
    }
  }
  return Object.keys(range).length ? range : null;
}

function buildFilter(query = {}) {
  const filter = {};
  const list = (v) => String(v || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (query.status) filter.status = { $in: list(query.status) };
  if (query.type) filter.type = { $in: list(query.type) };
  if (query.refundStatus) filter["refund.status"] = { $in: list(query.refundStatus) };
  if (query.inventoryStatus) filter["inventory.status"] = { $in: list(query.inventoryStatus) };
  if (query.reasonCode) filter.reasonCode = { $in: list(query.reasonCode) };
  if (query.processingState) filter["processing.state"] = { $in: list(query.processingState) };
  if (query.q) filter.orderId = new RegExp(escapeRegex(String(query.q).trim()), "i");
  const range = dateRange(query.from, query.to);
  if (range) filter.createdAt = range;
  return filter;
}

export async function listCancellationsForAdmin(query = {}, { page = 1, limit = 25 } = {}) {
  const filter = buildFilter(query);
  const skip = (page - 1) * limit;
  const [rows, total] = await Promise.all([
    OrderCancellation.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .select("-auditLog -notifications")
      .populate("customer", "name phone")
      .populate("seller", "shopName")
      .populate("deliveryBoy", "name phone")
      .lean(),
    OrderCancellation.countDocuments(filter),
  ]);
  const orders = await Order.find({ _id: { $in: rows.map((r) => r.order) } })
    .select("status workflowStatus paymentMode paymentStatus")
    .lean();
  const byId = new Map(orders.map((o) => [String(o._id), o]));
  return {
    items: rows.map((r) => ({
      ...cancellationView(r, { role: "admin" }),
      order: byId.get(String(r.order)) || null,
    })),
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 1,
  };
}

export async function getCancellationForAdmin(recordId) {
  if (!mongoose.Types.ObjectId.isValid(String(recordId))) throw serviceError("Cancellation not found", 404);
  const record = await OrderCancellation.findById(recordId)
    .populate("customer", "name phone email")
    .populate("seller", "shopName phone address")
    .populate("deliveryBoy", "name phone")
    .populate("decidedBy", "name email")
    .lean();
  if (!record) throw serviceError("Cancellation not found", 404);
  const order = await Order.findById(record.order)
    .select("orderId status workflowStatus paymentMode paymentStatus pricing paymentBreakdown items address createdAt deliveredAt pickupConfirmedAt cancelledAt settlementStatus financeFlags")
    .lean();
  return { ...cancellationView(record, { role: "admin" }), order };
}

/** Admin reports: volumes, reasons, refund pipeline and adjustments. */
export async function getCancellationReports({ from, to } = {}) {
  const match = {};
  const range = dateRange(from, to);
  if (range) match.createdAt = range;

  const [byStatus, byType, byReason, refunds, adjustments, daily] = await Promise.all([
    OrderCancellation.aggregate([{ $match: match }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
    OrderCancellation.aggregate([{ $match: match }, { $group: { _id: "$type", count: { $sum: 1 } } }]),
    OrderCancellation.aggregate([
      { $match: { ...match, status: { $nin: [CANCELLATION_STATUS.WITHDRAWN] } } },
      { $group: { _id: "$reasonCode", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    OrderCancellation.aggregate([
      { $match: match },
      { $group: { _id: "$refund.status", count: { $sum: 1 }, amount: { $sum: "$refund.amount" } } },
    ]),
    OrderCancellation.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          sellerAdjusted: { $sum: "$settlement.seller.amount" },
          riderAdjusted: { $sum: "$settlement.rider.amount" },
          codAdjusted: { $sum: "$settlement.cod.amount" },
          sellerManualReview: { $sum: { $cond: [{ $eq: ["$settlement.seller.status", "MANUAL_REVIEW"] }, 1, 0] } },
          codManualReview: { $sum: { $cond: [{ $eq: ["$settlement.cod.status", "MANUAL_REVIEW"] }, 1, 0] } },
        },
      },
    ]),
    OrderCancellation.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "Asia/Kolkata" } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      { $limit: 90 },
    ]),
  ]);

  const toMap = (rows) => Object.fromEntries(rows.map((r) => [r._id || "UNKNOWN", r.count]));
  const refundMap = Object.fromEntries(
    refunds.map((r) => [r._id || "UNKNOWN", { count: r.count, amount: Math.round((r.amount || 0) * 100) / 100 }]),
  );
  const pendingStatuses = [REFUND_STATUS.PENDING, REFUND_STATUS.PROCESSING, REFUND_STATUS.FAILED, REFUND_STATUS.MANUAL_REVIEW];

  return {
    total: byStatus.reduce((s, r) => s + r.count, 0),
    byStatus: toMap(byStatus),
    byType: toMap(byType),
    byReason: byReason.map((r) => ({ code: r._id, label: cancellationReasonLabel(r._id), count: r.count })),
    refunds: refundMap,
    pendingRefunds: pendingStatuses.reduce(
      (acc, s) => ({
        count: acc.count + (refundMap[s]?.count || 0),
        amount: Math.round((acc.amount + (refundMap[s]?.amount || 0)) * 100) / 100,
      }),
      { count: 0, amount: 0 },
    ),
    adjustments: adjustments[0]
      ? {
        sellerAdjusted: adjustments[0].sellerAdjusted,
        riderAdjusted: adjustments[0].riderAdjusted,
        codAdjusted: adjustments[0].codAdjusted,
        sellerManualReview: adjustments[0].sellerManualReview,
        codManualReview: adjustments[0].codManualReview,
      }
      : { sellerAdjusted: 0, riderAdjusted: 0, codAdjusted: 0, sellerManualReview: 0, codManualReview: 0 },
    daily: daily.map((d) => ({ date: d._id, count: d.count })),
    openRequests: (toMap(byStatus)[CANCELLATION_STATUS.REQUESTED] || 0) + (toMap(byStatus)[CANCELLATION_STATUS.UNDER_REVIEW] || 0),
  };
}
