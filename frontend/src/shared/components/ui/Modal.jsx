import React from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import { cn } from '@/lib/utils';

const Modal = ({ isOpen, onClose, title, children, footer, size = 'md' }) => {
    const sizes = {
        sm: 'max-w-[92vw] sm:max-w-md',
        md: 'max-w-[94vw] sm:max-w-lg',
        lg: 'max-w-[95vw] sm:max-w-2xl',
        xl: 'max-w-[95vw] sm:max-w-4xl',
        full: 'max-w-[95vw] h-[95vh]',
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent
                onPointerDownOutside={(e) => {
                    if (e.target?.closest?.('.pac-container')) {
                        e.preventDefault();
                    }
                }}
                onInteractOutside={(e) => {
                    if (e.target?.closest?.('.pac-container')) {
                        e.preventDefault();
                    }
                }}
                className={cn("overflow-hidden p-0 rounded-2xl sm:rounded-3xl max-h-[92vh] flex flex-col border border-slate-200/80 shadow-2xl", sizes[size])}
            >
                <DialogHeader className="px-4 sm:px-6 py-3 sm:py-3.5 border-b border-slate-100 bg-white shrink-0">
                    <DialogTitle className="text-base sm:text-lg font-black text-slate-900">{title}</DialogTitle>
                    <DialogDescription className="sr-only">Modal content</DialogDescription>
                </DialogHeader>

                <div
                    className="px-4 sm:px-6 py-3.5 overflow-y-auto overscroll-contain touch-pan-y flex-1"
                    tabIndex={0}
                    onWheel={(e) => e.stopPropagation()}
                    onTouchMove={(e) => e.stopPropagation()}
                >
                    {children}
                </div>

                {footer && (
                    <DialogFooter className="px-4 sm:px-6 py-3 bg-slate-50/90 border-t border-slate-100 shrink-0">
                        {footer}
                    </DialogFooter>
                )}
            </DialogContent>
        </Dialog>
    );
};

export default Modal;
