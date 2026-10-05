import React, { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { LayoutGrid, ChevronDown, Search, ArrowRight, X, Sparkles } from 'lucide-react';
import { customerApi } from '../../services/customerApi';
import { applyCloudinaryTransform } from '@/core/utils/imageUtils';
import { cn } from '@/lib/utils';

const DEFAULT_CATEGORY_IMAGE = "https://cdn.grofers.com/cdn-cgi/image/f=auto,fit=scale-down,q=70,metadata=none,w=270/layout-engine/2022-11/Slice-1_9.png";

const COLORS = [
    "#F4EFE6", "#EEF4EA", "#EAF2F8", "#F5EAF2",
    "#F9EBEA", "#E8F8F5", "#FEF9E7", "#EBF5FB"
];

const CategoriesMegaMenu = ({ 
    buttonClassName = "",
    textColor = "",
    variant = "capsule" // "capsule" or "text"
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [groups, setGroups] = useState([]);
    const [selectedGroupIdx, setSelectedGroupIdx] = useState(0);
    const [searchFilter, setSearchFilter] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [panelPos, setPanelPos] = useState(null);
    const menuRef = useRef(null);
    const buttonRef = useRef(null);
    const navigate = useNavigate();

    // Fetch categories tree
    useEffect(() => {
        let isMounted = true;
        const loadCategories = async () => {
            setIsLoading(true);
            try {
                const res = await customerApi.getCategories({ tree: true });
                if (!isMounted) return;
                if (res.data?.success) {
                    const tree = res.data.results || res.data.result || [];
                    const formatted = tree
                        .filter((header) => (header.name || '').trim().toLowerCase() !== 'all')
                        .map((header, idx) => {
                            const categories = (header.children || []).map((cat, cIdx) => ({
                                id: cat._id,
                                name: cat.name,
                                image: cat.image || DEFAULT_CATEGORY_IMAGE,
                                color: COLORS[(idx + cIdx) % COLORS.length]
                            }));
                            return {
                                id: header._id,
                                title: header.name,
                                categories
                            };
                        })
                        .filter((g) => g.categories.length > 0);
                    setGroups(formatted);
                }
            } catch (err) {
                console.error("Error loading categories mega-menu:", err);
            } finally {
                if (isMounted) setIsLoading(false);
            }
        };

        loadCategories();
        return () => {
            isMounted = false;
        };
    }, []);

    // Close on outside click
    useEffect(() => {
        if (!isOpen) return;

        const handleClickOutside = (e) => {
            if (
                menuRef.current && !menuRef.current.contains(e.target) &&
                buttonRef.current && !buttonRef.current.contains(e.target)
            ) {
                setIsOpen(false);
            }
        };

        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isOpen]);

    // The panel is portalled to <body> so headers with overflow-hidden/transform
    // can't clip it; position it under the trigger and keep it in the viewport.
    useLayoutEffect(() => {
        if (!isOpen) return undefined;
        const place = () => {
            const rect = buttonRef.current?.getBoundingClientRect();
            if (!rect) return;
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const gutter = 16;
            const top = rect.bottom + 10;
            const isDesktop = vw >= 768;
            const width = isDesktop ? Math.min(vw >= 1024 ? 820 : 720, vw - gutter * 2) : vw - gutter * 2;
            const left = isDesktop ? Math.min(Math.max(rect.left, gutter), vw - width - gutter) : gutter;
            const maxHeight = Math.max(240, Math.min(isDesktop ? 540 : vh * 0.8, vh - top - gutter));
            setPanelPos({ top, left, width, maxHeight });
        };
        place();
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, true);
        return () => {
            window.removeEventListener('resize', place);
            window.removeEventListener('scroll', place, true);
        };
    }, [isOpen]);

    const activeGroup = groups[selectedGroupIdx] || groups[0];

    // Filtered categories when search is active
    const filteredResults = useMemo(() => {
        const query = searchFilter.trim().toLowerCase();
        if (!query) return null;

        const list = [];
        groups.forEach((grp) => {
            grp.categories.forEach((cat) => {
                if (cat.name.toLowerCase().includes(query) || grp.title.toLowerCase().includes(query)) {
                    list.push({ ...cat, groupTitle: grp.title });
                }
            });
        });
        return list;
    }, [groups, searchFilter]);

    const handleSelectCategory = (catId) => {
        setIsOpen(false);
        navigate(`/category/${catId}`);
    };

    return (
        <div className="relative inline-block text-left z-[300]">
            {/* Trigger Button */}
            <button
                ref={buttonRef}
                type="button"
                // Opens the full categories page (instead of the dropdown card).
                onClick={() => navigate('/categories')}
                className={cn(
                    "flex items-center gap-1.5 font-bold transition-all select-none cursor-pointer outline-none",
                    variant === "capsule" 
                        ? "px-3.5 py-1.5 rounded-full bg-white/30 hover:bg-white/50 border border-black/10 text-xs shadow-sm"
                        : "text-sm hover:opacity-80 py-1",
                    isOpen && "bg-white/80 shadow-md ring-2 ring-primary/20",
                    buttonClassName
                )}
                style={textColor ? { color: textColor } : undefined}
                aria-expanded={isOpen}
                aria-haspopup="true"
            >
                <LayoutGrid size={variant === "capsule" ? 15 : 17} className="shrink-0 opacity-80" />
                <span>Categories</span>
                <ChevronDown 
                    size={14} 
                    className={cn(
                        "transition-transform duration-300 opacity-70",
                        isOpen && "rotate-180"
                    )} 
                />
            </button>

            {/* Dropdown Menu Modal */}
            {typeof document !== 'undefined' && createPortal(
            <AnimatePresence>
                {isOpen && panelPos && (
                    <motion.div
                        ref={menuRef}
                        initial={{ opacity: 0, y: 10, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 8, scale: 0.98 }}
                        transition={{ duration: 0.2, ease: "easeOut" }}
                        style={{ top: panelPos.top, left: panelPos.left, width: panelPos.width, maxHeight: panelPos.maxHeight }}
                        className="fixed bg-white rounded-3xl shadow-[0_25px_60px_-15px_rgba(0,0,0,0.25)] border border-slate-200/90 overflow-hidden flex flex-col z-[400]"
                    >
                        {/* Top Bar: Search & Quick Details */}
                        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-100 bg-slate-50/80">
                            <div className="flex items-center gap-2 text-slate-800 font-extrabold text-sm shrink-0">
                                <Sparkles size={16} className="text-amber-500 fill-amber-500" />
                                <span>All Categories</span>
                            </div>

                            {/* Search Filter Inside Menu */}
                            <div className="relative flex-1 max-w-sm">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    type="text"
                                    value={searchFilter}
                                    onChange={(e) => setSearchFilter(e.target.value)}
                                    placeholder="Search categories..."
                                    className="w-full pl-8 pr-7 py-1.5 text-xs bg-white border border-slate-200 rounded-full focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all text-slate-700 font-medium placeholder:text-slate-400"
                                />
                                {searchFilter && (
                                    <button 
                                        type="button" 
                                        onClick={() => setSearchFilter('')}
                                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
                                    >
                                        <X size={12} />
                                    </button>
                                )}
                            </div>

                            {/* Close Button */}
                            <button
                                type="button"
                                onClick={() => setIsOpen(false)}
                                className="h-8 w-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200/70 transition-all cursor-pointer"
                                title="Close"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        {/* Content Area */}
                        {isLoading ? (
                            <div className="flex-1 flex flex-col items-center justify-center py-16 text-slate-400 gap-2">
                                <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                                <span className="text-xs font-semibold">Loading categories...</span>
                            </div>
                        ) : filteredResults ? (
                            /* Search Results View */
                            <div className="flex-1 overflow-y-auto p-4 md:p-6">
                                <div className="text-xs font-bold text-slate-500 mb-3 uppercase tracking-wider">
                                    Found {filteredResults.length} matching categories
                                </div>
                                {filteredResults.length === 0 ? (
                                    <div className="text-center py-10 text-slate-400 text-sm">
                                        No categories found matching "{searchFilter}"
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                                        {filteredResults.map((cat) => (
                                            <button
                                                key={cat.id}
                                                type="button"
                                                onClick={() => handleSelectCategory(cat.id)}
                                                className="group flex flex-col items-center p-3 rounded-2xl border border-slate-100 hover:border-primary/30 hover:bg-primary/5 transition-all text-center cursor-pointer active:scale-95"
                                            >
                                                <div 
                                                    className="w-14 h-14 rounded-2xl flex items-center justify-center p-2 mb-2 shadow-sm transition-transform group-hover:scale-105"
                                                    style={{ backgroundColor: cat.color }}
                                                >
                                                    <img
                                                        src={applyCloudinaryTransform(cat.image, "f_auto,q_auto,w_100")}
                                                        alt={cat.name}
                                                        className="w-full h-full object-contain"
                                                        loading="lazy"
                                                    />
                                                </div>
                                                <span className="text-xs font-bold text-slate-800 line-clamp-1 group-hover:text-primary transition-colors">
                                                    {cat.name}
                                                </span>
                                                <span className="text-[10px] text-slate-400 mt-0.5 line-clamp-1">
                                                    in {cat.groupTitle}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ) : (
                            /* Department Tabs + Category Grid Layout */
                            <div className="flex-1 flex overflow-hidden">
                                {/* Left Departments Sidebar */}
                                <div className="w-1/3 md:w-52 border-r border-slate-100 bg-slate-50/60 overflow-y-auto p-2 space-y-1">
                                    {groups.map((group, idx) => {
                                        const isSelected = idx === selectedGroupIdx;
                                        return (
                                            <button
                                                key={group.id || idx}
                                                type="button"
                                                onClick={() => setSelectedGroupIdx(idx)}
                                                onMouseEnter={() => setSelectedGroupIdx(idx)}
                                                className={cn(
                                                    "w-full text-left px-3 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-between group cursor-pointer",
                                                    isSelected
                                                        ? "bg-white text-primary shadow-sm border border-slate-200/80 font-black"
                                                        : "text-slate-600 hover:bg-white/60 hover:text-slate-900"
                                                )}
                                            >
                                                <span className="truncate">{group.title}</span>
                                                <span className={cn(
                                                    "text-[10px] px-1.5 py-0.5 rounded-full font-semibold shrink-0 ml-1 transition-colors",
                                                    isSelected 
                                                        ? "bg-primary/10 text-primary" 
                                                        : "bg-slate-200/60 text-slate-500 group-hover:bg-slate-200"
                                                )}>
                                                    {group.categories.length}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>

                                {/* Right Category Cards Grid */}
                                <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-white">
                                    {activeGroup && (
                                        <>
                                            <div className="flex items-center justify-between mb-4">
                                                <h3 className="text-sm md:text-base font-black text-slate-900">
                                                    {activeGroup.title}
                                                </h3>
                                                <span className="text-[11px] font-medium text-slate-400">
                                                    {activeGroup.categories.length} items
                                                </span>
                                            </div>

                                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 md:gap-4">
                                                {activeGroup.categories.map((cat) => (
                                                    <button
                                                        key={cat.id}
                                                        type="button"
                                                        onClick={() => handleSelectCategory(cat.id)}
                                                        className="group flex flex-col items-center p-3 rounded-2xl border border-slate-100 hover:border-primary/40 hover:bg-slate-50 transition-all text-center cursor-pointer active:scale-95 shadow-[0_2px_8px_rgba(0,0,0,0.03)] hover:shadow-md"
                                                    >
                                                        <div
                                                            className="w-16 h-16 rounded-2xl flex items-center justify-center p-2 mb-2 shadow-inner transition-transform duration-300 group-hover:scale-105"
                                                            style={{ backgroundColor: cat.color }}
                                                        >
                                                            <img
                                                                src={applyCloudinaryTransform(cat.image, "f_auto,q_auto,w_120")}
                                                                alt={cat.name}
                                                                className="w-full h-full object-contain drop-shadow-sm"
                                                                loading="lazy"
                                                            />
                                                        </div>
                                                        <span className="text-xs font-bold text-slate-800 leading-snug line-clamp-2 group-hover:text-primary transition-colors">
                                                            {cat.name}
                                                        </span>
                                                    </button>
                                                ))}
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Bottom Action Footer */}
                        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between text-xs">
                            <span className="text-slate-500 font-medium hidden sm:inline">
                                Total {groups.reduce((acc, g) => acc + g.categories.length, 0)} categories available
                            </span>
                            <button
                                type="button"
                                onClick={() => {
                                    setIsOpen(false);
                                    navigate('/categories');
                                }}
                                className="inline-flex items-center gap-1.5 font-bold text-primary hover:text-primary/80 transition-colors ml-auto cursor-pointer"
                            >
                                <span>Browse Full Directory</span>
                                <ArrowRight size={13} />
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>,
            document.body,
            )}
        </div>
    );
};

export default CategoriesMegaMenu;
