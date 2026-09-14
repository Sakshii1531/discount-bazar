/**
 * DeliveryEarningsService
 *
 * Owns the read-side aggregations for the delivery partner's dashboard:
 *   - getDeliveryStats         ← getDeliveryStats handler
 *   - getDeliveryEarnings      ← getDeliveryEarnings handler
 *   - getDeliveryCodCashSummary ← getDeliveryCodCashSummary handler
 *
 * Framework-agnostic. Inputs are primitives; output shapes match the
 * existing HTTP response payloads byte-for-byte so frontend consumers see
 * no change.
 *
 * Throws errors with `err.statusCode` for the auth-failure cases the COD
 * summary handler used to handle inline.
 */

import mongoose from "mongoose";
import Order from "../../models/order.js";
import Transaction from "../../models/transaction.js";
import Wallet from "../../models/wallet.js";
import { roundCurrency } from "../../utils/money.js";
import { buildKey, getOrSet, getTTL, del } from "../cacheService.js";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function svcErr(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function toDeliveryBoyId(rawId) {
  if (rawId == null) {
    throw svcErr("Unauthorized", 401);
  }
  if (!mongoose.Types.ObjectId.isValid(String(rawId))) {
    throw svcErr("Invalid user id", 401);
  }
  return new mongoose.Types.ObjectId(String(rawId));
}

/**
 * Dashboard summary: total deliveries, today's earnings, incentives, cash in hand.
 * Cached for ~30s (`deliveryStats` TTL) to absorb dashboard polling.
 */
export async function getDeliveryStats(rawId) {
  const deliveryBoyId = toDeliveryBoyId(rawId);
  const cacheKey = buildKey("delivery", "stats", String(deliveryBoyId));
  return getOrSet(
    cacheKey,
    () => computeDeliveryStats(deliveryBoyId),
    getTTL("deliveryStats"),
  );
}

async function computeDeliveryStats(deliveryBoyId) {
  const orders = await Order.find({
    deliveryBoy: deliveryBoyId,
    status: "delivered",
  })
    .select("_id")
    .lean();
  const totalDeliveries = orders.length;

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);

  const allTransactions = await Transaction.find({
    user: deliveryBoyId,
    userModel: "Delivery",
    createdAt: { $gte: startOfYesterday },
  }).lean();

  const isSettledEarning = (t) =>
    t.status === "Settled" &&
    (t.type === "Delivery Earning" ||
      t.type === "Incentive" ||
      t.type === "Bonus");

  const todayEarnings = allTransactions
    .filter(
      (t) => new Date(t.createdAt) >= startOfToday && isSettledEarning(t),
    )
    .reduce((acc, t) => acc + t.amount, 0);

  const yesterdayEarnings = allTransactions
    .filter(
      (t) =>
        new Date(t.createdAt) >= startOfYesterday &&
        new Date(t.createdAt) < startOfToday &&
        isSettledEarning(t),
    )
    .reduce((acc, t) => acc + t.amount, 0);

  const incentives = allTransactions
    .filter(
      (t) =>
        new Date(t.createdAt) >= startOfToday &&
        t.status === "Settled" &&
        (t.type === "Incentive" || t.type === "Bonus"),
    )
    .reduce((acc, t) => acc + t.amount, 0);

  const wallet = await Wallet.findOne({
    ownerType: "DELIVERY_PARTNER",
    ownerId: deliveryBoyId,
  })
    .select("cashInHand")
    .lean();
  const cashCollected = Math.round(wallet?.cashInHand || 0);

  const growth =
    yesterdayEarnings === 0
      ? todayEarnings > 0
        ? 100
        : 0
      : Number((((todayEarnings - yesterdayEarnings) / yesterdayEarnings) * 100).toFixed(1));

  const trend = `${growth > 0 ? "+" : ""}${growth}%`;

  return {
    today: roundCurrency(todayEarnings),
    yesterday: roundCurrency(yesterdayEarnings),
    growth,
    trend,
    deliveries: totalDeliveries,
    incentives: roundCurrency(incentives),
    cashCollected,
  };
}

/**
 * Earnings page payload: totals, 7-day chart, latest 20 transactions.
 * Cached for ~30s (`deliveryEarnings` TTL) to absorb dashboard polling.
 */
export async function getDeliveryEarnings(rawId) {
  const deliveryBoyId = toDeliveryBoyId(rawId);
  const cacheKey = buildKey("delivery", "earnings", String(deliveryBoyId));
  return getOrSet(
    cacheKey,
    () => computeDeliveryEarnings(deliveryBoyId),
    getTTL("deliveryEarnings"),
  );
}

async function computeDeliveryEarnings(deliveryBoyId) {
  const [transactionsDocs, withdrawals] = await Promise.all([
    Transaction.find({
      user: deliveryBoyId,
      userModel: "Delivery",
    })
      .sort({ createdAt: -1 })
      .limit(200)
      .populate("order", "orderId pricing paymentBreakdown")
      .lean(),
    Transaction.find({
      user: deliveryBoyId,
      userModel: "Delivery",
      type: "Withdrawal",
    })
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  const transactions = transactionsDocs || [];

  const wallet = await Wallet.findOne({
    ownerType: "DELIVERY_PARTNER",
    ownerId: deliveryBoyId,
  })
    .select("cashInHand")
    .lean();

  const totalEarnings = transactions
    .filter(
      (t) =>
        t.status === "Settled" &&
        (t.type === "Delivery Earning" ||
          t.type === "Incentive" ||
          t.type === "Bonus"),
    )
    .reduce((acc, t) => acc + t.amount, 0);

  const pendingWithdrawals = transactions
    .filter(
      (t) =>
        t.type === "Withdrawal" &&
        (t.status === "Pending" || t.status === "Processing"),
    )
    .reduce((acc, t) => acc + Math.abs(t.amount), 0);

  const settledWithdrawals = transactions
    .filter((t) => t.type === "Withdrawal" && t.status === "Settled")
    .reduce((acc, t) => acc + Math.abs(t.amount), 0);

  const availableBalance = Math.max(
    0,
    roundCurrency(totalEarnings - settledWithdrawals - pendingWithdrawals),
  );

  const tipsReceived = transactions
    .filter((t) => t.type === "Delivery Earning" && t.status === "Settled")
    .reduce(
      (acc, t) =>
        acc +
        Number(
          t?.meta?.tipAmount ??
            t?.order?.paymentBreakdown?.riderTipAmount ??
            t?.order?.pricing?.tip ??
            0,
        ),
      0,
    );

  const onlinePay = transactions
    .filter((t) => t.type === "Delivery Earning" && t.status === "Settled")
    .reduce((acc, t) => acc + t.amount, 0);

  const incentives = transactions
    .filter(
      (t) =>
        (t.type === "Incentive" || t.type === "Bonus") && t.status === "Settled",
    )
    .reduce((acc, t) => acc + t.amount, 0);

  const cashCollected = Math.round(wallet?.cashInHand || 0);

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const dailyAggregation = await Transaction.aggregate([
    {
      $match: {
        user: deliveryBoyId,
        userModel: "Delivery",
        status: "Settled",
        createdAt: { $gte: sevenDaysAgo },
        type: { $in: ["Delivery Earning", "Incentive", "Bonus"] },
      },
    },
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
        amount: { $sum: "$amount" },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const chartData = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split("T")[0];
    const foundAt = dailyAggregation.find((a) => a._id === dateStr);
    chartData.push({
      name: DAY_NAMES[d.getDay()],
      earnings: foundAt ? foundAt.amount : 0,
      incentives: 0,
    });
  }

  // Ensure all withdrawals are merged into transactions / recentTransactions
  const txWithdrawalIds = new Set(transactions.map((t) => String(t._id)));
  const mergedTransactions = [...transactions];
  for (const w of withdrawals) {
    if (!txWithdrawalIds.has(String(w._id))) {
      mergedTransactions.push(w);
    }
  }
  mergedTransactions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return {
    totalEarnings,
    availableBalance,
    pendingWithdrawals,
    settledWithdrawals,
    onlinePay,
    incentives,
    tipsReceived,
    cashCollected,
    chartData,
    withdrawals,
    transactions: mergedTransactions.slice(0, 100),
    recentTransactions: mergedTransactions.slice(0, 100),
  };
}

/**
 * COD cash summary: system float, cash in hand, per-order toRemit/toCollect.
 * Cached for ~30s (`deliveryCodSummary` TTL).
 */
export async function getDeliveryCodCashSummary(rawId) {
  const deliveryBoyId = toDeliveryBoyId(rawId);
  const cacheKey = buildKey("delivery", "codSummary", String(deliveryBoyId));
  return getOrSet(
    cacheKey,
    () => computeDeliveryCodCashSummary(deliveryBoyId),
    getTTL("deliveryCodSummary"),
  );
}

async function computeDeliveryCodCashSummary(deliveryBoyId) {
  const wallet = await Wallet.findOne({
    ownerType: "DELIVERY_PARTNER",
    ownerId: deliveryBoyId,
  })
    .select("cashInHand")
    .lean();

  const orders = await Order.find({
    deliveryBoy: deliveryBoyId,
    paymentMode: "COD",
    status: { $ne: "cancelled" },
    orderStatus: { $ne: "cancelled" },
  })
    .select(
      "orderId status orderStatus deliveredAt createdAt financeFlags paymentBreakdown pricing",
    )
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();

  const normalized = orders.map((order) => {
    const codMarkedCollected = Boolean(
      order.financeFlags?.codMarkedCollected,
    );
    const gross = roundCurrency(
      order.paymentBreakdown?.grandTotal ?? order.pricing?.total ?? 0,
    );
    const riderCommission = roundCurrency(
      order.paymentBreakdown?.riderPayoutTotal ?? 0,
    );

    const estimatedNet = roundCurrency(Math.max(gross - riderCommission, 0));
    const pendingNet = roundCurrency(
      order.paymentBreakdown?.codPendingAmount ?? 0,
    );
    const contribution = codMarkedCollected ? pendingNet : estimatedNet;

    return {
      orderId: order.orderId,
      status: order.status,
      orderStatus: order.orderStatus,
      deliveredAt: order.deliveredAt || null,
      createdAt: order.createdAt || null,
      codMarkedCollected,
      amountGross: gross,
      riderCommission,
      amountNetExpected: estimatedNet,
      amountNetPending: pendingNet,
      systemFloatContribution: contribution,
    };
  });

  const systemFloatCOD = roundCurrency(
    normalized.reduce(
      (sum, row) => sum + Number(row.systemFloatContribution || 0),
      0,
    ),
  );

  const toRemit = normalized
    .filter(
      (row) => row.codMarkedCollected && Number(row.amountNetPending || 0) > 0,
    )
    .slice(0, 50);

  const toCollect = normalized
    .filter(
      (row) =>
        !row.codMarkedCollected && Number(row.amountNetExpected || 0) > 0,
    )
    .slice(0, 50);

  return {
    systemFloatCOD,
    cashInHand: roundCurrency(wallet?.cashInHand || 0),
    toRemit,
    toCollect,
  };
}

export async function invalidateDeliveryEarningsCache(deliveryBoyId) {
  if (!deliveryBoyId) return;
  const id = deliveryBoyId?._id ? deliveryBoyId._id : deliveryBoyId;
  try {
    const cacheKeyEarnings = buildKey("delivery", "earnings", String(id));
    const cacheKeyStats = buildKey("delivery", "stats", String(id));
    await Promise.allSettled([del(cacheKeyEarnings), del(cacheKeyStats)]);
  } catch (err) {
    // non-blocking
  }
}

export default {
  getDeliveryStats,
  getDeliveryEarnings,
  getDeliveryCodCashSummary,
  invalidateDeliveryEarningsCache,
};
