/* eslint-disable no-restricted-globals */

self.addEventListener("notificationclick", (event) => {
  const link = event?.notification?.data?.link || "/";
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.focus();
          client.postMessage({ type: "push:navigate", link });
          return client.navigate ? client.navigate(link) : undefined;
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(link);
      }
      return undefined;
    }),
  );
});

importScripts("https://www.gstatic.com/firebasejs/11.0.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/11.0.0/firebase-messaging-compat.js");

const firebaseConfig = {
  apiKey: "__VITE_FIREBASE_API_KEY__",
  authDomain: "__VITE_FIREBASE_AUTH_DOMAIN__",
  databaseURL: "__VITE_FIREBASE_DATABASE_URL__",
  projectId: "__VITE_FIREBASE_PROJECT_ID__",
  storageBucket: "__VITE_FIREBASE_STORAGE_BUCKET__",
  messagingSenderId: "__VITE_FIREBASE_MESSAGING_SENDER_ID__",
  appId: "__VITE_FIREBASE_APP_ID__",
  measurementId: "__VITE_FIREBASE_MEASUREMENT_ID__",
};

if (!firebaseConfig.apiKey || !firebaseConfig.projectId || firebaseConfig.apiKey.startsWith("__")) {
  console.warn("[firebase-messaging-sw] Missing Firebase web config; background messaging is disabled.");
} else {
  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }

  const messaging = firebase.messaging();

  function buildNotificationOptions(payload = {}) {
    const notification = payload?.notification || {};
    const data = payload?.data || {};
    const title = notification.title || data.title || "Notification";
    let link = data.link || "/";
    if (!data.link || data.link === "/") {
      if (data.role === "seller") {
        const ev = String(data.eventType || "").toUpperCase();
        if (ev.includes("RETURN")) link = "/seller/returns";
        else if (ev.includes("ORDER")) link = "/seller/orders";
        else if (ev.includes("STOCK")) link = "/seller/inventory";
        else if (ev.includes("WITHDRAWAL")) link = "/seller/withdrawals";
        else link = "/seller";
      }
    }
    const tag = notification.tag || data.orderId || data.eventType || "quick-commerce";
    const image = String(notification.image || data.image || data.imageUrl || "").trim();

    const isOrderAlert =
      data.eventType === "NEW_ORDER" ||
      data.type === "NEW_ORDER" ||
      data.eventType === "RETURN_REQUESTED" ||
      data.eventType === "RETURN_DROP_OTP" ||
      data.role === "seller" ||
      data.sound === "order_alert" ||
      String(title).toLowerCase().includes("order") ||
      String(title).toLowerCase().includes("return") ||
      String(tag).toLowerCase().includes("order");

    let safeBody = notification.body || data.body || "";
    if (isOrderAlert && (data.itemAmount || data.netEarnings)) {
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

    return {
      title,
      options: {
        body: safeBody,
        tag,
        icon: "/vite.svg",
        badge: "/vite.svg",
        requireInteraction: true,
        renotify: true,
        silent: false,
        sound: isOrderAlert ? "/sounds/order_alert.mp3" : undefined,
        vibrate: isOrderAlert
          ? [500, 250, 500, 250, 500, 250, 500, 250, 500]
          : [200, 100, 200],
        ...(image ? { image } : {}),
        data: {
          link,
          orderId: data.orderId || "",
          eventType: data.eventType || "",
          role: data.role || "",
          image,
          ...data,
        },
      },
    };
  }

  self.addEventListener("install", () => {
    self.skipWaiting();
  });

  self.addEventListener("activate", (event) => {
    event.waitUntil(self.clients.claim());
  });

  const OFFLINE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>No Internet Connection</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #0f172a;
      color: #0f172a;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: #ffffff;
      border-radius: 28px;
      padding: 36px 24px 30px;
      max-width: 360px;
      width: 100%;
      text-align: center;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.4);
      position: relative;
      overflow: hidden;
    }
    .accent {
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 6px;
      background: linear-gradient(90deg, #ef4444, #f59e0b, #ef4444);
    }
    .icon-box {
      width: 80px;
      height: 80px;
      margin: 8px auto 20px;
      background: #fef2f2;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .icon-box svg {
      width: 40px;
      height: 40px;
      color: #ef4444;
    }
    h1 {
      font-size: 22px;
      font-weight: 800;
      color: #1e293b;
      margin-bottom: 10px;
      letter-spacing: -0.5px;
    }
    p {
      font-size: 14px;
      color: #64748b;
      line-height: 1.5;
      margin-bottom: 22px;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      background: #fef3c7;
      border: 1px solid #fde68a;
      color: #b45309;
      font-size: 12px;
      font-weight: 600;
      border-radius: 999px;
      margin-bottom: 24px;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #f59e0b;
      animation: pulse 1.5s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.8); }
    }
    button {
      width: 100%;
      background: #0f172a;
      color: #ffffff;
      border: none;
      padding: 14px 20px;
      border-radius: 16px;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: all 0.2s;
    }
    button:active {
      transform: scale(0.98);
      background: #1e293b;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="accent"></div>
    <div class="icon-box">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="1" y1="1" x2="23" y2="23"></line>
        <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"></path>
        <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"></path>
        <path d="M10.71 5.05A16 16 0 0 1 22.58 9"></path>
        <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"></path>
        <path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path>
        <line x1="12" y1="20" x2="12.01" y2="20"></line>
      </svg>
    </div>
    <h1>No Internet Connection</h1>
    <p>Please check your mobile data or Wi-Fi. The app will automatically reconnect as soon as you're back online.</p>
    <div class="badge">
      <span class="dot"></span>
      Waiting for network...
    </div>
    <button onclick="window.location.reload()">
      Try Again
    </button>
  </div>
  <script>
    window.addEventListener('online', function() {
      window.location.reload();
    });
    setInterval(function() {
      if (navigator.onLine) {
        fetch('/api/health?_t=' + Date.now(), { method: 'HEAD', cache: 'no-store' })
          .then(function() { window.location.reload(); })
          .catch(function() {});
      }
    }, 3000);
  </script>
</body>
</html>`;

  self.addEventListener("fetch", (event) => {
    if (event.request.mode === "navigate") {
      event.respondWith(
        fetch(event.request).catch(() => {
          return new Response(OFFLINE_HTML, {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }),
      );
    }
  });

  messaging.onBackgroundMessage((payload) => {
    const { title, options } = buildNotificationOptions(payload);
    self.registration.showNotification(title, options);
  });
}
