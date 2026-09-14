// Ultimate Order Intelligence Dossier
import React, { useState, useEffect, useRef } from 'react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { useSettings } from '@core/context/SettingsContext';
import { useParams, useNavigate } from 'react-router-dom';
import Card from '@shared/components/ui/Card';
import Badge from '@shared/components/ui/Badge';
import { formatCurrencyInteger } from "@shared/utils/currency";
import { adminApi } from '../services/adminApi';
import {
    ChevronLeft,
    Box,
    Truck,
    User,
    Building2,
    Calendar,
    Clock,
    ShoppingBag,
    Printer,
    Download,
    Mail,
    Phone,
    Copy,
    CreditCard,
    AlertCircle,
    Package,
    Navigation,
    Store,
    Info,
    MapPin
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@shared/components/ui/Toast';

const OrderDetail = () => {
    const { orderId } = useParams();
    const navigate = useNavigate();
    const { showToast } = useToast();
    const { settings } = useSettings();
    const [order, setOrder] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const invoiceRef = useRef(null);

    const fetchDetail = async () => {
        setIsLoading(true);
        try {
            const response = await adminApi.getOrderDetails(orderId);
            if (response.data.success) {
                setOrder(response.data.result);
            }
        } catch (error) {
            showToast("Failed to load order details", "error");
        } finally {
            setIsLoading(false);
        }
    };

    const handleStatusUpdate = async (newStatus) => {
        try {
            await adminApi.updateOrderStatus(orderId, { status: newStatus });
            showToast(`Order status updated to ${newStatus}`, "success");
            fetchDetail(); // Refresh data
        } catch (error) {
            console.error("Failed to update status:", error);
            showToast("Failed to update status", "error");
        }
    };

    useEffect(() => {
        if (orderId) {
            fetchDetail();
        }
    }, [orderId]);

    const getStatusStyles = (status) => {
        switch (status.toLowerCase()) {
            case 'pending': return 'bg-amber-100 text-amber-600 border-amber-200';
            case 'confirmed': return 'bg-brand-100 text-brand-600 border-brand-200';
            case 'packed': return 'bg-brand-100 text-brand-600 border-brand-200';
            case 'out_for_delivery': return 'bg-purple-100 text-purple-600 border-purple-200';
            case 'delivered': return 'bg-brand-100 text-brand-600 border-brand-200';
            case 'cancelled': return 'bg-rose-100 text-rose-600 border-rose-200';
            default: return 'bg-slate-100 text-slate-600 border-slate-200';
        }
    };

    const copyToClipboard = (text, label) => {
        if (!text) return;
        if (typeof window !== 'undefined' && navigator?.clipboard?.writeText) {
            navigator.clipboard.writeText(text);
            showToast(`${label} copied to internal clipboard`, 'success');
        }
    };

    const handlePrintInvoice = async () => {
        const element = invoiceRef.current;
        if (!element) return;
        
        showToast("Generating PDF Invoice...", "info");
        
        try {
            const canvas = await html2canvas(element, {
                scale: 2,
                useCORS: true,
                logging: false,
                allowTaint: true,
                backgroundColor: "#ffffff",
                onclone: (clonedDoc) => {
                    // Forcefully remove any elements or styles that might use oklch
                    // html2canvas crashes when it encounters oklch color functions in stylesheets
                    const styleSheets = clonedDoc.styleSheets;
                    for (let i = 0; i < styleSheets.length; i++) {
                        try {
                            const rules = styleSheets[i].cssRules || styleSheets[i].rules;
                            for (let j = rules.length - 1; j >= 0; j--) {
                                if (rules[j].cssText && rules[j].cssText.includes('oklch')) {
                                    styleSheets[i].deleteRule(j);
                                }
                            }
                        } catch (e) {
                            // Skip cross-origin stylesheets that we can't access
                        }
                    }
                    
                    // Also explicitly reset root variables just in case
                    const style = clonedDoc.createElement('style');
                    style.innerHTML = `
                        :root {
                            --primary: var(--primary) !important;
                            --secondary: #64748b !important;
                            --background: #ffffff !important;
                            --foreground: #0f172a !important;
                        }
                    `;
                    clonedDoc.head.appendChild(style);
                }
            });
            const imgData = canvas.toDataURL('image/png');
            const pdf = new jsPDF('p', 'mm', 'a4');
            const pdfWidth = pdf.internal.pageSize.getWidth();
            const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
            
            pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
            
            // Generate blob and trigger browser download safely
            const blob = pdf.output('blob');
            const blobUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = blobUrl;
            link.download = `Invoice_${order.orderId || 'ORD'}.pdf`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);

            showToast("Invoice downloaded successfully", "success");
        } catch (error) {
            console.error("PDF generation failed:", error);
            showToast("Failed to generate PDF", "error");
        }
    };

    if (isLoading) {
        return (
            <div className="min-h-[400px] flex flex-col items-center justify-center gap-4">
                <div className="h-12 w-12 border-4 border-fuchsia-600 border-t-transparent rounded-full animate-spin"></div>
                <p className="text-xs font-black text-slate-400 uppercase tracking-[4px]">Accessing Intelligence...</p>
            </div>
        );
    }

    if (!order) {
        return (
            <div className="min-h-[400px] flex flex-col items-center justify-center gap-4 text-center p-8">
                <AlertCircle className="h-16 w-16 text-rose-200" />
                <h2 className="text-xl font-black text-slate-900 uppercase">Order Node Not Found</h2>
                <button onClick={() => navigate(-1)} className="ds-btn ds-btn-md bg-slate-900 text-white mt-4">Return to List</button>
            </div>
        );
    }

    return (
        <div className="ds-section-spacing animate-in fade-in slide-in-from-bottom-4 duration-700 pb-12">
            {/* Control Bar */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 px-1">
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => navigate(-1)}
                        className="p-3 bg-white ring-1 ring-slate-200 rounded-2xl hover:bg-slate-50 transition-all text-slate-400 group"
                    >
                        <ChevronLeft className="h-5 w-5 group-hover:-translate-x-1 transition-transform" />
                    </button>
                    <div>
                        <div className="flex items-center gap-3">
                            <h1 className="text-2xl font-black text-slate-900 uppercase tracking-tight">
                                Order #{order.orderId?.length > 12 ? `ORD-${order.orderId.slice(-8)}` : order.orderId}
                            </h1>
                            {['delivered', 'cancelled'].includes(String(order.status || '').toLowerCase()) ? (
                                <span className={cn(
                                    "inline-block text-[10px] px-3 py-1.5 rounded-xl font-black uppercase tracking-widest border shadow-sm",
                                    getStatusStyles(order.status)
                                )}>
                                    {order.status.replace(/_/g, ' ')}
                                </span>
                            ) : (
                                <div className="relative inline-block w-44">
                                    <select
                                        value={order.status}
                                        onChange={(e) => handleStatusUpdate(e.target.value)}
                                        className={cn(
                                            "w-full text-[10px] pl-3 pr-8 py-1.5 rounded-xl font-black uppercase tracking-widest border appearance-none cursor-pointer focus:ring-2 focus:ring-offset-1 transition-all outline-none shadow-sm",
                                            getStatusStyles(order.status)
                                        )}
                                    >
                                        <option value="pending" disabled={['confirmed','packed','out_for_delivery','delivered','cancelled'].includes(String(order.status || '').toLowerCase())}>Pending</option>
                                        <option value="confirmed" disabled={['packed','out_for_delivery','delivered','cancelled'].includes(String(order.status || '').toLowerCase())}>Confirmed</option>
                                        <option value="packed" disabled={['out_for_delivery','delivered','cancelled'].includes(String(order.status || '').toLowerCase())}>Packed</option>
                                        <option value="out_for_delivery" disabled={['delivered','cancelled'].includes(String(order.status || '').toLowerCase())}>Out for Delivery</option>
                                        <option value="delivered">Delivered</option>
                                        <option value="cancelled">Cancelled</option>
                                    </select>
                                    <Info className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none opacity-60" />
                                </div>
                            )}
                        </div>
                        <p className="text-[11px] font-bold text-slate-400 mt-1 uppercase tracking-widest flex items-center gap-2">
                            <Calendar className="h-3.5 w-3.5" />
                            {new Date(order.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })} • <Clock className="h-3.5 w-3.5 ml-1" /> {new Date(order.createdAt).toLocaleTimeString()}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <button 
                        onClick={handlePrintInvoice}
                        className="flex items-center gap-2 px-5 py-3 bg-white ring-1 ring-slate-200 text-slate-700 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-50 transition-all shadow-sm"
                    >
                        <Printer className="h-4 w-4 text-slate-400" />
                        Print Invoice
                    </button>
                </div>

            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left Column */}
                <div className="lg:col-span-2 space-y-6">
                    {/* Items Section */}
                    <Card className="border-none shadow-xl ring-1 ring-slate-100 bg-white rounded-xl overflow-hidden">
                        <div className="p-3.5 px-4 border-b border-slate-50 bg-slate-50/30 flex items-center justify-between">
                            <h3 className="text-xs font-black text-slate-900 uppercase tracking-widest flex items-center gap-2">
                                <Box className="h-3.5 w-3.5 text-brand-500" />
                                Items in Order
                            </h3>
                            <Badge className="bg-brand-50 text-brand-700 border-none text-[8px] font-black">{order.items.length} ITEMS</Badge>
                        </div>
                        <div className="p-0 overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="bg-slate-50/50">
                                        <th className="px-4 py-2.5 text-[9px] font-black text-slate-400 uppercase tracking-widest">Product Details</th>
                                        <th className="px-4 py-2.5 text-[9px] font-black text-slate-400 uppercase tracking-widest text-center">Unit Price</th>
                                        <th className="px-4 py-2.5 text-[9px] font-black text-slate-400 uppercase tracking-widest text-center">Qty</th>
                                        <th className="px-4 py-2.5 text-[9px] font-black text-slate-400 uppercase tracking-widest text-right">Total</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {order.items.map((item) => (
                                        <tr key={item._id} className="group hover:bg-slate-50/30 transition-all">
                                            <td className="px-4 py-2.5">
                                                <div className="flex items-center gap-3">
                                                    <div className="h-10 w-10 bg-slate-50 rounded-xl flex items-center justify-center shadow-inner border border-slate-100 group-hover:scale-105 transition-transform overflow-hidden flex-shrink-0">
                                                        {item.image ? (
                                                            <img src={item.image} alt="" className="w-full h-full object-cover" />
                                                        ) : (
                                                            <Package className="h-4 w-4 text-slate-200" />
                                                        )}
                                                    </div>
                                                    <div>
                                                        <h4 className="text-xs font-black text-slate-900 leading-tight">{item.name}</h4>
                                                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">ID: {item.product?._id || item.product}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-4 py-2.5 text-center text-xs font-bold text-slate-600">₹{item.price}</td>
                                            <td className="px-4 py-2.5 text-center">
                                                <span className="bg-slate-100 px-2.5 py-0.5 rounded-md text-[11px] font-black text-slate-700">x{item.quantity}</span>
                                            </td>
                                            <td className="px-4 py-2.5 text-right text-xs font-black text-slate-900">₹{item.price * item.quantity}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div className="p-3.5 px-4 bg-slate-50/50 flex flex-col items-end border-t border-slate-100">
                            <div className="w-full sm:w-64 space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Subtotal</span>
                                    <span className="text-xs font-black text-slate-700">₹{order.pricing?.subtotal || 0}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Delivery Fee</span>
                                    <span className="text-xs font-bold text-brand-600">{formatCurrencyInteger(order.pricing?.deliveryFee || 0)}</span>
                                </div>
                                {(order.paymentBreakdown?.taxTotal > 0 || order.pricing?.gst > 0 || order.pricing?.tax > 0) && (
                                    <div className="flex items-center justify-between">
                                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Tax / GST</span>
                                        <span className="text-xs font-bold text-amber-600">{formatCurrencyInteger(order.paymentBreakdown?.taxTotal || order.pricing?.gst || order.pricing?.tax || 0)}</span>
                                    </div>
                                )}
                                <div className="h-px w-full bg-slate-200 my-1" />
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-black text-slate-900 uppercase tracking-tight">Total Payable</span>
                                    <span className="text-lg font-black text-fuchsia-600">{formatCurrencyInteger(order.pricing?.total || 0)}</span>
                                </div>
                            </div>
                        </div>
                    </Card>

                    {/* Payment Details Card - Moved below Items in Order */}
                    <Card className="border-none shadow-xl ring-1 ring-slate-200 bg-white rounded-2xl overflow-hidden text-left p-4">
                        <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-3">
                            <h4 className="text-xs font-black text-slate-900 uppercase tracking-widest flex items-center gap-2">
                                <CreditCard className="h-4 w-4 text-brand-600" />
                                Payment Details
                            </h4>
                            <Badge className={cn("border-none text-[8px] font-black uppercase px-2.5 py-0.5", order.payment?.status === 'completed' ? 'bg-brand-100 text-brand-700' : 'bg-amber-100 text-amber-700')}>
                                {order.payment?.status || 'PENDING'}
                            </Badge>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                            <div className="flex items-center justify-between bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Transaction Ref ID</span>
                                <div className="flex items-center gap-1.5">
                                    <span className="text-[10px] font-black text-slate-800 truncate max-w-[120px]">{order.payment?.transactionId || 'N/A'}</span>
                                    {order.payment?.transactionId && (
                                        <button onClick={() => copyToClipboard(order.payment?.transactionId, 'Transaction ID')} className="p-1 hover:bg-slate-200 rounded text-slate-400"><Copy className="h-3 w-3" /></button>
                                    )}
                                </div>
                            </div>
                            <div className="flex items-center justify-between bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Payment Method</span>
                                <span className="text-[10px] font-black uppercase tracking-wider text-slate-900">{order.payment?.method || 'CASH ON DELIVERY'}</span>
                            </div>
                        </div>
                    </Card>

                    {/* Side-by-Side Grid for Shop Details & Order Tracking */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {/* Shop Details */}
                        <Card className="border-none shadow-xl ring-1 ring-slate-200 bg-white rounded-2xl p-4 flex flex-col justify-between">
                            <h4 className="text-[10px] font-black text-slate-600 uppercase tracking-widest mb-3 flex items-center gap-2">
                                <Store className="h-3.5 w-3.5 text-slate-600" />
                                Seller / Store Details
                            </h4>
                            <div className="flex items-center gap-3">
                                <div className="h-10 w-10 bg-orange-100/70 border border-orange-200 rounded-xl flex items-center justify-center text-sm font-black text-orange-700 uppercase flex-shrink-0">
                                    {order.seller?.shopName?.[0] || 'S'}
                                </div>
                                <div className="text-left">
                                    <h3 className="text-sm font-black text-slate-900 leading-tight">{order.seller?.shopName || 'Unknown Shop'}</h3>
                                    <p className="text-[10px] font-black text-brand-700 uppercase tracking-tighter">Verified Seller Partner</p>
                                    <p className="text-[10px] font-bold text-slate-600 mt-0.5 uppercase tracking-wider">OWNER: {order.seller?.name}</p>
                                </div>
                            </div>
                        </Card>

                        {/* Order Tracking */}
                        <Card className="border-none shadow-xl ring-1 ring-slate-200 bg-white rounded-xl p-4 flex flex-col justify-between">
                            <h3 className="text-[10px] font-black text-slate-600 uppercase tracking-widest mb-3 flex items-center gap-2">
                                <Navigation className="h-3.5 w-3.5 text-brand-600" />
                                Order Tracking Status
                            </h3>
                            <div className="space-y-4 relative ml-1">
                                <div className="flex gap-3 relative">
                                    <div className="h-3 w-3 rounded-full ring-2 ring-white z-10 mt-0.5 bg-brand-500 shadow-md shadow-brand-200 flex-shrink-0" />
                                    <div className="flex-1">
                                        <div className="flex items-center justify-between gap-1 mb-0.5">
                                            <h4 className="text-xs font-black uppercase tracking-tight text-slate-900">
                                                STATUS: {order.status.replace(/_/g, ' ')}
                                            </h4>
                                            {order.updatedAt && !isNaN(new Date(order.updatedAt).getTime()) && (
                                                <span className="text-[10px] font-bold text-slate-600 uppercase">{new Date(order.updatedAt).toLocaleTimeString()}</span>
                                            )}
                                        </div>
                                        <p className="text-[11px] font-bold text-slate-700 leading-normal italic">"Order current status is {order.status}."</p>
                                    </div>
                                </div>
                            </div>
                        </Card>
                    </div>
                </div>

                {/* Right Column */}
                <div className="space-y-6">
                    {/* Customer Info */}
                    <Card className="border-none shadow-xl ring-1 ring-slate-100 bg-white rounded-2xl p-4">
                        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                            <User className="h-3.5 w-3.5" />
                            Customer Details
                        </h4>
                        <div className="flex items-center gap-3">
                            <img 
                                src="https://cdn-icons-png.flaticon.com/512/149/149071.png" 
                                alt="" 
                                className="h-10 w-10 rounded-xl bg-slate-50 ring-2 ring-white shadow-sm object-cover" 
                            />
                            <div className="text-left">
                                <h3 className="text-sm font-black text-slate-900 leading-tight">
                                    {order.customer?.name}
                                </h3>
                                <p className="text-[10px] font-bold text-slate-400 truncate max-w-[200px]">
                                    ID: {order.customer?._id}
                                </p>
                            </div>
                        </div>
                        <div className="space-y-3 text-left mt-3">
                            <div className="flex flex-col gap-1">
                                {order.customer?.email && (
                                    <span className="text-[10px] font-bold text-slate-400 flex items-center gap-2">
                                        <Mail className="h-3 w-3" /> {order.customer?.email}
                                    </span>
                                )}
                                {order.customer?.phone && (
                                    <span className="text-[10px] font-bold text-slate-400 flex items-center gap-2">
                                        <Phone className="h-3 w-3" /> {order.customer?.phone}
                                    </span>
                                )}
                            </div>
                            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                                <div className="flex items-center justify-between gap-2 mb-1">
                                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                                        Delivery Address
                                    </span>
                                    {order?.address?.location &&
                                        typeof order.address.location.lat === "number" &&
                                        typeof order.address.location.lng === "number" && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    const { lat, lng } = order.address.location;
                                                    window.open(
                                                        `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`,
                                                        "_blank",
                                                    );
                                                }}
                                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold text-primary hover:bg-primary/5 transition-colors"
                                            >
                                                <MapPin className="h-2.5 w-2.5" />
                                                Open in Maps
                                            </button>
                                        )}
                                </div>
                                <p className="text-[11px] font-bold text-slate-600 leading-snug italic">
                                    "{order.address?.address}, {order.address?.landmark}, {order.address?.city}"
                                </p>
                            </div>
                            {order.address?.type === "Other" &&
                                (order.address?.name || order.address?.phone) && (
                                    <div className="p-3 bg-brand-50 rounded-xl border border-brand-100 space-y-1">
                                        <div className="flex items-center justify-between gap-2 mb-0.5">
                                            <span className="text-[9px] font-black text-brand-700 uppercase tracking-widest">
                                                Recipient (Order For Someone Else)
                                            </span>
                                        </div>
                                        <p className="text-xs font-black text-slate-800">
                                            {order.address?.name}
                                        </p>
                                        {order.address?.phone && (
                                            <p className="text-[10px] font-bold text-brand-700 flex items-center gap-1.5">
                                                <Phone className="h-3 w-3" />
                                                {order.address.phone}
                                            </p>
                                        )}
                                    </div>
                                )}
                        </div>
                    </Card>

                    {/* Delivery Boy Info */}
                    <Card className="border-none shadow-xl ring-1 ring-slate-200 bg-white rounded-xl p-4 text-left">
                        <div className="flex flex-col gap-2.5">
                            <div className="flex items-center justify-between">
                                <h4 className="text-[10px] font-black text-slate-600 uppercase tracking-widest flex items-center gap-2">
                                    <Truck className="h-3.5 w-3.5 text-slate-600" /> Delivery Boy / Rider Details
                                </h4>
                                <Badge variant={order.deliveryBoy ? "success" : "secondary"} className="text-[8px] font-black uppercase tracking-widest px-2 py-0.5">
                                    {order.deliveryBoy ? "ASSIGNED" : "UNASSIGNED"}
                                </Badge>
                            </div>
                            <div className="flex items-center gap-3 mt-1">
                                <div className="h-9 w-9 bg-slate-100 border border-slate-200 rounded-xl flex items-center justify-center text-slate-400 overflow-hidden flex-shrink-0">
                                    {order.deliveryBoy ? (
                                        <div className="h-full w-full flex items-center justify-center font-black text-brand-700 bg-brand-50 text-sm">{order.deliveryBoy.name.charAt(0)}</div>
                                    ) : (
                                        <User className="h-4 w-4" />
                                    )}
                                </div>
                                <div>
                                    <h5 className="text-sm font-black text-slate-900 leading-tight">{order.deliveryBoy?.name || "Pending Rider Assignment"}</h5>
                                    <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wider mt-0.5">CONTACT: {order.deliveryBoy?.phone || "N/A"}</p>
                                </div>
                            </div>
                        </div>
                    </Card>

                    {/* Platform Financial & Commission Breakdown Card */}
                    <div className="shadow-xl ring-1 ring-slate-800 bg-slate-900 text-white rounded-2xl overflow-hidden text-left p-5 relative">
                        <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-3">
                            <div>
                                <h4 className="text-xs font-black text-amber-400 uppercase tracking-widest flex items-center gap-2">
                                    <CreditCard className="h-4 w-4 text-amber-400" /> Platform Financial Ledger
                                </h4>
                                <p className="text-[10px] text-slate-400 mt-0.5">Admin Commission & Payout Audit</p>
                            </div>
                            <span className="bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full">
                                Audit Verified
                            </span>
                        </div>

                        {(() => {
                            const subtotal = Math.ceil(order.productSubtotal || order.pricing?.subtotal || order.items.reduce((s, i) => s + (i.price * i.quantity), 0));
                            const commission = Math.ceil(order.adminCommission ?? (subtotal * 0.10));
                            const sellerPayout = Math.ceil(order.sellerPayout ?? (subtotal - commission));
                            const deliveryFee = Math.ceil(order.paymentBreakdown?.deliveryFeeCharged || order.pricing?.deliveryFee || order.deliveryFee || 0);
                            const tax = Math.ceil(order.paymentBreakdown?.taxTotal || order.pricing?.gst || order.pricing?.tax || order.tax || 0);
                            const handlingFee = Math.ceil(order.paymentBreakdown?.handlingFeeCharged || order.pricing?.handlingFee || order.pricing?.platformFee || order.handlingFee || 0);
                            const total = Math.ceil(order.pricing?.total || order.total || (subtotal + deliveryFee + tax + handlingFee));

                            const totalAdminEarning = commission + tax + handlingFee;

                            return (
                                <div className="space-y-3 text-xs">
                                    <div className="flex justify-between items-center">
                                        <span className="font-semibold text-slate-300">Product Subtotal</span>
                                        <span className="font-black text-white text-sm">₹{subtotal}</span>
                                    </div>

                                    <div className="text-emerald-400 bg-emerald-950/60 p-3 rounded-xl border border-emerald-500/30 space-y-1.5">
                                        <div className="flex justify-between items-center">
                                            <div>
                                                <span className="font-black uppercase text-[10px] block text-emerald-400">Total Admin Retained Inflow</span>
                                                <span className="text-[9px] text-emerald-300/90 font-medium">Commission (₹{commission}) + Tax/GST (₹{tax}) + Handling (₹{handlingFee})</span>
                                            </div>
                                            <span className="text-base font-black text-emerald-400">+ ₹{totalAdminEarning}</span>
                                        </div>
                                    </div>

                                    <div className="flex justify-between items-center text-rose-300 bg-rose-950/20 px-3.5 py-2 rounded-xl border border-rose-500/20">
                                        <div>
                                            <span className="font-semibold text-slate-200">Seller Net Payout</span>
                                            <span className="text-[9px] text-slate-400 block">(Subtotal - Commission)</span>
                                        </div>
                                        <span className="font-black text-rose-300 text-sm">₹{sellerPayout}</span>
                                    </div>

                                    <div className="flex justify-between items-center">
                                        <span className="font-semibold text-slate-300">Delivery Partner Charge</span>
                                        <span className="font-black text-sky-400 text-sm">₹{deliveryFee}</span>
                                    </div>

                                    <div className="flex justify-between items-center">
                                        <span className="font-semibold text-slate-300">Handling Fee</span>
                                        <span className="font-black text-slate-200 text-sm">₹{handlingFee}</span>
                                    </div>

                                    <div className="h-px bg-slate-800 my-3" />

                                    <div className="flex justify-between items-center bg-slate-800 p-3.5 rounded-xl border border-slate-700">
                                        <div>
                                            <p className="text-[10px] font-black text-slate-300 uppercase tracking-wide">Customer Bill Total</p>
                                            <p className="text-[9px] text-slate-400 font-medium">Paid via {order.payment?.method || 'CASH'}</p>
                                        </div>
                                        <span className="text-xl font-black text-amber-400">₹{total}</span>
                                    </div>
                                </div>
                            );
                        })()}
                    </div>



                    {/* Order Notes */}
                    <Card className="border-none shadow-xl ring-1 ring-amber-100 bg-amber-50/30 rounded-xl p-6 text-left">
                        <h4 className="text-[10px] font-black text-amber-900 uppercase tracking-widest mb-4 flex items-center gap-2">
                            <Info className="h-4 w-4" />
                            Order Notes & Instructions
                        </h4>
                        <p className="text-xs font-bold text-amber-800 leading-relaxed italic">
                            "{order.cancelReason ? `Cancellation Reason: ${order.cancelReason}` : `Delivery Slot: ${order.timeSlot || 'Standard Delivery'}.`}"
                        </p>
                    </Card>
                </div>
            </div>

            {/* Hidden Printable Invoice Template */}
            <div className="fixed -left-[9999px] top-0">
                <div 
                    ref={invoiceRef}
                    className="w-[1000px] bg-slate-100 p-8"
                    style={{ backgroundColor: "#f1f5f9" }}
                >
                    {/* Inner Paper with Border */}
                    <div style={{ 
                        backgroundColor: "#ffffff", 
                        padding: "50px 60px",
                        borderRadius: "16px",
                        boxShadow: "0 10px 25px rgba(0,0,0,0.05)",
                        fontFamily: "'Inter', system-ui, sans-serif",
                        color: "#0f172a",
                        minHeight: "1100px"
                    }}>
                        {/* Header: Brand Banner */}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "2px solid #0f172a", paddingBottom: "24px", marginBottom: "35px" }}>
                            <div>
                                {settings?.logoUrl ? (
                                    <img src={settings.logoUrl} alt="Logo" width="140" style={{ display: "block", marginBottom: "8px" }} crossOrigin="anonymous" />
                                ) : (
                                    <div style={{ fontSize: "32px", fontWeight: "900", color: "#0f172a", tracking: "-1px" }}>{settings?.appName || 'ZETBASKET'}</div>
                                )}
                                <div style={{ fontSize: "12px", color: "#475569", fontWeight: "700" }}>Express Grocery & Essentials</div>
                            </div>
                            <div style={{ textAlign: "right" }}>
                                <div style={{ fontSize: "32px", fontWeight: "900", color: "#0f172a", letterSpacing: "1px" }}>TAX INVOICE</div>
                                <div style={{ fontSize: "14px", fontWeight: "800", color: "#2563eb", marginTop: "4px" }}>Order #{order.orderId?.length > 12 ? `ORD-${order.orderId.slice(-8)}` : order.orderId}</div>
                                <div style={{ fontSize: "12px", color: "#475569", fontWeight: "700", marginTop: "2px" }}>Date: {new Date(order.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })}</div>
                            </div>
                        </div>

                        {/* Address Grid */}
                        <div style={{ display: "flex", justifyContent: "space-between", gap: "30px", marginBottom: "40px", backgroundColor: "#f8fafc", padding: "24px", borderRadius: "12px", border: "1px solid #e2e8f0" }}>
                            <div style={{ width: "48%" }}>
                                <div style={{ fontSize: "11px", fontWeight: "900", color: "#64748b", textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: "10px" }}>BILLED TO (CUSTOMER)</div>
                                <div style={{ fontSize: "18px", fontWeight: "900", color: "#0f172a", marginBottom: "6px" }}>{order.customer?.name}</div>
                                <div style={{ fontSize: "13px", color: "#334155", lineHeight: "1.6", fontWeight: "600" }}>
                                    {order.address?.address}, {order.address?.landmark && `${order.address.landmark}, `}{order.address?.city}
                                </div>
                                <div style={{ fontSize: "13px", fontWeight: "800", color: "#0f172a", marginTop: "10px" }}>Phone: {order.customer?.phone || order.address?.phone || 'N/A'}</div>
                            </div>
                            <div style={{ width: "2px", backgroundColor: "#cbd5e1" }}></div>
                            <div style={{ width: "48%" }}>
                                <div style={{ fontSize: "11px", fontWeight: "900", color: "#64748b", textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: "10px" }}>SHIPPED FROM (SELLER)</div>
                                <div style={{ fontSize: "18px", fontWeight: "900", color: "#0f172a", marginBottom: "6px" }}>{order.seller?.shopName || 'Partner Store'}</div>
                                <div style={{ fontSize: "13px", color: "#334155", lineHeight: "1.6", fontWeight: "600" }}>
                                    Owner: {order.seller?.name || 'Verified Partner'}<br />
                                    {order.seller?.address || settings?.address || 'Fulfilled from local dark store'}
                                </div>
                                <div style={{ fontSize: "13px", fontWeight: "800", color: "#2563eb", marginTop: "10px" }}>{settings?.taxId ? `GSTIN: ${settings.taxId}` : 'GST Registered Merchant'}</div>
                            </div>
                        </div>

                        {/* Manifest Items Table */}
                        <div style={{ marginBottom: "40px" }}>
                            <table width="100%" cellPadding="0" cellSpacing="0" style={{ borderCollapse: "collapse", width: "100%" }}>
                                <thead>
                                    <tr style={{ backgroundColor: "#0f172a", color: "#ffffff" }}>
                                        <th align="left" style={{ padding: "14px 18px", fontSize: "12px", fontWeight: "900", textTransform: "uppercase", letterSpacing: "1px", borderRadius: "8px 0 0 0" }}>Product Item</th>
                                        <th align="center" style={{ padding: "14px 18px", fontSize: "12px", fontWeight: "900", textTransform: "uppercase", letterSpacing: "1px" }}>Price</th>
                                        <th align="center" style={{ padding: "14px 18px", fontSize: "12px", fontWeight: "900", textTransform: "uppercase", letterSpacing: "1px" }}>Quantity</th>
                                        <th align="right" style={{ padding: "14px 18px", fontSize: "12px", fontWeight: "900", textTransform: "uppercase", letterSpacing: "1px", borderRadius: "0 8px 0 0" }}>Total Amount</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {order.items.map((item, idx) => {
                                        const isRawSku = (val) => {
                                            if (!val || typeof val !== 'string') return true;
                                            const s = val.trim();
                                            return /^[a-zA-Z0-9_-]+-\d+$/i.test(s) || /^sku-/i.test(s);
                                        };

                                        const rawSku = String(item.variantSku || item.variantSlot || '').trim();
                                        const matchedVariant = Array.isArray(item.product?.variants) && rawSku
                                            ? item.product.variants.find(v => String(v.sku || '').trim() === rawSku || String(v._id || '').trim() === rawSku)
                                            : null;

                                        const candidateName =
                                            (item.variantName && !isRawSku(item.variantName) ? item.variantName : null) ||
                                            matchedVariant?.name ||
                                            item.unit ||
                                            item.product?.unit ||
                                            item.weight ||
                                            item.product?.weight ||
                                            item.pack ||
                                            item.product?.pack ||
                                            (item.variantSlot && !isRawSku(item.variantSlot) ? item.variantSlot : null) ||
                                            (item.variantText && !isRawSku(item.variantText) ? item.variantText : null) ||
                                            (typeof item.variant === 'string' && !isRawSku(item.variant) ? item.variant : item.variant?.name || item.variant?.title) ||
                                            (typeof item.selectedVariant === 'string' && !isRawSku(item.selectedVariant) ? item.selectedVariant : item.selectedVariant?.name || item.selectedVariant?.title);

                                        const variantName = candidateName && !isRawSku(candidateName) ? candidateName : (matchedVariant?.name || item.product?.unit || null);

                                        return (
                                            <tr key={idx} style={{ borderBottom: "1px solid #e2e8f0", backgroundColor: idx % 2 === 0 ? "#ffffff" : "#f8fafc" }}>
                                                <td style={{ padding: "16px 18px" }}>
                                                    <div style={{ fontSize: "15px", fontWeight: "800", color: "#0f172a" }}>{item.name}</div>
                                                    {variantName && (
                                                        <div style={{ fontSize: "12px", color: "#2563eb", fontWeight: "700", marginTop: "3px" }}>
                                                            Variant: {variantName}
                                                        </div>
                                                    )}
                                                    <div style={{ fontSize: "11px", color: "#64748b", fontWeight: "600", marginTop: "3px" }}>ID: {item.product?._id || item.product || 'N/A'}</div>
                                                </td>
                                                <td align="center" style={{ padding: "16px 18px", fontSize: "14px", color: "#0f172a", fontWeight: "700" }}>₹{item.price}</td>
                                                <td align="center" style={{ padding: "16px 18px", fontSize: "14px", color: "#0f172a", fontWeight: "900" }}>{item.quantity}</td>
                                                <td align="right" style={{ padding: "16px 18px", fontSize: "15px", fontWeight: "900", color: "#0f172a" }}>₹{item.price * item.quantity}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        {/* Totals & Payment Summary */}
                        <div style={{ display: "flex", justifyBetween: "space-between", gap: "30px", marginBottom: "50px" }}>
                            <div style={{ width: "50%", backgroundColor: "#f8fafc", padding: "20px", borderRadius: "12px", border: "1px solid #e2e8f0" }}>
                                <div style={{ fontSize: "11px", color: "#64748b", fontWeight: "900", textTransform: "uppercase", marginBottom: "12px", letterSpacing: "1.5px" }}>PAYMENT SUMMARY</div>
                                <div style={{ fontSize: "14px", color: "#334155", marginBottom: "8px", fontWeight: "700" }}>Payment Method: <b style={{ color: "#0f172a", textTransform: "uppercase" }}>{order.payment?.method || 'CASH ON DELIVERY'}</b></div>
                                <div style={{ fontSize: "14px", color: "#334155", marginBottom: "8px", fontWeight: "700" }}>Payment Status: <b style={{ color: "#16a34a", textTransform: "uppercase" }}>{order.payment?.status || 'COMPLETED'}</b></div>
                                <div style={{ fontSize: "12px", color: "#64748b", fontWeight: "600" }}>Txn Reference: {order.payment?.transactionId || 'N/A'}</div>
                            </div>

                            <div style={{ width: "45%", marginLeft: "auto" }}>
                                <table width="100%" cellPadding="6" cellSpacing="0">
                                    <tr>
                                        <td align="left" style={{ fontSize: "13px", color: "#475569", fontWeight: "700" }}>Product Subtotal</td>
                                        <td align="right" style={{ fontSize: "15px", fontWeight: "800", color: "#0f172a" }}>₹{order.pricing?.subtotal || order.items.reduce((s, i) => s + (i.price * i.quantity), 0)}</td>
                                    </tr>
                                    <tr>
                                        <td align="left" style={{ fontSize: "13px", color: "#475569", fontWeight: "700" }}>Delivery Charges</td>
                                        <td align="right" style={{ fontSize: "15px", fontWeight: "800", color: "#2563eb" }}>+ ₹{order.pricing?.deliveryFee || 0}</td>
                                    </tr>
                                    {(order.paymentBreakdown?.taxTotal > 0 || order.pricing?.gst > 0 || order.pricing?.tax > 0) && (
                                        <tr>
                                            <td align="left" style={{ fontSize: "13px", color: "#475569", fontWeight: "700" }}>Tax / GST</td>
                                            <td align="right" style={{ fontSize: "15px", fontWeight: "800", color: "#d97706" }}>+ ₹{Math.ceil(order.paymentBreakdown?.taxTotal || order.pricing?.gst || order.pricing?.tax || 0)}</td>
                                        </tr>
                                    )}
                                    <tr>
                                        <td colSpan="2" style={{ padding: "8px 0" }}><div style={{ height: "2px", backgroundColor: "#0f172a" }}></div></td>
                                    </tr>
                                    <tr>
                                        <td align="left" style={{ fontSize: "16px", fontWeight: "900", color: "#0f172a" }}>GRAND TOTAL</td>
                                        <td align="right" style={{ fontSize: "24px", fontWeight: "900", color: "#2563eb" }}>{formatCurrencyInteger(order.pricing?.total || order.total || 0)}</td>
                                    </tr>
                                </table>
                            </div>
                        </div>

                        {/* Footer Notes */}
                        <div style={{ marginTop: "auto", paddingTop: "30px", borderTop: "1px solid #cbd5e1", textAlign: "center" }}>
                            <div style={{ fontSize: "14px", color: "#0f172a", fontWeight: "900", textTransform: "uppercase", letterSpacing: "2px" }}>
                                THANK YOU FOR SHOPPING WITH US!
                            </div>
                            <div style={{ fontSize: "11px", color: "#64748b", marginTop: "6px", fontWeight: "600" }}>
                                Computer Generated Invoice • Valid without Physical Signature
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default OrderDetail;
