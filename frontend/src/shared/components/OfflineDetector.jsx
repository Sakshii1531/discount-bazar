import React, { useState, useEffect, useCallback, useRef } from "react";
import { WifiOff, RefreshCw, AlertTriangle, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

export const checkOnlineStatus = async () => {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return false;
  }
  try {
    // Lightweight HEAD ping with cache busting to verify genuine connectivity
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(`/api/health?_t=${Date.now()}`, {
      method: "HEAD",
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return res.ok || res.status < 500;
  } catch {
    // If backend ping fails, try standard public ping as fallback
    try {
      const controller2 = new AbortController();
      const timeoutId2 = setTimeout(() => controller2.abort(), 3000);
      await fetch(`https://www.google.com/generate_204?_t=${Date.now()}`, {
        method: "HEAD",
        mode: "no-cors",
        cache: "no-store",
        signal: controller2.signal,
      });
      clearTimeout(timeoutId2);
      return true;
    } catch {
      return false;
    }
  }
};

const OfflineDetector = () => {
  const [isOffline, setIsOffline] = useState(() => {
    return typeof navigator !== "undefined" ? !navigator.onLine : false;
  });
  const [isChecking, setIsChecking] = useState(false);
  const wasOfflineRef = useRef(isOffline);

  const handleOnline = useCallback(async () => {
    const reallyOnline = await checkOnlineStatus();
    if (reallyOnline) {
      setIsOffline(false);
      if (wasOfflineRef.current) {
        toast.success("Back Online! Connection restored.", {
          id: "network-status-toast",
          duration: 3000,
        });
        wasOfflineRef.current = false;
      }
    }
  }, []);

  const handleOffline = useCallback(() => {
    setIsOffline(true);
    wasOfflineRef.current = true;
  }, []);

  useEffect(() => {
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Custom event dispatched by axios interceptor on network failure
    const handleAppOffline = () => {
      setIsOffline(true);
      wasOfflineRef.current = true;
    };
    window.addEventListener("app:offline", handleAppOffline);

    // Periodic check while offline to auto-recover without user intervention
    let intervalId = null;
    if (isOffline) {
      intervalId = setInterval(async () => {
        const status = await checkOnlineStatus();
        if (status) {
          handleOnline();
        }
      }, 4000);
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("app:offline", handleAppOffline);
      if (intervalId) clearInterval(intervalId);
    };
  }, [isOffline, handleOnline, handleOffline]);

  const handleRetry = async () => {
    setIsChecking(true);
    const online = await checkOnlineStatus();
    setIsChecking(false);
    if (online) {
      handleOnline();
    } else {
      toast.error("Still offline. Please check your data or Wi-Fi.", {
        id: "network-retry-error",
        duration: 2500,
      });
    }
  };

  return (
    <AnimatePresence>
      {isOffline && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 z-[9999999] flex flex-col items-center justify-center p-6 bg-slate-900/90 backdrop-blur-md font-['Outfit',_sans-serif] text-slate-900 select-none"
          data-lenis-prevent
        >
          <motion.div
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, y: 20 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="w-full max-w-sm bg-white rounded-3xl p-7 text-center shadow-2xl border border-slate-100 flex flex-col items-center relative overflow-hidden"
          >
            {/* Top decorative accent bar */}
            <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-red-500 via-amber-500 to-red-500" />

            {/* Pulsing Icon */}
            <div className="relative mb-5 mt-2">
              <div className="w-20 h-20 rounded-full bg-red-50 flex items-center justify-center text-red-500 relative z-10 shadow-inner">
                <WifiOff className="w-10 h-10 animate-pulse text-red-500" strokeWidth={2.2} />
              </div>
              <div className="absolute inset-0 rounded-full bg-red-400/20 animate-ping" />
            </div>

            {/* Title */}
            <h2 className="text-2xl font-black text-slate-800 tracking-tight mb-2">
              No Internet Connection
            </h2>

            {/* Message */}
            <p className="text-sm text-slate-500 font-medium leading-relaxed mb-6 px-2">
              Please check your mobile data or Wi-Fi connection. The app will automatically reconnect as soon as you're back online.
            </p>

            {/* Status Pill */}
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200/60 text-amber-700 text-xs font-semibold mb-6">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
              Waiting for network...
            </div>

            {/* Action Buttons */}
            <button
              onClick={handleRetry}
              disabled={isChecking}
              className="w-full flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 active:scale-[0.98] text-white py-3.5 px-6 rounded-2xl font-bold text-sm shadow-lg shadow-slate-900/20 transition-all disabled:opacity-60 cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${isChecking ? "animate-spin" : ""}`} />
              {isChecking ? "Checking connection..." : "Try Again"}
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default OfflineDetector;
