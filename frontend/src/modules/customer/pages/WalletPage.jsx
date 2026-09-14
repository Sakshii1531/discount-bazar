import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, ArrowDownLeft, ChevronLeft, Wallet } from 'lucide-react';
import { customerApi } from '../services/customerApi';
import { formatCurrencyInteger } from '@shared/utils/currency';

const formatDate = (d) => {
    if (!d) return '';
    const date = new Date(d);
    const now = new Date();
    const today = now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === today) return `Today, ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    if (date.toDateString() === yesterday.toDateString()) return `Yesterday, ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ', ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const WalletPage = () => {
    const navigate = useNavigate();
    const [balance, setBalance] = useState(0);
    const [transactions, setTransactions] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            try {
                const [profileRes, txRes, ordersRes] = await Promise.all([
                    customerApi.getProfile(),
                    customerApi.getWalletTransactions().catch(() => ({ data: { result: { items: [] } } })),
                    customerApi.getMyOrders().catch(() => ({ data: { results: [] } })),
                ]);
                const profile = profileRes.data?.result ?? profileRes.data?.data ?? profileRes.data;
                const txData = txRes.data?.result?.items ?? txRes.data?.data?.items ?? txRes.data?.items ?? [];
                let finalItems = [];

                if (Array.isArray(txData) && txData.length > 0) {
                    const uniqueItems = [];
                    const seen = new Set();
                    txData.forEach((t) => {
                        const roundedAmt = Math.round(Number(t.amount || 0));
                        const key = t.orderId
                            ? `${t.orderId}_${t.type}_${roundedAmt}`
                            : (t.reference || String(t._id));
                        if (!seen.has(key)) {
                            seen.add(key);
                            uniqueItems.push({ ...t, amount: roundedAmt });
                        }
                    });
                    finalItems = uniqueItems;
                } else {
                    const rawOrders = ordersRes.data?.results ?? ordersRes.data?.result ?? [];
                    const orders = Array.isArray(rawOrders) ? rawOrders : [];
                    const fallbackItems = [];

                    orders.forEach((o) => {
                        if ((o.payment?.method || '').toLowerCase() === 'wallet' || Number(o.walletAmount || 0) > 0) {
                            fallbackItems.push({
                                _id: `debit-${o._id}`,
                                type: 'debit',
                                title: 'Order Payment',
                                amount: Math.round(Number(o.walletAmount || o.pricing?.total || o.payableAmount || 0)),
                                date: o.createdAt,
                                orderId: o.orderId,
                            });
                        }
                        if (Array.isArray(o.items)) {
                            o.items.forEach((it, idx) => {
                                if (it.returnStatus === 'refund_completed' || it.returnStatus === 'approved') {
                                    fallbackItems.push({
                                        _id: `credit-${o._id}-${idx}`,
                                        type: 'credit',
                                        title: `Return Refund (${it.name || 'Item'})`,
                                        amount: Math.round(Number(it.price || 0) * Number(it.quantity || 1)),
                                        date: it.returnedAt || o.updatedAt || o.createdAt,
                                        orderId: o.orderId,
                                    });
                                }
                            });
                        }
                    });

                    fallbackItems.sort((a, b) => new Date(b.date) - new Date(a.date));
                    finalItems = fallbackItems;
                }

                setTransactions(finalItems);
                setBalance(Math.floor(Number(profile?.walletBalance ?? 0)));
            } catch (err) {
                console.error('Wallet fetch error:', err);
                setBalance(0);
                setTransactions([]);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, []);

    return (
        <div className="min-h-screen bg-slate-50 pb-24 font-sans">
            <div className="sticky top-0 z-30 bg-slate-50/95 backdrop-blur-sm px-4 pt-4 pb-3 border-b border-slate-200/60 mb-4 flex items-center gap-2">
                <button
                    onClick={() => navigate(-1)}
                    className="w-10 h-10 flex items-center justify-center hover:bg-slate-200/70 rounded-full transition-colors -ml-1"
                >
                    <ChevronLeft size={22} className="text-slate-800" />
                </button>
                <h1 className="text-xl font-semibold text-slate-900 tracking-tight">Wallet</h1>
            </div>

            <div className="max-w-2xl mx-auto px-4 pt-1 relative z-20 space-y-4">
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                    <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Available Balance</p>
                    <h2 className="text-3xl font-semibold text-slate-900 mt-1">
                        {loading ? '...' : formatCurrencyInteger(balance || 0)}
                    </h2>
                    <p className="text-xs text-slate-500 mt-1">Return refunds are credited here</p>
                </div>

                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                        <h3 className="text-base font-semibold text-slate-800">Transaction History</h3>
                        <Wallet size={18} className="text-slate-400" />
                    </div>

                    {loading ? (
                        <div className="py-12 flex justify-center text-slate-400 text-sm font-semibold">
                            Loading...
                        </div>
                    ) : transactions.length === 0 ? (
                        <div className="py-12 flex flex-col items-center justify-center text-center px-6">
                            <p className="text-sm font-semibold text-slate-500 mb-1">No wallet payments yet</p>
                            <p className="text-xs text-slate-400">
                                Orders paid using wallet will appear here.
                            </p>
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-100">
                            {transactions.map((tx) => (
                                <div key={tx._id} className="px-4 py-3.5 flex items-center justify-between hover:bg-slate-50 transition-colors">
                                    <div className="flex items-center gap-3">
                                        <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${tx.type === 'credit' ? 'bg-brand-50 text-brand-600' : 'bg-slate-100 text-slate-700'}`}>
                                            {tx.type === 'credit' ? <ArrowDownLeft size={19} /> : <ArrowUpRight size={19} />}
                                        </div>
                                        <div>
                                            <h4 className="font-semibold text-slate-800 text-sm">{tx.title}</h4>
                                            <p className="text-[11px] text-slate-500">{formatDate(tx.date)}</p>
                                            {tx.orderId && (
                                                <p className="text-[10px] text-slate-500">#{tx.orderId}</p>
                                            )}
                                        </div>
                                    </div>
                                    <div className={`text-sm font-semibold ${tx.type === 'credit' ? 'text-brand-600' : 'text-slate-900'}`}>
                                        {tx.type === 'credit' ? '+' : '-'}{formatCurrencyInteger(tx.amount || 0)}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default WalletPage;
