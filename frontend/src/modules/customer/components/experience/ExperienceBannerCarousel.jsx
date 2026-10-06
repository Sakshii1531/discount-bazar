import React from "react";
import { cn } from "@/lib/utils";
import { motion, useMotionValue } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  applyCloudinaryTransform,
  buildCloudinarySrcSet,
  isCloudinaryUrl,
} from "@/core/utils/imageUtils";

import { isMobileOrWebView } from "@/core/utils/deviceUtils";

const BANNER_CHUNK_SIZE = 20;

/** Where a banner should take the shopper, or null when it is not clickable. */
export const resolveBannerTarget = (banner) => {
  const type = banner?.linkType || "none";
  const value = String(banner?.linkValue || "").trim();
  if (type === "none" || !value) return null;
  switch (type) {
    case "category":
      return { path: `/category/${value}` };
    case "subcategory": {
      const [categoryId, subcategoryId] = value.split("/");
      if (!subcategoryId) return { path: `/category/${categoryId}` };
      return { path: `/category/${categoryId}`, state: { activeSubcategoryId: subcategoryId } };
    }
    case "product":
      return { path: `/product/${value}` };
    case "header":
      return { path: "/", state: { activeHeaderId: value } };
    case "url":
      return /^https?:\/\//i.test(value) ? { external: value } : null;
    default:
      return null;
  }
};

const BannerCaption = ({ title, subtitle, fullWidth }) => {
  if (!title && !subtitle) return null;
  return (
    <div
      className={cn(
        "absolute inset-x-0 bottom-0 pointer-events-none bg-gradient-to-t from-black/70 via-black/30 to-transparent text-left",
        fullWidth ? "px-4 pb-4 pt-10 sm:px-8 sm:pb-6" : "px-4 pb-3 pt-10"
      )}
      data-testid="banner-caption"
    >
      {title && (
        <p className="text-white font-black text-base sm:text-xl leading-tight line-clamp-2 drop-shadow">{title}</p>
      )}
      {subtitle && (
        <p className="text-white/90 font-semibold text-xs sm:text-sm mt-0.5 line-clamp-2 drop-shadow">{subtitle}</p>
      )}
    </div>
  );
};

const ExperienceBannerCarousel = ({ section, items: rawItems, fullWidth = false, slideGap = 0, edgeToEdge = false }) => {
  const items = Array.isArray(rawItems) ? rawItems : [];

  const [activeIndex, setActiveIndex] = React.useState(0);
  const [visibleCount, setVisibleCount] = React.useState(() =>
    Math.min(items.length, BANNER_CHUNK_SIZE)
  );
  const visibleItems = items.slice(0, visibleCount);
  const totalItems = visibleItems.length;
  const x = useMotionValue(0);
  const containerRef = React.useRef(null);
  const hasMore = visibleCount < items.length;
  const navigate = useNavigate();
  const draggedRef = React.useRef(false);

  const openBanner = (banner) => {
    if (draggedRef.current) return; // a swipe, not a tap
    const target = resolveBannerTarget(banner);
    if (!target) return;
    if (target.external) {
      window.open(target.external, "_blank", "noopener,noreferrer");
      return;
    }
    navigate(target.path, target.state ? { state: target.state } : undefined);
  };

  const loadMore = React.useCallback(() => {
    setVisibleCount((prev) => Math.min(items.length, prev + BANNER_CHUNK_SIZE));
  }, [items.length]);

  React.useEffect(() => {
    setVisibleCount(Math.min(items.length, BANNER_CHUNK_SIZE));
    setActiveIndex(0);
  }, [items.length]);

  // Auto-play logic
  React.useEffect(() => {
    if (totalItems <= 1) return;

    const intervalId = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % totalItems);
    }, 4500);

    return () => clearInterval(intervalId);
  }, [totalItems]);

  React.useEffect(() => {
    if (!hasMore) return;
    if (activeIndex >= totalItems - 2) {
      loadMore();
    }
  }, [activeIndex, totalItems, hasMore, loadMore]);

  const handleDragEnd = (_, info) => {
    // Keep the flag up until after the click that follows pointer-up.
    setTimeout(() => {
      draggedRef.current = false;
    }, 0);
    const threshold = 50;
    if (info.offset.x < -threshold) {
      // Swipe left -> Next
      setActiveIndex((prev) => Math.min(prev + 1, totalItems - 1));
    } else if (info.offset.x > threshold) {
      // Swipe right -> Prev
      setActiveIndex((prev) => Math.max(prev - 1, 0));
    }
  };

  const getBannerOptimizedSrc = React.useCallback((url) => {
    if (!url) return url;
    if (!isCloudinaryUrl(url)) return url;
    return applyCloudinaryTransform(url, "f_auto,q_auto,c_scale,w_824");
  }, []);

  if (!items.length) return null;

  return (
    <div className={cn("overflow-hidden touch-pan-y", fullWidth && "w-screen relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw]")}>
      <motion.div
        ref={containerRef}
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.2}
        onDragStart={() => {
          draggedRef.current = true;
        }}
        onDragEnd={handleDragEnd}
        animate={{ x: `-${(activeIndex / totalItems) * 100}%` }}
        transition={isMobileOrWebView() ? { type: "tween", ease: "easeInOut", duration: 0.3 } : { type: "spring", stiffness: 300, damping: 30 }}
        className="flex"
        style={{ width: `${totalItems * 100}%` }}
      >
        {visibleItems.map((banner, idx) => {
          const clickable = Boolean(resolveBannerTarget(banner));
          const label = banner.title || section?.title || "Banner";
          return (
          <div
            key={idx}
            className={cn(
              "relative shrink-0 overflow-hidden flex items-center justify-center box-border",
              fullWidth ? "bg-slate-100 rounded-none px-0" : "px-0 py-1",
              clickable && "cursor-pointer"
            )}
            style={{ width: `${100 / totalItems}%` }}
            onClick={clickable ? () => openBanner(banner) : undefined}
            onKeyDown={
              clickable
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openBanner(banner);
                    }
                  }
                : undefined
            }
            role={clickable ? "link" : undefined}
            tabIndex={clickable ? 0 : undefined}
            aria-label={clickable ? label : undefined}
            data-testid="experience-banner"
          >
            {fullWidth ? (
              <img
                src={getBannerOptimizedSrc(banner.imageUrl)}
                srcSet={
                  isCloudinaryUrl(banner.imageUrl)
                    ? buildCloudinarySrcSet(
                        banner.imageUrl,
                        [{ w: 412 }, { w: 824 }, { w: 1248 }],
                        "f_auto,q_auto,c_scale"
                      )
                    : undefined
                }
                sizes="100vw"
                alt={banner.title || section?.title || "Banner"}
                className="w-full h-auto object-contain object-top pointer-events-none"
                loading={idx === 0 ? "eager" : "lazy"}
                fetchPriority={idx === 0 ? "high" : "low"}
                decoding="async"
              />
            ) : (
              <div className="relative w-full overflow-hidden rounded-2xl sm:rounded-3xl bg-slate-50 shadow-md">
                <img
                  src={getBannerOptimizedSrc(banner.imageUrl)}
                  srcSet={
                    isCloudinaryUrl(banner.imageUrl)
                      ? buildCloudinarySrcSet(
                          banner.imageUrl,
                          [{ w: 560 }, { w: 1120 }],
                          "f_auto,q_auto,c_scale"
                        )
                      : undefined
                  }
                  sizes="100vw"
                  alt={banner.title || section?.title || "Banner"}
                  className="w-full h-auto max-h-[480px] object-contain object-top rounded-2xl sm:rounded-3xl pointer-events-none"
                  loading={idx === 0 ? "eager" : "lazy"}
                  fetchPriority={idx === 0 ? "high" : "low"}
                  decoding="async"
                />
                <BannerCaption title={banner.title} subtitle={banner.subtitle} />
              </div>
            )}
            {fullWidth && <BannerCaption title={banner.title} subtitle={banner.subtitle} fullWidth />}
          </div>
          );
        })}
      </motion.div>
    </div>
  );
};

export default ExperienceBannerCarousel;
