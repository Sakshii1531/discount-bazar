import { useEffect } from 'react';

const LenisScroll = () => {
    useEffect(() => {
        // Lenis smooth scroll has been removed to allow native, hardware-accelerated scrolling
        // and eliminate background scroll leaks on modals, cards, and dashboard views.
        if (typeof window !== 'undefined') {
            window.lenis = {
                stop: () => {},
                start: () => {},
                raf: () => {},
                destroy: () => {},
                scrollTo: () => {},
            };
        }
    }, []);

    return null;
};

export default LenisScroll;
