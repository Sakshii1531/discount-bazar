/**
 * Reliable cancellation notifications.
 *
 * Every notification is first persisted in the cancellation record's outbox
 * in the same write as the state change it announces. Dispatch happens after
 * commit and is retried by the reconcile job until it succeeds, so a push or
 * network failure never loses a notification — and never affects whether the
 * cancellation itself succeeded.
 */
import Admin from "../../models/admin.js";
import OrderCancellation from "../../models/orderCancellation.js";
import { NOTIFICATION_DELIVERY_STATUS } from "../../constants/cancellation.js";
import logger from "../logger.js";

const MAX_NOTIFICATION_ATTEMPTS = () =>
  parseInt(process.env.CANCELLATION_NOTIFY_MAX_ATTEMPTS || "6", 10);

/** Events whose admin copy needs the current admin list. */
const ADMIN_EVENTS = new Set([
  "CANCELLATION_REQUESTED",
  "CANCELLATION_WITHDRAWN",
  "CANCELLATION_TRANSFERRED",
  "REFUND_FAILED",
]);

async function adminIds() {
  const admins = await Admin.find().select("_id").lean();
  return admins.map((a) => a._id);
}

async function send(event, payload) {
  if (process.env.NODE_ENV === "test") return;
  const { notify } = await import("../../modules/notifications/notification.service.js");
  const enriched = ADMIN_EVENTS.has(event) ? { ...payload, adminIds: await adminIds() } : payload;
  await notify(event, enriched);
}

/** Dispatch every undelivered outbox entry. Returns true when none remain. */
export async function dispatchCancellationNotifications(recordId) {
  const record = await OrderCancellation.findById(recordId).select("notifications").lean();
  if (!record) return true;
  let remaining = 0;

  for (const entry of record.notifications || []) {
    if (entry.status === NOTIFICATION_DELIVERY_STATUS.SENT) continue;
    if ((entry.attempts || 0) >= MAX_NOTIFICATION_ATTEMPTS()) continue;
    try {
      await send(entry.event, { ...(entry.payload || {}), eventId: `${recordId}:${entry.key}` });
      await OrderCancellation.updateOne(
        { _id: recordId },
        {
          $set: {
            "notifications.$[n].status": NOTIFICATION_DELIVERY_STATUS.SENT,
            "notifications.$[n].sentAt": new Date(),
            "notifications.$[n].lastError": null,
          },
          $inc: { "notifications.$[n].attempts": 1 },
        },
        { arrayFilters: [{ "n.key": entry.key }] },
      );
    } catch (error) {
      remaining += 1;
      await OrderCancellation.updateOne(
        { _id: recordId },
        {
          $set: {
            "notifications.$[n].status": NOTIFICATION_DELIVERY_STATUS.FAILED,
            "notifications.$[n].lastError": error.message,
          },
          $inc: { "notifications.$[n].attempts": 1 },
        },
        { arrayFilters: [{ "n.key": entry.key }] },
      );
      logger.warn("cancellation notification failed; will retry", {
        scope: "dispatchCancellationNotifications",
        cancellationId: String(recordId),
        event: entry.event,
        error: error.message,
      });
    }
  }
  return remaining === 0;
}
