import React, { useEffect, useMemo, useRef, useState } from "react";
import { HiOutlineMagnifyingGlass, HiOutlineXMark } from "react-icons/hi2";
import { posApi } from "../../services/posApi";
import { cn } from "@/lib/utils";

const norm = (v) => String(v ?? "").trim().toLowerCase();

const unwrapList = (res) => {
    const d = res?.data;
    const list = d?.result ?? d?.results ?? d?.data ?? d;
    return Array.isArray(list) ? list : [];
};

/**
 * Exact barcode / SKU hit on a product or one of its variants.
 * Returns { product, variantSku } or null.
 */
const findByCode = (list, code) => {
    const c = norm(code);
    if (!c) return null;
    for (const p of list) {
        const variants = Array.isArray(p.variants) ? p.variants : [];
        const v = variants.find((x) => norm(x.barcode) === c || norm(x.sku) === c);
        if (v) return { product: p, variantSku: v.sku || "" };
        if (norm(p.barcode) === c || norm(p.sku) === c) return { product: p, variantSku: "" };
    }
    return null;
};

const matchesText = (p, q) => {
    if (norm(p.name).includes(q) || norm(p.sku).includes(q) || norm(p.barcode).includes(q)) return true;
    const variants = Array.isArray(p.variants) ? p.variants : [];
    return variants.some((v) => norm(v.barcode).includes(q) || norm(v.sku).includes(q) || norm(v.name).includes(q));
};

const MAX_RESULTS = 30;

/**
 * Searchable product picker for purchase bill lines.
 * Search by product name / SKU, or scan a barcode (scanners type the code then press Enter).
 * The loaded catalog is filtered instantly; the server is also queried so products
 * beyond the loaded list can still be found.
 */
const PurchaseProductSearch = ({
    products,
    selectedProduct,
    selectedVariantSku = "",
    onSelect,
    onClear,
    inputClassName = "",
}) => {
    const [query, setQuery] = useState("");
    const [open, setOpen] = useState(false);
    const [activeIdx, setActiveIdx] = useState(0);
    const [remote, setRemote] = useState([]);
    const [loading, setLoading] = useState(false);
    const [notFound, setNotFound] = useState("");
    const wrapRef = useRef(null);
    const reqIdRef = useRef(0);

    const q = norm(query);

    const selectedVariant = useMemo(() => {
        if (!selectedProduct || !selectedVariantSku) return null;
        return (selectedProduct.variants || []).find((v) => v.sku === selectedVariantSku) || null;
    }, [selectedProduct, selectedVariantSku]);

    const displaySelectedText = useMemo(() => {
        if (!selectedProduct) return "";
        let text = selectedProduct.name;
        if (selectedVariant) {
            text += ` (${selectedVariant.name || selectedVariant.sku})`;
        } else if (selectedProduct.barcode) {
            text += ` · ${selectedProduct.barcode}`;
        }
        return text;
    }, [selectedProduct, selectedVariant]);

    // Debounced server search (covers products not in the loaded list)
    useEffect(() => {
        if (!q) {
            setRemote([]);
            setLoading(false);
            return undefined;
        }
        const reqId = ++reqIdRef.current;
        setLoading(true);
        const t = setTimeout(async () => {
            try {
                const res = await posApi.getCatalog({ search: query.trim() });
                if (reqId === reqIdRef.current) setRemote(unwrapList(res));
            } catch {
                if (reqId === reqIdRef.current) setRemote([]);
            } finally {
                if (reqId === reqIdRef.current) setLoading(false);
            }
        }, 300);
        return () => clearTimeout(t);
    }, [q, query]);

    const results = useMemo(() => {
        if (!q) return products.slice(0, MAX_RESULTS);
        const seen = new Set();
        const out = [];
        for (const p of [...products.filter((x) => matchesText(x, q)), ...remote]) {
            if (!p?._id || seen.has(p._id)) continue;
            seen.add(p._id);
            out.push(p);
            if (out.length >= MAX_RESULTS) break;
        }
        return out;
    }, [products, remote, q]);

    useEffect(() => { setActiveIdx(0); }, [q]);

    // Close on outside click
    useEffect(() => {
        const onDown = (e) => {
            if (wrapRef.current && !wrapRef.current.contains(e.target)) {
                setOpen(false);
                setQuery("");
            }
        };
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
    }, []);

    const pick = (product, variantSku = "") => {
        onSelect(product, variantSku);
        setQuery("");
        setOpen(false);
        setNotFound("");
    };

    const handleEnter = async () => {
        const code = query.trim();
        if (!code) return;
        // 1) Exact barcode / SKU match (barcode scanners)
        const local = findByCode(products, code) || findByCode(remote, code);
        if (local) return pick(local.product, local.variantSku);
        try {
            const res = await posApi.getCatalog({ search: code });
            const hit = findByCode(unwrapList(res), code);
            if (hit) return pick(hit.product, hit.variantSku);
        } catch { /* fall through to list selection */ }
        // 2) Otherwise pick the highlighted search result
        const chosen = results[activeIdx];
        if (chosen) {
            const matchedVar = q
                ? (chosen.variants || []).find((v) => norm(v.barcode) === q || norm(v.sku) === q)
                : null;
            return pick(chosen, matchedVar ? matchedVar.sku : "");
        }
        setNotFound(code);
    };

    const onKeyDown = (e) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActiveIdx((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIdx((i) => Math.max(i - 1, 0));
        } else if (e.key === "Enter") {
            e.preventDefault();
            handleEnter();
        } else if (e.key === "Escape") {
            setOpen(false);
            setQuery("");
        }
    };

    const showingSelected = !open && !query && selectedProduct;

    return (
        <div ref={wrapRef} className="relative w-full min-w-0">
            <HiOutlineMagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
            <input
                type="text"
                className={cn(inputClassName, "pl-9 pr-8")}
                value={showingSelected ? displaySelectedText : query}
                placeholder={selectedProduct ? displaySelectedText : "Search name or scan barcode"}
                onFocus={() => setOpen(true)}
                onChange={(e) => {
                    setQuery(e.target.value);
                    setOpen(true);
                    setNotFound("");
                }}
                onKeyDown={onKeyDown}
                title="Search product by name / SKU or scan barcode"
            />
            {(selectedProduct || query) && (
                <button
                    type="button"
                    onClick={() => {
                        setQuery("");
                        setNotFound("");
                        if (!query && selectedProduct) onClear?.();
                    }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    title={query ? "Clear search" : "Clear product"}
                >
                    <HiOutlineXMark className="h-4 w-4" />
                </button>
            )}

            {open && (
                <div className="absolute left-0 right-0 top-full mt-1 z-50 max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
                    {results.length === 0 ? (
                        <div className="px-3 py-3 text-xs text-slate-500">
                            {loading ? "Searching…" : notFound ? `No product found for "${notFound}"` : q ? "No matching products" : "No products yet"}
                        </div>
                    ) : (
                        results.map((p, idx) => {
                            const matchedVar = q
                                ? (p.variants || []).find((v) => norm(v.barcode).includes(q) || norm(v.sku).includes(q) || norm(v.name).includes(q))
                                : null;
                            return (
                                <button
                                    type="button"
                                    key={p._id}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => pick(p, matchedVar ? matchedVar.sku : "")}
                                    onMouseEnter={() => setActiveIdx(idx)}
                                    className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2 text-sm ${idx === activeIdx ? "bg-primary/10" : "hover:bg-slate-50"} ${selectedProduct?._id === p._id ? "font-bold text-primary" : "text-slate-800"}`}
                                >
                                    <span className="min-w-0">
                                        <span className="block truncate">{p.name}</span>
                                        {matchedVar ? (
                                            <span className="block truncate text-[11px] text-primary font-medium">
                                                Variant: {matchedVar.name || matchedVar.sku} {matchedVar.barcode ? `· Barcode: ${matchedVar.barcode}` : ""}
                                            </span>
                                        ) : (p.barcode || p.sku) ? (
                                            <span className="block truncate text-[11px] text-slate-400 font-normal">
                                                {[p.barcode ? `Barcode: ${p.barcode}` : "", p.sku ? `SKU: ${p.sku}` : ""].filter(Boolean).join(" · ")}
                                            </span>
                                        ) : null}
                                    </span>
                                    <span className="shrink-0 text-[11px] text-slate-500 font-medium">
                                        {p.variants?.length > 0 ? `${p.variants.length} var · ` : ""}Stock {p.stock ?? 0}
                                    </span>
                                </button>
                            );
                        })
                    )}
                    {loading && results.length > 0 && (
                        <div className="px-3 py-1.5 text-[11px] text-slate-400 border-t border-slate-100">Searching more…</div>
                    )}
                </div>
            )}
        </div>
    );
};

export default PurchaseProductSearch;
