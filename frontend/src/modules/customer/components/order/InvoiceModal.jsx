import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import ReceiptPrint from "@/modules/seller/components/pos/ReceiptPrint";

/**
 * Online order invoice. Uses the New Sale (POS) bill itself — same receipt
 * layout for the preview, the printed bill and the PDF — with the order's
 * delivery / handling / tip charges and online or COD payment as extra rows.
 * The tax row only appears when the order actually carries tax.
 */
const InvoiceModal = ({ isOpen, onClose, order }) => {
  useEffect(() => {
    if (!isOpen) return undefined;
    window.lenis?.stop();
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      window.lenis?.start();
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";
    };
  }, [isOpen]);

  if (!isOpen || !order) return null;

  const seller = order.seller && typeof order.seller === "object" ? order.seller : {};

  return createPortal(
    <ReceiptPrint
      order={order}
      shopName={seller.shopName || seller.name}
      seller={seller}
      heading="Tax Invoice"
      onClose={onClose}
    />,
    document.body,
  );
};

export default InvoiceModal;
