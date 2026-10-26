import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { HiOutlineTrash, HiOutlineArrowDownTray, HiOutlinePencilSquare } from "react-icons/hi2";
import { useAuth } from "@core/context/AuthContext";
import Modal from "@shared/components/ui/Modal";
import { useSellerOrders } from "../context/SellerOrdersContext";
import { posApi } from "../services/posApi";
import { resolveApiBaseUrl } from "@core/api/resolveApiBaseUrl";
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
    LastSaleCard,
} from "../components/pos";
import { formatAmount } from "@shared/utils/currency";
import { posCustomerIdOf } from "@/lib/posCustomer";
import { downloadPosHeldBillsPDF } from "@/lib/posPdfExport";

const PACKING_WORKFLOW_STATUSES = [
    "SELLER_PENDING",
    "SELLER_ACCEPTED",
    "DELIVERY_SEARCH",
    "DELIVERY_ASSIGNED",
    "PICKUP_READY",
];

const resolvePrice = (entity, fallback) => {
    const sale = Number(entity?.salePrice ?? fallback?.salePrice ?? 0);
    const mrp = Number(entity?.price ?? fallback?.price ?? 0);
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

const readLastSale = (key) => {
    try {
        const raw = localStorage.getItem(key);
        const order = raw ? JSON.parse(raw) : null;
        return order && order.orderId ? order : null;
    } catch {
        return null;
    }
};

const PosTerminal = () => {
    const { user } = useAuth();
    const { orders, refreshOrders } = useSellerOrders();

    // Section comes from the URL (/seller/pos/:section), driven by the sidebar
    const { section } = useParams();
    const [searchParams, setSearchParams] = useSearchParams();
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
    const [isTaxInclusive, setIsTaxInclusive] = useState(() => {
        try {
            const saved = localStorage.getItem("pos:tax_inclusive");
            return saved !== null ? saved === "true" : true;
        } catch {
            return true;
        }
    });

    const handleToggleTaxInclusive = useCallback((val) => {
        setIsTaxInclusive(val);
        try {
            localStorage.setItem("pos:tax_inclusive", String(val));
        } catch {}
    }, []);

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

    // Last completed bill stays on the counter (and survives a reload) for quick reprint / edit.
    // Keyed by backend too: a bill saved against another server/database must not show here.
    const lastSaleKey = `pos:last:${resolveApiBaseUrl()}:${user?._id || user?.id || "seller"}`;
    const [lastSale, setLastSale] = useState(() => readLastSale(lastSaleKey));
    const [reprintOrder, setReprintOrder] = useState(null);
    // "Edit bill": the posted bill is loaded into the register; checkout then updates it instead of
    // creating a new sale. { order, originalQty: { lineKey: qty }, checkoutDefaults, prevTaxInclusive }
    const [editSession, setEditSession] = useState(null);
    const [isEditLoading, setIsEditLoading] = useState(false);
    useEffect(() => {
        const stored = readLastSale(lastSaleKey);
        setLastSale(stored);
        if (!stored) return undefined;
        // The card comes from localStorage, so confirm its bill still exists before offering Edit.
        let cancelled = false;
        posApi.getOrderForReturn(stored.orderId).catch((error) => {
            if (cancelled || error?.response?.status !== 404) return;
            setLastSale(null);
            try {
                localStorage.removeItem(lastSaleKey);
            } catch {
                /* storage unavailable — nothing persisted to clear */
            }
        });
        return () => {
            cancelled = true;
        };
    }, [lastSaleKey]);
    const saveLastSale = useCallback(
        (order) => {
            setLastSale(order);
            try {
                if (order) localStorage.setItem(lastSaleKey, JSON.stringify(order));
                else localStorage.removeItem(lastSaleKey);
            } catch {
                /* storage unavailable — last sale stays in memory for this session */
            }
        },
        [lastSaleKey],
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
        const list =
            term.length !== 1
                ? products
                : products.filter(
                      (p) =>
                          String(p.name || "").toLowerCase().includes(term) ||
                          String(p.sku || "").toLowerCase().includes(term) ||
                          String(p.barcode || "").toLowerCase().includes(term),
                  );
        // In-stock first, out-of-stock last — re-applied locally so a line that just sold out drops to the end.
        const hasStock = (p) =>
            Number(p.stock || 0) > 0 || (Array.isArray(p.variants) && p.variants.some((v) => Number(v?.stock || 0) > 0));
        return [...list].sort((a, b) => Number(hasStock(b)) - Number(hasStock(a)));
    }, [products, searchTerm]);

    const addLineToCart = useCallback((product, variant) => {
        const variantSku = variant?.sku || "";
        const lineKey = `${product._id}::${variantSku}`;
        // While editing a bill, the units already on it are still available to that bill.
        const reserved = Number(editSession?.originalQty?.[lineKey] || 0);
        const stock = (Number(variant ? variant.stock ?? product.stock : product.stock) || 0) + reserved;
        if (stock <= 0) {
            toast.error(`${product.name} is out of stock`);
            return;
        }
        const price = resolvePrice(variant, product);
        const variantLabel =
            variant?.name ||
            [variant?.size, variant?.colour].filter(Boolean).join(" · ") ||
            variant?.sku ||
            "";

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
                    variantLabel,
                    name: product.name,
                    price,
                    gstPercent: Number(product.gstPercent || 0),
                    quantity: 1,
                    maxStock: stock,
                },
            ];
        });
    }, [editSession]);

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
        if (isTaxInclusive) {
            if (taxMode === "PERCENT") {
                if (Number(taxValue) > 0) {
                    const rate = Number(taxValue);
                    const base = (subtotal * 100) / (100 + rate);
                    return Math.round((subtotal - base) * 100) / 100;
                }
                return Math.round(
                    cart.reduce((sum, l) => {
                        const rate = Number(l.gstPercent || 0);
                        if (rate <= 0) return sum;
                        const lineTotal = l.price * l.quantity;
                        const base = (lineTotal * 100) / (100 + rate);
                        return sum + (lineTotal - base);
                    }, 0) * 100,
                ) / 100;
            }
            return Math.min(subtotal, Math.round((Number(taxValue) || 0) * 100) / 100);
        } else {
            if (taxMode === "PERCENT") {
                if (Number(taxValue) > 0) {
                    return Math.round(((subtotal * (Number(taxValue) || 0)) / 100) * 100) / 100;
                }
                return Math.round(
                    cart.reduce((sum, l) => {
                        const rate = Number(l.gstPercent || 0);
                        return sum + (rate > 0 ? (l.price * l.quantity * rate) / 100 : 0);
                    }, 0) * 100,
                ) / 100;
            }
            return Math.round((Number(taxValue) || 0) * 100) / 100;
        }
    }, [cart, subtotal, taxMode, taxValue, isTaxInclusive]);

    const taxPercent = useMemo(() => {
        if (taxMode === "PERCENT" && Number(taxValue) > 0) {
            return Number(taxValue);
        }
        const base = isTaxInclusive ? Math.max(0, subtotal - taxAmount) : subtotal;
        return base > 0 ? Math.round(((taxAmount / base) * 100) * 100) / 100 : 0;
    }, [subtotal, taxMode, taxValue, taxAmount, isTaxInclusive]);

    const totalWithTax = useMemo(
        () => (isTaxInclusive ? Math.round(subtotal * 100) / 100 : Math.round((subtotal + taxAmount) * 100) / 100),
        [subtotal, taxAmount, isTaxInclusive],
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
                gstPercent: l.gstPercent !== undefined ? l.gstPercent : undefined,
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
                    isTaxInclusive,
                },
                ...list,
            ];
            saveHeld(next);
            setCart([]);
            setTaxValue(0);
            setTaxMode("PERCENT");
            return next;
        },
        [cart, totalWithTax, taxPercent, taxAmount, taxMode, taxValue, isTaxInclusive, heldBills, saveHeld],
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
        if (bill.isTaxInclusive !== undefined) {
            setIsTaxInclusive(bill.isTaxInclusive);
        }
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
        reason,
    }) => {
        setIsSubmitting(true);
        const resolvedTaxPercent = checkoutTaxPercent !== undefined ? Number(checkoutTaxPercent) : Number(taxPercent) || 0;
        const resolvedTaxTotal = checkoutTaxTotal !== undefined ? Number(checkoutTaxTotal) : taxAmount;
        if (editSession) {
            await submitBillEdit({
                items: saleItems,
                posPaymentMethod,
                // "" unlinks the ledger customer (bill goes back to walk-in)
                posCustomerId: posCustomerId || "",
                amountPaid,
                posPayments,
                cashTendered,
                discount: Number(discount) || 0,
                taxPercent: resolvedTaxPercent,
                taxTotal: resolvedTaxTotal,
                isTaxInclusive,
                walkInCustomer: walkInCustomer || { name: "", phone: "" },
                reason: String(reason || "").trim() || "Bill correction",
            });
            return;
        }
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
            isTaxInclusive,
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
            if (order) saveLastSale(order);
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

    /* ---------- last sale: reprint / edit from the counter ---------- */
    const exitEditMode = useCallback(
        (session = editSession) => {
            setEditSession(null);
            setCart([]);
            setTaxValue(0);
            setTaxMode("PERCENT");
            if (session) setIsTaxInclusive(session.prevTaxInclusive);
        },
        [editSession],
    );

    // Loads a posted bill into the register (Update mode): lines, prices, tax mode, and the
    // payment/customer details the checkout starts from. Every "Edit bill" entry point
    // (last sale, sales history, returns, ledgers, receipt) ends up here.
    const loadBillForEdit = async (billOrderId) => {
        if (!billOrderId) return;
        if (editSession && editSession.order.orderId === billOrderId) return;
        setIsEditLoading(true);
        try {
            const res = await posApi.getOrderForReturn(billOrderId);
            const data = res?.data?.result;
            if (!data?.order) throw new Error("Bill not found");
            const lines = Array.isArray(data.items) ? data.items : [];
            if (lines.some((l) => Number(l.returnedQuantity || 0) > 0)) {
                toast.error("This bill already has returns, so it can't be edited. Use Returns to adjust it.");
                return;
            }
            const order = data.order;

            // Park anything already on the till so it isn't lost.
            if (cart.length && !editSession) {
                holdCurrentCart();
                toast.info("Current cart moved to Held bills");
            }

            const byKey = new Map();
            lines.forEach((l) => {
                const variantSku = l.variantSlot || "";
                const lineKey = `${l.product}::${variantSku}`;
                const prev = byKey.get(lineKey);
                if (prev) {
                    prev.quantity += Number(l.quantity || 0);
                    prev.maxStock += Number(l.quantity || 0);
                    return;
                }
                const name = String(l.name || "");
                byKey.set(lineKey, {
                    lineKey,
                    productId: String(l.product),
                    variantSku,
                    variantLabel: l.variantName && !name.includes(l.variantName) ? l.variantName : "",
                    name,
                    price: Number(l.price || 0),
                    gstPercent: Number(l.gstPercent || 0),
                    quantity: Number(l.quantity || 0),
                    maxStock: Number(l.availableStock || 0) + Number(l.quantity || 0),
                });
            });
            const nextCart = [...byKey.values()];
            const originalQty = Object.fromEntries(nextCart.map((l) => [l.lineKey, l.quantity]));

            // Tax: per-line GST when it reproduces the bill's tax, else the bill's effective rate.
            const pb = order.paymentBreakdown || {};
            const inclusive = order.isTaxInclusive !== undefined ? order.isTaxInclusive !== false : pb.isTaxInclusive !== false;
            const billTax = Number(pb.taxTotal || 0);
            const sub = nextCart.reduce((s, l) => s + l.price * l.quantity, 0);
            const lineTax = nextCart.reduce((s, l) => {
                const rate = Number(l.gstPercent || 0);
                if (rate <= 0) return s;
                const lineTotal = l.price * l.quantity;
                return s + (inclusive ? lineTotal - (lineTotal * 100) / (100 + rate) : (lineTotal * rate) / 100);
            }, 0);
            let nextTaxMode = "PERCENT";
            let nextTaxValue = 0;
            if (Math.abs(lineTax - billTax) > 0.01) {
                if (billTax <= 0) {
                    nextTaxMode = "AMOUNT";
                } else {
                    const base = inclusive ? sub - billTax : sub;
                    nextTaxValue = base > 0 ? Math.round(((billTax * 100) / base) * 100) / 100 : 0;
                }
            }

            const method = order.posPaymentMethod || "CASH";
            const split = { CASH: "", CARD: "", QR: "", OTHER: "" };
            (order.posPayments || []).forEach((p) => {
                split[p.method] = String(p.amount);
            });
            setEditSession({
                order,
                originalQty,
                prevTaxInclusive: editSession ? editSession.prevTaxInclusive : isTaxInclusive,
                checkoutDefaults: {
                    paymentMethod: method,
                    walkInName: order.walkInCustomer?.name || "",
                    walkInPhone: order.walkInCustomer?.phone || "",
                    posCustomerId: posCustomerIdOf(order),
                    discount: Number(pb.discountTotal || 0) > 0 ? String(pb.discountTotal) : "",
                    amountPaid: method === "CREDIT" && Number(order.posAmountPaid || 0) > 0 ? String(order.posAmountPaid) : "",
                    cashTendered: method === "CASH" && order.posCashTendered != null ? String(order.posCashTendered) : "",
                    split,
                },
            });
            setCart(nextCart);
            setIsTaxInclusive(inclusive);
            setTaxMode(nextTaxMode);
            setTaxValue(nextTaxValue);
            toast.success(`Bill #${order.orderId} loaded — change items, then Update bill`);
        } catch (error) {
            // The last-sale card lives in localStorage, so it can outlive its bill
            // (deleted, or saved against another database). Drop it once the server says so.
            if (error?.response?.status === 404 && billOrderId === lastSale?.orderId) {
                saveLastSale(null);
                toast.error(`Bill #${billOrderId} no longer exists, so it can't be edited.`);
                return;
            }
            toast.error(error?.response?.data?.message || "Could not open the bill for editing");
        } finally {
            setIsEditLoading(false);
        }
    };

    const handleEditLastSale = () => loadBillForEdit(lastSale?.orderId);

    // Edit bill from receipt: close the receipt and load that bill into the register.
    const editFromReceipt = (order, close) => {
        close();
        loadBillForEdit(order?.orderId);
    };

    // Deep link from other screens: /seller/pos?edit=<bill no> opens that bill in Update mode.
    const editParam = activeTab === "sale" ? searchParams.get("edit") : null;
    useEffect(() => {
        if (!editParam) return;
        const next = new URLSearchParams(searchParams);
        next.delete("edit");
        setSearchParams(next, { replace: true });
        loadBillForEdit(editParam);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editParam]);

    const submitBillEdit = async (payload) => {
        const session = editSession;
        try {
            const res = await posApi.editSale(session.order.orderId, payload);
            const updated = res?.data?.result?.order;
            const merged = updated || session.order;
            exitEditMode(session);
            setIsCheckoutOpen(false);
            setSaleCount((n) => n + 1);
            if (merged) {
                saveLastSale(merged);
                setCompletedOrder(merged); // show the corrected receipt
            }
            fetchCatalog(catalogParams); // edited quantities move stock
            toast.success("Bill updated");
        } catch (error) {
            toast.error(error?.response?.data?.message || "Could not update the bill");
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
                <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-4">
                    {/* minmax(0,1fr) + min-w-0: a plain 1fr column grows to its widest content (the
                        category chip row), pushing the products and bill past the right edge. */}
                    <div className="space-y-3 min-w-0">
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

                    {/* Desktop: pinned under the top bar (top-24) and capped to the space between it and the
                        layout's bottom padding, so the line list scrolls inside and totals + Checkout stay visible. */}
                    <div id="pos-cart-panel" className="h-fit lg:sticky lg:top-24 lg:max-h-[calc(100vh-11rem)] flex flex-col gap-3 min-h-0">
                        {isEditLoading && !editSession && (
                            <div className="rounded-2xl border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs font-bold text-amber-800">
                                Loading bill for editing…
                            </div>
                        )}
                        {editSession ? (
                            <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3 flex items-start gap-2">
                                <HiOutlinePencilSquare className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                                <div className="min-w-0 flex-1">
                                    <p className="text-[10px] font-black uppercase tracking-wider text-amber-700">Editing bill</p>
                                    <p className="text-sm font-black text-slate-900 truncate">
                                        #{editSession.order.orderId} · was ₹{formatAmount(editSession.order.paymentBreakdown?.grandTotal)}
                                    </p>
                                    <p className="text-[11px] text-slate-600">
                                        Add, remove or change items, then <strong>Update bill</strong>. Stock moves by the difference only.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => {
                                        exitEditMode();
                                        toast.info("Edit cancelled — bill unchanged");
                                    }}
                                    className="text-xs font-bold text-slate-600 hover:text-rose-600 shrink-0"
                                >
                                    Cancel edit
                                </button>
                            </div>
                        ) : (
                            <LastSaleCard
                                order={lastSale}
                                onReprint={() => setReprintOrder(lastSale)}
                                onEdit={handleEditLastSale}
                                onDismiss={() => saveLastSale(null)}
                                isEditLoading={isEditLoading}
                            />
                        )}
                        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm min-h-0 flex flex-col overflow-hidden">
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
                                isTaxInclusive={isTaxInclusive}
                                onToggleTaxInclusive={handleToggleTaxInclusive}
                                totalWithTax={totalWithTax}
                                onHold={editSession ? undefined : handleHold}
                                heldCount={heldBills.length}
                                onShowHeld={editSession ? undefined : () => setIsHeldOpen(true)}
                                title={editSession ? `Editing #${editSession.order.orderId}` : undefined}
                                checkoutLabel={editSession ? "Update bill" : undefined}
                            />
                        </div>
                    </div>
                </div>
            ) : (
                <OnlineOrdersPanel orders={packingQueue} onChanged={refreshOrders} shopName={user?.shopName || user?.name} />
            )}

            {/* Mobile floating quick-bar when cart has items (hidden on desktop) */}
            {activeTab === "sale" && cart.length > 0 && (
                <div className="fixed bottom-16 left-0 right-0 z-40 lg:hidden p-3 bg-slate-900/95 backdrop-blur-md text-white border-t border-white/10 shadow-[0_-8px_30px_rgba(0,0,0,0.3)] flex items-center justify-between gap-3 animate-in fade-in slide-in-from-bottom duration-200">
                    <div className="min-w-0 pl-1">
                        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-tight">
                            {cart.length} item{cart.length === 1 ? "" : "s"} in cart
                        </p>
                        <p className="text-base font-black text-white">
                            ₹{formatAmount(totalWithTax)}
                        </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <button
                            type="button"
                            onClick={() => {
                                const el = document.getElementById("pos-cart-panel");
                                if (el) el.scrollIntoView({ behavior: "smooth" });
                            }}
                            className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-slate-200 text-xs font-bold transition-all"
                        >
                            View Bill
                        </button>
                        <button
                            type="button"
                            onClick={() => setIsCheckoutOpen(true)}
                            className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-black shadow-lg shadow-primary/30 active:scale-95 transition-all flex items-center gap-1"
                        >
                            {editSession ? "Update" : "Checkout"} &rarr;
                        </button>
                    </div>
                </div>
            )}

            <VariantPickerModal
                product={pendingVariantProduct}
                onSelect={handleSelectVariant}
                onClose={() => setPendingVariantProduct(null)}
            />

            <CheckoutModal
                key={editSession ? `edit-${editSession.order.orderId}-${saleCount}` : saleCount}
                mode={editSession ? "edit" : "sale"}
                initialValues={editSession?.checkoutDefaults}
                isOpen={isCheckoutOpen}
                onClose={() => setIsCheckoutOpen(false)}
                subtotal={subtotal}
                taxPercent={taxPercent}
                taxTotal={taxAmount}
                isTaxInclusive={isTaxInclusive}
                items={saleItems}
                onConfirm={handleConfirmSale}
                isSubmitting={isSubmitting}
            />

            <Modal isOpen={isHeldOpen} onClose={() => setIsHeldOpen(false)} title="Held bills" size="sm">
                {heldBills.length === 0 ? (
                    <p className="text-sm text-slate-400 text-center py-6">No held bills</p>
                ) : (
                    <div className="space-y-2">
                        <div className="flex justify-end">
                            <button
                                type="button"
                                onClick={() =>
                                    downloadPosHeldBillsPDF({
                                        bills: heldBills,
                                        shopName: user?.shopName || user?.name,
                                    }).catch(() => toast.error("Failed to download held bills"))
                                }
                                className="flex items-center gap-1 text-xs font-bold text-slate-600 hover:text-primary"
                            >
                                <HiOutlineArrowDownTray className="h-4 w-4" />
                                Download PDF
                            </button>
                        </div>
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
                                    className="text-xs font-bold text-primary-foreground bg-primary rounded-lg px-3 py-1.5"
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
                    onEdit={(o) => editFromReceipt(o, () => setCompletedOrder(null))}
                />
            )}

            {reprintOrder && (
                <ReceiptPrint
                    order={reprintOrder}
                    shopName={user?.shopName || user?.name}
                    seller={user}
                    heading="Bill Copy"
                    onClose={() => setReprintOrder(null)}
                    onEdit={(o) => editFromReceipt(o, () => setReprintOrder(null))}
                />
            )}
        </div>
    );
};

export default PosTerminal;
