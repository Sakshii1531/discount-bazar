import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import ProductDetailSheet from '../components/shared/ProductDetailSheet';
import MiniCart from '../components/shared/MiniCart';
import BrandAvatar from '../components/shared/BrandAvatar';
import CatalogProductGrid, { CatalogSortSelect } from '../components/shared/CatalogProductGrid';
import { useProductDetail } from '../context/ProductDetailContext';
import { useCatalogProducts } from '../hooks/useCatalogProducts';

/**
 * All products of one brand that the customer can buy at their location.
 * Products are matched on their brand field (GET /products?brand=).
 */
const BrandProductsPage = () => {
    const { brandName = '' } = useParams();
    const navigate = useNavigate();
    const { isOpen: isProductDetailOpen } = useProductDetail();
    const [sort, setSort] = useState('newest');
    const [inStockOnly, setInStockOnly] = useState(false);

    const brand = String(brandName).trim();
    const listing = useCatalogProducts(
        { brand, sort, inStock: inStockOnly ? 'true' : undefined },
        { enabled: Boolean(brand) },
    );
    // Show the brand as the products spell it, falling back to the URL.
    const displayName = listing.items[0]?.brand?.trim() || brand;

    return (
        <div className="flex flex-col min-h-screen bg-white w-full mx-auto relative font-sans">
            <header className={cn(
                "sticky top-0 z-50 bg-white border-b border-gray-50 px-4 py-3 flex items-center gap-3",
                isProductDetailOpen && "hidden md:flex"
            )}>
                <button
                    onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
                    aria-label="Go back"
                    className="p-1 hover:bg-gray-50 rounded-full transition-colors"
                >
                    <ChevronLeft size={24} className="text-gray-900" />
                </button>
                <BrandAvatar name={displayName} className="h-10 w-10 text-base flex-shrink-0" />
                <div className="min-w-0">
                    <h1 className="text-[17px] font-bold text-gray-800 tracking-tight truncate">{displayName || 'Brand'}</h1>
                    {listing.status === 'ready' && listing.total > 0 && (
                        <p className="text-[11px] font-semibold text-slate-400">
                            {listing.total} {listing.total === 1 ? 'product' : 'products'}
                        </p>
                    )}
                </div>
            </header>

            <main className="flex-1 w-full max-w-7xl mx-auto p-2 sm:p-4 md:p-6 pb-28 space-y-4">
                {brand && (
                    <div className="flex items-center justify-between gap-3 px-1">
                        <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-600 cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={inStockOnly}
                                onChange={(e) => setInStockOnly(e.target.checked)}
                                className="h-4 w-4 accent-primary"
                            />
                            In stock only
                        </label>
                        <CatalogSortSelect value={sort} onChange={setSort} />
                    </div>
                )}
                <CatalogProductGrid
                    listing={brand ? listing : { ...listing, status: 'ready', items: [], areaUnavailable: false }}
                    emptyTitle={brand ? `No ${displayName} products available` : 'Brand not found'}
                    emptyText={
                        brand
                            ? inStockOnly
                                ? 'Everything from this brand is out of stock near you right now.'
                                : 'Stores near you don’t have products from this brand at the moment.'
                            : 'This brand link is incomplete.'
                    }
                />
            </main>

            <MiniCart />
            <ProductDetailSheet />
        </div>
    );
};

export default BrandProductsPage;
