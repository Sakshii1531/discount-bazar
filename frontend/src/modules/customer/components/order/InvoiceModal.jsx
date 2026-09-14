import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Printer,
  CheckCircle2,
  XCircle,
  RefreshCw,
  ShieldCheck,
  FileText,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useSettings } from "@core/context/SettingsContext";

const InvoiceModal = ({ isOpen, onClose, order }) => {
  const { settings } = useSettings();
  const appName = settings?.appName || "Zetbasket";
  const primaryColor = settings?.primaryColor || "var(--primary)";

  useEffect(() => {
    if (isOpen) {
      window.lenis?.stop();
      document.body.style.overflow = "hidden";
      document.documentElement.style.overflow = "hidden";

      return () => {
        window.lenis?.start();
        document.body.style.overflow = "";
        document.documentElement.style.overflow = "";
      };
    }
  }, [isOpen]);

  if (!order) return null;

  const handlePrint = () => {
    window.print();
  };

  const rawOrderId = order.orderId || order.id || order._id || "";
  const displayOrderId = rawOrderId
    ? rawOrderId.length > 14
      ? `ORD-${rawOrderId.slice(-8)}`
      : rawOrderId
    : "N/A";

  const orderDate = order.createdAt
    ? new Date(order.createdAt).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : new Date().toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });

  const customerName = order.address?.name || order.customer?.name || "Customer";
  const customerPhone = order.address?.phone || order.customer?.phone || "";
  const customerAddress =
    order.address?.fullAddress ||
    [order.address?.houseNo, order.address?.area, order.address?.city, order.address?.pincode]
      .filter(Boolean)
      .join(", ") ||
    "";

  // Financial breakdown
  const items = Array.isArray(order.items) ? order.items : [];
  const subtotal = Math.ceil(
    Number(
      order.pricing?.subtotal ||
        items.reduce(
          (acc, item) => acc + (Number(item.price || 0) * Number(item.quantity || item.qty || 1)),
          0
        )
    )
  );
  const deliveryFee = Math.ceil(
    Number(order.pricing?.deliveryFee || order.deliveryFee || 0)
  );
  const handlingFee = Math.ceil(
    Number(
      order.paymentBreakdown?.handlingFeeCharged ||
        order.pricing?.handlingFee ||
        order.pricing?.platformFee ||
        0
    )
  );
  const taxAmount = Math.ceil(
    Number(
      order.pricing?.gst ||
        order.pricing?.tax ||
        order.paymentBreakdown?.taxTotal ||
        0
    )
  );
  const discountAmount = Math.ceil(
    Number(order.pricing?.discount || order.discount || 0)
  );
  const tipAmount = Math.ceil(Number(order.pricing?.tip || order.tip || 0));

  const grandTotal = Math.ceil(
    Number(
      order.pricing?.total ||
        order.paymentBreakdown?.grandTotal ||
        order.total ||
        subtotal + deliveryFee + handlingFee + taxAmount + tipAmount - discountAmount
    )
  );

  const paymentMethod = (
    order.payment?.method ||
    order.paymentMode ||
    "Online Payment"
  ).toUpperCase();

  // Status determinations
  const orderStatusStr = String(order.status || order.workflowStatus || "").toLowerCase();
  const isCancelled = orderStatusStr === "cancelled";
  const isReturned = orderStatusStr === "returned";

  const paymentStatusStr = String(order.payment?.status || "").toLowerCase();
  const isPaid =
    paymentStatusStr === "completed" ||
    paymentStatusStr === "paid" ||
    (!isCancelled &&
      !isReturned &&
      (order.payment?.method === "online" ||
        order.paymentMode === "ONLINE" ||
        order.status === "delivered"));

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div 
          className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-md"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            transition={{ type: "spring", duration: 0.4, bounce: 0.2 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl relative border border-slate-100 flex flex-col max-h-[90vh]"
          >
            {/* Modal Header */}
            <div className="bg-slate-50 px-5 py-3 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-emerald-100/60 text-emerald-700 rounded-lg">
                  <FileText size={16} />
                </div>
                <div>
                  <h2 className="text-sm font-black text-slate-900 leading-tight">
                    Tax Invoice
                  </h2>
                  <p className="text-[10px] text-slate-500 font-mono font-bold">
                    #{displayOrderId}
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 bg-white rounded-full hover:bg-slate-200 text-slate-500 transition-colors shadow-xs border border-slate-100"
              >
                <X size={16} />
              </button>
            </div>

            {/* Printable Invoice Container */}
            <div
              className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1 bg-white text-slate-800 text-xs"
              id="printable-invoice"
            >
              {/* Header Branding & Status */}
              <div className="flex flex-col sm:flex-row justify-between items-start gap-3 pb-3.5 border-b border-slate-100">
                <div>
                  <h1
                    className="text-xl font-black tracking-tight"
                    style={{ color: primaryColor }}
                  >
                    {appName}
                  </h1>
                  <p className="text-[10px] text-slate-500 mt-0.5 font-medium leading-tight">
                    {settings?.companyName || "Quick Commerce Pvt. Ltd."}
                    <br />
                    {settings?.address || "Registered Store Partner"}
                  </p>
                </div>
                <div className="sm:text-right bg-slate-50 sm:bg-transparent p-2.5 sm:p-0 rounded-xl sm:rounded-none w-full sm:w-auto">
                  {isCancelled ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 text-[9px] font-black uppercase tracking-wider mb-1">
                      <XCircle size={11} /> Order Cancelled
                    </span>
                  ) : isReturned ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200 text-[9px] font-black uppercase tracking-wider mb-1">
                      <RefreshCw size={11} /> Order Returned
                    </span>
                  ) : isPaid ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[9px] font-black uppercase tracking-wider mb-1">
                      <CheckCircle2 size={11} /> Billed & Paid
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-[9px] font-black uppercase tracking-wider mb-1">
                      <CheckCircle2 size={11} /> Billed (COD Pending)
                    </span>
                  )}
                  <p className="text-[10px] text-slate-400 font-semibold">
                    Date: <span className="text-slate-700">{orderDate}</span>
                  </p>
                  <p className="text-[10px] text-slate-400 font-semibold mt-0.5">
                    Payment: <span className="text-slate-700">{paymentMethod}</span>
                  </p>
                </div>
              </div>

              {/* Bill To Info Card */}
              <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <p className="text-[9px] font-black uppercase tracking-wider text-slate-400 mb-0.5">
                    Billed To
                  </p>
                  <h3 className="font-bold text-slate-900 text-xs">{customerName}</h3>
                  {customerPhone && (
                    <p className="text-slate-600 text-[10px] font-medium">
                      +91 {customerPhone.replace(/^\+?91/, "")}
                    </p>
                  )}
                </div>
                {customerAddress && (
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-wider text-slate-400 mb-0.5">
                      Delivery Address
                    </p>
                    <p className="text-slate-600 text-[10px] font-medium leading-tight">
                      {customerAddress}
                    </p>
                  </div>
                )}
              </div>

              {/* Items Table */}
              <div className="border border-slate-100 rounded-xl overflow-hidden">
                <table className="w-full text-left">
                  <thead className="bg-slate-50 border-b border-slate-100 text-[9px] font-black text-slate-400 uppercase tracking-wider">
                    <tr>
                      <th className="px-3 py-2">Item Details</th>
                      <th className="px-3 py-2 text-center">Qty</th>
                      <th className="px-3 py-2 text-right">Rate</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-[11px] font-semibold">
                    {items.map((item, idx) => {
                      const qty = Number(item.quantity || item.qty || 1);
                      const unitPrice = Math.ceil(Number(item.price || 0));
                      const itemTotal = Math.ceil(unitPrice * qty);
                      
                      const isRawSku = (val) => {
                        if (!val || typeof val !== 'string') return true;
                        const s = val.trim();
                        return /^[a-zA-Z0-9_-]+-\d+$/i.test(s) || /^sku-/i.test(s);
                      };

                      const rawSku = String(item.variantSku || item.variantSlot || '').trim();
                      const matchedVariant = Array.isArray(item.product?.variants) && rawSku
                        ? item.product.variants.find(v => String(v.sku || '').trim() === rawSku || String(v._id || '').trim() === rawSku)
                        : null;

                      const candidateName =
                        (item.variantName && !isRawSku(item.variantName) ? item.variantName : null) ||
                        matchedVariant?.name ||
                        item.unit ||
                        item.product?.unit ||
                        item.weight ||
                        item.product?.weight ||
                        item.pack ||
                        item.product?.pack ||
                        (item.variantSlot && !isRawSku(item.variantSlot) ? item.variantSlot : null) ||
                        (item.variantText && !isRawSku(item.variantText) ? item.variantText : null) ||
                        (typeof item.variant === 'string' && !isRawSku(item.variant) ? item.variant : item.variant?.name || item.variant?.title) ||
                        (typeof item.selectedVariant === 'string' && !isRawSku(item.selectedVariant) ? item.selectedVariant : item.selectedVariant?.name || item.selectedVariant?.title);

                      const variantName = candidateName && !isRawSku(candidateName) ? candidateName : (matchedVariant?.name || item.product?.unit || null);

                      return (
                        <tr key={idx} className="hover:bg-slate-50/50">
                          <td className="px-3 py-2 text-slate-800 font-bold">
                            <div>{item.name || item.product?.name || "Product"}</div>
                            {variantName && (
                              <div className="text-[10px] font-medium text-emerald-700 mt-0.5">
                                Variant: {variantName}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-slate-600 text-center font-mono">
                            {qty}
                          </td>
                          <td className="px-3 py-2 text-slate-600 text-right">
                            ₹{unitPrice}
                          </td>
                          <td className="px-3 py-2 text-slate-900 font-bold text-right">
                            ₹{itemTotal}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Financial Calculation Breakdown */}
              <div className="space-y-1.5 pt-1">
                <div className="flex justify-between text-[11px] text-slate-600">
                  <span>Item Subtotal</span>
                  <span className="font-bold text-slate-800">₹{subtotal}</span>
                </div>

                {deliveryFee > 0 && (
                  <div className="flex justify-between text-[11px] text-slate-600">
                    <span>Delivery Fee</span>
                    <span className="font-bold text-slate-800">₹{deliveryFee}</span>
                  </div>
                )}

                {handlingFee > 0 && (
                  <div className="flex justify-between text-[11px] text-slate-600">
                    <span>Handling / Convenience Fee</span>
                    <span className="font-bold text-slate-800">₹{handlingFee}</span>
                  </div>
                )}

                {taxAmount > 0 && (
                  <div className="flex justify-between text-[11px] text-slate-600">
                    <span>Taxes & GST</span>
                    <span className="font-bold text-slate-800">₹{taxAmount}</span>
                  </div>
                )}

                {tipAmount > 0 && (
                  <div className="flex justify-between text-[11px] text-slate-600">
                    <span>Delivery Partner Tip</span>
                    <span className="font-bold text-slate-800">₹{tipAmount}</span>
                  </div>
                )}

                {discountAmount > 0 && (
                  <div className="flex justify-between text-[11px] text-emerald-600 font-bold">
                    <span>Discount Savings</span>
                    <span>- ₹{discountAmount}</span>
                  </div>
                )}

                {/* Grand Total Row */}
                <div className="flex justify-between items-center text-xs font-black text-slate-900 pt-2 border-t border-slate-200 mt-1">
                  <span className="uppercase tracking-wider">
                    {isCancelled
                      ? "Total Amount (Cancelled)"
                      : isReturned
                      ? "Total Amount (Returned)"
                      : isPaid
                      ? "Total Paid"
                      : "Total Payable"}
                  </span>
                  {isCancelled ? (
                    <span className="text-sm text-rose-700 bg-rose-50 px-2.5 py-0.5 rounded-lg border border-rose-200 font-black">
                      ₹{grandTotal} (Cancelled)
                    </span>
                  ) : isReturned ? (
                    <span className="text-sm text-slate-700 bg-slate-100 px-2.5 py-0.5 rounded-lg border border-slate-200 font-black">
                      ₹{grandTotal} (Returned)
                    </span>
                  ) : isPaid ? (
                    <span className="text-sm text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-lg border border-emerald-200 font-black">
                      ₹{grandTotal}
                    </span>
                  ) : (
                    <span className="text-sm text-amber-700 bg-amber-50 px-2.5 py-0.5 rounded-lg border border-amber-200 font-black">
                      ₹{grandTotal}
                    </span>
                  )}
                </div>
              </div>

              {/* Trust Footer Notice */}
              <div className="pt-3 text-center border-t border-slate-100 text-[9px] text-slate-400 font-medium space-y-0.5">
                <p className="flex items-center justify-center gap-1 text-slate-500 font-bold">
                  <ShieldCheck size={13} className="text-emerald-600" /> Authorized Computer Generated Invoice
                </p>
                <p>Thank you for shopping with {appName}!</p>
              </div>
            </div>

            {/* Modal Footer Actions */}
            <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between gap-3 shrink-0 print:hidden">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-200 transition-colors"
              >
                Close
              </button>
              <button
                onClick={handlePrint}
                className="px-5 py-2 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-md active:scale-98 cursor-pointer"
                style={{ backgroundColor: primaryColor }}
              >
                <Printer size={15} /> Print / Save Invoice
              </button>
            </div>

            {/* Print CSS Rules */}
            <style>
              {`
                @media print {
                  @page {
                    margin: 0;
                    size: portrait;
                  }
                  #root {
                    display: none !important;
                  }
                  html, body {
                    width: 100% !important;
                    height: auto !important;
                    min-height: 0 !important;
                    margin: 0 !important;
                    padding: 0 !important;
                    background: #ffffff !important;
                    overflow: visible !important;
                  }
                  .fixed,
                  [class*="backdrop-blur"],
                  [class*="max-h-"],
                  motion.div {
                    position: static !important;
                    display: block !important;
                    transform: none !important;
                    margin: 0 !important;
                    padding: 0 !important;
                    width: 100% !important;
                    max-width: none !important;
                    height: auto !important;
                    min-height: 0 !important;
                    max-height: none !important;
                    overflow: visible !important;
                    box-shadow: none !important;
                    border: none !important;
                    background: transparent !important;
                  }
                  #printable-invoice, #printable-invoice * {
                    visibility: visible !important;
                  }
                  #printable-invoice {
                    display: block !important;
                    position: static !important;
                    width: 100% !important;
                    max-width: 100% !important;
                    height: auto !important;
                    max-height: none !important;
                    margin: 0 !important;
                    padding: 10mm 12mm !important;
                    background: #ffffff !important;
                    box-shadow: none !important;
                    border: none !important;
                    overflow: visible !important;
                    -webkit-print-color-adjust: exact !important;
                    print-color-adjust: exact !important;
                  }
                  .print\\:hidden {
                    display: none !important;
                  }
                }
              `}
            </style>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
};

export default InvoiceModal;
