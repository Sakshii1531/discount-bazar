import logger from "../../services/logger.js";

export function emitNotificationEvent(eventType, payload = {}) {
  if (process.env.NODE_ENV === "test") {
    return;
  }
  setImmediate(async () => {
    try {
      const { notify } = await import("./notification.service.js");
      await notify(eventType, payload);
    } catch (error) {
      logger.error("Failed to emit notification event", {
        eventType,
        message: error.message,
      });
    }
  });
}

/**
 * Silence an order alert on every device of the given users (a seller or
 * rider logged in on several phones). Best-effort and deferred, like
 * emitNotificationEvent: a failed dismissal must never block the order flow.
 */
export function emitOrderAlertDismiss(role, userIds = [], orderId, reason = "") {
  if (process.env.NODE_ENV === "test") {
    return;
  }
  const ids = [...new Set((Array.isArray(userIds) ? userIds : [userIds])
    .map((id) => (id && typeof id === "object" && id._id ? id._id : id))
    .filter(Boolean)
    .map(String))];
  if (!role || !ids.length || !orderId) return;

  setImmediate(async () => {
    try {
      const [{ default: PushToken }, { sendFCMDismiss }, { deactivateInvalidTokens }] =
        await Promise.all([
          import("./token.model.js"),
          import("./firebase.service.js"),
          import("./notification.worker.js"),
        ]);
      const tokens = await PushToken.find({
        userId: { $in: ids },
        role,
        isActive: true,
      })
        .select("_id token")
        .lean();
      if (!tokens.length) return;

      const result = await sendFCMDismiss(
        tokens.map((t) => t.token),
        { orderId, reason },
      );
      await deactivateInvalidTokens(tokens, result.responses || []);
    } catch (error) {
      logger.warn("Failed to dismiss order alert on devices", {
        role,
        orderId,
        message: error.message,
      });
    }
  });
}

export default {
  emitNotificationEvent,
  emitOrderAlertDismiss,
};
