// Premium Billing & Financial Configuration System
import React, { useState, useEffect } from 'react';
import Card from '@shared/components/ui/Card';
import {
    RotateCcw,
    Save,
    Info,
    Truck,
    Zap,
    MapPin,
    History,
    Sparkles,
    RefreshCw
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@shared/components/ui/Toast';
import { adminApi } from '../services/adminApi';

const BillingCharges = () => {
    const { showToast } = useToast();
    const [isSaving, setIsSaving] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [deliveryMode, setDeliveryMode] = useState('distance'); // 'fixed' or 'distance'

    const [config, setConfig] = useState({
        platformFee: 0,
        freeDeliveryThreshold: 0,
        globalTaxRate: 0,
        baseCharge: 30,
        riderBasePayout: 30,
        baseDistance: 0.5,
        extraPerKm: 10,
        deliveryPartnerRatePerKm: 5,
        fixedCharge: 30,
        returnDeliveryCommission: 0,
        handlingFeeStrategy: "highest_category_fee",
        codEnabled: true,
        onlineEnabled: true,
    });

    const fetchSettings = async () => {
        try {
            setIsRefreshing(true);
            const [platformRes, deliveryRes] = await Promise.all([
                adminApi.getPlatformSettings(),
                adminApi.getDeliveryFinanceSettings(),
            ]);

            const returnFee =
                deliveryRes.data?.result?.returnDeliveryCommission ??
                platformRes.data?.result?.returnDeliveryCommission ??
                0;

            if (deliveryRes.data?.success && deliveryRes.data.result) {
                const s = deliveryRes.data.result;
                setDeliveryMode(s.deliveryPricingMode === 'fixed_price' ? 'fixed' : 'distance');
                setConfig((prev) => ({
                    ...prev,
                    baseCharge: s.customerBaseDeliveryFee ?? s.baseDeliveryCharge ?? prev.baseCharge,
                    riderBasePayout: s.riderBasePayout ?? s.customerBaseDeliveryFee ?? prev.riderBasePayout,
                    baseDistance: s.baseDistanceCapacityKm ?? prev.baseDistance,
                    extraPerKm: s.incrementalKmSurcharge ?? prev.extraPerKm,
                    deliveryPartnerRatePerKm: s.deliveryPartnerRatePerKm ?? s.fleetCommissionRatePerKm ?? prev.deliveryPartnerRatePerKm,
                    fixedCharge: s.fixedDeliveryFee ?? s.customerBaseDeliveryFee ?? prev.fixedCharge,
                    returnDeliveryCommission: returnFee,
                    handlingFeeStrategy: s.handlingFeeStrategy ?? prev.handlingFeeStrategy,
                    globalTaxRate: s.globalTaxRate ?? prev.globalTaxRate,
                    codEnabled: s.codEnabled ?? prev.codEnabled,
                    onlineEnabled: s.onlineEnabled ?? prev.onlineEnabled,
                }));
            } else if (platformRes.data?.success && platformRes.data.result) {
                setConfig((prev) => ({
                    ...prev,
                    returnDeliveryCommission: returnFee,
                }));
            }
        } catch (error) {
            console.error('Failed to load settings', error);
            showToast('Failed to load settings', 'error');
        } finally {
            setIsRefreshing(false);
        }
    };

    useEffect(() => {
        fetchSettings();
    }, []);

    const handleSave = async () => {
        try {
            setIsSaving(true);
            await Promise.all([
                adminApi.updatePlatformSettings({
                    returnDeliveryCommission: config.returnDeliveryCommission,
                }),
                adminApi.updateDeliveryFinanceSettings({
                    deliveryPricingMode: deliveryMode === 'fixed' ? 'fixed_price' : 'distance_based',
                    customerBaseDeliveryFee: config.baseCharge,
                    riderBasePayout: config.baseCharge,
                    baseDeliveryCharge: config.baseCharge,
                    baseDistanceCapacityKm: config.baseDistance,
                    incrementalKmSurcharge: config.extraPerKm,
                    deliveryPartnerRatePerKm: config.extraPerKm,
                    fleetCommissionRatePerKm: config.extraPerKm,
                    fixedDeliveryFee: config.fixedCharge,
                    returnDeliveryCommission: config.returnDeliveryCommission,
                    handlingFeeStrategy: config.handlingFeeStrategy,
                    globalTaxRate: config.globalTaxRate,
                    codEnabled: config.codEnabled,
                    onlineEnabled: config.onlineEnabled,
                }),
            ]);

            showToast('Delivery finance settings updated successfully', 'success');
        } catch (error) {
            console.error('Failed to update platform settings', error);
            showToast('Failed to update fees settings', 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const handleInputChange = (field, value) => {
        let parsed = parseFloat(value) || 0;
        if (parsed < 0) parsed = 0;
        setConfig(prev => ({ ...prev, [field]: parsed }));
    };

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-16">
            {/* Header Section */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-100">
                <div>
                    <div className="flex items-center gap-2.5 flex-wrap">
                        <h1 className="text-2xl lg:text-3xl font-black text-slate-900 tracking-tight">
                            Fees & Charges
                        </h1>
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            Active Configuration
                        </span>
                    </div>
                    <p className="text-xs md:text-sm text-slate-500 font-medium mt-1">
                        Configure customer delivery fees, global tax rates, and reverse logistics compensation.
                    </p>
                </div>

                <div className="flex items-center gap-2.5 shrink-0">
                    <button
                        type="button"
                        onClick={fetchSettings}
                        disabled={isRefreshing}
                        title="Reload latest settings"
                        className="flex items-center justify-center h-10 w-10 bg-white border border-slate-200/90 text-slate-600 rounded-xl hover:bg-slate-50 hover:text-slate-900 transition-all shadow-sm active:scale-95 disabled:opacity-50"
                    >
                        <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin text-brand-600")} />
                    </button>
                    <button
                        type="button"
                        className="flex items-center gap-2 px-4 h-10 bg-white border border-slate-200/90 text-slate-700 rounded-xl text-xs font-bold hover:bg-slate-50 hover:text-slate-900 transition-all shadow-sm active:scale-95"
                    >
                        <History className="h-4 w-4 text-slate-400" />
                        Audit Logs
                    </button>
                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={isSaving}
                        className={cn(
                            "flex items-center gap-2 px-5 h-10 bg-slate-900 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-slate-900/10 hover:bg-slate-800 active:scale-95",
                            isSaving && "opacity-75 cursor-wait"
                        )}
                    >
                        {isSaving ? (
                            <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                            <Save className="h-4 w-4" />
                        )}
                        <span>{isSaving ? 'Saving...' : 'Save Changes'}</span>
                    </button>
                </div>
            </div>

            {/* Main Configuration Content */}
            <div className="max-w-5xl mx-auto space-y-6 text-left">
                {/* 1. Main Platform Charges */}
                <Card className="border border-slate-200/80 shadow-sm bg-white rounded-2xl overflow-hidden transition-all">
                    <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-amber-50 text-amber-600 rounded-xl border border-amber-200/60">
                                <Zap className="h-4 w-4" />
                            </div>
                            <div>
                                <h3 className="text-sm font-bold text-slate-900 tracking-tight">
                                    Platform & Tax Rules
                                </h3>
                                <p className="text-xs text-slate-500 font-medium mt-0.5">
                                    Free delivery eligibility and government tax rates applied on checkout
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="p-6 md:p-8 grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Free Delivery Minimum */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                                    Free Delivery Minimum Threshold
                                </label>
                                <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200/60">
                                    Cart Waive-off
                                </span>
                            </div>
                            <div className="relative group">
                                <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-slate-400 group-focus-within:text-slate-900 transition-colors pointer-events-none text-sm">
                                    ₹
                                </span>
                                <input
                                    type="number"
                                    min="0"
                                    value={config.freeDeliveryThreshold === 0 ? '' : config.freeDeliveryThreshold}
                                    onChange={(e) => handleInputChange('freeDeliveryThreshold', e.target.value)}
                                    className="w-full pl-9 pr-4 py-3 bg-slate-50/70 hover:bg-slate-50 focus:bg-white border border-slate-200 focus:border-brand-500 rounded-xl text-sm font-bold text-slate-900 outline-none focus:ring-4 focus:ring-brand-500/10 transition-all placeholder:text-slate-300"
                                    placeholder="0"
                                />
                            </div>
                            <p className="text-xs text-slate-400 leading-relaxed">
                                Orders with a subtotal exceeding this amount will waive the delivery fee automatically.
                            </p>
                        </div>

                        {/* Global Tax / GST Rate */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                                    Global Tax / GST Rate
                                </label>
                                <span className="text-[10px] font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200/60">
                                    Percentage
                                </span>
                            </div>
                            <div className="relative group">
                                <input
                                    type="number"
                                    min="0"
                                    max="100"
                                    step="0.1"
                                    value={config.globalTaxRate === 0 ? '' : config.globalTaxRate}
                                    onChange={(e) => handleInputChange('globalTaxRate', e.target.value)}
                                    className="w-full pl-4 pr-9 py-3 bg-slate-50/70 hover:bg-slate-50 focus:bg-white border border-slate-200 focus:border-brand-500 rounded-xl text-sm font-bold text-slate-900 outline-none focus:ring-4 focus:ring-brand-500/10 transition-all placeholder:text-slate-300"
                                    placeholder="0"
                                />
                                <span className="absolute right-4 top-1/2 -translate-y-1/2 font-bold text-slate-400 pointer-events-none text-sm">
                                    %
                                </span>
                            </div>
                            <p className="text-xs text-slate-400 leading-relaxed">
                                Uniform tax percentage applied across product subtotal at checkout.
                            </p>
                        </div>
                    </div>
                </Card>

                {/* 2. Delivery Fee Settings & Reverse Logistics */}
                <Card className="border border-slate-200/80 shadow-sm bg-white rounded-2xl overflow-hidden transition-all">
                    <div className="px-6 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50/50">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-blue-50 text-blue-600 rounded-xl border border-blue-200/60">
                                <Truck className="h-4 w-4" />
                            </div>
                            <div>
                                <h3 className="text-sm font-bold text-slate-900 tracking-tight">
                                    Delivery Logistics Engine
                                </h3>
                                <p className="text-xs text-slate-500 font-medium mt-0.5">
                                    Pricing calculation for customer deliveries and return pickup tasks
                                </p>
                            </div>
                        </div>

                        {/* Mode Switcher */}
                        <div className="flex bg-slate-100 p-1 rounded-xl shrink-0 border border-slate-200/60">
                            <button
                                type="button"
                                onClick={() => setDeliveryMode('distance')}
                                className={cn(
                                    "px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5",
                                    deliveryMode === 'distance'
                                        ? "bg-white text-slate-900 shadow-sm"
                                        : "text-slate-500 hover:text-slate-900"
                                )}
                            >
                                <MapPin className="h-3.5 w-3.5" />
                                Distance Based
                            </button>
                            <button
                                type="button"
                                onClick={() => setDeliveryMode('fixed')}
                                className={cn(
                                    "px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5",
                                    deliveryMode === 'fixed'
                                        ? "bg-white text-slate-900 shadow-sm"
                                        : "text-slate-500 hover:text-slate-900"
                                )}
                            >
                                <Sparkles className="h-3.5 w-3.5" />
                                Fixed Price
                            </button>
                        </div>
                    </div>

                    <div className="p-6 md:p-8">
                        {deliveryMode === 'distance' ? (
                            <>
                                {/* Location Accuracy Banner */}
                                <div className="bg-blue-50/60 border border-blue-100 rounded-xl p-4 mb-6 flex items-start gap-3">
                                    <div className="p-1 bg-blue-100 text-blue-700 rounded-md shrink-0 mt-0.5">
                                        <MapPin className="h-4 w-4" />
                                    </div>
                                    <div>
                                        <p className="text-xs font-bold text-blue-950">
                                            Smart Distance Calculation
                                        </p>
                                        <p className="text-xs text-blue-700/90 mt-0.5 leading-relaxed">
                                            Uses Google Maps driving distance between seller location and customer address. Fallback aerial distance is used if route is unavailable.
                                        </p>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                    {/* Base Fee */}
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold text-slate-700">
                                            Base Delivery Fee (₹)
                                        </label>
                                        <div className="relative group">
                                            <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-slate-400 group-focus-within:text-slate-900 text-sm pointer-events-none">₹</span>
                                            <input
                                                type="number"
                                                min="0"
                                                value={config.baseCharge === 0 ? '' : config.baseCharge}
                                                onChange={(e) => handleInputChange('baseCharge', e.target.value)}
                                                className="w-full pl-9 pr-4 py-3 bg-slate-50/70 hover:bg-slate-50 focus:bg-white border border-slate-200 focus:border-brand-500 rounded-xl text-sm font-bold text-slate-900 outline-none focus:ring-4 focus:ring-brand-500/10 transition-all"
                                                placeholder="0"
                                            />
                                        </div>
                                        <p className="text-xs text-slate-400 leading-relaxed">
                                            Minimum fee charged within base distance.
                                        </p>
                                    </div>

                                    {/* Base Distance */}
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold text-slate-700">
                                            Base Distance Radius (km)
                                        </label>
                                        <div className="relative group">
                                            <input
                                                type="number"
                                                min="0"
                                                step="0.1"
                                                value={config.baseDistance === 0 ? '' : config.baseDistance}
                                                onChange={(e) => handleInputChange('baseDistance', e.target.value)}
                                                className="w-full pl-4 pr-11 py-3 bg-slate-50/70 hover:bg-slate-50 focus:bg-white border border-slate-200 focus:border-brand-500 rounded-xl text-sm font-bold text-slate-900 outline-none focus:ring-4 focus:ring-brand-500/10 transition-all"
                                                placeholder="0"
                                            />
                                            <span className="absolute right-4 top-1/2 -translate-y-1/2 font-bold text-slate-400 text-xs pointer-events-none uppercase">km</span>
                                        </div>
                                        <p className="text-xs text-slate-400 leading-relaxed">
                                            Radius covered under the base fee.
                                        </p>
                                    </div>

                                    {/* Per Km Fee */}
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold text-slate-700">
                                            Incremental Per-Km Fee (₹)
                                        </label>
                                        <div className="relative group">
                                            <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-slate-400 group-focus-within:text-slate-900 text-sm pointer-events-none">₹</span>
                                            <input
                                                type="number"
                                                min="0"
                                                value={config.extraPerKm === 0 ? '' : config.extraPerKm}
                                                onChange={(e) => handleInputChange('extraPerKm', e.target.value)}
                                                className="w-full pl-9 pr-4 py-3 bg-slate-50/70 hover:bg-slate-50 focus:bg-white border border-slate-200 focus:border-brand-500 rounded-xl text-sm font-bold text-slate-900 outline-none focus:ring-4 focus:ring-brand-500/10 transition-all"
                                                placeholder="0"
                                            />
                                        </div>
                                        <p className="text-xs text-slate-400 leading-relaxed">
                                            Charged for every km beyond base radius.
                                        </p>
                                    </div>
                                </div>

                                {/* Quick Preview Pill */}
                                <div className="mt-6 p-4 rounded-xl bg-slate-50 border border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
                                    <div className="flex items-center gap-2 flex-wrap text-slate-600">
                                        <span className="font-bold text-slate-800">Formula:</span>
                                        <span>First {config.baseDistance || 0} km = <strong>₹{config.baseCharge || 0}</strong></span>
                                        <span className="text-slate-300">•</span>
                                        <span>Beyond {config.baseDistance || 0} km = <strong>+₹{config.extraPerKm || 0}/km</strong></span>
                                    </div>
                                    <span className="text-slate-400 font-medium">Applied on customer checkout</span>
                                </div>
                            </>
                        ) : (
                            <div className="space-y-2 max-w-md">
                                <label className="text-xs font-bold text-slate-700">
                                    Fixed Delivery Charge (₹)
                                </label>
                                <div className="relative group">
                                    <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-slate-400 group-focus-within:text-slate-900 text-sm pointer-events-none">₹</span>
                                    <input
                                        type="number"
                                        min="0"
                                        value={config.fixedCharge === 0 ? '' : config.fixedCharge}
                                        onChange={(e) => handleInputChange('fixedCharge', e.target.value)}
                                        className="w-full pl-9 pr-4 py-3 bg-slate-50/70 hover:bg-slate-50 focus:bg-white border border-slate-200 focus:border-brand-500 rounded-xl text-sm font-bold text-slate-900 outline-none focus:ring-4 focus:ring-brand-500/10 transition-all"
                                        placeholder="0"
                                    />
                                </div>
                                <p className="text-xs text-slate-400 leading-relaxed">
                                    Flat delivery fee charged uniformly across all orders regardless of distance.
                                </p>
                            </div>
                        )}

                        {/* Reverse Logistics Section: Return Delivery Fee */}
                        <div className="mt-8 pt-6 border-t border-slate-100">
                            <div className="flex items-center justify-between gap-3 mb-4">
                                <div className="flex items-center gap-2.5">
                                    <div className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg border border-indigo-100">
                                        <RotateCcw className="h-4 w-4" />
                                    </div>
                                    <div>
                                        <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                                            Return & Reverse Logistics
                                        </h4>
                                        <p className="text-xs text-slate-500">
                                            Delivery partner compensation for approved return pickups
                                        </p>
                                    </div>
                                </div>
                                <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200/60 px-2.5 py-1 rounded-full shrink-0">
                                    Admin / Platform Paid
                                </span>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-slate-700">
                                        Return Pickup Delivery Fee (₹)
                                    </label>
                                    <div className="relative group">
                                        <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-slate-400 group-focus-within:text-slate-900 text-sm pointer-events-none">₹</span>
                                        <input
                                            type="number"
                                            min="0"
                                            value={config.returnDeliveryCommission === 0 ? '' : config.returnDeliveryCommission}
                                            onChange={(e) => handleInputChange('returnDeliveryCommission', e.target.value)}
                                            className="w-full pl-9 pr-4 py-3 bg-slate-50/70 hover:bg-slate-50 focus:bg-white border border-slate-200 focus:border-brand-500 rounded-xl text-sm font-bold text-slate-900 outline-none focus:ring-4 focus:ring-brand-500/10 transition-all"
                                            placeholder="0"
                                        />
                                    </div>
                                    <p className="text-xs text-slate-400 leading-relaxed">
                                        Fixed amount credited to delivery partner upon successful return drop-off.
                                    </p>
                                </div>

                                <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 text-xs text-slate-600 space-y-1.5">
                                    <p className="font-bold text-slate-800 flex items-center gap-1.5">
                                        <Info className="h-3.5 w-3.5 text-slate-400" />
                                        Reverse Logistics Policy
                                    </p>
                                    <p className="text-slate-500 leading-relaxed">
                                        When a customer return is approved, this fixed fee is reserved for the rider task. The seller is only debited for the product refund, while the platform covers the pickup delivery fee.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </Card>
            </div>
        </div>
    );
};

export default BillingCharges;
