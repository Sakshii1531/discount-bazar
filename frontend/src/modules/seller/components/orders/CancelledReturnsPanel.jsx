import React, { useCallback, useEffect, useState } from 'react';
import { PackageX, Truck } from 'lucide-react';
import { toast } from 'sonner';
import Modal from '@shared/components/ui/Modal';
import ReturnInspectionForm from '@shared/components/cancellation/ReturnInspectionForm';
import { sellerApi } from '../../services/sellerApi';
import { onSocketEvent } from '@/core/services/orderSocket';
import { createSocketTokenReader } from '@core/utils/authStorage';
import { STORAGE_KEYS } from '@core/utils/storage';

const REFRESH_MS = 60 * 1000;

/**
 * Cancelled orders whose parcel is coming back (or is back) at the store.
 * Returned items stay off sale until they are inspected here.
 */
const CancelledReturnsPanel = () => {
    const [items, setItems] = useState([]);
    const [active, setActive] = useState(null);
    const [submitting, setSubmitting] = useState(false);

    const load = useCallback(async () => {
        try {
            const res = await sellerApi.getCancellations();
            setItems((res.data?.result || res.data?.data)?.awaitingInspection || []);
        } catch {
            /* panel is supplementary; the orders list still works */
        }
    }, []);

    useEffect(() => {
        load();
        const timer = setInterval(load, REFRESH_MS);
        window.addEventListener('focus', load);
        const getToken = createSocketTokenReader(STORAGE_KEYS.AUTH_SELLER);
        const offs = [
            onSocketEvent(getToken, 'cancellation:parcel-returned', load),
            onSocketEvent(getToken, 'order:cancelled', load),
        ];
        return () => {
            clearInterval(timer);
            window.removeEventListener('focus', load);
            offs.forEach((off) => off());
        };
    }, [load]);

    const submit = async (payload) => {
        if (!active) return;
        setSubmitting(true);
        try {
            await sellerApi.inspectCancelledReturn(active.id, payload);
            toast.success('Inspection saved. Sellable items are back in stock.');
            setActive(null);
            load();
        } catch (error) {
            toast.error(error?.response?.data?.message || 'Could not save the inspection');
            load();
        } finally {
            setSubmitting(false);
        }
    };

    if (!items.length) return null;

    return (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <h2 className="text-sm font-black text-amber-900 flex items-center gap-2">
                <PackageX size={16} /> Cancelled parcels returning to your store
            </h2>
            <ul className="mt-3 space-y-2">
                {items.map((c) => {
                    const back = c.inventory?.status === 'AWAITING_INSPECTION';
                    return (
                        <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white px-3 py-2 text-sm">
                            <div className="min-w-0">
                                <p className="font-bold text-slate-900">Order #{c.orderId}</p>
                                <p className="text-xs text-slate-500">
                                    {(c.inventory?.items || []).map((i) => `${i.name} × ${i.quantity}`).join(', ')}
                                </p>
                            </div>
                            {back ? (
                                <button
                                    type="button"
                                    onClick={() => setActive(c)}
                                    className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-bold"
                                >
                                    Verify items
                                </button>
                            ) : (
                                <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-800">
                                    <Truck size={14} /> Rider returning — do not resell yet
                                </span>
                            )}
                        </li>
                    );
                })}
            </ul>
            <Modal isOpen={Boolean(active)} onClose={() => !submitting && setActive(null)} title={`Verify returned order #${active?.orderId || ''}`} size="md">
                {active && (
                    <ReturnInspectionForm
                        items={active.inventory?.items || []}
                        submitting={submitting}
                        onCancel={() => setActive(null)}
                        onSubmit={submit}
                    />
                )}
            </Modal>
        </section>
    );
};

export default CancelledReturnsPanel;
