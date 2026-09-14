/**
 * PhonePeAdapter
 *
 * Single home for the PhonePe SDK in the codebase. paymentService.js calls
 * only this adapter (through the providerRegistry) and never imports
 * `@phonepe-pg/pg-sdk-node` directly.
 *
 * Swap-out is a one-line change in providerRegistry.js + a new adapter file
 * implementing the same `PaymentProviderPort` contract.
 */

import crypto from "crypto";
import {
  StandardCheckoutClient,
  Env,
  StandardCheckoutPayRequest,
} from "@phonepe-pg/pg-sdk-node";

import { PAYMENT_STATUS, PAYMENT_GATEWAY } from "../../../constants/payment.js";
import { PaymentProviderPort } from "../ports/paymentProviderPort.js";

let _phonePeClient = null;

function buildPhonePeClient() {
  const clientId = String(process.env.PHONEPE_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.PHONEPE_CLIENT_SECRET || "").trim();
  const clientVersion = parseInt(process.env.PHONEPE_CLIENT_VERSION || "1", 10);
  const isProd =
    String(process.env.PHONEPE_ENV || "").toUpperCase() === "PRODUCTION";

  if (!clientId || !clientSecret) {
    throw new Error("PhonePe credentials not configured");
  }

  return StandardCheckoutClient.getInstance(
    clientId,
    clientSecret,
    clientVersion,
    isProd ? Env.PRODUCTION : Env.SANDBOX,
  );
}

function getPhonePeClient() {
  if (_phonePeClient) return _phonePeClient;
  _phonePeClient = buildPhonePeClient();
  return _phonePeClient;
}

export class PhonePeAdapter extends PaymentProviderPort {
  get providerName() {
    return PAYMENT_GATEWAY.PHONEPE;
  }

  async initiatePayment({ merchantOrderId, amountPaise, redirectUrl, callbackUrl }) {
    const client = getPhonePeClient();
    const request = StandardCheckoutPayRequest.builder()
      .merchantOrderId(merchantOrderId)
      .amount(amountPaise)
      .redirectUrl(redirectUrl)
      .callbackUrl(callbackUrl || redirectUrl)
      .build();
    const response = await client.pay(request);
    return {
      redirectUrl: response.redirectUrl,
      gatewayResponse: response,
    };
  }

  async getPaymentStatus({ merchantOrderId }) {
    const client = getPhonePeClient();
    const response = await client.getOrderStatus(merchantOrderId);
    return {
      state: response.state,
      transactionId: response.transactionId,
      responseCode: response.responseCode,
      gatewayResponse: response,
    };
  }

  async validateWebhook({ rawBody, authorization }) {
    const client = getPhonePeClient();
    let jsonPayload;
    try {
      jsonPayload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      const err = new Error("Invalid format: Webhook body must be JSON");
      err.statusCode = 400;
      throw err;
    }
    const base64Response = jsonPayload.response;
    if (!base64Response) {
      const err = new Error("Invalid payload: Missing 'response' field");
      err.statusCode = 400;
      throw err;
    }
    const ok = await client.validateCallback(base64Response, authorization);
    return ok;
  }

  async decodeWebhookPayload({ rawBody }) {
    let jsonPayload;
    try {
      jsonPayload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      const err = new Error("Invalid format: Webhook body must be JSON");
      err.statusCode = 400;
      throw err;
    }
    const base64Response = jsonPayload.response;
    if (!base64Response) {
      const err = new Error("Invalid payload: Missing 'response' field");
      err.statusCode = 400;
      throw err;
    }
    let payload;
    try {
      payload = JSON.parse(
        Buffer.from(base64Response, "base64").toString("utf8"),
      );
    } catch {
      const err = new Error("Invalid webhook payload: Base64 decode failed");
      err.statusCode = 400;
      throw err;
    }
    // Audit Phase 2 (H-4): the previous fallback `crypto.randomUUID()` defeated
    // the `PaymentWebhookEvent.eventId` unique-index deduplication whenever
    // PhonePe omitted `transactionId` (true for some early CREATED/PENDING
    // callbacks). Each redelivery produced a fresh UUID and the same logical
    // event was processed twice.
    //
    // Fix: when `transactionId` is absent, derive a stable hash from the
    // identity tuple `(merchantOrderId, state, payload)`. Identical
    // redeliveries collapse onto the same eventId and short-circuit at the
    // unique-index check (code 11000 → `duplicate: true`).
    //
    // Backward compatibility: the primary `payload.transactionId` branch is
    // unchanged, so every existing happy-path webhook (which carries a
    // transactionId) produces the exact same eventId as before. Only the
    // pathological no-transactionId branch is hardened.
    const stableEventId =
      payload.transactionId ||
      crypto
        .createHash("sha256")
        .update(
          `${payload.merchantOrderId || ""}|${payload.state || ""}|${JSON.stringify(payload)}`,
        )
        .digest("hex");

    return {
      eventId: stableEventId,
      merchantOrderId: payload.merchantOrderId,
      state: payload.state,
      transactionId: payload.transactionId,
      responseCode: payload.responseCode,
      raw: payload,
    };
  }

  mapStatusToInternal(gatewayState) {
    const normalized = String(gatewayState || "").toUpperCase();
    if (normalized === "COMPLETED") return PAYMENT_STATUS.CAPTURED;
    if (normalized === "FAILED") return PAYMENT_STATUS.FAILED;
    if (normalized === "PENDING" || normalized === "CREATED")
      return PAYMENT_STATUS.PENDING;
    return PAYMENT_STATUS.PENDING;
  }
}

export default PhonePeAdapter;
