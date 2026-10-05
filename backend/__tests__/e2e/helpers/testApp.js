/**
 * Boots the real Express route tree against an in-memory MongoDB so the
 * API E2E suites exercise controllers, middleware and models end-to-end
 * without touching any real database, Redis, SMS, email, storage, maps,
 * push or payment provider.
 *
 * Safety: several app modules call dotenv.config(), which would load the
 * real credentials from backend/.env into the test process. We pre-set every
 * integration secret to an empty value (dotenv never overrides an existing
 * variable) and block all outbound network traffic except localhost.
 */
import http from "http";
import https from "https";
import express from "express";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { MongoMemoryReplSet } from "mongodb-memory-server";

export const TEST_JWT_SECRET = "e2e-test-jwt-secret-please-change-0123456789";

// Every key that would let a test reach a real external system.
const BLANKED_SECRETS = [
  "MONGO_URI",
  "MONGODB_URI",
  "REDIS_URL",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
  "CLOUDINARY_CLOUD_NAME",
  "FIREBASE_SERVICE_ACCOUNT",
  "FIREBASE_DATABASE_URL",
  "GOOGLE_MAPS_API_KEY",
  "GOOGLE_MAPS_SERVER_KEY",
  "SMS_INDIA_HUB_API_KEY",
  "SMS_INDIA_HUB_URL",
  "SMS_INDIA_HUB_GWID",
  "SMS_INDIA_HUB_SENDER_ID",
  "SMS_INDIA_HUB_DLT_TEMPLATE_ID",
  "SMTP_HOST",
  "SMTP_USER",
  "SMTP_PASS",
  "PHONEPE_CLIENT_ID",
  "PHONEPE_CLIENT_SECRET",
  "PHONEPE_MERCHANT_ID",
  "PHONEPE_SALT_KEY",
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "RAZORPAY_WEBHOOK_SECRET",
  "ADMIN_BOOTSTRAP_TOKEN",
];

export function configureTestEnv() {
  for (const key of BLANKED_SECRETS) process.env[key] = "";
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  process.env.REDIS_DISABLED = "true";
  process.env.USE_REAL_SMS = "false";
  process.env.USE_MOCK_OTP = "true";
  process.env.USE_REAL_EMAIL_OTP = "false";
  process.env.STORAGE_PROVIDER = "local";
  process.env.PAYMENT_PROVIDER = process.env.PAYMENT_PROVIDER || "razorpay";
  process.env.SEARCH_BACKEND = process.env.SEARCH_BACKEND || "mongo";
  // Generous limits: suites issue many auth calls from one IP.
  process.env.AUTH_RATE_LIMIT_MAX = "10000";
  process.env.OTP_RATE_LIMIT_MAX = "10000";
}

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]", ""]);
let networkBlocked = false;

/** Makes any non-localhost HTTP(S)/fetch call fail immediately. */
export function blockExternalNetwork() {
  if (networkBlocked) return;
  networkBlocked = true;
  const hostOf = (args) => {
    const [first, second] = args;
    if (typeof first === "string" || first instanceof URL) return new URL(String(first)).hostname;
    const opts = first || second || {};
    return String(opts.hostname || opts.host || "").replace(/:\d+$/, "");
  };
  const guard = (original, name) =>
    function guardedRequest(...args) {
      const host = hostOf(args);
      if (!LOCAL_HOSTS.has(host)) {
        throw new Error(`[e2e] blocked outbound ${name} request to ${host}`);
      }
      return original.apply(this, args);
    };
  http.request = guard(http.request, "http");
  http.get = guard(http.get, "http");
  https.request = guard(https.request, "https");
  https.get = guard(https.get, "https");
  if (typeof globalThis.fetch === "function") {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      const host = new URL(typeof input === "string" ? input : input.url).hostname;
      if (!LOCAL_HOSTS.has(host)) return Promise.reject(new Error(`[e2e] blocked outbound fetch to ${host}`));
      return originalFetch(input, init);
    };
  }
}

let mongoServer;

export async function startTestApp() {
  configureTestEnv();
  // Single-node replica set: order placement uses multi-document transactions,
  // exactly like production (Atlas). Generous launch timeout for busy machines.
  mongoServer = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ launchTimeout: 60000 }],
  });
  await mongoose.connect(mongoServer.getUri(), { dbName: "discount_bazar_e2e" });
  // After mongod is up (its binary download, if any, needs the network).
  blockExternalNetwork();

  const { default: setupRoutes } = await import("../../../app/routes/index.js");
  const { requestContextMiddleware } = await import("../../../app/middleware/requestContext.js");
  const { errorHandler, notFoundHandler } = await import("../../../app/middleware/errorMiddleware.js");

  const app = express();
  // Same order as index.js: webhooks get the raw body for signature checks.
  app.use(
    ["/api/payments/webhook/phonepe", "/api/payments/webhook/razorpay"],
    express.raw({ type: "application/json", limit: "1mb" }),
  );
  app.use(express.json({ limit: "5mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(requestContextMiddleware);
  setupRoutes(app);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

export async function stopTestApp() {
  await mongoose.disconnect();
  // doCleanup removes the temporary dbPath (otherwise each run leaves ~50MB in %TEMP%).
  if (mongoServer) await mongoServer.stop({ doCleanup: true, force: true });
}

export async function clearDatabase() {
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
}

export function tokenFor(role, id, extra = {}) {
  return jwt.sign({ id: String(id), role, ...extra }, TEST_JWT_SECRET, { expiresIn: "1h" });
}

export const bearer = (role, id, extra) => `Bearer ${tokenFor(role, id, extra)}`;
