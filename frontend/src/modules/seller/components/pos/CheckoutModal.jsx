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
    HiOutlinePlus,
    HiOutlineUserPlus,
    HiOutlineXMark,
    HiOutlineExclamationTriangle,
} from "react-icons/hi2";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useSettings } from "@core/context/SettingsContext";
import { formatAmount } from "@shared/utils/currency";

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
    isTaxInclusive = true,
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
    const [showAddCustomer, setShowAddCustomer] = useState(false);
    const [newCustomerName, setNewCustomerName] = useState("");
    const [newCustomerPhone, setNewCustomerPhone] = useState("");
    const [isCreatingCustomer, setIsCreatingCustomer] = useState(false);

    const handleOpenAddCustomer = () => {
        setNewCustomerName(walkInName.trim() || "");
        setNewCustomerPhone(walkInPhone.trim() || "");
        setShowAddCustomer(true);
    };

    const handleQuickCreateCustomer = async (e) => {
        e?.preventDefault();
        const trimmedName = newCustomerName.trim();
        if (!trimmedName || trimmedName.length < 2) {
            toast.error("Please enter a valid customer name (at least 2 characters)");
            return;
        }
        if (/^\d+$/.test(trimmedName)) {
            toast.error("Name cannot contain only numbers");
            return;
        }
        const phoneClean = newCustomerPhone.replace(/\D/g, "");
        if (phoneClean && phoneClean.length !== 10) {
            toast.error("Please enter a valid 10-digit phone number or leave it blank");
            return;
        }

        setIsCreatingCustomer(true);
        try {
            const formattedName = trimmedName.replace(/(^|\s)\S/g, (c) => c.toUpperCase());
            const res = await businessApi.saveCustomer({
                name: formattedName,
                phone: phoneClean || undefined,
            });
            const created = res?.data?.data || res?.data?.result;
            const listRes = await businessApi.listCustomers();
            const list = listRes?.data?.results || listRes?.data?.result || [];
            setCustomers(list);

            const newId = created?._id || list.find((c) => c.name.toLowerCase() === formattedName.toLowerCase())?._id;
            if (newId) {
                setPosCustomerId(newId);
            }
            if (!walkInName.trim()) setWalkInName(formattedName);
            if (!walkInPhone.trim() && phoneClean) setWalkInPhone(phoneClean);

            toast.success("Customer added and selected!");
            setShowAddCustomer(false);
            setNewCustomerName("");
            setNewCustomerPhone("");
        } catch (err) {
            toast.error(err?.response?.data?.message || "Failed to add customer");
        } finally {
            setIsCreatingCustomer(false);
        }
    };

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
    const baseTotal = isTaxInclusive ? round2(subtotal) : round2(subtotal + activeTaxTotal);
    const discountValue = Math.min(round2(couponDiscount + manualDiscount), baseTotal);
    const payable = round2(baseTotal - discountValue);

    useEffect(() => {
        if (amountPaid && Number(amountPaid) > payable) {
            setAmountPaid(String(payable));
        }
    }, [payable]);

    const typedCoupon = couponCode.trim();
    const couponPending = Boolean(typedCoupon) && appliedCoupon?.code !== typedCoupon;

    const tendered = cashTendered === "" ? null : Number(cashTendered);
    const cashShort = paymentMethod === "CASH" && tendered != null && tendered < payable;
    const change = paymentMethod === "CASH" && tendered != null && tendered >= payable ? round2(tendered - payable) : 0;
    // Part-payment in cash: the unpaid balance goes to the ledger customer's udhaar
    // (recorded as a credit sale with the cash as "paid now"). Needs a customer.
    const cashShortfall = cashShort ? round2(payable - Math.max(0, tendered)) : 0;
    const cashShortToCredit = cashShort && Boolean(posCustomerId);
    const ledgerRequired = paymentMethod === "CREDIT" || cashShort;
    const selectedCustomer = customers.find((c) => c._id === posCustomerId);
    // What this bill adds to the selected customer's khata (on top of their existing due)
    const billDue =
        cashShortToCredit
            ? cashShortfall
            : paymentMethod === "CREDIT" && posCustomerId
              ? round2(Math.max(0, payable - Math.min(Math.max(0, Number(amountPaid) || 0), payable)))
              : 0;
    const currentDue = Number(selectedCustomer?.balance) || 0;
    const dueLabel = (balance) => {
        const b = Number(balance) || 0;
        return b < 0 ? `advance ₹${formatAmount(-b)}` : `previous due ₹${formatAmount(b)}`;
    };

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
                isTaxInclusive,
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
        if (cashShortToCredit) {
            onConfirm({
                posPaymentMethod: "CREDIT",
                walkInCustomer:
                    walkInName.trim() || walkInPhone.trim()
                        ? { name: walkInName.trim(), phone: walkInPhone.trim() }
                        : undefined,
                couponCode: appliedCoupon?.code || undefined,
                discount: manualDiscount ? Math.min(manualDiscount, baseTotal) : undefined,
                posCustomerId,
                amountPaid: round2(Math.min(Math.max(0, tendered), payable)),
                taxPercent: activeTaxPercent,
                taxTotal: activeTaxTotal,
                isTaxInclusive,
            });
            return;
        }
        onConfirm({
            posPaymentMethod: paymentMethod,
            walkInCustomer:
                walkInName.trim() || walkInPhone.trim()
                    ? { name: walkInName.trim(), phone: walkInPhone.trim() }
                    : undefined,
            couponCode: appliedCoupon?.code || undefined,
            discount: manualDiscount ? Math.min(manualDiscount, baseTotal) : undefined,
            posCustomerId: posCustomerId || undefined,
            amountPaid: paymentMethod === "CREDIT" ? Math.min(Math.max(0, Number(amountPaid) || 0), payable) : undefined,
            cashTendered: paymentMethod === "CASH" && tendered != null ? tendered : undefined,
            posPayments: paymentMethod === "SPLIT" ? splitLines : undefined,
            taxPercent: activeTaxPercent,
            taxTotal: activeTaxTotal,
            isTaxInclusive,
        });
    };

    const creditOverpaid = paymentMethod === "CREDIT" && Number(amountPaid) > payable;
    const confirmDisabled =
        (paymentMethod === "CREDIT" && !posCustomerId) ||
        creditOverpaid ||
        couponPending ||
        (cashShort && !posCustomerId) ||
        (paymentMethod === "CASH" && tendered != null && tendered < 0) ||
        splitInvalid;

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
                                    {isTaxInclusive
                                        ? `(incl. ${inr(activeTaxTotal)} GST — CGST: ${inr(activeTaxTotal / 2)} + SGST: ${inr(activeTaxTotal / 2)})`
                                        : `+${inr(activeTaxTotal)} GST (CGST: ${inr(activeTaxTotal / 2)} + SGST: ${inr(activeTaxTotal / 2)})`}
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
                        {cashShortToCredit ? (
                            <div className="px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-0.5">
                                <div className="flex items-center justify-between font-bold">
                                    <span>Paid now (cash):</span>
                                    <span>{inr(Math.max(0, tendered))}</span>
                                </div>
                                <div className="flex items-center justify-between font-bold">
                                    <span>Balance to udhaar:</span>
                                    <span className="text-sm font-black text-amber-700">{inr(cashShortfall)}</span>
                                </div>
                                <p className="text-[11px] font-medium text-amber-800/90 pt-0.5">
                                    {inr(cashShortfall)} will be added to {selectedCustomer?.name || "the customer"}'s khata as due.
                                </p>
                            </div>
                        ) : cashShort ? (
                            <p className="text-xs font-bold text-rose-600 px-1">
                                Cash received is {inr(cashShortfall)} less than the amount due. Collect the full amount, or select a ledger customer below to add {inr(cashShortfall)} to their udhaar.
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
                <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                            Ledger customer{" "}
                            {ledgerRequired ? (
                                <span className="text-rose-500 font-black">(required for udhaar)</span>
                            ) : (
                                <span className="normal-case tracking-normal font-semibold text-slate-400">(optional — only needed if any amount stays due)</span>
                            )}
                        </p>
                        {!showAddCustomer && (
                            <button
                                type="button"
                                onClick={handleOpenAddCustomer}
                                className="text-[11px] font-bold text-primary hover:underline flex items-center gap-1 cursor-pointer"
                            >
                                <HiOutlinePlus className="h-3 w-3" /> Add New Customer
                            </button>
                        )}
                    </div>

                    {showAddCustomer ? (
                        <div className="p-3 bg-primary/5 border border-primary/20 rounded-xl space-y-2.5 animate-in fade-in duration-150">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                                    <HiOutlineUserPlus className="h-4 w-4 text-primary" /> Add New Ledger Customer
                                </span>
                                <button
                                    type="button"
                                    onClick={() => setShowAddCustomer(false)}
                                    className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                                >
                                    <HiOutlineXMark className="h-4 w-4" />
                                </button>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <Input
                                    placeholder="Customer Name *"
                                    value={newCustomerName}
                                    autoCapitalize="words"
                                    className="capitalize"
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        setNewCustomerName(val.replace(/(^|\s)\S/g, (char) => char.toUpperCase()));
                                    }}
                                    autoFocus
                                />
                                <Input
                                    placeholder="Phone (10 digits, optional)"
                                    value={newCustomerPhone}
                                    maxLength={10}
                                    onChange={(e) => setNewCustomerPhone(e.target.value.replace(/\D/g, ""))}
                                />
                            </div>
                            <div className="flex justify-end gap-2 pt-0.5">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setShowAddCustomer(false)}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    isLoading={isCreatingCustomer}
                                    onClick={handleQuickCreateCustomer}
                                >
                                    Save & Select
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-1.5">
                            <div className={paymentMethod === "CREDIT" ? "grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2" : ""}>
                                <select
                                    value={posCustomerId}
                                    onChange={(e) => setPosCustomerId(e.target.value)}
                                    className={cn(
                                        "w-full px-3 py-2 rounded-xl border text-xs font-semibold bg-white outline-none focus:ring-2 focus:ring-primary/20 transition-colors",
                                        ledgerRequired && !posCustomerId
                                            ? "border-amber-300 bg-amber-50/30"
                                            : "border-slate-200"
                                    )}
                                >
                                    <option value="">— Walk-in —</option>
                                    {customers.map((c) => (
                                        <option key={c._id} value={c._id}>
                                            {c.name} {c.phone ? `(${c.phone})` : ""} — {dueLabel(c.balance)}
                                        </option>
                                    ))}
                                </select>
                                {paymentMethod === "CREDIT" && (
                                    <Input
                                        type="number"
                                        min="0"
                                        max={payable}
                                        step="0.01"
                                        placeholder="Paid now (₹, optional)"
                                        value={amountPaid}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            if (val === "") {
                                                setAmountPaid("");
                                                return;
                                            }
                                            const num = Number(val);
                                            if (num < 0) {
                                                setAmountPaid("0");
                                                return;
                                            }
                                            if (num > payable) {
                                                setAmountPaid(String(payable));
                                                toast.error(`Paid amount cannot exceed total bill (${inr(payable)})`);
                                                return;
                                            }
                                            setAmountPaid(val);
                                        }}
                                        className="w-full sm:w-44"
                                    />
                                )}
                            </div>

                            {ledgerRequired && !posCustomerId && (
                                <p className="text-[11px] font-medium text-amber-700 bg-amber-50/90 border border-amber-200/80 rounded-lg px-2.5 py-1.5 flex items-center gap-1.5">
                                    <HiOutlineExclamationTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                                    <span>Select a customer above or click <strong>+ Add New Customer</strong> to enable Confirm Sale.</span>
                                </p>
                            )}
                        </div>
                    )}
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
                                autoCapitalize="characters"
                                className="uppercase font-mono"
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
