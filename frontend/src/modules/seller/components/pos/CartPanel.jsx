import React from "react";
import { HiOutlineMinus, HiOutlinePlus, HiOutlineTrash, HiOutlineShoppingCart, HiOutlinePause, HiOutlineClock } from "react-icons/hi2";
import Button from "@shared/components/ui/Button";
import { cn } from "@/lib/utils";

const CartPanel = ({
    cart,
    onUpdateQuantity,
    onUpdatePrice,
    onRemove,
    onCheckout,
    subtotal,
    taxPercent = 0,
    taxMode = "PERCENT",
    taxValue = 0,
    onUpdateTax,
    taxAmount = 0,
    totalWithTax,
    onHold,
    heldCount = 0,
    onShowHeld,
}) => {
    const finalTotal = totalWithTax != null ? totalWithTax : subtotal;

    return (
        <div className="flex flex-col h-full">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
                <HiOutlineShoppingCart className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-black text-slate-900">Current Sale</h3>
                <span className="ml-auto text-xs font-bold text-slate-400">{cart.length} item{cart.length === 1 ? "" : "s"}</span>
                {onShowHeld && heldCount > 0 && (
                    <button
                        type="button"
                        onClick={onShowHeld}
                        className="flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1"
                    >
                        <HiOutlineClock className="h-3.5 w-3.5" />
                        Held ({heldCount})
                    </button>
                )}
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
                {cart.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-slate-400 py-10">
                        <HiOutlineShoppingCart className="h-9 w-9 mb-2" />
                        <p className="text-xs font-semibold">Tap a product to add it</p>
                    </div>
                ) : (
                    cart.map((line) => (
                        <div key={line.lineKey} className="rounded-xl border border-slate-100 bg-slate-50/60 p-2.5">
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <p className="text-xs font-bold text-slate-800 truncate">{line.name}</p>
                                    {line.variantLabel && (
                                        <p className="text-[10px] text-slate-500">{line.variantLabel}</p>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    onClick={() => onRemove(line.lineKey)}
                                    className="text-slate-400 hover:text-rose-600 shrink-0"
                                >
                                    <HiOutlineTrash className="h-4 w-4" />
                                </button>
                            </div>

                            <div className="flex items-center justify-between mt-2 gap-2">
                                <div className="flex items-center bg-white border border-slate-200 rounded-lg">
                                    <button
                                        type="button"
                                        onClick={() => onUpdateQuantity(line.lineKey, line.quantity - 1)}
                                        className="p-1.5 text-slate-600 active:scale-90"
                                    >
                                        <HiOutlineMinus className="h-3.5 w-3.5" />
                                    </button>
                                    <input
                                        type="number"
                                        min={1}
                                        max={line.maxStock}
                                        value={line.quantity}
                                        onChange={(e) => onUpdateQuantity(line.lineKey, Number(e.target.value))}
                                        className="w-10 text-center text-xs font-bold outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => onUpdateQuantity(line.lineKey, line.quantity + 1)}
                                        className={cn(
                                            "p-1.5 active:scale-90",
                                            line.quantity >= line.maxStock ? "text-slate-300" : "text-slate-600",
                                        )}
                                        disabled={line.quantity >= line.maxStock}
                                    >
                                        <HiOutlinePlus className="h-3.5 w-3.5" />
                                    </button>
                                </div>

                                <div className="flex items-center gap-1">
                                    <span className="text-xs text-slate-400 font-bold">₹</span>
                                    <input
                                        type="number"
                                        min={0}
                                        value={line.price}
                                        onChange={(e) => onUpdatePrice(line.lineKey, Number(e.target.value))}
                                        className="w-16 text-right text-xs font-bold bg-white border border-slate-200 rounded-lg px-1.5 py-1 outline-none focus:ring-2 focus:ring-primary/40"
                                    />
                                </div>

                                <span className="text-xs font-black text-slate-900 w-14 text-right">
                                    ₹{(line.price * line.quantity).toLocaleString("en-IN")}
                                </span>
                            </div>
                        </div>
                    ))
                )}
            </div>

            <div className="border-t border-slate-100 p-4 bg-white">
                {/* Tax / GST Custom Entry */}
                <div className="mb-3 space-y-2">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-700">Tax / GST</span>
                        {taxAmount > 0 && (
                            <span className="text-xs font-bold text-emerald-600">
                                +₹{(taxAmount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                {taxMode === "PERCENT" && taxValue > 0 ? ` (${taxValue}%)` : ""}
                            </span>
                        )}
                    </div>

                    {/* Custom Input with % / ₹ Toggle */}
                    <div className="flex items-center gap-1.5">
                        <div className="relative flex-1">
                            <input
                                type="number"
                                min="0"
                                step="any"
                                placeholder={taxMode === "PERCENT" ? "Custom GST % (e.g. 18)" : "Custom GST ₹ (e.g. 50)"}
                                value={taxValue === 0 ? "" : taxValue}
                                onChange={(e) => {
                                    const raw = e.target.value;
                                    const val = raw === "" ? 0 : Math.max(0, Number(raw));
                                    if (onUpdateTax) onUpdateTax(val, taxMode);
                                }}
                                className="w-full text-xs font-bold bg-white border border-slate-200 rounded-lg pl-2.5 pr-7 py-1.5 outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary placeholder:text-slate-400 placeholder:font-normal"
                            />
                            <span className="absolute right-2.5 top-1.5 text-xs font-bold text-slate-400 pointer-events-none">
                                {taxMode === "PERCENT" ? "%" : "₹"}
                            </span>
                        </div>
                        <div className="flex rounded-lg border border-slate-200 p-0.5 bg-slate-50 shrink-0">
                            <button
                                type="button"
                                onClick={() => onUpdateTax && onUpdateTax(taxValue, "PERCENT")}
                                className={cn(
                                    "px-2.5 py-1 text-[11px] font-bold rounded-md transition-all",
                                    taxMode === "PERCENT"
                                        ? "bg-primary text-white shadow-xs"
                                        : "text-slate-500 hover:text-slate-800"
                                )}
                            >
                                %
                            </button>
                            <button
                                type="button"
                                onClick={() => onUpdateTax && onUpdateTax(taxAmount || 0, "AMOUNT")}
                                className={cn(
                                    "px-2.5 py-1 text-[11px] font-bold rounded-md transition-all",
                                    taxMode === "AMOUNT"
                                        ? "bg-primary text-white shadow-xs"
                                        : "text-slate-500 hover:text-slate-800"
                                )}
                            >
                                ₹
                            </button>
                        </div>
                    </div>
                </div>

                {taxAmount > 0 ? (
                    <div className="space-y-1 mb-3 pt-1 border-t border-slate-100">
                        <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
                            <span>Subtotal</span>
                            <span>₹{subtotal.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs text-slate-600 font-semibold">
                            <span>Tax / GST {taxMode === "PERCENT" && taxValue > 0 ? `(${taxValue}%)` : ""}</span>
                            <span className="text-emerald-600">+₹{(taxAmount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                        <div className="flex items-center justify-between pt-1 border-t border-slate-100">
                            <span className="text-sm font-bold text-slate-700">Total</span>
                            <span className="text-xl font-black text-slate-900">₹{finalTotal.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                    </div>
                ) : (
                    <div className="flex items-center justify-between mb-3">
                        <span className="text-sm font-bold text-slate-500">Total</span>
                        <span className="text-xl font-black text-slate-900">₹{subtotal.toLocaleString("en-IN")}</span>
                    </div>
                )}

                <div className="flex gap-2">
                    {onHold && (
                        <Button variant="secondary" size="lg" disabled={cart.length === 0} onClick={onHold} title="Park this bill and serve the next customer">
                            <HiOutlinePause className="h-4 w-4 mr-1" />
                            Hold
                        </Button>
                    )}
                    <Button className="flex-1" size="lg" disabled={cart.length === 0} onClick={onCheckout}>
                        Checkout
                    </Button>
                </div>
            </div>
        </div>
    );
};

export default CartPanel;
