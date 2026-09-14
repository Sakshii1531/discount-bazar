import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import BottomNav from "../components/BottomNav";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { BellRing, MapPin } from "lucide-react";
import { deliveryApi } from "../services/deliveryApi";
import { useAuth } from "@core/context/AuthContext";
import {
  getOrderSocket,
  onDeliveryBroadcast,
  onDeliveryBroadcastWithdrawn,
  onNotificationNew,
} from "@/core/services/orderSocket";
import {
  loadHandledIncomingOrderIds,
  markIncomingOrderHandled,
} from "../utils/deliveryHandledOrders";
import { saveDeliveryPartnerLocation } from "../utils/deliveryLastLocation";
import { createSocketTokenReader } from "@core/utils/authStorage";
import { STORAGE_KEYS } from "@core/utils/storage";
import { formatCurrencyInteger } from "@shared/utils/currency";
import orderAlertSound from "@/assets/sounds/order_alert.mp3";

const getDeliveryToken = createSocketTokenReader(STORAGE_KEYS.AUTH_DELIVERY);

/** Match server `deliverySearchExpiresAt` — progress bar + countdown stay aligned when modal opens late. */
function secondsLeftUntilDeliveryExpiry(expiresAt) {
  if (!expiresAt) return 60;
  const ms = new Date(expiresAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 1000));
}

const extractAddressString = (addr) => {
  if (!addr) return "";
  if (typeof addr === "string") return addr.trim();
  if (typeof addr === "object") {
    if (typeof addr.address === "string" && addr.address.trim()) return addr.address.trim();
    if (typeof addr.fullAddress === "string" && addr.fullAddress.trim()) return addr.fullAddress.trim();
    if (typeof addr.street === "string" && addr.street.trim()) return addr.street.trim();
    const parts = [
      addr.houseNo || addr.flatNo || addr.building || addr.street,
      addr.area || addr.landmark,
      addr.city,
      addr.pincode || addr.zipCode
    ].filter(Boolean);
    if (parts.length > 0) return parts.join(", ");
  }
  return "";
};

const resolveOrderAddresses = (obj, isReturnPickup) => {
  let pickup = "";
  let drop = "";

  if (isReturnPickup) {
    // Return Pickup: Customer Pickup -> Customer Address, Return -> Seller Store
    const custAddr = 
      (typeof obj.preview?.pickup === "string" && obj.preview.pickup !== "Customer Address" ? obj.preview.pickup : "") ||
      (typeof obj.preview?.customerAddress === "string" ? obj.preview.customerAddress : "") ||
      extractAddressString(obj.address) ||
      extractAddressString(obj.deliveryAddress) ||
      extractAddressString(obj.shippingAddress) ||
      (typeof obj.pickup === "string" ? obj.pickup : "") ||
      "Customer Address";

    const sellerAddr = 
      (typeof obj.preview?.drop === "string" && obj.preview.drop !== "Seller Store" ? obj.preview.drop : "") ||
      (typeof obj.preview?.dropAddress === "string" ? obj.preview.dropAddress : "") ||
      obj.seller?.shopName ||
      obj.seller?.name ||
      extractAddressString(obj.seller?.address) ||
      (typeof obj.drop === "string" ? obj.drop : "") ||
      "Seller Store";

    pickup = custAddr;
    drop = sellerAddr;
  } else {
    // Normal Order: Pickup -> Seller Store, Drop -> Customer Address
    const sellerAddr = 
      (typeof obj.preview?.pickup === "string" ? obj.preview.pickup : "") ||
      obj.seller?.shopName ||
      obj.seller?.name ||
      extractAddressString(obj.seller?.address) ||
      (typeof obj.pickup === "string" ? obj.pickup : "") ||
      "Store Location";

    const custAddr = 
      (typeof obj.preview?.drop === "string" ? obj.preview.drop : "") ||
      extractAddressString(obj.address) ||
      extractAddressString(obj.deliveryAddress) ||
      extractAddressString(obj.shippingAddress) ||
      (typeof obj.drop === "string" ? obj.drop : "") ||
      "Customer Location";

    pickup = sellerAddr;
    drop = custAddr;
  }

  return { pickup, drop };
};

const extractOrderValueAndDiscount = (payloadOrOrder) => {
  const p = payloadOrOrder.preview || {};
  const pricing = payloadOrOrder.pricing || {};
  const pb = payloadOrOrder.paymentBreakdown || {};

  const total = typeof p.total === "number" ? p.total : (pricing.total ?? pb.grandTotal ?? (Number(p.total) || 0));
  const rawSubtotal = pricing.subtotal ?? pb.subtotal ?? pb.itemTotal ?? total;
  const couponDiscount = pricing.discount ?? pricing.couponDiscount ?? pb.discountTotal ?? pb.couponDiscount ?? payloadOrOrder.couponSnapshot?.discountAmountApplied ?? 0;
  const couponCode = payloadOrOrder.coupon?.code || payloadOrOrder.couponSnapshot?.code || "";
  const subtotal = rawSubtotal > total ? rawSubtotal : (total + couponDiscount);

  const walletAmount = typeof p.walletAmount === "number"
    ? p.walletAmount
    : (pricing.walletAmount ?? pb.walletAmount ?? (payloadOrOrder.walletAmount ? Number(payloadOrOrder.walletAmount) : 0));

  const paymentMethod = (
    p.paymentMethod ||
    payloadOrOrder.payment?.method ||
    payloadOrOrder.paymentMode ||
    payloadOrOrder.paymentMethod ||
    ""
  ).toLowerCase();

  const isPaidOnline = paymentMethod === "online" || payloadOrOrder.paymentStatus === "PAID" || payloadOrOrder.payment?.status === "completed";
  const isFullyWalletPaid = paymentMethod === "wallet" || (walletAmount > 0 && walletAmount >= total);

  // Cash that delivery partner must collect from customer upon delivery
  const cashToCollect = typeof p.payableAmount === "number"
    ? p.payableAmount
    : (isPaidOnline || isFullyWalletPaid ? 0 : Math.max(0, total - walletAmount));

  return {
    total,
    subtotal,
    couponDiscount,
    couponCode,
    walletAmount,
    paymentMethod,
    isPaidOnline,
    isFullyWalletPaid,
    cashToCollect,
  };
};

const DELIVERY_SETTINGS_KEY = "delivery_app_settings";

function getDeliveryAppSettings() {
  try {
    const raw = localStorage.getItem(DELIVERY_SETTINGS_KEY);
    if (!raw) return { sound: true, vibration: true, pushNotifications: true };
    return { sound: true, vibration: true, pushNotifications: true, ...JSON.parse(raw) };
  } catch {
    return { sound: true, vibration: true, pushNotifications: true };
  }
}

let synthInterval = null;
let audioCtx = null;

const playRingtoneChime = () => {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + 0.3);

    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.4);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.4);
  } catch (e) {
    /* ignore synth errors */
  }
};

const startWebAudioBeepRingtone = () => {
  const appSettings = getDeliveryAppSettings();
  if (!appSettings.sound) return;
  if (synthInterval) return;
  playRingtoneChime();
  synthInterval = setInterval(() => {
    playRingtoneChime();
  }, 800);
};

const stopWebAudioBeepRingtone = () => {
  if (synthInterval) {
    clearInterval(synthInterval);
    synthInterval = null;
  }
};

const DeliveryLayout = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [activeOrder, setActiveOrder] = useState(null);
  const [timeLeft, setTimeLeft] = useState(60);
  const [acceptWindowTotal, setAcceptWindowTotal] = useState(60);
  const mainRef = useRef(null);
  const shownOrderIdsRef = useRef(new Set());
  const activeOrderRef = useRef(null);
  const [isFirstLoad, setIsFirstLoad] = useState(true);
  const [availableOrdersCount, setAvailableOrdersCount] = useState(0);
  const [isAcceptingOrder, setIsAcceptingOrder] = useState(false);
  const acceptInFlightRef = useRef(false);
  const availableOrdersRequestRef = useRef({ inFlight: false, controller: null });

  // Ensure all delivery app pages open from the very top on navigation
  useEffect(() => {
    const scrollToTop = () => {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;

      if (mainRef.current) {
        mainRef.current.scrollTop = 0;
        mainRef.current.scrollTo?.({ top: 0, left: 0, behavior: "instant" });
      }

      const scrollables = document.querySelectorAll(
        ".overflow-y-auto, .overflow-auto, [data-lenis-prevent]"
      );
      scrollables.forEach((el) => {
        el.scrollTop = 0;
      });
    };

    scrollToTop();
    const rafId = requestAnimationFrame(scrollToTop);
    const timeoutId = setTimeout(scrollToTop, 50);

    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(timeoutId);
    };
  }, [location.pathname, location.search]);
  const notificationsRequestRef = useRef({ inFlight: false, controller: null });
  const locationRequestRef = useRef({ inFlight: false, controller: null });
  const orderRingtoneRef = useRef(null);
  const ringtoneRetryTimerRef = useRef(null);
  const ringtoneUnlockHandlerRef = useRef(null);

  useEffect(() => {
    const unlockAudio = () => {
      const audio = getOrderRingtone();
      audio.play().then(() => {
        audio.pause();
        audio.currentTime = 0;
      }).catch(() => {});
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        if (!audioCtx) audioCtx = new Ctx();
        if (audioCtx.state === "suspended") audioCtx.resume();
      }
    };

    window.addEventListener("pointerdown", unlockAudio, { once: true });
    window.addEventListener("touchstart", unlockAudio, { once: true });
    window.addEventListener("keydown", unlockAudio, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("touchstart", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };
  }, []);

  useEffect(() => {
    const handleFocusIn = (e) => {
      const target = e.target;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT")
      ) {
        setTimeout(() => {
          target.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 300);
      }
    };
    window.addEventListener("focusin", handleFocusIn);
    return () => window.removeEventListener("focusin", handleFocusIn);
  }, []);

  const getOrderRingtone = () => {
    if (!orderRingtoneRef.current) {
      const audio = new Audio(orderAlertSound);
      audio.loop = true;
      audio.preload = "auto";
      orderRingtoneRef.current = audio;
    }
    return orderRingtoneRef.current;
  };

  const startOrderRingtone = () => {
    const appSettings = getDeliveryAppSettings();
    const audio = getOrderRingtone();
    audio.loop = true;
    audio.preload = "auto";

    if (appSettings.sound) {
      audio.muted = false;
      audio.volume = 1;
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          startWebAudioBeepRingtone();
        });
      }
    } else {
      // Sound disabled — keep audio muted/paused
      audio.muted = true;
      audio.pause();
    }

    if (appSettings.vibration && typeof navigator !== "undefined" && navigator.vibrate) {
      try {
        navigator.vibrate([400, 200, 400, 200, 400]);
      } catch (e) {}
    }

    if (!ringtoneRetryTimerRef.current) {
      ringtoneRetryTimerRef.current = setInterval(() => {
        if (!activeOrderRef.current) return;
        const currentSettings = getDeliveryAppSettings();
        if (!currentSettings.sound) return;
        const currentAudio = getOrderRingtone();
        if (currentAudio.paused) {
          currentAudio.play().catch(() => {
            startWebAudioBeepRingtone();
          });
        }
      }, 1200);
    }

    if (
      !ringtoneUnlockHandlerRef.current &&
      typeof window !== "undefined" &&
      typeof document !== "undefined"
    ) {
      const unlockPlayback = () => {
        if (!activeOrderRef.current) return;
        const currentSettings = getDeliveryAppSettings();
        if (!currentSettings.sound) return;
        const currentAudio = getOrderRingtone();
        if (currentAudio.paused) {
          currentAudio.play().catch(() => {
            startWebAudioBeepRingtone();
          });
        }
      };
      ringtoneUnlockHandlerRef.current = unlockPlayback;
      window.addEventListener("focus", unlockPlayback);
      document.addEventListener("visibilitychange", unlockPlayback);
      document.addEventListener("pointerdown", unlockPlayback);
      document.addEventListener("touchstart", unlockPlayback);
      document.addEventListener("keydown", unlockPlayback);
    }
  };

  const stopOrderRingtone = () => {
    stopWebAudioBeepRingtone();
    const audio = orderRingtoneRef.current;
    if (ringtoneRetryTimerRef.current) {
      clearInterval(ringtoneRetryTimerRef.current);
      ringtoneRetryTimerRef.current = null;
    }
    if (
      ringtoneUnlockHandlerRef.current &&
      typeof window !== "undefined" &&
      typeof document !== "undefined"
    ) {
      window.removeEventListener("focus", ringtoneUnlockHandlerRef.current);
      document.removeEventListener("visibilitychange", ringtoneUnlockHandlerRef.current);
      document.removeEventListener("pointerdown", ringtoneUnlockHandlerRef.current);
      document.removeEventListener("touchstart", ringtoneUnlockHandlerRef.current);
      document.removeEventListener("keydown", ringtoneUnlockHandlerRef.current);
      ringtoneUnlockHandlerRef.current = null;
    }
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
  };

  useEffect(() => {
    activeOrderRef.current = activeOrder;
  }, [activeOrder]);

  /** While working an active order, do not stack the global incoming-offer modal (fixes refresh on order details). */
  const suppressIncomingModal = useMemo(
    () =>
      /\/delivery\/(confirm-delivery|navigation)/.test(location.pathname),
    [location.pathname],
  );

  useEffect(() => {
    loadHandledIncomingOrderIds().forEach((id) => shownOrderIdsRef.current.add(id));
  }, []);

  const applyFromBroadcastPayload = useCallback((payload) => {
    if (!payload?.orderId) return false;
    if (activeOrderRef.current) return true;
    if (shownOrderIdsRef.current.has(payload.orderId)) return true;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    if (payload.createdAt && new Date(payload.createdAt) < startOfToday) {
      return false;
    }
    const exp = payload.deliverySearchExpiresAt;
    if (exp && secondsLeftUntilDeliveryExpiry(exp) <= 0) {
      return false;
    }
    shownOrderIdsRef.current = new Set(shownOrderIdsRef.current).add(payload.orderId);

    const isReturnPickup = payload.type === "RETURN_PICKUP" || payload.isReturnPickup === true;
    const { pickup, drop } = resolveOrderAddresses(payload, isReturnPickup);
    const { total, subtotal, couponDiscount, couponCode, walletAmount, paymentMethod, isPaidOnline, isFullyWalletPaid, cashToCollect } = extractOrderValueAndDiscount(payload);
    const earnings = typeof payload.preview?.earnings === "number" ? payload.preview.earnings : (payload.paymentBreakdown?.riderPayoutTotal ?? Math.round(total * 0.1));

    setActiveOrder({
      id: payload.orderId,
      mongoId: payload._id,
      pickup,
      drop,
      distance: "Nearby",
      estTime: "10-15 min",
      value: cashToCollect,
      total,
      subtotal,
      couponDiscount,
      couponCode,
      walletAmount,
      paymentMethod,
      isPaidOnline,
      isFullyWalletPaid,
      cashToCollect,
      earnings: earnings,
      expiresAt: payload.deliverySearchExpiresAt || new Date(Date.now() + 60000).toISOString(),
      isReturnPickup,
      items: payload.items || [],
    });
    return true;
  }, []);

  const applyAvailableOrdersList = useCallback((availableOrders) => {
    setAvailableOrdersCount(availableOrders.length);
    if (activeOrderRef.current) return;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const newOrder = availableOrders.find((o) => {
      if (shownOrderIdsRef.current.has(o.orderId)) return false;
      if (o.createdAt && new Date(o.createdAt) < startOfToday) {
        return false;
      }
      if (
        o.deliverySearchExpiresAt &&
        secondsLeftUntilDeliveryExpiry(o.deliverySearchExpiresAt) <= 0
      ) {
        return false;
      }
      return true;
    });
    if (!newOrder) return;
    shownOrderIdsRef.current = new Set(shownOrderIdsRef.current).add(newOrder.orderId);
    const isReturnPickup = newOrder.isReturnPickup || false;

    const { pickup, drop } = resolveOrderAddresses(newOrder, isReturnPickup);
    const { total, subtotal, couponDiscount, couponCode, walletAmount, paymentMethod, isPaidOnline, isFullyWalletPaid, cashToCollect } = extractOrderValueAndDiscount(newOrder);
    const earnings = newOrder.paymentBreakdown?.riderPayoutTotal ?? newOrder.riderEarnings ?? Math.round(total * 0.1);

    setActiveOrder({
      id: newOrder.orderId,
      mongoId: newOrder._id,
      pickup,
      drop,
      distance: "Nearby",
      estTime: "10-15 min",
      value: cashToCollect,
      total,
      subtotal,
      couponDiscount,
      couponCode,
      walletAmount,
      paymentMethod,
      isPaidOnline,
      isFullyWalletPaid,
      cashToCollect,
      earnings: earnings,
      expiresAt: newOrder.deliverySearchExpiresAt || new Date(Date.now() + 60000).toISOString(),
      isReturnPickup,
      items: newOrder.items || [],
    });
  }, []);

  useEffect(() => {
    if (activeOrder) {
      startOrderRingtone();
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "unset";
      };
    }
    stopOrderRingtone();
    document.body.style.overflow = "unset";
    return undefined;
  }, [activeOrder]);

  useEffect(() => {
    return () => {
      stopOrderRingtone();
    };
  }, []);

  const hideBottomNavRoutes = [
    "/delivery/login",
    "/delivery/auth",
    "/delivery/splash",
    "/delivery/navigation",
    "/delivery/confirm-delivery",
    "/delivery/order-details",
    "/delivery/profile/chat",
    "/delivery/profile/call",
  ];

  const shouldShowBottomNav = !hideBottomNavRoutes.some((route) =>
    location.pathname.includes(route),
  );

  const fetchAvailableOrders = useCallback(async () => {
    if (availableOrdersRequestRef.current.inFlight) return null;
    availableOrdersRequestRef.current.inFlight = true;

    if (availableOrdersRequestRef.current.controller) {
      availableOrdersRequestRef.current.controller.abort();
    }
    const controller = new AbortController();
    availableOrdersRequestRef.current.controller = controller;

    try {
      return await deliveryApi.getAvailableOrders({}, {
        signal: controller.signal,
        timeout: 15000,
      });
    } catch (error) {
      if (
        error?.code === "ERR_CANCELED" ||
        error?.name === "CanceledError" ||
        error?.name === "AbortError"
      ) {
        return null;
      }
      throw error;
    } finally {
      if (availableOrdersRequestRef.current.controller === controller) {
        availableOrdersRequestRef.current.controller.abort();
        availableOrdersRequestRef.current.controller = null;
        availableOrdersRequestRef.current.inFlight = false;
      }
    }
  }, []);

  const fetchNotifications = useCallback(async () => {
    if (notificationsRequestRef.current.inFlight) return null;
    notificationsRequestRef.current.inFlight = true;

    if (notificationsRequestRef.current.controller) {
      notificationsRequestRef.current.controller.abort();
    }
    const controller = new AbortController();
    notificationsRequestRef.current.controller = controller;

    try {
      return await deliveryApi.getNotifications({
        signal: controller.signal,
        timeout: 15000,
      });
    } catch (error) {
      if (
        error?.code === "ERR_CANCELED" ||
        error?.name === "CanceledError" ||
        error?.name === "AbortError"
      ) {
        return null;
      }
      throw error;
    } finally {
      if (notificationsRequestRef.current.controller === controller) {
        notificationsRequestRef.current.controller = null;
        notificationsRequestRef.current.inFlight = false;
      }
    }
  }, []);

  const postLocationOnce = useCallback(async (lat, lng) => {
    if (locationRequestRef.current.inFlight) return;
    locationRequestRef.current.inFlight = true;

    if (locationRequestRef.current.controller) {
      locationRequestRef.current.controller.abort();
    }
    const controller = new AbortController();
    locationRequestRef.current.controller = controller;

    try {
      saveDeliveryPartnerLocation(lat, lng);
      await deliveryApi.postLocation(
        { lat, lng },
        { signal: controller.signal, timeout: 10000 },
      );
    } catch {
      /* ignore */
    } finally {
      if (locationRequestRef.current.controller === controller) {
        locationRequestRef.current.controller = null;
        locationRequestRef.current.inFlight = false;
      }
    }
  }, []);

  // Available-orders polling — safety net for missed socket broadcasts.
  //
  // Socket (`onDeliveryBroadcast`) remains the primary delivery channel.
  // This effect adds a low-frequency fallback so a rider who came online
  // *after* the broadcast left the wire, or whose socket dropped without
  // reconnecting, will still see new jobs within ~15s.
  //
  // Guards: only ticks while the rider is online, the foreground tab is
  // visible, no active-order modal is up, and the route isn't already in
  // an active delivery flow (confirm-delivery / navigation). On error we
  // back off exponentially up to 60s so a flaky network doesn't hammer
  // the API.
  useEffect(() => {
    if (!user?.isOnline) {
      if (availableOrdersRequestRef.current.controller) {
        availableOrdersRequestRef.current.controller.abort();
      }
      return undefined;
    }

    let cancelled = false;
    let timer = null;
    let consecutiveErrors = 0;

    const BASE_DELAY_MS = 15000;
    const MAX_DELAY_MS = 60000;

    const tick = async () => {
      if (cancelled) return;
      if (activeOrderRef.current || suppressIncomingModal) return;
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        return;
      }

      try {
        const res = await fetchAvailableOrders();
        if (cancelled || !res) return;
        if (res.data?.success) {
          const availableOrders = res.data.results || res.data.result || [];
          applyAvailableOrdersList(availableOrders);
        }
        consecutiveErrors = 0;
      } catch (error) {
        if (
          error?.code === "ERR_CANCELED" ||
          error?.name === "CanceledError" ||
          error?.name === "AbortError"
        ) {
          return;
        }
        consecutiveErrors += 1;
        console.error("Delivery Polling Error:", error);
      } finally {
        if (isFirstLoad) setIsFirstLoad(false);
      }
    };

    const computeDelay = () => {
      if (!consecutiveErrors) return BASE_DELAY_MS;
      return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (consecutiveErrors - 1));
    };

    const schedule = () => {
      if (cancelled) return;
      timer = setTimeout(async () => {
        await tick();
        schedule();
      }, computeDelay());
    };

    // Kick off immediately, then schedule the recurring tick.
    tick();
    schedule();

    // Wake-up: if the rider tabs back / focuses the window, fetch right
    // away instead of waiting for the next interval tick.
    const wakeUp = () => {
      if (cancelled) return;
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) {
        return;
      }
      tick();
    };
    if (typeof window !== "undefined") {
      window.addEventListener("focus", wakeUp);
      document.addEventListener("visibilitychange", wakeUp);
    }

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", wakeUp);
        document.removeEventListener("visibilitychange", wakeUp);
      }
      if (availableOrdersRequestRef.current.controller) {
        availableOrdersRequestRef.current.controller.abort();
      }
    };
  }, [
    user?.isOnline,
    applyAvailableOrdersList,
    suppressIncomingModal,
    fetchAvailableOrders,
  ]);

  // Background location heartbeat while the rider is online.
  //
  // Seller service-radius matching depends on the latest rider coords on
  // the server. A one-shot `getCurrentPosition` at go-online time goes
  // stale the moment the rider moves, so we run a `watchPosition` here
  // and post a heartbeat at most once every 30s. (The richer/faster
  // ~5s `watchPosition` inside `DeliveryTrackingMap` stays as-is for
  // active deliveries; both can coexist — each has its own POST throttle
  // and the backend further throttles via `shouldThrottle`.)
  //
  // Guards:
  //   - online required (cleanup aborts in-flight POST when toggled off)
  //   - tab hidden → keep updating the local cache so the next route
  //     fetch / map mount uses fresh coords, but skip the network POST
  //     to save battery; resumes on next visible fix.
  useEffect(() => {
    if (
      !user?.isOnline ||
      typeof navigator === "undefined" ||
      !navigator.geolocation
    ) {
      if (locationRequestRef.current.controller) {
        locationRequestRef.current.controller.abort();
      }
      return undefined;
    }

    const HEARTBEAT_MS = 30000;
    let lastPostAt = 0;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

        // Always refresh the local cache so the map / route fetch always
        // has the freshest coords when they mount.
        saveDeliveryPartnerLocation(lat, lng);

        if (
          typeof document !== "undefined" &&
          document.visibilityState === "hidden"
        ) {
          return;
        }

        const now = Date.now();
        if (now - lastPostAt < HEARTBEAT_MS) return;
        lastPostAt = now;
        postLocationOnce(lat, lng);
      },
      () => {
        /* permission denied / position unavailable — silently ignore;
           the rider just won't receive proximity matches until they
           grant location or move into a covered area. */
      },
      { enableHighAccuracy: false, maximumAge: 15000, timeout: 30000 },
    );

    return () => {
      if (watchId !== null && navigator.geolocation?.clearWatch) {
        navigator.geolocation.clearWatch(watchId);
      }
      if (locationRequestRef.current.controller) {
        locationRequestRef.current.controller.abort();
      }
    };
  }, [user?.isOnline, postLocationOnce]);

  useEffect(() => {
    if (user?.isOnline === false) return undefined;
    const getToken = getDeliveryToken;
    getOrderSocket(getToken);
    return onDeliveryBroadcast(getToken, (payload) => {
      if (activeOrderRef.current || suppressIncomingModal) return;
      const opened = applyFromBroadcastPayload(payload);
      if (opened) return;
      fetchAvailableOrders()
        .then((res) => {
          if (!res?.data?.success) return;
          const list = res.data.results || res.data.result || [];
          applyAvailableOrdersList(list);
        })
        .catch(() => { });
    });
  }, [
    user?.isOnline,
    applyAvailableOrdersList,
    applyFromBroadcastPayload,
    suppressIncomingModal,
    fetchAvailableOrders,
  ]);

  useEffect(() => {
    if (!user?.isOnline) return undefined;
    const getToken = getDeliveryToken;
    return onDeliveryBroadcastWithdrawn(getToken, (payload) => {
      const orderId = payload?.orderId;
      if (!orderId) return;

      shownOrderIdsRef.current = new Set(shownOrderIdsRef.current).add(orderId);
      markIncomingOrderHandled(orderId);

      if (activeOrderRef.current?.id === orderId) {
        acceptInFlightRef.current = false;
        setIsAcceptingOrder(false);
        stopOrderRingtone();
        setActiveOrder(null);
        toast.info("Another delivery partner accepted this order.");
      }
    });
  }, [user?.isOnline]);

  useEffect(() => {
    const getToken = getDeliveryToken;
    getOrderSocket(getToken);
    return onNotificationNew(getToken, (payload) => {
      if (payload?.title) {
        toast.info(payload.title, {
          description: payload.message || payload.body,
        });
      }
    });
  }, []);

  // Notifications safety-net polling.
  //
  // Same idea as the available-orders poll above but slower (~25s) since
  // this is the third line of defense: socket → available-orders poll →
  // notifications inbox. If both real-time channels miss a broadcast, the
  // unread notification row eventually surfaces the offer here.
  useEffect(() => {
    if (!user?.isOnline) {
      if (notificationsRequestRef.current.controller) {
        notificationsRequestRef.current.controller.abort();
      }
      return undefined;
    }

    let cancelled = false;
    let timer = null;
    let consecutiveErrors = 0;

    const BASE_DELAY_MS = 25000;
    const MAX_DELAY_MS = 90000;

    const tick = async () => {
      if (cancelled) return;
      if (activeOrderRef.current || suppressIncomingModal) return;
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        return;
      }

      try {
        const res = await fetchNotifications();
        if (cancelled || !res?.data?.success) return;
        const result = res.data.result || res.data.data;
        const notifications = result?.notifications || [];
        if (activeOrderRef.current) return;
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        for (const n of notifications) {
          const isIncomingOrderType =
            n.type === "order" || n.type === "RETURN_PICKUP_ASSIGNED";
          if (!isIncomingOrderType || n.isRead || !n.data?.orderId) continue;
          const notifDate = n.createdAt || n.data?.createdAt;
          if (notifDate && new Date(notifDate) < startOfToday) continue;

          const oid = n.data.orderId;
          if (shownOrderIdsRef.current.has(oid)) continue;
          const fromStored = applyFromBroadcastPayload({
            orderId: oid,
            preview: n.data.preview,
            deliverySearchExpiresAt: n.data.deliverySearchExpiresAt,
            type: n.data.type || (n.data.preview?.type),
            createdAt: notifDate,
          });
          if (fromStored) return;
        }
        consecutiveErrors = 0;
      } catch (error) {
        if (
          error?.code === "ERR_CANCELED" ||
          error?.name === "CanceledError" ||
          error?.name === "AbortError"
        ) {
          return;
        }
        consecutiveErrors += 1;
        /* swallow noisy errors; backoff already throttles retries */
      }
    };

    const computeDelay = () => {
      if (!consecutiveErrors) return BASE_DELAY_MS;
      return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (consecutiveErrors - 1));
    };

    const schedule = () => {
      if (cancelled) return;
      timer = setTimeout(async () => {
        await tick();
        schedule();
      }, computeDelay());
    };

    tick();
    schedule();

    const wakeUp = () => {
      if (cancelled) return;
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) {
        return;
      }
      tick();
    };
    if (typeof window !== "undefined") {
      window.addEventListener("focus", wakeUp);
      document.addEventListener("visibilitychange", wakeUp);
    }

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", wakeUp);
        document.removeEventListener("visibilitychange", wakeUp);
      }
      if (notificationsRequestRef.current.controller) {
        notificationsRequestRef.current.controller.abort();
      }
    };
  }, [
    user?.isOnline,
    applyFromBroadcastPayload,
    applyAvailableOrdersList,
    suppressIncomingModal,
    fetchNotifications,
    fetchAvailableOrders,
  ]);

  const skipOrder = useCallback(async () => {
    const current = activeOrderRef.current;
    if (!current || acceptInFlightRef.current) return;
    try {
      console.log("Delivery Alert - Skipping order:", current.id);
      if (current.isReturnPickup) {
        await deliveryApi.rejectReturnPickup(current.id);
      } else {
        await deliveryApi.skipOrder(current.id);
      }
      shownOrderIdsRef.current = new Set(shownOrderIdsRef.current).add(current.id);
      markIncomingOrderHandled(current.id);
      stopOrderRingtone();
      setActiveOrder(null);
      toast.info("Order skipped");
    } catch (error) {
      console.error("Delivery Alert - Skip failed:", error);
      setActiveOrder(null);
    }
  }, []);

  // Countdown from server deadline (same idea as seller panel)
  useEffect(() => {
    if (!activeOrder) return undefined;
    const left = secondsLeftUntilDeliveryExpiry(activeOrder.expiresAt);
    if (left <= 0) {
      if (!acceptInFlightRef.current) {
        skipOrder();
        toast.error("Order request timed out");
      }
      return undefined;
    }
    setAcceptWindowTotal(left);
    setTimeLeft(left);
    const timer = setInterval(() => {
      const next = secondsLeftUntilDeliveryExpiry(activeOrderRef.current?.expiresAt);
      setTimeLeft(next);
      if (next <= 0) {
        clearInterval(timer);
        if (!acceptInFlightRef.current) {
          skipOrder();
          toast.error("Order request timed out");
        }
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [activeOrder, skipOrder]);

  const handleAcceptOrder = async () => {
    if (!activeOrder || acceptInFlightRef.current) return;
    if (
      activeOrder.expiresAt &&
      secondsLeftUntilDeliveryExpiry(activeOrder.expiresAt) <= 0
    ) {
      toast.error("This request has expired. Try the next one.");
      setActiveOrder(null);
      return;
    }
    acceptInFlightRef.current = true;
    setIsAcceptingOrder(true);
    try {
      console.log("Delivery Alert - Accepting order:", activeOrder.id);
      const idem =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}`;
      if (activeOrder.isReturnPickup) {
        await deliveryApi.acceptReturnPickup(activeOrder.id);
      } else {
        await deliveryApi.acceptOrder(activeOrder.id, idem);
      }
      toast.success("Order accepted!");
      const orderId = activeOrder.id;
      shownOrderIdsRef.current = new Set(shownOrderIdsRef.current).add(orderId);
      markIncomingOrderHandled(orderId);
      stopOrderRingtone();
      setActiveOrder(null);
      navigate(`/delivery/order-details/${orderId}`);
    } catch (error) {
      console.error("Delivery Alert - Accept failed:", error);
      const msg =
        error.response?.data?.message ||
        (typeof error.response?.data === "string" ? error.response.data : null);
      toast.error(msg || "Failed to accept order");
      setActiveOrder(null);
    } finally {
      acceptInFlightRef.current = false;
      setIsAcceptingOrder(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans max-w-md mx-auto relative shadow-2xl overflow-hidden border-x border-gray-100">
      {/* Full-screen order alert — portaled so it always stacks above nav/content */}
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {activeOrder && (
              <div
                className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-slate-900/85 backdrop-blur-sm"
                role="dialog"
                aria-modal="true"
                aria-labelledby="delivery-order-alert-title"
              >
                <motion.div
                  key={activeOrder.id}
                  initial={{ scale: 0.92, opacity: 0, y: 24 }}
                  animate={{ scale: 1, opacity: 1, y: 0 }}
                  exit={{ scale: 0.96, opacity: 0, y: 16 }}
                  transition={{ type: "spring", stiffness: 380, damping: 28 }}
                  className="bg-white rounded-[32px] p-6 w-full max-w-[340px] shadow-2xl border-4 border-primary/20"
                >
                  <div className="flex flex-col items-center">
                    <div className="h-16 w-16 bg-primary/10 rounded-full flex items-center justify-center mb-4 animate-bounce">
                      <BellRing className="h-8 w-8 text-primary" />
                    </div>

                    <h2
                      id="delivery-order-alert-title"
                      className="text-xl font-black text-slate-900 mb-1"
                    >
                      {activeOrder.isReturnPickup ? "Return pickup request" : "New order request"}
                    </h2>
                    <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-4">
                      {activeOrder.isReturnPickup ? "Collect return item" : "Accept or reject"}
                    </p>
                    <div className="flex items-center gap-2 mb-6">
                      <span className="text-2xl font-black text-brand-600">{formatCurrencyInteger(activeOrder.earnings)}</span>
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-wider font-outfit">
                        Earnings
                      </span>
                    </div>

                    <div className="w-full space-y-4 mb-6">
                      {/* Return Items "Small Cart" */}
                      {activeOrder.isReturnPickup && activeOrder.items?.length > 0 && (
                        <div className="bg-slate-50 p-2.5 rounded-2xl border border-slate-100 flex flex-col gap-2">
                          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest px-1">
                            Return Items ({activeOrder.items.length})
                          </p>
                          <div className="flex gap-2 overflow-x-auto no-scrollbar">
                            {activeOrder.items.map((item, idx) => (
                              <div key={idx} className="flex-shrink-0 flex items-center gap-3 bg-white p-2 rounded-xl border border-slate-100 shadow-sm min-w-[140px]">
                                <div className="h-10 w-10 rounded-lg bg-slate-100 overflow-hidden flex-shrink-0">
                                  {item.image ? (
                                    <img src={item.image} alt="" className="h-full w-full object-cover" />
                                  ) : (
                                    <div className="h-full w-full flex items-center justify-center text-slate-300 font-bold text-[8px]">
                                      NO IMG
                                    </div>
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-[10px] font-bold text-slate-900 truncate mb-0.5">
                                    {item.name}
                                  </p>
                                  <p className="text-[10px] font-black text-primary">
                                    {item.quantity} Unit{item.quantity > 1 ? 's' : ''}
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="flex items-start gap-3">
                        <div className="w-5 h-5 rounded-full bg-brand-100 flex items-center justify-center mt-1">
                          <div className="w-2 h-2 rounded-full bg-black " />
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-slate-400 uppercase">
                            {activeOrder.isReturnPickup ? "Customer Pickup" : "Pickup"}
                          </p>
                          <p className="text-sm font-bold text-slate-900">{activeOrder.pickup}</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3">
                        <MapPin className="h-5 w-5 text-rose-500 mt-1 shrink-0" />
                        <div>
                          <p className="text-[10px] font-bold text-slate-400 uppercase">
                            {activeOrder.isReturnPickup ? "Return To Seller" : "Drop Location"}
                          </p>
                          <p className="text-sm font-bold text-slate-900 line-clamp-2">{activeOrder.drop || "Customer Location"}</p>
                        </div>
                      </div>

                      {/* Order Value & Coupon/Wallet Discount breakdown */}
                      <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 space-y-1.5">
                        <div className="flex justify-between items-center text-xs text-slate-600">
                          <span className="font-medium">Total Order Value:</span>
                          <span className="font-bold text-slate-900">{formatCurrencyInteger(activeOrder.subtotal || activeOrder.total)}</span>
                        </div>
                        {activeOrder.couponDiscount > 0 && (
                          <div className="flex justify-between items-center text-xs text-emerald-600 font-bold">
                            <span>Coupon Discount{activeOrder.couponCode ? ` (${activeOrder.couponCode})` : ""}:</span>
                            <span>-{formatCurrencyInteger(activeOrder.couponDiscount)}</span>
                          </div>
                        )}
                        {activeOrder.walletAmount > 0 && (
                          <div className="flex justify-between items-center text-xs text-primary font-bold">
                            <span>Paid via Wallet:</span>
                            <span>-{formatCurrencyInteger(activeOrder.walletAmount)}</span>
                          </div>
                        )}
                        <div className="flex justify-between items-center text-xs font-black text-slate-900 border-t border-slate-200/60 pt-1.5 mt-1">
                          <span>Cash to Collect:</span>
                          <span className={`font-black ${activeOrder.cashToCollect === 0 ? "text-emerald-600" : "text-brand-600"}`}>
                            {activeOrder.cashToCollect === 0 ? "₹0 (Already Paid)" : formatCurrencyInteger(activeOrder.cashToCollect)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="w-full h-1.5 bg-slate-100 rounded-full mb-2 overflow-hidden">
                      <motion.div
                        key={`${activeOrder.id}-${acceptWindowTotal}`}
                        initial={{ width: "100%" }}
                        animate={{ width: "0%" }}
                        transition={{
                          duration: Math.max(1, acceptWindowTotal || 60),
                          ease: "linear",
                        }}
                        className={timeLeft < 10 ? "bg-rose-500 h-full" : "bg-primary h-full"}
                      />
                    </div>
                    <p className="text-[10px] font-bold text-slate-400 mb-4 w-full text-center">
                      {timeLeft}s left to respond
                    </p>

                    <div className="grid grid-cols-2 gap-4 w-full">
                      <button
                        type="button"
                        onClick={skipOrder}
                        disabled={isAcceptingOrder}
                        className="py-4 rounded-2xl bg-slate-100 text-slate-700 font-black text-xs uppercase tracking-wider hover:bg-slate-200/80 disabled:opacity-50 disabled:pointer-events-none"
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        onClick={handleAcceptOrder}
                        disabled={isAcceptingOrder}
                        className="py-4 rounded-2xl bg-primary text-primary-foreground font-black text-xs uppercase tracking-wider shadow-lg shadow-primary/30 active:scale-95 disabled:opacity-60 disabled:pointer-events-none"
                      >
                        {isAcceptingOrder ? "Accepting…" : "Accept"}
                      </button>
                    </div>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>,
          document.body,
        )}

      <main
        ref={mainRef}
        className={`h-full min-h-screen overflow-y-auto ${shouldShowBottomNav ? "pb-24" : ""} no-scrollbar`}>
        <Outlet />
      </main>

      {shouldShowBottomNav && <BottomNav />}
    </div>
  );
};

export default DeliveryLayout;
