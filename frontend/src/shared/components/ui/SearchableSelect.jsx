import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { Search, ChevronDown, X, Check } from "lucide-react";
import { cn } from "@/lib/utils";

const DISPLAY_LIMIT = 200;
// Room the menu wants below the trigger before it opens upwards instead.
const MENU_MIN_SPACE = 260;
const MENU_GAP = 6;
const VIEWPORT_MARGIN = 8;
const SEARCH_HEADER_HEIGHT = 52;
const LIST_MAX_HEIGHT = 240;
const LIST_MIN_HEIGHT = 96;
const MENU_MIN_Z_INDEX = 1000;

// Highest z-index among the element's ancestors, so a portalled menu opened
// from inside a modal (e.g. z-[99999]) is stacked above that modal.
const getAncestorZIndex = (el) => {
  let max = 0;
  for (let node = el; node && node !== document.body; node = node.parentElement) {
    const z = parseInt(window.getComputedStyle(node).zIndex, 10);
    if (!Number.isNaN(z)) max = Math.max(max, z);
  }
  return max;
};

const normalizeText = (text) =>
  String(text ?? "")
    .toLowerCase()
    .replace(/[>/|,_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

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
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const searchInputRef = useRef(null);
  const listRef = useRef(null);
  // Fixed-position menu rendered on document.body, so scroll areas and
  // overflow-hidden cards/modals can't clip it. Inside a Radix dialog the menu
  // stays inline: the dialog blocks pointer events and closes on outside clicks.
  const [portalled, setPortalled] = useState(false);
  const [menuPos, setMenuPos] = useState(null);
  const [menuZIndex, setMenuZIndex] = useState(MENU_MIN_Z_INDEX);

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

  // Filter options based on search query: every typed word must appear in the
  // label, so "electronics laptop" matches "Electronics > Laptops".
  const filteredOptions = useMemo(() => {
    const tokens = normalizeText(searchTerm).split(" ").filter(Boolean);
    if (tokens.length === 0) return normalizedOptions;
    return normalizedOptions.filter((opt) => {
      const label = normalizeText(opt.label);
      return tokens.every((token) => label.includes(token));
    });
  }, [normalizedOptions, searchTerm]);

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - MENU_GAP - VIEWPORT_MARGIN;
    const above = rect.top - MENU_GAP - VIEWPORT_MARGIN;
    const openUp = below < MENU_MIN_SPACE && above > below;
    const room = (openUp ? above : below) - SEARCH_HEADER_HEIGHT;
    setMenuPos({
      left: rect.left,
      width: rect.width,
      top: openUp ? undefined : rect.bottom + MENU_GAP,
      bottom: openUp ? window.innerHeight - rect.top + MENU_GAP : undefined,
      listMaxHeight: Math.max(LIST_MIN_HEIGHT, Math.min(LIST_MAX_HEIGHT, room)),
    });
  }, []);

  const handleToggle = () => {
    if (!disabled) {
      if (!isOpen) {
        setSearchTerm("");
        const usePortal = !containerRef.current?.closest('[role="dialog"]');
        setPortalled(usePortal);
        if (usePortal) {
          setMenuZIndex(Math.max(MENU_MIN_Z_INDEX, getAncestorZIndex(containerRef.current) + 1));
          updateMenuPosition();
        }
      }
      setIsOpen((prev) => !prev);
    }
  };

  useLayoutEffect(() => {
    if (!isOpen || !portalled) return undefined;
    // Follow the trigger while any ancestor scrolls or the window resizes.
    window.addEventListener("scroll", updateMenuPosition, true);
    window.addEventListener("resize", updateMenuPosition);
    return () => {
      window.removeEventListener("scroll", updateMenuPosition, true);
      window.removeEventListener("resize", updateMenuPosition);
    };
  }, [isOpen, portalled, updateMenuPosition]);

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
      const inTrigger = containerRef.current?.contains(e.target);
      const inMenu = menuRef.current?.contains(e.target);
      if (!inTrigger && !inMenu) {
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

  const renderMenu = (menu) => (portalled ? createPortal(menu, document.body) : menu);

  return (
    <div
      ref={containerRef}
      onKeyDown={handleKeyDown}
      className={cn("relative w-full", isOpen && "z-30")}
    >
      {/* Trigger Button */}
      <button
        ref={triggerRef}
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
      {isOpen && (!portalled || menuPos) && renderMenu(
        <div
          ref={menuRef}
          className={cn(
            "bg-white rounded-lg shadow-xl border border-gray-200 overflow-hidden flex flex-col animate-in fade-in-0 zoom-in-95 duration-100",
            portalled ? "fixed" : "absolute left-0 right-0 top-full mt-1.5 z-50"
          )}
          style={{
            overscrollBehavior: "contain",
            ...(portalled && menuPos
              ? { left: menuPos.left, width: menuPos.width, top: menuPos.top, bottom: menuPos.bottom, zIndex: menuZIndex }
              : {}),
          }}
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
            className={cn("overflow-y-auto py-1 overscroll-contain", !portalled && "max-h-60")}
            style={portalled && menuPos ? { maxHeight: menuPos.listMaxHeight } : undefined}
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
