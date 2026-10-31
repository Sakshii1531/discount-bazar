import React from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import BrandAvatar from "../shared/BrandAvatar";
import { brandPath } from "../../utils/catalogLinks";

/**
 * "Shop by Brand" section from Experience Studio. The server sends ready-made
 * cards (`section.brands`: active brands, in the admin's order, already
 * limited to brands with in-stock products near the customer and to
 * `maxItems`). Tapping a card opens that brand's in-stock listing.
 */
const BrandShowcaseSection = ({ section, onNavigate }) => {
  const navigate = useNavigate();
  const brands = Array.isArray(section.brands) ? section.brands : [];
  if (!brands.length) return null;

  const cfg = section.config?.brands || {};
  const isGrid = cfg.layout === "grid";
  const rows = Math.max(1, Number(cfg.rows) || 1);
  // Grid shows `rows` rows of 4; the carousel scrolls through everything sent.
  const visible = isGrid ? brands.slice(0, rows * 4) : brands;

  const open = (brand) => {
    onNavigate?.();
    navigate(`${brandPath(brand.name)}?instock=1`);
  };

  return (
    <div id={`section-${section._id}`} className="-mx-2 md:-mx-4 lg:-mx-6 px-2 md:px-4 lg:px-6">
      {section.title && (
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-base font-black text-[#1A1A1A]">{section.title}</h3>
          <span className="text-[13px] font-semibold text-slate-400">
            {visible.length} {visible.length === 1 ? "brand" : "brands"}
          </span>
        </div>
      )}
      <div
        className={cn(
          isGrid
            ? "grid grid-cols-4 gap-3 rounded-3xl border border-slate-100 bg-white px-3.5 py-3 shadow-[0_18px_45px_rgba(15,23,42,0.06)]"
            : "-mx-2 flex snap-x gap-3 overflow-x-auto px-2 pb-1 no-scrollbar",
        )}
        data-testid="brand-showcase"
      >
        {visible.map((brand) => (
          <button
            key={brand._id}
            type="button"
            onClick={() => open(brand)}
            aria-label={`Shop ${brand.name}`}
            className={cn(
              "group flex flex-col items-center gap-1.5 focus:outline-none",
              !isGrid && "w-[76px] shrink-0 snap-start",
            )}
          >
            <BrandAvatar
              name={brand.name}
              logo={brand.logo}
              className="aspect-square h-auto w-full rounded-full border-slate-100 bg-white p-1.5 text-xl shadow-sm transition-all duration-200 group-hover:border-primary/40 group-hover:shadow-md"
            />
            <span className="line-clamp-2 text-center text-[13px] font-semibold leading-snug text-slate-700 group-hover:text-primary">
              {brand.name}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default BrandShowcaseSection;
