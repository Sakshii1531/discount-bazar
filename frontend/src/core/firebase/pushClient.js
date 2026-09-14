import { isSupported, getMessaging, getToken, onMessage } from "firebase/messaging";
import { getFirebaseApp } from "./client";
import axiosInstance from "@core/api/axios";
import TurboCartBridge from "../../lib/turboCartBridge";
import { rawGet, rawSet, rawRemove, KEY_PREFIXES } from "@core/utils/storage";

let foregroundListenerStarted = false;
let foregroundUnsubscribe = null;
const GESTURE_EVENTS = ["pointerdown", "touchstart", "click", "keydown"];
const gestureHandlers = new Map();

function registeredKey(role = "customer") {
  return `${KEY_PREFIXES.PUSH_REGISTERED}${String(role || "customer").toLowerCase()}`;
}

function tokenKey(role = "customer") {
  return `${KEY_PREFIXES.PUSH_FCM_TOKEN}${String(role || "customer").toLowerCase()}`;
}

export function hasRegisteredFcmToken(role = "customer") {
  return rawGet(registeredKey(role), { storage: "session" }) === "1";
}

export function getStoredFcmToken(role = "customer") {
  return rawGet(tokenKey(role)) || "";
}

export function clearStoredFcmToken(role = "customer") {
  rawRemove(tokenKey(role));
  rawRemove(registeredKey(role), { storage: "session" });
}

function persistStoredFcmToken(role = "customer", token = "") {
  if (!token) return;
  rawSet(tokenKey(role), token);
  rawSet(registeredKey(role), "1", { storage: "session" });
}

export function describePushSupport() {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return { supported: false, reason: "no-window" };
  }

  if (!window.isSecureContext) {
    return { supported: false, reason: "insecure-context" };
  }

  const ua = String(navigator.userAgent || "");
  const isIOS = /iPad|iPhone|iPod/i.test(ua);
  const isSafari = /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
  const isStandalone = window.matchMedia?.("(display-mode: standalone)")?.matches || navigator.standalone === true;

  if (isIOS && isSafari && !isStandalone) {
    return {
      supported: false,
      reason: "ios-safari-not-standalone",
      message: "On iPhone/iPad Safari, push notifications work only after installing the app to Home Screen.",
    };
  }

  if (window.Flutter) {
    return { supported: true, reason: "flutter-native" };
  }

  return { supported: true, reason: "ok" };
}

async function ensureServiceWorkerRegistration() {
  if (!("serviceWorker" in navigator)) {
    throw new Error("Service workers are not supported in this browser");
  }
  const swUrl = "/firebase-messaging-sw.js";

  // Detect broken SPA hosting rewrites where SW URL serves index.html.
  try {
    const swResponse = await fetch(swUrl, { cache: "no-store" });
    if (!swResponse.ok) {
      throw new Error(`Service worker script not reachable (${swResponse.status})`);
    }
    const contentType = String(swResponse.headers.get("content-type") || "").toLowerCase();
    if (contentType.includes("text/html")) {
      throw new Error(
        "Service worker URL returned HTML. Check production rewrites and exclude /firebase-messaging-sw.js from SPA fallback.",
      );
    }
  } catch (error) {
    throw new Error(error?.message || "Unable to validate service worker script");
  }

  // Must be at site root for FCM web push.
  const registration = await navigator.serviceWorker.register(swUrl, {
    updateViaCache: "none",
  });
  await registration.update();
  await navigator.serviceWorker.ready;
  return registration;
}

async function showSystemNotification({ title, body, data } = {}) {
  // Check delivery or seller app settings before showing any notification
  const isDeliveryRole = data?.role === "delivery";
  const isSellerRole = data?.role === "seller";

  if (isDeliveryRole || isSellerRole) {
    try {
      const storageKey = isDeliveryRole ? "delivery_app_settings" : "seller_app_settings";
      const raw = localStorage.getItem(storageKey);
      const appSettings = raw ? JSON.parse(raw) : {};
      if (appSettings.pushNotifications === false) {
        // User disabled push notifications — suppress entirely
        return;
      }
    } catch {
      /* ignore parse errors */
    }
  }

  const safeTitle = String(title || "Notification");
  let link = data?.link || "/";
  if ((!data?.link || data?.link === "/") && isSellerRole) {
    const ev = String(data?.eventType || "").toUpperCase();
    if (ev.includes("RETURN")) link = "/seller/returns";
    else if (ev.includes("ORDER")) link = "/seller/orders";
    else if (ev.includes("STOCK")) link = "/seller/inventory";
    else if (ev.includes("WITHDRAWAL")) link = "/seller/withdrawals";
    else link = "/seller";
  }
  const tag = data?.orderId || data?.eventType || "quick-commerce";
  const image = String(data?.image || data?.imageUrl || "").trim();

  const isOrderAlert =
    data?.eventType === "NEW_ORDER" ||
    data?.type === "NEW_ORDER" ||
    data?.eventType === "RETURN_REQUESTED" ||
    data?.eventType === "RETURN_DROP_OTP" ||
    data?.role === "seller" ||
    data?.sound === "order_alert" ||
    String(safeTitle).toLowerCase().includes("order") ||
    String(safeTitle).toLowerCase().includes("return") ||
    String(tag).toLowerCase().includes("order");

  let safeBody = String(body || "");
  if (isOrderAlert && (data?.itemAmount || data?.netEarnings)) {
    const itemAmount = data.itemAmount ? Math.round(Number(data.itemAmount)) : null;
    const netEarnings = data.netEarnings ? Math.round(Number(data.netEarnings)) : null;
    if (!safeBody || (!safeBody.includes("Item Amount") && !safeBody.includes("Net Earning"))) {
      const parts = [];
      if (data.orderId) parts.push(`Order #${data.orderId}`);
      if (itemAmount != null && !isNaN(itemAmount)) parts.push(`Item Amount: ₹${itemAmount}`);
      if (netEarnings != null && !isNaN(netEarnings)) parts.push(`Net Earning: ₹${netEarnings}`);
      if (parts.length > 0) safeBody = parts.join(" • ");
    }
  }

  // Determine if sound/vibration should be suppressed for delivery/seller role
  let silentOverride = false;
  let vibrateOverride = undefined;
  if (isDeliveryRole || isSellerRole) {
    try {
      const storageKey = isDeliveryRole ? "delivery_app_settings" : "seller_app_settings";
      const raw = localStorage.getItem(storageKey);
      const appSettings = raw ? JSON.parse(raw) : {};
      if (appSettings.sound === false) {
        silentOverride = true;
      }
      if (appSettings.vibration === false) {
        vibrateOverride = []; // empty array = no vibration
      }
    } catch {
      /* ignore */
    }
  }

  const notificationOptions = {
    body: safeBody,
    tag,
    icon: "/vite.svg",
    badge: "/vite.svg",
    requireInteraction: true,
    renotify: true,
    silent: silentOverride || false,
    sound: (!silentOverride && isOrderAlert) ? "/sounds/order_alert.mp3" : undefined,
    vibrate: vibrateOverride !== undefined
      ? vibrateOverride
      : (isOrderAlert
        ? [500, 250, 500, 250, 500, 250, 500, 250, 500]
        : [200, 100, 200]),
    ...(image ? { image } : {}),
    data: {
      link,
      orderId: data?.orderId || "",
      eventType: data?.eventType || "",
      role: data?.role || "",
      image,
      ...data,
    },
  };

  // Prefer SW notifications so they land in the OS notification center consistently.
  try {
    const reg = await navigator.serviceWorker.ready;
    if (reg?.showNotification) {
      await reg.showNotification(safeTitle, notificationOptions);
      return;
    }
  } catch {
    // fallback below
  }

  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    new Notification(safeTitle, notificationOptions);
  }
}

export async function ensureFcmTokenRegistered({
  role = "customer",
  platform = "web",
  device = "",
} = {}) {
  const support = describePushSupport();
  if (!support.supported) {
    throw new Error(support.message || `Push unsupported: ${support.reason}`);
  }

  if (!window.Flutter) {
    const supported = await isSupported().catch(() => false);
    if (!supported) {
      throw new Error("Firebase Messaging is not supported in this environment");
    }
  }

  let token = "";

  if (window.Flutter) {
    // Get token from Flutter native layer
    token = await TurboCartBridge.getFcmToken();
    if (!token) {
      throw new Error("Failed to obtain native FCM token from Flutter");
    }
    // Set platform to 'app' to match backend validation (instead of android/ios)
    platform = "app";
  } else {
    const app = getFirebaseApp();
    if (!app) {
      throw new Error("Firebase is not configured (missing VITE_FIREBASE_* env)");
    }

    const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
    if (!vapidKey) {
      throw new Error("Missing VITE_FIREBASE_VAPID_KEY");
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      throw new Error("Notification permission not granted");
    }

    const swRegistration = await ensureServiceWorkerRegistration();
    const messaging = getMessaging(app);
    token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: swRegistration });
    if (!token) {
      throw new Error("Failed to obtain FCM token");
    }
  }

  try {
    await axiosInstance.post("/push/register", {
      token,
      platform,
      device: device || navigator.userAgent,
    });
    persistStoredFcmToken(role, token);
    return token;
  } catch (error) {
    if (error.response?.status === 401 || error.response?.status === 404) {
      console.warn("[push] FCM registration skipped due to invalid token/user:", error?.message || error);
      return null;
    }
    throw error;
  }
}

export function scheduleFcmRegistrationOnUserGesture({
  role = "customer",
  platform = "web",
  device = "",
  onSuccess,
  onError,
} = {}) {
  if (typeof window === "undefined") return () => {};
  const key = String(role || "customer").toLowerCase();

  // Avoid duplicate listener stacks for the same role.
  const existingCleanup = gestureHandlers.get(key);
  if (existingCleanup) {
    return existingCleanup;
  }

  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    for (const eventName of GESTURE_EVENTS) {
      window.removeEventListener(eventName, handler, true);
    }
    gestureHandlers.delete(key);
  };

  const handler = async () => {
    remove();
    try {
      const token = await ensureFcmTokenRegistered({ role: key, platform, device });
      if (typeof onSuccess === "function") onSuccess(token);
    } catch (error) {
      if (typeof onError === "function") onError(error);
    }
  };

  for (const eventName of GESTURE_EVENTS) {
    window.addEventListener(eventName, handler, { capture: true, once: true, passive: true });
  }

  gestureHandlers.set(key, remove);
  return remove;
}

export async function removeStoredFcmToken({
  role = "customer",
  token = "",
} = {}) {
  const candidateToken = String(token || getStoredFcmToken(role) || "").trim();
  if (!candidateToken) {
    clearStoredFcmToken(role);
    return false;
  }

  await axiosInstance.delete("/push/remove", {
    data: {
      token: candidateToken,
    },
  });

  clearStoredFcmToken(role);
  return true;
}

export async function startForegroundPushListener() {
  if (foregroundListenerStarted && foregroundUnsubscribe) {
    return foregroundUnsubscribe;
  }

  if (!window.Flutter) {
    const supported = await isSupported().catch(() => false);
    if (!supported) return () => {};
  }

  const app = getFirebaseApp();
  if (!app && !window.Flutter) return () => {};

  // If in Flutter, the native app handles foreground notifications, 
  // but we can still return a dummy unsubscribe.
  if (window.Flutter) {
    return () => {};
  }

  // Ensure SW exists (helps with consistent notification center behavior).
  try {
    await ensureServiceWorkerRegistration();
  } catch {
    // ignore
  }

  const messaging = getMessaging(app);
  const unsubscribe = onMessage(messaging, async (payload) => {
    const title =
      payload?.notification?.title || payload?.data?.title || "Notification";
    const body =
      payload?.notification?.body || payload?.data?.body || "";
    await showSystemNotification({
      title,
      body,
      data: payload?.data || {},
    });
  });

  foregroundListenerStarted = true;
  foregroundUnsubscribe = unsubscribe;
  return unsubscribe;
}

export default {
  describePushSupport,
  clearStoredFcmToken,
  ensureFcmTokenRegistered,
  getStoredFcmToken,
  hasRegisteredFcmToken,
  removeStoredFcmToken,
  scheduleFcmRegistrationOnUserGesture,
  startForegroundPushListener,
};
