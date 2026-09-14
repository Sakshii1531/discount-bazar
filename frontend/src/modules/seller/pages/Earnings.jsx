import React from "react";
import Card from "@shared/components/ui/Card";
import Button from "@shared/components/ui/Button";
import {
  TrendingUp,
  BarChart3,
  DollarSign,
  Download,
  Banknote,
  ArrowDownToLine,
  Building2,
  Wallet,
  Lightbulb,
  ArrowUpRight,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { exportToCSV } from "@/lib/exportUtils";
import { useSellerEarnings } from "../context/SellerEarningsContext";

const Earnings = () => {
  const navigate = useNavigate();
  const { earningsData: data, earningsLoading: loading } = useSellerEarnings();
  const [withdrawAmount, setWithdrawAmount] = React.useState("");
  const [isWithdrawModalOpen, setIsWithdrawModalOpen] = React.useState(false);
  const [isWithdrawing, setIsWithdrawing] = React.useState(false);

  React.useEffect(() => {
    if (data?.balances != null && withdrawAmount === "") {
      const avail = Number(data.balances?.availableBalance ?? data.balances?.settledBalance ?? 0);
      setWithdrawAmount(avail > 0 ? String(avail) : "");
    }
  }, [data?.balances]);

  const handleWithdraw = () => {
    const totalBalance = Number(data?.balances?.settledBalance ?? 0);
    const amount = parseFloat(withdrawAmount);
    if (isNaN(amount) || amount <= 0 || amount > totalBalance) {
      alert(
        "Please enter a valid amount between ₹0.01 and ₹" +
        totalBalance.toLocaleString()
      );
      return;
    }

    setIsWithdrawing(true);
    setTimeout(() => {
      setIsWithdrawing(false);
      setIsWithdrawModalOpen(false);
      alert(
        `Withdrawal request of ₹${amount.toLocaleString()} submitted successfully!`
      );
    }, 1500);
  };

  const handleExportCSV = () => {
    const ledger = Array.isArray(data?.ledger) ? data.ledger : [];
    if (ledger.length === 0) {
      toast.info("No transactions to export.");
      return;
    }
    const exportData = ledger.map((txn) => ({
      id: txn.id ?? txn.ref ?? "",
      type: txn.type ?? "",
      amount: `₹${Number(txn.amount ?? 0).toLocaleString()}`,
      status: txn.status ?? "",
      date: txn.date ?? (txn.createdAt ? new Date(txn.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : ""),
      customer: txn.customer ?? "",
      ref: txn.ref ?? "",
    }));
    exportToCSV(exportData, "Seller_Earnings_Report", {
      id: "Transaction ID",
      type: "Type",
      amount: "Amount",
      status: "Status",
      date: "Date",
      customer: "Customer",
      ref: "Reference",
    });
    toast.success("Earnings report downloaded successfully!");
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900 mb-3"></div>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Loading Earnings...</p>
      </div>
    );
  }

  const totalRevenue = Number(data?.balances?.totalRevenue ?? 0);
  const totalWithdrawn = Number(data?.balances?.totalWithdrawn ?? 0);
  const availableBalance = Number(data?.balances?.availableBalance ?? data?.balances?.settledBalance ?? 0);

  return (
    <div className="w-full p-0 sm:p-6 space-y-3 sm:space-y-6 font-['Outfit'] pb-20 sm:pb-8">
      {/* Header & Main Actions */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white border border-slate-200/80 rounded-2xl p-4 shadow-sm">
        <div>
          <h1 className="text-lg sm:text-2xl font-black text-slate-900 tracking-tight">Earnings Overview</h1>
          <p className="text-xs text-slate-500 font-medium">Track your shop revenue, withdrawals & payout balances</p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleExportCSV}
            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-bold transition-all active:scale-95">
            <Download className="h-4 w-4 text-slate-600" />
            <span>Report</span>
          </button>
          <button
            onClick={() => navigate("/seller/withdrawals")}
            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2.5 bg-slate-900 hover:bg-black text-white rounded-xl text-xs font-black shadow-sm transition-all active:scale-95">
            <Wallet className="h-4 w-4" />
            <span>Withdraw Funds</span>
          </button>
        </div>
      </div>

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-5">
        {/* Total Revenue */}
        <div className="bg-gradient-to-br from-slate-900 to-slate-950 text-white rounded-2xl p-4 sm:p-5 shadow-md border border-slate-800 flex flex-col justify-between relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-brand-500/10 rounded-full blur-2xl pointer-events-none" />
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">Total Revenue</span>
            <div className="h-8 w-8 rounded-xl bg-white/10 flex items-center justify-center">
              <DollarSign className="h-4 w-4 text-brand-400" />
            </div>
          </div>
          <div className="mt-3">
            <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">₹{totalRevenue.toLocaleString()}</h2>
            <div className="mt-2 flex items-center gap-1 text-[11px] font-bold text-emerald-400">
              <TrendingUp className="h-3.5 w-3.5" />
              <span>Real-time Order Earnings</span>
            </div>
          </div>
        </div>

        {/* Total Withdrawn */}
        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-5 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500">Total Withdrawn</span>
            <div className="h-8 w-8 rounded-xl bg-slate-100 flex items-center justify-center">
              <Banknote className="h-4 w-4 text-slate-700" />
            </div>
          </div>
          <div className="mt-3">
            <h2 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">₹{totalWithdrawn.toLocaleString()}</h2>
            <p className="mt-2 text-[11px] font-semibold text-slate-500">Total settled bank payouts</p>
          </div>
        </div>

        {/* Available Balance */}
        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-5 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500">Available to Withdraw</span>
            <div className="h-8 w-8 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center">
              <ArrowDownToLine className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3">
            <h2 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">₹{availableBalance.toLocaleString()}</h2>
            <button
              onClick={() => navigate("/seller/withdrawals")}
              className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-brand-600 hover:text-brand-700">
              <span>Transfer to bank</span>
              <ArrowUpRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>

      {/* Calculation Banner */}
      <div className="bg-emerald-50/70 border border-emerald-200/60 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="h-9 w-9 rounded-xl bg-emerald-500/15 text-emerald-700 flex items-center justify-center shrink-0 mt-0.5">
            <Lightbulb className="h-5 w-5" />
          </div>
          <div className="space-y-0.5 min-w-0">
            <h4 className="text-xs sm:text-sm font-black text-slate-900">How Seller Earnings Are Calculated?</h4>
            <p className="text-xs text-slate-600 font-medium leading-relaxed">
              Net Earning = <strong className="text-emerald-700 font-bold">Item Subtotal</strong> − <strong className="text-rose-600 font-bold">Platform Commission</strong>. Delivery Fee & GST are managed separately by platform.
            </p>
          </div>
        </div>
        <div className="px-3 py-1 bg-white rounded-xl border border-emerald-200 text-[11px] font-extrabold text-slate-700 shrink-0 self-stretch sm:self-auto text-center">
          Commission: <span className="text-brand-600">Category %</span>
        </div>
      </div>

      {/* Monthly Revenue Chart */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 bg-slate-100 rounded-xl flex items-center justify-center text-slate-800 shrink-0">
              <BarChart3 className="h-4 w-4" />
            </div>
            <h3 className="text-sm sm:text-base font-black text-slate-900">Monthly Revenue Performance</h3>
          </div>
        </div>

        <div className="h-[240px] sm:h-[300px] w-full min-h-[200px]">
          {(Array.isArray(data?.monthlyChart) ? data.monthlyChart : []).length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <p className="text-slate-400 text-xs font-bold">No monthly revenue data yet.</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.monthlyChart} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis
                  dataKey="name"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#64748b", fontSize: 11, fontWeight: 700 }}
                  dy={6}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#64748b", fontSize: 10, fontWeight: 700 }}
                  tickFormatter={(val) => `₹${val}`}
                />
                <Tooltip
                  cursor={{ fill: "#f8fafc" }}
                  contentStyle={{
                    borderRadius: "12px",
                    border: "1px solid #e2e8f0",
                    boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1)",
                    fontSize: "12px",
                    fontWeight: "700",
                  }}
                  formatter={(val) => [`₹${val.toLocaleString()}`, "Revenue"]}
                />
                <Bar
                  dataKey="revenue"
                  fill="#0f172a"
                  radius={[6, 6, 0, 0]}
                  maxBarSize={36}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
};

export default Earnings;
