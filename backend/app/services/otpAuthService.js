import crypto from "crypto";
import jwt from "jsonwebtoken";
import Customer from "../models/customer.js";
import OtpVerification from "../models/otpVerification.js";
import { sendSmsIndiaHubOtp } from "./smsIndiaHubService.js";
import { generateOTP, useRealSMS } from "../utils/otp.js";
import { getRedisClient } from "../config/redis.js";
import { isValidE164Phone, maskPhone, normalizePhoneNumber } from "../utils/phone.js";

const CUSTOMER_REGISTRATION_PURPOSE = "customer_registration";
const CUSTOMER_REGISTRATION_TOKEN_TTL_MINUTES = () =>
  parseInt(process.env.CUSTOMER_REGISTRATION_TOKEN_TTL_MINUTES || "15", 10);
const OTP_EXPIRY_MINUTES = () => parseInt(process.env.OTP_EXPIRY_MINUTES || "5", 10);
const OTP_RESEND_COOLDOWN_SECONDS = () =>
  parseInt(process.env.OTP_RESEND_COOLDOWN_SECONDS || "60", 10);
const OTP_MAX_FAILED_ATTEMPTS = () =>
  parseInt(process.env.OTP_MAX_FAILED_ATTEMPTS || "5", 10);
const OTP_LOCKOUT_MINUTES = () =>
  parseInt(process.env.OTP_LOCKOUT_MINUTES || "15", 10);
const OTP_SEND_LIMIT_WINDOW_SECONDS = () =>
  parseInt(
    process.env.OTP_SEND_LIMIT_WINDOW_SECONDS ||
      (process.env.OTP_SEND_RATE_LIMIT_WINDOW_MS
        ? String(Math.floor(parseInt(process.env.OTP_SEND_RATE_LIMIT_WINDOW_MS, 10) / 1000))
        : "900"),
    10,
  );
const OTP_SEND_LIMIT_PER_WINDOW = () =>
  parseInt(
    process.env.OTP_SEND_LIMIT_PER_WINDOW ||
      process.env.OTP_SEND_RATE_LIMIT_MAX ||
      "10",
    10,
  );
const OTP_VERIFY_LIMIT_WINDOW_SECONDS = () =>
  parseInt(
    process.env.OTP_VERIFY_LIMIT_WINDOW_SECONDS ||
      (process.env.OTP_VERIFY_RATE_LIMIT_WINDOW_MS
        ? String(Math.floor(parseInt(process.env.OTP_VERIFY_RATE_LIMIT_WINDOW_MS, 10) / 1000))
        : "900"),
    10,
  );
const OTP_VERIFY_LIMIT_PER_WINDOW = () =>
  parseInt(
    process.env.OTP_VERIFY_LIMIT_PER_WINDOW ||
      process.env.OTP_VERIFY_RATE_LIMIT_MAX ||
      "20",
    10,
  );


function otpHashSecret() {
  return process.env.OTP_HASH_SECRET || process.env.JWT_SECRET || "unsafe-dev-secret";
}

function hashOtp(phone, otp) {
  return crypto
    .createHmac("sha256", otpHashSecret())
    .update(`${phone}:${otp}`)
    .digest("hex");
}

async function incrementWindowCounter(redisKey, { limit, windowSeconds }) {
  if (process.env.DISABLE_RATE_LIMIT === "true" || (process.env.NODE_ENV !== "production" && process.env.ENABLE_RATE_LIMIT_DEV !== "true")) {
    return true;
  }
  const redis = getRedisClient();
  if (redis) {
    try {
      const count = await redis.incr(redisKey);
      if (count === 1) {
        await redis.expire(redisKey, windowSeconds);
      } else {
        const ttl = await redis.ttl(redisKey);
        if (ttl === -1) {
          await redis.expire(redisKey, windowSeconds);
        }
      }
      return Number(count) <= limit;
    } catch {
      // fallback below
    }
  }

  if (!globalThis.__OTP_WINDOW_COUNTER__) {
    globalThis.__OTP_WINDOW_COUNTER__ = new Map();
  }
  const now = Date.now();
  const map = globalThis.__OTP_WINDOW_COUNTER__;
  const entry = map.get(redisKey);
  if (!entry || entry.expiresAt <= now) {
    map.set(redisKey, {
      count: 1,
      expiresAt: now + windowSeconds * 1000,
    });
    return true;
  }
  entry.count += 1;
  map.set(redisKey, entry);
  return entry.count <= limit;
}

function otpAuditLog(event, meta) {
  console.log(
    JSON.stringify({
      level: "info",
      ts: new Date().toISOString(),
      event,
      ...meta,
    }),
  );
}

async function dispatchCustomerOtpSms({ phone, otp }) {
  return sendSmsIndiaHubOtp({ phone, otp });
}


export function normalizeAndValidatePhone(rawPhone) {
  const phone = normalizePhoneNumber(rawPhone);
  if (!isValidE164Phone(phone)) {
    const err = new Error("Invalid phone number format");
    err.statusCode = 400;
    throw err;
  }
  return phone;
}

const CUSTOMER_OTP_FIELDS =
  "+otpHash +otpExpiresAt +otpFailedAttempts +otpLockedUntil +otpLastSentAt +otpSessionVersion +otp +otpExpiry";

function assertNotLocked(lockedUntil, now, message) {
  if (lockedUntil && lockedUntil > now) {
    const err = new Error(message);
    err.statusCode = 423;
    throw err;
  }
}

function assertResendCooldown(lastSentAt, now) {
  if (process.env.NODE_ENV !== "production" && process.env.ENABLE_RATE_LIMIT_DEV !== "true") {
    return;
  }
  if (!lastSentAt) return;
  const elapsedMs = now.getTime() - new Date(lastSentAt).getTime();
  const cooldownMs = OTP_RESEND_COOLDOWN_SECONDS() * 1000;
  if (elapsedMs < cooldownMs) {
    const waitSec = Math.ceil((cooldownMs - elapsedMs) / 1000);
    const err = new Error(`Please wait ${waitSec}s before requesting another OTP`);
    err.statusCode = 429;
    throw err;
  }
}

function invalidOtpError(statusCode = 400) {
  const err = new Error("Invalid or expired OTP");
  err.statusCode = statusCode;
  return err;
}

function otpMatches(phone, code, expectedHash) {
  if (!expectedHash) return false;
  const actual = Buffer.from(hashOtp(phone, code), "hex");
  const expected = Buffer.from(String(expectedHash), "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function findRegistrationSession(phone) {
  return OtpVerification.findOne({
    purpose: CUSTOMER_REGISTRATION_PURPOSE,
    channel: "phone",
    target: phone,
  }).select("+otpHash +expiresAt");
}

async function dispatchOtp({ phone, otp, flow, ipAddress }) {
  if (useRealSMS()) {
    try {
      await dispatchCustomerOtpSms({ phone, otp });
      otpAuditLog("customer_otp_sms_dispatched", {
        phone: maskPhone(phone),
        flow,
        ipAddress,
        mode: "real",
      });
    } catch (smsError) {
      console.error("[sms] SMS dispatch failed:", smsError.message);
      if (process.env.NODE_ENV !== "production") {
        otpAuditLog("customer_otp_sms_fallback_mock", {
          phone: maskPhone(phone),
          flow,
          ipAddress,
          error: smsError.message,
        });
      } else {
        throw smsError;
      }
    }
  } else {
    otpAuditLog("customer_otp_mock_mode", {
      phone: maskPhone(phone),
      flow,
      ipAddress,
      mode: "mock",
    });
  }
}

/**
 * Sends an OTP to any valid number.
 *
 * Registered (verified) customers keep their OTP state on the account itself.
 * Every other number gets a pending registration session instead, so no
 * customer account exists until the number is verified and a name is given.
 */
export async function issueCustomerOtp({
  name = "",
  rawPhone,
  flow,
  ipAddress = "unknown",
}) {
  const phone = normalizeAndValidatePhone(rawPhone);
  const now = new Date();

  const sendAllowed = await incrementWindowCounter(`otp:send:phone:${phone}`, {
    limit: OTP_SEND_LIMIT_PER_WINDOW(),
    windowSeconds: OTP_SEND_LIMIT_WINDOW_SECONDS(),
  });
  if (!sendAllowed) {
    const err = new Error("Too many OTP requests. Try again later.");
    err.statusCode = 429;
    throw err;
  }

  const customer = await Customer.findOne({ phone }).select(CUSTOMER_OTP_FIELDS);

  // generateOTP() already returns the fixed mock code outside production
  // (USE_REAL_SMS off); every real login/registration gets a random code.
  let otp;

  if (customer?.isVerified) {
    assertNotLocked(customer.otpLockedUntil, now, "OTP verification is temporarily locked for this number");
    assertResendCooldown(customer.otpLastSentAt, now);

    otp = generateOTP();
    customer.otpHash = hashOtp(phone, otp);
    customer.otpExpiresAt = new Date(now.getTime() + OTP_EXPIRY_MINUTES() * 60 * 1000);
    customer.otpFailedAttempts = 0;
    customer.otpLockedUntil = null;
    customer.otpLastSentAt = now;
    customer.otpSessionVersion = (customer.otpSessionVersion || 0) + 1;

    // Backward compatibility with legacy fields; raw OTP is intentionally not stored.
    customer.otp = undefined;
    customer.otpExpiry = undefined;

    await customer.save();
  } else {
    let session = await findRegistrationSession(phone);
    assertNotLocked(session?.lockedUntil, now, "OTP verification is temporarily locked for this number");
    assertResendCooldown(session?.lastSentAt, now);

    otp = generateOTP();
    if (!session) {
      session = new OtpVerification({
        purpose: CUSTOMER_REGISTRATION_PURPOSE,
        channel: "phone",
        target: phone,
      });
    }
    session.otpHash = hashOtp(phone, otp);
    session.expiresAt = new Date(now.getTime() + OTP_EXPIRY_MINUTES() * 60 * 1000);
    session.verifiedAt = null;
    session.failedAttempts = 0;
    session.lockedUntil = null;
    session.lastSentAt = now;
    // Legacy signup requests send the name up front; keep it so verification
    // can finish registration in one step for older app builds.
    session.metadata = flow === "signup" && name ? { name } : undefined;

    try {
      await session.save();
    } catch (error) {
      if (error?.code === 11000) {
        // A parallel request created the session first.
        const err = new Error("Please wait before requesting another OTP");
        err.statusCode = 429;
        throw err;
      }
      throw error;
    }
  }

  await dispatchOtp({ phone, otp, flow, ipAddress });

  return { sent: true, phone };
}

async function verifyRegisteredCustomerOtp({ customer, phone, code, ipAddress, now }) {
  assertNotLocked(customer.otpLockedUntil, now, "Too many failed attempts. Please try again later.");

  if (!customer.otpHash || !customer.otpExpiresAt || customer.otpExpiresAt <= now) {
    throw invalidOtpError();
  }

  if (!otpMatches(phone, code, customer.otpHash)) {
    customer.otpFailedAttempts = (customer.otpFailedAttempts || 0) + 1;

    if (customer.otpFailedAttempts >= OTP_MAX_FAILED_ATTEMPTS()) {
      customer.otpLockedUntil = new Date(
        now.getTime() + OTP_LOCKOUT_MINUTES() * 60 * 1000,
      );
    }

    await customer.save();
    otpAuditLog("customer_otp_verify_failed", {
      phone: maskPhone(phone),
      ipAddress,
      failedAttempts: customer.otpFailedAttempts,
      lockedUntil: customer.otpLockedUntil || null,
    });

    throw invalidOtpError(customer.otpLockedUntil ? 423 : 400);
  }

  customer.otpHash = undefined;
  customer.otpExpiresAt = undefined;
  customer.otpFailedAttempts = 0;
  customer.otpLockedUntil = undefined;
  customer.otpSessionVersion = (customer.otpSessionVersion || 0) + 1;
  customer.otp = undefined;
  customer.otpExpiry = undefined;
  customer.lastLogin = now;

  await customer.save();
  return customer;
}

async function verifyRegistrationOtp({ phone, code, ipAddress, now }) {
  const session = await findRegistrationSession(phone);
  if (!session) throw invalidOtpError();

  assertNotLocked(session.lockedUntil, now, "Too many failed attempts. Please try again later.");

  if (!session.otpHash || !session.expiresAt || session.expiresAt <= now) {
    throw invalidOtpError();
  }

  if (!otpMatches(phone, code, session.otpHash)) {
    session.failedAttempts = (session.failedAttempts || 0) + 1;

    if (session.failedAttempts >= OTP_MAX_FAILED_ATTEMPTS()) {
      session.lockedUntil = new Date(now.getTime() + OTP_LOCKOUT_MINUTES() * 60 * 1000);
      // Keep the session (and its lock) alive past the TTL index until the lockout ends.
      if (session.expiresAt < session.lockedUntil) session.expiresAt = session.lockedUntil;
    }

    await session.save();
    otpAuditLog("customer_otp_verify_failed", {
      phone: maskPhone(phone),
      ipAddress,
      failedAttempts: session.failedAttempts,
      lockedUntil: session.lockedUntil || null,
    });

    throw invalidOtpError(session.lockedUntil ? 423 : 400);
  }

  // Consume atomically so the same code can't be redeemed twice.
  const consumed = await OtpVerification.findOneAndDelete({
    _id: session._id,
    otpHash: session.otpHash,
  });
  if (!consumed) throw invalidOtpError();

  return session;
}

/**
 * Verifies an OTP for any number.
 *
 * Returns `{ isNewUser: false, customer }` for a registered customer, and
 * `{ isNewUser: true, phone }` for a number with no completed account; the
 * caller must then collect a name and call completeCustomerRegistration().
 */
export async function verifyCustomerOtpCode({
  rawPhone,
  otp,
  ipAddress = "unknown",
}) {
  const phone = normalizeAndValidatePhone(rawPhone);
  const code = String(otp || "").trim();
  if (!/^\d{4,8}$/.test(code)) {
    const err = new Error("Invalid OTP format");
    err.statusCode = 400;
    throw err;
  }

  const verifyAllowed = await incrementWindowCounter(`otp:verify:phone:${phone}`, {
    limit: OTP_VERIFY_LIMIT_PER_WINDOW(),
    windowSeconds: OTP_VERIFY_LIMIT_WINDOW_SECONDS(),
  });
  if (!verifyAllowed) {
    const err = new Error("Too many OTP verification attempts. Try again later.");
    err.statusCode = 429;
    throw err;
  }

  const now = new Date();
  const customer = await Customer.findOne({ phone }).select(CUSTOMER_OTP_FIELDS);

  if (customer?.isVerified) {
    const verified = await verifyRegisteredCustomerOtp({ customer, phone, code, ipAddress, now });
    otpAuditLog("customer_otp_verify_success", {
      phone: maskPhone(phone),
      ipAddress,
      isNewUser: false,
    });
    return { isNewUser: false, customer: verified };
  }

  const session = await verifyRegistrationOtp({ phone, code, ipAddress, now });
  otpAuditLog("customer_otp_verify_success", {
    phone: maskPhone(phone),
    ipAddress,
    isNewUser: true,
  });

  const legacyName = session.metadata?.name;
  if (legacyName) {
    const created = await createOrActivateCustomer({ phone, name: legacyName });
    return { isNewUser: false, customer: created };
  }

  return { isNewUser: true, phone };
}

function registrationTokenSecret() {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not configured");
  }
  // Derived key: a registration token must never pass verifyToken() as a login token.
  return `${process.env.JWT_SECRET}:${CUSTOMER_REGISTRATION_PURPOSE}`;
}

export function issueRegistrationToken(phone) {
  return jwt.sign(
    { phone, purpose: CUSTOMER_REGISTRATION_PURPOSE },
    registrationTokenSecret(),
    { expiresIn: `${CUSTOMER_REGISTRATION_TOKEN_TTL_MINUTES()}m` },
  );
}

function readRegistrationToken(token) {
  try {
    const decoded = jwt.verify(String(token || ""), registrationTokenSecret());
    if (decoded?.purpose !== CUSTOMER_REGISTRATION_PURPOSE || !decoded.phone) {
      throw new Error("wrong token purpose");
    }
    return normalizeAndValidatePhone(decoded.phone);
  } catch {
    const err = new Error("Registration session expired. Please verify your number again.");
    err.statusCode = 401;
    throw err;
  }
}

/**
 * Creates the account for a verified number, or returns the existing one.
 * Safe to call repeatedly: retries and parallel requests for the same number
 * resolve to a single account (phone is a unique index).
 */
async function createOrActivateCustomer({ phone, name }) {
  const now = new Date();
  const existing = await Customer.findOne({ phone });
  if (existing) {
    // An unverified record is a leftover from the old signup flow; claim it.
    // A verified one means registration already finished, so keep its name.
    if (!existing.isVerified) {
      existing.name = name;
      existing.isVerified = true;
    }
    existing.lastLogin = now;
    await existing.save();
    return existing;
  }

  try {
    return await Customer.create({ name, phone, isVerified: true, lastLogin: now });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const winner = await Customer.findOne({ phone });
    if (!winner) throw error;
    return winner;
  }
}

export async function completeCustomerRegistration({
  registrationToken,
  name,
  ipAddress = "unknown",
}) {
  const phone = readRegistrationToken(registrationToken);
  const customer = await createOrActivateCustomer({ phone, name });

  otpAuditLog("customer_registration_completed", {
    phone: maskPhone(phone),
    ipAddress,
  });

  return customer;
}

export function sanitizeCustomer(customerDoc) {
  if (!customerDoc) return null;
  const obj = customerDoc.toObject ? customerDoc.toObject() : { ...customerDoc };
  if (obj.walletBalance !== undefined && obj.walletBalance !== null) {
    obj.walletBalance = Math.floor(Number(obj.walletBalance || 0));
  }
  delete obj.password;
  delete obj.__v;
  delete obj.updatedAt;
  delete obj.otp;
  delete obj.otpHash;
  delete obj.otpExpiry;
  delete obj.otpExpiresAt;
  delete obj.otpFailedAttempts;
  delete obj.otpLockedUntil;
  delete obj.otpLastSentAt;
  delete obj.otpSessionVersion;
  return obj;
}
