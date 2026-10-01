import { useEffect } from 'react';

/**
 * App-wide background scroll lock for modals / drawers / sheets.
 *
 * Watches the DOM for a full-viewport fixed overlay (a dimmed / blurred backdrop)
 * and, while one is on screen, adds `scroll-locked` to <html> so the page behind
 * it cannot scroll. The class is removed as soon as the last overlay goes away.
 * Works for every modal in the app without each one having to lock scroll itself.
 */

const LOCK_CLASS = 'scroll-locked';

const hasBackdrop = (style) => {
    if (style.backdropFilter && style.backdropFilter !== 'none') return true;
    if (style.webkitBackdropFilter && style.webkitBackdropFilter !== 'none') return true;
    const bg = style.backgroundColor || '';
    if (!bg || bg === 'transparent') return false;
    const m = bg.match(/rgba?\(([^)]+)\)/);
    if (!m) return true;
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    return parts.length < 4 || parseFloat(parts[3]) > 0;
};

const coversViewport = (rect) =>
    rect.width >= window.innerWidth * 0.9 && rect.height >= window.innerHeight * 0.9;

const isModalOverlay = (el) => {
    const style = window.getComputedStyle(el);
    if (style.position !== 'fixed') return false;
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (style.pointerEvents === 'none') return false; // click-through layers (e.g. animations)
    if (!coversViewport(el.getBoundingClientRect())) return false;
    if (hasBackdrop(style)) return true;
    // Backdrop drawn by a direct child (e.g. <div class="absolute inset-0 bg-black/50" />)
    for (const child of el.children) {
        const cs = window.getComputedStyle(child);
        if ((cs.position === 'absolute' || cs.position === 'fixed') &&
            cs.pointerEvents !== 'none' &&
            coversViewport(child.getBoundingClientRect()) &&
            hasBackdrop(cs)) {
            return true;
        }
    }
    return false;
};

const ModalScrollLock = () => {
    useEffect(() => {
        if (typeof window === 'undefined' || typeof MutationObserver === 'undefined') return undefined;
        const root = document.documentElement;
        let frame = 0;

        const check = () => {
            frame = 0;
            const candidates = document.body.querySelectorAll('[class*="fixed"], [style*="fixed"]');
            let open = false;
            for (const el of candidates) {
                if (isModalOverlay(el)) { open = true; break; }
            }
            root.classList.toggle(LOCK_CLASS, open);
        };

        const schedule = () => {
            if (!frame) frame = window.requestAnimationFrame(check);
        };

        const observer = new MutationObserver(schedule);
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class'],
        });
        window.addEventListener('resize', schedule);
        schedule();

        return () => {
            observer.disconnect();
            window.removeEventListener('resize', schedule);
            if (frame) window.cancelAnimationFrame(frame);
            root.classList.remove(LOCK_CLASS);
        };
    }, []);

    return null;
};

export default ModalScrollLock;
