import Order from "../models/order.js";
import Transaction from "../models/transaction.js";
import handleResponse from "../utils/helper.js";
import mongoose from "mongoose";
import Wallet from "../models/wallet.js";
import User from "../models/customer.js";
import { getSellerStats as getSellerStatsFromService } from "../services/seller/sellerStatsService.js";
import { getPagination } from "../utils/pagination.js";
import { escapeRegex } from "../utils/regex.js";
import { getSellerTz, dateKeyOf, dateRangeFilter } from "../services/businessTime.js";

const TXN_ORDER_POPULATE = {
    path: "order",
    select: "orderId customer address.name address.phone walkInCustomer",
    populate: { path: "customer", select: "name phone" },
};

// One ledger row as the seller panel renders it; date/time are in the seller's timezone.
const toLedgerRow = (t, tz) => ({
    id: (t.reference || t._id).toString(),
    type: t.type,
    amount: t.amount,
    status: t.status,
    date: dateKeyOf(t.createdAt, tz),
    time: t.createdAt.toLocaleTimeString("en-IN", { timeZone: tz, hour: "2-digit", minute: "2-digit" }),
    createdAt: t.createdAt,
    customer: t.type === 'Withdrawal' ? 'Bank Transfer' : 'Customer',
    ref: t.order ? `#${t.order.orderId}` : t.reference || t._id,
    // Real customer name/phone for the order — used by the seller's transaction search
    customerName: [
        t.order?.walkInCustomer?.name,
        t.order?.address?.name,
        t.order?.customer?.name,
        t.order?.walkInCustomer?.phone,
        t.order?.address?.phone,
        t.order?.customer?.phone,
    ].filter(Boolean).join(' ')
});

/* ===============================
   GET SELLER DASHBOARD STATS
   Delegates to SellerStatsService (P6.2 — cache-fronted) so the heavy
   $facet aggregation + category pipeline are absorbed for ~60s.
================================ */
export const getSellerStats = async (req, res) => {
    try {
        const result = await getSellerStatsFromService(req.user.id, {
            range: req.query?.range,
        });
        return handleResponse(res, 200, "Stats fetched successfully", result);
    } catch (error) {
        return handleResponse(res, error.statusCode || 500, error.message);
    }
};

/* ===============================
   GET SELLER EARNINGS / TRANSACTIONS
================================ */
export const getSellerEarnings = async (req, res) => {
    try {
        const sellerId = req.user.id;
        const sellerOid = new mongoose.Types.ObjectId(sellerId);

        const [transactions, tz] = await Promise.all([
            Transaction.find({ user: sellerId, userModel: 'Seller' })
                .sort({ createdAt: -1 })
                .populate(TXN_ORDER_POPULATE),
            getSellerTz(sellerId),
        ]);

        const settledBalance = transactions
            .filter(t => t.status === 'Settled')
            .reduce((acc, t) => acc + t.amount, 0);

        const pendingPayouts = transactions
            .filter(t => t.type === 'Withdrawal' && (t.status === 'Pending' || t.status === 'Processing'))
            .reduce((acc, t) => acc + Math.abs(t.amount), 0);

        // Fetch wallet for live pending balance (money on hold due to return window)
        const wallet = await Wallet.findOne({ ownerType: 'SELLER', ownerId: sellerId });
        const onHoldBalance = wallet ? wallet.pendingBalance : 0;
        const rawBaseBalance = wallet ? wallet.availableBalance : settledBalance;
        const liveAvailableBalance = Math.max(0, rawBaseBalance - pendingPayouts - onHoldBalance);

        // Keep "Total Revenue" aligned with Dashboard definition:
        // sum of non-cancelled seller orders from Order collection.
        const [orderRevenueAgg] = await Order.aggregate([
            {
                $match: {
                    seller: sellerOid,
                    status: { $ne: 'cancelled' },
                },
            },
            {
                $group: {
                    _id: null,
                    totalRevenue: { $sum: { $ifNull: ["$pricing.total", 0] } },
                },
            },
        ]);
        const totalRevenue = Number(orderRevenueAgg?.totalRevenue || 0);

        const totalWithdrawn = transactions
            .filter(t => t.type === 'Withdrawal' && t.status === 'Settled')
            .reduce((acc, t) => acc + Math.abs(t.amount), 0);

        // Monthly Revenue Aggregation (Last 6 Months) — sourced from Order collection
        // to stay consistent with totalRevenue which is also computed from Orders.
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
        sixMonthsAgo.setDate(1);
        sixMonthsAgo.setHours(0, 0, 0, 0);

        const monthlyAggregation = await Order.aggregate([
            {
                $match: {
                    seller: sellerOid,
                    status: { $ne: 'cancelled' },
                    createdAt: { $gte: sixMonthsAgo }
                }
            },
            {
                $group: {
                    _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } },
                    revenue: {
                        $sum: {
                            $ifNull: [
                                "$sellerNetEarning",
                                { $ifNull: ["$pricing.subtotal", { $ifNull: ["$pricing.total", 0] }] }
                            ]
                        }
                    }
                }
            },
            { $sort: { _id: 1 } }
        ]);

        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const chartData = [];
        for (let i = 5; i >= 0; i--) {
            const d = new Date();
            d.setMonth(d.getMonth() - i);
            const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const found = monthlyAggregation.find(m => m._id === dateStr);
            chartData.push({
                name: monthNames[d.getMonth()],
                revenue: found ? Math.round(found.revenue) : 0
            });
        }

        return handleResponse(res, 200, "Earnings fetched successfully", {
            balances: {
                settledBalance: settledBalance,
                pendingPayouts: pendingPayouts,
                onHoldBalance: onHoldBalance, // New field
                availableBalance: liveAvailableBalance, // New field for clarity
                totalRevenue: totalRevenue,
                totalWithdrawn: totalWithdrawn
            },
            monthlyChart: chartData,
            ledger: transactions.map(t => toLedgerRow(t, tz))
        });
    } catch (error) {
        return handleResponse(res, 500, error.message);
    }
};

/* ===============================
   GET SELLER TRANSACTION LEDGER (paginated)
   ?from&to (or startDate&endDate, YYYY-MM-DD in the seller's timezone),
   type, search, page, limit. Totals cover the whole filtered range.
================================ */
export const getSellerTransactions = async (req, res) => {
    try {
        const sellerId = req.user.id;
        const { page, limit, skip } = getPagination(req, { defaultLimit: 20, maxLimit: 100 });
        const tz = await getSellerTz(sellerId);

        const query = { user: new mongoose.Types.ObjectId(sellerId), userModel: 'Seller' };
        const range = dateRangeFilter(req.query, tz);
        if (range) query.createdAt = range;
        const type = String(req.query.type || "").trim();
        if (type && type !== "All") query.type = type;

        const term = String(req.query.search || "").trim().replace(/^#/, "");
        if (term) {
            const regex = new RegExp(escapeRegex(term), "i");
            const customers = await User.find({ $or: [{ name: regex }, { phone: regex }] }).select("_id").limit(500).lean();
            const orders = await Order.find({
                seller: sellerId,
                $or: [
                    { orderId: regex },
                    { "walkInCustomer.name": regex },
                    { "walkInCustomer.phone": regex },
                    { "address.name": regex },
                    { "address.phone": regex },
                    ...(customers.length ? [{ customer: { $in: customers.map((c) => c._id) } }] : []),
                ],
            }).select("_id").limit(2000).lean();
            const or = [{ reference: regex }, { type: regex }, { status: regex }];
            if (orders.length) or.push({ order: { $in: orders.map((o) => o._id) } });
            const asAmount = Number(term.replace(/[₹,\s]/g, ""));
            if (Number.isFinite(asAmount) && asAmount > 0) or.push({ amount: { $in: [asAmount, -asAmount] } });
            query.$or = or;
        }

        const [rows, total, [totals]] = await Promise.all([
            Transaction.find(query).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).populate(TXN_ORDER_POPULATE),
            Transaction.countDocuments(query),
            Transaction.aggregate([
                { $match: query },
                {
                    $group: {
                        _id: null,
                        credits: { $sum: { $cond: [{ $gt: ["$amount", 0] }, "$amount", 0] } },
                        debits: { $sum: { $cond: [{ $lt: ["$amount", 0] }, { $abs: "$amount" }, 0] } },
                    },
                },
            ]),
        ]);

        return handleResponse(res, 200, "Transactions fetched successfully", {
            items: rows.map((t) => toLedgerRow(t, tz)),
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit) || 1,
            totals: {
                credits: Number(totals?.credits || 0),
                debits: Number(totals?.debits || 0),
                net: Number((totals?.credits || 0) - (totals?.debits || 0)),
            },
        });
    } catch (error) {
        return handleResponse(res, error.statusCode || 500, error.message);
    }
};
