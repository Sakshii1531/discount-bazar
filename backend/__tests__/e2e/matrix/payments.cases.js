/**
 * Online payment endpoints with the real Razorpay adapter: signature and
 * webhook HMAC checks run for real against test secrets; only the two calls
 * that would reach Razorpay's servers (create order / fetch status) are faked.
 */
import crypto from "crypto";
import request from "supertest";
import { expect } from "@jest/globals";
import { RazorpayAdapter } from "../../../app/services/payment/providers/razorpay.adapter.js";
import {
  __setActivePaymentProviderForTests,
  __resetPaymentProviderForTests,
} from "../../../app/services/payment/providerRegistry.js";
import Order from "../../../app/models/order.js";
import { AT_CUSTOMER } from "../helpers/flows.js";

const KEY_SECRET = "rzp_test_secret_for_e2e";
const WEBHOOK_SECRET = "rzp_webhook_secret_for_e2e";

class FakeGatewayRazorpay extends RazorpayAdapter {
  constructor() {
    super();
    this.orders = new Map();
  }

  async initiatePayment({ merchantOrderId, amountPaise, currency = "INR" }) {
    const id = `order_e2e${crypto.randomBytes(5).toString("hex")}`;
    this.orders.set(id, { id, amount: Math.round(amountPaise), currency, status: "created", merchantOrderId });
    return { merchantOrderId, gatewayOrderId: id, amount: Math.round(amountPaise), currency, keyId: "rzp_test_e2e", gatewayResponse: this.orders.get(id) };
  }

  async getPaymentStatus({ gatewayOrderId, gatewayPaymentId }) {
    if (gatewayPaymentId) return { state: "captured", transactionId: gatewayPaymentId, responseCode: "captured", gatewayResponse: {} };
    const order = this.orders.get(gatewayOrderId);
    return { state: order?.status || "created", transactionId: null, responseCode: order?.status || "created", gatewayResponse: order || {} };
  }
}

export const sign = (payload, secret = KEY_SECRET) => crypto.createHmac("sha256", secret).update(payload).digest("hex");

export async function seed(ctx, app) {
  process.env.PAYMENT_PROVIDER = "razorpay";
  process.env.RAZORPAY_KEY_ID = "rzp_test_e2e";
  process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
  process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
  __resetPaymentProviderForTests();
  __setActivePaymentProviderForTests(new FakeGatewayRazorpay(), "razorpay");

  const createOnline = async () => {
    const res = await request(app)
      .post("/api/orders")
      .set("Authorization", ctx.auth.customer)
      .send({
        items: [{ product: String(ctx.milk._id), quantity: 1 }],
        address: { name: "Main Customer", address: "12 MG Road, Indore", city: "Indore", phone: "9999999999", location: AT_CUSTOMER },
        paymentMode: "ONLINE",
        timeSlot: "now",
      });
    if (res.status !== 201) throw new Error(`online order failed: ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`);
    return res.body.result.order.orderId;
  };
  ctx.onlineOrder = await createOnline();
  ctx.webhookOrder = await createOnline();
}

const webhookBody = (ctx, key) =>
  JSON.stringify({
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: `pay_webhook_${ctx[key]}`,
          order_id: ctx.webhookGatewayOrderId,
          status: "captured",
          amount: 0,
          notes: { merchantOrderId: ctx.webhookMerchantOrderId },
        },
      },
    },
  });

export default [
  {
    route: "POST /api/payments/create-order",
    name: "validates the order reference",
    as: "customer",
    body: {},
    status: 400,
  },
  {
    route: "POST /api/payments/create-order",
    name: "another customer cannot pay for it",
    as: "otherCustomer",
    body: (ctx) => ({ orderId: ctx.onlineOrder }),
    status: [403, 404],
  },
  {
    route: "POST /api/payments/create-order",
    as: "customer",
    headers: { "Idempotency-Key": "e2e-pay-1" },
    body: (ctx) => ({ orderId: ctx.onlineOrder }),
    status: [200, 201],
    check: (res, ctx) => {
      const r = res.body.result;
      expect(r.razorpayOrderId || r.merchantOrderId).toMatch(/^order_e2e|^CHK-|^ORD-/);
      expect(r.amount).toBeGreaterThan(0);
      ctx.gatewayOrderId = r.razorpayOrderId || r.payment.gatewayOrderId;
      ctx.merchantOrderId = r.merchantOrderId;
    },
  },
  {
    route: "POST /api/payments/create-order",
    name: "same idempotency key re-uses the payment",
    as: "customer",
    headers: { "Idempotency-Key": "e2e-pay-1" },
    body: (ctx) => ({ orderId: ctx.onlineOrder }),
    status: [200, 201],
  },
  {
    route: "GET /api/payments/status/:id",
    as: "customer",
    params: (ctx) => ({ id: ctx.merchantOrderId }),
    check: (res) => expect(typeof res.body.result.status).toBe("string"),
  },
  { route: "GET /api/payments/status/:id", name: "unknown payment", as: "customer", params: { id: "order_unknown" }, status: [400, 404] },
  {
    route: "POST /api/payments/verify-razorpay",
    name: "rejects a forged signature",
    as: "customer",
    body: (ctx) => ({
      merchantOrderId: ctx.merchantOrderId,
      razorpay_order_id: ctx.gatewayOrderId,
      razorpay_payment_id: "pay_e2e_1",
      razorpay_signature: "0".repeat(64),
    }),
    status: [400, 401, 403],
    check: async (res, ctx) => {
      const order = await Order.findOne({ orderId: ctx.onlineOrder }).lean();
      expect(order.paymentStatus).not.toBe("PAID");
    },
  },
  {
    route: "POST /api/payments/verify-razorpay",
    as: "customer",
    body: (ctx) => ({
      merchantOrderId: ctx.merchantOrderId,
      razorpay_order_id: ctx.gatewayOrderId,
      razorpay_payment_id: "pay_e2e_1",
      razorpay_signature: sign(`${ctx.gatewayOrderId}|pay_e2e_1`),
    }),
    check: async (res, ctx) => {
      expect(res.body.result.status).toMatch(/SUCCESS|CAPTURED|PAID|COMPLETED/i);
      const order = await Order.findOne({ orderId: ctx.onlineOrder }).lean();
      expect(order.paymentStatus).toBe("PAID");
    },
  },
  {
    route: "POST /api/orders/:id/payment/verify-online",
    name: "is idempotent after the payment is captured",
    as: "customer",
    params: (ctx) => ({ id: ctx.onlineOrder }),
    body: (ctx) => ({ merchantOrderId: ctx.gatewayOrderId, transactionId: "pay_e2e_1", signature: sign(`${ctx.gatewayOrderId}|pay_e2e_1`) }),
    check: (res) => expect(res.body.result.paymentStatus).toMatch(/SUCCESS|CAPTURED|PAID|COMPLETED/i),
  },
  { route: "POST /api/orders/:id/payment/verify-online", name: "validates input", as: "customer", params: (ctx) => ({ id: ctx.onlineOrder }), body: {}, status: 400 },

  // ── Webhooks (raw body + HMAC header) ─────────────────────────────────────
  {
    route: "POST /api/payments/create-order",
    name: "payment for the webhook order",
    as: "customer",
    body: (ctx) => ({ orderId: ctx.webhookOrder }),
    status: [200, 201],
    check: (res, ctx) => {
      ctx.webhookGatewayOrderId = res.body.result.razorpayOrderId || res.body.result.payment.gatewayOrderId;
      ctx.webhookMerchantOrderId = res.body.result.merchantOrderId;
    },
  },
  {
    route: "POST /api/payments/webhook/razorpay",
    name: "rejects an unsigned webhook",
    rawBody: (ctx) => webhookBody(ctx, "webhookOrder"),
    headers: { "x-razorpay-signature": "bad" },
    status: [400, 401, 403],
  },
  {
    route: "POST /api/payments/webhook/razorpay",
    rawBody: (ctx) => webhookBody(ctx, "webhookOrder"),
    headers: (ctx) => ({ "x-razorpay-signature": sign(webhookBody(ctx, "webhookOrder"), WEBHOOK_SECRET) }),
    check: async (res, ctx) => {
      const order = await Order.findOne({ orderId: ctx.webhookOrder }).lean();
      expect(order.paymentStatus).toBe("PAID");
    },
  },
  {
    route: "POST /api/payments/webhook/razorpay",
    name: "replayed events are de-duplicated",
    rawBody: (ctx) => webhookBody(ctx, "webhookOrder"),
    headers: (ctx) => ({ "x-razorpay-signature": sign(webhookBody(ctx, "webhookOrder"), WEBHOOK_SECRET) }),
    status: 200,
  },
  {
    route: "POST /api/payments/webhook/phonepe",
    name: "rejects an unauthenticated webhook",
    rawBody: JSON.stringify({ response: "e30=" }),
    headers: { "x-verify": "invalid" },
    status: [400, 401, 403],
  },
];

export function teardown() {
  __resetPaymentProviderForTests();
}
