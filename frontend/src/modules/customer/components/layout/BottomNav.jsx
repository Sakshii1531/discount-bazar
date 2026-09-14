import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Home, LayoutGrid, ShoppingBag, User } from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
    { label: 'Home', icon: Home, path: '/' },
    { label: 'Category', icon: LayoutGrid, path: '/categories' },
    { label: 'Orders', icon: ShoppingBag, path: '/orders' },
    { label: 'Profile', icon: User, path: '/profile' },
];

const isEditableElement = (el) => {
    if (!el) return false;
    const tag = el.tagName?.toUpperCase();
    if (tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) return true;
    if (tag === 'INPUT') {
        const type = (el.type || '').toUpperCase();
        const nonKeyboardTypes = ['CHECKBOX', 'RADIO', 'BUTTON', 'SUBMIT', 'RESET', 'FILE', 'IMAGE', 'RANGE', 'COLOR'];
        return !nonKeyboardTypes.includes(type);
    }
    return false;
};

const BottomNav = () => {
    const location = useLocation();
    const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
    useEffect(() => {
        if (typeof window === 'undefined') return;

        const checkKeyboard = () => {
            const isFieldFocused = isEditableElement(document.activeElement);
            if (!isFieldFocused) {
                setIsKeyboardOpen(false);
                return;
            }
            if (window.visualViewport) {
                const heightDiff = window.innerHeight - window.visualViewport.height;
                setIsKeyboardOpen(heightDiff > 120);
            } else {
                setIsKeyboardOpen(true);
            }
        };

        const handleFocusIn = (e) => {
            if (isEditableElement(e.target)) {
                setIsKeyboardOpen(true);
            }
        };

        const handleFocusOut = () => {
            setTimeout(() => {
                const activeTag = document.activeElement;
                if (!isEditableElement(activeTag)) {
                    checkKeyboard();
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

    if (isKeyboardOpen) return null;

    return (
        <nav className="fixed bottom-0 left-0 right-0 z-[500] bg-white border-t border-slate-200/80 md:hidden shadow-[0_-4px_20px_rgba(0,0,0,0.06)] select-none">
            <div className="flex items-center justify-around h-[62px] px-1">
                {navItems.map((item) => {
                    const isActive = location.pathname === item.path ||
                        (item.path !== '/' && location.pathname.startsWith(item.path));

                    return (
                        <Link
                            key={item.path}
                            to={item.path}
                            className="flex-1 flex flex-col items-center justify-center h-full py-1 group transition-all"
                        >
                            <div
                                className={cn(
                                    "w-12 h-7 rounded-full flex items-center justify-center transition-all duration-200 mb-0.5",
                                    isActive
                                        ? "bg-emerald-100/90 text-emerald-800 font-bold"
                                        : "text-slate-400 group-hover:text-slate-600"
                                )}
                            >
                                <item.icon
                                    size={18}
                                    strokeWidth={isActive ? 2.5 : 1.8}
                                    className={cn(
                                        "transition-transform duration-200",
                                        isActive && "scale-105"
                                    )}
                                />
                            </div>
                            <span
                                className={cn(
                                    "text-[10px] tracking-tight leading-none transition-colors",
                                    isActive ? "font-black text-emerald-800" : "font-semibold text-slate-500"
                                )}
                            >
                                {item.label}
                            </span>
                        </Link>
                    );
                })}
            </div>
            <div style={{ height: 'env(safe-area-inset-bottom)' }} />
        </nav>
    );
};

export default BottomNav;

