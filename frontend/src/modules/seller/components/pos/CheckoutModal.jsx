import React, { useEffect, useState } from "react";
import { businessApi } from "../../services/businessApi";
import { posApi } from "../../services/posApi";
import Modal from "@shared/components/ui/Modal";
import Button from "@shared/components/ui/Button";
import Input from "@shared/components/ui/Input";
import {
    HiOutlineBanknotes,
    HiOutlineCreditCard,
    HiOutlineQrCode,
    HiOutlineTag,
    HiOutlineSquares2X2,
} from "react-icons/hi2";
import { cn } from "@/lib/utils";
import { useSettings } from "@core/context/SettingsContext";

const PAYMENT_METHODS = [
    { value: "CASH", label: "Cash", icon: HiOutlineBanknotes },
    { value: "CARD", label: "Card", icon: HiOutlineCreditCard },
    { value: "QR", label: "QR / UPI", icon: HiOutlineQrCode },
    { value: "CREDIT", label: "Credit (Udhaar)", icon: HiOutlineTag },
    { value: "SPLIT", label: "Split", icon: HiOutlineSquares2X2 },
    { value: "OTHER", label: "Other", icon: HiOutlineBanknotes },
];

export const SPLIT_TENDERS = [
    ["CASH", "Cash"],
    ["CARD", "Card"],
    ["QR", "QR / UPI"],
    ["OTHER", "Other"],
];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const inr = (n) => `₹${round2(n).toLocaleString("en-IN")}`;

/**
 * Checkout for a POS bill. Mounted fresh for every sale (PosTerminal keys it
 * by sale count) so a previous bill's discount, customer or payment choice
 * never carries over to the next one.
 */
const CheckoutModal = ({
    isOpen,
    onClose,
    subtotal,
    taxPercent = 0,
    taxTotal = 0,
    items = [],
    onConfirm,
    isSubmitting,
}) => {
    const { settings } = useSettings();
    const [paymentMethod, setPaymentMethod] = useState("CASH");
    const [walkInName, setWalkInName] = useState("");
    const [walkInPhone, setWalkInPhone] = useState("");
    const [couponCode, setCouponCode] = useState("");
    const [appliedCoupon, setAppliedCoupon] = useState(null); // { code, couponDiscount }
    const [couponError, setCouponError] = useState("");
    const [isApplyingCoupon, setIsApplyingCoupon] = useState(false);
    const [customTax, setCustomTax] = useState(taxTotal > 0 ? String(taxTotal) : "");
    const [discount, setDiscount] = useState("");
    const [customers, setCustomers] = useState([]);
    const [posCustomerId, setPosCustomerId] = useState("");
    const [amountPaid, setAmountPaid] = useState("");
    const [cashTendered, setCashTendered] = useState("");
    const [split, setSplit] = useState({ CASH: "", CARD: "", QR: "", OTHER: "" });

    useEffect(() => {
        if (!isOpen) return;
        businessApi.listCustomers().then((res) => setCustomers(res?.data?.results || res?.data?.result || [])).catch(() => {});
    }, [isOpen]);

    // Cart changed while the coupon was applied → the coupon amount must be re-checked.
    const itemsSignature = JSON.stringify(items);
    useEffect(() => {
        setAppliedCoupon(null);
    }, [itemsSignature]);

    const couponDiscount = appliedCoupon?.couponDiscount || 0;
    const manualDiscount = Math.max(Number(discount) || 0, 0);
    const activeTaxTotal = customTax === "" ? Number(taxTotal) || 0 : Math.max(0, Number(customTax) || 0);
    const baseTotal = round2(subtotal + activeTaxTotal);
    const discountValue = Math.min(round2(couponDiscount + manualDiscount), baseTotal);
    const payable = round2(baseTotal - discountValue);

    const typedCoupon = couponCode.trim();
    const couponPending = Boolean(typedCoupon) && appliedCoupon?.code !== typedCoupon;

    const tendered = cashTendered === "" ? null : Number(cashTendered);
    const cashShort = paymentMethod === "CASH" && tendered != null && tendered < payable;
    const change = paymentMethod === "CASH" && tendered != null && tendered >= payable ? round2(tendered - payable) : 0;

    const splitLines = SPLIT_TENDERS.map(([m]) => ({ method: m, amount: round2(split[m]) })).filter((l) => l.amount > 0);
    const splitSum = round2(splitLines.reduce((s, l) => s + l.amount, 0));
    const splitRemaining = round2(payable - splitSum);
    const splitInvalid = paymentMethod === "SPLIT" && (splitLines.length < 2 || Math.abs(splitRemaining) > 0.01);

    const handleApplyCoupon = async () => {
        if (!typedCoupon) return;
        setIsApplyingCoupon(true);
        setCouponError("");
        try {
            const res = await posApi.previewSale({
                items,
                couponCode: typedCoupon,
                taxPercent: subtotal > 0 ? round2((activeTaxTotal / subtotal) * 100) : undefined,
                taxTotal: activeTaxTotal || undefined,
            });
            const data = res?.data?.result;
            setAppliedCoupon({ code: typedCoupon, couponDiscount: Number(data?.couponDiscount || 0) });
        } catch (e) {
            setAppliedCoupon(null);
            setCouponError(e?.response?.data?.message || "Coupon could not be applied");
        } finally {
            setIsApplyingCoupon(false);
        }
    };

    const handleConfirm = () => {
        const activeTaxPercent = subtotal > 0 ? round2((activeTaxTotal / subtotal) * 100) : Number(taxPercent) || 0;
        onConfirm({
            posPaymentMethod: paymentMethod,
            walkInCustomer:
                walkInName.trim() || walkInPhone.trim()
                    ? { name: walkInName.trim(), phone: walkInPhone.trim() }
                    : undefined,
            couponCode: appliedCoupon?.code || undefined,
            discount: manualDiscount ? Math.min(manualDiscount, baseTotal) : undefined,
            posCustomerId: posCustomerId || undefined,
            amountPaid: paymentMethod === "CREDIT" ? Number(amountPaid) || 0 : undefined,
            cashTendered: paymentMethod === "CASH" && tendered != null ? tendered : undefined,
            posPayments: paymentMethod === "SPLIT" ? splitLines : undefined,
            taxPercent: activeTaxPercent,
            taxTotal: activeTaxTotal,
        });
    };

    const confirmDisabled =
        (paymentMethod === "CREDIT" && !posCustomerId) || couponPending || cashShort || splitInvalid;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Complete Sale" size="md">
            <div className="space-y-3.5">
                {/* Amount Due Banner */}
                <div className="flex items-center justify-between px-4 py-3 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white shadow-sm">
                    <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Amount Due</p>
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold mt-0.5">
                            <span className="text-slate-300">Subtotal: {inr(subtotal)}</span>
                            {activeTaxTotal > 0 && (
                                <span className="text-amber-300 font-bold">
                                    +{inr(activeTaxTotal)} (GST)
                                </span>
                            )}
                            {discountValue > 0 && (
                                <span className="text-emerald-400 font-bold">
                                    −{inr(discountValue)} off
                                </span>
                            )}
                        </div>
                    </div>
                    <p className="text-2xl sm:text-3xl font-black tracking-tight">{inr(payable)}</p>
                </div>

                {/* Payment Methods */}
                <div className="space-y-1.5">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Payment Method</p>
                    <div className="grid grid-cols-3 gap-2">
                        {PAYMENT_METHODS.map(({ value, label, icon: Icon }) => (
                            <button
                                key={value}
                                type="button"
                                onClick={() => setPaymentMethod(value)}
                                className={cn(
                                    "flex flex-col items-center justify-center gap-1.5 py-2.5 px-2 rounded-xl border text-center transition-all",
                                    paymentMethod === value
                                        ? "border-primary bg-primary/10 text-primary font-bold shadow-xs ring-1 ring-primary/40"
                                        : "border-slate-200 bg-slate-50/60 text-slate-700 hover:border-slate-300 hover:bg-slate-100",
                                )}
                            >
                                <Icon className="h-5 w-5 shrink-0" />
                                <span className="text-xs font-bold leading-tight whitespace-nowrap">{label}</span>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Cash Tendered & Alerts */}
                {paymentMethod === "CASH" && (
                    <div className="space-y-1.5">
                        <div className="grid grid-cols-3 gap-2">
                            <Input
                                type="number"
                                min="0"
                                placeholder="Cash received (₹)"
                                value={cashTendered}
                                onChange={(e) => setCashTendered(e.target.value)}
                            />
                            <Input
                                type="number"
                                min="0"
                                placeholder="GST / Tax (₹)"
                                value={customTax}
                                onChange={(e) => setCustomTax(e.target.value)}
                            />
                            <Input
                                type="number"
                                min="0"
                                placeholder="Discount (₹)"
                                value={discount}
                                onChange={(e) => setDiscount(e.target.value)}
                            />
                        </div>
                        {cashShort ? (
                            <p className="text-xs font-bold text-rose-600 px-1">
                                Cash received is less than the amount due
                            </p>
                        ) : change > 0 ? (
                            <div className="px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-800 flex items-center justify-between">
                                <span>Change to return:</span>
                                <span className="text-sm font-black">{inr(change)}</span>
                            </div>
                        ) : null}
                    </div>
                )}

                {/* Split Tenders */}
                {paymentMethod === "SPLIT" && (
                    <div className="space-y-1.5">
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Split amounts (at least two)</p>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                            {SPLIT_TENDERS.map(([m, label]) => (
                                <Input
                                    key={m}
                                    type="number"
                                    min="0"
                                    placeholder={`${label} ₹`}
                                    value={split[m]}
                                    onChange={(e) => setSplit((s) => ({ ...s, [m]: e.target.value }))}
                                />
                            ))}
                        </div>
                        <p
                            className={cn(
                                "text-xs font-bold px-1",
                                Math.abs(splitRemaining) <= 0.01 ? "text-emerald-700" : "text-rose-600",
                            )}
                        >
                            {Math.abs(splitRemaining) <= 0.01
                                ? "Split matches the amount due"
                                : splitRemaining > 0
                                  ? `${inr(splitRemaining)} still to allocate`
                                  : `${inr(-splitRemaining)} more than the amount due`}
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                            <Input
                                type="number"
                                min="0"
                                placeholder="GST / Tax (₹, optional)"
                                value={customTax}
                                onChange={(e) => setCustomTax(e.target.value)}
                            />
                            <Input
                                type="number"
                                min="0"
                                placeholder="Discount (₹, optional)"
                                value={discount}
                                onChange={(e) => setDiscount(e.target.value)}
                            />
                        </div>
                    </div>
                )}

                {/* Non-Cash / Non-Split Discount & Tax row */}
                {paymentMethod !== "CASH" && paymentMethod !== "SPLIT" && (
                    <div className="grid grid-cols-2 gap-2">
                        <Input
                            type="number"
                            min="0"
                            placeholder="GST / Tax (₹, optional)"
                            value={customTax}
                            onChange={(e) => setCustomTax(e.target.value)}
                        />
                        <Input
                            type="number"
                            min="0"
                            placeholder="Discount (₹, optional)"
                            value={discount}
                            onChange={(e) => setDiscount(e.target.value)}
                        />
                    </div>
                )}

                {/* Ledger Customer */}
                <div className="space-y-1">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                        Ledger customer {paymentMethod === "CREDIT" ? "(required)" : "(optional)"}
                    </p>
                    <div className={paymentMethod === "CREDIT" ? "grid grid-cols-2 gap-2" : ""}>
                        <select
                            value={posCustomerId}
                            onChange={(e) => setPosCustomerId(e.target.value)}
                            className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold bg-white outline-none focus:ring-2 focus:ring-primary/20"
                        >
                            <option value="">— Walk-in —</option>
                            {customers.map((c) => (
                                <option key={c._id} value={c._id}>
                                    {c.name} {c.phone ? `(${c.phone})` : ""} — due ₹{c.balance}
                                </option>
                            ))}
                        </select>
                        {paymentMethod === "CREDIT" && (
                            <Input
                                type="number"
                                min="0"
                                placeholder="Paid now in cash (₹, optional)"
                                value={amountPaid}
                                onChange={(e) => setAmountPaid(e.target.value)}
                            />
                        )}
                    </div>
                </div>

                {/* Customer Details: Name & Phone in 2-Column Grid */}
                <div className="space-y-1">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Customer details (optional)</p>
                    <div className="grid grid-cols-2 gap-2">
                        <Input
                            placeholder="Name"
                            value={walkInName}
                            autoCapitalize="words"
                            className="capitalize"
                            onChange={(e) => {
                                const val = e.target.value;
                                setWalkInName(val.replace(/(^|\s)\S/g, (char) => char.toUpperCase()));
                            }}
                        />
                        <Input
                            placeholder="Phone number"
                            value={walkInPhone}
                            onChange={(e) => setWalkInPhone(e.target.value)}
                        />
                    </div>
                </div>

                {/* Coupon Code Section */}
                {settings?.posCouponsEnabled && (
                    <div className="space-y-1">
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                            <HiOutlineTag className="h-3 w-3" />
                            Coupon code (optional)
                        </p>
                        <div className="flex gap-2">
                            <Input
                                placeholder="e.g. SAVE50"
                                value={couponCode}
                                onChange={(e) => {
                                    setCouponCode(e.target.value.toUpperCase());
                                    setCouponError("");
                                }}
                            />
                            <Button
                                variant="secondary"
                                onClick={handleApplyCoupon}
                                isLoading={isApplyingCoupon}
                                disabled={!typedCoupon}
                            >
                                Apply
                            </Button>
                        </div>
                        {couponError ? (
                            <p className="text-xs font-bold text-rose-600 px-1">{couponError}</p>
                        ) : appliedCoupon && !couponPending ? (
                            <p className="text-xs font-bold text-emerald-700 px-1">
                                {appliedCoupon.code} applied — {inr(appliedCoupon.couponDiscount)} off
                            </p>
                        ) : couponPending ? (
                            <p className="text-xs font-semibold text-amber-600 px-1">Apply the coupon (or clear it) to continue</p>
                        ) : null}
                    </div>
                )}

                <Button className="w-full pt-2.5 pb-2.5" size="lg" isLoading={isSubmitting} disabled={confirmDisabled} onClick={handleConfirm}>
                    Confirm Sale
                </Button>
            </div>
        </Modal>
    );
};

export default CheckoutModal;
