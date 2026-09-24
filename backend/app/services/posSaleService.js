import mongoose from "mongoose";
import Product from "../models/product.js";
import Order from "../models/order.js";
import Seller from "../models/seller.js";
import User from "../models/customer.js";
import Category from "../models/category.js";
import Setting from "../models/setting.js";
import { WORKFLOW_STATUS, legacyStatusFromWorkflow } from "../constants/orderWorkflow.js";
import { CURRENCY } from "../constants/finance.js";
import { reserveStockForItems } from "./stockService.js";
import { freezeFinancialSnapshot } from "./finance/orderFinanceService.js";
import { calculateCategoryCommission } from "./finance/pricingService.js";
import { computeOrderDiscount, incrementCouponUsage } from "./finance/couponService.js";
import { generateUniquePublicOrderId } from "./orderIdService.js";
import {
  checkIdempotency,
  acquireIdempotencyLock,
  storeIdempotencyResult,
  storeIdempotencyError,
  releaseIdempotencyLock,
  isRetryableError,
  validateIdempotencyKey,
} from "./idempotencyService.js";
import { emitNewOrderToSeller, emitProductStockUpdate } from "./orderSocketEmitter.js";
import { emitNotificationEvent } from "../modules/notifications/notification.emitter.js";
import { NOTIFICATION_EVENTS } from "../modules/notifications/notification.constants.js";
import { isLowStockAlertsEnabled } from "./lowStockAlertService.js";
import { roundCurrency } from "../utils/money.js";
import { assertDayOpen } from "./businessTime.js";
import PosCustomer from "../models/posCustomer.js";
import PartyLedgerEntry from "../models/partyLedgerEntry.js";
import { resolvePosPayment } from "./posPayment.js";

const IDEMPOTENCY_RECORD_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Deterministic, unique, E164-shaped identifier for a seller's POS
 * walk-in placeholder User. `User.phone` is required+unique and runs
 * through normalizePhoneNumber (strips everything but digits/`+`), so we
 * turn the seller's ObjectId into a big decimal number rather than
 * embedding letters that normalization would strip and collide.
 */
function buildWalkInPhone(sellerId) {
  return `+${BigInt(`0x${String(sellerId)}`).toString()}`;
}

/**
 * `Order.customer` is hard-required (see order.js pre('save') guard) and
 * every existing `.populate("customer", ...)` call expects a real User.
 * Rather than relaxing that guard, each seller gets one lazily-created
 * placeholder User that all of their POS orders point `customer` at. The
 * real walk-in identity (if given) lives in `Order.walkInCustomer`.
 */
async function resolveWalkInCustomer({ sellerId, session }) {
  const seller = await Seller.findById(sellerId)
    .select("posWalkInCustomerId shopName")
    .session(session);

  if (seller?.posWalkInCustomerId) {
    return seller.posWalkInCustomerId;
  }

  const phone = buildWalkInPhone(sellerId);
  let user = await User.findOne({ phone }).session(session);
  if (!user) {
    const created = await User.create(
      [
        {
          name: `Walk-in customer (${seller?.shopName || "Store"})`,
          phone,
          role: "user",
          isVerified: true,
          isActive: true,
          isWalkInPlaceholder: true,
        },
      ],
      { session },
    );
    user = created[0];
  }

  await Seller.updateOne(
    { _id: sellerId },
    { $set: { posWalkInCustomerId: user._id } },
    { session },
  );

  return user._id;
}

function buildItemsForPersistence(items) {
  return items.map((item) => ({
    product: item.productId,
    name: item.productName,
    quantity: item.quantity,
    price: item.price,
    variantSlot: item.variantSku || undefined,
    image: item.image || "",
    costPrice: item.costPrice,
    gstPercent: item.gstPercent,
    returnPolicy: { isReturnable: false, returnWindowDays: 0, returnReasons: [] },
    returnStatus: "none",
  }));
}

/**
 * Admin-configurable (Settings.posCommissionEnabled / posCouponsEnabled,
 * both default false — see settingsController.js). Product decision: POS
 * sales bypass platform commission and admin coupons by default (seller
 * keeps 100%, no coupon input). When an admin turns a toggle on, POS sales
 * apply the same per-category admin commission engine
 * (pricingService.calculateCategoryCommission) / the same coupon engine
 * (couponService.computeOrderDiscount) used by regular checkout.
 */
async function getPosSettings(session) {
  const settings = await Setting.findOne({
    $or: [{ tenantId: null }, { tenantId: { $exists: false } }],
  })
    .sort({ updatedAt: -1 })
    .select("posCommissionEnabled posCouponsEnabled")
    .session(session)
    .lean();

  return {
    commissionEnabled: settings?.posCommissionEnabled === true,
    couponsEnabled: settings?.posCouponsEnabled === true,
  };
}

async function loadCategoryCommissionMap({ items, session }) {
  const headerIds = Array.from(
    new Set(items.map((item) => item.headerCategoryId).filter(Boolean)),
  );
  if (headerIds.length === 0) return new Map();

  const categories = await Category.find({ _id: { $in: headerIds } })
    .select("_id name adminCommission adminCommissionType adminCommissionValue adminCommissionFixedRule")
    .session(session)
    .lean();

  return new Map(categories.map((category) => [String(category._id), category]));
}

function buildPosBreakdown({
  items,
  posPaymentMethod,
  commissionEnabled,
  categoryById,
  discountTotal = 0,
}) {
  let productSubtotal = 0;
  let sellerPayoutTotal = 0;
  let adminProductCommissionTotal = 0;

  const lineItems = items.map((item) => {
    const itemSubtotal = roundCurrency(item.price * item.quantity);
    let sellerPayout = itemSubtotal;
    let adminCommission = 0;

    if (commissionEnabled) {
      const category = categoryById.get(String(item.headerCategoryId));
      const commission = calculateCategoryCommission(item, category);
      sellerPayout = commission.sellerPayout;
      adminCommission = commission.adminCommission;
    }

    productSubtotal = roundCurrency(productSubtotal + itemSubtotal);
    sellerPayoutTotal = roundCurrency(sellerPayoutTotal + sellerPayout);
    adminProductCommissionTotal = roundCurrency(adminProductCommissionTotal + adminCommission);

    return {
      product: item.productId,
      quantity: item.quantity,
      price: item.price,
      subtotal: itemSubtotal,
    };
  });

  // Coupon discount (when Settings.posCouponsEnabled is on) reduces what the
  // walk-in customer pays and what the seller is paid out — the platform
  // does not absorb it (mirrors regular checkout's per-seller discount split).
  const normalizedDiscount = Math.min(roundCurrency(discountTotal || 0), productSubtotal);
  const grandTotal = roundCurrency(productSubtotal - normalizedDiscount);
  sellerPayoutTotal = roundCurrency(Math.max(sellerPayoutTotal - normalizedDiscount, 0));

  return {
    currency: CURRENCY,
    productSubtotal,
    deliveryFeeCharged: 0,
    handlingFeeCharged: 0,
    tipTotal: 0,
    discountTotal: normalizedDiscount,
    taxTotal: 0,
    grandTotal,
    sellerPayoutTotal,
    adminProductCommissionTotal,
    riderPayoutBase: 0,
    riderPayoutDistance: 0,
    riderPayoutBonus: 0,
    riderTipAmount: 0,
    riderPayoutTotal: 0,
    platformLogisticsMargin: 0,
    platformTotalEarning: adminProductCommissionTotal,
    codCollectedAmount: posPaymentMethod === "CASH" ? grandTotal : 0,
    codRemittedAmount: 0,
    codPendingAmount: 0,
    walletAmount: 0,
    lineItems,
  };
}

/** Loads the seller's own products for the till lines (name/cost/GST/category snapshots). */
async function hydratePosItems({ sellerId, payloadItems, session = null }) {
  const productIds = payloadItems.map((item) => item.productId);
  const query = Product.find({ _id: { $in: productIds }, sellerId })
    .select("_id name mainImage sellerId headerId purchaseCost gstPercent variants.sku variants.purchaseCost");
  if (session) query.session(session);
  const products = await query.lean();
  const productMap = new Map(products.map((p) => [String(p._id), p]));

  return payloadItems.map((item) => {
    const product = productMap.get(String(item.productId));
    if (!product) {
      const err = new Error("One or more items do not belong to your catalog");
      err.statusCode = 404;
      throw err;
    }
    return {
      productId: item.productId,
      productName: product.name,
      quantity: item.quantity,
      price: item.price,
      variantSku: item.variantSku || "",
      image: product.mainImage || "",
      costPrice: Number(
        (item.variantSku && (product.variants || []).find((v) => v.sku === item.variantSku)?.purchaseCost) ||
          product.purchaseCost ||
          0,
      ),
      gstPercent: Number(product.gstPercent || 0),
      headerCategoryId: product.headerId ? String(product.headerId) : "",
    };
  });
}

/**
 * Read-only totals for the checkout screen: subtotal, coupon discount (same
 * engine and rules as the real sale), manual discount and amount due.
 */
export async function previewPosSale({ sellerId, payload }) {
  const items = await hydratePosItems({ sellerId, payloadItems: payload.items });
  const subtotal = roundCurrency(items.reduce((s, i) => s + i.price * i.quantity, 0));

  const couponCode = String(payload.couponCode || "").trim();
  let couponDiscount = 0;
  if (couponCode) {
    const posSettings = await getPosSettings(null);
    if (!posSettings.couponsEnabled) {
      const err = new Error("Coupons are not enabled for POS sales");
      err.statusCode = 403;
      throw err;
    }
    const seller = await Seller.findById(sellerId).select("posWalkInCustomerId").lean();
    const result = await computeOrderDiscount({
      couponCode,
      customerId: seller?.posWalkInCustomerId || undefined,
      hydratedItems: items,
    });
    couponDiscount = roundCurrency(result?.discountAmount || 0);
  }

  const discountTotal = Math.min(roundCurrency(couponDiscount + Number(payload.discount || 0)), subtotal);
  return {
    subtotal,
    couponDiscount,
    discountTotal,
    grandTotal: roundCurrency(subtotal - discountTotal),
  };
}

/**
 * Creates a single-seller, single-order POS (walk-in counter) sale.
 * Deliberately a thin sibling of orderPlacementService.placeOrderAtomic —
 * same transaction + idempotency + atomic stock-reservation shape, but
 * skips Cart/CheckoutGroup (POS is always one seller, one order) and the
 * delivery/handling/rider pricing pipeline entirely (not applicable to a
 * walk-in counter sale). Admin commission and coupon codes are applied
 * only when the admin has turned on Settings.posCommissionEnabled /
 * Settings.posCouponsEnabled respectively (see buildPosBreakdown and the
 * couponService.computeOrderDiscount call below).
 */
export async function createPosSale({ sellerId, payload, idempotencyKey }) {
  if (!validateIdempotencyKey(idempotencyKey)) {
    const error = new Error(
      "Idempotency-Key header is required (32-64 alphanumeric/hyphen characters)",
    );
    error.statusCode = 400;
    throw error;
  }

  const idempotencyCheck = await checkIdempotency(idempotencyKey, payload);
  if (idempotencyCheck.exists && !idempotencyCheck.checksumMismatch) {
    if (idempotencyCheck.result.status === "error") {
      const error = new Error(idempotencyCheck.result.error.message);
      error.statusCode = idempotencyCheck.result.error.statusCode || 500;
      throw error;
    }
    return { ...idempotencyCheck.result.data, duplicate: true };
  }
  if (idempotencyCheck.checksumMismatch) {
    const error = new Error("Idempotency key reused with different payload");
    error.statusCode = 422;
    throw error;
  }
  if (idempotencyCheck.inProgress) {
    const error = new Error("Request is being processed");
    error.statusCode = 409;
    throw error;
  }

  // Checked before taking the idempotency lock: a closed day must not leave
  // the key locked (retries would otherwise get 409 until the lock expires).
  await assertDayOpen(sellerId);

  const lockAcquired = await acquireIdempotencyLock(idempotencyKey);
  if (!lockAcquired) {
    const error = new Error("Request is being processed");
    error.statusCode = 409;
    throw error;
  }

  const session = await mongoose.startSession();
  try {
    session.startTransaction({
      readConcern: { level: "snapshot" },
      writeConcern: { w: "majority" },
      maxCommitTimeMS: parseInt(process.env.CHECKOUT_TRANSACTION_TIMEOUT_MS || "20000", 10),
    });

    const items = await hydratePosItems({ sellerId, payloadItems: payload.items, session });

    const isCredit = payload.posPaymentMethod === "CREDIT";
    let posCustomer = null;
    if (payload.posCustomerId) {
      posCustomer = await PosCustomer.findOne({ _id: payload.posCustomerId, seller: sellerId }).session(session);
      if (!posCustomer) {
        const err = new Error("Customer not found");
        err.statusCode = 404;
        throw err;
      }
    }
    if (isCredit && !posCustomer) {
      const err = new Error("Select a customer for credit (udhaar) sales");
      err.statusCode = 400;
      throw err;
    }

    const walkInCustomerId = await resolveWalkInCustomer({ sellerId, session });
    const orderId = await generateUniquePublicOrderId({ session });

    const { lowStockAlerts, stockUpdates } = await reserveStockForItems({
      items,
      sellerId,
      orderId,
      session,
      paymentMode: "COD",
    });

    const posSettings = await getPosSettings(session);
    const categoryById = posSettings.commissionEnabled
      ? await loadCategoryCommissionMap({ items, session })
      : new Map();

    const couponCode = String(payload.couponCode || "").trim();
    if (couponCode && !posSettings.couponsEnabled) {
      const err = new Error("Coupons are not enabled for POS sales");
      err.statusCode = 403;
      throw err;
    }

    let discountResult = null;
    if (couponCode && posSettings.couponsEnabled) {
      discountResult = await computeOrderDiscount({
        couponCode,
        customerId: walkInCustomerId,
        hydratedItems: items,
        session,
      });
    }

    const breakdown = buildPosBreakdown({
      items,
      posPaymentMethod: payload.posPaymentMethod,
      commissionEnabled: posSettings.commissionEnabled,
      categoryById,
      discountTotal: (discountResult?.discountAmount || 0) + Number(payload.discount || 0),
    });

    const grandTotal = breakdown.grandTotal;
    const pay = resolvePosPayment({
      method: payload.posPaymentMethod,
      grandTotal,
      amountPaid: payload.amountPaid,
      payments: payload.posPayments,
      cashTendered: payload.cashTendered,
    });
    const upFront = pay.posAmountPaid;
    breakdown.codCollectedAmount = pay.codCollectedAmount;

    const now = new Date();
    const order = new Order({
      orderId,
      customer: walkInCustomerId,
      seller: sellerId,
      items: buildItemsForPersistence(items),
      orderSource: "POS",
      posPaymentMethod: payload.posPaymentMethod,
      posCustomer: posCustomer?._id,
      posAmountPaid: upFront,
      posPayments: pay.posPayments,
      posCashTendered: pay.posCashTendered,
      walkInCustomer: payload.walkInCustomer || undefined,
      coupon: discountResult?.coupon?._id || null,
      ...(discountResult?.couponSnapshot ? { couponSnapshot: discountResult.couponSnapshot } : {}),
      paymentMode: "COD",
      paymentStatus: pay.paymentStatus,
      payment: pay.payment,
      status: legacyStatusFromWorkflow(WORKFLOW_STATUS.DELIVERED),
      orderStatus: legacyStatusFromWorkflow(WORKFLOW_STATUS.DELIVERED),
      workflowStatus: WORKFLOW_STATUS.DELIVERED,
      workflowVersion: 2,
      deliveredAt: now,
      acceptedAt: now,
      stockReservation: {
        status: "COMMITTED",
        reservedAt: now,
        expiresAt: null,
        releasedAt: null,
      },
      settlementStatus: {
        overall: "COMPLETED",
        sellerPayout: "COMPLETED",
        riderPayout: "NOT_APPLICABLE",
        adminEarningCredited: false,
        reconciledAt: now,
      },
      placement: {
        idempotencyKey,
        idempotencyKeyExpiry: new Date(Date.now() + IDEMPOTENCY_RECORD_TTL_MS),
        createdFrom: "DIRECT_ITEMS",
      },
    });

    freezeFinancialSnapshot(order, breakdown);
    await order.save({ session });

    if (isCredit) {
      const base = { seller: sellerId, partyType: "CUSTOMER", party: posCustomer._id, refModel: "Order", refId: order._id, refNo: order.orderId, date: now };
      await PartyLedgerEntry.create(
        [
          { ...base, kind: "SALE", effect: 1, amount: grandTotal, note: "Credit sale" },
          ...(upFront > 0
            ? [{ ...base, kind: "PAYMENT", effect: -1, amount: upFront, method: "CASH", note: "Paid at billing" }]
            : []),
        ],
        { session, ordered: true },
      );
    }

    if (discountResult?.coupon?._id) {
      await incrementCouponUsage({ couponId: discountResult.coupon._id, session });
    }

    await session.commitTransaction();

    const resultPayload = { order: order.toObject() };
    await storeIdempotencyResult(idempotencyKey, resultPayload, payload);

    // Post-commit, fire-and-forget — same pattern as placeOrderAtomic.
    emitNewOrderToSeller(sellerId, {
      orderId: order.orderId,
      orderSource: "POS",
      workflowStatus: WORKFLOW_STATUS.DELIVERED,
      paymentBreakdown: order.paymentBreakdown,
    });

    stockUpdates.forEach((update) => emitProductStockUpdate(update));

    if (lowStockAlerts.length > 0 && (await isLowStockAlertsEnabled())) {
      lowStockAlerts.forEach((alertPayload) => {
        emitNotificationEvent(NOTIFICATION_EVENTS.LOW_STOCK_ALERT, alertPayload);
      });
    }

    return { ...resultPayload, duplicate: false };
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    if (isRetryableError(error)) {
      await releaseIdempotencyLock(idempotencyKey);
    } else {
      await storeIdempotencyError(idempotencyKey, error, payload);
    }

    throw error;
  } finally {
    session.endSession();
  }
}

export default { createPosSale, previewPosSale };
