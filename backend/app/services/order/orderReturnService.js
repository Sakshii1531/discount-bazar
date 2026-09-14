/**
 * OrderReturnService
 *
 * Owns the return-flow business logic that previously lived inline inside
 * orderController.js (P2.1 of the refactor plan).
 *
 * Design rules (per `domain-service-extraction` skill):
 *   - Framework-agnostic. No req/res/next imports.
 *   - Inputs are primitives or plain payloads.
 *   - Failures throw Error with `err.statusCode` so controllers can map to HTTP.
 *   - Side-effects (notifications, socket emissions) preserved byte-for-byte
 *     so existing HTTP contracts remain identical.
 *
 * Extracted handlers:
 *   - createReturnRequest      ← requestReturn()
 *   - getReturnDetails         ← getReturnDetails()
 *   - approveReturn            ← approveReturnRequest()
 *   - rejectReturn             ← rejectReturnRequest()
 *   - completeReturnAndRefund  ← completeReturnAndRefund()   (Phase 2 P2-4)
 */

import mongoose from "mongoose";
import Order from "../../models/order.js";
import Setting from "../../models/setting.js";
import User from "../../models/customer.js";
import Seller from "../../models/seller.js";
import OrderOtp from "../../models/orderOtp.js";
import Transaction from "../../models/transaction.js";
import { orderMatchQueryFromRouteParam } from "../../utils/orderLookup.js";
import { computeReturnWindowForOrder } from "../../utils/returnWindow.js";
import { emitNotificationEvent } from "../../modules/notifications/notification.emitter.js";
import { NOTIFICATION_EVENTS } from "../../modules/notifications/notification.constants.js";
import {
  emitReturnBroadcastForCustomer,
  emitToSeller,
} from "../orderSocketEmitter.js";
import * as walletService from "../finance/walletService.js";
import { cancelPendingPayoutForOrder } from "../finance/payoutService.js";
import { LEDGER_TRANSACTION_TYPE, OWNER_TYPE } from "../../constants/finance.js";
import { clearOrderTracking } from "../firebaseService.js";
import logger from "../logger.js";
import { calculateRiderPayout } from "../finance/pricingService.js";
import { distanceMeters } from "../../utils/geoUtils.js";
import { generateReturnDropOtp } from "../deliveryOtpService.js";

import { isReturnEligible } from "../../utils/returnEligibilityHelper.js";

function err(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export class OrderReturnService {
  /**
   * Creates a new return request on a delivered order.
   * Throws: 400 (validation), 404 (order missing).
   */
  static async createReturnRequest(customerId, orderId, payload = {}) {
    const { items, reason, images, reasonDetail, conditionAssurance } = payload;

    if (!Array.isArray(items) || items.length === 0) {
      throw err("Please select at least one item to return.", 400);
    }
    if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
      throw err("Return reason is required.", 400);
    }

    const orderKey = orderMatchQueryFromRouteParam(orderId);
    if (!orderKey) {
      throw err("Order not found", 404);
    }

    const order = await Order.findOne({ ...orderKey, customer: customerId });
    if (!order) {
      throw err("Order not found", 404);
    }

    if (String(order.status || "").toLowerCase() !== "delivered") {
      throw err("Return can only be requested for delivered orders.", 400);
    }

    const now = new Date();
    const deliveredAt = order.deliveredAt || order.updatedAt || order.createdAt;

    const selectedItems = [];
    for (const entry of items) {
      const { itemIndex, itemId, quantity } = entry || {};
      let targetIndex = -1;
      if (typeof itemIndex === "number" && itemIndex >= 0 && itemIndex < order.items.length) {
        targetIndex = itemIndex;
      } else if (itemId) {
        targetIndex = order.items.findIndex((it) => String(it._id || it.id || it.product) === String(itemId));
      }

      if (targetIndex === -1) {
        throw err("Invalid item selection for return.", 400);
      }

      const original = order.items[targetIndex];

      // Validate Return Eligibility based on Order Snapshot
      const eligibility = isReturnEligible(original, deliveredAt, order.status, now);
      if (!eligibility.returnEligible) {
        throw err(`Item '${original.name}' is not eligible for return: ${eligibility.reason}`, 400);
      }

      // Validate allowed return reasons configured by seller (if present)
      const allowedReasons = original.returnPolicy?.returnReasons || [];
      if (allowedReasons.length > 0 && !allowedReasons.includes(reason.trim())) {
        throw err(`Selected return reason is not valid for '${original.name}'`, 400);
      }

      const qty = Number(quantity) || original.quantity;
      if (qty <= 0 || qty > original.quantity) {
        throw err("Invalid quantity for one of the return items.", 400);
      }

      // Update item return state inside order.items snapshot
      order.items[targetIndex].returnStatus = "requested";
      order.items[targetIndex].returnedAt = now;
      order.items[targetIndex].returnReason = reason.trim();
      order.items[targetIndex].returnComments = reasonDetail?.trim() || "";

      selectedItems.push({
        product: original.product,
        name: original.name,
        quantity: qty,
        price: original.price,
        variantSlot: original.variantSlot,
        image: original.image,
        itemIndex: targetIndex,
        status: "requested",
      });
    }

    order.returnStatus = "return_requested";
    order.returnReason = reason.trim();
    order.returnReasonDetail = reasonDetail?.trim() || "";
    order.returnConditionAssurance = Boolean(conditionAssurance);
    order.returnImages = Array.isArray(images) ? images.slice(0, 5) : [];
    order.returnItems = selectedItems;
    order.returnRequestedAt = now;
    order.returnEligibleAt = now;
    order.returnWindowExpiresAt = null;
    order.returnDeadline = null;

    await order.save();

    emitNotificationEvent(NOTIFICATION_EVENTS.RETURN_REQUESTED, {
      orderId: order.orderId,
      customerId: order.customer,
      sellerId: order.seller,
      data: {
        reason: order.returnReason,
        reasonDetail: order.returnReasonDetail,
      },
    });
    const refundAmount = selectedItems.reduce((acc, item) => acc + (Number(item.price) || 0) * (Number(item.quantity) || 0), 0);
    emitToSeller(order.seller?.toString(), {
      event: "return:requested",
      payload: {
        orderId: order.orderId,
        returnStatus: order.returnStatus,
        returnReason: order.returnReason,
        returnReasonDetail: order.returnReasonDetail,
        returnRequestedAt: order.returnRequestedAt,
        returnItems: selectedItems,
        refundAmount,
      },
    });

    return order;
  }

  /**
   * Reads return-flow details for an order, enforcing per-role ACL.
   * Throws: 403 (denied), 404 (order missing).
   */
  static async getReturnDetails(orderId, userId, role) {
    const orderKey = orderMatchQueryFromRouteParam(orderId);
    if (!orderKey) {
      throw err("Order not found", 404);
    }

    const order = await Order.findOne(orderKey)
      .populate("customer", "name phone")
      .populate("seller", "shopName name")
      .populate("returnDeliveryBoy", "name phone");

    if (!order) {
      throw err("Order not found", 404);
    }

    const isOwnerCustomer =
      (role === "customer" || role === "user") &&
      order.customer?._id?.toString() === userId;
    const isOwnerSeller =
      role === "seller" && order.seller?._id?.toString() === userId;
    const isAssignedReturnDelivery =
      role === "delivery" &&
      order.returnDeliveryBoy?._id?.toString() === userId;
    const isAdmin = role === "admin";

    if (
      !isOwnerCustomer &&
      !isOwnerSeller &&
      !isAssignedReturnDelivery &&
      !isAdmin
    ) {
      throw err("Access denied. You are not authorized to view this return.", 403);
    }

    let returnDeliveryCommission = order.returnDeliveryCommission;
    if (
      returnDeliveryCommission === undefined ||
      returnDeliveryCommission === null
    ) {
      try {
        const settings = await Setting.findOne({});
        returnDeliveryCommission = settings?.returnDeliveryCommission ?? 0;
      } catch {
        returnDeliveryCommission = 0;
      }
    }

    let activePickupOtp = null;
    let activeDropOtp = null;

    const otps = await OrderOtp.find({
      orderId: order.orderId,
      consumedAt: null,
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 }).lean();

    otps.forEach((doc) => {
      if (doc.type === "return_pickup" && !activePickupOtp) activePickupOtp = doc.code;
      if (doc.type === "return_drop" && !activeDropOtp) activeDropOtp = doc.code;
    });

    if (!activeDropOtp && ["return_in_transit", "return_drop_pending"].includes(order.returnStatus)) {
      try {
        const generated = await generateReturnDropOtp(order.orderId);
        if (generated?.success) {
          activeDropOtp = generated.otp;
        }
      } catch (e) {
        logger.error("Failed to auto-generate return drop OTP", { error: e.message });
      }
    }

    return {
      orderId: order.orderId,
      status: order.status,
      returnStatus: order.returnStatus,
      returnReason: order.returnReason,
      returnReasonDetail: order.returnReasonDetail,
      returnConditionAssurance: order.returnConditionAssurance,
      returnRejectedReason: order.returnRejectedReason,
      returnRequestedAt: order.returnRequestedAt,
      returnDeadline: order.returnDeadline,
      returnEligibleAt: order.returnEligibleAt,
      returnWindowExpiresAt: order.returnWindowExpiresAt,
      returnImages: Array.isArray(order.returnImages)
        ? [...order.returnImages]
        : [],
      returnItems: Array.isArray(order.returnItems)
        ? order.returnItems.map((it) => (typeof it?.toObject === 'function' ? it.toObject() : it))
        : [],
      returnRefundAmount: order.returnRefundAmount,
      returnDeliveryCommission,
      returnDeliveryBoy: order.returnDeliveryBoy || null,
      returnQcStatus: order.returnQcStatus,
      returnQcAt: order.returnQcAt,
      returnQcNote: order.returnQcNote,
      returnPickupOtp: activePickupOtp,
      returnDropOtp: activeDropOtp,
    };
  }

  /**
   * Approves a pending return request. Triggers the return-pickup broadcast
   * to nearby delivery partners.
   * Throws: 400 (invalid state), 403 (denied), 404 (order missing).
   */
  static async approveReturn(orderId, userId, role) {
    const orderKey = orderMatchQueryFromRouteParam(orderId);
    if (!orderKey) {
      throw err("Order not found", 404);
    }

    const order = await Order.findOne(orderKey);
    if (!order) {
      throw err("Order not found", 404);
    }

    const sellerIdStr = (order.seller?._id || order.seller)?.toString();
    const isOwnerSeller =
      role === "seller" && sellerIdStr === String(userId);
    const isAdmin = role === "admin";

    if (!isOwnerSeller && !isAdmin) {
      throw err(
        "Access denied. You are not authorized to approve this return.",
        403,
      );
    }

    if (order.returnStatus !== "return_requested") {
      throw err("Only pending return requests can be approved.", 400);
    }

    if (!Array.isArray(order.returnItems) || order.returnItems.length === 0) {
      throw err("No return items found for this order.", 400);
    }

    const refundAmount = order.returnItems.reduce(
      (sum, item) => sum + (item.price || 0) * (item.quantity || 0),
      0,
    );

    const settings = await Setting.findOne({}).lean();
    const returnCommission = Number(settings?.returnDeliveryCommission ?? 0);

    order.returnItems = order.returnItems.map((item) => ({
      ...(item.toObject?.() ?? item),
      status: "approved",
    }));
    order.returnRefundAmount = refundAmount;
    order.returnDeliveryCommission = returnCommission;

    order.returnStatus = "return_approved";
    order.returnDeliveryBoy = null;
    order.skippedBy = [];

    await order.save();

    emitNotificationEvent(NOTIFICATION_EVENTS.RETURN_APPROVED, {
      orderId: order.orderId,
      customerId: order.customer,
      userId: order.customer,
      sellerId: order.seller,
      data: {
        refundAmount,
      },
    });

    let sellerInfo = null;
    try {
      sellerInfo = await Seller.findById(order.seller)
        .select("shopName address phone")
        .lean();
    } catch {
      sellerInfo = null;
    }

    let customerInfo = null;
    try {
      customerInfo = await User.findById(order.customer)
        .select("name phone")
        .lean();
    } catch {
      customerInfo = null;
    }

    const broadcastPayload = {
      orderId: order.orderId,
      type: "RETURN_PICKUP",
      commission: returnCommission,
      preview: {
        pickup: order.address?.address || "Customer Address",
        pickupPhone: order.address?.phone || customerInfo?.phone || "",
        customerName: order.address?.name || customerInfo?.name || "Customer",
        drop: sellerInfo?.shopName || "Seller Store",
        dropAddress: sellerInfo?.address || "",
        total: order.pricing?.total || 0,
        returnReason: order.returnReason || "",
        returnItems: Array.isArray(order.returnItems)
          ? order.returnItems.map((i) => ({
            name: i.name || "",
            quantity: i.quantity || 1,
            price: i.price || 0,
            image: i.image || "",
          }))
          : [],
      },
      deliverySearchExpiresAt: new Date(Date.now() + 60 * 1000).toISOString(),
    };

    const customerLocation = order.address?.location;
    emitReturnBroadcastForCustomer(customerLocation, broadcastPayload);
    emitNotificationEvent(NOTIFICATION_EVENTS.RETURN_PICKUP_ASSIGNED, {
      orderId: order.orderId,
      sellerId: order.seller,
      customerId: order.customer,
      data: { commission: returnCommission },
    });

    return order;
  }

  /**
   * Rejects a pending return request with a reason.
   * Throws: 400 (invalid state / missing reason), 403 (denied), 404 (order).
   */
  static async rejectReturn(orderId, userId, role, reason) {
    if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
      throw err("Rejection reason is required.", 400);
    }

    const orderKey = orderMatchQueryFromRouteParam(orderId);
    if (!orderKey) {
      throw err("Order not found", 404);
    }

    const order = await Order.findOne(orderKey);
    if (!order) {
      throw err("Order not found", 404);
    }

    const sellerIdStr = (order.seller?._id || order.seller)?.toString();
    const isOwnerSeller =
      role === "seller" && sellerIdStr === String(userId);
    const isAdmin = role === "admin";

    if (!isOwnerSeller && !isAdmin) {
      throw err(
        "Access denied. You are not authorized to reject this return.",
        403,
      );
    }

    if (order.returnStatus !== "return_requested") {
      throw err("Only pending return requests can be rejected.", 400);
    }

    order.returnStatus = "return_rejected";
    order.returnRejectedReason = reason.trim();

    await order.save();

    emitNotificationEvent(NOTIFICATION_EVENTS.RETURN_REJECTED, {
      orderId: order.orderId,
      customerId: order.customer,
      userId: order.customer,
      sellerId: order.seller,
      data: {
        reason: order.returnRejectedReason,
      },
    });

    return order;
  }

  /**
   * Phase 2 P2-4 — atomic refund flow.
   *
   * Wraps the entire return-refund money flow (customer wallet credit,
   * seller adjustment, return-pickup rider credit, order state transition)
   * inside a single Mongo transaction so we cannot end up with a customer
   * who has been credited but a seller who hasn't been debited.
   *
   * Every wallet movement passes `session` AND `ledgerType` AND an
   * `idempotencyKey` so that a queue retry produces no duplicates.
   *
   * Side-effect emission (push notifications) happens AFTER the
   * transaction commits — that way a rollback never produces a phantom
   * "Refund received" notification.
   *
   * Contract preservation: same input (Order document), same return value
   * (the order, mutated to `returnStatus = "refund_completed"`).
   */
  static async completeReturnAndRefund(orderInput, { correlationId = null } = {}) {
    if (!orderInput) return null;

    // Re-fetch by id inside the transaction so the read concern is
    // consistent with the writes we are about to do. The caller might
    // hand us a stale document.
    const orderId = orderInput._id || orderInput.id;
    if (!orderId) return orderInput;

    let savedOrder = null;
    const notificationBag = { skip: true };
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(
        async () => {
          const order = await Order.findById(orderId).session(session);
          if (!order) return;

          if (order.returnStatus === "refund_completed") {
            savedOrder = order;
            return;
          }
          if (order.returnStatus !== "qc_passed") {
            savedOrder = order;
            return;
          }

          const refundAmount =
            order.returnRefundAmount ||
            (Array.isArray(order.returnItems)
              ? order.returnItems.reduce(
                  (sum, item) => sum + (item.price || 0) * (item.quantity || 0),
                  0,
                )
              : 0);
          const commission = order.returnDeliveryCommission || 0;
          const walletRefundTotal = refundAmount;

          // 1. Credit customer wallet (full refund, even for COD).
          //
          // Phase 4 P4-3b: the `User.walletBalance` dual-write is now
          // owned by walletService — passing `syncUserWalletBalance: true`
          // (the default) means the legacy mirror is updated inside the
          // same Mongo session. We no longer touch the User doc here.
          if (order.customer && walletRefundTotal > 0) {
            const refundRounded = Number(walletRefundTotal.toFixed(2));

            await walletService.creditWallet({
              ownerType: OWNER_TYPE.CUSTOMER,
              ownerId: order.customer,
              amount: refundRounded,
              bucket: "available",
              session,
              ledgerType: LEDGER_TRANSACTION_TYPE.WALLET_REFUND,
              ledgerReference: `REF-WALLET-${order.orderId}`,
              ledgerDescription: "Return refund credited to customer wallet",
              orderId: order._id,
              idempotencyKey: `RET-CUST-REFUND-${order._id}`,
              correlationId,
              metadata: { source: "return_qc_passed" },
            });

            await Transaction.create(
              [
                {
                  user: order.customer,
                  userModel: "User",
                  order: order._id,
                  type: "Refund",
                  amount: refundRounded,
                  status: "Settled",
                  reference: `REF-WALLET-${order.orderId}`,
                  meta: { orderId: order._id, type: "return_wallet" },
                },
              ],
              { session },
            );
          }

          // 2. Seller adjustment (cancel payout if on hold, else debit available balance).
          // Note: Seller is ONLY debited for returned product refund. Admin / Platform bears the return delivery commission.
          if (order.seller && refundAmount > 0) {
            const isHeld =
              order.settlementStatus?.sellerPayout === "HOLD" ||
              order.financeFlags?.sellerPayoutHeld;

            if (isHeld) {
              try {
                const cancelled = await cancelPendingPayoutForOrder(
                  order._id,
                  "SELLER",
                  {
                    remarks: "Payout cancelled due to return QC passed.",
                    session,
                  },
                );

                if (cancelled) {
                  await Order.updateOne(
                    { _id: order._id },
                    {
                      $set: {
                        "settlementStatus.sellerPayout": "CANCELLED",
                        "financeFlags.sellerPayoutHeld": false,
                      },
                    },
                    { session },
                  );
                }
              } catch (error) {
                // Inside withTransaction(): bubble up so the txn aborts.
                logger.error("Payout cancellation failed for seller", {
                  scope: "ReturnFinance",
                  sellerId: order.seller,
                  error: error.message,
                });
                throw error;
              }
            } else {
              const adjustment = Math.max(0, refundAmount);
              if (adjustment > 0) {
                try {
                  await walletService.debitWallet({
                    ownerType: OWNER_TYPE.SELLER,
                    ownerId: order.seller,
                    amount: adjustment,
                    bucket: "available",
                    session,
                    ledgerType: LEDGER_TRANSACTION_TYPE.REFUND,
                    ledgerReference: `REF-SELL-${order.orderId}`,
                    ledgerDescription:
                      "Seller wallet debited to recover returned product refund",
                    orderId: order._id,
                    idempotencyKey: `RET-SELL-DEBIT-${order._id}`,
                    correlationId,
                    metadata: { refundAmount },
                  });
                } catch (error) {
                  // Insufficient balance is a legitimate business
                  // failure — must abort the whole refund flow so the
                  // customer is not silently over-credited.
                  logger.error("Wallet debit failed for seller", {
                    scope: "ReturnFinance",
                    sellerId: order.seller,
                    error: error.message,
                  });
                  throw error;
                }
              }
            }

            const adjustment = Math.max(0, refundAmount);
            await Transaction.create(
              [
                {
                  user: order.seller,
                  userModel: "Seller",
                  order: order._id,
                  type: "Refund",
                  amount: -adjustment,
                  status: "Settled",
                  reference: `REF-SELL-${order.orderId}`,
                },
              ],
              { session },
            );
          }

          // 3. Delivery partner earning for return pickup (idempotent
          //    guard: only credit if not already paid at OTP time).
          const commissionAlreadyPaid =
            order.financeFlags?.returnPickupCommissionPaid;
          if (
            order.returnDeliveryBoy &&
            commission > 0 &&
            !commissionAlreadyPaid
          ) {
            try {
              await walletService.creditWallet({
                ownerType: OWNER_TYPE.DELIVERY_PARTNER,
                ownerId: order.returnDeliveryBoy,
                amount: commission,
                bucket: "available",
                session,
                ledgerType: LEDGER_TRANSACTION_TYPE.RIDER_PAYOUT_PROCESSED,
                ledgerReference: `RET-DEL-${order.orderId}`,
                ledgerDescription:
                  "Return-pickup commission credited to delivery partner",
                orderId: order._id,
                idempotencyKey: `RET-DEL-CREDIT-${order._id}`,
                correlationId,
                metadata: { source: "return_qc_passed" },
              });
            } catch (error) {
              logger.error("Failed to credit delivery boy", {
                scope: "ReturnFinance",
                deliveryBoyId: order.returnDeliveryBoy,
                error: error.message,
              });
              throw error;
            }

            await Transaction.create(
              [
                {
                  user: order.returnDeliveryBoy,
                  userModel: "Delivery",
                  order: order._id,
                  type: "Delivery Earning",
                  amount: commission,
                  status: "Settled",
                  reference: `RET-DEL-${order.orderId}`,
                },
              ],
              { session },
            );
          }

          order.returnStatus = "refund_completed";
          if (order.payment) {
            order.payment.status = "refunded";
          }
          await order.save({ session });

          savedOrder = order;
          notificationBag.skip = false;
          notificationBag.payload = {
            orderId: order.orderId,
            customerId: order.customer,
            userId: order.customer,
            sellerId: order.seller,
            deliveryId: order.returnDeliveryBoy,
            data: {
              refundAmount,
              returnDeliveryCommission: commission,
              isCOD: order.paymentMode === "COD",
            },
          };
        },
        {
          // Strict consistency for a money flow.
          readConcern: { level: "snapshot" },
          writeConcern: { w: "majority" },
        },
      );
    } finally {
      session.endSession();
    }

    // Emit notifications only AFTER the transaction has committed so a
    // rollback cannot leak a "Refund received" push notification.
    if (!notificationBag.skip && notificationBag.payload) {
      emitNotificationEvent(
        NOTIFICATION_EVENTS.REFUND_COMPLETED,
        notificationBag.payload,
      );
    }

    // Return finished — drop realtime tracking nodes for this order so the
    // customer's old "live tracking" view doesn't keep a stale rider pinned.
    // Fire-and-forget; never blocks the refund response.
    const canonicalOrderId = savedOrder?.orderId || orderInput?.orderId;
    if (canonicalOrderId) {
      clearOrderTracking(canonicalOrderId).catch(() => {});
    }

    return savedOrder || orderInput;
  }
}

export default OrderReturnService;
