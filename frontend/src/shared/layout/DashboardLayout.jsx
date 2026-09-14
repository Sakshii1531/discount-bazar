import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import Sidebar from './Sidebar';
import Topbar from './Topbar';
import BottomNav from './BottomNav';
import { sellerApi } from '@/modules/seller/services/sellerApi';
import { useAuth } from "@core/context/AuthContext";
import { motion, AnimatePresence } from 'framer-motion';
import { BellRing, Check, X, Clock, Truck, RotateCcw, AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import SellerOrdersContext from '@/modules/seller/context/SellerOrdersContext';
import SellerEarningsContext, { defaultEarnings } from '@/modules/seller/context/SellerEarningsContext';
import { getOrderSocket, onSellerOrderNew, onReturnDropOtp, onSellerReturnRequested, onAdminWithdrawalNew } from '@/core/services/orderSocket';
import { createSocketTokenReader } from '@core/utils/authStorage';
import { STORAGE_KEYS } from '@core/utils/storage';
import orderAlertSound from '@/assets/sounds/order_alert.mp3';

const POLL_INTERVAL_MS = 15000;

let synthInterval = null;
let audioCtx = null;

const playRingtoneChime = () => {
    try {
        const Ctx = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
        if (!Ctx) return;
        if (!audioCtx) audioCtx = new Ctx();
        if (audioCtx.state === "suspended") {
            audioCtx.resume();
        }
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(880, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + 0.3);

        gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.4);

        osc.connect(gain);
        gain.connect(audioCtx.destination);

        osc.start();
        osc.stop(audioCtx.currentTime + 0.4);
    } catch (e) {
        /* ignore synth errors */
    }
};

const startWebAudioBeepRingtone = () => {
    if (synthInterval) return;
    playRingtoneChime();
    synthInterval = setInterval(() => {
        playRingtoneChime();
    }, 800);
};

const playRingingTone = () => {
    try {
        const Ctx = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
        if (!Ctx) return;
        if (!audioCtx) audioCtx = new Ctx();
        if (audioCtx.state === "suspended") {
            audioCtx.resume().catch(() => {});
        }
        const now = audioCtx.currentTime;

        [800, 1000].forEach((freq) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = "sine";
            osc.frequency.setValueAtTime(freq, now);
            gain.gain.setValueAtTime(0.35, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(now);
            osc.stop(now + 0.5);
        });

        const delay = 0.2;
        const osc2 = audioCtx.createOscillator();
        const gain2 = audioCtx.createGain();
        osc2.type = "triangle";
        osc2.frequency.setValueAtTime(1200, now + delay);
        gain2.gain.setValueAtTime(0.35, now + delay);
        gain2.gain.exponentialRampToValueAtTime(0.01, now + delay + 0.5);
        osc2.connect(gain2);
        gain2.connect(audioCtx.destination);
        osc2.start(now + delay);
        osc2.stop(now + delay + 0.5);
    } catch (e) {
        /* ignore synth errors */
    }
};

const stopWebAudioBeepRingtone = () => {
    if (synthInterval) {
        clearInterval(synthInterval);
        synthInterval = null;
    }
};

/** Match server `sellerPendingExpiresAt` — never reset to a full 60s when the modal opens late. */
function secondsLeftUntilSellerExpiry(order) {
    if (!order) return 0;
    const raw = order.sellerPendingExpiresAt ?? order.expiresAt;
    if (!raw) return 60;
    const ms = new Date(raw).getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / 1000));
}

function isSellerAlertEligible(order) {
    if (!order?.orderId) return false;
    const ws = String(order.workflowStatus || '').toUpperCase();
    const status = String(order.status || '').toLowerCase();
    const hasExpiry = Boolean(order.sellerPendingExpiresAt ?? order.expiresAt);

    if (hasExpiry && secondsLeftUntilSellerExpiry(order) <= 0) return false;
    if (ws) return ws === 'SELLER_PENDING';

    // Backward compatibility: older payloads may not include workflowStatus.
    return status === 'pending';
}

const isEarningsRoute = (path) =>
    path.includes('earnings') || path.includes('withdrawals') || path.includes('transactions');

const DashboardLayout = ({ children, navItems, title }) => {
    const [newOrderAlert, setNewOrderAlert] = useState(null);
    const [newReturnAlert, setNewReturnAlert] = useState(null);
    const [shownOrderIds, setShownOrderIds] = useState(() => new Set());
    const [shownReturnOrderIds, setShownReturnOrderIds] = useState(() => new Set());
    const [timeLeft, setTimeLeft] = useState(0);
    /** Total seconds in this acceptance window (for progress bar), set when modal opens */
    const acceptWindowTotalRef = useRef(60);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [returnDropOtpAlert, setReturnDropOtpAlert] = useState(null); // { orderId, otp, expiresAt }
    const [returnActionLoading, setReturnActionLoading] = useState(false);
    const [showRejectInput, setShowRejectInput] = useState(false);
    const [rejectReturnReason, setRejectReturnReason] = useState("");
    const [pushPermission, setPushPermission] = useState(() => {
        if (typeof Notification === 'undefined') return 'granted';
        return Notification.permission;
    });
    const [isPermissionBannerDismissed, setIsPermissionBannerDismissed] = useState(() => {
        if (typeof window === 'undefined') return false;
        return sessionStorage.getItem('seller_dismissed_notif_banner') === '1';
    });
    const [isEnablingPush, setIsEnablingPush] = useState(false);
    const { user, logout, role } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();

    const handleEnablePushNotifications = async () => {
        setIsEnablingPush(true);
        try {
            const { ensureFcmTokenRegistered } = await import('@core/firebase/pushClient');
            const token = await ensureFcmTokenRegistered({ role: 'seller', platform: 'web' });
            if (token) {
                setPushPermission('granted');
                toast.success("Order & return push notifications enabled!");
            } else {
                toast.info("Notifications are enabled for your store.");
            }
        } catch (err) {
            console.error("Failed to enable notifications:", err);
            toast.error(err?.message || "Please allow notifications in your browser settings.");
        } finally {
            setIsEnablingPush(false);
        }
    };

    // Ensure all dashboard/seller pages open from the top when navigating
    useEffect(() => {
        const resetScroll = () => {
            window.scrollTo({ top: 0, left: 0, behavior: "instant" });
            document.documentElement.scrollTop = 0;
            document.body.scrollTop = 0;
            const scrollables = document.querySelectorAll(
                "main, .overflow-y-auto, .overflow-auto, [data-lenis-prevent]"
            );
            scrollables.forEach((el) => {
                el.scrollTop = 0;
            });
        };
        resetScroll();
        const raf = requestAnimationFrame(resetScroll);
        const timer = setTimeout(resetScroll, 50);
        return () => {
            cancelAnimationFrame(raf);
            clearTimeout(timer);
        };
    }, [location.pathname, location.search]);

    // Shared data for seller – single source, avoids duplicate API calls
    const [sellerOrders, setSellerOrders] = useState([]);
    const [ordersLoading, setOrdersLoading] = useState(false);
    const [sellerEarningsData, setSellerEarningsData] = useState(defaultEarnings);
    const [earningsLoading, setEarningsLoading] = useState(false);

    const shownOrderIdsRef = useRef(new Set());
    const shownReturnOrderIdsRef = useRef(new Set());
    const isFirstLoadRef = useRef(true);
    const newOrderAlertRef = useRef(null);
    const newReturnAlertRef = useRef(null);
    const fetchOrdersRef = useRef(null);
    const isOrdersFetchInFlightRef = useRef(false);
    const earningsFetchedRef = useRef(false);
    const orderRingtoneRef = useRef(null);
    const ringtoneRetryTimerRef = useRef(null);
    const ringtoneUnlockHandlerRef = useRef(null);
    const withdrawalAudioRef = useRef(null);
    const withdrawalRingTimerRef = useRef(null);
    const lastToastWithdrawalIdRef = useRef(null);

    const playWithdrawalRing = () => {
        try {
            if (!withdrawalAudioRef.current) {
                withdrawalAudioRef.current = new Audio(orderAlertSound);
                withdrawalAudioRef.current.preload = 'auto';
            }
            const a = withdrawalAudioRef.current;
            a.volume = 1;
            a.muted = false;
            a.currentTime = 0;
            const p = a.play();
            if (p && typeof p.catch === 'function') {
                p.catch((err) => {
                    console.warn("[DashboardLayout] withdrawalAudio play error, falling back:", err);
                    try {
                        const fallback = new Audio('/sounds/order_alert.mp3');
                        fallback.volume = 1;
                        fallback.currentTime = 0;
                        fallback.play().catch(() => {
                            // Fallback to synth tone only if audio files are blocked
                            playRingingTone();
                        });
                        withdrawalAudioRef.current = fallback;
                    } catch (_) {
                        playRingingTone();
                    }
                });
            }
        } catch (err) {
            console.warn("[DashboardLayout] audio play failed:", err);
            playRingingTone();
        }

        setTimeout(() => {
            stopWithdrawalRing();
        }, 8000);
    };

    const stopWithdrawalRing = () => {
        if (withdrawalRingTimerRef.current) {
            clearInterval(withdrawalRingTimerRef.current);
            withdrawalRingTimerRef.current = null;
        }
        if (withdrawalAudioRef.current) {
            try {
                withdrawalAudioRef.current.pause();
                withdrawalAudioRef.current.currentTime = 0;
            } catch (_) {}
        }
    };

    const getOrderRingtone = () => {
        if (!orderRingtoneRef.current) {
            const audio = new Audio(orderAlertSound);
            audio.loop = true;
            audio.preload = 'auto';
            orderRingtoneRef.current = audio;
        }
        return orderRingtoneRef.current;
    };

    useEffect(() => {
        const unlockAudio = () => {
            if (!withdrawalAudioRef.current) {
                withdrawalAudioRef.current = new Audio(orderAlertSound);
                withdrawalAudioRef.current.preload = 'auto';
            }
            withdrawalAudioRef.current.play().then(() => {
                withdrawalAudioRef.current.pause();
                withdrawalAudioRef.current.currentTime = 0;
            }).catch(() => {});

            const audio = getOrderRingtone();
            audio.play().then(() => {
                audio.pause();
                audio.currentTime = 0;
            }).catch(() => {});
            const Ctx = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
            if (Ctx) {
                if (!audioCtx) audioCtx = new Ctx();
                if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
            }
        };

        window.addEventListener("pointerdown", unlockAudio, { once: true });
        window.addEventListener("touchstart", unlockAudio, { once: true });
        window.addEventListener("keydown", unlockAudio, { once: true });

        const keepResumed = () => {
            const Ctx = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
            if (Ctx && audioCtx && audioCtx.state === "suspended") {
                audioCtx.resume().catch(() => {});
            }
        };
        window.addEventListener("pointerdown", keepResumed);
        window.addEventListener("keydown", keepResumed);

        return () => {
            window.removeEventListener("pointerdown", unlockAudio);
            window.removeEventListener("touchstart", unlockAudio);
            window.removeEventListener("keydown", unlockAudio);
            window.removeEventListener("pointerdown", keepResumed);
            window.removeEventListener("keydown", keepResumed);
        };
    }, []);

    const startOrderRingtone = () => {
        const audio = getOrderRingtone();
        audio.loop = true;
        audio.preload = 'auto';
        audio.muted = false;
        audio.volume = 1;
        audio.play().catch(() => { });
        startWebAudioBeepRingtone();

        if (!ringtoneRetryTimerRef.current) {
            ringtoneRetryTimerRef.current = setInterval(() => {
                const currentAudio = getOrderRingtone();
                if (currentAudio.paused) {
                    currentAudio.play().catch(() => { });
                }
            }, 1200);
        }

        if (!ringtoneUnlockHandlerRef.current && typeof window !== 'undefined' && typeof document !== 'undefined') {
            const unlockPlayback = () => {
                const currentAudio = getOrderRingtone();
                if (currentAudio.paused) {
                    currentAudio.play().catch(() => { });
                }
                const Ctx = window.AudioContext || window.webkitAudioContext;
                if (Ctx && audioCtx && audioCtx.state === "suspended") {
                    audioCtx.resume();
                }
            };
            ringtoneUnlockHandlerRef.current = unlockPlayback;
            window.addEventListener('focus', unlockPlayback);
            document.addEventListener('visibilitychange', unlockPlayback);
            document.addEventListener('pointerdown', unlockPlayback);
            document.addEventListener('touchstart', unlockPlayback);
            document.addEventListener('keydown', unlockPlayback);
        }
    };

    const stopOrderRingtone = () => {
        stopWebAudioBeepRingtone();
        const audio = orderRingtoneRef.current;
        if (ringtoneRetryTimerRef.current) {
            clearInterval(ringtoneRetryTimerRef.current);
            ringtoneRetryTimerRef.current = null;
        }
        if (ringtoneUnlockHandlerRef.current && typeof window !== 'undefined' && typeof document !== 'undefined') {
            window.removeEventListener('focus', ringtoneUnlockHandlerRef.current);
            document.removeEventListener('visibilitychange', ringtoneUnlockHandlerRef.current);
            document.removeEventListener('pointerdown', ringtoneUnlockHandlerRef.current);
            document.removeEventListener('touchstart', ringtoneUnlockHandlerRef.current);
            document.removeEventListener('keydown', ringtoneUnlockHandlerRef.current);
            ringtoneUnlockHandlerRef.current = null;
        }
        if (!audio) return;
        audio.pause();
        audio.currentTime = 0;
    };

    useEffect(() => {
        shownOrderIdsRef.current = shownOrderIds;
    }, [shownOrderIds]);
    useEffect(() => {
        shownReturnOrderIdsRef.current = shownReturnOrderIds;
    }, [shownReturnOrderIds]);
    useEffect(() => {
        newOrderAlertRef.current = newOrderAlert;
    }, [newOrderAlert]);
    useEffect(() => {
        newReturnAlertRef.current = newReturnAlert;
    }, [newReturnAlert]);

    useEffect(() => {
        if (role !== 'seller') {
            setSellerOrders([]);
            setOrdersLoading(false);
            return;
        }
        setOrdersLoading(true);

        const fetchOrders = async () => {
            if (isOrdersFetchInFlightRef.current) return;
            isOrdersFetchInFlightRef.current = true;
            try {
                const res = await sellerApi.getOrders();
                if (!res?.data?.success) return;

                const payload = res.data.result || {};
                const rawOrders = Array.isArray(payload.items)
                    ? payload.items
                    : (res.data.results || []);
                const allOrders = Array.isArray(rawOrders) ? rawOrders : [];
                setSellerOrders(allOrders);

                const pendingOrders = allOrders.filter(isSellerAlertEligible);

                if (isFirstLoadRef.current) {
                    isFirstLoadRef.current = false;
                }

                const newOrder = pendingOrders.find((o) => !shownOrderIdsRef.current.has(o.orderId));
                if (newOrder && !newOrderAlertRef.current) {
                    setNewOrderAlert(newOrder);
                    setShownOrderIds((prev) => new Set(prev).add(newOrder.orderId));
                    shownOrderIdsRef.current = new Set(shownOrderIdsRef.current).add(newOrder.orderId);
                    newOrderAlertRef.current = newOrder;
                } else if (!newOrderAlertRef.current && !newReturnAlertRef.current) {
                    const returnRequestedOrders = allOrders.filter(
                        (o) => o.returnStatus === 'return_requested' || o.orderStatus === 'return_requested'
                    );
                    const unhandledReturn = returnRequestedOrders.find(
                        (o) => !shownReturnOrderIdsRef.current.has(o.orderId)
                    );
                    if (unhandledReturn) {
                        setNewReturnAlert(unhandledReturn);
                        setShownReturnOrderIds((prev) => new Set(prev).add(unhandledReturn.orderId));
                        shownReturnOrderIdsRef.current = new Set(shownReturnOrderIdsRef.current).add(unhandledReturn.orderId);
                        newReturnAlertRef.current = unhandledReturn;
                    }
                }
            } catch (error) {
                console.error("Polling Error:", error);
            } finally {
                isOrdersFetchInFlightRef.current = false;
                setOrdersLoading(false);
            }
        };

        fetchOrdersRef.current = fetchOrders;
        fetchOrders();
    }, [role]);

    // Resilient fallback when socket events are missed (tab backgrounded/suspended).
    useEffect(() => {
        if (role !== 'seller') return undefined;

        const syncOrders = () => {
            if (fetchOrdersRef.current) fetchOrdersRef.current();
        };

        const timer = setInterval(syncOrders, POLL_INTERVAL_MS);
        const onFocus = () => syncOrders();
        const onVisible = () => {
            if (document.visibilityState === 'visible') syncOrders();
        };
        const onOnline = () => syncOrders();

        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('online', onOnline);

        return () => {
            clearInterval(timer);
            window.removeEventListener('focus', onFocus);
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('online', onOnline);
        };
    }, [role]);

    useEffect(() => {
        if (newOrderAlert || newReturnAlert) {
            startOrderRingtone();
            return undefined;
        }
        stopOrderRingtone();
        return undefined;
    }, [newOrderAlert, newReturnAlert]);

    // Lock background scroll when new order or return alert modal is visible
    useEffect(() => {
        if (newOrderAlert || newReturnAlert) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => {
            document.body.style.overflow = '';
        };
    }, [newOrderAlert, newReturnAlert]);

    useEffect(() => {
        return () => {
            stopOrderRingtone();
            stopWithdrawalRing();
        };
    }, []);

    useEffect(() => {
        if (role === 'seller') return;
        stopOrderRingtone();
    }, [role]);

    useEffect(() => {
        if (role !== 'seller') return undefined;
        const getToken = createSocketTokenReader(STORAGE_KEYS.AUTH_SELLER);
        getOrderSocket(getToken);
        const unsubscribeSellerNew = onSellerOrderNew(getToken, (payload) => {
            if (payload?.orderId) {
                const incoming = {
                    orderId: payload.orderId,
                    ...payload,
                };
                setNewOrderAlert(incoming);
                setShownOrderIds((prev) => new Set(prev).add(payload.orderId));
                shownOrderIdsRef.current = new Set(shownOrderIdsRef.current).add(payload.orderId);
                newOrderAlertRef.current = incoming;
            }
            if (fetchOrdersRef.current) fetchOrdersRef.current();
            startOrderRingtone();
        });

        const unsubscribeReturnReq = onSellerReturnRequested(getToken, (payload) => {
            console.log("[DashboardLayout] Received return:requested:", payload);
            if (payload?.orderId) {
                const incoming = {
                    orderId: payload.orderId,
                    ...payload,
                };
                setNewReturnAlert(incoming);
                setShownReturnOrderIds((prev) => new Set(prev).add(payload.orderId));
                shownReturnOrderIdsRef.current = new Set(shownReturnOrderIdsRef.current).add(payload.orderId);
                newReturnAlertRef.current = incoming;
            }
            if (fetchOrdersRef.current) fetchOrdersRef.current();
            startOrderRingtone();
        });

        const unsubscribeDrop = onReturnDropOtp(getToken, (payload) => {
            console.log("[DashboardLayout] Received return drop OTP:", payload);
            setReturnDropOtpAlert(payload);
            const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
            audio.play().catch(() => { });
        });

        return () => {
            unsubscribeSellerNew();
            unsubscribeReturnReq();
            unsubscribeDrop();
        };
    }, [role]);

    // Admin listener for money requests (withdrawals) with audible ring and direct navigation toast
    useEffect(() => {
        if (role !== 'admin') return undefined;
        const getToken = createSocketTokenReader(STORAGE_KEYS.AUTH_ADMIN);
        getOrderSocket(getToken);

        const unsubscribeWithdrawal = onAdminWithdrawalNew(getToken, (payload) => {
            const toastId = `wdr-${payload?.id || payload?.reference || payload?.amount || Date.now()}`;
            if (lastToastWithdrawalIdRef.current === toastId) {
                return;
            }
            lastToastWithdrawalIdRef.current = toastId;
            setTimeout(() => {
                if (lastToastWithdrawalIdRef.current === toastId) {
                    lastToastWithdrawalIdRef.current = null;
                }
            }, 6000);

            playWithdrawalRing();

            const targetTab = payload?.tab || (payload?.userModel === 'Seller' ? 'sellers' : 'delivery');
            const link = payload?.link || `/admin/withdrawals?tab=${targetTab}`;
            const requester = payload?.userName || (payload?.userModel === 'Seller' ? 'Seller' : 'Delivery Partner');
            const amount = payload?.amount ? `₹${payload.amount}` : '';

            toast.info(`New Money Request: ${requester} requested ${amount}`, {
                id: toastId,
                description: 'Click to review and settle this payout request.',
                duration: 8000,
                action: {
                    label: 'View',
                    onClick: () => {
                        stopWithdrawalRing();
                        navigate(link);
                    },
                },
                onDismiss: () => {
                    stopWithdrawalRing();
                },
                onAutoClose: () => {
                    stopWithdrawalRing();
                },
            });
        });

        return () => {
            unsubscribeWithdrawal();
            stopWithdrawalRing();
        };
    }, [role, navigate]);

    // Single earnings fetch when seller is on earnings/withdrawals/transactions – no duplicate calls
    useEffect(() => {
        if (role !== 'seller' || !isEarningsRoute(location.pathname)) {
            if (!isEarningsRoute(location.pathname)) earningsFetchedRef.current = false;
            return;
        }
        if (earningsFetchedRef.current) return;
        earningsFetchedRef.current = true;
        setEarningsLoading(true);

        sellerApi
            .getEarnings()
            .then((response) => {
                const raw = response?.data?.result ?? response?.data?.data;
                if (response?.data?.success && raw && typeof raw === 'object') {
                    setSellerEarningsData({
                        balances: raw.balances ?? {},
                        ledger: Array.isArray(raw.ledger) ? raw.ledger : [],
                        monthlyChart: Array.isArray(raw.monthlyChart) ? raw.monthlyChart : [],
                    });
                }
            })
            .catch((err) => console.error("Earnings Fetch Error:", err))
            .finally(() => setEarningsLoading(false));
    }, [role, location.pathname]);

    const refreshOrders = () => {
        if (fetchOrdersRef.current) fetchOrdersRef.current();
    };
    const refreshEarnings = () => {
        earningsFetchedRef.current = false;
        setEarningsLoading(true);
        sellerApi
            .getEarnings()
            .then((response) => {
                const raw = response?.data?.result ?? response?.data?.data;
                if (response?.data?.success && raw && typeof raw === 'object') {
                    setSellerEarningsData({
                        balances: raw.balances ?? {},
                        ledger: Array.isArray(raw.ledger) ? raw.ledger : [],
                        monthlyChart: Array.isArray(raw.monthlyChart) ? raw.monthlyChart : [],
                    });
                }
            })
            .catch((err) => console.error("Earnings Fetch Error:", err))
            .finally(() => {
                setEarningsLoading(false);
                earningsFetchedRef.current = true;
            });
    };

    useEffect(() => {
        setIsSidebarOpen(false);
    }, [location.pathname]);

    // Timer: driven by server expiry (sellerPendingExpiresAt), not a local 60s from modal open
    useEffect(() => {
        if (!newOrderAlert) return undefined;

        const left = secondsLeftUntilSellerExpiry(newOrderAlert);
        if (left <= 0) {
            setNewOrderAlert(null);
            toast.error("This order has already expired — you can no longer accept it.");
            return undefined;
        }

        acceptWindowTotalRef.current = left;
        setTimeLeft(left);

        const timer = setInterval(() => {
            const next = secondsLeftUntilSellerExpiry(newOrderAlertRef.current);
            setTimeLeft(next);
            if (next <= 0) {
                clearInterval(timer);
                setNewOrderAlert(null);
                toast.error("Order timed out!");
            }
        }, 1000);

        return () => clearInterval(timer);
    }, [newOrderAlert]);

    const handleAcceptOrder = async (orderId) => {
        try {
            await sellerApi.updateOrderStatus(orderId, { status: 'confirmed' });
            toast.success(`Order #${orderId} Accepted!`);
            stopOrderRingtone();
            setNewOrderAlert(null);
        } catch (error) {
            const msg =
                error?.response?.data?.message ||
                "Failed to accept order";
            const normalizedMsg = String(msg).toLowerCase();
            if (
                normalizedMsg.includes('not available') ||
                normalizedMsg.includes('expired')
            ) {
                stopOrderRingtone();
                setNewOrderAlert(null);
                if (fetchOrdersRef.current) fetchOrdersRef.current();
            }
            toast.error(msg);
        }
    };

    const handleDeclineOrder = async (orderId) => {
        try {
            await sellerApi.updateOrderStatus(orderId, { status: 'cancelled' });
            toast.error(`Order #${orderId} Declined`);
            stopOrderRingtone();
            setNewOrderAlert(null);
        } catch (error) {
            const msg =
                error?.response?.data?.message ||
                "Failed to update order";
            toast.error(msg);
        }
    };

    const handleApproveReturn = async (orderId) => {
        try {
            setReturnActionLoading(true);
            await sellerApi.approveReturn(orderId, {});
            toast.success(`Return for Order #${orderId} approved successfully!`);
            stopOrderRingtone();
            setNewReturnAlert(null);
            setShowRejectInput(false);
            setRejectReturnReason("");
            if (fetchOrdersRef.current) fetchOrdersRef.current();
        } catch (error) {
            const msg = error?.response?.data?.message || "Failed to approve return";
            toast.error(msg);
        } finally {
            setReturnActionLoading(false);
        }
    };

    const handleRejectReturn = async (orderId, explicitReason) => {
        const finalReason = (explicitReason || rejectReturnReason || "").trim();
        if (!finalReason) {
            toast.error("Please provide a reason to reject this return");
            return;
        }
        try {
            setReturnActionLoading(true);
            await sellerApi.rejectReturn(orderId, { reason: finalReason });
            toast.success(`Return for Order #${orderId} rejected`);
            stopOrderRingtone();
            setNewReturnAlert(null);
            setShowRejectInput(false);
            setRejectReturnReason("");
            if (fetchOrdersRef.current) fetchOrdersRef.current();
        } catch (error) {
            const msg = error?.response?.data?.message || "Failed to reject return";
            toast.error(msg);
        } finally {
            setReturnActionLoading(false);
        }
    };

    const handleDismissReturnAlert = () => {
        stopOrderRingtone();
        setNewReturnAlert(null);
        setShowRejectInput(false);
        setRejectReturnReason("");
    };

    const handleViewReturnDetails = () => {
        handleDismissReturnAlert();
        navigate("/seller/returns");
    };

    return (
        <div className="min-h-screen mesh-gradient-light relative overflow-x-hidden">
            {/* Background Blobs for depth */}
            <div className="fixed top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/5 rounded-full blur-[120px] -z-10 animate-pulse pointer-events-none"></div>
            <div className="fixed bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-brand-500/5 rounded-full blur-[120px] -z-10 animate-pulse pointer-events-none" style={{ animationDelay: '2s' }}></div>

            <Sidebar
                items={navItems}
                title={title}
                isOpen={isSidebarOpen}
                onClose={() => setIsSidebarOpen(false)}
            />
            <div className={cn("transition-all duration-300 overflow-x-hidden max-w-full", (role === "admin" || role === "seller") ? "pl-0 md:pl-72" : "pl-72")}>
                <Topbar onMenuClick={() => setIsSidebarOpen(true)} />
                <main className={cn("p-4 md:p-6 min-h-screen overflow-x-hidden max-w-full", (role === "admin" || role === "seller") ? "pt-20 md:pt-24 pb-24 md:pb-6" : "pt-20")}>
                    <div className="w-full pb-12">
                        {role === "seller" && pushPermission !== "granted" && !isPermissionBannerDismissed && (
                            <div className="mb-4 bg-gradient-to-r from-red-600 via-rose-600 to-red-700 text-white rounded-2xl p-4 shadow-lg shadow-red-500/10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border border-red-500/20">
                                <div className="flex items-center gap-3">
                                    <div className="h-10 w-10 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
                                        <BellRing className="h-5 w-5 text-white" />
                                    </div>
                                    <div>
                                        <h4 className="text-sm font-bold text-white">Enable Order & Return Notifications</h4>
                                        <p className="text-xs text-white/85">Get instant ringtone alerts for new orders, return requests, and payouts even when your phone is locked.</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                                    <button
                                        type="button"
                                        onClick={handleEnablePushNotifications}
                                        disabled={isEnablingPush}
                                        className="px-4 py-2 bg-white text-red-600 hover:bg-red-50 text-xs font-bold rounded-xl shadow transition-all active:scale-95 flex items-center gap-1.5"
                                    >
                                        {isEnablingPush ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BellRing className="h-3.5 w-3.5" />}
                                        Enable Notifications
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            sessionStorage.setItem("seller_dismissed_notif_banner", "1");
                                            setIsPermissionBannerDismissed(true);
                                        }}
                                        className="p-2 text-white/80 hover:text-white rounded-lg transition-colors"
                                        title="Dismiss"
                                    >
                                        <X className="h-4 w-4" />
                                    </button>
                                </div>
                            </div>
                        )}
                        <SellerOrdersContext.Provider
                            value={{
                                orders: role === 'seller' ? sellerOrders : [],
                                ordersLoading: role === 'seller' ? ordersLoading : false,
                                refreshOrders,
                            }}>
                            <SellerEarningsContext.Provider
                                value={{
                                    earningsData: role === 'seller' ? sellerEarningsData : defaultEarnings,
                                    earningsLoading: role === 'seller' ? earningsLoading : false,
                                    refreshEarnings,
                                }}>
                                {children}
                            </SellerEarningsContext.Provider>
                        </SellerOrdersContext.Provider>
                    </div>
                </main>
            </div>

            {/* Global Order Alert Modal */}
            <AnimatePresence>
                {newOrderAlert && (
                    <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0, y: 20 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.9, opacity: 0, y: 20 }}
                            className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl border border-slate-100"
                        >
                            <div className="flex flex-col items-center text-center">
                                <div className="h-20 w-20 bg-primary/10 rounded-full flex items-center justify-center mb-6 animate-bounce">
                                    <BellRing className="h-10 w-10 text-primary" />
                                </div>

                                <h2 className="text-2xl font-black text-slate-900 mb-2">New Order Received!</h2>
                                <p className="text-slate-600 font-medium mb-3">
                                    You have a new order{" "}
                                    <span className="text-primary font-bold font-mono">
                                        #{newOrderAlert.orderId?.length > 14 ? `ORD-${newOrderAlert.orderId.slice(-8)}` : newOrderAlert.orderId}
                                    </span>
                                </p>

                                {/* Item Amount & Net Earning Breakdown */}
                                <div className="grid grid-cols-2 gap-3 w-full bg-slate-50 border border-slate-100 rounded-2xl p-4 mb-6">
                                    <div className="text-left">
                                        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Item Amount</div>
                                        <div className="text-lg font-black text-slate-900">
                                            ₹{Math.round(Number(newOrderAlert.itemAmount ?? newOrderAlert.paymentBreakdown?.productSubtotal ?? newOrderAlert.pricing?.subtotal ?? newOrderAlert.pricing?.total ?? newOrderAlert.total ?? 0)).toLocaleString('en-IN')}
                                        </div>
                                    </div>
                                    <div className="text-left border-l border-slate-200 pl-4">
                                        <div className="text-xs font-semibold text-emerald-600 uppercase tracking-wider">Net Earning</div>
                                        <div className="text-lg font-black text-emerald-600">
                                            ₹{Math.round(Number(newOrderAlert.netEarnings ?? newOrderAlert.paymentBreakdown?.sellerPayoutTotal ?? newOrderAlert.pricing?.subtotal ?? newOrderAlert.pricing?.total ?? newOrderAlert.total ?? 0)).toLocaleString('en-IN')}
                                        </div>
                                    </div>
                                </div>

                                {/* Timer Bar — width from real server deadline */}
                                <div className="w-full bg-slate-100 h-2 rounded-full mb-8 overflow-hidden">
                                    <div
                                        className={cn(
                                            "h-full transition-[width] duration-1000 ease-linear",
                                            timeLeft < 15 ? "bg-rose-500" : "bg-primary",
                                        )}
                                        style={{
                                            width: `${acceptWindowTotalRef.current > 0 ? (timeLeft / acceptWindowTotalRef.current) * 100 : 0}%`,
                                        }}
                                    />
                                </div>

                                <div className="flex items-center gap-4 text-sm font-bold mb-8">
                                    <Clock className={cn("h-4 w-4", timeLeft < 15 ? "text-rose-500 animate-pulse" : "text-slate-600")} />
                                    <span className={timeLeft < 15 ? "text-rose-500" : "text-slate-600"}>
                                        Accept within {timeLeft} {timeLeft === 1 ? "second" : "seconds"}
                                    </span>
                                </div>

                                <div className="grid grid-cols-2 gap-4 w-full">
                                    <button
                                        onClick={() => handleDeclineOrder(newOrderAlert.orderId)}
                                        className="flex items-center justify-center gap-2 py-4 rounded-2xl bg-slate-100 text-slate-600 font-bold hover:bg-slate-200 transition-colors"
                                    >
                                        <X className="h-5 w-5" />
                                        Decline
                                    </button>
                                    <button
                                        onClick={() => handleAcceptOrder(newOrderAlert.orderId)}
                                        className="flex items-center justify-center gap-2 py-4 rounded-2xl bg-primary text-primary-foreground font-bold hover:bg-primary/90 shadow-xl shadow-primary/20 transition-all active:scale-95"
                                    >
                                        <Check className="h-5 w-5" />
                                        Accept
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    </div>
                )}

                {/* Global Return Request Alert Modal */}
                {newReturnAlert && (
                    <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0, y: 20 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.9, opacity: 0, y: 20 }}
                            className="bg-white rounded-3xl p-6 md:p-8 max-w-lg w-full shadow-2xl border border-rose-100 max-h-[90vh] overflow-y-auto"
                        >
                            <div className="flex flex-col items-center text-center">
                                <div className="h-20 w-20 bg-rose-50 rounded-full flex items-center justify-center mb-4 animate-bounce text-rose-600 shadow-inner">
                                    <RotateCcw className="h-10 w-10" />
                                </div>

                                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-100 text-rose-700 text-xs font-bold uppercase tracking-wider mb-2">
                                    <AlertTriangle className="h-3.5 w-3.5" /> Return Requested
                                </div>

                                <h2 className="text-2xl font-black text-slate-900 mb-1">
                                    Customer Return Request!
                                </h2>
                                <p className="text-slate-600 font-medium mb-4 text-sm">
                                    Order{" "}
                                    <span className="text-rose-600 font-bold font-mono">
                                        #{newReturnAlert.orderId?.length > 14 ? `ORD-${newReturnAlert.orderId.slice(-8)}` : newReturnAlert.orderId}
                                    </span>
                                </p>

                                {/* Reason and Info Box */}
                                <div className="w-full bg-slate-50 border border-slate-200/70 rounded-2xl p-4 text-left mb-5">
                                    <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                                        Reason for return:
                                    </div>
                                    <div className="text-sm font-bold text-slate-900 mb-2">
                                        {newReturnAlert.returnReason || "Product issue"}
                                    </div>
                                    {newReturnAlert.returnReasonDetail && (
                                        <div className="text-xs text-slate-600 bg-white p-2.5 rounded-xl border border-slate-100 italic mb-2">
                                            &ldquo;{newReturnAlert.returnReasonDetail}&rdquo;
                                        </div>
                                    )}

                                    {/* Items Summary if available */}
                                    {Array.isArray(newReturnAlert.returnItems) && newReturnAlert.returnItems.length > 0 && (
                                        <div className="mt-3 pt-3 border-t border-slate-200/60">
                                            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                                                Returning Items:
                                            </div>
                                            <div className="space-y-1.5 max-h-28 overflow-y-auto">
                                                {newReturnAlert.returnItems.map((item, idx) => (
                                                    <div key={idx} className="flex items-center justify-between text-xs bg-white px-3 py-2 rounded-xl border border-slate-100">
                                                        <span className="font-semibold text-slate-700 truncate max-w-[200px]">{item.name}</span>
                                                        <span className="font-bold text-slate-900">Qty: {item.quantity}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {newReturnAlert.refundAmount > 0 && (
                                        <div className="mt-3 flex items-center justify-between text-xs font-bold text-slate-700 pt-2 border-t border-slate-200/60">
                                            <span>Refund Amount:</span>
                                            <span className="text-rose-600 text-sm font-black">₹{Math.ceil(newReturnAlert.refundAmount).toLocaleString('en-IN')}</span>
                                        </div>
                                    )}
                                </div>

                                {/* Rejection Input Panel */}
                                {showRejectInput ? (
                                    <div className="w-full bg-rose-50/60 border border-rose-200/80 rounded-2xl p-4 mb-4 text-left">
                                        <label className="block text-xs font-bold text-rose-900 mb-2 uppercase tracking-wide">
                                            Select or type rejection reason:
                                        </label>
                                        <div className="flex flex-wrap gap-1.5 mb-2.5">
                                            {["Product used/damaged", "Policy period passed", "Incorrect return claim", "Tags/box missing"].map((preset) => (
                                                <button
                                                    key={preset}
                                                    type="button"
                                                    onClick={() => setRejectReturnReason(preset)}
                                                    className={cn(
                                                        "text-[11px] px-2.5 py-1 rounded-full border transition-all font-medium",
                                                        rejectReturnReason === preset
                                                            ? "bg-rose-600 text-white border-rose-600 font-bold"
                                                            : "bg-white text-slate-700 border-slate-200 hover:border-rose-400"
                                                    )}
                                                >
                                                    {preset}
                                                </button>
                                            ))}
                                        </div>
                                        <input
                                            type="text"
                                            value={rejectReturnReason}
                                            onChange={(e) => setRejectReturnReason(e.target.value)}
                                            placeholder="Type rejection reason..."
                                            className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-rose-500 mb-3"
                                        />
                                        <div className="flex gap-2">
                                            <button
                                                disabled={returnActionLoading}
                                                onClick={() => setShowRejectInput(false)}
                                                className="flex-1 py-2.5 rounded-xl bg-slate-200 text-slate-700 font-bold text-xs hover:bg-slate-300 transition-colors"
                                            >
                                                Back
                                            </button>
                                            <button
                                                disabled={returnActionLoading || !rejectReturnReason.trim()}
                                                onClick={() => handleRejectReturn(newReturnAlert.orderId)}
                                                className="flex-1 py-2.5 rounded-xl bg-rose-600 text-white font-bold text-xs hover:bg-rose-700 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
                                            >
                                                {returnActionLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                                                Confirm Reject
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-2 gap-3 w-full mb-4">
                                        <button
                                            disabled={returnActionLoading}
                                            onClick={() => setShowRejectInput(true)}
                                            className="flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-rose-50 text-rose-700 border border-rose-200 font-bold text-sm hover:bg-rose-100 transition-colors active:scale-95"
                                        >
                                            <X className="h-4 w-4" />
                                            Reject Return
                                        </button>
                                        <button
                                            disabled={returnActionLoading}
                                            onClick={() => handleApproveReturn(newReturnAlert.orderId)}
                                            className="flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-emerald-600 text-white font-bold text-sm hover:bg-emerald-700 shadow-lg shadow-emerald-600/20 transition-all active:scale-95 disabled:opacity-50"
                                        >
                                            {returnActionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                                            Accept Return
                                        </button>
                                    </div>
                                )}

                                <div className="flex items-center justify-between w-full pt-1 px-1">
                                    <button
                                        onClick={handleDismissReturnAlert}
                                        className="text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors"
                                    >
                                        Dismiss Sound
                                    </button>
                                    <button
                                        onClick={handleViewReturnDetails}
                                        className="text-xs font-bold text-primary hover:underline"
                                    >
                                        View in Returns Tab &rarr;
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    </div>
                )}

                {/* Global Return Drop OTP Modal */}
                {returnDropOtpAlert && (
                    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md">
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0, y: 20 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.9, opacity: 0, y: 20 }}
                            className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl border border-brand-100"
                        >
                            <div className="flex flex-col items-center text-center">
                                <div className="h-20 w-20 bg-brand-50 rounded-full flex items-center justify-center mb-6 animate-pulse">
                                    <Truck className="h-10 w-10 text-brand-600" />
                                </div>

                                <h2 className="text-2xl font-black text-slate-900 mb-2">Rider at Store!</h2>
                                <p className="text-slate-600 font-medium mb-6">
                                    A rider is at your store for Return <span className="text-brand-600 font-bold">#{returnDropOtpAlert.orderId}</span>.
                                    Please share the OTP below:
                                </p>

                                <div className="flex items-center justify-center gap-3 mb-8">
                                    {returnDropOtpAlert.otp.split('').map((char, i) => (
                                        <div key={i} className="h-16 w-14 bg-slate-50 rounded-2xl shadow-sm border border-brand-100 flex items-center justify-center text-4xl font-black text-slate-900 border-b-4 border-b-brand-600">
                                            {char}
                                        </div>
                                    ))}
                                </div>

                                <p className="text-xs font-bold text-slate-500 italic mb-8">
                                    Confirm receipt of the product by sharing this code.
                                </p>

                                <button
                                    onClick={() => setReturnDropOtpAlert(null)}
                                    className="w-full py-4 rounded-2xl bg-primary text-primary-foreground font-black hover:bg-primary/90 shadow-xl shadow-primary/20 transition-all active:scale-95 uppercase tracking-widest text-xs"
                                >
                                    Dismiss Alert
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {(role === "admin" || role === "seller") && <BottomNav navItems={navItems} />}
        </div>
    );
};

export default DashboardLayout;
