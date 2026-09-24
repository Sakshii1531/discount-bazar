import React from "react";
import { cn } from "@/lib/utils";

const CategoryFilterBar = ({ categories, activeCategoryId, onSelect }) => {
    if (!categories.length) return null;

    return (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1 no-scrollbar">
            <button
                type="button"
                onClick={() => onSelect(null)}
                className={cn(
                    "shrink-0 px-3.5 py-1.5 rounded-full text-xs font-bold border transition-colors",
                    !activeCategoryId
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-white text-slate-600 border-slate-200 hover:border-primary/50",
                )}
            >
                All
            </button>
            {categories.map((cat) => (
                <button
                    key={cat.id}
                    type="button"
                    onClick={() => onSelect(cat.id)}
                    className={cn(
                        "shrink-0 px-3.5 py-1.5 rounded-full text-xs font-bold border transition-colors",
                        activeCategoryId === cat.id
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-white text-slate-600 border-slate-200 hover:border-primary/50",
                    )}
                >
                    {cat.name}
                </button>
            ))}
        </div>
    );
};

export default CategoryFilterBar;
