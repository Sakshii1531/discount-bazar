import React, { useState } from "react";
import { toast } from "sonner";
import { HiOutlineArrowPath, HiOutlinePencilSquare, HiOutlineXMark } from "react-icons/hi2";
import { cn } from "@/lib/utils";
import { businessApi } from "../../services/businessApi";

const inputCls = "w-full px-3.5 py-2.5 rounded-xl border text-sm bg-white focus:outline-none focus:ring-2 transition-all";
const okCls = "border-slate-200 focus:border-primary focus:ring-primary/20";
const badCls = "border-rose-400 bg-rose-50/20 focus:border-rose-500 focus:ring-rose-200/50";

const capitalizeWords = (str) => String(str || "").replace(/(?:^|\s)\S/g, (c) => c.toUpperCase());
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const validate = (f) => {
    const errors = {};
    const name = f.name.trim();
    if (name.length < 2) errors.name = "Name must be at least 2 characters";
    else if (/^\d+$/.test(name)) errors.name = "Name cannot contain only numbers";
    const digits = f.phone.replace(/\D/g, "");
    if (f.phone.trim() && (digits.length < 10 || digits.length > 13)) errors.phone = "Enter a valid 10-digit mobile number";
    if (f.email.trim() && !EMAIL_RE.test(f.email.trim())) errors.email = "Enter a valid email address";
    if (f.gstin.trim() && !GSTIN_RE.test(f.gstin.trim())) errors.gstin = "Enter a valid 15-character GST number";
    return errors;
};

/**
 * Edit an existing supplier or customer (name, mobile, email, address, GSTIN).
 * Past bills and ledger entries point at the party by id, so they show the new details
 * without being rewritten. `onSaved` receives the updated party.
 */
const PartyEditModal = ({ kind, party, onClose, onSaved }) => {
    const isSupplier = kind === "suppliers";
    const label = isSupplier ? "Supplier" : "Customer";
    const [form, setForm] = useState({
        name: party.name || "",
        phone: party.phone || "",
        email: party.email || "",
        address: party.address || "",
        gstin: party.gstin || "",
    });
    const [touched, setTouched] = useState({});
    const [busy, setBusy] = useState(false);

    const errors = validate(form);
    const showError = (k) => touched[k] && errors[k];
    const set = (k, v) => {
        setForm((f) => ({ ...f, [k]: v }));
        setTouched((t) => ({ ...t, [k]: true }));
    };
    const changed = ["name", "phone", "email", "address", "gstin"].some((k) => form[k].trim() !== String(party[k] || "").trim());

    const close = () => !busy && onClose();

    const save = async (e) => {
        e?.preventDefault();
        setTouched({ name: true, phone: true, email: true, gstin: true });
        const first = Object.values(errors)[0];
        if (first) return toast.error(first);
        if (!changed) return onClose();
        setBusy(true);
        try {
            const payload = {
                name: capitalizeWords(form.name.trim()),
                phone: form.phone.trim(),
                email: form.email.trim().toLowerCase(),
                address: form.address.trim(),
                gstin: form.gstin.trim().toUpperCase(),
            };
            const res = await (isSupplier ? businessApi.saveSupplier(payload, party._id) : businessApi.saveCustomer(payload, party._id));
            const saved = res?.data?.result ?? res?.data?.results ?? res?.data?.data;
            toast.success(`${label} details updated`);
            onSaved?.({ ...party, ...payload, ...(saved && typeof saved === "object" ? saved : {}), balance: party.balance });
        } catch (err) {
            toast.error(err?.response?.data?.message || err?.message || `Could not update ${label.toLowerCase()}`);
        } finally {
            setBusy(false);
        }
    };

    const field = (k, labelText, input) => (
        <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">{labelText}</label>
            {input}
            {showError(k) && <p className="text-[11px] text-rose-600 mt-1 font-medium">{errors[k]}</p>}
        </div>
    );

    return (
        <div
            className="fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
            onClick={(e) => e.target === e.currentTarget && close()}
        >
            <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-8 animate-in fade-in zoom-in-95 duration-150">
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/70">
                    <div className="flex items-center gap-2.5">
                        <div className="h-9 w-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                            <HiOutlinePencilSquare className="h-5 w-5" />
                        </div>
                        <div>
                            <h3 className="text-sm font-black text-slate-900">Edit {label}</h3>
                            <p className="text-[11px] text-slate-500 font-medium">Past bills and ledger entries stay as they are</p>
                        </div>
                    </div>
                    <button type="button" onClick={close} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors" aria-label="Close">
                        <HiOutlineXMark className="h-5 w-5" />
                    </button>
                </div>
                <form onSubmit={save} className="p-6 space-y-4">
                    {field("name", <>{label} Name <span className="text-rose-500">*</span></>, (
                        <input
                            autoFocus
                            autoCapitalize="words"
                            maxLength={100}
                            className={cn(inputCls, "capitalize", showError("name") ? badCls : okCls)}
                            value={form.name}
                            onChange={(e) => set("name", capitalizeWords(e.target.value))}
                        />
                    ))}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {field("phone", <>Mobile Number <span className="text-slate-400 font-normal">(Optional)</span></>, (
                            <input
                                type="tel"
                                inputMode="numeric"
                                maxLength={15}
                                placeholder="e.g. 9876543210"
                                className={cn(inputCls, showError("phone") ? badCls : okCls)}
                                value={form.phone}
                                onChange={(e) => {
                                    let val = e.target.value.replace(/[^\d+]/g, "");
                                    if (val.indexOf("+") > 0) val = val.replace(/\+/g, "");
                                    set("phone", val.slice(0, 15));
                                }}
                            />
                        ))}
                        {field("email", <>Email <span className="text-slate-400 font-normal">(Optional)</span></>, (
                            <input
                                type="email"
                                maxLength={120}
                                placeholder="e.g. accounts@example.com"
                                className={cn(inputCls, showError("email") ? badCls : okCls)}
                                value={form.email}
                                onChange={(e) => set("email", e.target.value.trim())}
                            />
                        ))}
                    </div>
                    {field("gstin", <>GST Number <span className="text-slate-400 font-normal">(Optional)</span></>, (
                        <input
                            maxLength={15}
                            autoCapitalize="characters"
                            placeholder="e.g. 27AAPFU0939F1ZV"
                            className={cn(inputCls, "uppercase", showError("gstin") ? badCls : okCls)}
                            value={form.gstin}
                            onChange={(e) => set("gstin", e.target.value.toUpperCase().replace(/\s/g, ""))}
                        />
                    ))}
                    {field("address", <>Address <span className="text-slate-400 font-normal">(Optional)</span></>, (
                        <textarea
                            rows={2}
                            maxLength={300}
                            className={cn(inputCls, "resize-none", okCls)}
                            value={form.address}
                            onChange={(e) => set("address", e.target.value)}
                        />
                    ))}
                    <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                        <button
                            type="button"
                            disabled={busy}
                            onClick={close}
                            className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 bg-white hover:bg-slate-50 active:scale-95 transition-all cursor-pointer"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={busy || !changed}
                            className="px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-bold shadow-xs hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-50 disabled:pointer-events-none cursor-pointer flex items-center gap-1.5"
                        >
                            {busy ? <><HiOutlineArrowPath className="h-4 w-4 animate-spin" /> Saving...</> : "Save Changes"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default PartyEditModal;
