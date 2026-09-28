import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { HiOutlineTrash } from "react-icons/hi2";
import { useAuth } from "@core/context/AuthContext";
import Modal from "@shared/components/ui/Modal";
import { useSellerOrders } from "../context/SellerOrdersContext";
import { posApi } from "../services/posApi";
import {
    ProductGrid,
    SearchBar,
    CategoryFilterBar,
    CartPanel,
    CheckoutModal,
    ReceiptPrint,
    VariantPickerModal,
    ReturnsPanel,
    SalesHistory,
    OnlineOrdersPanel,
} from "../components/pos";
import { formatAmount } from "@shared/utils/currency";

const PACKING_WORKFLOW_STATUSES = [
    "SELLER_PENDING",
    "SELLER_ACCEPTED",
    "DELIVERY_SEARCH",
    "DELIVERY_ASSIGNED",
    "PICKUP_READY",
];

const resolvePrice = (entity) => {
    const sale = Number(entity?.salePrice || 0);
    const mrp = Number(entity?.price || 0);
    return sale > 0 && sale < mrp ? sale : mrp;
};

function genIdempotencyKey() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return `pos-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const readHeld = (key) => {
    try {
        const raw = localStorage.getItem(key);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
};

const PosTerminal = () => {
    const { user } = useAuth();
    const { orders, refreshOrders } = useSellerOrders();

    // Section comes from the URL (/seller/pos/:section), driven by the sidebar
    const { section } = useParams();
    const [searchParams] = useSearchParams();
    const activeTab =
        section === "online-orders" ? "queue" : section === "returns" ? "returns" : section === "sales" ? "sales" : "sale";

    const [products, setProducts] = useState([]);
    const [knownCategories, setKnownCategories] = useState([]);
    const [isLoadingCatalog, setIsLoadingCatalog] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");
    const [activeCategoryId, setActiveCategoryId] = useState(null);
    const [cart, setCart] = useState([]);
    const [pendingVariantProduct, setPendingVariantProduct] = useState(null);
    const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [completedOrder, setCompletedOrder] = useState(null);
    const [saleCount, setSaleCount] = useState(0);
    const [isHeldOpen, setIsHeldOpen] = useState(false);
    const [taxMode, setTaxMode] = useState("PERCENT");
    const [taxValue, setTaxValue] = useState(0);

    const catalogRequestRef = useRef(0);
    // One idempotency key per attempted bill: a retry of the same payload after a
    // network/5xx failure reuses it, so the server can never record the bill twice.
    const pendingSaleRef = useRef(null);

    const heldKey = `pos:held:${user?._id || user?.id || "seller"}`;
    const [heldBills, setHeldBills] = useState(() => readHeld(heldKey));
    useEffect(() => {
        setHeldBills(readHeld(heldKey));
    }, [heldKey]);
    const saveHeld = useCallback(
        (list) => {
            setHeldBills(list);
            try {
                localStorage.setItem(heldKey, JSON.stringify(list));
            } catch {
                /* storage unavailable — held bills stay in memory for this session */
            }
        },
        [heldKey],
    );

    // Catalog is queried server-side with the current search/category, so the
    // whole catalog is reachable (not just the first page of products).
    const fetchCatalog = useCallback((params = {}) => {
        const requestId = ++catalogRequestRef.current;
        setIsLoadingCatalog(true);
        return posApi
            .getCatalog(params)
            .then((res) => {
                // handleResponse puts a bare array under `results` (plural),
                // not `result` — see backend/app/utils/helper.js.
                const items = Array.isArray(res?.data?.results) ? res.data.results : [];
                if (requestId === catalogRequestRef.current) setProducts(items);
                setKnownCategories((prev) => {
                    const map = new Map(prev.map((c) => [c.id, c.name]));
                    items.forEach((p) => {
                        const cat = p.categoryId;
                        if (cat && cat._id && !map.has(cat._id)) map.set(cat._id, cat.name);
                    });
                    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
                });
                return items;
            })
            .catch(() => {
                if (requestId === catalogRequestRef.current) toast.error("Failed to load your catalog");
                return [];
            })
            .finally(() => {
                if (requestId === catalogRequestRef.current) setIsLoadingCatalog(false);
            });
    }, []);

    const catalogParams = useMemo(() => {
        const term = searchTerm.trim();
        return {
            search: term.length >= 2 ? term : undefined,
            categoryId: activeCategoryId || undefined,
        };
    }, [searchTerm, activeCategoryId]);

    useEffect(() => {
        const t = setTimeout(() => fetchCatalog(catalogParams), catalogParams.search ? 300 : 0);
        return () => clearTimeout(t);
    }, [catalogParams, fetchCatalog]);

    // Stock changes from online orders / other tills: refresh when the till regains focus.
    useEffect(() => {
        const onFocus = () => fetchCatalog(catalogParams);
        window.addEventListener("focus", onFocus);
        return () => window.removeEventListener("focus", onFocus);
    }, [catalogParams, fetchCatalog]);

    const filteredProducts = useMemo(() => {
        // Single-character search is filtered locally (server search starts at 2 chars).
        const term = searchTerm.trim().toLowerCase();
        if (term.length !== 1) return products;
        return products.filter(
            (p) =>
                String(p.name || "").toLowerCase().includes(term) ||
                String(p.sku || "").toLowerCase().includes(term) ||
                String(p.barcode || "").toLowerCase().includes(term),
        );
    }, [products, searchTerm]);

    const addLineToCart = useCallback((product, variant) => {
        const stock = Number(variant ? variant.stock ?? product.stock : product.stock) || 0;
        if (stock <= 0) {
            toast.error(`${product.name} is out of stock`);
            return;
        }
        const variantSku = variant?.sku || "";
        const lineKey = `${product._id}::${variantSku}`;
        const price = resolvePrice(variant || product);

        setCart((prev) => {
            const existing = prev.find((l) => l.lineKey === lineKey);
            if (existing) {
                if (existing.quantity >= stock) {
                    toast.info(`Only ${stock} units available`);
                    return prev;
                }
                return prev.map((l) =>
                    l.lineKey === lineKey ? { ...l, quantity: l.quantity + 1 } : l,
                );
            }
            return [
                ...prev,
                {
                    lineKey,
                    productId: product._id,
                    variantSku,
                    variantLabel: variant?.name || "",
                    name: product.name,
                    price,
                    quantity: 1,
                    maxStock: stock,
                },
            ];
        });
    }, []);

    const handleAddProduct = useCallback(
        (product) => {
            const variants = Array.isArray(product.variants) ? product.variants : [];
            if (variants.length > 1) {
                setPendingVariantProduct(product);
                return;
            }
            addLineToCart(product, variants[0] || null);
        },
        [addLineToCart],
    );

    // Exact barcode / SKU match within a product list; returns true when added.
    const addByCode = useCallback(
        (list, term) => {
            for (const p of list) {
                const variant = (p.variants || []).find(
                    (v) => String(v.barcode || "").toLowerCase() === term || String(v.sku || "").toLowerCase() === term,
                );
                if (variant) {
                    // Scanned a variant-level barcode: add that exact variant.
                    addLineToCart(p, variant);
                    return true;
                }
                if (String(p.barcode || "").toLowerCase() === term || String(p.sku || "").toLowerCase() === term) {
                    handleAddProduct(p);
                    return true;
                }
            }
            return false;
        },
        [addLineToCart, handleAddProduct],
    );

    const handleBarcodeSubmit = useCallback(
        async (code) => {
            const raw = String(code || "").trim();
            const term = raw.toLowerCase();
            if (!term) return;
            if (addByCode(products, term)) {
                setSearchTerm("");
                return;
            }
            // Not in the products on screen — look it up across the whole catalog.
            try {
                const res = await posApi.getCatalog({ search: raw });
                const items = Array.isArray(res?.data?.results) ? res.data.results : [];
                if (addByCode(items, term)) {
                    setSearchTerm("");
                    return;
                }
                if (items.length === 1) {
                    handleAddProduct(items[0]);
                    setSearchTerm("");
                }
            } catch {
                /* search results are still shown in the grid */
            }
        },
        [products, addByCode, handleAddProduct],
    );

    const handleSelectVariant = useCallback(
        (product, variant) => {
            addLineToCart(product, variant);
            setPendingVariantProduct(null);
        },
        [addLineToCart],
    );

    const updateQuantity = useCallback((lineKey, nextQty) => {
        setCart((prev) => {
            if (nextQty <= 0) return prev.filter((l) => l.lineKey !== lineKey);
            return prev.map((l) => {
                if (l.lineKey !== lineKey) return l;
                const clamped = Math.min(Math.max(1, Math.round(nextQty)), l.maxStock || nextQty);
                return { ...l, quantity: clamped };
            });
        });
    }, []);

    const updatePrice = useCallback((lineKey, nextPrice) => {
        setCart((prev) =>
            prev.map((l) => (l.lineKey === lineKey ? { ...l, price: Math.max(0, Number(nextPrice) || 0) } : l)),
        );
    }, []);

    const removeLine = useCallback((lineKey) => {
        setCart((prev) => prev.filter((l) => l.lineKey !== lineKey));
    }, []);

    const subtotal = useMemo(
        () => cart.reduce((sum, l) => sum + l.price * l.quantity, 0),
        [cart],
    );

    const taxAmount = useMemo(() => {
        if (taxMode === "PERCENT") {
            return Math.round(((subtotal * (Number(taxValue) || 0)) / 100) * 100) / 100;
        }
        return Math.round((Number(taxValue) || 0) * 100) / 100;
    }, [subtotal, taxMode, taxValue]);

    const taxPercent = useMemo(() => {
        if (taxMode === "PERCENT") {
            return Number(taxValue) || 0;
        }
        return subtotal > 0 ? Math.round(((taxAmount / subtotal) * 100) * 100) / 100 : 0;
    }, [subtotal, taxMode, taxValue, taxAmount]);

    const totalWithTax = useMemo(
        () => Math.round((subtotal + taxAmount) * 100) / 100,
        [subtotal, taxAmount],
    );

    const handleUpdateTax = useCallback((value, mode = "PERCENT") => {
        setTaxMode(mode);
        setTaxValue(Number(value) || 0);
    }, []);

    const saleItems = useMemo(
        () =>
            cart.map((l) => ({
                productId: l.productId,
                quantity: l.quantity,
                price: l.price,
                variantSku: l.variantSku || undefined,
            })),
        [cart],
    );

    /* ---------- held (parked) bills ---------- */
    const holdCurrentCart = useCallback(
        (list = heldBills) => {
            if (!cart.length) return list;
            const next = [
                {
                    id: genIdempotencyKey(),
                    at: new Date().toISOString(),
                    cart,
                    total: totalWithTax,
                    taxPercent,
                    taxAmount,
                    taxMode,
                    taxValue,
                },
                ...list,
            ];
            saveHeld(next);
            setCart([]);
            setTaxValue(0);
            setTaxMode("PERCENT");
            return next;
        },
        [cart, totalWithTax, taxPercent, taxAmount, taxMode, taxValue, heldBills, saveHeld],
    );

    const handleHold = () => {
        holdCurrentCart();
        toast.success("Bill held — resume it from Held bills");
    };

    const resumeHeld = (bill) => {
        // Park whatever is on the till first so nothing is lost.
        const list = holdCurrentCart(heldBills).filter((b) => b.id !== bill.id);
        saveHeld(list);
        setCart(bill.cart || []);
        setTaxMode(bill.taxMode || "PERCENT");
        setTaxValue(bill.taxValue !== undefined ? Number(bill.taxValue) : Number(bill.taxPercent) || 0);
        setIsHeldOpen(false);
    };

    const deleteHeld = (bill) => saveHeld(heldBills.filter((b) => b.id !== bill.id));

    /* ---------- checkout ---------- */
    const handleConfirmSale = async ({
        posPaymentMethod,
        walkInCustomer,
        couponCode,
        posCustomerId,
        amountPaid,
        discount,
        cashTendered,
        posPayments,
        taxPercent: checkoutTaxPercent,
        taxTotal: checkoutTaxTotal,
    }) => {
        setIsSubmitting(true);
        const resolvedTaxPercent = checkoutTaxPercent !== undefined ? Number(checkoutTaxPercent) : Number(taxPercent) || 0;
        const resolvedTaxTotal = checkoutTaxTotal !== undefined ? Number(checkoutTaxTotal) : taxAmount;
        const payload = {
            items: saleItems,
            posPaymentMethod,
            walkInCustomer,
            couponCode,
            posCustomerId: posCustomerId || undefined,
            amountPaid,
            discount,
            cashTendered,
            posPayments,
            taxPercent: resolvedTaxPercent > 0 ? resolvedTaxPercent : undefined,
            taxTotal: resolvedTaxTotal > 0 ? resolvedTaxTotal : undefined,
        };
        const signature = JSON.stringify(payload);
        if (!pendingSaleRef.current || pendingSaleRef.current.signature !== signature) {
            pendingSaleRef.current = { signature, key: genIdempotencyKey() };
        }
        try {
            const res = await posApi.createSale(payload, pendingSaleRef.current.key);
            const order = res?.data?.result?.order;
            pendingSaleRef.current = null;

            // Optimistic local stock decrement, then a real refetch below.
            setProducts((prev) =>
                prev.map((p) => {
                    const soldLines = cart.filter((l) => l.productId === p._id);
                    if (!soldLines.length) return p;
                    const totalQty = soldLines.reduce((sum, l) => sum + l.quantity, 0);
                    const next = { ...p, stock: Math.max(0, Number(p.stock || 0) - totalQty) };
                    if (Array.isArray(p.variants) && p.variants.length) {
                        next.variants = p.variants.map((v) => {
                            const line = soldLines.find((l) => l.variantSku === v.sku);
                            if (!line) return v;
                            return { ...v, stock: Math.max(0, Number(v.stock || 0) - line.quantity) };
                        });
                    }
                    return next;
                }),
            );
            fetchCatalog(catalogParams);

            setCart([]);
            setTaxValue(0);
            setTaxMode("PERCENT");
            setIsCheckoutOpen(false);
            setSaleCount((n) => n + 1); // fresh checkout form for the next bill
            setCompletedOrder(order || null);
            toast.success("Sale recorded");
        } catch (error) {
            const status = error?.response?.status;
            // Keep the key only when the outcome is unknown (no response, still
            // processing, or a gateway error) — the bill may have been recorded.
            // Any other answer is final for that key; the next attempt gets a new one.
            const outcomeUnknown = !status || [409, 502, 503, 504].includes(status);
            if (!outcomeUnknown) pendingSaleRef.current = null;
            const msg = error?.response?.data?.message || "Failed to record sale — retry is safe";
            toast.error(msg);
        } finally {
            setIsSubmitting(false);
        }
    };

    const packingQueue = useMemo(
        () =>
            (orders || []).filter(
                (o) =>
                    o.orderSource !== "POS" &&
                    PACKING_WORKFLOW_STATUSES.includes(String(o.workflowStatus || "").toUpperCase()),
            ),
        [orders],
    );

    return (
        <div className="max-w-[1400px] mx-auto">
            {activeTab === "returns" ? (
                <ReturnsPanel
                    initialOrderId={searchParams.get("order") || ""}
                    shopName={user?.shopName || user?.name}
                    seller={user}
                />
            ) : activeTab === "sales" ? (
                <SalesHistory shopName={user?.shopName || user?.name} seller={user} />
            ) : activeTab === "sale" ? (
                <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
                    <div className="space-y-3">
                        <SearchBar value={searchTerm} onChange={setSearchTerm} onSubmit={handleBarcodeSubmit} />
                        <CategoryFilterBar
                            categories={knownCategories}
                            activeCategoryId={activeCategoryId}
                            onSelect={setActiveCategoryId}
                        />
                        <ProductGrid
                            products={filteredProducts}
                            isLoading={isLoadingCatalog && products.length === 0}
                            onAddProduct={handleAddProduct}
                        />
                    </div>

                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm h-fit lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] flex flex-col">
                        <CartPanel
                            cart={cart}
                            onUpdateQuantity={updateQuantity}
                            onUpdatePrice={updatePrice}
                            onRemove={removeLine}
                            onCheckout={() => setIsCheckoutOpen(true)}
                            subtotal={subtotal}
                            taxPercent={taxPercent}
                            taxMode={taxMode}
                            taxValue={taxValue}
                            onUpdateTax={handleUpdateTax}
                            taxAmount={taxAmount}
                            totalWithTax={totalWithTax}
                            onHold={handleHold}
                            heldCount={heldBills.length}
                            onShowHeld={() => setIsHeldOpen(true)}
                        />
                    </div>
                </div>
            ) : (
                <OnlineOrdersPanel orders={packingQueue} onChanged={refreshOrders} />
            )}

            <VariantPickerModal
                product={pendingVariantProduct}
                onSelect={handleSelectVariant}
                onClose={() => setPendingVariantProduct(null)}
            />

            <CheckoutModal
                key={saleCount}
                isOpen={isCheckoutOpen}
                onClose={() => setIsCheckoutOpen(false)}
                subtotal={subtotal}
                taxPercent={taxPercent}
                taxTotal={taxAmount}
                items={saleItems}
                onConfirm={handleConfirmSale}
                isSubmitting={isSubmitting}
            />

            <Modal isOpen={isHeldOpen} onClose={() => setIsHeldOpen(false)} title="Held bills" size="sm">
                {heldBills.length === 0 ? (
                    <p className="text-sm text-slate-400 text-center py-6">No held bills</p>
                ) : (
                    <div className="space-y-2">
                        {heldBills.map((bill) => (
                            <div key={bill.id} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-bold text-slate-900">
                                        ₹{formatAmount(bill.total)} ·{" "}
                                        {(bill.cart || []).length} item(s)
                                    </p>
                                    <p className="text-[11px] text-slate-500 truncate">
                                        {new Date(bill.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}{" "}
                                        — {(bill.cart || []).map((l) => `${l.quantity}x ${l.name}`).join(", ")}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => resumeHeld(bill)}
                                    className="text-xs font-bold text-white bg-primary rounded-lg px-3 py-1.5"
                                >
                                    Resume
                                </button>
                                <button
                                    type="button"
                                    onClick={() => deleteHeld(bill)}
                                    className="text-slate-400 hover:text-rose-600"
                                    title="Discard held bill"
                                >
                                    <HiOutlineTrash className="h-4 w-4" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </Modal>

            {completedOrder && (
                <ReceiptPrint
                    order={completedOrder}
                    shopName={user?.shopName || user?.name}
                    seller={user}
                    onClose={() => setCompletedOrder(null)}
                />
            )}
        </div>
    );
};

export default PosTerminal;
