/**
 * RazorpayAdapter
 *
 * Implements PaymentProviderPort for Razorpay Standard Checkout & Webhooks.
 * Encapsulates all Razorpay SDK calls and HMAC-SHA256 signature verification.
 * Works seamlessly with both Test mode (rzp_test_...) and Live mode (rzp_live_...)
 * driven entirely by environment variables.
 */

import crypto from "crypto";
import Razorpay from "razorpay";

import { PAYMENT_STATUS, PAYMENT_GATEWAY } from "../../../constants/payment.js";
import { PaymentProviderPort } from "../ports/paymentProviderPort.js";

let _razorpayClient = null;

function buildRazorpayClient() {
  const keyId = String(process.env.RAZORPAY_KEY_ID || "").trim();
  const keySecret = String(process.env.RAZORPAY_KEY_SECRET || "").trim();

  if (!keyId || !keySecret) {
    throw new Error("Razorpay credentials not configured");
  }

  return new Razorpay({
    key_id: keyId,
    key_secret: keySecret,
  });
}

function getRazorpayClient() {
  if (_razorpayClient) return _razorpayClient;
  _razorpayClient = buildRazorpayClient();
  return _razorpayClient;
}

export class RazorpayAdapter extends PaymentProviderPort {
  get providerName() {
    return PAYMENT_GATEWAY.RAZORPAY;
  }

  /**
   * Creates an order with Razorpay.
   * Server-calculated payable amount in paise is used.
   *
   * @param {Object} params
   * @param {string} params.merchantOrderId - Discount Bazar tracking order ID (e.g. CHK-XXXX-A1)
   * @param {number} params.amountPaise - Amount in paise
   * @param {string} [params.currency] - Currency (default: "INR")
   * @returns {Promise<Object>}
   */
  async initiatePayment({ merchantOrderId, amountPaise, currency = "INR" }) {
    const client = getRazorpayClient();
    const keyId = String(process.env.RAZORPAY_KEY_ID || "").trim();

    // Razorpay receipt max length is 40 characters
    const receipt = String(merchantOrderId || "").slice(-40);

    const options = {
      amount: Math.round(amountPaise),
      currency: String(currency || "INR").toUpperCase(),
      receipt,
      notes: {
        merchantOrderId: String(merchantOrderId || ""),
      },
    };

    const razorpayOrder = await client.orders.create(options);

    return {
      merchantOrderId,
      gatewayOrderId: razorpayOrder.id, // e.g. "order_xxxx"
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      keyId,
      gatewayResponse: razorpayOrder,
    };
  }

  /**
   * Fetches status of an order or payment from Razorpay API.
   *
   * @param {Object} params
   * @param {string} [params.gatewayOrderId] - Razorpay order id (order_xxxx)
   * @param {string} [params.gatewayPaymentId] - Razorpay payment id (pay_xxxx)
   * @returns {Promise<Object>}
   */
  async getPaymentStatus({ gatewayOrderId, gatewayPaymentId }) {
    const client = getRazorpayClient();

    if (gatewayPaymentId) {
      const payment = await client.payments.fetch(gatewayPaymentId);
      return {
        state: payment.status,
        transactionId: payment.id,
        responseCode: payment.status,
        gatewayResponse: payment,
      };
    }

    if (gatewayOrderId) {
      const order = await client.orders.fetch(gatewayOrderId);
      return {
        state: order.status,
        transactionId: null,
        responseCode: order.status,
        gatewayResponse: order,
      };
    }

    throw new Error("gatewayOrderId or gatewayPaymentId is required to fetch Razorpay status");
  }

  /**
   * Validates Razorpay client payment signature:
   * HMAC-SHA256(razorpay_order_id + "|" + razorpay_payment_id, keySecret) === razorpay_signature
   *
   * @param {Object} params
   * @param {string} params.razorpayOrderId
   * @param {string} params.razorpayPaymentId
   * @param {string} params.razorpaySignature
   * @returns {boolean}
   */
  validatePaymentSignature({ razorpayOrderId, razorpayPaymentId, razorpaySignature }) {
    const keySecret = String(process.env.RAZORPAY_KEY_SECRET || "").trim();
    if (!keySecret) {
      throw new Error("Razorpay key secret not configured");
    }

    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      return false;
    }

    const payload = `${razorpayOrderId}|${razorpayPaymentId}`;
    const expectedSignature = crypto
      .createHmac("sha256", keySecret)
      .update(payload)
      .digest("hex");

    const bufExpected = Buffer.from(expectedSignature, "utf8");
    const bufActual = Buffer.from(String(razorpaySignature).trim(), "utf8");

    if (bufExpected.length !== bufActual.length) {
      return false;
    }

    return crypto.timingSafeEqual(bufExpected, bufActual);
  }

  /**
   * Validates Razorpay S2S webhook signature against raw request body:
   * HMAC-SHA256(rawBody, webhookSecret) === x-razorpay-signature
   *
   * @param {Object} params
   * @param {Buffer|string} params.rawBody - Raw request body
   * @param {string} params.signature - Value of x-razorpay-signature header
   * @returns {boolean}
   */
  async validateWebhook({ rawBody, authorization, signature }) {
    const webhookSecret = String(process.env.RAZORPAY_WEBHOOK_SECRET || "").trim();
    if (!webhookSecret) {
      throw new Error("Razorpay webhook secret not configured");
    }

    const expectedSignatureHeader = String(signature || authorization || "").trim();
    if (!expectedSignatureHeader || !rawBody) {
      return false;
    }

    const bodyBuffer = Buffer.isBuffer(rawBody)
      ? rawBody
      : Buffer.from(String(rawBody), "utf8");

    const calculatedSignature = crypto
      .createHmac("sha256", webhookSecret)
      .update(bodyBuffer)
      .digest("hex");

    const bufCalculated = Buffer.from(calculatedSignature, "utf8");
    const bufExpected = Buffer.from(expectedSignatureHeader, "utf8");

    if (bufCalculated.length !== bufExpected.length) {
      return false;
    }

    return crypto.timingSafeEqual(bufCalculated, bufExpected);
  }

  /**
   * Decodes webhook payload from raw body after signature validation.
   *
   * @param {Object} params
   * @param {Buffer|string} params.rawBody
   * @param {string} [params.eventIdHeader] - Optional x-razorpay-event-id header
   * @returns {Promise<Object>}
   */
  async decodeWebhookPayload({ rawBody, eventIdHeader = null }) {
    let jsonPayload;
    try {
      jsonPayload = JSON.parse(
        Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody),
      );
    } catch {
      const err = new Error("Invalid format: Webhook body must be valid JSON");
      err.statusCode = 400;
      throw err;
    }

    const event = jsonPayload.event || "unknown";
    const paymentEntity = jsonPayload.payload?.payment?.entity || {};
    const orderEntity = jsonPayload.payload?.order?.entity || {};

    const merchantOrderId =
      paymentEntity.notes?.merchantOrderId ||
      orderEntity.notes?.merchantOrderId ||
      orderEntity.receipt ||
      null;

    const razorpayOrderId = paymentEntity.order_id || orderEntity.id || null;
    const razorpayPaymentId = paymentEntity.id || null;

    // Deduplication eventId: use Razorpay's header/event ID if available, else derive stable hash
    const eventId =
      eventIdHeader ||
      jsonPayload.event_id ||
      (paymentEntity.id
        ? `${event}_${paymentEntity.id}`
        : crypto
            .createHash("sha256")
            .update(`${event}|${merchantOrderId}|${razorpayOrderId}|${JSON.stringify(jsonPayload)}`)
            .digest("hex"));

    return {
      eventId,
      eventType: event,
      merchantOrderId,
      gatewayOrderId: razorpayOrderId,
      transactionId: razorpayPaymentId,
      state: paymentEntity.status || orderEntity.status || event,
      raw: jsonPayload,
    };
  }

  /**
   * Maps Razorpay order/payment status to internal PAYMENT_STATUS enum.
   *
   * @param {string} gatewayState
   * @returns {string}
   */
  mapStatusToInternal(gatewayState) {
    const normalized = String(gatewayState || "").toLowerCase().trim();

    if (
      normalized === "captured" ||
      normalized === "paid" ||
      normalized === "payment.captured" ||
      normalized === "order.paid"
    ) {
      return PAYMENT_STATUS.CAPTURED;
    }

    if (
      normalized === "failed" ||
      normalized === "payment.failed"
    ) {
      return PAYMENT_STATUS.FAILED;
    }

    if (
      normalized === "authorized" ||
      normalized === "created" ||
      normalized === "attempted" ||
      normalized === "pending"
    ) {
      return PAYMENT_STATUS.PENDING;
    }

    if (normalized === "refunded") {
      return PAYMENT_STATUS.REFUNDED;
    }

    return PAYMENT_STATUS.PENDING;
  }
}

export default RazorpayAdapter;
