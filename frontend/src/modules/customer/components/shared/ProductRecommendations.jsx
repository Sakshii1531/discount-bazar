import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import ProductCard from "./ProductCard";
import BrandAvatar from "./BrandAvatar";
import { customerApi } from "../../services/customerApi";
import { useLocation as useAppLocation } from "../../context/LocationContext";
import { toCardProduct } from "../../utils/productPricing";
import { brandPath } from "../../utils/catalogLinks";

const EMPTY = {
  similar: { items: [] },
  topInCategory: { basis: "none", scope: null, items: [] },
  brandsInCategory: { scope: null, items: [] },
  alsoBought: { source: "none", items: [] },
  errors: [],
};

const SectionTitle = ({ children }) => (
  <h3 className="text-[15px] sm:text-base font-black text-slate-900 tracking-tight mb-3 px-0.5">{children}</h3>
);

const ProductRow = ({ title, items, onProductClick }) => {
  if (!items.length) return null;
  return (
    <section>
      <SectionTitle>{title}</SectionTitle>
      <div className="flex gap-2.5 sm:gap-3 overflow-x-auto no-scrollbar pb-2 -mx-1 px-1 snap-x">
        {items.map((product) => (
          <div key={product.id} className="w-[132px] sm:w-[156px] flex-shrink-0 snap-start">
            <ProductCard product={product} compact neutralBg onProductClick={onProductClick} />
          </div>
        ))}
      </div>
    </section>
  );
};

const RowSkeleton = () => (
  <div aria-hidden="true">
    <div className="h-4 w-40 bg-slate-100 rounded mb-3 animate-pulse" />
    <div className="flex gap-3 overflow-hidden">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="w-[132px] sm:w-[156px] h-[210px] flex-shrink-0 rounded-xl bg-slate-100 animate-pulse" />
      ))}
    </div>
  </div>
);

/**
 * "Similar products", "Top products in this category", "Brands in this
 * category" and "People also bought" for one product. Sections with nothing
 * to show are hidden; a failed request does not affect the rest of the page.
 */
const ProductRecommendations = ({ productId, onProductClick, onBrandClick, className }) => {
  const navigate = useNavigate();
  const { currentLocation } = useAppLocation();
  const [data, setData] = useState(EMPTY);
  const [status, setStatus] = useState("idle"); // idle | loading | ready | error
  const requestRef = useRef(0);

  const lat = currentLocation?.latitude;
  const lng = currentLocation?.longitude;

  const load = useCallback(async () => {
    if (!productId || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      setData(EMPTY);
      setStatus("idle");
      return;
    }
    // Ignore answers for a product the customer has already navigated away from.
    const requestId = ++requestRef.current;
    setStatus("loading");
    try {
      const res = await customerApi.getProductRecommendations(productId, { lat, lng });
      if (requestId !== requestRef.current) return;
      const result = res?.data?.result;
      if (!res?.data?.success || !result) throw new Error("Invalid recommendations response");
      setData({ ...EMPTY, ...result });
      setStatus("ready");
    } catch {
      if (requestId !== requestRef.current) return;
      setData(EMPTY);
      setStatus("error");
    }
  }, [productId, lat, lng]);

  useEffect(() => {
    load();
  }, [load]);

  const sections = useMemo(() => {
    const cards = (list) => (Array.isArray(list) ? list : []).map(toCardProduct);
    const top = data.topInCategory || EMPTY.topInCategory;
    const scopeName = top.scope?.name;
    const alsoBought = data.alsoBought || EMPTY.alsoBought;
    const brands = data.brandsInCategory || EMPTY.brandsInCategory;
    return {
      similar: cards(data.similar?.items),
      top: cards(top.items),
      // Sales-ranked lists are "top products"; without sales data they are
      // only "more from" the category — never presented as best sellers.
      topTitle:
        top.basis === "sales"
          ? `Top products in ${scopeName || "this category"}`
          : `More in ${scopeName || "this category"}`,
      brands: Array.isArray(brands.items) ? brands.items : [],
      brandsTitle: `Brands in ${brands.scope?.name || "this category"}`,
      alsoBought: cards(alsoBought.items),
      // Only verified co-purchases are called "People also bought".
      alsoBoughtTitle: alsoBought.source === "co_purchase" ? "People also bought" : "You might also like",
    };
  }, [data]);

  const openBrand = (name) => {
    if (onBrandClick) onBrandClick(name);
    else navigate(brandPath(name));
  };

  if (status === "idle") return null;

  if (status === "loading") {
    return (
      <div className={cn("space-y-6", className)}>
        <RowSkeleton />
        <RowSkeleton />
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className={cn("flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3", className)}>
        <p className="text-xs font-bold text-slate-500">Couldn't load more products right now.</p>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-1.5 text-xs font-black text-primary hover:underline">
          <RefreshCw size={13} /> Retry
        </button>
      </div>
    );
  }

  const hasAnything =
    sections.similar.length || sections.top.length || sections.brands.length || sections.alsoBought.length;
  if (!hasAnything) return null;

  return (
    <div className={cn("space-y-7", className)} data-testid="product-recommendations">
      <ProductRow title="Similar products" items={sections.similar} onProductClick={onProductClick} />
      <ProductRow title={sections.topTitle} items={sections.top} onProductClick={onProductClick} />

      {sections.brands.length > 0 && (
        <section>
          <SectionTitle>{sections.brandsTitle}</SectionTitle>
          <div className="flex gap-2.5 overflow-x-auto no-scrollbar pb-2 -mx-1 px-1">
            {sections.brands.map((brand) => (
              <button
                key={brand.name}
                type="button"
                onClick={() => openBrand(brand.name)}
                className="group w-[88px] sm:w-[100px] flex-shrink-0 flex flex-col items-center gap-1.5 rounded-2xl border border-slate-200 bg-white p-2.5 hover:border-primary/40 hover:shadow-sm transition-all">
                <BrandAvatar name={brand.name} className="h-12 w-12 text-lg" />
                <span className="w-full text-[11px] font-bold text-slate-700 text-center leading-tight line-clamp-2 break-words">
                  {brand.name}
                </span>
                <span className="text-[9px] font-semibold text-slate-400 flex items-center">
                  {brand.productCount} {brand.productCount === 1 ? "item" : "items"}
                  <ChevronRight size={10} />
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      <ProductRow title={sections.alsoBoughtTitle} items={sections.alsoBought} onProductClick={onProductClick} />
    </div>
  );
};

export default ProductRecommendations;
