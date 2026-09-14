import React from 'react';
import { useCart } from '../../context/CartContext';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ShoppingCart, Trash2 } from 'lucide-react';

/**
 * SellerConflictDialog
 *
 * Shown when the customer tries to add a product from a different seller than
 * the one already in their cart. Reads state from CartContext so it works
 * regardless of which page/component triggered the conflict.
 *
 * Exact confirmation message (per spec):
 *   "Would you like to clear your current cart and add this product?"
 */
const SellerConflictDialog = () => {
    const { showSellerConflict, cancelSellerSwitch, confirmSellerSwitch, isReplacingCart, pendingReorder } = useCart();

    return (
        <Dialog
            open={showSellerConflict}
            onOpenChange={(open) => {
                if (!open && !isReplacingCart) cancelSellerSwitch();
            }}
        >
            <DialogContent
                className="max-w-sm rounded-3xl border-0 shadow-2xl p-6"
                onInteractOutside={(e) => {
                    if (isReplacingCart) e.preventDefault();
                }}
                onEscapeKeyDown={(e) => {
                    if (isReplacingCart) e.preventDefault();
                }}
            >
                <DialogHeader className="gap-3">
                    <div className="mx-auto h-14 w-14 rounded-2xl bg-amber-50 flex items-center justify-center">
                        <ShoppingCart size={26} className="text-amber-500" strokeWidth={2.5} />
                    </div>
                    <DialogTitle className="text-center text-[17px] font-black text-slate-900 leading-snug">
                        Items from another store
                    </DialogTitle>
                    <DialogDescription className="text-center text-[14px] font-medium text-slate-500 leading-relaxed">
                        {pendingReorder
                            ? "Your cart contains items from another store. Would you like to clear your cart and reorder items from this store?"
                            : "Would you like to clear your current cart and add this product?"}
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-3 mt-2">
                    <Button
                        id="seller-conflict-clear-and-add"
                        onClick={confirmSellerSwitch}
                        disabled={isReplacingCart}
                        className="w-full h-12 rounded-2xl bg-primary hover:bg-primary/90 text-white font-black text-[14px] transition-all active:scale-95"
                    >
                        {isReplacingCart ? (
                            <span className="flex items-center gap-2">
                                <span className="h-4 w-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                                Clearing cart...
                            </span>
                        ) : (
                            <span className="flex items-center gap-2">
                                <Trash2 size={16} strokeWidth={2.5} />
                                {pendingReorder ? "Clear Cart & Reorder" : "Clear Cart & Add"}
                            </span>
                        )}
                    </Button>

                    <Button
                        id="seller-conflict-cancel"
                        variant="outline"
                        onClick={cancelSellerSwitch}
                        disabled={isReplacingCart}
                        className="w-full h-12 rounded-2xl border-slate-200 text-slate-700 font-bold text-[14px] hover:bg-slate-50 transition-all active:scale-95"
                    >
                        Cancel
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default SellerConflictDialog;
