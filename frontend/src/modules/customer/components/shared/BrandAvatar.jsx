import React, { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { loadBrandLogoMap, brandNameKey } from "@shared/utils/brands";

// Kept after the first load so avatars mounted later render the logo
// immediately instead of flashing the letter tile.
let resolvedLogoMap = null;

/**
 * Brand logo uploaded by the admin, looked up by brand name (products store
 * the official brand name). Pass `logo` to skip the lookup. Falls back to a
 * lettered tile when the brand has no logo or the image fails to load.
 */
const BrandAvatar = ({ name, logo, className }) => {
  const key = brandNameKey(name);
  const [logoUrl, setLogoUrl] = useState(() => logo || resolvedLogoMap?.get(key) || "");
  const [failed, setFailed] = useState(false);

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
          className,
        )}>
        <img
          src={logoUrl}
          alt={name ? `${name} logo` : "Brand logo"}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="h-full w-full object-contain p-0.5"
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
