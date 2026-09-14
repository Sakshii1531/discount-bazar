import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ArrowUpRight, ArrowDownLeft, ReceiptIndianRupee } from 'lucide-react';
import { customerApi } from '../services/customerApi';
import { formatCurrencyInteger } from '@/shared/utils/currency';

const formatPaymentMethod = (order) => {
    const method = (order.payment?.method || order.paymentMode || order.paymentMethod || '').toLowerCase();
    if (method === 'cash' || method === 'cod') return 'Cash on Delivery';
    if (method === 'online' || method === 'razorpay' || method === 'upi' || method === 'card' || method === 'stripe') return 'Online Payment';
    if (method === 'wallet') return 'Wallet';
    return order.payment?.method || order.paymentMode || order.paymentMethod || 'Online';
};

const getOrderAmount = (order) => {
    return Number(
        order.pricing?.total ??
        order.paymentBreakdown?.finalPayable ??
        order.total ??
        order.finalAmount ??
        order.pricing?.subtotal ??
        order.totalAmount ??
        order.payableAmount ??
        0
    );
};

const OrderTransactionsPage = () => {
    const navigate = useNavigate();
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchOrders = async () => {
            try {
                const res = await customerApi.getMyOrders();
                const payload = res?.data;
                const orderData =
                    payload?.result?.items ||
                    payload?.results ||
                    payload?.result ||
                    payload?.data?.items ||
                    payload?.data ||
                    [];
                setOrders(Array.isArray(orderData) ? orderData : []);
            } catch (error) {
                console.error('Failed to fetch orders for transaction history:', error);
            } finally {
                setLoading(false);
            }
        };

        fetchOrders();
    }, []);

    return (
        <div className="min-h-screen bg-slate-50 pb-24 font-sans">
            <div className="sticky top-0 z-30 bg-slate-50/95 backdrop-blur-sm px-4 pt-4 pb-3 border-b border-slate-200/60 mb-4 flex items-center gap-2">
                <button
                    onClick={() => navigate(-1)}
                    className="w-10 h-10 flex items-center justify-center hover:bg-slate-200/70 rounded-full transition-colors -ml-1 cursor-pointer"
                >
                    <ChevronLeft size={22} className="text-slate-800" />
                </button>
                <h1 className="text-xl font-semibold text-slate-900 tracking-tight">Order Transactions</h1>
            </div>

            <div className="max-w-2xl mx-auto px-4 pt-1 relative z-20">
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                        <div>
                            <h3 className="text-base font-semibold text-slate-800">Transaction History</h3>
                            <p className="text-[11px] text-slate-500">
                                Based on your recent orders
                            </p>
                        </div>
                        <ReceiptIndianRupee className="h-5 w-5 text-slate-400" />
                    </div>

                    {loading ? (
                        <div className="py-10 flex items-center justify-center text-xs text-slate-400 font-semibold">
                            Loading transactions...
                        </div>
                    ) : orders.length === 0 ? (
                        <div className="py-10 flex flex-col items-center justify-center text-center px-6">
                            <p className="text-sm font-semibold text-slate-500 mb-1">
                                No transactions yet
                            </p>
                            <p className="text-[11px] text-slate-400">
                                Place an order to see your payment history here.
                            </p>
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-100">
                            {orders.map((order) => {
                                const paymentStatus = (order.paymentStatus || order.payment?.status || '').toLowerCase();
                                const isRefund = paymentStatus === 'refunded' || paymentStatus === 'refund_completed' || order.returnStatus === 'refund_completed';
                                const amount = getOrderAmount(order);
                                const createdAt = order.createdAt ? new Date(order.createdAt) : null;
                                const orderCode = order.orderId ? order.orderId.slice(-8) : (order._id ? order._id.slice(-8) : '');

                                return (
                                    <div
                                        key={order._id || order.orderId}
                                        onClick={() => order.orderId && navigate(`/orders/${order.orderId}`)}
                                        className="px-4 py-3.5 flex items-center justify-between hover:bg-slate-50 transition-colors cursor-pointer"
                                    >
                                        <div className="flex items-center gap-4">
                                            <div
                                                className={`h-10 w-10 rounded-lg flex items-center justify-center ${
                                                    isRefund
                                                        ? 'bg-amber-50 text-amber-600'
                                                        : 'bg-slate-100 text-slate-700'
                                                }`}
                                            >
                                                {isRefund ? (
                                                    <ArrowUpRight size={19} />
                                                ) : (
                                                    <ArrowDownLeft size={19} />
                                                )}
                                            </div>
                                            <div>
                                                <h4 className="font-semibold text-slate-800 text-sm">
                                                    {isRefund ? 'Refund' : 'Order Payment'}
                                                </h4>
                                                <p className="text-[11px] text-slate-500">
                                                    #{orderCode} •{' '}
                                                    {formatPaymentMethod(order)}
                                                </p>
                                                {createdAt && (
                                                    <p className="text-[11px] text-slate-500 mt-0.5">
                                                        {createdAt.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })},{' '}
                                                        {createdAt.toLocaleTimeString([], {
                                                            hour: '2-digit',
                                                            minute: '2-digit',
                                                        })}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                        <div
                                            className={`text-sm font-semibold ${
                                                isRefund ? 'text-amber-600' : 'text-slate-900'
                                            }`}
                                        >
                                            {isRefund ? '+' : '-'}{formatCurrencyInteger(amount)}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default OrderTransactionsPage;
