import React, { useState, useMemo, useEffect, useRef } from "react";
import Card from "@shared/components/ui/Card";
import Badge from "@shared/components/ui/Badge";
import Input from "@shared/components/ui/Input";
import Button from "@shared/components/ui/Button";
import Modal from "@shared/components/ui/Modal";
import {
  HiOutlineCreditCard,
  HiOutlineArrowDownTray,
  HiOutlineFunnel,
  HiOutlineMagnifyingGlass,
  HiOutlineDocumentText,
  HiOutlineBanknotes,
  HiOutlineClock,
  HiOutlineCheckCircle,
  HiOutlineXCircle,
  HiOutlineArrowUpRight,
  HiOutlineArrowDownLeft,
  HiOutlineCalendarDays,
} from "react-icons/hi2";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { BlurFade } from "@/components/ui/blur-fade";
import { MagicCard } from "@/components/ui/magic-card";
import { toast } from "sonner";
import { exportToCSV } from "@/lib/exportUtils";
import { useSellerEarnings } from "../context/SellerEarningsContext";
import { sellerApi } from "../services/sellerApi";
import Pagination from "@shared/components/ui/Pagination";
import { formatAmount } from "@shared/utils/currency";
import { printHtml } from "../utils/ledgerStatement";

const escHtml = (v) =>
  String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// Prints only the selected transaction's receipt (not the page behind the modal).
const printTransactionReceipt = (txn) => {
  const amount = Number(txn.amount ?? 0);
  const when = txn.date && txn.time
    ? `${txn.date} at ${txn.time}`
    : txn.createdAt
      ? new Date(txn.createdAt).toLocaleString("en-IN")
      : "—";
  const row = (k, v) => `<tr><td>${k}</td><td class="v">${escHtml(v ?? "—")}</td></tr>`;
  printHtml(`<!doctype html><html><head><meta charset="utf-8"/><title>Transaction ${escHtml(txn.id ?? txn.ref ?? "")}</title>
<style>body{font-family:Arial,Helvetica,sans-serif;color:#0f172a;margin:24px;font-size:12px}h1{font-size:16px;margin:0 0 4px}
.amt{font-size:22px;font-weight:800;margin:10px 0}table{width:100%;border-collapse:collapse}td{border-bottom:1px solid #e2e8f0;padding:7px 4px}
td.v{text-align:right;font-weight:700}.muted{color:#64748b;font-size:10px;margin-top:16px}@page{size:A5;margin:12mm}</style></head><body>
<h1>Transaction Receipt</h1><div class="amt">${amount > 0 ? "+" : amount < 0 ? "-" : ""}&#8377;${escHtml(formatAmount(Math.abs(amount)))}</div>
<table>${row("Status", txn.status)}${row("Transaction ID", txn.id ?? txn.ref)}${row("Type", txn.type)}${row("Customer", txn.customer)}${row("Reference", txn.ref)}${row("Date &amp; time", when)}</table>
<p class="muted">Computer-generated receipt.</p></body></html>`);
};

const txnFilters = ({ from, to, activeTab, search }) => ({
  from: from || undefined,
  to: to || undefined,
  type: activeTab === "All" ? undefined : activeTab,
  search: search.trim() || undefined,
});

const Transactions = () => {
  // Balances still come from the shared earnings summary; the ledger itself is
  // fetched page by page from the server so every past entry is reachable.
  const { earningsData: data, earningsLoading: loading } = useSellerEarnings();
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [activeTab, setActiveTab] = useState("All");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selectedTxn, setSelectedTxn] = useState(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [list, setList] = useState({ items: [], total: 0, totalPages: 1, totals: null });
  const [listLoading, setListLoading] = useState(true);
  const requestSeq = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const filters = useMemo(
    () => txnFilters({ from, to, activeTab, search: debouncedSearch }),
    [from, to, activeTab, debouncedSearch],
  );

  useEffect(() => {
    const seq = ++requestSeq.current;
    setListLoading(true);
    sellerApi
      .getTransactions({ ...filters, page, limit: pageSize })
      .then((res) => {
        if (seq !== requestSeq.current) return;
        const result = res?.data?.result || {};
        setList({
          items: Array.isArray(result.items) ? result.items : [],
          total: result.total || 0,
          totalPages: result.totalPages || 1,
          totals: result.totals || null,
        });
      })
      .catch(() => seq === requestSeq.current && toast.error("Failed to load transactions"))
      .finally(() => seq === requestSeq.current && setListLoading(false));
  }, [filters, page, pageSize]);

  const hasFilters = Boolean(from || to || activeTab !== "All" || searchTerm);
  const clearFilters = () => {
    setFrom("");
    setTo("");
    setActiveTab("All");
    setSearchTerm("");
    setPage(1);
  };

  const stats = [
    {
      label: "Settled Balance",
      value: `₹${formatAmount(data?.balances?.settledBalance || 0)}`,
      icon: HiOutlineBanknotes,
      color: "text-brand-600",
      bg: "bg-brand-50",
    },
    {
      label: "Pending Payouts",
      value: `₹${formatAmount(data?.balances?.pendingPayouts || 0)}`,
      icon: HiOutlineClock,
      color: "text-amber-600",
      bg: "bg-amber-50",
    },
    {
      label: "Total Revenue",
      value: `₹${formatAmount(data?.balances?.totalRevenue || 0)}`,
      icon: HiOutlineCreditCard,
      color: "text-brand-600",
      bg: "bg-brand-50",
    },
  ];

  const paginatedTransactions = list.items;

  // Statement covers every entry matching the filters, not just this page.
  const fetchAllFiltered = async () => {
    const all = [];
    let nextPage = 1;
    let totalPages = 1;
    do {
      const res = await sellerApi.getTransactions({ ...filters, page: nextPage, limit: 100 });
      const result = res?.data?.result || {};
      if (Array.isArray(result.items)) all.push(...result.items);
      totalPages = result.totalPages || 1;
      nextPage += 1;
    } while (nextPage <= totalPages);
    return all;
  };

  const handleDownloadReceipt = (txn) => {
    try {
      const record = {
        id: txn.id ?? txn.ref ?? "",
        type: txn.type ?? "",
        amount: `₹${formatAmount(Math.abs(Number(txn.amount ?? 0)))}`,
        status: txn.status ?? "",
        date:
          txn.date ??
          (txn.createdAt
            ? new Date(txn.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
            : ""),
        time:
          txn.time ??
          (txn.createdAt
            ? new Date(txn.createdAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })
            : ""),
        customer: txn.customer ?? "",
        ref: txn.ref ?? "",
      };
      exportToCSV([record], `Transaction_${record.id || "receipt"}`, {
        id: "Transaction ID",
        type: "Type",
        amount: "Amount",
        status: "Status",
        date: "Date",
        time: "Time",
        customer: "Customer/Recipient",
        ref: "Reference",
      });
      toast.success("Receipt downloaded");
    } catch (error) {
      console.error("Receipt download error:", error);
      toast.error("Failed to download receipt");
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-screen font-black text-slate-600">LOADING TRANSACTIONS...</div>;
  }

  return (
    <div className="space-y-8 pb-16">
      <BlurFade delay={0.1}>
        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-slate-900 flex items-center gap-2">
              Transaction Ledger
              <Badge
                variant="primary"
                className="text-[10px] sm:text-xs px-1.5 py-0 font-bold tracking-wider uppercase bg-brand-100 text-brand-700">
                Audit Trail
              </Badge>
            </h1>
            <p className="text-slate-600 text-sm mt-0.5 font-medium">
              Keep track of all financial movements, payouts, and settlements.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              onClick={async () => {
                setIsDownloading(true);
                try {
                  const rows = await fetchAllFiltered();
                  const exportData = rows.map((txn) => ({
                    id: txn.id ?? txn.ref ?? "",
                    type: txn.type ?? "",
                    amount: `₹${formatAmount(txn.amount ?? 0)}`,
                    status: txn.status ?? "",
                    date: txn.date ?? (txn.createdAt ? new Date(txn.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : ""),
                    time: txn.time ?? (txn.createdAt ? new Date(txn.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""),
                    customer: txn.customer ?? "",
                    ref: txn.ref ?? "",
                  }));

                  const period = from || to ? `_${from || "start"}_to_${to || "today"}` : "";
                  exportToCSV(exportData, `Seller_Transactions${period}`, {
                    id: "Transaction ID",
                    type: "Type",
                    amount: "Amount",
                    status: "Status",
                    date: "Date",
                    time: "Time",
                    customer: "Customer",
                    ref: "Reference"
                  });
                  toast.success("Statement downloaded successfully!");
                } catch (error) {
                  console.error("Download Error:", error);
                  toast.error("Failed to download statement");
                } finally {
                  setIsDownloading(false);
                }
              }}
              className="rounded-lg px-4 py-2 shadow-lg shadow-primary/20 disabled:opacity-50"
              disabled={isDownloading || list.total === 0}>
              <HiOutlineDocumentText className="h-4 w-4 mr-2" />
              {isDownloading ? "DOWNLOADING..." : "DOWNLOAD STATEMENTS"}
            </Button>
          </div>
        </div>
      </BlurFade>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {stats.map((stat, i) => (
          <BlurFade key={i} delay={0.1 + i * 0.05}>
            <MagicCard
              className="border-none shadow-md overflow-hidden bg-white p-0"
              gradientColor="#f8fafc">
              <div className="p-6 relative z-10 flex items-center gap-4">
                <div
                  className={cn(
                    "h-14 w-14 rounded-lg flex items-center justify-center shadow-lg shadow-black/5",
                    stat.bg,
                    stat.color,
                  )}>
                  <stat.icon className="h-7 w-7" />
                </div>
                <div>
                  <p className="text-xs font-black text-slate-600 uppercase tracking-widest">
                    {stat.label}
                  </p>
                  <h4 className="text-3xl font-black text-slate-900 tracking-tight">
                    {stat.value}
                  </h4>
                </div>
              </div>
            </MagicCard>
          </BlurFade>
        ))}
      </div>

      <BlurFade delay={0.4}>
        <Card className="border-none shadow-xl shadow-slate-200/50 overflow-hidden rounded-lg p-0 bg-white">
          {/* Toolbar */}
          <div className="p-6 border-b border-slate-50 flex flex-col md:flex-row gap-4 items-center justify-between bg-white">
            <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200 shrink-0">
              {["All", "Order Payment", "Withdrawal", "Refund"].map((tab) => (
                <button
                  key={tab}
                  onClick={() => {
                    setActiveTab(tab);
                    setPage(1);
                  }}
                  className={cn(
                    "px-4 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap",
                    activeTab === tab
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-600 hover:text-slate-700",
                  )}>
                  {tab === "Order Payment" ? "Payments" : tab}
                </button>
              ))}
            </div>
            <div className="flex flex-col sm:flex-row gap-2 w-full md:w-auto md:items-center">
              <div className="flex items-center gap-2">
                <HiOutlineCalendarDays className="h-4 w-4 text-slate-600 shrink-0" />
                <Input
                  type="date"
                  title="From date"
                  value={from}
                  max={to || undefined}
                  onChange={(e) => {
                    setFrom(e.target.value);
                    setPage(1);
                  }}
                  className="py-2 rounded-lg text-xs font-semibold min-w-[140px]"
                />
                <span className="text-xs font-bold text-slate-500">to</span>
                <Input
                  type="date"
                  title="To date"
                  value={to}
                  min={from || undefined}
                  onChange={(e) => {
                    setTo(e.target.value);
                    setPage(1);
                  }}
                  className="py-2 rounded-lg text-xs font-semibold min-w-[140px]"
                />
              </div>
              <div className="relative w-full md:w-64">
                <HiOutlineMagnifyingGlass className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-600" />
                <Input
                  placeholder="Search order, customer, amount..."
                  className="pl-10 pr-4 py-2.5 rounded-lg border-none ring-1 ring-slate-100 bg-slate-50/50 focus:ring-2 focus:ring-primary/20 transition-all text-xs font-semibold"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              {hasFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="text-xs font-bold text-slate-600 hover:text-slate-900 whitespace-nowrap px-2">
                  Clear filters
                </button>
              )}
            </div>
          </div>
          {list.totals && (
            <div className="px-6 py-3 border-b border-slate-50 flex flex-wrap gap-x-6 gap-y-1 text-xs font-bold text-slate-600">
              <span>{list.total} transaction(s){from || to ? ` · ${from || "start"} to ${to || "today"}` : ""}</span>
              <span className="text-brand-600">Credits ₹{formatAmount(list.totals.credits)}</span>
              <span className="text-rose-600">Debits ₹{formatAmount(list.totals.debits)}</span>
              <span className="text-slate-900">
                Net {list.totals.net < 0 ? "-" : ""}₹{formatAmount(Math.abs(list.totals.net))}
              </span>
            </div>
          )}

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[720px]">
              <thead>
                <tr className="bg-slate-50/50 border-b border-slate-100">
                  <th className="px-6 py-4 text-xs font-black text-slate-600 uppercase tracking-widest">
                    Transaction Details
                  </th>
                  <th className="px-6 py-4 text-xs font-black text-slate-600 uppercase tracking-widest">
                    Reference
                  </th>
                  <th className="px-6 py-4 text-xs font-black text-slate-600 uppercase tracking-widest">
                    Amount
                  </th>
                  <th className="px-6 py-4 text-xs font-black text-slate-600 uppercase tracking-widest">
                    Status
                  </th>
                  <th className="px-6 py-4 text-xs font-black text-slate-600 uppercase tracking-widest text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                <AnimatePresence>
                  {listLoading && paginatedTransactions.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center text-slate-600 text-sm font-medium">
                        Loading transactions…
                      </td>
                    </tr>
                  ) : paginatedTransactions.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center text-slate-600 text-sm font-medium">
                        {hasFilters ? "No transactions match these dates or filters." : "No transactions yet."}
                      </td>
                    </tr>
                  ) : paginatedTransactions.map((txn, idx) => (
                    <motion.tr
                      key={txn.id || txn.ref || txn.reference || `txn-${idx}`}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      onClick={() => {
                        setSelectedTxn(txn);
                        setIsDetailModalOpen(true);
                      }}
                      className="group hover:bg-slate-50/50 transition-all cursor-pointer">
                      <td className="px-6 py-5">
                        <div className="flex items-center gap-4">
                          <div
                            className={cn(
                              "h-10 w-10 rounded-lg flex items-center justify-center font-black transition-all group-hover:scale-110",
                              txn.amount > 0
                                ? "bg-brand-50 text-brand-600"
                                : "bg-rose-50 text-rose-600",
                            )}>
                            {txn.amount > 0 ? (
                              <HiOutlineArrowDownLeft className="h-5 w-5" />
                            ) : (
                              <HiOutlineArrowUpRight className="h-5 w-5" />
                            )}
                          </div>
                          <div>
                            <p className="text-sm font-black text-slate-900 group-hover:text-primary transition-colors">
                              {txn.id ?? txn.ref ?? "—"}
                            </p>
                            <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">
                              {txn.type ?? "—"}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-5">
                        <p className="text-xs font-bold text-slate-900">
                          {txn.customer ?? "—"}
                        </p>
                        <div className="flex items-center gap-1.5 mt-1">
                          <Badge className="text-[10px] sm:text-xs px-1 py-0 bg-slate-100 text-slate-600 font-bold border-none">
                            {txn.ref ?? "—"}
                          </Badge>
                          <span className="text-[10px] sm:text-xs text-slate-600 font-bold uppercase tracking-tighter">
                            {txn.date ?? (txn.createdAt ? new Date(txn.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : "—")} • {txn.time ?? (txn.createdAt ? new Date(txn.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—")}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-5">
                        <p
                          className={cn(
                            "text-sm font-black tracking-tight",
                            Number(txn.amount ?? 0) > 0
                              ? "text-brand-600"
                              : "text-rose-600",
                          )}>
                          {Number(txn.amount ?? 0) > 0 ? "+" : ""}₹
                          {formatAmount(Math.abs(Number(txn.amount ?? 0)))}
                        </p>
                        <p className="text-[10px] sm:text-xs font-bold text-slate-600 mt-0.5">
                          Settlement: {(txn.status ?? "") === "Settled" ? "Complete" : "T+2"}
                        </p>
                      </td>
                      <td className="px-6 py-5">
                        <Badge
                          variant={
                            txn.status === "Settled"
                              ? "success"
                              : txn.status === "Pending" || txn.status === "Processing"
                                ? "warning"
                                : "default"
                          }
                          className="text-[10px] sm:text-xs font-black uppercase tracking-widest px-2-5 py-0.5 rounded-lg">
                          {txn.status === "Settled" ? (
                            <HiOutlineCheckCircle className="mr-1 h-3 w-3" />
                          ) : (
                            <HiOutlineClock className="mr-1 h-3 w-3" />
                          )}
                          {txn.status}
                        </Badge>
                      </td>
                      <td className="px-6 py-5 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDownloadReceipt(txn);
                          }}
                          className="h-9 w-9 rounded-lg flex items-center justify-center text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-all ml-auto">
                          <HiOutlineArrowDownTray className="h-5 w-5" />
                        </button>
                      </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>

          {list.total > 0 && (
            <div className="p-4 border-t border-slate-50 bg-slate-50/40">
              <Pagination
                page={page}
                totalPages={list.totalPages}
                total={list.total}
                pageSize={pageSize}
                onPageChange={(newPage) => setPage(newPage)}
                onPageSizeChange={(newSize) => {
                  setPageSize(newSize);
                  setPage(1);
                }}
                loading={listLoading}
              />
            </div>
          )}
        </Card>
      </BlurFade>

      {/* Transaction Detail Modal */}
      <Modal
        isOpen={isDetailModalOpen}
        onClose={() => setIsDetailModalOpen(false)}
        title="Transaction Receipt">
        {selectedTxn && (
          <div className="space-y-6">
            <div className="text-center p-6 bg-slate-50 rounded-lg border border-slate-100">
              <p className="text-xs font-black text-slate-600 uppercase tracking-widest mb-1">
                Total Amount
              </p>
              <h2
                className={cn(
                  "text-4xl font-black tracking-tight",
                  Number(selectedTxn.amount ?? 0) > 0 ? "text-brand-600" : "text-rose-600",
                )}>
                {Number(selectedTxn.amount ?? 0) > 0 ? "+" : ""}₹
                {formatAmount(Math.abs(Number(selectedTxn.amount ?? 0)))}
              </h2>
              <Badge className="mt-4 uppercase font-black text-[10px] sm:text-xs px-3 py-1">
                {selectedTxn.status ?? "—"}
              </Badge>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-600 font-bold">Transaction ID</span>
                <span className="text-slate-900 font-black">
                  {selectedTxn.id ?? selectedTxn.ref ?? "—"}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-600 font-bold">Type</span>
                <span className="text-slate-900 font-black">
                  {selectedTxn.type ?? "—"}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-600 font-bold">
                  Customer/Recipient
                </span>
                <span className="text-slate-900 font-black">
                  {selectedTxn.customer ?? "—"}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-600 font-bold">Reference</span>
                <span className="text-slate-900 font-black">
                  {selectedTxn.ref ?? "—"}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-600 font-bold">Date & Time</span>
                <span className="text-slate-900 font-black">
                  {selectedTxn.date && selectedTxn.time
                    ? `${selectedTxn.date} at ${selectedTxn.time}`
                    : selectedTxn.createdAt
                      ? `${new Date(selectedTxn.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })} at ${new Date(selectedTxn.createdAt).toLocaleTimeString()}`
                      : "—"}
                </span>
              </div>
            </div>

            <div className="p-4 bg-amber-50 rounded-lg border border-amber-100 flex gap-3">
              <HiOutlineClock className="h-5 w-5 text-amber-600 shrink-0" />
              <p className="text-[10px] text-amber-800 font-bold leading-relaxed">
                This transaction is scheduled for settlement in your bank
                account via T+2 rolling cycle. Settlements usually occur before
                6:00 PM.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <Button
                variant="outline"
                onClick={() => printTransactionReceipt(selectedTxn)}
                className="rounded-lg py-4 font-black bg-white">
                PRINT RECEIPT
              </Button>
              <Button
                onClick={() => setIsDetailModalOpen(false)}
                className="rounded-lg py-4 font-black shadow-xl shadow-primary/20">
                CLOSE
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default Transactions;
