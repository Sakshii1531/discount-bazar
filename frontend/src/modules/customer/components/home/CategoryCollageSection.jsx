import React, { useEffect, useMemo, useState } from "react";
import { customerApi } from "../../services/customerApi";
import { useLocation as useAppLocation } from "../../context/LocationContext";
import { applyCloudinaryTransform } from "@/core/utils/imageUtils";

// Categories probed for products (one request each), and cards shown.
const MAX_CANDIDATES = 12;
const MAX_CARDS = 6;
const PREVIEW_COUNT = 4;

const productsFromResponse = (res) => {
  const result = res?.data?.result;
  if (Array.isArray(res?.data?.results)) return res.data.results;
  if (Array.isArray(result?.items)) return result.items;
  return Array.isArray(result) ? result : [];
};

/**
 * Category cards showing a 2×2 collage of products actually available near
 * the customer, with a "+N more" count. Categories with nothing nearby are
 * skipped, so every card leads somewhere useful.
 */
const CategoryCollageSection = ({ title, categories, onCategoryClick }) => {
  const { currentLocation } = useAppLocation();
  const lat = currentLocation?.latitude;
  const lng = currentLocation?.longitude;
  const hasLocation = Number.isFinite(lat) && Number.isFinite(lng);

  const candidates = useMemo(() => (categories || []).slice(0, MAX_CANDIDATES), [categories]);
  const candidatesKey = candidates.map((c) => c.id).join(",");

  const [previews, setPreviews] = useState({});
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    if (!hasLocation || !candidates.length) {
      setPreviews({});
      setStatus("ready");
      return undefined;
    }
    let cancelled = false;
    setStatus("loading");
    Promise.all(
      candidates.map((cat) =>
        customerApi
          .getProducts({ categoryId: cat.id, lat, lng, limit: PREVIEW_COUNT })
          .then((res) => {
            const items = productsFromResponse(res);
            const images = items.map((p) => p.mainImage || p.image).filter(Boolean).slice(0, PREVIEW_COUNT);
            const total = Number(res?.data?.result?.total) || items.length;
            return [cat.id, { images, total }];
          })
          .catch(() => [cat.id, null]),
      ),
    ).then((entries) => {
      if (cancelled) return;
      setPreviews(Object.fromEntries(entries.filter(([, preview]) => preview)));
      setStatus("ready");
    });
    return () => {
      cancelled = true;
    };
    // candidatesKey stands in for `candidates` so a new array with the same ids doesn't refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidatesKey, lat, lng, hasLocation]);

  const cards = candidates.filter((cat) => previews[cat.id]?.total > 0).slice(0, MAX_CARDS);

  if (status === "ready" && !cards.length) return null;

  return (
    <section className="bg-white px-4 pt-4 pb-5 mb-3 md:px-8 lg:px-[50px]">
      {title && <h2 className="mb-3 text-lg md:text-2xl font-black text-[#1A1A1A]">{title}</h2>}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2.5 md:gap-4">
        {status === "loading"
          ? Array.from({ length: Math.min(MAX_CARDS, candidates.length) }, (_, i) => (
              <div key={i} className="rounded-2xl bg-[var(--brand-100)] p-1.5 animate-pulse">
                <div className="aspect-square rounded-xl bg-white/70" />
                <div className="mx-auto mt-3 mb-1 h-3.5 w-3/4 rounded bg-white/70" />
              </div>
            ))
          : cards.map((cat) => {
              const { images, total } = previews[cat.id];
              const more = total - images.length;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => onCategoryClick(cat.id)}
                  className="group flex flex-col rounded-2xl bg-[var(--brand-100)] p-1.5 text-center transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                  <div className="relative">
                    <div className="grid grid-cols-2 gap-1">
                      {Array.from({ length: PREVIEW_COUNT }, (_, i) => (
                        <div key={i} className="flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-white p-0.5">
                          {images[i] && (
                            <img
                              src={applyCloudinaryTransform(images[i], "f_auto,q_auto,w_150")}
                              alt=""
                              loading="lazy"
                              className="h-full w-full object-contain"
                            />
                          )}
                        </div>
                      ))}
                    </div>
                    {more > 0 && (
                      <span className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 whitespace-nowrap rounded-full border border-slate-100 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600 shadow-sm">
                        +{more} more
                      </span>
                    )}
                  </div>
                  <span className="flex flex-1 items-center justify-center px-0.5 pt-3.5 pb-1 text-[13px] md:text-[14px] font-bold leading-tight text-slate-800 break-words [overflow-wrap:anywhere] group-hover:text-primary">
                    {cat.name}
                  </span>
                </button>
              );
            })}
      </div>
    </section>
  );
};

export default React.memo(CategoryCollageSection);
