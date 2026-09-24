import React from "react";
import { HiOutlineMagnifyingGlass, HiOutlineXMark } from "react-icons/hi2";

const SearchBar = ({ value, onChange, onSubmit, placeholder = "Scan barcode or search products / SKU..." }) => {
    return (
        <div className="relative">
            <HiOutlineMagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={(e) => {
                    // Barcode scanners type the code then send Enter.
                    if (e.key === "Enter" && onSubmit) {
                        e.preventDefault();
                        onSubmit(value);
                    }
                }}
                autoFocus
                placeholder={placeholder}
                className="w-full pl-9 pr-9 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
            />
            {value && (
                <button
                    type="button"
                    onClick={() => onChange("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                    <HiOutlineXMark className="h-4 w-4" />
                </button>
            )}
        </div>
    );
};

export default SearchBar;
