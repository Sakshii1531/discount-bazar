import React, { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@core/context/AuthContext";
import ReceiptPrint from "../pos/ReceiptPrint";
import { sellerApi } from "../../services/sellerApi";

/**
 * Bill / tax invoice for any seller order (online app orders and POS bills alike).
 *
 * `openBill(orderId)` always loads the order fresh from the server, so the
 * bill shows the current payment status, frozen line prices / GST snapshots
 * and the store header — then opens the same bill layout the New Sale (POS)
 * counter and the admin order page use (preview, print, PDF).
 */
export default function useOrderBill() {
    const { user } = useAuth();
    const [billOrder, setBillOrder] = useState(null);
    const [loadingId, setLoadingId] = useState(null);
    const inFlight = useRef(null);

    const openBill = useCallback(async (orderId) => {
        if (!orderId || inFlight.current) return;
        inFlight.current = orderId;
        setLoadingId(orderId);
        try {
            const res = await sellerApi.getOrderDetails(orderId);
            const order = res?.data?.result;
            if (!order || order.isGroupSummary || !Array.isArray(order.items) || order.items.length === 0) {
                toast.error("Bill is not available for this order");
                return;
            }
            setBillOrder(order);
        } catch (e) {
            toast.error(e?.response?.data?.message || "Could not load the bill");
        } finally {
            inFlight.current = null;
            setLoadingId(null);
        }
    }, []);

    const closeBill = useCallback(() => setBillOrder(null), []);

    // Store header: the seller record populated on the order (fresh from the DB),
    // falling back to the signed-in seller profile for anything it lacks.
    const orderSeller = billOrder && billOrder.seller && typeof billOrder.seller === "object" ? billOrder.seller : {};
    const sellerInfo = { ...(user || {}), ...orderSeller };

    const billModal = billOrder ? (
        <ReceiptPrint
            order={billOrder}
            shopName={sellerInfo.shopName || sellerInfo.name}
            seller={sellerInfo}
            heading="Tax Invoice"
            onClose={closeBill}
        />
    ) : null;

    return { openBill, closeBill, loadingId, billModal };
}
