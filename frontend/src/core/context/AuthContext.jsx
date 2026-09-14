import { createContext, useContext, useState, useEffect, useMemo } from 'react';
import axiosInstance from '@core/api/axios';
import { getWithDedupe } from '@core/api/dedupe';
import { getStoredAuthToken } from '@core/utils/authStorage';
import {
    getActiveRole,
    subscribeActiveRole,
} from '@core/auth/activeRoleStore';
import {
    rawGet,
    rawSet,
    rawRemove,
    clearOnLogout,
    STORAGE_KEYS,
} from '@core/utils/storage';

const GLOBAL_AUTH_CONTEXT_KEY = '__turbocart_auth_context__';
const AuthContext =
    (typeof window !== 'undefined' && window[GLOBAL_AUTH_CONTEXT_KEY]) ||
    createContext(undefined);

if (typeof window !== 'undefined') {
    window[GLOBAL_AUTH_CONTEXT_KEY] = AuthContext;
}

const ROLE_STORAGE_KEYS = {
    customer: STORAGE_KEYS.AUTH_CUSTOMER,
    seller: STORAGE_KEYS.AUTH_SELLER,
    admin: STORAGE_KEYS.AUTH_ADMIN,
    delivery: STORAGE_KEYS.AUTH_DELIVERY,
};

const LEGACY_TOKEN_KEY = STORAGE_KEYS.AUTH_LEGACY;

export const AuthProvider = ({ children }) => {
    const getSafeToken = (key) => getStoredAuthToken(ROLE_STORAGE_KEYS[key]);

    const [authData, setAuthData] = useState({
        customer: getSafeToken('customer'),
        seller: getSafeToken('seller'),
        admin: getSafeToken('admin'),
        delivery: getSafeToken('delivery'),
    });

    // Subscribe to the activeRoleStore so this context re-renders whenever the
    // router flips the active portal. The store also falls back to URL
    // inference on first read, so behavior matches the previous implementation
    // before any router has explicitly set a role.
    const [currentRole, setCurrentRole] = useState(getActiveRole());
    useEffect(() => {
        const unsub = subscribeActiveRole((next) => setCurrentRole(next));
        return unsub;
    }, []);

    const [user, setUser] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const token = authData[currentRole];
    const isAuthenticated = !!token;

    useEffect(() => {
        const syncStoredTokens = () => {
            setAuthData({
                customer: getSafeToken('customer'),
                seller: getSafeToken('seller'),
                admin: getSafeToken('admin'),
                delivery: getSafeToken('delivery'),
            });
        };

        window.addEventListener('focus', syncStoredTokens);
        window.addEventListener('storage', syncStoredTokens);
        document.addEventListener('visibilitychange', syncStoredTokens);

        return () => {
            window.removeEventListener('focus', syncStoredTokens);
            window.removeEventListener('storage', syncStoredTokens);
            document.removeEventListener('visibilitychange', syncStoredTokens);
        };
    }, []);

    // Register FCM token after login (non-blocking).
    useEffect(() => {
        if (!token) return;
        let cancelled = false;
        let cleanupDeferredRegistration = null;

        // Fire-and-forget; never block auth/profile load.
        setTimeout(() => {
            import('@core/firebase/pushClient')
                .then(async ({
                    ensureFcmTokenRegistered,
                    hasRegisteredFcmToken,
                    startForegroundPushListener,
                    scheduleFcmRegistrationOnUserGesture
                }) => {
                    if (cancelled) return;
                    await startForegroundPushListener();
                    if (hasRegisteredFcmToken(currentRole)) return;

                    const permission = typeof Notification !== 'undefined' ? Notification.permission : 'default';
                    if (permission === 'granted') {
                        await ensureFcmTokenRegistered({
                            role: currentRole,
                            platform: 'web'
                        });
                        return;
                    }

                    cleanupDeferredRegistration = scheduleFcmRegistrationOnUserGesture({
                        role: currentRole,
                        platform: 'web',
                        onError: (error) => {
                            console.warn('[push] Deferred registration failed:', error?.message || error);
                        },
                    });
                })
                .catch((error) => {
                    // Permission denied / unsupported / any error: user can retry later from push-enabled actions.
                    console.warn('[push] Auto-registration skipped:', error?.message || error);
                });
        }, 0);

        return () => {
            cancelled = true;
            if (typeof cleanupDeferredRegistration === 'function') {
                cleanupDeferredRegistration();
            }
        };
    }, [token, currentRole]);

    // Fetch user profile on mount or token change
    useEffect(() => {
        const fetchProfile = async () => {
            if (token) {
                try {
                    setIsLoading(true);
                    // Use deduplicated fetch to avoid multiple simultaneous profile calls
                    const endpoint = `/${currentRole}/profile`;
                    const response = await getWithDedupe(endpoint, {}, { ttl: 5000 });
                    setUser(response.data.result);
                } catch (error) {
                    console.error('Failed to fetch profile:', error);
                    if (error.response?.status === 401 || error.response?.status === 404) {
                        const storageKey = ROLE_STORAGE_KEYS[currentRole];
                        if (storageKey) rawRemove(storageKey);
                        if (token && rawGet(LEGACY_TOKEN_KEY) === token) {
                            rawRemove(LEGACY_TOKEN_KEY);
                        }
                        clearOnLogout({ role: currentRole });
                        setAuthData(prev => ({ ...prev, [currentRole]: null }));
                    }
                    setUser(null);
                } finally {
                    setIsLoading(false);
                }
            } else {
                setUser(null);
                setIsLoading(false);
            }
        };

        fetchProfile();
    }, [token, currentRole]);

    const login = (userData) => {
        if (!userData) return;
        const role = userData.role?.toLowerCase() || 'customer';
        const storageKey = ROLE_STORAGE_KEYS[role];

        if (storageKey && userData.token) {
            // Persist only the raw JWT string; everything else lives in memory
            // until the next profile fetch.
            rawSet(storageKey, userData.token);

            // Guard against state leaking from a previous account on the same
            // browser (e.g. abandoned guest cart, leftover recent searches).
            // Backend cart will replace it as soon as fetchCart resolves.
            rawRemove(STORAGE_KEYS.CART);
            rawRemove(STORAGE_KEYS.WISHLIST);

            setAuthData(prev => ({ ...prev, [role]: userData.token }));
            setUser(userData); // Set full data initially
        } else if (token || user) {
            // Already logged in: directly merge/update user profile fields in state
            setUser(prev => ({ ...prev, ...userData }));
        } else {
            console.error('Invalid role or missing token for login:', role);
        }
    };

    const logout = async (explicitRole) => {
        // Resolve target role safely (handling synthetic events if passed from onClick={logout})
        let targetRole = typeof explicitRole === 'string' ? explicitRole.toLowerCase().trim() : null;
        if (!targetRole) {
            const active = getActiveRole();
            targetRole = active || currentRole || 'customer';
        }
        if (typeof window !== 'undefined') {
            const p = window.location.pathname;
            if (p.startsWith('/delivery')) targetRole = 'delivery';
            else if (p.startsWith('/seller')) targetRole = 'seller';
            else if (p.startsWith('/admin')) targetRole = 'admin';
        }

        const storageKey = ROLE_STORAGE_KEYS[targetRole];
        const previousUserId = user?._id || user?.id || '';

        // 1. Immediately & synchronously wipe role auth token
        if (storageKey) {
            rawRemove(storageKey);
        }

        // Wipe role-specific pending tokens
        if (targetRole === 'delivery' || (typeof window !== 'undefined' && window.location.pathname.startsWith('/delivery'))) {
            rawRemove(STORAGE_KEYS.AUTH_DELIVERY);
            rawRemove('pending_delivery_id');
            rawRemove('pending_delivery_phone');
            rawRemove('pending_delivery_token');
            try {
                sessionStorage.removeItem('pending_delivery_id');
                sessionStorage.removeItem('pending_delivery_phone');
                sessionStorage.removeItem('pending_delivery_token');
            } catch {
                /* ignore */
            }
        }

        // Remove the legacy shared token only when it belongs to the current role session.
        if (token && rawGet(LEGACY_TOKEN_KEY) === token) {
            rawRemove(LEGACY_TOKEN_KEY);
        }

        // Centralized sensitive-data cleanup: push tokens, recipient PII,
        // recent searches, support-unread counts, guest cart/wishlist and (for
        // delivery role) the rider's last-known GPS.
        clearOnLogout({
            role: targetRole,
            userId: previousUserId,
        });

        // Non-blocking FCM token deregistration
        import('@core/firebase/pushClient')
            .then(({ removeStoredFcmToken }) => removeStoredFcmToken({ role: targetRole }))
            .catch((err) => console.warn('Failed to remove push token during logout:', err));

        setAuthData((prev) => ({
            ...prev,
            [targetRole]: null,
            ...(targetRole === 'delivery' ? { delivery: null } : {}),
        }));

        // Clear the current user profile from memory
        setUser(null);

        // Final fallback: redirect based on current path if needed
        const path = typeof window !== 'undefined' ? window.location.pathname : '';
        if (targetRole === 'delivery' || path.startsWith('/delivery')) {
            window.location.href = '/delivery/auth';
        } else if (targetRole === 'seller' || path.startsWith('/seller')) {
            window.location.href = '/seller/auth';
        } else if (targetRole === 'admin' || path.startsWith('/admin')) {
            window.location.href = '/admin/auth';
        } else {
            window.location.href = '/login';
        }
    };

    const refreshUser = async () => {
        if (token) {
            try {
                const endpoint = `/${currentRole}/profile`;
                const response = await axiosInstance.get(endpoint);
                setUser(response.data.result);
                return response.data.result;
            } catch (error) {
                console.error('Failed to refresh profile:', error);
            }
        }
    };

    const updateUser = (updatedData) => {
        if (typeof updatedData === 'function') {
            setUser(updatedData);
        } else if (updatedData) {
            setUser((prev) => ({ ...prev, ...updatedData }));
        }
    };

    const value = useMemo(() => ({
        user,
        token,
        role: currentRole,
        isAuthenticated,
        isLoading,
        authData,
        login,
        logout,
        refreshUser,
        updateUser
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [user, token, currentRole, isAuthenticated, isLoading, authData]);

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        console.warn('[useAuth] called outside active AuthProvider tree; using safe fallback');
        const role = getActiveRole();
        const roleKey = ROLE_STORAGE_KEYS[role];
        const token = roleKey ? getStoredAuthToken(roleKey) : null;
        return {
            user: null,
            token,
            role,
            isAuthenticated: Boolean(token),
            isLoading: false,
            authData: { [role]: token },
            login: () => {},
            logout: () => {},
            refreshUser: async () => {},
            updateUser: () => {},
        };
    }
    return context;
};
