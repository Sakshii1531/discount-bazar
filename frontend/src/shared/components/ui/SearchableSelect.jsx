import { useState, useEffect, useRef, useMemo } from "react";
import { Search, ChevronDown, X, Check } from "lucide-react";
import { cn } from "@/lib/utils";

const DISPLAY_LIMIT = 200;

const SearchableSelect = ({
  options = [],
  value = "",
  onChange,
  placeholder = "Select an option",
  searchPlaceholder = "Search...",
  emptyMessage = "No options found",
  disabled = false,
  className,
  error = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const containerRef = useRef(null);
  const searchInputRef = useRef(null);
  const listRef = useRef(null);

  // Normalize options to { id, label }
  const normalizedOptions = useMemo(() => {
    return options.map((opt) => {
      if (typeof opt === "string") {
        return { id: opt, label: opt };
      }
      return {
        id: opt.id ?? opt._id ?? opt.value ?? "",
        label: opt.label ?? opt.name ?? String(opt.id ?? opt._id ?? opt.value ?? ""),
      };
    });
  }, [options]);

  // Find currently selected option
  const selectedOption = useMemo(() => {
    return normalizedOptions.find((opt) => String(opt.id) === String(value));
  }, [normalizedOptions, value]);

  // Filter options based on search query
  const filteredOptions = useMemo(() => {
    const trimmed = searchTerm.trim().toLowerCase();
    if (!trimmed) return normalizedOptions;
    return normalizedOptions.filter((opt) =>
      opt.label.toLowerCase().includes(trimmed)
    );
  }, [normalizedOptions, searchTerm]);

  const handleToggle = () => {
    if (!disabled) {
      if (!isOpen) {
        setSearchTerm("");
      }
      setIsOpen((prev) => !prev);
    }
  };

  // When dropdown opens, focus search input
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [isOpen]);

  // Handle keyboard navigation: Escape to close, Enter to pick first match
  const handleKeyDown = (e) => {
    if (e.key === "Escape") {
      setIsOpen(false);
    }
  };

  const handleSearchKeyDown = (e) => {
    if (e.key === "Enter" && filteredOptions.length > 0) {
      e.preventDefault();
      onChange?.(filteredOptions[0].id);
      setIsOpen(false);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
    }
  };

  // Limit rendered items for maximum performance if there are 1,000+ items
  const visibleOptions = useMemo(() => {
    if (filteredOptions.length <= DISPLAY_LIMIT) {
      return filteredOptions;
    }
    const sliced = filteredOptions.slice(0, DISPLAY_LIMIT);
    // If selectedOption is in filteredOptions but not in the slice, make sure it is included
    if (selectedOption && !sliced.some((o) => String(o.id) === String(selectedOption.id))) {
      const idx = filteredOptions.findIndex((o) => String(o.id) === String(selectedOption.id));
      if (idx !== -1) {
        sliced.push(filteredOptions[idx]);
      }
    }
    return sliced;
  }, [filteredOptions, selectedOption]);

  return (
    <div
      ref={containerRef}
      onKeyDown={handleKeyDown}
      className={cn("relative w-full", isOpen && "z-30")}
    >
      {/* Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={handleToggle}
        className={cn(
          "w-full px-3 py-2 text-left rounded-lg border bg-white flex items-center justify-between text-sm transition-all focus:outline-none",
          isOpen
            ? "border-brand-500 ring-2 ring-brand-500/20"
            : error
            ? "border-red-500 ring-1 ring-red-500/20"
            : "border-gray-300 hover:border-gray-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20",
          disabled && "bg-gray-100 cursor-not-allowed text-gray-400",
          className
        )}
      >
        <span
          className={cn(
            "truncate block flex-1",
            !selectedOption ? "text-gray-400" : "text-gray-900 font-normal"
          )}
        >
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <div className="flex items-center gap-1.5 ml-2 shrink-0">
          {selectedOption && !disabled && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onChange?.("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  onChange?.("");
                }
              }}
              className="p-0.5 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
              title="Clear selection"
            >
              <X className="w-3.5 h-3.5" />
            </span>
          )}
          <ChevronDown
            className={cn(
              "w-4 h-4 text-gray-400 transition-transform duration-200",
              isOpen && "rotate-180"
            )}
          />
        </div>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          className="absolute left-0 right-0 top-full mt-1.5 bg-white rounded-lg shadow-xl border border-gray-200 overflow-hidden z-50 flex flex-col animate-in fade-in-0 zoom-in-95 duration-100"
          style={{ overscrollBehavior: "contain" }}
        >
          {/* Search Field Header */}
          <div className="p-2 border-b border-gray-100 bg-gray-50/50">
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder={searchPlaceholder}
                className="w-full pl-8 pr-7 py-1.5 text-sm bg-white rounded-md border border-gray-200 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 text-gray-800 placeholder-gray-400"
                onClick={(e) => e.stopPropagation()}
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-0.5"
                  title="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Options List */}
          <div
            ref={listRef}
            className="max-h-60 overflow-y-auto py-1 overscroll-contain"
            onWheel={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
          >
            {visibleOptions.length === 0 ? (
              <div className="py-6 px-4 text-center text-xs text-gray-500">
                {emptyMessage}
              </div>
            ) : (
              visibleOptions.map((opt) => {
                const isSelected = String(opt.id) === String(value);
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      onChange?.(opt.id);
                      setIsOpen(false);
                    }}
                    className={cn(
                      "w-full px-3 py-2 text-left text-sm flex items-center justify-between transition-colors",
                      isSelected
                        ? "bg-brand-50 text-brand-700 font-medium"
                        : "text-gray-700 hover:bg-gray-50 hover:text-gray-900"
                    )}
                  >
                    <span className="truncate pr-2">{opt.label}</span>
                    {isSelected && (
                      <Check className="w-4 h-4 text-brand-600 shrink-0" />
                    )}
                  </button>
                );
              })
            )}
          </div>

          {/* Footer Info for Large Lists */}
          {filteredOptions.length > DISPLAY_LIMIT && (
            <div className="px-3 py-1.5 bg-gray-50 border-t border-gray-100 text-[11px] text-gray-500 text-center">
              Showing top {DISPLAY_LIMIT} of {filteredOptions.length} results. Type to refine.
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SearchableSelect;
