import React, { useState } from "react";
import { Link } from "react-router-dom";
import { applyCloudinaryTransform } from "@/core/utils/imageUtils";
import { CATEGORY_TILE_TINTS } from "../../constants/homeConstants";

/** Grid for CategoryTile: 4 per row on phones (3 on very narrow ones), wider on tablet/desktop. */
export const CATEGORY_TILE_GRID = "grid grid-cols-3 min-[360px]:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-x-3 gap-y-4 md:gap-x-4 md:gap-y-5";

export const categoryTileTint = (index) => CATEGORY_TILE_TINTS[index % CATEGORY_TILE_TINTS.length];

/**
 * Square, softly tinted category image with the full name underneath.
 * Renders a router Link when `to` is given, otherwise a button.
 */
const CategoryTile = ({ name, image, tint, to, onClick }) => {
  const [imageFailed, setImageFailed] = useState(false);
  const className = "group flex w-full flex-col items-center gap-1.5 text-center focus-visible:outline-none";

  const content = (
    <>
      <div
        className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-2xl p-1.5 transition-transform duration-200 group-hover:-translate-y-0.5 group-active:scale-95 group-focus-visible:ring-2 group-focus-visible:ring-primary"
        style={{ backgroundColor: tint }}>
        {image && !imageFailed ? (
          <img
            src={applyCloudinaryTransform(image)}
            alt=""
            loading="lazy"
            onError={() => setImageFailed(true)}
            className="h-full w-full object-contain mix-blend-multiply"
          />
        ) : (
          <span className="text-2xl font-black text-slate-400">
            {String(name || "?").trim().charAt(0).toUpperCase()}
          </span>
        )}
      </div>
      <span className="w-full break-words text-[13px] font-semibold leading-tight text-slate-800 [overflow-wrap:anywhere] group-hover:text-primary md:text-[14px]">
        {name}
      </span>
    </>
  );

  if (to) {
    return (
      <Link to={to} onClick={onClick} className={className}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={className}>
      {content}
    </button>
  );
};

export default CategoryTile;
