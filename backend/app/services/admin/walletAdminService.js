import Transaction from "../../models/transaction.js";
import Notification from "../../models/notification.js";
import { getAdminFinanceSummary } from "../finance/walletService.js";
import { getLedgerEntries } from "../finance/ledgerService.js";
import { emitToDelivery, emitToSeller } from "../orderSocketEmitter.js";

export async function getAdminWalletOverview({ page, limit }) {
  const stats = await getAdminFinanceSummary();
  const ledger = await getLedgerEntries({ page, limit });
  const transactionItems = ledger.items.map((entry) => ({
    id: entry.transactionId || entry.reference || String(entry._id),
    type: entry.type,
    amount:
      entry.direction === "DEBIT"
        ? -Math.abs(entry.amount || 0)
        : Math.abs(entry.amount || 0),
    status: entry.status,
    sender: entry.direction === "DEBIT" ? entry.actorType : "System/Order",
    recipient: entry.direction === "CREDIT" ? entry.actorType : "Platform Wallet",
    date: new Date(entry.createdAt).toLocaleDateString(),
    time: new Date(entry.createdAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
    notes: entry.description || entry.type,
    method: entry.paymentMode || "N/A",
  }));

  return {
    stats: {
      totalPlatformEarning: stats.totalPlatformEarning,
      totalAdminEarning: stats.totalAdminEarning,
      availableBalance: stats.availableBalance,
      sellerPendingPayouts: stats.sellerPendingPayouts,
      deliveryPendingPayouts: stats.deliveryPendingPayouts,
      systemFloat: stats.systemFloatCOD,
    },
    transactions: {
      items: transactionItems,
      page: ledger.page,
      limit: ledger.limit,
      total: ledger.total,
      totalPages: ledger.totalPages,
    },
  };
}

export async function getDeliveryTransactionsData({ page, limit, skip }) {
  const query = { userModel: "Delivery" };
  const transactions = await Transaction.find(query)
    .populate("user", "name phone documents")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const total = await Transaction.countDocuments(query);

  return {
    items: transactions,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 1,
  };
}

export async function getSellerWithdrawalsData({ page, limit, skip }) {
  const query = { userModel: "Seller", type: "Withdrawal" };

  const [transactions, total] = await Promise.all([
    Transaction.find(query)
      .populate("user", "name shopName phone bankDetails")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Transaction.countDocuments(query),
  ]);

  return {
    items: transactions,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 1,
  };
}

export async function getSellerTransactionsData({ page, limit, skip }) {
  const query = { userModel: "Seller" };
  const transactions = await Transaction.find(query)
    .populate("user", "name shopName phone bankDetails")
    .populate({
      path: "order",
      select: "orderId pricing",
      populate: {
        path: "items.product",
        select: "name",
      },
    })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const total = await Transaction.countDocuments(query);

  return {
    items: transactions,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 1,
  };
}

export async function getDeliveryWithdrawalsData({ page, limit, skip }) {
  const query = { userModel: "Delivery", type: "Withdrawal" };

  const [transactions, total] = await Promise.all([
    Transaction.find(query)
      .populate("user", "name phone accountHolder accountNumber ifsc bankDetails")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Transaction.countDocuments(query),
  ]);

  return {
    items: transactions,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 1,
  };
}

export async function updateWithdrawalStatusById({ id, status, reason }) {
  if (!["Settled", "Failed", "Processing"].includes(status)) {
    throw new Error("Invalid status");
  }

  const transaction = await Transaction.findById(id).populate("user", "name");
  if (!transaction) {
    return null;
  }

  transaction.status = status;
  if (reason) {
    transaction.notes = reason;
  }

  await transaction.save();

  // Send notification to user (Driver or Seller)
  if (transaction.user) {
    const userId = transaction.user._id || transaction.user;
    const amount = Math.abs(transaction.amount || 0);
    const isDelivery = transaction.userModel === "Delivery";
    const role = isDelivery ? "delivery" : "seller";
    const recipientModel = isDelivery ? "Delivery" : "Seller";

    let title = "Withdrawal Update";
    let message = `Your withdrawal request of ₹${amount.toLocaleString("en-IN")} status is now ${status}.`;

    if (status === "Settled") {
      title = "Withdrawal Settled ✅";
      message = `Your withdrawal request of ₹${amount.toLocaleString("en-IN")} has been settled successfully to your registered bank account.`;
    } else if (status === "Failed") {
      title = "Withdrawal Request Rejected ❌";
      message = `Your withdrawal request of ₹${amount.toLocaleString("en-IN")} was rejected${reason ? `: ${reason}` : ". The amount has been credited back to your available balance."}`;
    } else if (status === "Processing") {
      title = "Withdrawal Processing ⏳";
      message = `Your withdrawal request of ₹${amount.toLocaleString("en-IN")} is currently being processed.`;
    }

    try {
      const link = isDelivery ? "/delivery/profile/withdrawals" : "/seller/withdrawals";
      const notifDoc = await Notification.create({
        recipient: userId,
        recipientModel,
        userId,
        role,
        title,
        message,
        body: message,
        type: "payment",
        status: "sent",
        channel: "in_app",
        data: {
          transactionId: transaction._id,
          status,
          amount,
          reason: reason || "",
          link,
        },
      });

      const socketPayload = {
        id: notifDoc._id.toString(),
        _id: notifDoc._id.toString(),
        role,
        title,
        body: message,
        message,
        data: notifDoc.data,
        createdAt: notifDoc.createdAt ? notifDoc.createdAt.toISOString() : new Date().toISOString(),
      };

      if (isDelivery) {
        emitToDelivery(userId, { event: "notification:new", payload: socketPayload });
        emitToDelivery(userId, {
          event: "delivery:withdrawal:update",
          payload: {
            transactionId: transaction._id,
            status,
            amount,
            reason: reason || "",
          },
        });
      } else {
        emitToSeller(userId, { event: "notification:new", payload: socketPayload });
      }

      // If push tokens are registered for this user, trigger push notification
      try {
        const PushToken = (await import("../../modules/notifications/token.model.js")).default;
        const activeTokens = await PushToken.find({ userId, isActive: true }).select("token").lean();
        if (activeTokens.length > 0) {
          const { sendFCM } = await import("../../modules/notifications/firebase.service.js");
          await sendFCM(
            activeTokens.map((t) => t.token),
            {
              title,
              body: message,
              message,
              data: {
                transactionId: String(transaction._id),
                status,
                amount: String(amount),
                link,
              },
            },
          );
        }
      } catch (pushErr) {
        // FCM push dispatch error is non-fatal
      }
      if (isDelivery) {
        try {
          const { invalidateDeliveryEarningsCache } = await import("../delivery/deliveryEarningsService.js");
          await invalidateDeliveryEarningsCache(userId);
        } catch (_) {}
      }
    } catch (notifErr) {
      console.error("[updateWithdrawalStatusById] Failed to dispatch notification:", notifErr.message);
    }
  }

  return transaction;
}

export async function settleDeliveryTransactionById(id) {
  const transaction = await Transaction.findByIdAndUpdate(
    id,
    { status: "Settled" },
    { new: true },
  ).populate("user", "name");

  if (!transaction) {
    return null;
  }

  const driverId = transaction.user?._id || transaction.user;
  const amount = Math.abs(transaction.amount || 0);
  const title = "Withdrawal Settled ✅";
  const message = `Your payment of ₹${amount.toLocaleString("en-IN")} has been settled.`;

  try {
    const notifDoc = await Notification.create({
      recipient: driverId,
      recipientModel: "Delivery",
      userId: driverId,
      role: "delivery",
      title,
      message,
      body: message,
      type: "payment",
      status: "sent",
      channel: "in_app",
      data: {
        transactionId: transaction._id,
        status: "Settled",
        amount,
        link: "/delivery/profile/withdrawals",
      },
    });

    const socketPayload = {
      id: notifDoc._id.toString(),
      _id: notifDoc._id.toString(),
      role: "delivery",
      title,
      body: message,
      message,
      data: notifDoc.data,
      createdAt: notifDoc.createdAt ? notifDoc.createdAt.toISOString() : new Date().toISOString(),
    };

    emitToDelivery(driverId, { event: "notification:new", payload: socketPayload });
    emitToDelivery(driverId, {
      event: "delivery:withdrawal:update",
      payload: { transactionId: transaction._id, status: "Settled", amount },
    });

    try {
      const { invalidateDeliveryEarningsCache } = await import("../delivery/deliveryEarningsService.js");
      await invalidateDeliveryEarningsCache(driverId);
    } catch (_) {}
  } catch (err) {
    console.error("[settleDeliveryTransactionById] Notification error:", err.message);
  }

  return transaction;
}

export async function bulkSettleDeliveryTransactions() {
  const pendingTransactions = await Transaction.find({
    userModel: "Delivery",
    status: "Pending",
  }).populate("user", "name");

  const result = await Transaction.updateMany(
    { userModel: "Delivery", status: "Pending" },
    { status: "Settled" },
  );

  for (const transaction of pendingTransactions) {
    if (!transaction.user) continue;
    const driverId = transaction.user._id || transaction.user;
    const amount = Math.abs(transaction.amount || 0);
    const title = "Withdrawal Settled ✅";
    const message = `Your payment of ₹${amount.toLocaleString("en-IN")} has been settled.`;

    try {
      const notifDoc = await Notification.create({
        recipient: driverId,
        recipientModel: "Delivery",
        userId: driverId,
        role: "delivery",
        title,
        message,
        body: message,
        type: "payment",
        status: "sent",
        channel: "in_app",
        data: {
          transactionId: transaction._id,
          status: "Settled",
          amount,
          link: "/delivery/profile/withdrawals",
        },
      });

      const socketPayload = {
        id: notifDoc._id.toString(),
        _id: notifDoc._id.toString(),
        role: "delivery",
        title,
        body: message,
        message,
        data: notifDoc.data,
        createdAt: notifDoc.createdAt ? notifDoc.createdAt.toISOString() : new Date().toISOString(),
      };

      emitToDelivery(driverId, { event: "notification:new", payload: socketPayload });
    } catch (e) {}
  }

  return result;
}

