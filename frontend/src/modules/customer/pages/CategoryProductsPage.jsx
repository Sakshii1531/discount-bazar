import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { ChevronLeft, FolderX, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { applyCloudinaryTransform } from '@/core/utils/imageUtils';

import ProductDetailSheet from '../components/shared/ProductDetailSheet';
import { useProductDetail } from '../context/ProductDetailContext';
import { customerApi } from '../services/customerApi';
import MiniCart from '../components/shared/MiniCart';
import CatalogProductGrid, { CatalogSortSelect } from '../components/shared/CatalogProductGrid';
import { useCatalogProducts } from '../hooks/useCatalogProducts';

const isActive = (node) => node && node.status !== 'inactive';

// Category image, or the first letter when the admin hasn't uploaded one.
const CategoryIcon = ({ image, name, selected }) => {
    const [failed, setFailed] = useState(false);
    if (image && !failed) {
        return (
            <img
                src={applyCloudinaryTransform(image)}
                alt={name}
                loading="lazy"
                onError={() => setFailed(true)}
                className="w-full h-full object-contain"
            />
        );
    }
    return (
        <span className={cn("w-full h-full rounded-xl flex items-center justify-center text-lg font-black", selected ? "bg-primary/10 text-primary" : "bg-slate-100 text-slate-400")}>
            {String(name || '?').trim().charAt(0).toUpperCase()}
        </span>
    );
};

const CategoryProductsPage = () => {
    const { categoryName: catId } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const { isOpen: isProductDetailOpen } = useProductDetail();
    const [selectedSubCategory, setSelectedSubCategory] = useState(location.state?.activeSubcategoryId || 'all');
    const [sort, setSort] = useState('newest');
    const [category, setCategory] = useState(null);
    const [treeStatus, setTreeStatus] = useState('loading'); // loading | ready | not-found | error

    const loadCategory = useCallback(async () => {
        setTreeStatus('loading');
        try {
            const catRes = await customerApi.getCategories({ tree: true });
            if (!catRes.data?.success) throw new Error('Failed to load categories');
            const tree = catRes.data.results || catRes.data.result || [];
            let currentCat = null;
            for (const header of tree) {
                if (!isActive(header)) continue;
                const found = (header.children || []).find(c => String(c._id) === String(catId));
                if (found) {
                    currentCat = found;
                    break;
                }
            }
            if (currentCat && isActive(currentCat)) {
                setCategory(currentCat);
                setTreeStatus('ready');
            } else {
                setCategory(null);
                setTreeStatus('not-found');
            }
        } catch (error) {
            console.error("Error fetching category data:", error);
            setCategory(null);
            setTreeStatus('error');
        }
    }, [catId]);

    useEffect(() => {
        loadCategory();
    }, [loadCategory]);

    useEffect(() => {
        setSelectedSubCategory(location.state?.activeSubcategoryId || 'all');
    }, [catId, location.state?.activeSubcategoryId]);

    const subCategories = useMemo(
        () => (category?.children || []).filter(isActive).map(s => ({ id: String(s._id), name: s.name, image: s.image })),
        [category],
    );

    // A subcategory that no longer exists (or was deactivated) falls back to "All".
    useEffect(() => {
        if (treeStatus === 'ready' && selectedSubCategory !== 'all' && !subCategories.some(s => s.id === String(selectedSubCategory))) {
            setSelectedSubCategory('all');
        }
    }, [treeStatus, selectedSubCategory, subCategories]);

    const listing = useCatalogProducts(
        {
            categoryId: catId,
            subcategoryId: selectedSubCategory !== 'all' ? selectedSubCategory : undefined,
            sort,
        },
        { enabled: treeStatus === 'ready' },
    );

    const selectedSubName = subCategories.find(s => s.id === String(selectedSubCategory))?.name;
    const sidebarItems = subCategories.length
        ? [{ id: 'all', name: 'All', image: category?.image }, ...subCategories]
        : [];

    return (
        <div className="flex flex-col min-h-screen bg-white max-w-md md:max-w-none w-full mx-auto relative font-sans md:h-screen md:min-h-0 md:overflow-hidden">
            {/* Header */}
            <header className={cn(
                "sticky top-0 z-50 bg-white border-b border-gray-50 px-4 py-3 flex items-center justify-between gap-3",
                isProductDetailOpen && "hidden md:flex"
            )}>
                <div className="flex items-center gap-3 min-w-0">
                    <button
                        onClick={() => navigate(-1)}
                        aria-label="Go back"
                        className="p-1 hover:bg-gray-50 rounded-full transition-colors"
                    >
                        <ChevronLeft size={24} className="text-gray-900" />
                    </button>
                    <h1 className="text-[18px] font-bold text-gray-800 tracking-tight truncate">
                        {category?.name || (treeStatus === 'loading' ? '' : 'Category')}
                    </h1>
                </div>
                {treeStatus === 'ready' && <CatalogSortSelect value={sort} onChange={setSort} />}
            </header>

            <div className="flex flex-1 relative items-start">
                {treeStatus === 'loading' ? (
                    <div className="w-full flex justify-center py-24">
                        <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                    </div>
                ) : treeStatus !== 'ready' ? (
                    <div className="w-full py-20 px-8 flex flex-col items-center justify-center text-center">
                        <div className="h-16 w-16 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center mb-4">
                            <FolderX className="h-7 w-7 text-slate-300" />
                        </div>
                        <h3 className="text-base font-black text-slate-800 mb-1">
                            {treeStatus === 'not-found' ? 'This category is not available' : "We couldn't load this category"}
                        </h3>
                        <p className="text-xs font-semibold text-slate-500 max-w-[280px] mb-6">
                            {treeStatus === 'not-found' ? 'It may have been removed or renamed.' : 'Check your connection and try again.'}
                        </p>
                        <div className="flex gap-3">
                            {treeStatus === 'error' && (
                                <button onClick={loadCategory} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-black uppercase tracking-wider">
                                    <RefreshCw size={14} /> Try again
                                </button>
                            )}
                            <button onClick={() => navigate('/categories')} className="px-5 py-2.5 rounded-xl border border-slate-200 text-xs font-black uppercase tracking-wider text-slate-700">
                                All categories
                            </button>
                        </div>
                    </div>
                ) : (
                    <>
                        {/* Sidebar (only when the category has subcategories) */}
                        {sidebarItems.length > 0 && (
                            <aside className="w-[76px] md:w-[110px] lg:w-[130px] border-r border-gray-50 flex flex-col bg-white overflow-y-auto overscroll-contain hide-scrollbar sticky top-[60px] h-[calc(100vh-60px)] pb-32 flex-shrink-0">
                                {sidebarItems.map((cat) => {
                                    const selected = String(selectedSubCategory) === cat.id;
                                    return (
                                        <button
                                            key={cat.id}
                                            onClick={() => setSelectedSubCategory(cat.id)}
                                            aria-pressed={selected}
                                            className={cn(
                                                "flex flex-col items-center py-4 px-1 gap-2 transition-all relative border-l-4",
                                                selected
                                                    ? "bg-[#F7FCF5] border-primary"
                                                    : "border-transparent hover:bg-gray-50"
                                            )}
                                        >
                                            <div className={cn(
                                                "w-14 h-14 rounded-2xl flex items-center justify-center p-1.5 transition-all duration-300",
                                                selected ? "scale-110" : "opacity-100"
                                            )}>
                                                <CategoryIcon image={cat.image} name={cat.name} selected={selected} />
                                            </div>
                                            <span className={cn(
                                                "text-[10px] text-center font-bold font-sans leading-tight px-1 line-clamp-2 break-words w-full",
                                                selected ? "text-primary" : "text-gray-600"
                                            )}>
                                                {cat.name}
                                            </span>
                                        </button>
                                    );
                                })}
                            </aside>
                        )}

                        {/* Content */}
                        <main className="flex-1 min-w-0 p-2 md:p-6 pb-24 md:h-[calc(100vh-60px)] md:overflow-y-auto md:overscroll-contain bg-white space-y-4 overflow-x-hidden">
                            {selectedSubName && (
                                <h2 className="text-sm font-black text-slate-800 px-1">{selectedSubName}</h2>
                            )}
                            <CatalogProductGrid
                                listing={listing}
                                emptyTitle={selectedSubName ? `No products in ${selectedSubName} yet` : `No products in ${category?.name || 'this category'} yet`}
                                emptyText="Products appear here as soon as stores near you list them."
                                gridClassName="md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
                            />
                        </main>
                    </>
                )}
            </div>

            <MiniCart />
            <ProductDetailSheet />

            <style dangerouslySetInnerHTML={{
                __html: `
                    .hide-scrollbar::-webkit-scrollbar {
                        display: none;
                    }
                    .hide-scrollbar {
                        -ms-overflow-style: none;
                        scrollbar-width: none;
                    }
                `}} />
        </div>
    );
};

export default CategoryProductsPage;
