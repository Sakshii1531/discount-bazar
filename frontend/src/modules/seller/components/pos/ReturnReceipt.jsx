import React from "react";
import Button from "@shared/components/ui/Button";
import { HiOutlineArrowUturnLeft, HiOutlinePrinter } from "react-icons/hi2";
import { RECEIPT_PRINT_CSS } from "./ReceiptPrint";

const REFUND_LABELS = { CASH: "Cash", CARD: "Card", QR: "QR / UPI", CREDIT: "Adjusted to credit" };

/**
 * 80mm return / refund slip for a PosReturn (same print layout as ReceiptPrint).
 */
const ReturnReceipt = ({ ret, shopName, seller = {}, onClose, printAdapter = () => window.print() }) => {
    if (!ret) return null;

    const items = Array.isArray(ret.items) ? ret.items : [];
    const storeTitle = shopName || seller.shopName || seller.name || "Store";
    const when = new Date(ret.createdAt || Date.now());
    const refundTotal = Number(ret.refundTotal || 0);

    return (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm print:bg-white print:p-0 print:static print:backdrop-blur-none print-modal-wrapper">
            <style>{RECEIPT_PRINT_CSS}</style>
            <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-5 print:shadow-none print:rounded-none print:max-w-full print:p-0 print-modal-content max-h-[90vh] flex flex-col">
                <div className="flex flex-col items-center text-center mb-3 print:hidden shrink-0">
                    <HiOutlineArrowUturnLeft className="h-9 w-9 text-emerald-500 mb-1" />
                    <h2 className="text-base font-black text-slate-900">Return Slip</h2>
                    <p className="text-xs text-slate-500">Ready for printing</p>
                </div>

                <div className="overflow-y-auto flex-1 pr-1 print:overflow-visible">
                    <div
                        id="pos-receipt"
                        className="bg-white text-slate-900 font-mono text-[11px] leading-relaxed p-3.5 rounded-xl border border-slate-200 shadow-xs"
                    >
                        <div className="text-center pb-2">
                            <h1 className="font-black text-sm uppercase tracking-wider leading-tight">{storeTitle}</h1>
                            <p className="text-[9px] font-bold tracking-widest text-slate-500 uppercase mt-0.5">
                                *** Return / Refund Slip ***
                            </p>
                            {seller.gstNumber && (
                                <p className="text-[9px] font-semibold text-slate-600">GSTIN: {seller.gstNumber}</p>
                            )}
                        </div>

                        <div className="border-t border-dashed border-slate-400 py-2 space-y-0.5 text-[10px]">
                            <div className="flex justify-between">
                                <span className="font-semibold text-slate-600">Against Bill:</span>
                                <span className="font-bold">#{ret.orderId}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="font-semibold text-slate-600">Date & Time:</span>
                                <span>{when.toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}</span>
                            </div>
                            {ret.reason && (
                                <div className="flex justify-between gap-2">
                                    <span className="font-semibold text-slate-600 shrink-0">Reason:</span>
                                    <span className="text-right">{ret.reason}</span>
                                </div>
                            )}
                        </div>

                        <table className="w-full text-left border-collapse my-1">
                            <thead>
                                <tr className="border-t border-b border-dashed border-slate-400 text-[10px] uppercase font-bold">
                                    <th className="py-1">Item</th>
                                    <th className="py-1 text-center w-8">Qty</th>
                                    <th className="py-1 text-right w-16">Refund</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-dotted divide-slate-200 text-[10px]">
                                {items.map((it, idx) => (
                                    <tr key={idx} className="align-top">
                                        <td className="py-1 pr-1">
                                            <div className="font-bold leading-tight">{it.productName || "Item"}</div>
                                            <div className="text-[9px] text-slate-500">
                                                {it.variantSlot ? `${it.variantSlot} · ` : ""}
                                                {it.condition === "damaged" ? "Damaged" : "Good"}
                                            </div>
                                        </td>
                                        <td className="py-1 text-center font-semibold">{it.quantity}</td>
                                        <td className="py-1 text-right font-bold">₹{Math.round(Number(it.refundAmount || 0)).toLocaleString("en-IN")}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>

                        <div className="border-t-2 border-b-2 border-dashed border-slate-900 my-2 py-1.5 flex justify-between font-black text-xs">
                            <span>TOTAL REFUND</span>
                            <span>₹{Math.round(refundTotal).toLocaleString("en-IN")}</span>
                        </div>
                        <div className="flex justify-between text-[10px]">
                            <span className="font-semibold text-slate-600">Refund Mode:</span>
                            <span className="font-black uppercase">{REFUND_LABELS[ret.refundMethod] || ret.refundMethod}</span>
                        </div>

                        <div className="border-t border-dashed border-slate-400 mt-2.5 pt-2 text-center text-[8px] text-slate-400">
                            Computer Generated Return Slip
                        </div>
                    </div>
                </div>

                <div className="flex gap-2 mt-4 print:hidden shrink-0">
                    <Button variant="secondary" className="flex-1" onClick={onClose}>
                        Close
                    </Button>
                    <Button className="flex-1" onClick={printAdapter}>
                        <HiOutlinePrinter className="h-4 w-4 mr-1.5" />
                        Print Slip
                    </Button>
                </div>
            </div>
        </div>
    );
};

export default ReturnReceipt;
