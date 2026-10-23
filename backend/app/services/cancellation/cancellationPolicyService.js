import Setting from "../../models/setting.js";
import {
  DEFAULT_CANCELLATION_POLICY,
  REFUND_ALLOCATION,
  REFUND_DESTINATION,
} from "../../constants/cancellation.js";
import { roundCurrency } from "../../utils/money.js";

const CACHE_TTL_MS = 30 * 1000;
let cached = null;
let cachedAt = 0;

const BOOLEAN_KEYS = [
  "selfCancelEnabled",
  "allowRequestAfterPickup",
  "allowWithdrawal",
  "refundDeliveryFeeBeforePickup",
  "refundHandlingFeeBeforePickup",
  "refundTipBeforePickup",
  "refundDeliveryFeeAfterPickup",
  "refundHandlingFeeAfterPickup",
  "refundTipAfterPickup",
];

const MONEY_KEYS = [
  "cancellationFeeAfterAcceptance",
  "cancellationFeeAfterPickup",
  "riderReturnCompensation",
];

function toBool(value, fallback) {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function toMoney(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return roundCurrency(Math.min(n, 100000));
}

/**
 * Merge a stored (possibly partial or malformed) policy over the defaults.
 * Unknown keys are dropped so the admin panel cannot smuggle in fields the
 * backend never enforces.
 */
export function normalizeCancellationPolicy(raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const policy = {};

  for (const key of BOOLEAN_KEYS) {
    policy[key] = toBool(source[key], DEFAULT_CANCELLATION_POLICY[key]);
  }
  for (const key of MONEY_KEYS) {
    policy[key] = toMoney(source[key], DEFAULT_CANCELLATION_POLICY[key]);
  }

  const stages = {};
  const rawStages = source.selfCancelStages && typeof source.selfCancelStages === "object"
    ? source.selfCancelStages
    : {};
  for (const [stage, def] of Object.entries(DEFAULT_CANCELLATION_POLICY.selfCancelStages)) {
    stages[stage] = toBool(rawStages[stage], def);
  }
  policy.selfCancelStages = stages;

  policy.onlineRefundDestination = Object.values(REFUND_DESTINATION).includes(source.onlineRefundDestination)
    ? source.onlineRefundDestination
    : DEFAULT_CANCELLATION_POLICY.onlineRefundDestination;
  policy.refundAllocation = Object.values(REFUND_ALLOCATION).includes(source.refundAllocation)
    ? source.refundAllocation
    : DEFAULT_CANCELLATION_POLICY.refundAllocation;

  const hours = Number(source.paymentVerificationWindowHours);
  policy.paymentVerificationWindowHours =
    Number.isFinite(hours) && hours >= 1 && hours <= 720
      ? Math.round(hours)
      : DEFAULT_CANCELLATION_POLICY.paymentVerificationWindowHours;

  const text = typeof source.prepaidRefundTimelineText === "string"
    ? source.prepaidRefundTimelineText.trim().slice(0, 300)
    : "";
  policy.prepaidRefundTimelineText = text || DEFAULT_CANCELLATION_POLICY.prepaidRefundTimelineText;

  return policy;
}

export async function getCancellationPolicy({ fresh = false } = {}) {
  const now = Date.now();
  if (!fresh && cached && now - cachedAt < CACHE_TTL_MS) {
    return cached;
  }
  const doc = await Setting.findOne({}).select("cancellationPolicy").lean();
  cached = normalizeCancellationPolicy(doc?.cancellationPolicy || {});
  cachedAt = now;
  return cached;
}

export async function updateCancellationPolicy(patch = {}) {
  const current = await getCancellationPolicy({ fresh: true });
  const merged = normalizeCancellationPolicy({
    ...current,
    ...(patch || {}),
    selfCancelStages: {
      ...current.selfCancelStages,
      ...((patch && patch.selfCancelStages) || {}),
    },
  });
  await Setting.findOneAndUpdate(
    {},
    { $set: { cancellationPolicy: merged } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  cached = merged;
  cachedAt = Date.now();
  return { previous: current, policy: merged };
}

/** Test hook. */
export function clearCancellationPolicyCache() {
  cached = null;
  cachedAt = 0;
}
