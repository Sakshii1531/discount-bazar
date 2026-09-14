import admin from "firebase-admin";
import { getFirebaseAdminApp } from "../../config/firebaseAdmin.js";

const MAX_FCM_MULTICAST_TOKENS = 500;

function toStringMap(data = {}) {
  const out = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (value == null) continue;
    if (typeof value === "string") {
      out[key] = value;
      continue;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      out[key] = String(value);
      continue;
    }
    out[key] = JSON.stringify(value);
  }
  return out;
}

function chunkArray(input = [], size = MAX_FCM_MULTICAST_TOKENS) {
  const chunks = [];
  for (let i = 0; i < input.length; i += size) {
    chunks.push(input.slice(i, i + size));
  }
  return chunks;
}

function getMessagingClient() {
  const app = getFirebaseAdminApp();
  if (!app) {
    const err = new Error("Firebase Admin is not configured for push notifications");
    err.code = "fcm/not-configured";
    throw err;
  }
  return admin.messaging(app);
}

function isWebLink(value = "") {
  const link = String(value || "").trim();
  return /^https?:\/\//i.test(link);
}

function resolveImageUrl(payload = {}, data = {}) {
  const fromData = String(
    data.imageUrl ||
      data.image ||
      payload?.imageUrl ||
      payload?.image ||
      "",
  ).trim();
  return isWebLink(fromData) ? fromData : "";
}

export async function sendFCM(tokens = [], payload = {}) {
  if (!Array.isArray(tokens) || tokens.length === 0) {
    return {
      successCount: 0,
      failureCount: 0,
      responses: [],
    };
  }

  const messaging = getMessagingClient();
  const data = toStringMap(payload.data || {});
  const link = data.link || payload?.data?.link || "";
  const resolvedLink = isWebLink(link) ? link : "";
  const title = payload.title || "";
  const body = payload.body || payload.message || "";
  const tag = data.orderId || data.eventType || "quick-commerce";
  const image = resolveImageUrl(payload, data);
  const chunks = chunkArray(tokens, MAX_FCM_MULTICAST_TOKENS);

  const merged = {
    successCount: 0,
    failureCount: 0,
    responses: [],
  };

  const isOrderAlert =
    data.eventType === "NEW_ORDER" ||
    data.type === "NEW_ORDER" ||
    data.eventType === "order" ||
    data.eventType === "RETURN_REQUESTED" ||
    data.eventType === "RETURN_DROP_OTP" ||
    data.role === "seller" ||
    payload.type === "NEW_ORDER" ||
    String(title).toLowerCase().includes("order") ||
    String(title).toLowerCase().includes("return");

  if (isOrderAlert) {
    data.sound = "order_alert";
    data.vibrate = "1";
    data.priority = "high";
  }

  for (const chunk of chunks) {
    const result = await messaging.sendEachForMulticast({
      tokens: chunk,
      notification: {
        title,
        body,
        ...(image ? { image } : {}),
      },
      data,
      android: {
        priority: "high",
        notification: {
          title,
          body,
          sound: isOrderAlert ? "order_alert" : "default",
          channelId: isOrderAlert ? "order_alert" : "default",
          priority: "high",
          notificationPriority: "PRIORITY_MAX",
          defaultSound: !isOrderAlert,
          defaultVibrateTimings: true,
          visibility: "PUBLIC",
          ...(image ? { image } : {}),
        },
      },
      apns: {
        headers: {
          "apns-priority": "10",
        },
        payload: {
          aps: {
            alert: {
              title,
              body,
            },
            sound: isOrderAlert ? "order_alert.mp3" : "default",
            badge: 1,
            contentAvailable: true,
          },
        },
      },
      webpush: {
        headers: {
          Urgency: "high",
          TTL: String(60 * 60),
        },
        notification: {
          title,
          body,
          tag,
          requireInteraction: true,
          renotify: true,
          silent: false,
          sound: isOrderAlert ? "/sounds/order_alert.mp3" : "default",
          vibrate: isOrderAlert ? [500, 250, 500, 250, 500, 250, 500, 250, 500] : [200, 100, 200],
          ...(image ? { image } : {}),
          data: { link: resolvedLink || link, ...data },
        },
        fcmOptions: resolvedLink ? { link: resolvedLink } : undefined,
      },
    });

    merged.successCount += Number(result.successCount || 0);
    merged.failureCount += Number(result.failureCount || 0);
    merged.responses.push(...(result.responses || []));
  }

  return merged;
}

export default {
  sendFCM,
};
