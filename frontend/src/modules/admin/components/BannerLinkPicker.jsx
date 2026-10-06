import React, { useEffect, useMemo, useState } from "react";
import { adminApi } from "../services/adminApi";

/**
 * Lets the admin choose where a banner goes when a shopper taps it.
 * Instead of typing a raw slug/ID, the admin picks a real header, category,
 * subcategory or product. Values saved in `linkValue`:
 *   header      -> header _id
 *   category    -> category _id
 *   subcategory -> "<categoryId>/<subcategoryId>" (the storefront opens the
 *                  parent category page with that subcategory selected)
 *   product     -> product _id
 *   url         -> full https:// URL
 */
const LINK_TYPES = [
  { value: "none", label: "No link (banner is not clickable)" },
  { value: "header", label: "Open a header tab" },
  { value: "category", label: "Open a category" },
  { value: "subcategory", label: "Open a subcategory" },
  { value: "product", label: "Open a product" },
  { value: "url", label: "Open a website link" },
];

const inputCls =
  "w-full p-2.5 bg-slate-50 rounded-xl text-xs font-bold border border-slate-200 outline-none focus:border-primary";

const extractProducts = (res) => {
  const raw = res?.data?.result;
  if (Array.isArray(res?.data?.results)) return res.data.results;
  if (Array.isArray(raw?.items)) return raw.items;
  if (Array.isArray(raw)) return raw;
  return [];
};

const BannerLinkPicker = ({ tree = [], linkType = "none", linkValue = "", onChange }) => {
  const type = linkType || "none";
  const headers = Array.isArray(tree) ? tree : [];
  const categories = useMemo(
    () => headers.flatMap((h) => (h.children || []).map((c) => ({ ...c, headerName: h.name }))),
    [headers],
  );

  const [subParentId, setSubParentId] = useState(() =>
    type === "subcategory" && linkValue.includes("/") ? linkValue.split("/")[0] : "",
  );
  useEffect(() => {
    if (type === "subcategory" && linkValue.includes("/")) setSubParentId(linkValue.split("/")[0]);
  }, [type, linkValue]);

  const [productQuery, setProductQuery] = useState("");
  const [productResults, setProductResults] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [searching, setSearching] = useState(false);

  // Resolve the saved product's name so the admin sees what is linked.
  useEffect(() => {
    if (type !== "product" || !linkValue) {
      setSelectedProduct(null);
      return;
    }
    if (selectedProduct?._id === linkValue) return;
    let cancelled = false;
    adminApi
      .getProduct?.(linkValue)
      ?.then((res) => {
        const p = res?.data?.result || res?.data?.data || res?.data;
        if (!cancelled && p?._id) setSelectedProduct(p);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, linkValue]);

  useEffect(() => {
    if (type !== "product") return;
    const q = productQuery.trim();
    if (q.length < 2) {
      setProductResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await adminApi.getProducts({ search: q, limit: 20 });
        if (!cancelled) setProductResults(extractProducts(res));
      } catch {
        if (!cancelled) setProductResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [type, productQuery]);

  const set = (patch) => onChange?.({ linkType: type, linkValue, ...patch });

  const subParent = categories.find((c) => c._id === subParentId);
  const subOptions = subParent?.children || [];

  let summary = "";
  if (type === "header") summary = headers.find((h) => h._id === linkValue)?.name;
  if (type === "category") summary = categories.find((c) => c._id === linkValue)?.name;
  if (type === "subcategory" && linkValue.includes("/")) {
    const subId = linkValue.split("/")[1];
    const sub = subOptions.find((s) => s._id === subId);
    if (sub) summary = `${subParent.name} › ${sub.name}`;
  }
  if (type === "product") summary = selectedProduct?.name;
  if (type === "url") summary = linkValue;

  return (
    <div className="space-y-2 rounded-xl border border-dashed border-slate-200 p-2.5" data-testid="banner-link-picker">
      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">
        When a shopper taps this banner
      </label>
      <select
        value={type}
        onChange={(e) => onChange?.({ linkType: e.target.value, linkValue: "" })}
        className={inputCls}
        aria-label="Banner link type"
      >
        {LINK_TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>

      {type === "header" && (
        <select value={linkValue} onChange={(e) => set({ linkValue: e.target.value })} className={inputCls} aria-label="Header">
          <option value="">Select a header…</option>
          {headers.map((h) => (
            <option key={h._id} value={h._id}>
              {h.name}
            </option>
          ))}
        </select>
      )}

      {type === "category" && (
        <select value={linkValue} onChange={(e) => set({ linkValue: e.target.value })} className={inputCls} aria-label="Category">
          <option value="">Select a category…</option>
          {headers.map((h) => (
            <optgroup key={h._id} label={h.name}>
              {(h.children || []).map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      )}

      {type === "subcategory" && (
        <div className="grid grid-cols-2 gap-2">
          <select
            value={subParentId}
            onChange={(e) => {
              setSubParentId(e.target.value);
              set({ linkValue: "" });
            }}
            className={inputCls}
            aria-label="Parent category"
          >
            <option value="">1. Pick category…</option>
            {headers.map((h) => (
              <optgroup key={h._id} label={h.name}>
                {(h.children || []).map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <select
            value={linkValue.includes("/") ? linkValue.split("/")[1] : ""}
            onChange={(e) => set({ linkValue: e.target.value ? `${subParentId}/${e.target.value}` : "" })}
            className={inputCls}
            disabled={!subParentId}
            aria-label="Subcategory"
          >
            <option value="">{subParentId ? "2. Pick subcategory…" : "Pick a category first"}</option>
            {subOptions.map((s) => (
              <option key={s._id} value={s._id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {type === "product" && (
        <div className="space-y-1">
          <input
            value={productQuery}
            onChange={(e) => setProductQuery(e.target.value)}
            className={inputCls}
            placeholder="Search product by name (min 2 letters)…"
            aria-label="Search product"
          />
          {searching && <p className="text-[10px] text-slate-400">Searching…</p>}
          {productResults.length > 0 && (
            <div className="max-h-40 overflow-y-auto rounded-xl border border-slate-200 bg-white">
              {productResults.map((p) => (
                <button
                  type="button"
                  key={p._id}
                  onClick={() => {
                    setSelectedProduct(p);
                    setProductQuery("");
                    setProductResults([]);
                    set({ linkValue: p._id });
                  }}
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-slate-50"
                >
                  {p.mainImage && <img src={p.mainImage} alt="" className="h-6 w-6 rounded object-cover" />}
                  <span className="font-bold text-slate-700 truncate">{p.name}</span>
                </button>
              ))}
            </div>
          )}
          {!searching && productQuery.trim().length >= 2 && productResults.length === 0 && (
            <p className="text-[10px] text-slate-400">No products found.</p>
          )}
        </div>
      )}

      {type === "url" && (
        <input
          value={linkValue}
          onChange={(e) => set({ linkValue: e.target.value })}
          className={inputCls}
          placeholder="https://example.com/sale"
          aria-label="Website link"
        />
      )}

      {type !== "none" && (
        <p className={`text-[10px] font-bold ${summary ? "text-emerald-600" : "text-amber-600"}`}>
          {summary ? `✓ Opens: ${summary}` : "Choose where this banner should go."}
        </p>
      )}
    </div>
  );
};

export const isBannerLinkComplete = (item) => {
  const type = item?.linkType || "none";
  if (type === "none") return true;
  const v = String(item?.linkValue || "").trim();
  if (!v) return false;
  if (type === "url") return /^https?:\/\/\S+\.\S+/i.test(v);
  if (type === "subcategory") return /^[^/]+\/[^/]+$/.test(v);
  return true;
};

export default BannerLinkPicker;
