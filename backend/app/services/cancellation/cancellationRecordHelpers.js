import mongoose from "mongoose";
import OrderCancellation from "../../models/orderCancellation.js";

function toObjectId(id) {
  if (!id) return null;
  const s = String(id?._id || id);
  return mongoose.Types.ObjectId.isValid(s) ? new mongoose.Types.ObjectId(s) : null;
}

/** Build one audit-log entry (actor, timestamp, status and money changes). */
export function appendAudit({
  action,
  actorRole = "system",
  actorId = null,
  previousStatus = null,
  newStatus = null,
  orderStatusBefore = null,
  orderStatusAfter = null,
  financial,
  note = null,
}) {
  return {
    action,
    actorRole,
    actorId: toObjectId(actorId),
    at: new Date(),
    previousStatus,
    newStatus,
    orderStatusBefore,
    orderStatusAfter,
    ...(financial ? { financial } : {}),
    note,
  };
}

/** Outbox entry; dispatched (and retried) by cancellationNotificationService. */
export function outboxEntry({ key, event, payload = {} }) {
  return { key, event, payload, status: "PENDING", attempts: 0 };
}

/**
 * Add a notification to a record's outbox unless one with the same key is
 * already queued — the key makes repeated transitions notify once.
 */
export async function queueNotification(recordId, entry, { session } = {}) {
  await OrderCancellation.updateOne(
    { _id: recordId, "notifications.key": { $ne: entry.key } },
    {
      $push: { notifications: outboxEntry(entry) },
      $set: { "processing.state": "PENDING", "processing.nextRetryAt": new Date() },
    },
    session ? { session } : {},
  );
}

export function serviceError(message, statusCode, code, extra = {}) {
  return Object.assign(new Error(message), { statusCode, code, ...extra });
}
