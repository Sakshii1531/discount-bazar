import crypto from "crypto";
import Order from "../models/order.js";
import CheckoutGroup from "../models/checkoutGroup.js";

const CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIMESTAMP_PART_LENGTH = 5;
const RANDOM_PART_LENGTH = 5;

function encodeTimePart(timestampMs) {
  let value = BigInt(timestampMs);
  let encoded = "";
  for (let i = 0; i < TIMESTAMP_PART_LENGTH; i += 1) {
    const index = Number(value & 31n);
    encoded = CROCKFORD_BASE32[index] + encoded;
    value >>= 5n;
  }
  return encoded;
}

function randomBase32(length) {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += CROCKFORD_BASE32[bytes[i] % CROCKFORD_BASE32.length];
  }
  return out;
}

export function buildSortableToken(timestampMs = Date.now()) {
  return `${encodeTimePart(timestampMs)}${randomBase32(RANDOM_PART_LENGTH)}`;
}

const PUBLIC_ORDER_ID_LENGTH = 8;

/**
 * Short public order ID, e.g. "ORD-7K2M9QXA": 8 random Crockford base32 chars
 * (32^8 ≈ 1.1 trillion combinations, no ambiguous I/L/O/U). Uniqueness is
 * guaranteed by the existence check in generateUniquePublicOrderId plus the
 * unique index on Order.orderId.
 */
export function buildPublicOrderId() {
  return `ORD-${randomBase32(PUBLIC_ORDER_ID_LENGTH)}`;
}

export function buildCheckoutGroupId() {
  return `CHK-${buildSortableToken()}`;
}

export async function generateUniquePublicOrderId({ session = null, maxAttempts = 8 } = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const candidate = buildPublicOrderId();
    const query = Order.exists({ orderId: candidate });
    if (session) query.session(session);
    const exists = await query;
    if (!exists) return candidate;
  }
  const err = new Error("Unable to generate a unique public order id");
  err.statusCode = 500;
  throw err;
}

export async function generateUniqueCheckoutGroupId({ session = null, maxAttempts = 8 } = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const candidate = buildCheckoutGroupId();
    const query = CheckoutGroup.exists({ checkoutGroupId: candidate });
    if (session) query.session(session);
    const exists = await query;
    if (!exists) return candidate;
  }
  const err = new Error("Unable to generate a unique checkout group id");
  err.statusCode = 500;
  throw err;
}
