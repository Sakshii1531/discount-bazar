import React, { useEffect, useMemo, useState } from 'react';
import { HiOutlineMagnifyingGlass, HiOutlineXMark, HiOutlineArrowUp } from 'react-icons/hi2';
import { cn } from '@/lib/utils';
import { adminApi } from '../services/adminApi';

const BrandLogo = ({ brand, className }) =>
    brand.logo ? (
        <img src={brand.logo} alt="" className={cn('object-contain bg-white', className)} />
    ) : (
        <span className={cn('flex items-center justify-center bg-primary/10 text-primary font-black', className)}>
            {String(brand.name || '?').charAt(0).toUpperCase()}
        </span>
    );

/**
 * Experience Studio fields for a "Brands" section: searchable multi-select of
 * registered brands (with logos), the order shoppers will see, layout
 * (scrollable row vs grid) and the maximum number of cards.
 */
const BrandSectionFields = ({ value, onChange }) => {
    const [brands, setBrands] = useState([]);
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState('');

    useEffect(() => {
        let cancelled = false;
        // Every active brand (unpaginated) — inactive brands never render for shoppers.
        adminApi
            .getActiveBrands()
            .then((res) => {
                const r = res.data?.result;
                const list = res.data?.results || (Array.isArray(r) ? r : []);
                if (!cancelled) setBrands(Array.isArray(list) ? list : []);
            })
            .catch(() => !cancelled && setBrands([]))
            .finally(() => !cancelled && setLoading(false));
        return () => {
            cancelled = true;
        };
    }, []);

    const byId = useMemo(() => new Map(brands.map((b) => [String(b._id), b])), [brands]);
    const selected = value.brandIds || [];
    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return q ? brands.filter((b) => b.name?.toLowerCase().includes(q)) : brands;
    }, [brands, query]);

    const toggle = (id) =>
        onChange({ brandIds: selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id] });
    const moveUp = (index) => {
        if (index <= 0) return;
        const next = [...selected];
        [next[index - 1], next[index]] = [next[index], next[index - 1]];
        onChange({ brandIds: next });
    };

    return (
        <div className="space-y-4">
            <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                    Brands <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                    <HiOutlineMagnifyingGlass className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search brands"
                        className="w-full rounded-2xl bg-slate-50 py-3 pl-9 pr-3 text-xs font-bold outline-none"
                    />
                </div>
                <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50/40 p-1.5">
                    {loading ? (
                        <p className="p-3 text-center text-[11px] font-bold text-slate-400">Loading brands…</p>
                    ) : !filtered.length ? (
                        <p className="p-3 text-center text-[11px] font-bold text-slate-400">
                            {brands.length ? 'No brands match your search' : 'No brands registered yet'}
                        </p>
                    ) : (
                        <div className="grid grid-cols-2 gap-1.5">
                            {filtered.map((b) => {
                                const id = String(b._id);
                                const checked = selected.includes(id);
                                return (
                                    <label
                                        key={id}
                                        className={cn(
                                            'flex cursor-pointer items-center gap-2 rounded-xl border px-2 py-1.5 transition-all',
                                            checked ? 'border-primary bg-primary/5' : 'border-transparent bg-white hover:border-slate-200',
                                        )}
                                    >
                                        <input type="checkbox" checked={checked} onChange={() => toggle(id)} className="accent-primary" />
                                        <BrandLogo brand={b} className="h-7 w-7 shrink-0 rounded-full border border-slate-100 text-[11px]" />
                                        <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-slate-700">{b.name}</span>
                                    </label>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {selected.length > 0 && (
                <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                        Display order ({selected.length} selected)
                    </label>
                    <div className="flex flex-wrap gap-2">
                        {selected.map((id, index) => {
                            const b = byId.get(id) || { _id: id, name: 'Unknown brand' };
                            return (
                                <span key={id} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white py-1 pl-1 pr-2 text-[11px] font-bold text-slate-700">
                                    <BrandLogo brand={b} className="h-5 w-5 rounded-full text-[9px]" />
                                    {b.name}
                                    {index > 0 && (
                                        <button type="button" onClick={() => moveUp(index)} aria-label={`Move ${b.name} earlier`} className="text-slate-400 hover:text-primary">
                                            <HiOutlineArrowUp className="h-3 w-3" />
                                        </button>
                                    )}
                                    <button type="button" onClick={() => toggle(id)} aria-label={`Remove ${b.name}`} className="text-slate-400 hover:text-rose-500">
                                        <HiOutlineXMark className="h-3.5 w-3.5" />
                                    </button>
                                </span>
                            );
                        })}
                    </div>
                </div>
            )}

            <div className="grid grid-cols-3 gap-3">
                <div className="col-span-3 space-y-2 sm:col-span-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Layout</label>
                    <select
                        value={value.brandLayout}
                        onChange={(e) => onChange({ brandLayout: e.target.value })}
                        className="w-full rounded-2xl bg-slate-50 p-3 text-xs font-black outline-none"
                    >
                        <option value="carousel">Single scrollable row</option>
                        <option value="grid">Multi-row grid</option>
                    </select>
                </div>
                <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Rows</label>
                    <input
                        type="number"
                        min={1}
                        max={6}
                        disabled={value.brandLayout !== 'grid'}
                        value={value.brandLayout === 'grid' ? value.brandRows : 1}
                        onChange={(e) => onChange({ brandRows: e.target.value === '' ? '' : Number(e.target.value) })}
                        className="w-full rounded-2xl bg-slate-50 p-3 text-xs font-black outline-none disabled:opacity-50"
                    />
                </div>
                <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Max cards</label>
                    <input
                        type="number"
                        min={1}
                        max={50}
                        value={value.brandMaxItems}
                        onChange={(e) => onChange({ brandMaxItems: e.target.value === '' ? '' : Number(e.target.value) })}
                        className="w-full rounded-2xl bg-slate-50 p-3 text-xs font-black outline-none"
                    />
                </div>
            </div>
            <p className="text-[10px] text-slate-400">
                Shoppers only see brands that have in-stock products at a store serving their location. Grid shows 4 brands per row.
            </p>
        </div>
    );
};

export default BrandSectionFields;
