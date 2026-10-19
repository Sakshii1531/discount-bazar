import Setting from "../../models/setting.js";
import { communicationEnvDefaults } from "../../constants/orderCommunication.js";
import logger from "../logger.js";

const CACHE_TTL_MS = 30 * 1000;
const OVERRIDABLE_KEYS = [
  "chatEnabled",
  "callEnabled",
  "messageMaxLength",
  "pushPreviewEnabled",
  "riderAssignmentDelayMinutes",
  "pickupDelayEscalationMinutes",
  "messageRetentionDays",
];

let cached = null;
let cachedAt = 0;

/**
 * Resolved communication config: env defaults overlaid with the admin
 * `Setting.communication` overrides. Cached briefly so the hot chat path does
 * not hit Mongo per message; an admin change propagates within the TTL.
 */
export async function getCommunicationConfig() {
  const now = Date.now();
  if (cached && now - cachedAt < CACHE_TTL_MS) return cached;

  const config = communicationEnvDefaults();
  try {
    const setting = await Setting.findOne({
      $or: [{ tenantId: null }, { tenantId: { $exists: false } }],
    })
      .select("communication")
      .lean();
    const overrides = setting?.communication || {};
    for (const key of OVERRIDABLE_KEYS) {
      if (overrides[key] !== undefined && overrides[key] !== null) {
        config[key] = overrides[key];
      }
    }
  } catch (error) {
    logger.warn("Communication config: settings lookup failed, using env defaults", {
      message: error.message,
    });
  }

  cached = config;
  cachedAt = now;
  return config;
}

export function resetCommunicationConfigCache() {
  cached = null;
  cachedAt = 0;
}

/** Subset safe to hand to any authenticated client. */
export function publicCommunicationConfig(config) {
  return {
    chatEnabled: config.chatEnabled,
    callEnabled: config.callEnabled,
    messageMaxLength: config.messageMaxLength,
    riderAssignmentDelayMinutes: config.riderAssignmentDelayMinutes,
    pickupDelayEscalationMinutes: config.pickupDelayEscalationMinutes,
    historyPageSize: config.historyPageSize,
    activeStatuses: config.activeStatuses,
    historyStatuses: config.historyStatuses,
  };
}
