import React, { useEffect, useRef } from "react";
import { MapPin, PackageSearch, RefreshCw, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import ProductCard from "./ProductCard";

// Sort keys supported by GET /products.
const CATALOG_SORT_OPTIONS = [
  { value: "newest", label: "Newest" },
  { value: "price-asc", label: "Price: Low to High" },
  { value: "price-desc", label: "Price: High to Low" },
  { value: "name-asc", label: "Name: A to Z" },
];

export const CatalogSortSelect = ({ value, onChange, className }) => (
  <label className={cn("relative inline-flex items-center", className)}>
    <span className="sr-only">Sort products</span>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 rounded-xl border border-slate-200 bg-white pl-3 pr-8 text-xs font-bold text-slate-700 outline-none focus:border-primary appearance-none cursor-pointer max-w-[160px]">
      {CATALOG_SORT_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
    <span className="pointer-events-none absolute right-3 text-[10px] text-slate-400">▼</span>
  </label>
);

const Message = ({ icon: Icon, title, text, action }) => (
  <div className="w-full py-16 px-6 flex flex-col items-center justify-center text-center">
    <div className="h-16 w-16 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center mb-4">
      <Icon className="h-7 w-7 text-slate-300" />
    </div>
    <h3 className="text-base font-black text-slate-800 mb-1">{title}</h3>
    {text && <p className="text-xs font-semibold text-slate-500 max-w-[280px] leading-relaxed">{text}</p>}
    {action}
  </div>
);

const RetryButton = ({ onClick, label = "Try again" }) => (
  <button
    type="button"
    onClick={onClick}
    className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-black uppercase tracking-wider hover:bg-slate-800 active:scale-95 transition-all">
    <RefreshCw size={14} /> {label}
  </button>
);

/**
 * Product grid for a useCatalogProducts listing, including every non-happy
 * state, plus infinite scrolling with a manual "Load more" fallback.
 */
const CatalogProductGrid = ({ listing, emptyTitle, emptyText, gridClassName }) => {
  const sentinelRef = useRef(null);
  const { items, status, areaUnavailable, errorMessage, hasMore, loadingMore, loadMore, retry } = listing;

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver(
      (entries) => entries.some((e) => e.isIntersecting) && loadMore(),
      { rootMargin: "400px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  const grid = cn(
    "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-x-2 gap-y-3 md:gap-4",
    gridClassName,
  );

  if (status === "loading") {
    return (
      <div className={grid} aria-busy="true">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-[230px] rounded-xl bg-slate-100 animate-pulse" />
        ))}
      </div>
    );
  }
  if (status === "no-location") {
    return (
      <Message
        icon={MapPin}
        title="Choose a delivery location"
        text="Set your delivery address from the location bar to see products available near you."
      />
    );
  }
  if (status === "error") {
    return <Message icon={PackageSearch} title="Something went wrong" text={errorMessage} action={<RetryButton onClick={retry} />} />;
  }
  if (areaUnavailable) {
    return (
      <Message
        icon={MapPin}
        title="Not available at your location"
        text="No store delivers these products to your current address yet. Try a different delivery location."
        action={<RetryButton onClick={retry} label="Refresh" />}
      />
    );
  }
  if (!items.length) {
    return <Message icon={PackageSearch} title={emptyTitle} text={emptyText} />;
  }

  return (
    <>
      <div className={grid}>
        {items.map((product) => (
          <ProductCard key={product.id} product={product} compact />
        ))}
      </div>
      {hasMore && (
        <div ref={sentinelRef} className="flex justify-center py-6">
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-slate-200 bg-white text-xs font-black text-slate-700 hover:border-primary/40 disabled:opacity-60">
            {loadingMore && <Loader2 size={14} className="animate-spin" />}
            {loadingMore ? "Loading" : "Load more"}
          </button>
        </div>
      )}
      {errorMessage && (
        <p className="text-center text-[11px] font-bold text-slate-400 py-4">{errorMessage}</p>
      )}
    </>
  );
};

export default CatalogProductGrid;
