import React, { useState } from "react";
import { toast } from "sonner";
import { HiOutlineDocumentText, HiOutlinePrinter, HiOutlineArrowDownTray, HiOutlineXMark } from "react-icons/hi2";
import { printInvoice, downloadInvoicePdf } from "../../utils/ledgerInvoice";

const money = (n) =>
    (Math.round((Number(n) || 0) * 100) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ghostBtn =
    "px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 bg-white hover:bg-slate-50 active:scale-95 transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50";
const btnCls =
    "px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold shadow-xs hover:bg-primary/90 active:scale-95 transition-all cursor-pointer flex items-center gap-1.5";

const PartyBox = ({ party }) => (
    <div className="p-3 space-y-0.5">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{party.heading}</p>
        <p className="text-sm font-black text-slate-900">{party.name || "Walk-in Customer"}</p>
        {party.address && <p className="text-slate-600">{party.address}</p>}
        {party.phone && <p className="text-slate-600">Phone: {party.phone}</p>}
        {party.gstin && (
            <p className="text-slate-600">
                GSTIN: <span className="font-bold text-slate-800">{party.gstin}</span>
            </p>
        )}
    </div>
);

/**
 * One bill as a GST tax invoice, opened over the ledger / purchases list. Print
 * goes through an isolated iframe (ledgerInvoice.printInvoice), so only this
 * invoice is printed, never the page behind the modal; PDF is generated directly.
 * `invoice` is the model from buildLedgerInvoice / buildPurchaseBillInvoice.
 */
const InvoiceModal = ({ invoice, onClose }) => {
    const [downloading, setDownloading] = useState(false);
    if (!invoice) return null;
    const biz = invoice.business;
    const sum = (k) => invoice.items.reduce((s, i) => s + i[k], 0);

    const download = async () => {
        setDownloading(true);
        try {
            await downloadInvoicePdf(invoice);
        } catch {
            toast.error("Could not generate the PDF");
        } finally {
            setDownloading(false);
        }
    };

    return (
        <div
            className="fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div className="bg-white w-full max-w-4xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-8 animate-in fade-in zoom-in-95 duration-150">
                <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-slate-100 bg-slate-50/70">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <div className="h-9 w-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                            <HiOutlineDocumentText className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                            <h3 className="text-sm font-black text-slate-900 truncate">
                                {invoice.title} {invoice.number ? `#${invoice.number}` : ""}
                            </h3>
                            {invoice.date && <p className="text-[11px] text-slate-500 font-medium">{invoice.date}</p>}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button type="button" className={ghostBtn} onClick={() => printInvoice(invoice)}>
                            <HiOutlinePrinter className="h-4 w-4" /> Print invoice
                        </button>
                        <button type="button" className={ghostBtn} disabled={downloading} onClick={download}>
                            <HiOutlineArrowDownTray className="h-4 w-4" /> {downloading ? "Preparing…" : "Download PDF"}
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            className="h-8 w-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-colors cursor-pointer"
                            title="Close"
                        >
                            <HiOutlineXMark className="h-5 w-5" />
                        </button>
                    </div>
                </div>

                {/* Invoice sheet (same layout as the print / PDF) */}
                <div className="p-5 max-h-[72vh] overflow-y-auto">
                    <div className="border border-slate-800 text-xs text-slate-700">
                        <div className="flex flex-wrap items-start justify-between gap-3 p-3 border-b border-slate-800">
                            <div className="space-y-0.5">
                                <p className="text-lg font-black uppercase text-slate-900">{biz.name}</p>
                                {biz.address && <p>{biz.address}</p>}
                                {(biz.phone || biz.email) && <p>{[biz.phone && `Phone: ${biz.phone}`, biz.email].filter(Boolean).join(" · ")}</p>}
                                {biz.gstin && (
                                    <p>
                                        GSTIN: <span className="font-bold">{biz.gstin}</span>
                                    </p>
                                )}
                            </div>
                            <div className="text-right">
                                <p className="text-base font-black uppercase tracking-wider text-slate-900">{invoice.title}</p>
                                <p className="text-[10px] text-slate-400">Original for recipient</p>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 border-b border-slate-800 divide-x divide-slate-800">
                            <p className="px-3 py-1.5">
                                <b>Invoice No:</b> {invoice.number || "—"}
                            </p>
                            <p className="px-3 py-1.5">
                                <b>Invoice Date:</b> {invoice.date || "—"}
                                {invoice.status ? `  ·  Status: ${invoice.status}` : ""}
                            </p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 border-b border-slate-800 sm:divide-x divide-slate-800">
                            <PartyBox party={invoice.billedBy} />
                            <PartyBox party={invoice.billedTo} />
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead className="bg-slate-200 text-slate-700 font-bold uppercase text-[10px]">
                                    <tr>
                                        <th className="text-center py-2 px-2">#</th>
                                        <th className="text-left py-2 px-2">Item / Description</th>
                                        <th className="text-right py-2 px-2">Qty</th>
                                        <th className="text-right py-2 px-2">Rate</th>
                                        <th className="text-right py-2 px-2">Taxable</th>
                                        <th className="text-right py-2 px-2">GST</th>
                                        <th className="text-right py-2 px-2">CGST</th>
                                        <th className="text-right py-2 px-2">SGST</th>
                                        <th className="text-right py-2 px-2">Amount</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200">
                                    {invoice.items.map((it, idx) => (
                                        <tr key={idx}>
                                            <td className="py-2 px-2 text-center text-slate-400">{idx + 1}</td>
                                            <td className="py-2 px-2 font-bold text-slate-900">
                                                {it.name}
                                                {it.variant && <span className="block text-[11px] font-normal text-slate-500">{it.variant}</span>}
                                            </td>
                                            <td className="py-2 px-2 text-right">{it.quantity}</td>
                                            <td className="py-2 px-2 text-right">{money(it.rate)}</td>
                                            <td className="py-2 px-2 text-right">{money(it.taxable)}</td>
                                            <td className="py-2 px-2 text-right">{it.gstPercent}%</td>
                                            <td className="py-2 px-2 text-right">{money(it.cgst)}</td>
                                            <td className="py-2 px-2 text-right">{money(it.sgst)}</td>
                                            <td className="py-2 px-2 text-right font-bold text-slate-900">{money(it.total)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot className="bg-slate-50 font-black text-slate-900 border-t border-slate-300">
                                    <tr>
                                        <td className="py-2 px-2" colSpan={2}>
                                            Total
                                        </td>
                                        <td className="py-2 px-2 text-right">{sum("quantity")}</td>
                                        <td />
                                        <td className="py-2 px-2 text-right">{money(sum("taxable"))}</td>
                                        <td />
                                        <td className="py-2 px-2 text-right">{money(sum("cgst"))}</td>
                                        <td className="py-2 px-2 text-right">{money(sum("sgst"))}</td>
                                        <td className="py-2 px-2 text-right">{money(sum("total"))}</td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-[1.3fr_1fr] border-t border-slate-800 md:divide-x divide-slate-800">
                            <div className="p-3 space-y-2">
                                {invoice.gstRows.length > 0 && (
                                    <div>
                                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">GST summary</p>
                                        <table className="w-full text-[11px] border border-slate-300">
                                            <thead className="bg-slate-100 font-bold">
                                                <tr>
                                                    <th className="py-1 px-1.5 text-center">Rate</th>
                                                    <th className="py-1 px-1.5 text-right">Taxable</th>
                                                    <th className="py-1 px-1.5 text-right">CGST</th>
                                                    <th className="py-1 px-1.5 text-right">SGST</th>
                                                    <th className="py-1 px-1.5 text-right">Total tax</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {invoice.gstRows.map((r) => (
                                                    <tr key={r.rate} className="border-t border-slate-200">
                                                        <td className="py-1 px-1.5 text-center">{r.rate}%</td>
                                                        <td className="py-1 px-1.5 text-right">{money(r.taxable)}</td>
                                                        <td className="py-1 px-1.5 text-right">
                                                            {money(r.cgst)} <span className="text-slate-400">({r.rate / 2}%)</span>
                                                        </td>
                                                        <td className="py-1 px-1.5 text-right">
                                                            {money(r.sgst)} <span className="text-slate-400">({r.rate / 2}%)</span>
                                                        </td>
                                                        <td className="py-1 px-1.5 text-right font-bold">{money(r.tax)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                                {invoice.method && (
                                    <p>
                                        <b>Payment mode:</b> {invoice.method}
                                    </p>
                                )}
                                {invoice.note && (
                                    <p>
                                        <b>Note:</b> {invoice.note}
                                    </p>
                                )}
                            </div>
                            <div className="p-3 space-y-1">
                                {invoice.totals.map((t) => (
                                    <div key={t.label} className="flex justify-between">
                                        <span>{t.label}</span>
                                        <span>{money(t.value)}</span>
                                    </div>
                                ))}
                                <div className="flex justify-between border-t-2 border-slate-800 pt-1.5 text-sm font-black text-slate-900">
                                    <span>Grand Total</span>
                                    <span>₹{money(invoice.grandTotal)}</span>
                                </div>
                                {invoice.payment.map((t) => (
                                    <div key={t.label} className="flex justify-between">
                                        <span>{t.label}</span>
                                        <span>{money(t.value)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <p className="px-3 py-2 border-t border-slate-800">
                            <b>Amount in words:</b> {invoice.amountInWords}
                        </p>
                        <div className="flex items-end justify-between gap-4 px-3 py-3 border-t border-slate-800 min-h-[72px]">
                            <p className="text-[10px] text-slate-500 max-w-[55%]">
                                Declaration: We declare that this invoice shows the actual price of the goods described and that all particulars are
                                true and correct. This is a computer-generated invoice.
                            </p>
                            <div className="text-right">
                                <p className="font-bold text-slate-900">For {biz.name}</p>
                                <p className="mt-6 text-[10px] text-slate-500">Authorised Signatory</p>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex items-center justify-end gap-2 px-6 py-3 border-t border-slate-100 bg-slate-50/70">
                    <button type="button" className={ghostBtn} onClick={onClose}>
                        Close
                    </button>
                    <button type="button" className={ghostBtn} disabled={downloading} onClick={download}>
                        <HiOutlineArrowDownTray className="h-4 w-4" /> Download PDF
                    </button>
                    <button type="button" className={btnCls} onClick={() => printInvoice(invoice)}>
                        <HiOutlinePrinter className="h-4 w-4" /> Print invoice
                    </button>
                </div>
            </div>
        </div>
    );
};

export default InvoiceModal;
