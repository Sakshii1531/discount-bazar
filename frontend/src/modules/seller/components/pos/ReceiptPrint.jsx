import React from "react";
import Button from "@shared/components/ui/Button";
import { HiOutlineCheckCircle, HiOutlinePrinter } from "react-icons/hi2";

// Shared 80mm thermal print styles (also used by ReturnReceipt): only #pos-receipt prints.
export const RECEIPT_PRINT_CSS = `
                @media print {
                    @page {
                        size: 80mm auto;
                        margin: 0;
                    }
                    html, body {
                        margin: 0 !important;
                        padding: 0 !important;
                        background: #ffffff !important;
                        width: 100% !important;
                    }
                    body * {
                        visibility: hidden !important;
                    }
                    .print-modal-wrapper,
                    .print-modal-content {
                        position: static !important;
                        display: block !important;
                        transform: none !important;
                        margin: 0 !important;
                        padding: 0 !important;
                        width: 100% !important;
                        max-width: none !important;
                        box-shadow: none !important;
                        border: none !important;
                        background: transparent !important;
                    }
                    #pos-receipt, #pos-receipt * {
                        visibility: visible !important;
                    }
                    #pos-receipt {
                        position: absolute !important;
                        left: 0 !important;
                        right: 0 !important;
                        top: 0 !important;
                        margin: 0 auto !important;
                        width: 76mm !important;
                        max-width: 100% !important;
                        padding: 2mm !important;
                        box-sizing: border-box !important;
                        background: #ffffff !important;
                        color: #000000 !important;
                        border: none !important;
                        border-radius: 0 !important;
                        box-shadow: none !important;
                        font-family: 'Outfit', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif !important;
                        -webkit-print-color-adjust: exact !important;
                        print-color-adjust: exact !important;
                    }
                    #pos-receipt * {
                        color: #000000 !important;
                        border-color: #000000 !important;
                    }
                    .print-hide {
                        display: none !important;
                    }
                }
`;

/**
 * Standard POS Receipt (80mm thermal receipt slip / browser print format)
 */
const ReceiptPrint = ({
    order,
    shopName,
    seller = {},
    onClose,
    printAdapter = () => window.print(),
    heading = "Sale Complete",
}) => {
    if (!order) return null;

    const breakdown = order.paymentBreakdown || order.pricing || {};
    const lineItems = Array.isArray(order.items) ? order.items : [];
    const paidAt = order.deliveredAt || order.createdAt || new Date().toISOString();

    const lineItemsSubtotal = lineItems.reduce((sum, item) => {
        const q = Number(item.quantity || item.qty || 1);
        const p = Number(item.price || 0);
        return sum + q * p;
    }, 0);

    const subtotal = Number(breakdown.productSubtotal || breakdown.subtotal || lineItemsSubtotal);
    const taxTotal = Number(breakdown.taxTotal || 0);
    const discountTotal = Number(breakdown.discountTotal || breakdown.discount || 0);
    const grandTotal = Number(breakdown.grandTotal || breakdown.total || Math.max(0, subtotal + taxTotal - discountTotal));
    const amountPaid = order.posAmountPaid != null ? Number(order.posAmountPaid) : grandTotal;

    const isCredit = String(order.posPaymentMethod || "").toUpperCase() === "CREDIT";
    const balanceDue = isCredit ? Math.max(0, grandTotal - amountPaid) : 0;
    const cashTendered = order.posCashTendered != null ? Number(order.posCashTendered) : null;
    const changeAmount = !isCredit && cashTendered != null && cashTendered > grandTotal ? cashTendered - grandTotal : 0;
    const splitPayments = Array.isArray(order.posPayments) ? order.posPayments : [];

    // Prices are GST-inclusive; the bill discount is spread across lines before
    // splitting each rate into taxable value + CGST/SGST (intra-state counter sale).
    const discountRatio = subtotal > 0 ? grandTotal / subtotal : 1;
    const gstByRate = new Map();
    lineItems.forEach((item) => {
        const rate = Number(item.gstPercent || 0);
        if (rate <= 0) return;
        const value = Number(item.price || 0) * Number(item.quantity || item.qty || 1) * discountRatio;
        const taxable = (value * 100) / (100 + rate);
        const prev = gstByRate.get(rate) || { taxable: 0, tax: 0 };
        gstByRate.set(rate, { taxable: prev.taxable + taxable, tax: prev.tax + (value - taxable) });
    });
    const gstRows = Array.from(gstByRate.entries()).sort((a, b) => a[0] - b[0]);
    const gstTotal = gstRows.reduce((sum, [, r]) => sum + r.tax, 0);
    const totalUnits = lineItems.reduce((sum, item) => sum + Number(item.quantity || item.qty || 1), 0);

    const sellerInfo = seller || order.seller || {};
    const storeTitle = shopName || sellerInfo.shopName || sellerInfo.name || "Store";
    const paymentMethod = (order.posPaymentMethod || "CASH").toUpperCase();
    const couponCode = order.couponSnapshot?.code || order.couponCode || "";

    const paidDate = new Date(paidAt);
    const formattedDate = !isNaN(paidDate.getTime())
        ? paidDate.toLocaleDateString("en-IN", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
          })
        : "";
    const formattedTime = !isNaN(paidDate.getTime())
        ? paidDate.toLocaleTimeString("en-IN", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: true,
          })
        : "";

    return (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm print:bg-white print:p-0 print:static print:backdrop-blur-none print-modal-wrapper">
            <style>{RECEIPT_PRINT_CSS}</style>
            <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-5 print:shadow-none print:rounded-none print:max-w-full print:p-0 print-modal-content max-h-[90vh] flex flex-col">
                <div className="flex flex-col items-center text-center mb-3 print:hidden shrink-0">
                    <HiOutlineCheckCircle className="h-9 w-9 text-emerald-500 mb-1" />
                    <h2 className="text-base font-black text-slate-900">{heading}</h2>
                    <p className="text-xs text-slate-500">Receipt ready for printing</p>
                </div>

                <div className="overflow-y-auto flex-1 pr-1 print:overflow-visible">
                    <div
                        id="pos-receipt"
                        className="bg-white text-slate-900 font-mono text-[11px] leading-relaxed p-3.5 rounded-xl border border-slate-200 shadow-xs"
                    >
                        {/* Store Header */}
                        <div className="text-center pb-2">
                            <h1 className="font-black text-sm uppercase tracking-wider text-slate-900 leading-tight">
                                {storeTitle}
                            </h1>
                            <p className="text-[9px] font-bold tracking-widest text-slate-500 uppercase mt-0.5">
                                *** Retail Cash Invoice ***
                            </p>
                            {sellerInfo.address && (
                                <p className="text-[9px] text-slate-500 leading-tight mt-0.5">
                                    {sellerInfo.address}
                                    {sellerInfo.city ? `, ${sellerInfo.city}` : ""}
                                    {sellerInfo.pincode ? ` - ${sellerInfo.pincode}` : ""}
                                </p>
                            )}
                            {sellerInfo.phone && (
                                <p className="text-[9px] text-slate-500">
                                    Tel: +91 {sellerInfo.phone}
                                </p>
                            )}
                            {sellerInfo.gstNumber && (
                                <p className="text-[9px] font-semibold text-slate-600">
                                    GSTIN: {sellerInfo.gstNumber}
                                </p>
                            )}
                        </div>

                        {/* Order & Customer Metadata */}
                        <div className="border-t border-dashed border-slate-400 py-2 space-y-0.5 text-[10px] text-slate-700">
                            <div className="flex justify-between items-start gap-1">
                                <span className="font-semibold text-slate-600 shrink-0">Bill No:</span>
                                <span className="font-bold text-slate-900 break-all text-right">
                                    #{order.orderId}
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span className="font-semibold text-slate-600">Date & Time:</span>
                                <span>{formattedDate} {formattedTime}</span>
                            </div>
                            {sellerInfo.name && (
                                <div className="flex justify-between">
                                    <span className="font-semibold text-slate-600">Cashier:</span>
                                    <span>{sellerInfo.name}</span>
                                </div>
                            )}
                            <div className="flex justify-between">
                                <span className="font-semibold text-slate-600">Customer:</span>
                                <span className="font-medium text-slate-900">
                                    {order.walkInCustomer?.name || "Walk-in Customer"}
                                </span>
                            </div>
                            {order.walkInCustomer?.phone && (
                                <div className="flex justify-between">
                                    <span className="font-semibold text-slate-600">Phone:</span>
                                    <span>{order.walkInCustomer.phone}</span>
                                </div>
                            )}
                        </div>

                        {/* Standard Itemized Table */}
                        <table className="w-full text-left border-collapse my-1">
                            <thead>
                                <tr className="border-t border-b border-dashed border-slate-400 text-[10px] uppercase font-bold text-slate-900">
                                    <th className="py-1 text-left">Item</th>
                                    <th className="py-1 text-center w-8">Qty</th>
                                    <th className="py-1 text-right w-14">Rate</th>
                                    <th className="py-1 text-right w-16">Amount</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-dotted divide-slate-200 text-[10px]">
                                {lineItems.map((item, idx) => {
                                    const name = item.name || item.productName || "Item";
                                    const qty = Number(item.quantity || item.qty || 1);
                                    const price = Number(item.price || 0);
                                    const total = qty * price;
                                    const variant = item.variantSlot || item.variantSku || "";
                                    return (
                                        <tr key={idx} className="align-top">
                                            <td className="py-1 pr-1 font-medium">
                                                <div className="font-bold text-slate-900 leading-tight">
                                                    {name}
                                                </div>
                                                {variant && (
                                                    <div className="text-[9px] text-slate-500 font-normal">
                                                        {variant}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="py-1 text-center font-semibold text-slate-800">
                                                {qty}
                                            </td>
                                            <td className="py-1 text-right text-slate-700">
                                                ₹{price.toFixed(2)}
                                            </td>
                                            <td className="py-1 text-right font-bold text-slate-900">
                                                ₹{total.toFixed(2)}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>

                        {/* Summary & Totals */}
                        <div className="border-t border-dashed border-slate-400 pt-1.5 space-y-1 text-[10px]">
                            <div className="flex justify-between text-slate-600">
                                <span>Total Items: {lineItems.length}</span>
                                <span>Total Qty: {totalUnits}</span>
                            </div>
                            <div className="flex justify-between text-slate-800">
                                <span>Subtotal</span>
                                <span className="font-semibold">₹{subtotal.toFixed(2)}</span>
                            </div>
                            {taxTotal > 0 && (
                                <div className="flex justify-between text-slate-800 font-semibold">
                                    <span>Tax / GST</span>
                                    <span>+₹{taxTotal.toFixed(2)}</span>
                                </div>
                            )}
                            {discountTotal > 0 && (
                                <div className="flex justify-between text-emerald-700 font-semibold">
                                    <span>Discount{couponCode ? ` (${couponCode})` : ""}</span>
                                    <span>-₹{discountTotal.toFixed(2)}</span>
                                </div>
                            )}
                        </div>

                        {/* Grand Total */}
                        <div className="border-t-2 border-b-2 border-dashed border-slate-900 my-2 py-1.5 flex justify-between font-black text-xs text-slate-900">
                            <span>TOTAL AMOUNT</span>
                            <span>₹{grandTotal.toFixed(2)}</span>
                        </div>

                        {/* GST Summary */}
                        {(gstRows.length > 0 || taxTotal > 0) && (
                            <div className="border-b border-dashed border-slate-400 pb-1.5 mb-1.5 text-[9px] text-slate-700">
                                <p className="font-bold uppercase text-slate-800 mb-0.5">
                                    {gstRows.length > 0 ? "GST Summary (incl. in price)" : "Tax / GST Summary"}
                                </p>
                                {gstRows.length > 0 ? (
                                    <>
                                        <div className="flex justify-between font-semibold text-slate-500">
                                            <span className="w-10">Rate</span>
                                            <span className="flex-1 text-right">Taxable</span>
                                            <span className="w-14 text-right">CGST</span>
                                            <span className="w-14 text-right">SGST</span>
                                        </div>
                                        {gstRows.map(([rate, r]) => (
                                            <div key={rate} className="flex justify-between">
                                                <span className="w-10">{rate}%</span>
                                                <span className="flex-1 text-right">₹{r.taxable.toFixed(2)}</span>
                                                <span className="w-14 text-right">₹{(r.tax / 2).toFixed(2)}</span>
                                                <span className="w-14 text-right">₹{(r.tax / 2).toFixed(2)}</span>
                                            </div>
                                        ))}
                                    </>
                                ) : (
                                    <div className="flex justify-between">
                                        <span className="text-slate-600">Applied Tax:</span>
                                        <span className="font-semibold text-slate-900">₹{taxTotal.toFixed(2)}</span>
                                    </div>
                                )}
                                <div className="flex justify-between font-bold text-slate-900 mt-0.5">
                                    <span>Total Tax</span>
                                    <span>₹{(gstTotal || taxTotal).toFixed(2)}</span>
                                </div>
                            </div>
                        )}

                        {/* Payment Details */}
                        <div className="space-y-0.5 text-[10px] text-slate-700">
                            <div className="flex justify-between">
                                <span className="font-semibold text-slate-600">Payment Mode:</span>
                                <span className="font-black text-slate-900 uppercase">{paymentMethod}</span>
                            </div>
                            {splitPayments.map((p, i) => (
                                <div key={`${p.method}-${i}`} className="flex justify-between pl-2">
                                    <span className="text-slate-600">{p.method === "QR" ? "QR / UPI" : p.method}:</span>
                                    <span className="text-slate-900">₹{Number(p.amount || 0).toFixed(2)}</span>
                                </div>
                            ))}
                            <div className="flex justify-between">
                                <span className="font-semibold text-slate-600">Amount Paid:</span>
                                <span className="font-semibold text-slate-900">₹{amountPaid.toFixed(2)}</span>
                            </div>
                            {cashTendered != null && (
                                <div className="flex justify-between">
                                    <span className="font-semibold text-slate-600">Cash Received:</span>
                                    <span className="font-semibold text-slate-900">₹{cashTendered.toFixed(2)}</span>
                                </div>
                            )}
                            {isCredit && balanceDue > 0 ? (
                                <div className="flex justify-between font-bold text-rose-600">
                                    <span>Balance Due:</span>
                                    <span>₹{balanceDue.toFixed(2)}</span>
                                </div>
                            ) : changeAmount > 0 ? (
                                <div className="flex justify-between font-bold text-slate-900">
                                    <span>Change Return:</span>
                                    <span>₹{changeAmount.toFixed(2)}</span>
                                </div>
                            ) : null}
                            <div className="flex justify-between">
                                <span className="font-semibold text-slate-600">Payment Status:</span>
                                <span className="font-bold text-emerald-700">
                                    {isCredit && balanceDue > 0 ? "PARTIALLY PAID" : "PAID"}
                                </span>
                            </div>
                        </div>

                        {/* Footer Notes */}
                        <div className="border-t border-dashed border-slate-400 mt-2.5 pt-2 text-center text-[9px] text-slate-500 space-y-0.5">
                            <p className="font-bold uppercase tracking-wider text-slate-800">
                                Thank You For Shopping!
                            </p>
                            <p className="text-slate-500">Please Visit Again</p>
                            <p className="text-[8px] text-slate-400 mt-1">
                                Computer Generated POS Invoice
                            </p>
                            <p className="text-[8px] text-slate-400">
                                Valid without physical signature
                            </p>
                        </div>
                    </div>
                </div>

                <div className="flex gap-2 mt-4 print:hidden shrink-0">
                    <Button variant="secondary" className="flex-1" onClick={onClose}>
                        Close
                    </Button>
                    <Button className="flex-1" onClick={printAdapter}>
                        <HiOutlinePrinter className="h-4 w-4 mr-1.5" />
                        Print Bill
                    </Button>
                </div>
            </div>
        </div>
    );
};

export default ReceiptPrint;
