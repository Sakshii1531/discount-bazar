import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useAuth } from "@core/context/AuthContext";
import axiosInstance from "@core/api/axios";
import { onNotificationNew, onAdminPendingUpdate } from "@core/services/orderSocket";

const defaultPendingReview = {
  pendingSellers: 0,
  pendingDrivers: 0,
  pendingProducts: 0,
  pendingWithdrawals: 0,
  refreshPendingCounts: () => {},
};

const PendingReviewContext = createContext(defaultPendingReview);

export const PendingReviewProvider = ({ children }) => {
  const { token, role } = useAuth();
  const [pendingSellers, setPendingSellers] = useState(0);
  const [pendingDrivers, setPendingDrivers] = useState(0);
  const [pendingProducts, setPendingProducts] = useState(0);
  const [pendingWithdrawals, setPendingWithdrawals] = useState(0);

  const fetchCounts = useCallback(async () => {
    const r = String(role || "").toLowerCase();
    if (!token || r !== "admin") return;

    try {
      const response = await axiosInstance.get("/admin/pending-review-counts");
      if (response?.data?.result) {
        setPendingSellers(Number(response.data.result.pendingSellers) || 0);
        setPendingDrivers(Number(response.data.result.pendingDrivers) || 0);
        setPendingProducts(Number(response.data.result.pendingProducts) || 0);
        setPendingWithdrawals(Number(response.data.result.pendingWithdrawals) || 0);
      }
    } catch (err) {
      console.error("[PendingReviewContext] Failed to fetch review counts:", err?.message);
    }
  }, [token, role]);

  // Initial fetch and on role/token changes
  useEffect(() => {
    fetchCounts();
  }, [fetchCounts]);

  // Socket listeners for real-time updates
  useEffect(() => {
    const r = String(role || "").toLowerCase();
    if (!token || r !== "admin") return;

    const getToken = () => token;

    // Listen to admin pending update broadcast
    const offPendingUpdate = onAdminPendingUpdate(getToken, (payload) => {
      if (
        payload &&
        typeof payload.pendingSellers === "number" &&
        typeof payload.pendingDrivers === "number" &&
        typeof payload.pendingProducts === "number"
      ) {
        setPendingSellers(payload.pendingSellers);
        setPendingDrivers(payload.pendingDrivers);
        setPendingProducts(payload.pendingProducts);
        if (typeof payload.pendingWithdrawals === "number") {
          setPendingWithdrawals(payload.pendingWithdrawals);
        }
      } else {
        fetchCounts();
      }
    });

    // Listen to new notifications in case of registration or product moderation events
    const offNotif = onNotificationNew(getToken, (notification) => {
      const eventName = notification?.event || notification?.data?.event;
      if (
        eventName === "NEW_SELLER_REGISTRATION" ||
        eventName === "NEW_DELIVERY_REGISTRATION" ||
        eventName === "PRODUCT_MODERATION_REQUEST" ||
        eventName === "WITHDRAWAL_REQUESTED"
      ) {
        fetchCounts();
      }
    });

    return () => {
      offPendingUpdate?.();
      offNotif?.();
    };
  }, [token, role, fetchCounts]);

  return (
    <PendingReviewContext.Provider
      value={{
        pendingSellers,
        pendingDrivers,
        pendingProducts,
        pendingWithdrawals,
        refreshPendingCounts: fetchCounts,
      }}
    >
      {children}
    </PendingReviewContext.Provider>
  );
};

export const usePendingReview = () => {
  const context = useContext(PendingReviewContext);
  return context || defaultPendingReview;
};

export default PendingReviewContext;
