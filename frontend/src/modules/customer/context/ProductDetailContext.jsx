import React, { createContext, useContext, useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';

const ProductDetailContext = createContext();

export const useProductDetail = () => {
    const context = useContext(ProductDetailContext);
    if (!context) {
        // console.warn('useProductDetail used outside Provider');
        return {};
    }
    return context;
};

export const ProductDetailProvider = ({ children }) => {
    const [selectedProduct, setSelectedProduct] = useState(null);
    const [isOpen, setIsOpen] = useState(false);
    const historyPushedRef = useRef(false);
    const location = useLocation();

    // Clean up any stale #product hash on initial mount if no product is selected
    useEffect(() => {
        if (window.location.hash === '#product' && !selectedProduct) {
            window.history.replaceState(null, '', window.location.pathname + window.location.search);
        }
    }, []);

    const performClose = useCallback(() => {
        setIsOpen(false);
        // Delay clearing product to allow close animation to finish
        setTimeout(() => setSelectedProduct(null), 300);
    }, []);

    const openProduct = useCallback((product) => {
        setSelectedProduct(product);
        setIsOpen(true);

        // Push history state so hardware back button, browser back, or swipe back
        // returns to the previous page / closes the modal instead of exiting the app.
        if (!historyPushedRef.current) {
            try {
                const targetUrl = window.location.pathname + window.location.search + '#product';
                window.history.pushState({ isProductDetailModal: true }, '', targetUrl);
                historyPushedRef.current = true;
            } catch (err) {
                console.error('Failed to push history state for product detail:', err);
            }
        }
    }, []);

    const closeProduct = useCallback(() => {
        if (historyPushedRef.current) {
            historyPushedRef.current = false;
            // Pop the history entry we pushed when opening the product
            try {
                if (window.location.hash === '#product' || window.history.state?.isProductDetailModal) {
                    window.history.back();
                }
            } catch (err) {
                console.error('Failed to pop history state for product detail:', err);
            }
        }
        performClose();
    }, [performClose]);

    // Handle back navigation (hardware back button in Flutter WebView, browser back button, back swipe gesture)
    useEffect(() => {
        const handlePopState = () => {
            if (historyPushedRef.current) {
                historyPushedRef.current = false;
                performClose();
            }
        };

        window.addEventListener('popstate', handlePopState);
        return () => {
            window.removeEventListener('popstate', handlePopState);
        };
    }, [performClose]);

    // Handle route path changes (e.g. if navigation happens while modal is open)
    useEffect(() => {
        if (historyPushedRef.current && !location.hash.includes('product')) {
            historyPushedRef.current = false;
            performClose();
        }
    }, [location.pathname, location.hash, performClose]);

    const value = useMemo(
        () => ({ selectedProduct, isOpen, openProduct, closeProduct }),
        [selectedProduct, isOpen, openProduct, closeProduct]
    );

    return (
        <ProductDetailContext.Provider value={value}>
            {children}
        </ProductDetailContext.Provider>
    );
};

