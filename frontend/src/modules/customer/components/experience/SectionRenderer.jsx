import React from "react";
import { useNavigate } from "react-router-dom";
import ProductCard from "../shared/ProductCard";
import CategoryTile, { CATEGORY_TILE_GRID, categoryTileTint } from "../shared/CategoryTile";
import { cn } from "@/lib/utils";
import ExperienceBannerCarousel from "./ExperienceBannerCarousel";
import BrandShowcaseSection from "./BrandShowcaseSection";
import { setJSON, STORAGE_KEYS } from "@core/utils/storage";

const rememberExperienceReturn = (headerId, sectionId) =>
  setJSON(
    STORAGE_KEYS.EXPERIENCE_RETURN,
    { headerId: headerId || null, sectionId: sectionId || null },
    { storage: "session" },
  );

const LAZY_CHUNK_SIZE = 20;
const LAZY_ROOT_MARGIN = "260px 0px";

const LazyLoadTrigger = ({ enabled, onVisible }) => {
  const ref = React.useRef(null);

  React.useEffect(() => {
    if (!enabled) return undefined;
    const node = ref.current;
    if (!node) return undefined;

    if (typeof IntersectionObserver === "undefined") {
      onVisible();
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) onVisible();
        });
      },
      { root: null, rootMargin: LAZY_ROOT_MARGIN, threshold: 0.01 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled, onVisible]);

  return <div ref={ref} className="h-2 w-full" aria-hidden="true" />;
};

const SectionRenderer = ({ sections = [], productsById = {}, categoriesById = {}, subcategoriesById = {} }) => {
  const navigate = useNavigate();
  const [sectionVisibleCounts, setSectionVisibleCounts] = React.useState({});

  const loadMoreForSection = React.useCallback((sectionKey, totalCount) => {
    if (!sectionKey || totalCount <= 0) return;
    setSectionVisibleCounts((prev) => {
      const current = prev[sectionKey] ?? LAZY_CHUNK_SIZE;
      if (current >= totalCount) return prev;
      return {
        ...prev,
        [sectionKey]: Math.min(totalCount, current + LAZY_CHUNK_SIZE),
      };
    });
  }, []);

  const resolveVisibleCount = React.useCallback(
    (sectionKey, totalCount) => {
      const current = sectionVisibleCounts[sectionKey] ?? LAZY_CHUNK_SIZE;
      return Math.min(totalCount, current);
    },
    [sectionVisibleCounts]
  );

  return (
    <div className="space-y-8">
      {sections.map((section, sectionIndex) => {
        const sectionKey = String(
          section?._id || section?.id || `${section?.displayType || "section"}-${sectionIndex}`
        );
        const heading = section.title;

        if (section.displayType === "banners") {
          const items = section.config?.banners?.items || [];
          if (!items.length) return null;
          return (
            <div key={section._id || sectionKey} className="-mt-8 md:-mt-8">
              <ExperienceBannerCarousel section={section} items={items} slideGap={12} />
            </div>
          );
        }

        if (section.displayType === "brands") {
          return (
            <BrandShowcaseSection
              key={section._id || sectionKey}
              section={section}
              onNavigate={() => rememberExperienceReturn(section.headerId, section._id)}
            />
          );
        }

        if (section.displayType === "categories") {
          const ids = section.config?.categories?.categoryIds || [];
          const rows = section.config?.categories?.rows || 1;
          const visibleCount = rows * 4;
          const allItems = ids
            .map((id) => categoriesById[id])
            .filter(Boolean)
            .slice(0, visibleCount);
          const visibleItems = allItems.slice(
            0,
            resolveVisibleCount(sectionKey, allItems.length)
          );
          const hasMore = visibleItems.length < allItems.length;

          if (!visibleItems.length) return null;

          return (
            <div
              key={section._id || sectionKey}
              id={`section-${section._id}`}
              className="-mx-2 md:-mx-4 lg:-mx-6 px-2 md:px-4 lg:px-6"
            >
              {heading && (
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-black text-[#1A1A1A]">
                    {heading}
                  </h3>
                  <span className="text-[13px] font-semibold text-slate-400">
                    {allItems.length} categories
                  </span>
                </div>
              )}
              <div className={CATEGORY_TILE_GRID}>
                {visibleItems.map((cat, idx) => (
                  <CategoryTile
                    key={cat._id}
                    name={cat.name}
                    image={cat.image}
                    tint={categoryTileTint(idx)}
                    onClick={() => {
                      // Remember the header & section so back navigation can restore context
                      rememberExperienceReturn(section.headerId, section._id);
                      navigate(`/category/${cat._id}`);
                    }}
                  />
                ))}
              </div>
              <LazyLoadTrigger
                enabled={hasMore}
                onVisible={() => loadMoreForSection(sectionKey, allItems.length)}
              />
            </div>
          );
        }

        if (section.displayType === "subcategories") {
          const ids = section.config?.subcategories?.subcategoryIds || [];
          const rows = section.config?.subcategories?.rows || 1;
          const visibleCount = rows * 4;
          const allItems = ids
            .map((id) => subcategoriesById[id])
            .filter(Boolean)
            .slice(0, visibleCount);
          const visibleItems = allItems.slice(
            0,
            resolveVisibleCount(sectionKey, allItems.length)
          );
          const hasMore = visibleItems.length < allItems.length;
          if (!visibleItems.length) return null;

          return (
            <div
              key={section._id || sectionKey}
              id={`section-${section._id}`}
              className="-mx-2 md:-mx-4 lg:-mx-6 px-2 md:px-4 lg:px-6"
            >
              {heading && (
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-black text-[#1A1A1A]">
                    {heading}
                  </h3>
                  <span className="text-[13px] font-semibold text-slate-400">
                    {allItems.length} picks
                  </span>
                </div>
              )}
              <div className={CATEGORY_TILE_GRID}>
                {visibleItems.map((cat, idx) => (
                  <CategoryTile
                    key={cat._id}
                    name={cat.name}
                    image={cat.image}
                    tint={categoryTileTint(idx)}
                    onClick={() => {
                      rememberExperienceReturn(section.headerId, section._id);
                      const parentId =
                        cat.parentId?._id ||
                        cat.parentId ||
                        cat.categoryId?._id ||
                        cat.categoryId ||
                        null;

                      if (parentId) {
                        navigate(`/category/${parentId}`, {
                          state: { activeSubcategoryId: cat._id },
                        });
                      } else {
                        // Fallback to previous behavior if we can't resolve parent
                        navigate(`/category/${cat._id}`);
                      }
                    }}
                  />
                ))}
              </div>
              <LazyLoadTrigger
                enabled={hasMore}
                onVisible={() => loadMoreForSection(sectionKey, allItems.length)}
              />
            </div>
          );
        }

        if (section.displayType === "products") {
          const productConfig = section.config?.products || {};
          const ids = productConfig.productIds || [];
          const rows = productConfig.rows || 1;
          const columns = productConfig.columns || 2;
          const singleRowScrollable = !!productConfig.singleRowScrollable;
          const hasManualProductSelection = ids.length > 0;

          let allProducts;

          if (Array.isArray(section.products)) {
            // Resolved server-side for the customer's location (see Home).
            allProducts = section.products;
          } else if (ids.length) {
            allProducts = ids.map((id) => productsById[id]).filter(Boolean);
          } else {
            const categoryFilter = productConfig.categoryIds || [];
            const subcategoryFilter = productConfig.subcategoryIds || [];
            const hasCategoryFilter = categoryFilter.length > 0;
            const hasSubcategoryFilter = subcategoryFilter.length > 0;

            const all = Object.values(productsById);
            allProducts = all.filter((p) => {
              const catId = p.categoryId?._id || p.categoryId;
              const subId = p.subcategoryId?._id || p.subcategoryId;

              const matchesCategory = hasCategoryFilter
                ? categoryFilter.includes(catId)
                : true;
              const matchesSubcategory = hasSubcategoryFilter
                ? subcategoryFilter.includes(subId)
                : true;

              return matchesCategory && matchesSubcategory;
            });
          }

          if (!allProducts.length) return null;

          if (singleRowScrollable) {
            const visibleCount = resolveVisibleCount(sectionKey, allProducts.length);
            const items = allProducts.slice(0, visibleCount);
            const hasMore = items.length < allProducts.length;

            return (
            <div
              key={section._id || sectionKey}
              id={`section-${section._id}`}
              className="-mx-4 md:-mx-8 lg:-mx-[50px] px-1 sm:px-2 md:px-3 mt-6 mb-2"
            >
                <div className="flex items-center justify-between mb-3 px-3 md:px-5">
                  {heading && (
                    <h3 className="text-base font-black text-[#1A1A1A]">
                      {heading}
                    </h3>
                  )}
                  <span className="text-[13px] font-semibold text-slate-400">
                    {allProducts.length} items
                  </span>
                </div>
                <div
                  className="relative z-10 flex overflow-x-auto gap-1.5 pb-1.5 no-scrollbar"
                  onScroll={(e) => {
                    if (!hasMore) return;
                    const node = e.currentTarget;
                    const distanceToEnd =
                      node.scrollWidth - node.scrollLeft - node.clientWidth;
                    if (distanceToEnd < 220) {
                      loadMoreForSection(sectionKey, allProducts.length);
                    }
                  }}
                >
                  {items.map((product) => (
                    <div
                      key={product._id || product.id}
                      className="w-[138px] sm:w-[150px] md:w-[168px] shrink-0"
                    >
                      <ProductCard product={product} compact={true} neutralBg={true} />
                    </div>
                  ))}
                </div>
                <LazyLoadTrigger
                  enabled={hasMore}
                  onVisible={() => loadMoreForSection(sectionKey, allProducts.length)}
                />
              </div>
            );
          }

          // If admin explicitly selected product IDs, render the full curated list.
          // Keep rows*columns cap only for dynamic filter-driven sections.
          const layoutCount = hasManualProductSelection
            ? allProducts.length
            : rows * columns;
          const cappedItems = allProducts.slice(0, layoutCount);
          const visibleCount = resolveVisibleCount(sectionKey, cappedItems.length);
          const items = cappedItems.slice(0, visibleCount);
          const hasMore = items.length < cappedItems.length;

          return (
            <div
              key={section._id || sectionKey}
              id={`section-${section._id}`}
              className="-mx-4 md:-mx-8 lg:-mx-[50px] px-1 sm:px-2 md:px-3 mt-6"
            >
              <div className="flex items-center justify-between mb-3 px-3 md:px-5">
                {heading && (
                  <h3 className="text-base font-black text-[#1A1A1A]">
                    {heading}
                  </h3>
                )}
                <span className="text-[13px] font-semibold text-slate-400">
                  {cappedItems.length} items
                </span>
              </div>
              <div
                className={cn(
                  "grid gap-1.5 sm:gap-2.5",
                  columns === 1
                    ? "grid-cols-1"
                    : columns === 2
                    ? "grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
                    : columns === 3
                    ? "grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
                    : "grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
                )}
              >
                {items.map((product) => (
                  <div key={product._id || product.id}>
                    <ProductCard product={product} compact={columns >= 2} neutralBg={true} />
                  </div>
                ))}
              </div>
              <LazyLoadTrigger
                enabled={hasMore}
                onVisible={() => loadMoreForSection(sectionKey, cappedItems.length)}
              />
            </div>
          );
        }

        return null;
      })}
    </div>
  );
};

export default SectionRenderer;

