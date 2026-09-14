import React, { useState, useEffect, useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import {
    LayoutDashboard,
    ClipboardList,
    Box,
    Wallet,
} from 'lucide-react';

import { useAuth } from '@core/context/AuthContext';

const BottomNav = ({ navItems }) => {
    const { role } = useAuth();
    const location = useLocation();
    const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);

    useEffect(() => {
        if (typeof window === 'undefined') return;

        const checkKeyboard = () => {
            if (window.visualViewport) {
                const heightDiff = window.innerHeight - window.visualViewport.height;
                setIsKeyboardOpen(heightDiff > 120);
            }
        };

        const handleFocusIn = (e) => {
            if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName)) {
                setIsKeyboardOpen(true);
            }
        };

        const handleFocusOut = () => {
            setTimeout(() => {
                const activeTag = document.activeElement?.tagName;
                if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(activeTag)) {
                    if (window.visualViewport) {
                        const heightDiff = window.innerHeight - window.visualViewport.height;
                        setIsKeyboardOpen(heightDiff > 120);
                    } else {
                        setIsKeyboardOpen(false);
                    }
                }
            }, 100);
        };

        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', checkKeyboard);
            window.visualViewport.addEventListener('scroll', checkKeyboard);
        }
        window.addEventListener('resize', checkKeyboard);
        window.addEventListener('focusin', handleFocusIn);
        window.addEventListener('focusout', handleFocusOut);

        return () => {
            if (window.visualViewport) {
                window.visualViewport.removeEventListener('resize', checkKeyboard);
                window.visualViewport.removeEventListener('scroll', checkKeyboard);
            }
            window.removeEventListener('resize', checkKeyboard);
            window.removeEventListener('focusin', handleFocusIn);
            window.removeEventListener('focusout', handleFocusOut);
        };
    }, []);

    // Define the primary bottom nav items based on user role
    const primaryItems = role === 'admin' ? [
        { label: 'Dashboard', path: '/admin', icon: LayoutDashboard, end: true },
        { label: 'Orders', path: '/admin/orders/all', icon: ClipboardList },
        { label: 'Products', path: '/admin/products', icon: Box },
        { label: 'Wallet', path: '/admin/wallet', icon: Wallet },
    ] : [
        { label: 'Dashboard', path: '/seller', icon: LayoutDashboard, end: true },
        { label: 'Orders', path: '/seller/orders', icon: ClipboardList },
        { label: 'Products', path: '/seller/products', icon: Box },
        { label: 'Earnings', path: '/seller/earnings', icon: Wallet },
    ];

    if (isKeyboardOpen) return null;

    return (
        <div
            className="fixed bottom-0 left-0 right-0 h-16 bg-[#0a0c10] border-t border-white/5 z-[60] md:hidden px-2 flex items-center justify-around shadow-[0_-10px_30px_rgba(0,0,0,0.4)] transition-all duration-200"
        >
            {primaryItems.map((item) => (
                <NavLink
                    key={item.path}
                    to={item.path}
                    end={item.end}
                    className={({ isActive }) => cn(
                        "flex flex-col items-center justify-center space-y-1 w-16 transition-all duration-300",
                        isActive ? "text-primary" : "text-gray-500 hover:text-gray-300"
                    )}
                >
                    <item.icon className="h-5 w-5" />
                    <span className="text-[10px] font-bold uppercase tracking-tight">{item.label}</span>
                </NavLink>
            ))}
        </div>
    );
};

export default BottomNav;

