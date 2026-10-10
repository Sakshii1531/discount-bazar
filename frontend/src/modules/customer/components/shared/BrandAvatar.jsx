import React from "react";
import { cn } from "@/lib/utils";

// Products store their brand as a name only (no brand logo exists in the
// catalogue), so brands are shown as a lettered tile.
const BrandAvatar = ({ name, className }) => {
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
