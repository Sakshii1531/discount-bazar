import React, { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { loadBrandLogoMap, brandNameKey } from "@shared/utils/brands";

// Kept after the first load so avatars mounted later render the logo
// immediately instead of flashing the letter tile.
let resolvedLogoMap = null;

// Share of the circle's diameter the image's diagonal may span (the rest is breathing room).
const CIRCLE_FIT_PERCENT = 96;

// Largest box of this aspect ratio whose corners stay inside the circle.
const circleFitStyle = (ratio) => {
  const diagonal = Math.hypot(ratio, 1);
  return {
    width: `${(ratio / diagonal) * CIRCLE_FIT_PERCENT}%`,
    height: `${CIRCLE_FIT_PERCENT / diagonal}%`,
  };
};

/**
 * Brand logo uploaded by the admin, looked up by brand name (products store
 * the official brand name). Pass `logo` to skip the lookup. Falls back to a
 * lettered tile when the brand has no logo or the image fails to load.
 * Pass `circular` for a round frame: the image is sized so it is never cropped.
 */
const BrandAvatar = ({ name, logo, className, circular = false }) => {
  const key = brandNameKey(name);
  const [logoUrl, setLogoUrl] = useState(() => logo || resolvedLogoMap?.get(key) || "");
  const [failed, setFailed] = useState(false);
  const [imageRatio, setImageRatio] = useState(1);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- new logo source: retry loading it
    setFailed(false);
    if (logo) {
      setLogoUrl(logo);
      return undefined;
    }
    if (resolvedLogoMap) {
      setLogoUrl(resolvedLogoMap.get(key) || "");
      return undefined;
    }
    let cancelled = false;
    loadBrandLogoMap().then((map) => {
      resolvedLogoMap = map;
      if (!cancelled) setLogoUrl(map.get(key) || "");
    });
    return () => {
      cancelled = true;
    };
  }, [key, logo]);

  if (logoUrl && !failed) {
    return (
      <div
        className={cn(
          "flex items-center justify-center overflow-hidden rounded-xl bg-white border border-slate-200 select-none",
          circular && "relative",
          className,
        )}>
        <img
          src={logoUrl}
          alt={name ? `${name} logo` : "Brand logo"}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          onLoad={(e) => {
            const { naturalWidth, naturalHeight } = e.currentTarget;
            if (circular && naturalWidth && naturalHeight) setImageRatio(naturalWidth / naturalHeight);
          }}
          style={circular ? circleFitStyle(imageRatio) : undefined}
          className={
            circular
              ? "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 object-contain"
              : "h-full w-full object-contain p-0.5"
          }
        />
      </div>
    );
  }

  const initial = String(name || "").trim().charAt(0).toUpperCase() || "?";
  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex items-center justify-center rounded-xl bg-brand-50 border border-brand-100 text-primary font-black select-none",
        className,
      )}>
      {initial}
    </div>
  );
};

export default BrandAvatar;
