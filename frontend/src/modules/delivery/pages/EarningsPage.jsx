import React, { useState, useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell
} from "recharts";
import { TrendingUp, ArrowUpRight, RotateCcw, Download, Wallet, Gift, HeartHandshake, Calendar, ChevronRight, RefreshCw, Zap } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import { deliveryApi } from "../services/deliveryApi";
import { cn } from "@/lib/utils";

const RUPEE = "₹";
const DOT = "•";

const isReturnPickupTxn = (txn) => {
  if (!txn) return false;
  if (
    txn.meta?.flow === "return_drop_commission" ||
    String(txn.meta?.flow || "").toLowerCase().includes("return") ||
    String(txn.meta?.source || "").toLowerCase().includes("return")
  ) {
    return true;
  }
  const ref = String(txn.reference || "");
  if (ref.startsWith("RET-") || ref.includes("RET-DROP") || ref.includes("RET-DEL")) {
    return true;
  }
  return false;
};

const formatTime = (isoString) => {
  if (!isoString) return "";
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true });
  } catch {
    return "";
  }
};

const resolveTipAmount = (txn) =>
  Number(
    txn?.meta?.tipAmount ??
      txn?.order?.paymentBreakdown?.riderTipAmount ??
      txn?.order?.pricing?.tip ??
      0,
  );

const formatAmount = (val) => {
  const num = Math.round(Number(val || 0));
  return num.toLocaleString("en-IN");
};

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    const total = payload.reduce((sum, entry) => sum + (Number(entry.value) || 0), 0);
    return (
      <div className="bg-slate-900 text-white p-3 rounded-xl shadow-xl border border-slate-700 text-xs space-y-1">
        <p className="font-bold text-slate-300 border-b border-slate-700 pb-1">{label}</p>
        {payload.map((entry, index) => (
          <div key={`item-${index}`} className="flex justify-between gap-4 items-center">
            <span className="capitalize text-slate-400 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.fill }} />
              {entry.name}:
            </span>
            <span className="font-bold text-white">{RUPEE}{formatAmount(entry.value)}</span>
          </div>
        ))}
        {payload.length > 1 && (
          <div className="flex justify-between gap-4 pt-1 border-t border-slate-700 font-extrabold text-emerald-400">
            <span>Total:</span>
            <span>{RUPEE}{formatAmount(total)}</span>
          </div>
        )}
      </div>
    );
  }
  return null;
};

const EarningsPage = () => {
  const [activeTab, setActiveTab] = useState("weekly");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [earningsData, setEarningsData] = useState({
    totalEarnings: 0,
    todayEarnings: 0,
    weeklyEarnings: 0,
    incentives: 0,
    todayIncentives: 0,
    bonuses: 0,
    tipsReceived: 0,
    todayTips: 0,
    chartData: [],
    recentTransactions: [],
  });

  const fetchEarnings = async (isManual = false) => {
    try {
      if (isManual) setRefreshing(true);
      else setLoading(true);

      const response = await deliveryApi.getEarnings();
      if (response.data.success && response.data.result) {
        const result = response.data.result;
        const txns = result.transactions || result.recentTransactions || [];

        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        sevenDaysAgo.setHours(0, 0, 0, 0);

        const isEarningTxn = (t) =>
          t.status === "Settled" &&
          (t.type === "Delivery Earning" || t.type === "Incentive" || t.type === "Bonus");

        const todayTxns = txns.filter((t) => new Date(t.createdAt) >= startOfToday);
        const weeklyTxns = txns.filter((t) => new Date(t.createdAt) >= sevenDaysAgo);

        const sum = (list) => list.filter(isEarningTxn).reduce((acc, t) => acc + (t.amount || 0), 0);
        const sumTips = (list) =>
          list
            .filter((t) => t.type === "Delivery Earning" && t.status === "Settled")
            .reduce(
              (acc, t) =>
                acc + Number(t?.meta?.tipAmount ?? t?.order?.paymentBreakdown?.riderTipAmount ?? t?.order?.pricing?.tip ?? 0),
              0,
            );
        const sumIncentives = (list) =>
          list
            .filter((t) => (t.type === "Incentive" || t.type === "Bonus") && t.status === "Settled")
            .reduce((acc, t) => acc + (t.amount || 0), 0);

        setEarningsData({
          totalEarnings: result.totalEarnings || 0,
          todayEarnings: sum(todayTxns),
          weeklyEarnings: sum(weeklyTxns),
          incentives: result.incentives || 0,
          todayIncentives: sumIncentives(todayTxns),
          bonuses: result.bonuses || 0,
          tipsReceived: result.tipsReceived || 0,
          todayTips: sumTips(todayTxns),
          chartData: result.chartData || [],
          recentTransactions: txns,
        });
        if (isManual) toast.success("Earnings updated");
      }
    } catch {
      toast.error("Failed to fetch earnings data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  React.useEffect(() => {
    fetchEarnings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const defaultChartData = useMemo(() => {
    if (earningsData.chartData && earningsData.chartData.length > 0) {
      return earningsData.chartData;
    }
    return [
      { name: "Mon", earnings: 0, incentives: 0 },
      { name: "Tue", earnings: 0, incentives: 0 },
      { name: "Wed", earnings: 0, incentives: 0 },
      { name: "Thu", earnings: 0, incentives: 0 },
      { name: "Fri", earnings: 0, incentives: 0 },
      { name: "Sat", earnings: 0, incentives: 0 },
      { name: "Sun", earnings: 0, incentives: 0 },
    ];
  }, [earningsData.chartData]);

  const filteredTransactions = useMemo(() => {
    const txns = Array.isArray(earningsData.recentTransactions)
      ? earningsData.recentTransactions
      : [];
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (activeTab === "today") {
      return txns.filter(
        (t) => new Date(t.createdAt || t.date || Date.now()) >= startOfToday,
      );
    }
    if (activeTab === "weekly") {
      const sevenDaysAgo = new Date(startOfToday);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
      return txns.filter(
        (t) => new Date(t.createdAt || t.date || Date.now()) >= sevenDaysAgo,
      );
    }
    if (activeTab === "monthly") {
      const thirtyDaysAgo = new Date(startOfToday);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
      return txns.filter(
        (t) => new Date(t.createdAt || t.date || Date.now()) >= thirtyDaysAgo,
      );
    }
    return txns;
  }, [earningsData.recentTransactions, activeTab]);

  const groupedTransactions = useMemo(() => {
    const groups = {};
    const now = new Date();
    const todayKey = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toDateString();
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const yesterdayKey = yesterday.toDateString();

    filteredTransactions.forEach((txn) => {
      const rawDate = txn.createdAt || txn.date || Date.now();
      const d = new Date(rawDate);
      const dateKey = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toDateString();

      let label = "";
      if (dateKey === todayKey) {
        label = "Today";
      } else if (dateKey === yesterdayKey) {
        label = "Yesterday";
      } else {
        label = d.toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        });
      }

      const formattedSubDate = d.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
      });

      if (!groups[dateKey]) {
        groups[dateKey] = {
          dateKey,
          label,
          formattedSubDate,
          timestamp: d.getTime(),
          items: [],
          totalEarning: 0,
        };
      }

      groups[dateKey].items.push(txn);
      if (
        (txn.status === "Settled" || txn.status === "Completed") &&
        (txn.type === "Delivery Earning" || txn.type === "Incentive" || txn.type === "Bonus")
      ) {
        groups[dateKey].totalEarning += Number(txn.amount || 0);
      }
    });

    return Object.values(groups).sort((a, b) => b.timestamp - a.timestamp);
  }, [filteredTransactions]);

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.08 } },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 15 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.3 } },
  };

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-4">
        <div className="relative flex items-center justify-center">
          <div className="h-14 w-14 animate-spin rounded-full border-4 border-emerald-200 border-t-emerald-600" />
          <Zap className="absolute h-6 w-6 text-emerald-600 animate-pulse" />
        </div>
        <p className="mt-4 text-xs font-bold text-slate-500 uppercase tracking-widest">
          Loading Earnings...
        </p>
      </div>
    );
  }

  return (
    <div className="bg-slate-50 min-h-screen pb-28 font-sans">
      {/* Sticky Header */}
      <div className="bg-white/90 backdrop-blur-md border-b border-slate-100 p-5 sticky top-0 z-30 shadow-xs">
        <div className="flex justify-between items-center mb-4 max-w-lg mx-auto">
          <div>
            <h1 className="text-xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
              <Wallet className="h-6 w-6 text-emerald-600" />
              My Earnings
            </h1>
            <p className="text-xs font-medium text-slate-500">Track payouts, incentives & tips</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchEarnings(true)}
              disabled={refreshing}
              className="p-2 rounded-xl text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
              title="Refresh"
            >
              <RefreshCw size={18} className={cn(refreshing && "animate-spin text-emerald-600")} />
            </button>
            <button
              onClick={() => toast.info("Downloading earnings statement...")}
              className="p-2 rounded-xl text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
              title="Download Statement"
            >
              <Download size={18} />
            </button>
          </div>
        </div>

        {/* Timeframe Filter Tabs */}
        <div className="max-w-lg mx-auto flex bg-slate-100 p-1.5 rounded-2xl border border-slate-200/60">
          {[
            { id: "today", label: "Today" },
            { id: "weekly", label: "Weekly" },
            { id: "monthly", label: "Monthly" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex-1 py-2 text-xs font-extrabold rounded-xl transition-all duration-200 capitalize",
                activeTab === tab.id
                  ? "bg-white text-emerald-600 shadow-md shadow-slate-200/50"
                  : "text-slate-500 hover:text-slate-700"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <motion.div
        className="p-4 sm:p-6 space-y-5 max-w-lg mx-auto"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {/* Main Hero Card */}
        <motion.div variants={itemVariants}>
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-800 via-emerald-700 to-teal-900 p-6 text-white shadow-xl shadow-emerald-900/20 border border-emerald-600/30">
            {/* Ambient Background Glows */}
            <div className="absolute top-0 right-0 w-44 h-44 bg-emerald-400/20 rounded-full -mr-16 -mt-16 blur-3xl pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-36 h-36 bg-teal-400/20 rounded-full -ml-16 -mb-16 blur-2xl pointer-events-none" />

            <div className="flex justify-between items-start mb-2 relative z-10">
              <span className="text-[11px] font-black uppercase tracking-wider text-emerald-200/90 bg-emerald-900/40 px-3 py-1 rounded-full border border-emerald-600/30 backdrop-blur-sm">
                {activeTab === "today" ? "Today's Earnings" : activeTab === "weekly" ? "Weekly Earnings" : "Total Earnings"}
              </span>
              <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-300 bg-emerald-950/40 px-2.5 py-0.5 rounded-full border border-emerald-500/20">
                <TrendingUp size={12} /> Live Payouts
              </span>
            </div>

            <div className="flex items-baseline my-3 relative z-10">
              <span className="text-3xl font-extrabold text-emerald-200 mr-1.5">{RUPEE}</span>
              <span className="text-5xl font-black tracking-tight text-white drop-shadow-sm">
                {formatAmount(
                  activeTab === "today"
                    ? earningsData.todayEarnings
                    : activeTab === "weekly"
                    ? earningsData.weeklyEarnings
                    : earningsData.totalEarnings
                )}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-4 mt-4 border-t border-emerald-600/40 relative z-10">
              <div className="bg-emerald-950/30 p-3 rounded-2xl border border-emerald-500/20 backdrop-blur-sm">
                <div className="flex items-center gap-1.5 mb-1">
                  <Gift size={14} className="text-emerald-300" />
                  <p className="text-emerald-200 text-[11px] font-bold uppercase tracking-wider">Incentives</p>
                </div>
                <p className="font-black text-lg text-white">
                  +{RUPEE}{formatAmount(activeTab === "today" ? earningsData.todayIncentives : earningsData.incentives)}
                </p>
              </div>

              <div className="bg-emerald-950/30 p-3 rounded-2xl border border-emerald-500/20 backdrop-blur-sm">
                <div className="flex items-center gap-1.5 mb-1">
                  <HeartHandshake size={14} className="text-teal-300" />
                  <p className="text-emerald-200 text-[11px] font-bold uppercase tracking-wider">Customer Tips</p>
                </div>
                <p className="font-black text-lg text-white">
                  +{RUPEE}{formatAmount(activeTab === "today" ? earningsData.todayTips : earningsData.tipsReceived)}
                </p>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Earnings Trend Bar Chart Card */}
        <motion.div variants={itemVariants}>
          <div className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
            <div className="flex justify-between items-center mb-5 px-1">
              <div>
                <h3 className="font-extrabold text-slate-900 text-sm flex items-center gap-2">
                  <TrendingUp size={18} className="text-emerald-600" />
                  Earnings Trend
                </h3>
                <p className="text-[11px] font-medium text-slate-400">Daily breakdown for active period</p>
              </div>
              <span className="text-[11px] font-bold text-slate-500 bg-slate-100 px-3 py-1 rounded-full border border-slate-200">
                Last 7 Days
              </span>
            </div>

            <div className="h-56 w-full pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={defaultChartData} barSize={24} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="primaryBarGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={1} />
                      <stop offset="100%" stopColor="#059669" stopOpacity={0.8} />
                    </linearGradient>
                    <linearGradient id="incentiveBarGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#38bdf8" stopOpacity={1} />
                      <stop offset="100%" stopColor="#0284c7" stopOpacity={0.8} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis
                    dataKey="name"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: "#64748b", fontWeight: 600 }}
                    dy={6}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="earnings" name="Base Pay" fill="url(#primaryBarGrad)" radius={[6, 6, 0, 0]} stackId="a" />
                  <Bar dataKey="incentives" name="Incentives" fill="url(#incentiveBarGrad)" radius={[6, 6, 0, 0]} stackId="a" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </motion.div>

        {/* Recent Transactions List */}
        <motion.div variants={itemVariants}>
          <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="p-4 px-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <div className="flex items-center gap-2">
                <h3 className="font-extrabold text-slate-900 text-sm">Recent Activity</h3>
                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-100/80 px-2.5 py-0.5 rounded-full capitalize">
                  {activeTab === "today" ? "Today" : activeTab === "weekly" ? "This Week" : "This Month"}
                </span>
              </div>
              <button
                onClick={() => setActiveTab(activeTab === "monthly" ? "today" : "monthly")}
                className="text-emerald-600 text-xs font-bold hover:underline flex items-center gap-0.5"
              >
                {activeTab === "monthly" ? "Show Today" : "View All"} <ChevronRight size={14} />
              </button>
            </div>

            <div>
              {groupedTransactions.length > 0 ? (
                groupedTransactions.map((group) => (
                  <div key={group.dateKey}>
                    {/* Date Classification Header */}
                    <div className="bg-slate-50/90 px-5 py-2.5 flex items-center justify-between border-y border-slate-100 text-xs">
                      <div className="flex items-center gap-1.5">
                        <Calendar size={13} className="text-slate-400" />
                        <span className="font-extrabold text-slate-800">{group.label}</span>
                        {(group.label === "Today" || group.label === "Yesterday") && (
                          <span className="text-[11px] font-medium text-slate-400">
                            ({group.formattedSubDate})
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] font-bold text-slate-500">
                        {group.items.length} {group.items.length === 1 ? "activity" : "activities"}
                        {group.totalEarning > 0 && (
                          <span className="ml-1 text-emerald-600 font-extrabold">
                            {DOT} +{RUPEE}{formatAmount(group.totalEarning)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Group Items */}
                    <div className="divide-y divide-slate-100">
                      {group.items.map((txn, idx) => {
                        const isSettled = txn.status === "Settled" || txn.status === "Completed";
                        const isWithdrawal = String(txn.type || "").toLowerCase().includes("withdrawal");
                        const isReturnPickup = isReturnPickupTxn(txn);
                        const tipAmt = resolveTipAmount(txn);
                        const timeStr = formatTime(txn.createdAt || txn.date);

                        return (
                          <div
                            key={txn._id || txn.id || `txn-${group.dateKey}-${idx}`}
                            className="p-4 px-5 flex justify-between items-center hover:bg-slate-50/80 transition-colors"
                          >
                            <div className="flex items-center gap-3.5">
                              <div
                                className={cn(
                                  "p-2.5 rounded-2xl flex items-center justify-center shrink-0 border",
                                  isWithdrawal
                                    ? "bg-rose-50 text-rose-600 border-rose-100"
                                    : isSettled
                                    ? "bg-emerald-50 text-emerald-600 border-emerald-100"
                                    : "bg-amber-50 text-amber-600 border-amber-100"
                                )}
                              >
                                {isReturnPickup ? (
                                  <RotateCcw size={18} />
                                ) : (
                                  <ArrowUpRight
                                    size={18}
                                    className={cn(isWithdrawal && "rotate-180")}
                                  />
                                )}
                              </div>
                              <div>
                                <p className="font-bold text-slate-900 text-sm leading-snug">
                                  {isReturnPickup ? "Return Pickup" : (txn.type || "Order Payout")}
                                </p>
                                <p className="text-[11px] font-medium text-slate-400 mt-0.5">
                                  {timeStr ? `${timeStr} ${DOT} ` : ""}ID: {txn.id || (txn._id ? String(txn._id).slice(-6).toUpperCase() : "N/A")}
                                </p>
                                {tipAmt > 0 && (
                                  <span className="inline-block mt-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-100">
                                    Includes tip: {RUPEE}{formatAmount(tipAmt)}
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="text-right shrink-0">
                              <p className={cn("font-black text-base", isWithdrawal ? "text-slate-800" : "text-emerald-600")}>
                                {isWithdrawal ? "-" : "+"}
                                {RUPEE}
                                {formatAmount(txn.amount)}
                              </p>
                              <span
                                className={cn(
                                  "inline-block text-[10px] font-extrabold uppercase tracking-wide px-2 py-0.5 rounded-full mt-1",
                                  isSettled
                                    ? "bg-emerald-50 text-emerald-600"
                                    : "bg-amber-50 text-amber-600"
                                )}
                              >
                                {txn.status || "Completed"}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-10 text-center space-y-2">
                  <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
                    <Calendar size={20} />
                  </div>
                  <p className="text-slate-700 font-bold text-sm">
                    No activities recorded {activeTab === "today" ? "today" : activeTab === "weekly" ? "this week" : "this month"}
                  </p>
                  <p className="text-slate-400 text-xs max-w-xs mx-auto">
                    {activeTab === "today"
                      ? "Completed delivery payouts and cash collections for today will appear here."
                      : "Complete deliveries to see your payouts, tips, and incentives here."}
                  </p>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
};

export default EarningsPage;

