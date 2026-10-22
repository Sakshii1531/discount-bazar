import React, { useEffect, useState } from "react";
import QRCode from "qrcode";
import Button from "@shared/components/ui/Button";
import { HiOutlineCheckCircle, HiOutlinePrinter, HiOutlineArrowDownTray, HiOutlinePencilSquare } from "react-icons/hi2";
import { toast } from "sonner";
import { downloadPosBillPDF } from "@/lib/posPdfExport";
import { posBillCustomer } from "@/lib/posCustomer";

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

// Fixed lines of the store's thermal bill template.
const RECEIPT_TAGLINE = "Experience Excellence in shopping";
const RECEIPT_NOTICE = "Exchange offer is not available at this time.";
const RECEIPT_TERMS = [];

const TENDER_LABELS = { CASH: "Cash", CARD: "Card", QR: "UPI", CREDIT: "Credit", OTHER: "Other", SPLIT: "Split" };

// Whole rupees print without decimals ("10"), anything else with two ("8.47").
const amt = (n) => {
    const v = Math.round((Number(n) || 0) * 100) / 100;
    return Number.isInteger(v) ? String(v) : v.toFixed(2);
};
const pad2 = (n) => String(n).padStart(2, "0");

const ReceiptRow = ({ label, value, strong = false }) => (
    <div className={`flex justify-between gap-2 ${strong ? "font-black" : ""}`}>
        <span>{label}</span>
        <span className="text-right">{value}</span>
    </div>
);

// Unit MRP snapshot on the bill line; bills saved before it existed fall back to the selling price.
const unitMrp =(item) => Math.max(Number(item?.mrp) || 0, Number(item?.price) || 0);

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
    // Optional: "Edit bill" — reopens this bill in the register in Update mode.
    onEdit,
}) => {
    const [qrSrc, setQrSrc] = useState("");
    const qrPayload = order
        ? [
              `Bill:${order.orderId}`,
              `Date:${order.deliveredAt || order.createdAt || ""}`,
              `Amount:${Number(order.paymentBreakdown?.grandTotal ?? 0)}`,
          ].join("|")
        : "";
    useEffect(() => {
        let active = true;
        if (!qrPayload) return undefined;
        QRCode.toDataURL(qrPayload, { margin: 0, width: 192, errorCorrectionLevel: "M" })
            .then((url) => active && setQrSrc(url))
            .catch(() => active && setQrSrc(""));
        return () => {
            active = false;
        };
    }, [qrPayload]);

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
    const isTaxInclusive = order.isTaxInclusive !== undefined ? order.isTaxInclusive : (breakdown.isTaxInclusive !== false);
    const grandTotal = Number(
        breakdown.grandTotal ||
        breakdown.total ||
        (isTaxInclusive ? Math.max(0, subtotal - discountTotal) : Math.max(0, subtotal + taxTotal - discountTotal))
    );
    const amountPaid = order.posAmountPaid != null ? Number(order.posAmountPaid) : grandTotal;

    const isCredit = String(order.posPaymentMethod || "").toUpperCase() === "CREDIT";
    const balanceDue = isCredit ? Math.max(0, grandTotal - amountPaid) : 0;
    const cashTendered = order.posCashTendered != null ? Number(order.posCashTendered) : null;
    const changeAmount = !isCredit && cashTendered != null && cashTendered > grandTotal ? cashTendered - grandTotal : 0;
    const splitPayments = Array.isArray(order.posPayments) ? order.posPayments : [];

    // Bill discount is spread across lines before
    // splitting each rate into taxable value + CGST/SGST (intra-state counter sale).
    const discountRatio = subtotal > 0 ? (isTaxInclusive ? grandTotal / subtotal : (subtotal - discountTotal) / subtotal) : 1;
    const gstByRate = new Map();
    lineItems.forEach((item) => {
        const rate = Number(item.gstPercent || 0);
        if (rate <= 0) return;
        const lineTotal = Number(item.price || 0) * Number(item.quantity || item.qty || 1);
        if (isTaxInclusive) {
            const value = lineTotal * discountRatio;
            const taxable = (value * 100) / (100 + rate);
            const prev = gstByRate.get(rate) || { taxable: 0, tax: 0 };
            gstByRate.set(rate, { taxable: prev.taxable + taxable, tax: prev.tax + (value - taxable) });
        } else {
            const taxable = lineTotal * discountRatio;
            const tax = (taxable * rate) / 100;
            const prev = gstByRate.get(rate) || { taxable: 0, tax: 0 };
            gstByRate.set(rate, { taxable: prev.taxable + taxable, tax: prev.tax + tax });
        }
    });

    // Fallback: If individual lines did not record gstPercent, use the bill-level taxTotal/taxPercent
    if (gstByRate.size === 0 && taxTotal > 0) {
        const taxable = isTaxInclusive ? Math.max(0, (subtotal - discountTotal) - taxTotal) : Math.max(0, subtotal - discountTotal);
        const rate = taxable > 0 ? Math.round(((taxTotal / taxable) * 100) * 10) / 10 : Number(breakdown.taxPercent || order.taxPercent || 0);
        gstByRate.set(rate, { taxable, tax: taxTotal });
    }

    const gstRows = Array.from(gstByRate.entries()).sort((a, b) => a[0] - b[0]);
    const gstTotal = gstRows.reduce((sum, [, r]) => sum + r.tax, 0);
    const taxableTotal = gstRows.reduce((sum, [, r]) => sum + r.taxable, 0);
    const totalUnits = lineItems.reduce((sum, item) => sum + Number(item.quantity || item.qty || 1), 0);
    const mrpTotal = lineItems.reduce((sum, item) => sum + unitMrp(item) * Number(item.quantity || item.qty || 1), 0);
    const mrpSavings = Math.round((mrpTotal - grandTotal) * 100) / 100;

    const sellerInfo = seller || order.seller || {};
    const storeTitle = shopName || sellerInfo.shopName || sellerInfo.name || "Store";
    const paymentMethod = (order.posPaymentMethod || "CASH").toUpperCase();
    const billCustomer = posBillCustomer(order, "Walk-in Customer");
    const couponCode = order.couponSnapshot?.code || order.couponCode || "";

    const paidDate = new Date(paidAt);
    const validDate = !isNaN(paidDate.getTime());
    // dd-mm-yy and 24h hh:mm:ss, as on the store's bill template
    const formattedDate = validDate
        ? `${pad2(paidDate.getDate())}-${pad2(paidDate.getMonth() + 1)}-${String(paidDate.getFullYear()).slice(-2)}`
        : "";
    const formattedTime = validDate
        ? `${pad2(paidDate.getHours())}:${pad2(paidDate.getMinutes())}:${pad2(paidDate.getSeconds())}`
        : "";

    const storeAddress = [sellerInfo.address, sellerInfo.city, sellerInfo.state, sellerInfo.pincode && `PIN ${sellerInfo.pincode}`]
        .filter((part) => typeof part === "string" && part.trim())
        .join(", ");
    const methodLabel = TENDER_LABELS[paymentMethod] || paymentMethod;
    // A walk-in bill names the tender ("Cash"), like the template.
    const customerName = billCustomer.isWalkIn ? methodLabel : billCustomer.name;
    // Amount taken per tender: split lines, the up-front part of a credit bill, else the whole bill.
    const tenderLines = splitPayments.length
        ? splitPayments.map((p) => ({ method: p.method, label: TENDER_LABELS[p.method] || p.method, amount: Number(p.amount || 0) }))
        : isCredit
          ? amountPaid > 0
              ? [{ method: "CASH", label: "Cash", amount: amountPaid }]
              : []
          : [{ method: paymentMethod, label: methodLabel, amount: grandTotal }];
    const modeParts = [...tenderLines, ...(isCredit && balanceDue > 0 ? [{ label: "Credit", amount: balanceDue }] : [])];
    const paymentModeText = modeParts.length ? modeParts.map((t) => `${t.label}-${amt(t.amount)}`).join(", ") : methodLabel;

    return (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm print:bg-white print:p-0 print:static print:backdrop-blur-none print-modal-wrapper">
            <style>{RECEIPT_PRINT_CSS}</style>
            <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-5 print:shadow-none print:rounded-none print:max-w-full print:p-0 print-modal-content max-h-[90vh] flex flex-col">
                <div className="flex flex-col items-center text-center mb-3 print:hidden shrink-0">
                    <HiOutlineCheckCircle className="h-9 w-9 text-emerald-500 mb-1" />
                    <h2 className="text-base font-black text-slate-900">{heading}</h2>
                    <p className="text-xs text-slate-500">Receipt ready for printing</p>
                </div>

                <div className="overflow-y-auto flex-1 pr-1 print:overflow-visible">
                    <div
                        id="pos-receipt"
                        className="bg-white text-black font-sans font-bold text-[11.5px] leading-snug p-3 rounded-xl border border-slate-200 shadow-xs"
                    >
                        {/* Store header */}
                        <div className="text-center">
                            <h1 className="font-black text-[15px] uppercase leading-tight">{storeTitle}</h1>
                            {storeAddress && <p className="text-[11px] leading-tight">{storeAddress}</p>}
                            {sellerInfo.phone && <p className="text-[11px]">{sellerInfo.phone}</p>}
                        </div>
                        {sellerInfo.gstNumber && <p className="mt-1 underline font-black">{sellerInfo.gstNumber}</p>}
                        <p className="font-black">TAX INVOICE</p>

                        <div className="border-t border-dashed border-black my-1" />
                        <p className="text-center text-[12px] border-y border-black py-0.5">{RECEIPT_TAGLINE}</p>
                        <div className="border-t border-dashed border-black my-1" />
                        <p className="text-center border border-black py-0.5">{RECEIPT_NOTICE}</p>

                        {/* Bill & customer */}
                        <div className="grid grid-cols-[1fr_auto] gap-x-2 mt-1">
                            <div className="min-w-0">
                                <p className="break-all">Bill No :{order.orderId}</p>
                                <p>Customer Name : {customerName}</p>
                            </div>
                            <div className="self-end">
                                <p>Date : {formattedDate}</p>
                                <p>Time : {formattedTime}</p>
                            </div>
                        </div>
                        <p>Mob No. : {billCustomer.phone}</p>

                        {/* Items */}
                        <table className="w-full border-collapse mt-1 table-fixed">
                            <colgroup>
                                <col className="w-[9%]" />
                                <col />
                                <col className="w-[13%]" />
                                <col className="w-[13%]" />
                                <col className="w-[13%]" />
                                <col className="w-[17%]" />
                            </colgroup>
                            <thead>
                                <tr className="border-y border-dashed border-black align-bottom">
                                    <th className="py-1 text-center">SN.</th>
                                    <th className="py-1 text-left">ITEM NAME</th>
                                    <th className="py-1 text-center">QTY</th>
                                    <th className="py-1 text-center">MRP</th>
                                    <th className="py-1 text-center">RATE</th>
                                    <th className="py-1 text-right">AMOUNT</th>
                                </tr>
                            </thead>
                            <tbody>
                                {lineItems.map((item, idx) => {
                                    const name = item.name || item.productName || "Item";
                                    const qty = Number(item.quantity || item.qty || 1);
                                    const price = Number(item.price || 0);
                                    const variant = item.variantSlot || item.variantSku || "";
                                    return (
                                        <tr key={idx} className="align-top">
                                            <td className="py-1 text-center">{idx + 1}</td>
                                            <td className="py-1 uppercase break-words">
                                                {name}
                                                {variant && !name.includes(variant) ? ` (${variant})` : ""}
                                            </td>
                                            <td className="py-1 text-center">{amt(qty)}</td>
                                            <td className="py-1 text-center">{amt(unitMrp(item))}</td>
                                            <td className="py-1 text-center">{amt(price)}</td>
                                            <td className="py-1 text-right">{amt(price * qty)}</td>
                                        </tr>
                                    );
                                })}
                                <tr className="border-t border-dashed border-black align-top">
                                    <td colSpan={2} className="py-1">ITEMS : {lineItems.length}</td>
                                    <td className="py-1 text-center">{totalUnits.toFixed(2)}</td>
                                    <td className="py-1 text-center">{amt(mrpTotal)}</td>
                                    <td className="py-1 text-center">{amt(lineItemsSubtotal)}</td>
                                    <td className="py-1 text-right">{amt(lineItemsSubtotal)}</td>
                                </tr>
                            </tbody>
                        </table>

                        {/* Totals & payment */}
                        <div className="border-t border-dashed border-black pt-1 space-y-0.5">
                            <ReceiptRow label="Gross Rate" value={amt(subtotal)} />
                            {!isTaxInclusive && taxTotal > 0 && <ReceiptRow label="GST (CGST + SGST)" value={amt(taxTotal)} />}
                            {discountTotal > 0 && (
                                <ReceiptRow label={`Discount${couponCode ? ` (${couponCode})` : ""}`} value={`-${amt(discountTotal)}`} />
                            )}
                            <ReceiptRow label="TOTAL" value={amt(grandTotal)} strong />
                            {tenderLines.map((t) => (
                                <ReceiptRow key={t.method} label={`${t.label} Amount`} value={amt(t.amount)} />
                            ))}
                            {changeAmount > 0 && (
                                <>
                                    <ReceiptRow label="Cash Received" value={amt(cashTendered)} />
                                    <ReceiptRow label="Change Returned" value={amt(changeAmount)} />
                                </>
                            )}
                            <ReceiptRow label="Total Paid Amount" value={amt(amountPaid)} />
                            <div className="pt-1" />
                            <ReceiptRow label="Total Due" value={balanceDue > 0 ? amt(balanceDue) : ""} />
                            <ReceiptRow label="Payment Mode" value={paymentModeText} />
                            {mrpSavings > 0 && <ReceiptRow label="You Saved (on MRP)" value={amt(mrpSavings)} />}
                        </div>

                        {/* GST summary per rate (intra-state: CGST + SGST halves) */}
                        {gstRows.length > 0 && (
                            <table className="w-full border-collapse mt-1.5 text-center table-fixed">
                                <thead>
                                    <tr className="align-bottom leading-tight">
                                        <th className="py-0.5 text-left">TAXABLE</th>
                                        <th className="py-0.5">CGST %</th>
                                        <th className="py-0.5">CGST Amt</th>
                                        <th className="py-0.5">SGST %</th>
                                        <th className="py-0.5">SGST Amt</th>
                                        <th className="py-0.5 text-right">TAX AMOUNT</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {gstRows.map(([rate, r]) => (
                                        <tr key={rate}>
                                            <td className="py-0.5 text-left">{r.taxable.toFixed(2)}</td>
                                            <td className="py-0.5">{(rate / 2).toFixed(2)}%</td>
                                            <td className="py-0.5">{(r.tax / 2).toFixed(2)}</td>
                                            <td className="py-0.5">{(rate / 2).toFixed(2)}%</td>
                                            <td className="py-0.5">{(r.tax / 2).toFixed(2)}</td>
                                            <td className="py-0.5 text-right">{r.tax.toFixed(2)}</td>
                                        </tr>
                                    ))}
                                    {gstRows.length > 1 && (
                                        <tr className="border-t border-dotted border-black">
                                            <td className="py-0.5 text-left">{taxableTotal.toFixed(2)}</td>
                                            <td />
                                            <td className="py-0.5">{(gstTotal / 2).toFixed(2)}</td>
                                            <td />
                                            <td className="py-0.5">{(gstTotal / 2).toFixed(2)}</td>
                                            <td className="py-0.5 text-right">{gstTotal.toFixed(2)}</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        )}

                        <p className="mt-1">Terms &amp; Conditions</p>
                        {RECEIPT_TERMS.map((t) => (
                            <p key={t} className="text-[10.5px] font-semibold">
                                {t}
                            </p>
                        ))}

                        {/* Footer */}
                        <div className="border-t border-dashed border-black mt-2 pt-1 text-center">
                            <p>Thank You For Your Visit</p>
                            <p>Please keep for your record</p>
                            <p className="overflow-hidden whitespace-nowrap leading-none">****************************************************</p>
                            {qrSrc && <img src={qrSrc} alt="Bill QR code" className="mx-auto mt-1.5 h-24 w-24" />}
                        </div>
                    </div>
                </div>

                <div className="flex gap-2 mt-4 print:hidden shrink-0">
                    <Button variant="secondary" className="flex-1" onClick={onClose}>
                        Close
                    </Button>
                    {onEdit && (
                        <Button variant="outline" className="flex-1" onClick={() => onEdit(order)}>
                            <HiOutlinePencilSquare className="h-4 w-4 mr-1.5" />
                            Edit
                        </Button>
                    )}
                    <Button
                        variant="outline"
                        className="flex-1"
                        onClick={() =>
                            downloadPosBillPDF({
                                order,
                                shopName: storeTitle,
                                seller: sellerInfo,
                                heading: heading === "Sale Complete" ? "Tax Invoice" : heading,
                            }).catch(() => toast.error("Failed to download bill"))
                        }
                    >
                        <HiOutlineArrowDownTray className="h-4 w-4 mr-1.5" />
                        PDF
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
